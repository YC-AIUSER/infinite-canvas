import { z } from "zod";

import type { CanvasConnection, CanvasNodeData, ToonflowNodeKind } from "../../types/canvas";

import {
    buildActionContractPrompt,
    buildNodeContext,
    buildScriptPrompt,
    buildShotContractPrompt,
    buildSpaceContractPrompt,
    buildStoryboardTablePrompt,
    washPrompt,
} from "./prompts";
import { NODE_STATUSES, StoryboardRowSchema, VERSION_LIMIT_TEXT, migrateToonflowStatus, parseModelJson, type NodeOutput, type NodeStatus, type StoryboardRow } from "./schema";
import { assignIds, validateSegmentRows } from "./segments";
import { approveNode, nextStatusOnGenerate, onGenerateFailure, onGenerateSuccess, propagateStale, rollbackToVersion, saveEditedNode, type GraphNode } from "./state-machine";

type GeneratableToonflowKind = "script" | "space-contract" | "storyboard-table" | "shot-contract" | "action-contract";
type WashHit = { term: string; replacement: string };

const PROMPT_BUILDERS: Record<GeneratableToonflowKind, (context: string) => string> = {
    script: buildScriptPrompt,
    "space-contract": buildSpaceContractPrompt,
    "storyboard-table": buildStoryboardTablePrompt,
    "shot-contract": buildShotContractPrompt,
    "action-contract": buildActionContractPrompt,
};

const GENERATABLE_KINDS: ReadonlySet<ToonflowNodeKind> = new Set(Object.keys(PROMPT_BUILDERS) as GeneratableToonflowKind[]);
const NODE_STATUS_SET: ReadonlySet<string> = new Set(NODE_STATUSES);

function isGeneratableKind(kind: ToonflowNodeKind): kind is GeneratableToonflowKind {
    return GENERATABLE_KINDS.has(kind);
}

function readNodeInput(node: CanvasNodeData) {
    const payload = node.metadata?.toonflow?.output?.payload;
    if (payload?.text) return payload.text;
    if (payload?.table) return JSON.stringify(payload.table, null, 2);
    return node.metadata?.content?.trim() || node.metadata?.prompt?.trim() || "";
}

function collectUpstreamNodeIds(connections: CanvasConnection[], nodeId: string) {
    const upstreamByNodeId = new Map<string, string[]>();
    for (const connection of connections) {
        const upstream = upstreamByNodeId.get(connection.toNodeId);
        if (upstream) upstream.push(connection.fromNodeId);
        else upstreamByNodeId.set(connection.toNodeId, [connection.fromNodeId]);
    }

    const result: string[] = [];
    const visited = new Set<string>([nodeId]);
    const queue = [...(upstreamByNodeId.get(nodeId) ?? [])];
    for (let index = 0; index < queue.length; index += 1) {
        const upstreamId = queue[index];
        if (visited.has(upstreamId)) continue;
        visited.add(upstreamId);
        result.push(upstreamId);
        queue.push(...(upstreamByNodeId.get(upstreamId) ?? []));
    }
    return result;
}

function appendInput(inputs: Record<string, string>, key: string, content: string) {
    if (!content) return;
    inputs[key] = inputs[key] ? `${inputs[key]}\n\n${content}` : content;
}

function existingStoryboardIds(node: CanvasNodeData) {
    const rows = node.metadata?.toonflow?.output?.payload.table;
    if (!rows?.length) return "";
    return rows.map((row) => `${row.segmentId}/${row.shotId}`).join("\n");
}

