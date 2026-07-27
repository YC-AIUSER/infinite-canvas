import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

import { CANVAS_AGENT_TEXT_LIMIT, serializeCanvasAgentSnapshot } from "../canvas-agent-snapshot";
import type { CanvasAgentSnapshot } from "../canvas-agent-ops";

const longText = "长".repeat(CANVAS_AGENT_TEXT_LIMIT + 37);
const dataUrl = `data:image/png;base64,${"A".repeat(300)}`;

function node(id: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Text,
        title: `节点 ${id}`,
        position: { x: 12, y: 34 },
        width: 320,
        height: 240,
        metadata: {
            content: longText,
            composerContent: "默认快照不应保留",
            prompt: "保留提示词",
            status: "success",
            model: "test-model",
            storageKey: `canvas/${id}`,
            groupId: "group-1",
            projectionOf: { stageNodeId: "stage-1", kind: "assets" },
            cardProjection: { stageNodeId: "stage-1", cardId: "card-1" },
            toonflow: {
                kind: "script",
                stage: "剧本",
                status: "approved",
                summary: "摘要",
                checks: ["默认快照不应保留"],
                segmentId: "segment-1",
                segmentIndex: 1,
                archived: false,
                outputs: ["output-1", dataUrl],
                output: {
                    nodeId: id,
                    kind: "script",
                    version: 2,
                    status: "approved",
                    payload: { text: longText, nested: { image: dataUrl } },
                    upstreamVersions: { source: 1 },
                    generatedAt: "2026-07-26T00:00:00.000Z",
                } as NonNullable<CanvasNodeData["metadata"]>["toonflow"] extends infer T
                    ? T extends { output?: infer O }
                        ? O
                        : never
                    : never,
                history: [
                    {
                        nodeId: id,
                        kind: "script",
                        version: 1,
                        status: "approved",
                        payload: { text: "历史版本" },
                        upstreamVersions: {},
                        generatedAt: "2026-07-25T00:00:00.000Z",
                    },
                ],
                washReport: { hits: [{ term: "旧词", replacement: "新词" }], at: "2026-07-26T00:00:00.000Z" },
            },
        },
    };
}

function snapshot(): CanvasAgentSnapshot {
    return {
        projectId: "project-1",
        title: "真实 Toonflow 画布样本",
        nodes: [node("compact"), node("full")],
        connections: [{ id: "connection-1", fromNodeId: "compact", toNodeId: "full" }],
        selectedNodeIds: ["compact"],
        viewport: { x: 100, y: 200, k: 0.8 },
    };
}

describe("serializeCanvasAgentSnapshot", () => {
    it("保留画布与节点结构字段以及指定 metadata 字段", () => {
        const result = serializeCanvasAgentSnapshot(snapshot());
        expect(result).toMatchObject({
            projectId: "project-1",
            title: "真实 Toonflow 画布样本",
            connections: [{ id: "connection-1", fromNodeId: "compact", toNodeId: "full" }],
            selectedNodeIds: ["compact"],
            viewport: { x: 100, y: 200, k: 0.8 },
        });
        expect(result.nodes[0]).toMatchObject({ id: "compact", type: "text", title: "节点 compact", position: { x: 12, y: 34 }, width: 320, height: 240 });
        expect(result.nodes[0].metadata).toMatchObject({
            status: "success",
            prompt: "保留提示词",
            model: "test-model",
            storageKey: "canvas/compact",
            groupId: "group-1",
            projectionOf: { stageNodeId: "stage-1", kind: "assets" },
            cardProjection: { stageNodeId: "stage-1", cardId: "card-1" },
            toonflow: { kind: "script", stage: "剧本", status: "approved", summary: "摘要", segmentId: "segment-1", segmentIndex: 1, archived: false },
        });
    });

    it("截断长文本并标注原始长度，同时剔除 history 与 washReport", () => {
        const metadata = serializeCanvasAgentSnapshot(snapshot()).nodes[0].metadata!;
        expect(metadata.content).toBe(`${"长".repeat(CANVAS_AGENT_TEXT_LIMIT)}…(共 ${longText.length} 字)`);
        expect(metadata.toonflow?.output?.payload.text).toBe(`${"长".repeat(CANVAS_AGENT_TEXT_LIMIT)}…(共 ${longText.length} 字)`);
        expect(metadata.toonflow).not.toHaveProperty("history");
        expect(metadata.toonflow).not.toHaveProperty("washReport");
        expect(metadata).not.toHaveProperty("composerContent");
    });

    it("递归替换内联 dataURL 并保留 storageKey", () => {
        const metadata = serializeCanvasAgentSnapshot(snapshot()).nodes[0].metadata!;
        expect(metadata.storageKey).toBe("canvas/compact");
        expect(metadata.toonflow?.outputs?.[1]).toContain("内联 dataURL 已省略");
        expect((metadata.toonflow?.output?.payload as Record<string, { image: string }>).nested.image).toContain("内联 dataURL 已省略");
        expect(JSON.stringify(metadata)).not.toContain("data:image/png;base64");
    });

    it("nodeIds 指定节点返回完整未截断数据，其他节点仍保持精简", () => {
        const result = serializeCanvasAgentSnapshot(snapshot(), ["full"]);
        expect(result.nodes[0].metadata?.content).toContain(`…(共 ${longText.length} 字)`);
        expect(result.nodes[1].metadata?.content).toBe(longText);
        expect(result.nodes[1].metadata?.composerContent).toBe("默认快照不应保留");
        expect(result.nodes[1].metadata?.toonflow?.history).toHaveLength(1);
        expect(result.nodes[1].metadata?.toonflow?.output?.payload.text).toBe(longText);
        expect(JSON.stringify(result.nodes[1])).not.toContain("data:image/png;base64");
    });
});
