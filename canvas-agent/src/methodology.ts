import { redlineForKind, TOONFLOW_METHODOLOGY_BRIEF } from "./config.js";
import { compactCanvasState, compactNode } from "./tools.js";
import type { CanvasNode, CanvasSnapshot } from "./types.js";

export function toonflowKindOf(node: CanvasNode | undefined): string | undefined {
    const tf = node?.metadata?.toonflow as { kind?: unknown } | undefined;
    return tf && typeof tf.kind === "string" ? tf.kind : undefined;
}

function attach<T>(result: T, methodology: string): T {
    if (result === null || typeof result !== "object") return result;
    return { ...(result as object), _methodology: methodology } as T;
}

export function annotateMethodology<T>(result: T, kinds: Array<string | undefined>): T {
    const distinct = [...new Set(kinds.filter((kind): kind is string => Boolean(kind)))];
    if (!distinct.length) return result;
    const body = distinct.map((kind) => redlineForKind(kind)).join("\n");
    return attach(result, `⚠ 你正在操作 Toonflow 环节，必须守方法论：\n${body}`);
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
