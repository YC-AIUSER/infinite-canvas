import { describe, expect, it } from "vitest";

import { STAGE_METHODOLOGY_REDLINES } from "../prompts";

describe("批B方法论红线", () => {
    it("video-workbench 锁定七项质检与 P0 门禁", () => {
        expect(STAGE_METHODOLOGY_REDLINES["video-workbench"]).toContain("P7七项人工质检");
        expect(STAGE_METHODOLOGY_REDLINES["video-workbench"]).toContain("无未清P0");
    });

    it("seam-check 锁定合同、抽帧与降级行为", () => {
        const value = STAGE_METHODOLOGY_REDLINES["seam-check"];
        expect(value).toContain("五行缝合同");
        expect(value).toContain("上段尾帧与本段首帧");
        expect(value).toContain("人工勾选流程不得阻塞");
    });

    it("audio-mix 锁定逐句 TTS、旁白兜底与失效传播", () => {
        const value = STAGE_METHODOLOGY_REDLINES["audio-mix"];
        expect(value).toContain("逐句TTS");
        expect(value).toContain("旁白音色兜底");
        expect(value).toContain("对应段配音失效");
    });

    it("export 锁定默认无损、可选混音和 -16 LUFS", () => {
        const value = STAGE_METHODOLOGY_REDLINES.export;
        expect(value).toContain("默认保持现有无损ffmpeg拼接");
        expect(value).toContain("adelay");
        expect(value).toContain("loudnorm I=-16");
    });
});