export function buildToonflowGeneration(nodes: CanvasNodeData[], connections: CanvasConnection[], nodeId: string) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const target = nodeById.get(nodeId);
    const kind = target?.metadata?.toonflow?.kind;
    if (!target || !kind || !isGeneratableKind(kind)) {
        throw new Error("当前节点不支持 Toonflow 文本生成");
    }

    const inputs: Record<string, string> = {};
    for (const upstreamId of collectUpstreamNodeIds(connections, nodeId)) {
        const upstream = nodeById.get(upstreamId);
        if (!upstream) continue;
        const inputKey = upstream.metadata?.toonflow?.kind || "source";
        appendInput(inputs, inputKey, readNodeInput(upstream));
    }

    if (kind === "storyboard-table") {
        appendInput(inputs, "existing-ids", existingStoryboardIds(target));
    }

    const prompt = PROMPT_BUILDERS[kind](buildNodeContext(kind, inputs));
    const { washed, hits } = washPrompt(prompt);
    return { finalPrompt: washed, washHits: hits };
}

function generationMeta(node: CanvasNodeData, _washHits: WashHit[]) {
    const sentPrompt = node.metadata?.prompt || "";
    return {
        model: node.metadata?.model || "",
        provider: "canvas-text-service",
        sentPrompt,
        washedPrompt: sentPrompt,
    };
}

function failedGenerationNode(node: CanvasNodeData, error: string, washHits: WashHit[]): CanvasNodeData {
    const toonflow = node.metadata?.toonflow;
    if (!toonflow) return node;
    const previous = toonflow.output;
    const output: NodeOutput = {
        nodeId: node.id,
        kind: toonflow.kind,
        version: previous?.version ?? 0,
        status: onGenerateFailure(toonflow.status),
        payload: previous?.payload ?? {},
        upstreamVersions: previous?.upstreamVersions ?? {},
        generationMeta: generationMeta(node, washHits),
        error,
        generatedAt: new Date().toISOString(),
    };
    return {
        ...node,
        metadata: {
            ...node.metadata,
            errorDetails: error,
            toonflow: { ...toonflow, status: output.status, output },
        },
    };
}

export function applyGenerationFailure(node: CanvasNodeData, error: string): CanvasNodeData {
    return failedGenerationNode(node, error, []);
}

/** 采集直接上游 toonflow 节点的当前版本快照——写入本次产出的 upstreamVersions,供版本守卫与"沿用旧产出"判定。 */
export function computeUpstreamVersions(nodes: CanvasNodeData[], connections: CanvasConnection[], nodeId: string): Record<string, number> {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const snapshot: Record<string, number> = {};
    for (const connection of connections) {
        if (connection.toNodeId !== nodeId) continue;
        const upstream = nodeById.get(connection.fromNodeId);
        const version = upstream?.metadata?.toonflow?.output?.version;
        if (typeof version === "number") snapshot[connection.fromNodeId] = version;
    }
    return snapshot;
}

/**
 * shotNo 归一化:模型经常无视"段内从 1 编号"的指令(实测两轮均全局连续编号)。
 * 编号是确定性工作,不赌模型服从——解析后按段内出现顺序重写 1..N;
 * 校验里的 shotNo 规则保留,作为本函数之后的不变量守卫。
 */
function normalizeShotNumbers(rows: StoryboardRow[]): StoryboardRow[] {
    const counters = new Map<string, number>();
    return rows.map((row) => {
        const nextNo = (counters.get(row.segmentId) ?? 0) + 1;
        counters.set(row.segmentId, nextNo);
        return row.shotNo === nextNo ? row : { ...row, shotNo: nextNo };
    });
}

