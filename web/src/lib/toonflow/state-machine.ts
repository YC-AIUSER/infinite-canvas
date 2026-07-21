/**
 * Design doc: ~/.gstack/projects/basketikun-infinite-canvas/Administrator-main-design-20260712-103217.md
 * 参见「状态机（七态，继承并改造现有七态）」与「状态机语义补全」章节。
 */

import type { NodeOutput, NodeStatus } from "./schema";

export type GraphNode = {
    nodeId: string;
    status: NodeStatus;
    version: number;
    upstreamVersions: Record<string, number>;
    skipped?: boolean;
};

type NodeMutationResult = {
    next: NodeOutput;
    propagate: boolean;
};

// edges 由画布 connections 映射而来，只保留业务依赖方向 from -> to。
type GraphEdge = { from: string; to: string };

const STALEABLE_STATUSES: ReadonlySet<NodeStatus> = new Set(["approved", "review", "failed"]);
// skipped 也可生成:选修环节(如 P0 创意)默认落 skipped,用户手动点生成必须能启用它。
// 「一键跑全链不碰 skipped」这条语义不靠此集合守卫,而由 cascadeOrder 末尾的 isSkipped 过滤兜底——
// 两者职责分离:此集合管"手动能不能生成",cascadeOrder 管"自动要不要生成"。
const GENERATABLE_STATUSES: ReadonlySet<NodeStatus> = new Set(["empty", "failed", "stale", "approved", "review", "skipped"]);

function buildAdjacency(edges: GraphEdge[]): Map<string, string[]> {
    const adjacency = new Map<string, string[]>();

    for (const edge of edges) {
        const downstream = adjacency.get(edge.from);
        if (downstream) {
            downstream.push(edge.to);
        } else {
            adjacency.set(edge.from, [edge.to]);
        }
    }

    return adjacency;
}

function isSkipped(node: GraphNode): boolean {
    return node.skipped === true || node.status === "skipped";
}

function clonePayload(payload: NodeOutput["payload"]): NodeOutput["payload"] {
    const next = { ...payload };

    if (payload.table) {
        next.table = payload.table.map((row) => ({
            ...row,
            assetSlots: row.assetSlots ? [...row.assetSlots] : undefined,
        }));
    }
    if (payload.imageKeys) next.imageKeys = [...payload.imageKeys];
    if (payload.videoKeys) next.videoKeys = [...payload.videoKeys];
    if (payload.audioKeys) next.audioKeys = [...payload.audioKeys];
    if (payload.shotPrompts) next.shotPrompts = { ...payload.shotPrompts };
    if (payload.audioLines) next.audioLines = payload.audioLines.map((line) => ({ ...line }));

    return next;
}

function transitionError(action: string, status: NodeStatus, expected: string): never {
    throw new Error(`非法状态迁移：${action} 仅允许 ${expected}，当前状态为 ${status}`);
}

/**
 * changed(vN) -> child -> descendant
 *                  \-> [guard hit: stop branch]
 */
export function propagateStale(
    nodes: GraphNode[],
    edges: Array<{ from: string; to: string }>,
    changedNodeId: string,
    newVersion: number,
): string[] {
    const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
    const adjacency = buildAdjacency(edges);
    const staleNodeIds: string[] = [];
    const visited = new Set<string>([changedNodeId]);
    const queue = [...(adjacency.get(changedNodeId) ?? [])];

    for (let index = 0; index < queue.length; index += 1) {
        const nodeId = queue[index];
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);

        const node = nodeById.get(nodeId);
        if (!node) continue;
        if ((node.upstreamVersions[changedNodeId] ?? Number.NEGATIVE_INFINITY) >= newVersion) continue;

        if (!isSkipped(node) && STALEABLE_STATUSES.has(node.status)) {
            staleNodeIds.push(nodeId);
        }

        queue.push(...(adjacency.get(nodeId) ?? []));
    }

    return staleNodeIds;
}

/**
 * review --approve--> approved
 *                 --X--> stale propagation
 */
export function approveNode(node: NodeOutput): NodeMutationResult {
    if (node.status !== "review") {
        return transitionError("approveNode", node.status, "review -> approved");
    }

    return {
        next: { ...node, status: "approved" },
        propagate: false,
    };
}

/**
 * approved(vN) --edit/save--> approved(vN+1) -> propagate
 */
export function saveEditedNode(node: NodeOutput): NodeMutationResult {
    if (node.status !== "approved") {
        return transitionError("saveEditedNode", node.status, "approved -> approved");
    }

    return {
        next: { ...node, version: node.version + 1 },
        propagate: true,
    };
}

