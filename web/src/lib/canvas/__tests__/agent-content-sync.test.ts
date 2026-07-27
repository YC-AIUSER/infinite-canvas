/**
 * Codex 对抗审查 2026-07-27 疑点4 前半：节点已有文本产物时，Agent 写进 metadata.content 的新正文
 * 会被产物永久遮住——画布仍显示旧正文，下游读到的也是旧产物，Agent 改了等于没改。
 */
import { describe, expect, it } from "vitest";

import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { readNodeInput } from "@/lib/toonflow/node-runtime";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function scriptWithOutput(): CanvasNodeData {
    return {
        id: "toonflow-script", type: CanvasNodeType.Text, title: "剧本", position: { x: 0, y: 0 }, width: 320, height: 190,
        metadata: {
            content: "旧正文",
            toonflow: {
                kind: "script", stage: "内容源", status: "approved", summary: "承载原文。", checks: [],
                output: { nodeId: "toonflow-script", kind: "script", version: 3, status: "approved", payload: { text: "旧正文" }, upstreamVersions: {}, generatedAt: "2026-07-27T00:00:00.000Z" },
            },
        },
    };
}

function downstream(): CanvasNodeData {
    return {
        id: "toonflow-space-contract", type: CanvasNodeType.Text, title: "空间合同", position: { x: 400, y: 0 }, width: 320, height: 190,
        metadata: { toonflow: { kind: "space-contract", stage: "空间", status: "approved", summary: "先定点位。", checks: [], output: { nodeId: "toonflow-space-contract", kind: "space-contract", version: 1, status: "approved", payload: { text: "旧合同" }, upstreamVersions: { "toonflow-script": 3 }, generatedAt: "2026-07-27T00:00:00.000Z" } } },
    };
}

function snapshot(nodes: CanvasNodeData[]): CanvasAgentSnapshot {
    return { projectId: "p1", title: "画布", nodes, connections: [{ id: "c1", fromNodeId: "toonflow-script", toNodeId: "toonflow-space-contract" }], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
}

describe("Agent 改写已有产物节点的正文", () => {
    it("新正文要同步进产物并升版本，否则画布与下游读到的都还是旧正文", () => {
        const next = applyCanvasAgentOps(snapshot([scriptWithOutput(), downstream()]), [
            { type: "update_node", id: "toonflow-script", metadata: { content: "新正文：林晚夺回手机。" } },
        ]);
        const script = next.nodes.find((node) => node.id === "toonflow-script")!;

        expect(script.metadata?.toonflow?.output?.payload.text).toBe("新正文：林晚夺回手机。");
        expect(script.metadata?.toonflow?.output?.version).toBe(4);
        expect(readNodeInput(script)).toBe("新正文：林晚夺回手机。");
    });

    it("产物升版本后下游要跟着失效", () => {
        const next = applyCanvasAgentOps(snapshot([scriptWithOutput(), downstream()]), [
            { type: "update_node", id: "toonflow-script", metadata: { content: "新正文：林晚夺回手机。" } },
        ]);

        expect(next.nodes.find((node) => node.id === "toonflow-space-contract")?.metadata?.toonflow?.status).toBe("stale");
    });

    it("正文没变时不升版本，避免 Agent 每次读写都制造新版本", () => {
        const next = applyCanvasAgentOps(snapshot([scriptWithOutput(), downstream()]), [
            { type: "update_node", id: "toonflow-script", metadata: { content: "旧正文" } },
        ]);

        expect(next.nodes.find((node) => node.id === "toonflow-script")?.metadata?.toonflow?.output?.version).toBe(3);
        expect(next.nodes.find((node) => node.id === "toonflow-space-contract")?.metadata?.toonflow?.status).toBe("approved");
    });

    it("结构化产物（分镜表等）不做正文同步，避免把表格产物替换成散文", () => {
        const table: CanvasNodeData = {
            id: "toonflow-storyboard-table", type: CanvasNodeType.Text, title: "分镜表", position: { x: 0, y: 0 }, width: 320, height: 190,
            metadata: { content: "旧", toonflow: { kind: "storyboard-table", stage: "镜头规划", status: "approved", summary: "结构化镜头。", checks: [], output: { nodeId: "toonflow-storyboard-table", kind: "storyboard-table", version: 2, status: "approved", payload: { table: [] }, upstreamVersions: {}, generatedAt: "2026-07-27T00:00:00.000Z" } } },
        };
        const next = applyCanvasAgentOps(snapshot([table]), [{ type: "update_node", id: "toonflow-storyboard-table", metadata: { content: "散文" } }]);
        const node = next.nodes.find((item) => item.id === "toonflow-storyboard-table")!;

        expect(node.metadata?.toonflow?.output?.version).toBe(2);
        expect(node.metadata?.toonflow?.output?.payload.table).toEqual([]);
    });
});
