import type { ExportSegment } from "./node-runtime";
import { getMediaBlob } from "../../services/file-storage";
import { useAgentStore } from "../../stores/use-agent-store";

export type StitchProgress = { phase: "uploading"; current: number; total: number } | { phase: "stitching" };
export type FinalCutResult = { outputPath: string; mode: "copy" | "reencode" };

function agentConnection() {
    const { url, token } = useAgentStore.getState();
    const endpoint = url.trim().replace(/\/$/, "");
    if (!endpoint || !token.trim()) throw new Error("需本地 Agent 运行");
    return { endpoint, token: token.trim() };
}

export async function checkStitchAgentHealth() {
    try {
        const { endpoint } = agentConnection();
        const response = await fetch(`${endpoint}/health`);
        return response.ok;
    } catch {
        return false;
    }
}

export async function stitchFinalCut(segments: ExportSegment[], title?: string, onProgress?: (progress: StitchProgress) => void): Promise<FinalCutResult> {
    if (!segments.length) throw new Error("请先通过至少一段视频");
    const { endpoint, token } = agentConnection();
    const jobId = crypto.randomUUID();
    const headers = { "x-canvas-agent-token": token };
    // 上传前先全部校验:任一段缺失就不上传任何数据,避免 Agent 侧留下孤儿临时目录
    const blobs: Blob[] = [];
    for (const [index, segment] of segments.entries()) {
        const blob = await getMediaBlob(segment.videoKey);
        if (!blob) throw new Error(`第 ${index + 1} 段「${segment.title}」的视频数据缺失，无法拼接`);
        blobs.push(blob);
    }
    for (const [index, blob] of blobs.entries()) {
        onProgress?.({ phase: "uploading", current: index + 1, total: blobs.length });
        await request(`${endpoint}/export/segments?jobId=${encodeURIComponent(jobId)}&index=${index}`, { method: "POST", headers: { ...headers, "content-type": "application/octet-stream" }, body: blob });
    }
    onProgress?.({ phase: "stitching" });
    const result = await request<{ outputPath: string; mode: "copy" | "reencode" }>(`${endpoint}/export/stitch`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ jobId, count: segments.length, title }) });
    return { outputPath: result.outputPath, mode: result.mode };
}

export async function revealFinalCut(outputPath: string) {
    const { endpoint, token } = agentConnection();
    await request(`${endpoint}/export/reveal`, { method: "POST", headers: { "x-canvas-agent-token": token, "content-type": "application/json" }, body: JSON.stringify({ path: outputPath }) });
}

async function request<T = Record<string, never>>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    const data = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok || data.error) throw new Error(data.error || "本地 Agent 请求失败");
    return data;
}
