import { redlineForKind, TOONFLOW_METHODOLOGY_BRIEF } from "./config.js";
import { compactCanvasState, compactNode } from "./tools.js";
import type { CanvasNode, CanvasSnapshot } from "./types.js";

export function toonflowKindOf(node: CanvasNode | undefined): string | undefined {
    const tf = node?.metadata?.toonflow as { kind?: unknown } | undefined;
    return tf && typeof tf.kind === "string" ? tf.kind : undefined;
}

function attach<T>(result: T, methodology: string): T {
    // 数组结果不能 spread 进对象字面量(会退化成带数字键的对象),连同 null/原始值一并原样返回。
    if (result === null || typeof result !== "object" || Array.isArray(result)) return result;
    return { ...(result as object), _methodology: methodology } as T;
}

export function annotateMethodology<T>(result: T, kinds: Array<string | undefined>): T {
    const present = kinds.filter((kind): kind is string => Boolean(kind));
    if (!present.length) return result;
    // 按解析后的红线文本去重(多个回落 kind 都指向全局 brief,不能重复堆同一段)。
    const lines = [...new Set(present.map((kind) => redlineForKind(kind)))];
    return attach(result, `⚠ 你正在操作 Toonflow 环节，必须守方法论：\n${lines.join("\n")}`);
}

export function toonflowKindsForOps(ops: unknown, nodes: CanvasNode[]): Array<string | undefined> {
    if (!Array.isArray(ops)) return [];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const ids: string[] = [];
    for (const op of ops) {
        if (!op || typeof op !== "object") continue;
        const record = op as Record<string, unknown>;
        if (typeof record.id === "string") ids.push(record.id);
        if (typeof record.nodeId === "string") ids.push(record.nodeId);
        if (typeof record.fromNodeId === "string") ids.push(record.fromNodeId);
        if (typeof record.toNodeId === "string") ids.push(record.toNodeId);
        if (Array.isArray(record.ids)) for (const id of record.ids) if (typeof id === "string") ids.push(id);
    }
    return ids.map((id) => toonflowKindOf(byId.get(id)));
}

export function buildSelectionResult(state: CanvasSnapshot | null) {
    const ids = new Set(state?.selectedNodeIds || []);
    const selected = (state?.nodes || []).filter((node) => ids.has(node.id));
    return annotateMethodology({ nodes: selected.map(compactNode) }, selected.map(toonflowKindOf));
}

export function buildStateResult(state: CanvasSnapshot | null) {
    const result = compactCanvasState(state);
    const count = (state?.nodes || []).filter((node) => toonflowKindOf(node)).length;
    if (!count) return result;
    return attach(
        result,
        `画布含 ${count} 个 Toonflow 环节。${TOONFLOW_METHODOLOGY_BRIEF} 改某环节前用 canvas_get_selection 取该环节红线。`,
    );
}