/**
 * historical payload ----\
 * current(vN) ------------+--> new current(vN+1) -> propagate
 */
export function rollbackToVersion(current: NodeOutput, historical: NodeOutput): NodeMutationResult {
    // 回退=用户显式选定该版产物,视同编辑保存(编辑者即验收者),故直接落 approved。
    return {
        next: {
            ...current,
            status: "approved",
            version: current.version + 1,
            payload: clonePayload(historical.payload),
        },
        propagate: true,
    };
}

/**
 * empty|failed|stale|approved|review|skipped --generate--> generating
 */
export function nextStatusOnGenerate(status: NodeStatus): NodeStatus {
    if (!GENERATABLE_STATUSES.has(status)) {
        return transitionError("nextStatusOnGenerate", status, "empty|failed|stale|approved|review|skipped -> generating");
    }

    return "generating";
}

/**
 * generating --success--> review
 */
export function onGenerateSuccess(status: NodeStatus): NodeStatus {
    if (status !== "generating") {
        return transitionError("onGenerateSuccess", status, "generating -> review");
    }

    return "review";
}

/**
 * generating --failure--> failed
 */
export function onGenerateFailure(status: NodeStatus): NodeStatus {
    if (status !== "generating") {
        return transitionError("onGenerateFailure", status, "generating -> failed");
    }

    return "failed";
}

/**
 * root -> A -> C
 *      \-> B -> C    => root, A/B, C（skipped 不输出但穿透）
 */
export function cascadeOrder(
    nodes: GraphNode[],
    edges: Array<{ from: string; to: string }>,
    rootId: string,
): string[] {
    const nodeById = new Map(nodes.map((node) => [node.nodeId, node]));
    if (!nodeById.has(rootId)) return [];

    const adjacency = buildAdjacency(edges);
    const reachable = new Set<string>([rootId]);
    const reachabilityQueue = [rootId];

    for (let index = 0; index < reachabilityQueue.length; index += 1) {
        for (const childId of adjacency.get(reachabilityQueue[index]) ?? []) {
            if (!nodeById.has(childId) || reachable.has(childId)) continue;
            reachable.add(childId);
            reachabilityQueue.push(childId);
        }
    }

    const indegree = new Map<string, number>();
    for (const nodeId of reachable) indegree.set(nodeId, 0);

    for (const edge of edges) {
        if (reachable.has(edge.from) && reachable.has(edge.to)) {
            indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
        }
    }

    const ready = nodes
        .map((node) => node.nodeId)
        .filter((nodeId) => reachable.has(nodeId) && indegree.get(nodeId) === 0);
    const ordered: string[] = [];

    for (let index = 0; index < ready.length; index += 1) {
        const nodeId = ready[index];
        ordered.push(nodeId);

        for (const childId of adjacency.get(nodeId) ?? []) {
            if (!reachable.has(childId)) continue;
            const nextIndegree = (indegree.get(childId) ?? 0) - 1;
            indegree.set(childId, nextIndegree);
            if (nextIndegree === 0) ready.push(childId);
        }
    }

    if (ordered.length !== reachable.size) {
        throw new Error(`级联子图存在环，无法从节点 ${rootId} 生成拓扑序`);
    }

    return ordered.filter((nodeId) => !isSkipped(nodeById.get(nodeId)!));
}

/**
 * root -> failed -> halted descendants
 *      \-> other  -> unaffected descendants
 */
export function failurePolicy(
    nodes: GraphNode[],
    edges: Array<{ from: string; to: string }>,
    failedNodeId: string,
): { haltedBranch: string[]; unaffected: string[] } {
    const nodeIds = new Set(nodes.map((node) => node.nodeId));
    const adjacency = buildAdjacency(edges);
    const haltedBranch: string[] = [];
    const halted = new Set<string>();
    const visited = new Set<string>([failedNodeId]);
    const queue = [...(adjacency.get(failedNodeId) ?? [])];

    for (let index = 0; index < queue.length; index += 1) {
        const nodeId = queue[index];
        if (visited.has(nodeId)) continue;
        visited.add(nodeId);
        if (!nodeIds.has(nodeId)) continue;

        halted.add(nodeId);
        haltedBranch.push(nodeId);
        queue.push(...(adjacency.get(nodeId) ?? []));
    }

    return {
        haltedBranch,
        unaffected: nodes
            .map((node) => node.nodeId)
            .filter((nodeId) => nodeId !== failedNodeId && !halted.has(nodeId)),
    };
}
