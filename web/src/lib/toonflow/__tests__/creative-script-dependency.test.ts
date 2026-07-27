/**
 * 创意对剧本的依赖是隐式的（剧本在创意下游，连线表达不了），
 * Codex 对抗审查 2026-07-27 指出：这条依赖没进版本守卫，剧本出新版本时创意不会失效。
 */
import { describe, expect, it } from "vitest";

import { computeUpstreamVersions, propagateAfterNewVersion } from "../node-runtime";
import { buildToonflowCanvasTemplate } from "../../canvas/toonflow-canvas-template";
import type { CanvasNodeData } from "../../../types/canvas";

function withScript(version: number, text = "林晚扣住顾沉的手腕。") {
    const { nodes, connections } = buildToonflowCanvasTemplate();
    const next = nodes.map<CanvasNodeData>((node) => {
        if (node.id !== "toonflow-script") return node;
        return { ...node, metadata: { ...node.metadata, content: text, toonflow: { ...node.metadata!.toonflow!, status: "approved", output: { nodeId: node.id, kind: "script", version, status: "approved", payload: { text }, upstreamVersions: {}, generatedAt: "2026-07-27T00:00:00.000Z" } } } };
    });
    return { nodes: next, connections };
}

describe("创意 → 剧本 的隐式依赖进版本守卫", () => {
    it("创意生成时把剧本版本记进 upstreamVersions", () => {
        const { nodes, connections } = withScript(1);

        expect(computeUpstreamVersions(nodes, connections, "toonflow-creative")).toMatchObject({ "toonflow-script": 1 });
    });

    it("剧本出新版本后创意被标记为 stale", () => {
        const { nodes, connections } = withScript(2);
        // 创意的产物记录的是剧本 v1，现在剧本已是 v2
        const withCreative = nodes.map<CanvasNodeData>((node) => {
            if (node.id !== "toonflow-creative") return node;
            return { ...node, metadata: { ...node.metadata, toonflow: { ...node.metadata!.toonflow!, status: "approved", output: { nodeId: node.id, kind: "creative", version: 1, status: "approved", payload: { text: "旧创意" }, upstreamVersions: { "toonflow-script": 1 }, generatedAt: "2026-07-27T00:00:00.000Z" } } } };
        });

        const next = propagateAfterNewVersion(withCreative, connections, "toonflow-script");
        const creative = next.find((node) => node.id === "toonflow-creative");

        expect(creative?.metadata?.toonflow?.status).toBe("stale");
    });

    it("创意产物已基于剧本当前版本时不被误标 stale", () => {
        const { nodes, connections } = withScript(2);
        const withCreative = nodes.map<CanvasNodeData>((node) => {
            if (node.id !== "toonflow-creative") return node;
            return { ...node, metadata: { ...node.metadata, toonflow: { ...node.metadata!.toonflow!, status: "approved", output: { nodeId: node.id, kind: "creative", version: 1, status: "approved", payload: { text: "新创意" }, upstreamVersions: { "toonflow-script": 2 }, generatedAt: "2026-07-27T00:00:00.000Z" } } } };
        });

        const next = propagateAfterNewVersion(withCreative, connections, "toonflow-script");

        expect(next.find((node) => node.id === "toonflow-creative")?.metadata?.toonflow?.status).toBe("approved");
    });
});
