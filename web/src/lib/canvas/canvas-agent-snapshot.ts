import type { CanvasNodeData, CanvasNodeMetadata, ToonflowNodeMetadata } from "@/types/canvas";

import type { CanvasAgentSnapshot } from "./canvas-agent-ops";

export const CANVAS_AGENT_TEXT_LIMIT = 200;

export function serializeCanvasAgentSnapshot(snapshot: CanvasAgentSnapshot, fullNodeIds: string[] = []): CanvasAgentSnapshot {
    const fullIds = new Set(fullNodeIds);
    return {
        projectId: snapshot.projectId,
        title: snapshot.title,
        nodes: snapshot.nodes.map((node) => (fullIds.has(node.id) ? replaceDataUrls(node) : compactNode(node))),
        connections: snapshot.connections,
        selectedNodeIds: snapshot.selectedNodeIds,
        viewport: snapshot.viewport,
    };
}

function compactNode(node: CanvasNodeData): CanvasNodeData {
    return {
        id: node.id,
        type: node.type,
        title: node.title,
        position: node.position,
        width: node.width,
        height: node.height,
        metadata: compactMetadata(node.metadata),
    };
}

function compactMetadata(metadata?: CanvasNodeMetadata): CanvasNodeMetadata | undefined {
    if (!metadata) return undefined;
    return definedRecord<CanvasNodeMetadata>({
        content: compactText(metadata.content),
        status: metadata.status,
        prompt: replaceDataUrls(metadata.prompt),
        model: metadata.model,
        storageKey: metadata.storageKey,
        groupId: metadata.groupId,
        projectionOf: metadata.projectionOf,
        cardProjection: metadata.cardProjection,
        toonflow: compactToonflow(metadata.toonflow),
    });
}

function compactToonflow(toonflow?: ToonflowNodeMetadata): ToonflowNodeMetadata | undefined {
    if (!toonflow) return undefined;
    return definedRecord<ToonflowNodeMetadata>({
        kind: toonflow.kind,
        stage: toonflow.stage,
        status: toonflow.status,
        summary: replaceDataUrls(toonflow.summary),
        segmentId: toonflow.segmentId,
        segmentIndex: toonflow.segmentIndex,
        archived: toonflow.archived,
        outputs: replaceDataUrls(toonflow.outputs),
        output: toonflow.output ? { ...replaceDataUrls(toonflow.output), payload: compactPayload(toonflow.output.payload) } : undefined,
    });
}

function compactText(value?: string) {
    if (value === undefined) return undefined;
    if (value.startsWith("data:")) return dataUrlPlaceholder(value);
    return value.length > CANVAS_AGENT_TEXT_LIMIT ? `${value.slice(0, CANVAS_AGENT_TEXT_LIMIT)}…(共 ${value.length} 字)` : value;
}

function compactPayload<T>(value: T): T {
    if (typeof value === "string") return compactText(value) as T;
    if (Array.isArray(value)) return value.map(compactPayload) as T;
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, compactPayload(item)])) as T;
    return value;
}

function replaceDataUrls<T>(value: T): T {
    if (typeof value === "string") return (value.startsWith("data:") ? dataUrlPlaceholder(value) : value) as T;
    if (Array.isArray(value)) return value.map(replaceDataUrls) as T;
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceDataUrls(item)])) as T;
    return value;
}

function dataUrlPlaceholder(value: string) {
    return `[内联 dataURL 已省略，共 ${value.length} 字；请使用 storageKey 获取资源]`;
}

function definedRecord<T extends object>(value: Partial<T>): T {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
