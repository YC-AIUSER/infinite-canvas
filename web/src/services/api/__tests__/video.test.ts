import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createVideoGenerationTask, pollVideoGenerationTask } from "../video";
import { defaultConfig, type AiConfig } from "@/stores/use-config-store";

vi.mock("axios", () => ({
    default: {
        post: vi.fn(),
        get: vi.fn(),
        isCancel: vi.fn(() => false),
        isAxiosError: vi.fn(() => false),
    },
}));

const canoConfig: AiConfig = {
    ...defaultConfig,
    baseUrl: "https://cano.gewuzhihui.com",
    apiKey: "test-key",
    model: "cano-model",
    videoModel: "cano-model",
    channels: [
        {
            id: "cano",
            name: "Cano",
            baseUrl: "https://cano.gewuzhihui.com",
            apiKey: "test-key",
            apiFormat: "openai",
            models: ["cano-model"],
        },
    ],
};

const post = vi.mocked(axios.post);
const get = vi.mocked(axios.get);
const isAxiosError = vi.mocked(axios.isAxiosError);

describe("cano 内容审核重试", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        post.mockReset();
        get.mockReset();
        isAxiosError.mockReset();
        isAxiosError.mockReturnValue(false);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("CONTENT_BLOCKED 最多重新提交 2 次，全部失败后保留原文并提示可再次尝试", async () => {
        // 建任务响应刻意不带 multipart/refAudioCount:cano 是否回传这两个字段未经实测确认,
        // 缺失必须当"未回报"放行,不能当失败——任务此刻已建好并计费,抛错等于把它丢掉。
        post.mockResolvedValueOnce({ data: { success: true, data: { id: "job-1" } } });
        post.mockResolvedValueOnce({ data: { success: true, data: { id: "job-2" } } });
        post.mockResolvedValueOnce({ data: { success: true, data: { id: "job-3" } } });
        get.mockResolvedValue({ data: { success: true, data: { status: "FAILED", errorClass: "CONTENT_BLOCKED", errorMessage: "内容被 Cano 安全审核拦截" } } });

        const task = await createVideoGenerationTask(canoConfig, "同一份提示词");

        const firstPoll = pollVideoGenerationTask(canoConfig, task);
        await vi.advanceTimersByTimeAsync(3000);
        await expect(firstPoll).resolves.toEqual({ status: "pending" });
        expect(task.id).toBe("job-2");

        const secondPoll = pollVideoGenerationTask(canoConfig, task);
        await vi.advanceTimersByTimeAsync(6000);
        await expect(secondPoll).resolves.toEqual({ status: "pending" });
        expect(task.id).toBe("job-3");

        await expect(pollVideoGenerationTask(canoConfig, task)).resolves.toEqual({
            status: "failed",
            error: "内容被 Cano 安全审核拦截；这是内容安全审核随机拦截，可再次尝试。",
        });
        expect(post).toHaveBeenCalledTimes(3);
        expect(get).toHaveBeenCalledTimes(3);
        expect(post.mock.calls.map(([, body]) => (body as FormData).get("prompt"))).toEqual(["同一份提示词", "同一份提示词", "同一份提示词"]);
        const keys = post.mock.calls.map(([, , config]) => (config?.headers as Record<string, string>)["Idempotency-Key"]);
        expect(new Set(keys).size).toBe(3);
    });

    it("VALIDATION_ERROR 不重试并立即返回原始错误", async () => {
        post.mockResolvedValueOnce({ data: { success: true, data: { id: "validation-job" } } });
        get.mockResolvedValueOnce({ data: { success: true, data: { status: "FAILED", errorClass: "VALIDATION_ERROR", errorMessage: "参数校验失败" } } });

        const task = await createVideoGenerationTask(canoConfig, "校验错误提示词");

        await expect(pollVideoGenerationTask(canoConfig, task)).resolves.toEqual({ status: "failed", error: "参数校验失败" });
        expect(post).toHaveBeenCalledTimes(1);
        expect(get).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("同一次建任务的传输层重试复用同一个 Idempotency-Key", async () => {
        const networkError = { request: {} };
        isAxiosError.mockImplementation((error) => error === networkError);
        post.mockRejectedValueOnce(networkError).mockResolvedValueOnce({ data: { success: true, data: { id: "job-after-network-retry", multipart: true, refAudioCount: 0 } } });

        await expect(createVideoGenerationTask(canoConfig, "网络重试提示词")).resolves.toMatchObject({ id: "job-after-network-retry", provider: "cano" });

        expect(post).toHaveBeenCalledTimes(2);
        const keys = post.mock.calls.map(([, , config]) => (config?.headers as Record<string, string>)["Idempotency-Key"]);
        expect(keys[0]).toBeTruthy();
        expect(keys[1]).toBe(keys[0]);
    });

    // 2026-07-22 真实调用实测:cano 建任务成功(有 id、已计费)但回显 multipart 不为 true、refAudioCount
    // 不回传。回显字段一旦有否决权,就会在任务已创建之后把结果丢掉,而 cano 侧照跑照扣费。故只记不拦。
    it("回显 multipart 不为 true / refAudioCount 缺失或对不上,一律不丢弃已建任务", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        post.mockResolvedValueOnce({ data: { success: true, data: { id: "not-multipart", multipart: false, refAudioCount: 0 } } });
        await expect(createVideoGenerationTask(canoConfig, "multipart 非 true")).resolves.toMatchObject({ id: "not-multipart" });

        post.mockResolvedValueOnce({ data: { success: true, data: { id: "audio-count-off", multipart: true, refAudioCount: 1 } } });
        await expect(createVideoGenerationTask(canoConfig, "音频数对不上")).resolves.toMatchObject({ id: "audio-count-off" });

        post.mockResolvedValueOnce({ data: { success: true, data: { id: "no-echo-fields" } } });
        await expect(createVideoGenerationTask(canoConfig, "字段缺失")).resolves.toMatchObject({ id: "no-echo-fields", provider: "cano" });

        expect(warn).toHaveBeenCalledTimes(3);
        expect(warn.mock.calls.every(([msg]) => String(msg).includes("仅记录，不影响本次生成"))).toBe(true);
        warn.mockRestore();
    });

    it("409 按 cano 幂等语义暴露，不作为网络错误重试", async () => {
        const conflict = { response: { status: 409, data: { message: "冲突" } } };
        isAxiosError.mockImplementation((error) => error === conflict);
        post.mockRejectedValueOnce(conflict);

        await expect(createVideoGenerationTask(canoConfig, "幂等冲突提示词")).rejects.toThrow("同一 Idempotency-Key 不能用于不同请求内容（409）");
        expect(post).toHaveBeenCalledTimes(1);
    });
});
