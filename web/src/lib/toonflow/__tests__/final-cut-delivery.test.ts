import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMediaBlob } = vi.hoisted(() => ({ getMediaBlob: vi.fn() }));
vi.mock("../../../services/file-storage", () => ({ getMediaBlob }));

import { stitchFinalCut } from "../final-cut";
import { useAgentStore } from "../../../stores/use-agent-store";

const segments = [
    { segmentId: "seg-a", segmentIndex: 0, title: "第一段", videoKey: "video:a", version: 1 },
    { segmentId: "seg-b", segmentIndex: 1, title: "第二段", videoKey: "video:b", version: 1 },
];

describe("stitchFinalCut 配音与响度选项", () => {
    beforeEach(() => {
        useAgentStore.setState({ url: "http://127.0.0.1:17371", token: "token" });
        getMediaBlob.mockReset();
        vi.stubGlobal("crypto", { randomUUID: () => "job-delivery" });
        vi.stubGlobal("btoa", (value: string) => Buffer.from(value, "binary").toString("base64"));
    });

    it("两个选项都关闭时 stitch 请求体不增加任何增强字段", async () => {
        getMediaBlob.mockResolvedValue(new Blob(["video"], { type: "video/mp4" }));
        const fetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, outputPath: "C:/Videos/copy.mp4", mode: "copy" }) });
        vi.stubGlobal("fetch", fetch);

        await stitchFinalCut(segments, "成片", undefined, { loudnorm: false });

        expect(JSON.parse(String(fetch.mock.calls[2][1]?.body))).toEqual({ jobId: "job-delivery", count: 2, title: "成片" });
    });

    it("上传视频后把配音字节、段内偏移与 loudnorm 传给 stitch", async () => {
        getMediaBlob.mockImplementation(async (key: string) => key.startsWith("video:") ? new Blob([key], { type: "video/mp4" }) : new Blob(["voice"], { type: "audio/mpeg" }));
        const fetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, outputPath: "C:/Videos/mix.mp4", mode: "reencode" }) });
        vi.stubGlobal("fetch", fetch);

        await stitchFinalCut(segments, "成片", undefined, {
            loudnorm: true,
            dubbing: [{ segmentId: "seg-b", segmentIndex: 1, shotId: "shot-2", type: "os", speaker: "林夏", text: "门后有人", plannedOffsetSec: 2.5, voice: "shimmer", audioKey: "audio:voice" }],
        });

        const body = JSON.parse(String(fetch.mock.calls[2][1]?.body));
        expect(body).toMatchObject({ jobId: "job-delivery", count: 2, title: "成片", loudnorm: true });
        expect(body.dubbing[0]).toMatchObject({ segmentIndex: 1, offsetSec: 2.5, mimeType: "audio/mpeg" });
        expect(Buffer.from(body.dubbing[0].bytes, "base64").toString()).toBe("voice");
    });

    it("配音媒体缺失时在上传任何视频前中止", async () => {
        getMediaBlob.mockImplementation(async (key: string) => key === "audio:missing" ? null : new Blob(["video"]));
        const fetch = vi.fn();
        vi.stubGlobal("fetch", fetch);

        await expect(stitchFinalCut(segments, undefined, undefined, {
            dubbing: [{ segmentId: "seg-a", segmentIndex: 0, shotId: "shot-1", type: "dialogue", speaker: "顾沉舟", text: "别开门", plannedOffsetSec: 0, voice: "onyx", audioKey: "audio:missing" }],
        })).rejects.toThrow("配音");
        expect(fetch).not.toHaveBeenCalled();
    });
});
