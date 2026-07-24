import { describe, expect, it } from "vitest";

import { buildToonflowCanvasTemplate } from "../../canvas/toonflow-canvas-template";
import { applyInstanceSync, planInstanceSync } from "../instances";
import type { NodeOutput, StoryboardRow } from "../schema";

const rows: StoryboardRow[] = [
    { segmentId: "seg-a", shotId: "shot-1", shotNo: 1, scale: "近景", angle: "平视", action: "抬头", line: "出口对白-林夏：别开门", sfx: "", mood: "紧张", durationSec: 5 },
];

describe("audio-mix 段实例", () => {
    it("真实模板存在 audio-mix 根时，为每段创建第四类实例并接在视频后", () => {
        const template = buildToonflowCanvasTemplate();
        const nodes = template.nodes.map((node) => {
            if (node.metadata?.toonflow?.kind !== "storyboard-table") return node;
            const output: NodeOutput = {
                nodeId: node.id,
                kind: "storyboard-table",
                version: 1,
                status: "approved",
                payload: { table: rows },
                upstreamVersions: {},
                generatedAt: "2026-07-24T00:00:00.000Z",
            };
            return { ...node, metadata: { ...node.metadata, toonflow: { ...node.metadata.toonflow, status: "approved" as const, output } } };
        });
        const storyboard = nodes.find((node) => node.metadata?.toonflow?.kind === "storyboard-table")!;
        const plan = planInstanceSync(nodes, storyboard.id)!;
        let id = 0;
        const result = applyInstanceSync(nodes, template.connections, plan, () => `new-${++id}`);
        const instances = result.nodes.filter((node) => node.metadata?.toonflow?.segmentId === "seg-a");
        const video = instances.find((node) => node.metadata?.toonflow?.kind === "video-workbench")!;
        const audio = instances.find((node) => node.metadata?.toonflow?.kind === "audio-mix")!;

        expect(plan.toCreate.map((item) => item.kind)).toContain("audio-mix");
        expect(instances).toHaveLength(4);
        expect(result.connections.some((connection) => connection.fromNodeId === video.id && connection.toNodeId === audio.id)).toBe(true);
    });
});
