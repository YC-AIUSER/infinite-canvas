import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PROCESS_TIMEOUT_MS = 10 * 60 * 1000;
const JOB_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const binaries = new Map<string, string>();

export type VideoProbe = { videoCodec: string; audioCodec?: string; width: number; height: number; frameRate: string; hasAudio: boolean; durationSec: number };
export type StitchMode = "copy" | "reencode";
export type StitchResult = { outputPath: string; mode: StitchMode; bytes: number; durationSec: number };
export type DubbingInput = { segmentIndex: number; offsetSec: number; bytes: Buffer; mimeType?: string };
export type DubbingFile = Omit<DubbingInput, "bytes" | "mimeType"> & { file: string };
export type ExtractedFrames = { firstFrame: Buffer; lastFrame: Buffer };
export type StitchCommandRunner = (command: string, args: string[]) => Promise<unknown>;

export function isValidJobId(value: unknown): value is string {
    return typeof value === "string" && JOB_ID_RE.test(value);
}

export function jobDirectory(jobId: string) {
    return path.join(os.tmpdir(), "canvas-stitch", jobId);
}

export function segmentPath(jobId: string, index: number) {
    return path.join(jobDirectory(jobId), `${index}.mp4`);
}

export async function writeSegment(jobId: string, index: number, body: Buffer) {
    const dir = jobDirectory(jobId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(segmentPath(jobId, index), body);
}

export async function extractVideoFrames(
    jobId: string,
    body: Buffer,
    dependencies: { ensureFfmpeg?: () => Promise<void>; runCommand?: StitchCommandRunner } = {},
): Promise<ExtractedFrames> {
    if (!isValidJobId(jobId) || !body.length) throw new Error("jobId 或视频字节无效");
    const ensure = dependencies.ensureFfmpeg ?? ensureFfmpeg;
    const runCommand = dependencies.runCommand ?? run;
    await writeSegment(jobId, 0, body);
    await ensure();
    const input = segmentPath(jobId, 0);
    const firstPath = path.join(jobDirectory(jobId), "first.png");
    const lastPath = path.join(jobDirectory(jobId), "last.png");
    await Promise.all([
        runCommand("ffmpeg", ["-y", "-i", input, "-frames:v", "1", firstPath]),
        runCommand("ffmpeg", ["-y", "-sseof", "-1", "-i", input, "-vf", "reverse", "-frames:v", "1", lastPath]),
    ]);
    const [firstFrame, lastFrame] = await Promise.all([fs.readFile(firstPath), fs.readFile(lastPath)]);
    return { firstFrame, lastFrame };
}

export function pngDataUrl(bytes: Buffer) {
    return `data:image/png;base64,${bytes.toString("base64")}`;
}

export async function hasAllSegments(jobId: string, count: number) {
    const files = Array.from({ length: count }, (_, index) => segmentPath(jobId, index));
    const states = await Promise.all(files.map(async (file) => fs.stat(file).then((stat) => stat.isFile(), () => false)));
    return states.every(Boolean);
}

export async function removeJob(jobId: string) {
    await fs.rm(jobDirectory(jobId), { recursive: true, force: true });
}

export function sanitizeOutputTitle(title: string) {
    return title.replace(/[\\/:*?"<>|]/g, "_").trim() || "toonflow-成片";
}

export function outputFilePath(title?: string, now = new Date(), directory = path.join(os.homedir(), "Videos", "Toonflow")) {
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
    return path.join(directory, `${sanitizeOutputTitle(title || "toonflow-成片")}-${stamp}.mp4`);
}

export function escapeConcatPath(file: string) {
    return `'${file.replace(/'/g, "'\\''")}'`;
}

export function chooseStitchMode(probes: VideoProbe[]): StitchMode {
    if (!probes.length) throw new Error("至少需要一段视频");
    const first = probes[0];
    return probes.every((probe) => probe.hasAudio && probe.videoCodec === first.videoCodec && probe.audioCodec === first.audioCodec && probe.width === first.width && probe.height === first.height && probe.frameRate === first.frameRate) ? "copy" : "reencode";
}

export async function ensureFfmpeg() {
    try {
        await findFfmpeg();
    } catch {
        throw new Error("未检测到 ffmpeg,请安装(Windows: winget install ffmpeg)后重试");
    }
}

export function findFfmpeg() {
    return findBinary("ffmpeg");
}

export async function probeVideo(file: string): Promise<VideoProbe> {
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate", "-of", "json", file]);
    return parseProbeOutput(stdout, file);
}

export function parseProbeOutput(stdout: string, file = "video.mp4"): VideoProbe {
    const data = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string }> };
    const video = data.streams?.find((stream) => stream.codec_type === "video");
    const audio = data.streams?.find((stream) => stream.codec_type === "audio");
    if (!video?.codec_name || !video.width || !video.height || !video.r_frame_rate) throw new Error(`无法读取视频参数: ${path.basename(file)}`);
    return { videoCodec: video.codec_name, audioCodec: audio?.codec_name, width: video.width, height: video.height, frameRate: video.r_frame_rate, hasAudio: Boolean(audio), durationSec: Number(data.format?.duration || 0) };
}

export async function stitchSegments({
    jobId,
    count,
    title,
    outputDirectory,
    dubbing = [],
    loudnorm = false,
}: {
    jobId: string;
    count: number;
    title?: string;
    outputDirectory?: string;
    dubbing?: DubbingInput[];
    loudnorm?: boolean;
}): Promise<StitchResult> {
    if (!isValidJobId(jobId) || !Number.isInteger(count) || count < 1) throw new Error("jobId 或 count 无效");
    if (!await hasAllSegments(jobId, count)) throw new Error("段文件不完整");
    await ensureFfmpeg();
    const files = Array.from({ length: count }, (_, index) => segmentPath(jobId, index));
    const probes = await Promise.all(files.map(probeVideo));
    const mode = dubbing.length || loudnorm ? "reencode" : count === 1 ? "copy" : chooseStitchMode(probes);
    const outputPath = outputFilePath(title, new Date(), outputDirectory);
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    if (mode === "copy") await concatCopy(files, outputPath, jobDirectory(jobId));
    else {
        const dubbingFiles = await Promise.all(dubbing.map(async (item, index): Promise<DubbingFile> => {
            const file = path.join(jobDirectory(jobId), `dubbing-${index}.audio`);
            await fs.writeFile(file, item.bytes);
            return { file, segmentIndex: item.segmentIndex, offsetSec: item.offsetSec };
        }));
        await concatReencode(files, probes, outputPath, dubbingFiles, loudnorm);
    }
    const output = await fs.stat(outputPath);
    return { outputPath, mode, bytes: output.size, durationSec: probes.reduce((sum, probe) => sum + probe.durationSec, 0) };
}

export async function revealOutput(file: string, allowedOutputs: ReadonlySet<string>) {
    if (!canRevealOutput(file, allowedOutputs)) throw new Error("无权打开此文件");
    // explorer.exe 成功打开也惯性返回退出码 1,不能按失败处理
    if (process.platform === "win32") await execFileAsync("explorer.exe", ["/select,", file], { timeout: PROCESS_TIMEOUT_MS, windowsHide: true }).catch(() => undefined);
    else if (process.platform === "darwin") await run("open", ["-R", file]);
    else await run("xdg-open", [path.dirname(file)]);
}

export function canRevealOutput(file: string, allowedOutputs: ReadonlySet<string>) {
    return allowedOutputs.has(file);
}

async function concatCopy(files: string[], outputPath: string, dir: string) {
    const listPath = path.join(dir, "list.txt");
    await fs.writeFile(listPath, `${files.map((file) => `file ${escapeConcatPath(file)}`).join("\n")}\n`, "utf8");
    await run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath]);
}

