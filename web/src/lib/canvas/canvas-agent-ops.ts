import { nanoid } from "nanoid";

import { getNodeSpec } from "@/constant/canvas";
import { migrateToonflowStatus, NODE_STATUSES, type NodeStatus } from "@/lib/toonflow/schema";
import { propagateAfterNewVersion } from "@/lib/toonflow/node-runtime";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type ViewportTransform } from "@/types/canvas";

export type CanvasAgentOp =
    | { type: "add_node"; id?: string; nodeType?: CanvasNodeType; title?: string; position?: { x: number; y: number }; x?: number; y?: number; width?: number; height?: number; metadata?: CanvasNodeMetadata }
    | { type: "update_node"; id: string; patch?: Partial<CanvasNodeData>; metadata?: CanvasNodeMetadata }
    | { type: "delete_node"; id?: string; ids?: string[]; nodeType?: CanvasNodeType }
    | { type: "delete_connections"; id?: string; ids?: string[]; all?: boolean }
    | { type: "connect_nodes"; id?: string; fromNodeId: string; toNodeId: string }
    | { type: "set_viewport"; viewport: ViewportTransform }
    | { type: "select_nodes"; ids: string[] }
    | { type: "run_generation"; nodeId: string; mode?: "text" | "image" | "video" | "audio"; prompt?: string };

export type CanvasAgentSnapshot = {
    projectId: string;
    title: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: string[];
    viewport: ViewportTransform;
};

function isLegalStatus(status: unknown): status is NodeStatus {
    return typeof status === "string" && (NODE_STATUSES as readonly string[]).includes(status);
}

/**
 * 净化 Agent 写进 metadata.toonflow 的内容。Agent 侧的工具入参是自由 record，浅合并会原样落库，
 * 2026-07-27 实测与 Codex 对抗审查各暴露一处：
 *
 * 1. 状态可以是七态之外的任意字符串（收到过 "ready"）→ 状态徽章渲染成空白，状态机守卫行为未定义。
 *    非法值保留节点原状态：Agent 的本意通常只是改内容，不该顺带把节点状态打乱。
 * 2. Agent 常只传 `{ toonflow: { status } }` 这样的部分对象，浅合并会拿它整个替换掉原 toonflow，
 *    kind/stage/summary/checks 全丢 → 这里以原 toonflow 打底再覆盖。
 * 3. 原节点根本不是 Toonflow 节点时，一个残缺的 toonflow 字段会把普通节点污染成缺 kind 的
 *    半吊子环节节点 → 没有 kind 就整个丢弃该字段，宁可不写也不写坏。
 */
function sanitizeToonflowMetadata(previous: CanvasNodeData | undefined, next: CanvasNodeData): CanvasNodeData {
    const incoming = next.metadata?.toonflow;
    if (!incoming) return next;
    const previousToonflow = previous?.metadata?.toonflow;
    const merged = { ...previousToonflow, ...incoming };
    if (!merged.kind) {
        const { toonflow: _dropped, ...metadata } = next.metadata ?? {};
        return { ...next, metadata };
    }
    const status = isLegalStatus(merged.status) ? merged.status : isLegalStatus(previousToonflow?.status) ? previousToonflow.status : migrateToonflowStatus(String(merged.status ?? ""));
    return { ...next, metadata: { ...next.metadata, toonflow: { ...merged, status } } };
}

/**
 * Agent 改写 Toonflow 节点正文时，把新正文同步进文本产物并升版本。
 *
 * Agent 走 canvas_update 只能写 metadata.content（它构造不出完整 output 结构），而节点显示与下游取数
 * 都以 output.payload.text 优先，不同步的话画布仍显示旧正文、下游读到的也是旧产物，Agent 改了等于没改
 * （Codex 对抗审查 2026-07-27："画布仍显示旧正文，用户仍会判断 Agent 修改未生效"）。
 *
 * 只处理已有**文本**产物的节点：分镜表/锁定表/继承表的产物是结构化数据，拿一段散文替换掉表格只会更糟；
 * 正文没变时不升版本，否则 Agent 每次读写都会制造新版本、把下游反复冲成 stale。
 */
function syncAuthoredContentIntoOutput(previous: CanvasNodeData, next: CanvasNodeData): { node: CanvasNodeData; bumped: boolean } {
    const toonflow = next.metadata?.toonflow;
    const output = toonflow?.output;
    const content = next.metadata?.content?.trim();
    if (!toonflow || !output || typeof output.payload.text !== "string") return { node: next, bumped: false };
    if (!content || content === previous.metadata?.content?.trim() || content === output.payload.text.trim()) return { node: next, bumped: false };
    const synced: typeof output = { ...output, version: output.version + 1, payload: { ...output.payload, text: content }, generatedAt: new Date().toISOString() };
    return { node: { ...next, metadata: { ...next.metadata, toonflow: { ...toonflow, output: synced } } }, bumped: true };
}

