/** Codex 对抗审查 2026-07-27 提出的疑点复现。修复前应当全红。 */
import { describe, expect, it } from "vitest";

import { buildToonflowGeneration } from "../node-runtime";
import { buildToonflowCanvasTemplate } from "../../canvas/toonflow-canvas-template";

describe("对抗审查复现", () => {
    it("疑点1：全新画布上创意不该把 script 的模板占位文案当成剧本注入", () => {
        const { nodes, connections } = buildToonflowCanvasTemplate();
        const prompt = buildToonflowGeneration(nodes, connections, "toonflow-creative").finalPrompt;

        expect(prompt).not.toContain("【script】");
        expect(prompt).not.toContain("承载原文、改编策略");
    });

    it("疑点1b：有多个 script 节点时应选真正有产物的那个，而不是第一个", () => {
        const { nodes, connections } = buildToonflowCanvasTemplate();
        const withCopy = [
            ...nodes,
            {
                ...nodes.find((node) => node.id === "toonflow-script")!,
                id: "toonflow-script-copy",
                metadata: {
                    ...nodes.find((node) => node.id === "toonflow-script")!.metadata,
                    content: "真剧本：林晚在废弃录音棚扣住顾沉手腕。",
                    toonflow: { ...nodes.find((node) => node.id === "toonflow-script")!.metadata!.toonflow!, status: "review" as const, output: { nodeId: "toonflow-script-copy", kind: "script" as const, version: 1, status: "review" as const, payload: { text: "真剧本：林晚在废弃录音棚扣住顾沉手腕。" }, upstreamVersions: {}, generatedAt: "2026-07-27T00:00:00.000Z" } },
                },
            },
        ];
        const prompt = buildToonflowGeneration(withCopy, connections, "toonflow-creative").finalPrompt;

        expect(prompt).toContain("林晚在废弃录音棚扣住顾沉手腕");
    });
});