export function applyGenerationSuccess(node: CanvasNodeData, rawText: string, washHits: WashHit[], upstreamVersions?: Record<string, number>): CanvasNodeData {
    const toonflow = node.metadata?.toonflow;
    if (!toonflow || !isGeneratableKind(toonflow.kind)) return node;

    let payload: NodeOutput["payload"] = { text: rawText };
    if (toonflow.kind === "storyboard-table") {
        const parsed = parseModelJson(z.array(StoryboardRowSchema), rawText);
        if (!parsed.ok) return failedGenerationNode(node, parsed.error, washHits);
        const assigned = assignIds(parsed.data);
        assigned.rows = normalizeShotNumbers(assigned.rows);
        const errors = validateSegmentRows(assigned.rows).filter((issue) => !issue.warning);
        if (errors.length) return failedGenerationNode(node, errors.map((issue) => issue.message).join("；"), washHits);
        payload = { table: assigned.rows };
    }

    const previous = toonflow.output;
    const output: NodeOutput = {
        nodeId: node.id,
        kind: toonflow.kind,
        version: (previous?.version ?? 0) + 1,
        status: onGenerateSuccess(toonflow.status),
        payload,
        upstreamVersions: upstreamVersions ?? previous?.upstreamVersions ?? {},
        generationMeta: generationMeta(node, washHits),
        generatedAt: new Date().toISOString(),
    };
    const history = previous ? [...(toonflow.history ?? []), previous].slice(-VERSION_LIMIT_TEXT) : toonflow.history;

    return {
        ...node,
        metadata: {
            ...node.metadata,
            content: rawText,
            status: "success" as const,
            errorDetails: undefined,
            toonflow: { ...toonflow, status: output.status, output, history },
        },
    };
}

function graphNodes(nodes: CanvasNodeData[]): GraphNode[] {
    return nodes.flatMap((node) => {
        const toonflow = node.metadata?.toonflow;
        if (!toonflow) return [];
        return [
            {
                nodeId: node.id,
                status: toonflow.status,
                version: toonflow.output?.version ?? 0,
                upstreamVersions: toonflow.output?.upstreamVersions ?? {},
                skipped: toonflow.status === "skipped",
            },
        ];
    });
}

function graphEdges(connections: CanvasConnection[]) {
    return connections.map((connection) => ({ from: connection.fromNodeId, to: connection.toNodeId }));
}

export function applyApprove(nodes: CanvasNodeData[], _connections: CanvasConnection[], nodeId: string): CanvasNodeData[] {
    return nodes.map<CanvasNodeData>((node) => {
        const metadata = node.metadata;
        const toonflow = metadata?.toonflow;
        const currentOutput = toonflow?.output;
        if (node.id !== nodeId || !metadata || !toonflow || !currentOutput) return node;
        const result = approveNode(currentOutput);
        return {
            ...node,
            metadata: {
                ...metadata,
                toonflow: { ...toonflow, status: result.next.status, output: result.next },
            },
        };
    });
}

/**
 * 进入生成态。注意:此处不做失效传播——传播的触发事件是"新版本产生"
 * (生成成功后由 propagateAfterNewVersion 执行),点击重生成时下游不受影响,
 * 生成失败也不会误标下游(design doc 状态机语义)。
 */
export function applyRegenerate(nodes: CanvasNodeData[], _connections: CanvasConnection[], nodeId: string): CanvasNodeData[] {
    const target = nodes.find((node) => node.id === nodeId);
    const toonflow = target?.metadata?.toonflow;
    if (!target || !toonflow) return nodes;

    const status = nextStatusOnGenerate(toonflow.status);

    return nodes.map((node) => {
        const nodeToonflow = node.metadata?.toonflow;
        if (!nodeToonflow || node.id !== nodeId) return node;
        return {
            ...node,
            metadata: {
                ...node.metadata,
                status: "loading" as const,
                errorDetails: undefined,
                toonflow: { ...nodeToonflow, status },
            },
        };
    });
}

/**
 * 新版本产生后(生成成功进入 review)执行失效传播:
 * 按 BFS+版本守卫把下游标 stale(快照已含新版本者豁免并断支,skipped 穿透)。
 */
