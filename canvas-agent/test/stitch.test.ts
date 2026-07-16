import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterAll, describe, expect, it } from "vitest";

import { canRevealOutput, chooseStitchMode, escapeConcatPath, findFfmpeg, isValidJobId, jobDirectory, parseProbeOutput, probeVideo, sanitizeOutputTitle, stitchSegments, writeSegment } from "../src/stitch.js";

const execFileAsync = promisify(execFile);

describe("stitch helpers", () => {
    it("识别安全 jobId", () => {
        expect(isValidJobId("job_1-abc")).toBe(true);
        expect(isValidJobId("../escape")).toBe(false);
        expect(isValidJobId("a".repeat(65))).toBe(false);
    });

    it("转义 concat 路径中的单引号", () => {
        expect(escapeConcatPath("C:/a'b.mp4")).toBe("'C:/a'\\''b.mp4'");
    });

    it("解析 ffprobe 的视频和音频参数", () => {
        const probe = parseProbeOutput(JSON.stringify({ format: { duration: "1.25" }, streams: [{ codec_type: "video", codec_name: "h264", width: 1280, height: 720, r_frame_rate: "25/1" }, { codec_type: "audio", codec_name: "aac" }] }));
        expect(probe).toMatchObject({ videoCodec: "h264", audioCodec: "aac", width: 1280, height: 720, frameRate: "25/1", hasAudio: true, durationSec: 1.25 });
    });

    it("清理 Windows 非法文件名", () => {
        expect(sanitizeOutputTitle('a/b:c*?"<>|')).toBe("a_b_c______");
        expect(sanitizeOutputTitle("   ")).toBe("toonflow-成片");
    });

    it("所有参数一致且均有音轨时走 copy", () => {
        const base = { videoCodec: "h264", audioCodec: "aac", width: 1280, height: 720, frameRate: "25/1", hasAudio: true, durationSec: 1 };
        expect(chooseStitchMode([base, { ...base }])).toBe("copy");
        expect(chooseStitchMode([base, { ...base, hasAudio: false }])).toBe("reencode");
        expect(chooseStitchMode([base, { ...base, width: 1920 }])).toBe("reencode");
    });

    it("只允许本进程白名单内的路径 reveal", () => {
        expect(canRevealOutput("C:/Videos/ok.mp4", new Set(["C:/Videos/ok.mp4"]))).toBe(true);
        expect(canRevealOutput("C:/Windows/x.mp4", new Set(["C:/Videos/ok.mp4"]))).toBe(false);
    });
});

async function hasFfmpeg() {
    try {
        await findFfmpeg();
        return true;
    } catch {
        return false;
    }
}

const ffmpegAvailable = await hasFfmpeg();

describe.skipIf(!ffmpegAvailable)("stitch integration", () => {
    const root = path.join(os.tmpdir(), `canvas-stitch-test-${Date.now()}`);

    afterAll(async () => fs.rm(root, { recursive: true, force: true }));

    async function createClip(name: string, size = "160x90") {
        const file = path.join(root, name);
        await fs.mkdir(root, { recursive: true });
        await execFileAsync(await findFfmpeg(), ["-y", "-f", "lavfi", "-i", `color=c=navy:s=${size}:r=25:d=1`, "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", file]);
        return file;
    }

    async function runCase(jobId: string, size2?: string) {
        const first = await createClip(`${jobId}-1.mp4`);
        const second = await createClip(`${jobId}-2.mp4`, size2);
        await writeSegment(jobId, 0, await fs.readFile(first));
        await writeSegment(jobId, 1, await fs.readFile(second));
        const result = await stitchSegments({ jobId, count: 2, title: jobId, outputDirectory: root });
        const outputProbe = await probeVideo(result.outputPath);
        await fs.rm(result.outputPath, { force: true });
        await fs.rm(jobDirectory(jobId), { recursive: true, force: true });
        return { result, outputProbe };
    }

    it("真实 ffmpeg 无损拼接两段一秒视频", async () => {
        const { result, outputProbe } = await runCase(`copy-${Date.now()}`);
        expect(result.mode).toBe("copy");
        expect(result.bytes).toBeGreaterThan(0);
        expect(outputProbe.durationSec).toBeCloseTo(2, 0);
    });

    it("真实 ffmpeg 在参数不一致时自动转码", async () => {
        const { result, outputProbe } = await runCase(`reencode-${Date.now()}`, "240x136");
        expect(result.mode).toBe("reencode");
        expect(result.bytes).toBeGreaterThan(0);
        expect(outputProbe.durationSec).toBeCloseTo(2, 0);
    });
});