export function buildReencodeArgs(files: string[], probes: VideoProbe[], outputPath: string, dubbing: DubbingFile[] = [], loudnorm = false) {
    const first = probes[0];
    const inputs = [...files, ...dubbing.map((item) => item.file)].flatMap((file) => ["-i", file]);
    const filters: string[] = [];
    const concatInputs: string[] = [];
    probes.forEach((probe, index) => {
        filters.push(`[${index}:v]scale=${first.width}:${first.height}:force_original_aspect_ratio=decrease,pad=${first.width}:${first.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${first.frameRate}[v${index}]`);
        filters.push(probe.hasAudio ? `[${index}:a]aresample=48000[a${index}]` : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${Math.max(probe.durationSec, 0.01)}[a${index}]`);
        concatInputs.push(`[v${index}][a${index}]`);
    });
    filters.push(`${concatInputs.join("")}concat=n=${files.length}:v=1:a=1[v][a]`);
    let audioLabel = "a";
    if (dubbing.length) {
        const dubbingLabels = dubbing.map((item, index) => {
            const inputIndex = files.length + index;
            const segmentOffsetSec = probes.slice(0, item.segmentIndex).reduce((sum, probe) => sum + probe.durationSec, 0);
            const delayMs = Math.max(0, Math.round((segmentOffsetSec + item.offsetSec) * 1000));
            filters.push(`[${inputIndex}:a]aresample=48000,adelay=${delayMs}|${delayMs}[d${index}]`);
            return `[d${index}]`;
        });
        filters.push(`[a]${dubbingLabels.join("")}amix=inputs=${dubbing.length + 1}:duration=longest:dropout_transition=0[mix]`);
        audioLabel = "mix";
    }
    if (loudnorm) {
        filters.push(`[${audioLabel}]loudnorm=I=-16:TP=-1.5:LRA=11[aout]`);
        audioLabel = "aout";
    }
    return ["-y", ...inputs, "-filter_complex", filters.join(";"), "-map", "[v]", "-map", `[${audioLabel}]`, "-c:v", "libx264", "-crf", "18", "-c:a", "aac", "-movflags", "+faststart", ...(dubbing.length || loudnorm ? ["-shortest"] : []), outputPath];
}

async function concatReencode(files: string[], probes: VideoProbe[], outputPath: string, dubbing: DubbingFile[] = [], loudnorm = false) {
    await run("ffmpeg", buildReencodeArgs(files, probes, outputPath, dubbing, loudnorm));
}

async function run(command: string, args: string[]) {
    try {
        const executable = command === "ffmpeg" || command === "ffprobe" ? await findBinary(command) : command;
        return await execFileAsync(executable, args, { timeout: PROCESS_TIMEOUT_MS, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
    } catch (error) {
        const detail = error && typeof error === "object" && "stderr" in error ? String(error.stderr).trim() : "";
        throw new Error(detail ? `${command} 执行失败: ${detail.slice(-1000)}` : `${command} 执行失败`);
    }
}

async function findBinary(command: string) {
    const cached = binaries.get(command);
    if (cached) return cached;
    try {
        await execFileAsync(command, ["-version"], { timeout: PROCESS_TIMEOUT_MS, windowsHide: true });
        binaries.set(command, command);
        return command;
    } catch {
        if (process.platform !== "win32") throw new Error(`${command} not found`);
        let stdout = "";
        try {
            ({ stdout } = await execFileAsync("where.exe", [command], { windowsHide: true }));
        } catch {
            // Some Windows App Paths entries are discoverable by the shell but not `where`.
        }
        for (const candidate of stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
            try {
                await execFileAsync(candidate, ["-version"], { timeout: PROCESS_TIMEOUT_MS, windowsHide: true });
                binaries.set(command, candidate);
                return candidate;
            } catch {
                // WinGet links may exist but be blocked; keep trying the remaining PATH entries.
            }
        }
        throw new Error(`${command} not found`);
    }
}