export function summarizeCanvasAgentOps(ops?: CanvasAgentOp[]) {
    const counts = (Array.isArray(ops) ? ops : []).reduce<Record<string, number>>((acc, op) => {
        if (!op?.type) return acc;
        acc[op.type] = (acc[op.type] || 0) + 1;
        return acc;
    }, {});
    return Object.entries(counts)
        .map(([type, count]) => `${opLabel(type)} ${count}`)
        .join("，");
}

export function applyCanvasAgentOps(snapshot: CanvasAgentSnapshot, ops?: CanvasAgentOp[]) {
    let nodes = snapshot.nodes;
    let connections = snapshot.connections;
    let selectedNodeIds = snapshot.selectedNodeIds;
    let viewport = snapshot.viewport;
    const bumpedNodeIds: string[] = [];

    (Array.isArray(ops) ? ops : []).forEach((op, index) => {
        if (!op?.type) return;
        if (op.type === "add_node") {
            const nodeType = Object.values(CanvasNodeType).includes(op.nodeType as CanvasNodeType) ? op.nodeType! : CanvasNodeType.Text;
            const spec = getNodeSpec(nodeType);
            const node: CanvasNodeData = {
                id: op.id || `${nodeType}-${Date.now()}-${index}`,
                type: nodeType,
                title: op.title || spec.title,
                position: op.position || { x: op.x ?? index * 36, y: op.y ?? index * 36 },
                width: op.width || spec.width,
                height: op.height || spec.height,
                metadata: { ...spec.metadata, ...op.metadata },
            };
            // 新建同样要净化：不走这一步的话 Agent 建节点时塞的非法状态会原样落库（Codex 对抗审查 2026-07-27 实锤）。
            nodes = [...nodes, sanitizeToonflowMetadata(undefined, node)];
            selectedNodeIds = [node.id];
        }
        if (op.type === "update_node") {
            if (!op.id) return;
            nodes = nodes.map((node) => {
                if (node.id !== op.id) return node;
                const merged = sanitizeToonflowMetadata(node, { ...node, ...op.patch, metadata: { ...node.metadata, ...op.patch?.metadata, ...op.metadata } });
                const { node: synced, bumped } = syncAuthoredContentIntoOutput(node, merged);
                if (bumped) bumpedNodeIds.push(node.id);
                return synced;
            });
        }
        if (op.type === "delete_node") {
            const ids = new Set(op.ids || (op.id ? [op.id] : op.nodeType ? nodes.filter((node) => node.type === op.nodeType).map((node) => node.id) : []));
            nodes = nodes.filter((node) => !ids.has(node.id));
            connections = connections.filter((conn) => !ids.has(conn.fromNodeId) && !ids.has(conn.toNodeId));
            selectedNodeIds = selectedNodeIds.filter((id) => !ids.has(id));
        }
        if (op.type === "delete_connections") {
            const ids = new Set(op.ids || (op.id ? [op.id] : []));
            connections = op.all ? [] : connections.filter((conn) => !ids.has(conn.id));
        }
        if (op.type === "connect_nodes") {
            if (!op.fromNodeId || !op.toNodeId) return;
            const exists = connections.some((conn) => conn.fromNodeId === op.fromNodeId && conn.toNodeId === op.toNodeId);
            const hasNodes = nodes.some((node) => node.id === op.fromNodeId) && nodes.some((node) => node.id === op.toNodeId);
            if (!exists && hasNodes) connections = [...connections, { id: op.id || nanoid(), fromNodeId: op.fromNodeId, toNodeId: op.toNodeId }];
        }
        if (op.type === "set_viewport" && op.viewport) viewport = op.viewport;
        if (op.type === "select_nodes") selectedNodeIds = (op.ids || []).filter((id) => nodes.some((node) => node.id === id));
    });

    // 正文同步造出的新版本要走一次失效传播,否则下游会继续拿旧产物当有效输入。
    for (const id of bumpedNodeIds) nodes = propagateAfterNewVersion(nodes, connections, id);

    return { ...snapshot, nodes, connections, selectedNodeIds, viewport };
}

function opLabel(type: string) {
    if (type === "add_node") return "新增节点";
    if (type === "update_node") return "更新节点";
    if (type === "delete_node") return "删除节点";
    if (type === "delete_connections") return "删除连线";
    if (type === "connect_nodes") return "连接";
    if (type === "set_viewport") return "调整视图";
    if (type === "select_nodes") return "选择节点";
    if (type === "run_generation") return "触发生成";
    return type;
}
