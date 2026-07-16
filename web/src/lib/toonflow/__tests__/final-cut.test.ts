import { beforeEach, describe, expect, it, vi } from "vitest";

const { getMediaBlob } = vi.hoisted(() => ({ getMediaBlob: vi.fn() }));
vi.mock("../../../services/file-storage", () => ({ getMediaBlob }));

import { stitchFinalCut } from "../final-cut";
import { useAgentStore } from "../../../stores/use-agent-store";

const segments = [
    { segmentId: "one", segmentIndex: 0, title: "第一段", videoKey: "video:one", version: 1 },
    { segmentId: "two", segmentIndex: 1, title: "第二段", videoKey: "video:two", version: 1 },
];

describe("stitchFinalCut", () => {
    beforeEach(() => {
        useAgentStore.setState({ url: "http://127.0.0.1:17371", token: "token" });
        getMediaBlob.mockReset();
        vi.stubGlobal("crypto", { randomUUID: () => "job-1" });
    });

    it("按段序上传后再发起拼接", async () => {
        getMediaBlob.mockResolvedValue(new Blob(["video"]));
        const fetch = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, outputPath: "C:/Videos/a.mp4", mode: "copy" }) });
        vi.stubGlobal("fetch", fetch);

        await expect(stitchFinalCut(segments, "成片")).resolves.toEqual({ outputPath: "C:/Videos/a.mp4", mode: "copy" });
        expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
            "http://127.0.0.1:17371/export/segments?jobId=job-1&index=0",
            "http://127.0.0.1:17371/export/segments?jobId=job-1&index=1",
            "http://127.0.0.1:17371/export/stitch",
        ]);
    });

    it("上传前发现 blob 缺失时中止", async () => {
        getMediaBlob.mockResolvedValueOnce(new Blob(["video"])).mockResolvedValueOnce(null);
        const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
        vi.stubGlobal("fetch", fetch);

        await expect(stitchFinalCut(segments)).rejects.toThrow("第 2 段「第二段」的视频数据缺失");
        expect(fetch).not.toHaveBeenCalled();
    });

    it("透传 Agent 的错误信息", async () => {
        getMediaBlob.mockResolvedValue(new Blob(["video"]));
        const fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "未检测到 ffmpeg" }) });
        vi.stubGlobal("fetch", fetch);

        await expect(stitchFinalCut([segments[0]])).rejects.toThrow("未检测到 ffmpeg");
    });
});
