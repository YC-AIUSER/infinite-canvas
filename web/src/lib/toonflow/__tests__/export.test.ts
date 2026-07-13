import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../../../types/canvas";
import { collectExportSegments } from "../node-runtime";
import type { NodeOutput, NodeStatus } from "../schema";

function output(nodeId: string, videoKeys: string[], version: number, status: NodeStatus): NodeOutput {
    return {
        nodeId,
        kind: "video-workbench",
        version,
        status,
        payload: { videoKeys },
        upstreamVersions: {},
        generatedAt: "2026-07-13T00:00:00.000Z",
    };
}

/** 造一个 video-workbench 段实例节点。
 *  videoKey 省略且 emptyVideo=false => 没有 output(空实例);emptyVideo=true => 有 output 但 videoKeys=[](生成产物无键的反常态)。 */
function videoInstance(
    id: string,
    segmentId: string,
    segmentIndex: number | undefined,
    options: { status?: NodeStatus; videoKey?: string; version?: number; archived?: boolean; emptyVideo?: boolean } = {},
): CanvasNodeData {
    const { status = "approved", videoKey, version = 1, archived = false, emptyVideo = false } = options;
    const hasOutput = Boolean(videoKey) || emptyVideo;
    return {
        id,
        type: CanvasNodeType.Video,
        title: `视频工作台 · 段${(segmentIndex ?? 0) + 1}`,
        position: { x: 0, y: 0 },
        width: 320,
        height: 190,
        metadata: {
            batchRootId: "video-root",
            toonflow: {
                kind: "video-workbench",
                stage: "视频生成",
                status,
                summary: "摘要",
                checks: [],
                segmentId,
                segmentIndex,
                archived,
                output: hasOutput ? output(id, videoKey ? [videoKey] : [], version, status) : undefined,
            },
        },
    };
}

function otherNode(id: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Text,
        title: id,
        position: { x: 0, y: 0 },
        width: 320,
        height: 190,
        metadata: { toonflow: { kind: "script", stage: "文本", status: "approved", summary: "", checks: [] } },
    };
}

describe("collectExportSegments", () => {
    it("① 按段序(segmentIndex)升序排列,不受节点顺序影响", () => {
        const nodes = [
            videoInstance("v2", "seg-c", 2, { videoKey: "media:c" }),
            videoInstance("v0", "seg-a", 0, { videoKey: "media:a" }),
            videoInstance("v1", "seg-b", 1, { videoKey: "media:b" }),
        ];
        const result = collectExportSegments(nodes);
        expect(result.segments.map((segment) => segment.videoKey)).toEqual(["media:a", "media:b", "media:c"]);
        expect(result.approvedCount).toBe(3);
        expect(result.totalSegments).toBe(3);
    });

    it("② 过滤未通过/无视频/已归档的段,totalSegments 仍计入未通过段", () => {
        const nodes = [
            videoInstance("approved", "seg-a", 0, { videoKey: "media:a", status: "approved" }),
            videoInstance("review", "seg-b", 1, { videoKey: "media:b", status: "review" }),
            videoInstance("empty", "seg-c", 2, { status: "empty" }),
            videoInstance("archived", "seg-d", 3, { videoKey: "media:d", status: "approved", archived: true }),
            otherNode("script-node"),
        ];
        const result = collectExportSegments(nodes);
        // 只有 seg-a 通过且有视频;review/empty 不进 segments;已归档段既不进 segments 也不计入总数。
        expect(result.segments.map((segment) => segment.segmentId)).toEqual(["seg-a"]);
        expect(result.approvedCount).toBe(1);
        expect(result.totalSegments).toBe(3); // seg-a/seg-b/seg-c(archived 的 seg-d 排除)
    });

    it("③ 同段有多个未归档实例时取最新版本的视频", () => {
        const nodes = [
            videoInstance("old", "seg-a", 0, { videoKey: "media:old", version: 1, status: "approved" }),
            videoInstance("new", "seg-a", 0, { videoKey: "media:new", version: 2, status: "approved" }),
        ];
        const result = collectExportSegments(nodes);
        expect(result.segments).toHaveLength(1);
        expect(result.segments[0].videoKey).toBe("media:new");
        expect(result.segments[0].version).toBe(2);
        expect(result.totalSegments).toBe(1); // 同一 segmentId 只算一段
    });

    it("④ 空画布返回空集合", () => {
        const result = collectExportSegments([]);
        expect(result.segments).toEqual([]);
        expect(result.approvedCount).toBe(0);
        expect(result.totalSegments).toBe(0);
    });

    it("⑤ approved 但 videoKeys 为空数组的段被踢出 segments,但仍计入 totalSegments", () => {
        const nodes = [
            videoInstance("ok", "seg-a", 0, { videoKey: "media:a", status: "approved" }),
            videoInstance("empty-keys", "seg-b", 1, { status: "approved", emptyVideo: true }),
        ];
        const result = collectExportSegments(nodes);
        expect(result.segments.map((segment) => segment.segmentId)).toEqual(["seg-a"]);
        expect(result.approvedCount).toBe(1);
        expect(result.totalSegments).toBe(2);
    });

    it("⑥ segmentIndex 缺失(undefined)按 0 排序,不抛错", () => {
        const nodes = [
            videoInstance("has-index", "seg-b", 1, { videoKey: "media:b" }),
            videoInstance("no-index", "seg-a", undefined, { videoKey: "media:a" }),
        ];
        const result = collectExportSegments(nodes);
        // no-index(?? 0) 排在 has-index(1) 前
        expect(result.segments.map((segment) => segment.videoKey)).toEqual(["media:a", "media:b"]);
        expect(result.totalSegments).toBe(2);
    });

    it("⑦ segmentIndex 平局时保留节点数组中的首次出现顺序(稳定排序)", () => {
        const nodes = [
            videoInstance("first", "seg-x", 0, { videoKey: "media:x" }),
            videoInstance("second", "seg-y", 0, { videoKey: "media:y" }),
            videoInstance("third", "seg-z", 0, { videoKey: "media:z" }),
        ];
        const result = collectExportSegments(nodes);
        expect(result.segments.map((segment) => segment.videoKey)).toEqual(["media:x", "media:y", "media:z"]);
    });
});