export function propagateAfterNewVersion(nodes: CanvasNodeData[], connections: CanvasConnection[], nodeId: string): CanvasNodeData[] {
    const target = nodes.find((node) => node.id === nodeId);
    const newVersion = target?.metadata?.toonflow?.output?.version;
    if (typeof newVersion !== "number" || newVersion <= 0) return nodes;

    const staleNodeIds = new Set(propagateStale(graphNodes(nodes), graphEdges(connections), nodeId, newVersion));
    if (!staleNodeIds.size) return nodes;

    return nodes.map((node) => {
        const nodeToonflow = node.metadata?.toonflow;
        if (!nodeToonflow || !staleNodeIds.has(node.id)) return node;
        return {
            ...node,
            metadata: {
                ...node.metadata,
                toonflow: {
                    ...nodeToonflow,
                    status: "stale",
                    output: nodeToonflow.output ? { ...nodeToonflow.output, status: "stale" } : undefined,
                },
            },
        };
    });
}

function hydratedStatus(status: unknown): NodeStatus {
    if (typeof status === "string" && NODE_STATUS_SET.has(status)) return status as NodeStatus;
    return migrateToonflowStatus(typeof status === "string" ? status : "");
}

export function hydrateToonflowProject(nodes: CanvasNodeData[]) {
    return nodes.map((node) => {
        const toonflow = node.metadata?.toonflow;
        if (!toonflow) return node;
        // 页面刷新/崩溃时 generating 无法恢复(文本生成无 provider taskId),降级为 failed 可重试。
        const migrated = hydratedStatus(toonflow.status);
        const status = migrated === "generating" ? "failed" : migrated;
        if (status === toonflow.status) return node;
        return {
            ...node,
            metadata: {
                ...node.metadata,
                errorDetails: status === "failed" && migrated === "generating" ? "生成被中断(页面已刷新),请重试" : node.metadata?.errorDetails,
                toonflow: { ...toonflow, status },
            },
        };
    });
}

function appendTextHistory(history: NodeOutput[] | undefined, output: NodeOutput) {
    return [...(history ?? []), output].slice(-VERSION_LIMIT_TEXT);
}

function payloadContent(payload: NodeOutput["payload"]) {
    if (typeof payload.text === "string") return payload.text;
    if (payload.table) return JSON.stringify(payload.table, null, 2);
    return "";
}

export function applyEditSave(nodes: CanvasNodeData[], connections: CanvasConnection[], nodeId: string, newText: string): CanvasNodeData[] {
    const target = nodes.find((node) => node.id === nodeId);
    const toonflow = target?.metadata?.toonflow;
    const currentOutput = toonflow?.output;
    if (!target || !toonflow || toonflow.kind === "storyboard-table" || toonflow.status !== "approved" || currentOutput?.status !== "approved" || typeof currentOutput.payload.text !== "string") return nodes;

    const edited = saveEditedNode(currentOutput).next;
    const output: NodeOutput = {
        ...edited,
        payload: { ...edited.payload, text: newText },
        upstreamVersions: computeUpstreamVersions(nodes, connections, nodeId),
        generatedAt: new Date().toISOString(),
    };
    const next = nodes.map<CanvasNodeData>((node) =>
        node.id === nodeId
            ? {
                  ...node,
                  metadata: {
                      ...node.metadata,
                      content: newText,
                      status: "success",
                      errorDetails: undefined,
                      toonflow: { ...toonflow, status: output.status, output, history: appendTextHistory(toonflow.history, currentOutput) },
                  },
              }
            : node,
    );
    return propagateAfterNewVersion(next, connections, nodeId);
}

export function applyRollback(nodes: CanvasNodeData[], connections: CanvasConnection[], nodeId: string, targetVersion: number): CanvasNodeData[] {
    const target = nodes.find((node) => node.id === nodeId);
    const toonflow = target?.metadata?.toonflow;
    const currentOutput = toonflow?.output;
    const historical = toonflow?.history?.find((output) => output.version === targetVersion);
    if (!target || !toonflow || !currentOutput || !historical) return nodes;

    const output: NodeOutput = { ...rollbackToVersion(currentOutput, historical).next, generatedAt: new Date().toISOString() };
    const next = nodes.map<CanvasNodeData>((node) =>
        node.id === nodeId
            ? {
                  ...node,
                  metadata: {
                      ...node.metadata,
                      content: payloadContent(output.payload),
                      status: "success",
                      errorDetails: undefined,
                      toonflow: { ...toonflow, status: output.status, output, history: appendTextHistory(toonflow.history, currentOutput) },
                  },
              }
            : node,
    );
    return propagateAfterNewVersion(next, connections, nodeId);
}

