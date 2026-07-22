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

    it("创建响应必须确认 multipart 与实际参考音频接收数", async () => {
        post.mockResolvedValueOnce({ data: { success: true, data: { id: "bad-multipart", multipart: false, refAudioCount: 0 } } });
        await expect(createVideoGenerationTask(canoConfig, "multipart 校验")).rejects.toThrow("未按 multipart 接收");

        post.mockResolvedValueOnce({ data: { success: true, data: { id: "bad-audio-count", multipart: true, refAudioCount: 1 } } });
        await expect(createVideoGenerationTask(canoConfig, "音频数校验")).rejects.toThrow("提交 0，实际 1");
    });

    // 校验只对"回报了且对不上"生效。cano 是否回传这两个字段未经实测,把缺失当失败会让每一次
    // 无音频卡的正常生成都在任务已建好、已计费之后抛错。
    it("响应缺 multipart / refAudioCount 时放行，不丢弃已建任务", async () => {
        post.mockResolvedValueOnce({ data: { success: true, data: { id: "no-echo-fields" } } });
        await expect(createVideoGenerationTask(canoConfig, "字段缺失")).resolves.toMatchObject({ id: "no-echo-fields", provider: "cano" });
    });

    it("409 按 cano 幂等语义暴露，不作为网络错误重试", async () => {
        const conflict = { response: { status: 409, data: { message: "冲突" } } };
        isAxiosError.mockImplementation((error) => error === conflict);
        post.mockRejectedValueOnce(conflict);

        await expect(createVideoGenerationTask(canoConfig, "幂等冲突提示词")).rejects.toThrow("同一 Idempotency-Key 不能用于不同请求内容（409）");
        expect(post).toHaveBeenCalledTimes(1);
    });
});
