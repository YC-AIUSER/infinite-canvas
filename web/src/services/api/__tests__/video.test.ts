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

describe("cano 内容审核重试", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        post.mockReset();
        get.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("CONTENT_BLOCKED 最多重新提交 2 次，全部失败后保留原文并提示可再次尝试", async () => {
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
});