export function applyAdoptStale(nodes: CanvasNodeData[], connections: CanvasConnection[], nodeId: string): CanvasNodeData[] {
    const target = nodes.find((node) => node.id === nodeId);
    const toonflow = target?.metadata?.toonflow;
    const currentOutput = toonflow?.output;
    if (!target || !toonflow || toonflow.status !== "stale" || currentOutput?.status !== "stale") return nodes;

    const output: NodeOutput = {
        ...currentOutput,
        status: "approved",
        upstreamVersions: computeUpstreamVersions(nodes, connections, nodeId),
    };
    return nodes.map<CanvasNodeData>((node) =>
        node.id === nodeId
            ? {
                  ...node,
                  metadata: {
                      ...node.metadata,
                      status: "success",
                      errorDetails: undefined,
                      toonflow: { ...toonflow, status: "approved", output },
                  },
              }
            : node,
    );
}

export function approveChain(nodes: CanvasNodeData[], connections: CanvasConnection[], rootIds?: string | string[]) {
    const selectedIds = rootIds === undefined ? null : new Set(Array.isArray(rootIds) ? rootIds : [rootIds]);
    let next = nodes;
    let approvedCount = 0;

    for (const node of nodes) {
        const toonflow = node.metadata?.toonflow;
        if (selectedIds && !selectedIds.has(node.id)) continue;
        if (!toonflow || !isGeneratableKind(toonflow.kind) || toonflow.status !== "review" || toonflow.output?.status !== "review") continue;
        next = applyApprove(next, connections, node.id);
        approvedCount += 1;
    }

    return { nodes: next, approvedCount };
}

/**
 * 文本级联子图。Toonflow 模板是一条线性链,文本节点之间夹着非文本节点
 * (如 剧本→资产库(图像)→空间合同):直接丢弃非文本节点会把链剪断,
 * 因此过滤时必须**桥接**——从每个文本节点向下穿过任意非文本节点,
 * 直到抵达下一个文本节点,补一条 from→to 的直连边。
 *
 *   script ─→ [assets] ─→ space ─→ table        原图
 *   script ────────────→ space ─→ table         桥接后
 */
export function buildTextCascadeGraph(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const textNodes = nodes.filter((node) => {
        const kind = node.metadata?.toonflow?.kind;
        return kind ? isGeneratableKind(kind) : false;
    });
    const nodeIds = new Set(textNodes.map((node) => node.id));
    const kinds: Record<string, ToonflowNodeKind> = {};
    for (const node of textNodes) {
        kinds[node.id] = node.metadata!.toonflow!.kind;
    }

    const childrenByNodeId = new Map<string, string[]>();
    for (const connection of connections) {
        const children = childrenByNodeId.get(connection.fromNodeId);
        if (children) children.push(connection.toNodeId);
        else childrenByNodeId.set(connection.fromNodeId, [connection.toNodeId]);
    }

    const edges: Array<{ from: string; to: string }> = [];
    for (const textNode of textNodes) {
        const visited = new Set<string>([textNode.id]);
        const queue = [...(childrenByNodeId.get(textNode.id) ?? [])];
        for (let index = 0; index < queue.length; index += 1) {
            const currentId = queue[index];
            if (visited.has(currentId)) continue;
            visited.add(currentId);
            if (nodeIds.has(currentId)) {
                edges.push({ from: textNode.id, to: currentId });
                continue; // 抵达下一个文本节点即停,不穿透它继续(它自己会桥接自己的下游)
            }
            queue.push(...(childrenByNodeId.get(currentId) ?? []));
        }
    }

    return { nodes: graphNodes(textNodes), edges, kinds };
}
