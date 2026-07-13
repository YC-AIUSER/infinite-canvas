import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../../../types/canvas";
import { applySeamReviewSave, applySeamSkip, collectSeamBoundaries, isSeamChecked, parseSeamReviews, seamReviewSummary, type SeamReview } from "../node-runtime";
import type { NodeOutput, NodeStatus } from "../schema";

function videoInstance(id: string, segmentId: string, segmentIndex: number, videoKey: string, version = 1): CanvasNodeData {
    const output: NodeOutput = {
        nodeId: id,
        kind: "video-workbench",
        version,
        status: "approved",
        payload: { videoKeys: [videoKey] },
        upstreamVersions: {},
        generatedAt: "2026-07-13T00:00:00.000Z",
    };
    return {
        id,
        type: CanvasNodeType.Video,
        title: `视频工作台 · 段${segmentIndex + 1}`,
        position: { x: 0, y: 0 },
        width: 320,
        height: 190,
        metadata: { toonflow: { kind: "video-workbench", stage: "视频生成", status: "approved", summary: "", checks: [], segmentId, segmentIndex, output } },
    };
}

function seamNode(reviews?: SeamReview[], status: NodeStatus = "empty"): CanvasNodeData {
    return {
        id: "seam",
        type: CanvasNodeType.Text,
        title: "接缝检查",
        position: { x: 0, y: 0 },
        width: 320,
        height: 190,
        metadata: {
            toonflow: {
                kind: "seam-check",
                stage: "连续性验收",
                status,
                summary: "",
                checks: [],
                output: reviews ? { nodeId: "seam", kind: "seam-check", version: 1, status, payload: { text: JSON.stringify({ reviewed: reviews }) }, upstreamVersions: {}, generatedAt: "2026-07-13T00:00:00.000Z" } : undefined,
            },
        },
    };
}

function threeSegments() {
    return [videoInstance("v0", "seg-a", 0, "media:a"), videoInstance("v1", "seg-b", 1, "media:b"), videoInstance("v2", "seg-c", 2, "media:c")];
}

describe("collectSeamBoundaries", () => {
    it("N 段已通过 => N-1 个接缝,按段序,携双方视频键与版本", () => {
        const boundaries = collectSeamBoundaries(threeSegments());
        expect(boundaries.map((b) => b.key)).toEqual(["seg-a__seg-b", "seg-b__seg-c"]);
        expect(boundaries[0]).toMatchObject({ fromSegmentId: "seg-a", toSegmentId: "seg-b", fromVideoKey: "media:a", toVideoKey: "media:b" });
    });

    it("少于 2 段 => 无接缝", () => {
        expect(collectSeamBoundaries([videoInstance("v0", "seg-a", 0, "media:a")])).toEqual([]);
        expect(collectSeamBoundaries([])).toEqual([]);
    });
});

describe("isSeamChecked / seamReviewSummary", () => {
    it("已检要求 key 与双方版本都一致;版本变则失效", () => {
        const boundaries = collectSeamBoundaries(threeSegments());
        const reviews: SeamReview[] = [{ key: "seg-a__seg-b", fromVersion: 1, toVersion: 1 }];
        expect(isSeamChecked(boundaries[0], reviews)).toBe(true);
        // 版本对不上 => 未检
        expect(isSeamChecked(boundaries[0], [{ key: "seg-a__seg-b", fromVersion: 2, toVersion: 1 }])).toBe(false);
    });

    it("seamReviewSummary 统计已检数与接缝总数", () => {
        const nodes = [...threeSegments(), seamNode([{ key: "seg-a__seg-b", fromVersion: 1, toVersion: 1 }])];
        expect(seamReviewSummary(nodes, nodes.find((n) => n.metadata?.toonflow?.kind === "seam-check"))).toEqual({ checkedCount: 1, total: 2 });
    });
});

describe("applySeamReviewSave / applySeamSkip", () => {
    it("全部接缝已勾 => approved 并持久化 reviewed 到 payload.text", () => {
        const nodes = [...threeSegments(), seamNode()];
        const reviews: SeamReview[] = [
            { key: "seg-a__seg-b", fromVersion: 1, toVersion: 1 },
            { key: "seg-b__seg-c", fromVersion: 1, toVersion: 1 },
        ];
        const next = applySeamReviewSave(nodes, "seam", reviews);
        const saved = next.find((n) => n.id === "seam")!.metadata!.toonflow!;
        expect(saved.status).toBe("approved");
        expect(parseSeamReviews(next.find((n) => n.id === "seam"))).toHaveLength(2);
    });

    it("部分勾选 => review", () => {
        const nodes = [...threeSegments(), seamNode()];
        const next = applySeamReviewSave(nodes, "seam", [{ key: "seg-a__seg-b", fromVersion: 1, toVersion: 1 }]);
        expect(next.find((n) => n.id === "seam")!.metadata!.toonflow!.status).toBe("review");
    });

    it("跳过 => skipped", () => {
        const nodes = [...threeSegments(), seamNode()];
        const next = applySeamSkip(nodes, "seam");
        expect(next.find((n) => n.id === "seam")!.metadata!.toonflow!.status).toBe("skipped");
    });

    it("parseSeamReviews 对无 output / 坏 JSON 返回空数组", () => {
        expect(parseSeamReviews(seamNode())).toEqual([]);
        expect(parseSeamReviews(undefined)).toEqual([]);
    });
});
