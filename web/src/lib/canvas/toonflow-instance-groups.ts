import { CanvasNodeType, type CanvasNodeData, type ToonflowNodeKind } from "../../types/canvas";

const INSTANCE_KINDS: ReadonlySet<ToonflowNodeKind> = new Set(["storyboard-page", "keyframes", "video-workbench"]);
const GROUP_PREFIX = "instance-group-";
const GROUP_PAD = 40;

export function instanceGroupId(rootNodeId: string): string {
    return `${GROUP_PREFIX}${rootNodeId}`;
}

export function isInstanceGroupNode(node: CanvasNodeData): boolean {
    return node.type === CanvasNodeType.Group && node.id.startsWith(GROUP_PREFIX) && Boolean(node.metadata?.projectionOf);
}

/** 属于段实例分组体系的节点:环节 root 或段实例(toonflow.kind 为多段环节类)。拖拽后判断是否需重跑 reconcile 用——按稳定的 toonflow 身份识别,不看拖放后的 groupId。 */
export function isInstanceGroupMemberNode(node: CanvasNodeData): boolean {
    const toonflow = node.metadata?.toonflow;
    return Boolean(toonflow && INSTANCE_KINDS.has(toonflow.kind));
}

function isInstanceRoot(node: CanvasNodeData): boolean {
    const toonflow = node.metadata?.toonflow;
    return Boolean(toonflow && INSTANCE_KINDS.has(toonflow.kind) && !toonflow.segmentId);
}

function isInstanceNode(node: CanvasNodeData): boolean {
    return Boolean(node.metadata?.toonflow && INSTANCE_KINDS.has(node.metadata.toonflow.kind));
}

function activeInstancesOfKind(nodes: CanvasNodeData[], kind: ToonflowNodeKind): CanvasNodeData[] {
    return nodes.filter((node) => {
        const toonflow = node.metadata?.toonflow;
        return Boolean(toonflow && toonflow.kind === kind && toonflow.segmentId && !toonflow.archived);
    });
}

/**
 * 给每个有活跃段实例的环节 root 维护一个 Group 容器。成员位置保持不变，
 * Group 仅作为基于当前位置包围盒的派生呈现层。
 */
export function reconcileInstanceGroups(nodes: CanvasNodeData[]): CanvasNodeData[] {
    const roots = nodes.filter(isInstanceRoot);
    const existingGroupIds = new Set(nodes.filter(isInstanceGroupNode).map((node) => node.id));
    const hasOrphanedMember = nodes.some((node) => isInstanceNode(node) && node.metadata?.groupId?.startsWith(GROUP_PREFIX));
    if (!roots.length && !existingGroupIds.size && !hasOrphanedMember) return nodes;

    const desired = new Map<string, { root: CanvasNodeData; memberIds: string[] }>();
    const memberToGroup = new Map<string, string>();
    for (const root of roots) {
        const kind = root.metadata!.toonflow!.kind;
        const instances = activeInstancesOfKind(nodes, kind);
        if (!instances.length) continue;
        const groupId = instanceGroupId(root.id);
        const memberIds = [root.id, ...instances.map((node) => node.id)];
        desired.set(groupId, { root, memberIds });
        for (const memberId of memberIds) memberToGroup.set(memberId, groupId);
    }

    const withoutGroups = nodes.filter((node) => !isInstanceGroupNode(node));
    const memberFixed = withoutGroups.map((node) => {
        const desiredGroupId = memberToGroup.get(node.id);
        const currentGroupId = node.metadata?.groupId;
        if (desiredGroupId) {
            const isSegmentInstance = Boolean(node.metadata?.toonflow?.segmentId);
            if (currentGroupId === desiredGroupId && (!isSegmentInstance || node.metadata?.batchRootId === undefined)) return node;
            return { ...node, metadata: { ...node.metadata, groupId: desiredGroupId, ...(isSegmentInstance ? { batchRootId: undefined } : {}) } };
        }
        if (isInstanceNode(node) && currentGroupId?.startsWith(GROUP_PREFIX)) {
            return { ...node, metadata: { ...node.metadata, groupId: undefined } };
        }
        return node;
    });

    const groupNodes: CanvasNodeData[] = [];
    for (const [groupId, { root, memberIds }] of desired) {
        const members = memberIds.map((id) => memberFixed.find((node) => node.id === id)).filter((node): node is CanvasNodeData => Boolean(node));
        const minX = Math.min(...members.map((node) => node.position.x));
        const minY = Math.min(...members.map((node) => node.position.y));
        const maxX = Math.max(...members.map((node) => node.position.x + node.width));
        const maxY = Math.max(...members.map((node) => node.position.y + node.height));
        groupNodes.push({
            id: groupId,
            type: CanvasNodeType.Group,
            title: root.title,
            position: { x: minX - GROUP_PAD, y: minY - GROUP_PAD },
            width: maxX - minX + GROUP_PAD * 2,
            height: maxY - minY + GROUP_PAD * 2,
            metadata: { status: "idle", projectionOf: { stageNodeId: root.id, kind: root.metadata!.toonflow!.kind } },
        });
    }

    return [...memberFixed, ...groupNodes];
}
