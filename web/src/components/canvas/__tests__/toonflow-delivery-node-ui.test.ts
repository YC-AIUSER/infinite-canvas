import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ToonflowNodeContent } from "@/components/canvas/toonflow-node-content";
import { SeamBoundaryCard } from "@/components/canvas/toonflow-seam-check-modal";
import { emptyQualityReview } from "@/lib/toonflow/node-runtime";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function baseNode(): Omit<CanvasNodeData, "type" | "title" | "metadata"> {
    return { id: "node-1", position: { x: 0, y: 0 }, width: 360, height: 320 };
}

describe("Toonflow 交付节点 UI", () => {
    it("视频工作台段实例可见七项质检折叠面板", () => {
        const node: CanvasNodeData = {
            ...baseNode(),
            type: CanvasNodeType.Video,
            title: "视频工作台 · 段1",
            metadata: {
                toonflow: {
                    kind: "video-workbench",
                    stage: "视频生成",
                    status: "review",
                    summary: "",
                    checks: [],
                    segmentId: "seg-a",
                    segmentIndex: 0,
                    output: {
                        nodeId: "node-1",
                        kind: "video-workbench",
                        version: 1,
                        status: "review",
                        payload: { text: "Module4", videoKeys: ["video:a"], qualityReview: emptyQualityReview() },
                        upstreamVersions: {},
                        generatedAt: "2026-07-24T00:00:00.000Z",
                    },
                },
            },
        };

        const html = renderToStaticMarkup(createElement(ToonflowNodeContent, { node }));
        expect(html).toContain("七项质检");
        expect(html).toContain("身份连续性");
        expect(html).toContain("尚未检查");
    });

    it("audio-mix 段实例可见角色音色与配音轨列表", () => {
        const node: CanvasNodeData = {
            ...baseNode(),
            type: CanvasNodeType.Audio,
            title: "音频混音 · 段1",
            metadata: {
                toonflow: {
                    kind: "audio-mix",
                    stage: "声音层",
                    status: "review",
                    summary: "",
                    checks: [],
                    segmentId: "seg-a",
                    segmentIndex: 0,
                    voiceMap: { 林夏: "nova" },
                    output: {
                        nodeId: "node-1",
                        kind: "audio-mix",
                        version: 1,
                        status: "review",
                        payload: {
                            audioKeys: ["audio:a"],
                            dubbing: [{ shotId: "shot-1", type: "dialogue", speaker: "林夏", text: "别开门", plannedOffsetSec: 0, voice: "nova", audioKey: "audio:a" }],
                        },
                        upstreamVersions: {},
                        generatedAt: "2026-07-24T00:00:00.000Z",
                    },
                },
            },
        };

        const html = renderToStaticMarkup(createElement(ToonflowNodeContent, { node }));
        expect(html).toContain("角色音色");
        expect(html).toContain("配音轨");
        expect(html).toContain("林夏");
    });

    it("seam-check 边界卡可见五行合同与剪辑手法建议", () => {
        const html = renderToStaticMarkup(createElement(SeamBoundaryCard, {
            boundary: {
                key: "seg-a__seg-b",
                fromSegmentId: "seg-a",
                fromTitle: "段1",
                fromVideoKey: "video:a",
                fromVersion: 1,
                toSegmentId: "seg-b",
                toTitle: "段2",
                toVideoKey: "video:b",
                toVersion: 1,
            },
            contract: {
                fromSegmentId: "seg-a",
                toSegmentId: "seg-b",
                prevEndBeat: "抬手停在半空",
                nextFirstPanel: "手继续落下",
                scaleOrMotivation: "近景切全景，跳两档",
                soundBridge: "L-cut 拖尾",
                audioBoundary: "段尾不启新持续音",
            },
            checked: false,
            onToggle: () => undefined,
        }));
        expect(html).toContain("上段末拍");
        expect(html).toContain("音频边界");
        expect(html).toContain("剪辑手法建议");
        expect(html).toContain("切景别/切视角");
    });
});
