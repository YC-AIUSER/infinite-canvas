import { describe, expect, it } from "vitest";

import { BATCH_UPLOAD_OFFSET, cascadePosition, classifyMediaFile, pickMediaFiles } from "../upload-media";

describe("classifyMediaFile", () => {
    it("按 MIME 归类图片/视频/音频", () => {
        expect(classifyMediaFile({ type: "image/png", name: "a.png" })).toBe("image");
        expect(classifyMediaFile({ type: "image/webp", name: "b.webp" })).toBe("image");
        expect(classifyMediaFile({ type: "video/mp4", name: "c.mp4" })).toBe("video");
        expect(classifyMediaFile({ type: "audio/mpeg", name: "d.mp3" })).toBe("audio");
    });

    it("MIME 为空时按扩展名兜底识别音频（与旧 isAudioFile 行为一致）", () => {
        expect(classifyMediaFile({ type: "", name: "voice.mp3" })).toBe("audio");
        expect(classifyMediaFile({ type: "", name: "voice.WAV" })).toBe("audio");
    });

    it("不支持的类型返回 null", () => {
        expect(classifyMediaFile({ type: "application/pdf", name: "doc.pdf" })).toBeNull();
        expect(classifyMediaFile({ type: "text/plain", name: "note.txt" })).toBeNull();
        expect(classifyMediaFile({ type: "", name: "archive.zip" })).toBeNull();
    });
});

describe("pickMediaFiles", () => {
    it("保留全部合法媒体文件并维持原顺序——批量上传不再只取第一个", () => {
        const files = [
            { type: "image/png", name: "1.png" },
            { type: "application/pdf", name: "skip.pdf" },
            { type: "video/mp4", name: "2.mp4" },
            { type: "audio/wav", name: "3.wav" },
            { type: "image/jpeg", name: "4.jpg" },
        ];
        const picked = pickMediaFiles(files);
        expect(picked).toHaveLength(4);
        expect(picked.map((file) => file.name)).toEqual(["1.png", "2.mp4", "3.wav", "4.jpg"]);
    });

    it("没有合法文件时返回空数组", () => {
        expect(pickMediaFiles([{ type: "text/plain", name: "a.txt" }])).toEqual([]);
    });
});

describe("cascadePosition", () => {
    it("第 0 个文件落在原点位置", () => {
        expect(cascadePosition({ x: 100, y: 200 }, 0)).toEqual({ x: 100, y: 200 });
    });

    it("后续文件按固定步长斜向错开，避免完全重叠", () => {
        expect(cascadePosition({ x: 100, y: 200 }, 2)).toEqual({ x: 100 + BATCH_UPLOAD_OFFSET * 2, y: 200 + BATCH_UPLOAD_OFFSET * 2 });
    });
});
