import { CanvasNodeType, type CanvasNodeData, type ToonflowNodeKind } from "../../types/canvas";

const INSTANCE_KINDS: ReadonlySet<ToonflowNodeKind> = new Set(["storyboard-page", "keyframes", "video-workbench"]);
const GROUP_PREFIX = "instance-group-";
const GROUP_PAD = 40;
const GRID_COLS = 4; // 组内段实例每行个数
const CELL_GAP = 32; // 段实例间距
const LANE_GAP = 140; // 组与组之间的横向间隔
const BASELINE_GAP = 220; // 组整体摆到模板下方的纵向间隔
// 流水线序:组按此顺序从左到右分道
const KIND_ORDER: ToonflowNodeKind[] = ["storyboard-page", "keyframes", "video-workbench"];

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
 * 给每个有活跃段实例的环节 root 维护一个 Group 容器,并做组内紧凑 + 组间分道布局:
 * 每组 root 当头部、段实例排成网格铺下方;各组按流水线序排入独立横向轨道、整体摆到模板下方,
 * 构造上互不重叠且幂等。段实例保留 toonflow(权威),Group 容器无 toonflow(零污染)。
 * 只碰段环节 root/实例,不动图片批量节点。
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

    // 组内紧凑 + 组间分道:每组把 root 当头部、段实例排成网格铺在下方;
    // 各组按流水线序从左到右排入独立横向轨道,整体摆到模板阶段节点下方——构造上互不重叠,且幂等。
    const nodeById = new Map(memberFixed.map((node) => [node.id, node]));
    // 基线:模板阶段节点(有 toonflow 但非段实例类)的下边缘,组整体摆其下方,避免压住流水线
    const stageNodes = memberFixed.filter((node) => node.metadata?.toonflow && !isInstanceNode(node));
    const baseX = stageNodes.length ? Math.min(...stageNodes.map((node) => node.position.x)) : 0;
    const baseY = (stageNodes.length ? Math.max(...stageNodes.map((node) => node.position.y + node.height)) : 0) + BASELINE_GAP;

    const orderedGroups = [...desired.entries()].sort(
        ([, a], [, b]) => KIND_ORDER.indexOf(a.root.metadata!.toonflow!.kind) - KIND_ORDER.indexOf(b.root.metadata!.toonflow!.kind),
    );

    const positionById = new Map<string, { x: number; y: number }>();
    const groupNodes: CanvasNodeData[] = [];
    let laneX = baseX;
    for (const [groupId, { root, memberIds }] of orderedGroups) {
        const instances = memberIds
            .filter((id) => id !== root.id)
            .map((id) => nodeById.get(id)!)
            .sort((a, b) => (a.metadata!.toonflow!.segmentIndex ?? 0) - (b.metadata!.toonflow!.segmentIndex ?? 0));
        const cellW = Math.max(root.width, ...instances.map((node) => node.width));
        const cellH = Math.max(root.height, ...instances.map((node) => node.height));
        const cols = Math.min(Math.max(instances.length, 1), GRID_COLS);
        const rows = Math.ceil(instances.length / GRID_COLS);
        const gridW = cols * cellW + (cols - 1) * CELL_GAP;
        const laneW = Math.max(root.width, gridW);

        // root 头部居中于本组宽度顶部
        positionById.set(root.id, { x: laneX + (laneW - root.width) / 2, y: baseY });
        const gridTop = baseY + root.height + CELL_GAP;
        instances.forEach((node, index) => {
            const col = index % GRID_COLS;
            const row = Math.floor(index / GRID_COLS);
            positionById.set(node.id, { x: laneX + col * (cellW + CELL_GAP), y: gridTop + row * (cellH + CELL_GAP) });
        });
        const blockH = root.height + CELL_GAP + rows * cellH + (rows - 1) * CELL_GAP;

        groupNodes.push({
            id: groupId,
            type: CanvasNodeType.Group,
            title: root.title,
            position: { x: laneX - GROUP_PAD, y: baseY - GROUP_PAD },
            width: laneW + GROUP_PAD * 2,
            height: blockH + GROUP_PAD * 2,
            metadata: { status: "idle", projectionOf: { stageNodeId: root.id, kind: root.metadata!.toonflow!.kind } },
        });
        laneX += laneW + GROUP_PAD * 2 + LANE_GAP;
    }

    const laidOut = memberFixed.map((node) => {
        const position = positionById.get(node.id);
        return position ? { ...node, position } : node;
    });

    return [...laidOut, ...groupNodes];
}
