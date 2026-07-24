import { describe, expect, it } from "vitest";

import {
    SLIM_CHARS_THRESHOLD,
    SLIM_MESSAGE_THRESHOLD,
    buildSlimSummaryInput,
    buildSlimSummaryPrompt,
    composeSlimPrefixedPrompt,
    shouldSuggestSlim,
} from "../thread-slim";

describe("shouldSuggestSlim", () => {
    it("等于两个阈值时不触发", () => {
        expect(shouldSuggestSlim({ messageCount: SLIM_MESSAGE_THRESHOLD, totalChars: SLIM_CHARS_THRESHOLD })).toBe(false);
    });

    it("消息数超过阈值时触发", () => {
        expect(shouldSuggestSlim({ messageCount: SLIM_MESSAGE_THRESHOLD + 1, totalChars: 0 })).toBe(true);
    });

    it("字符数超过阈值时触发", () => {
        expect(shouldSuggestSlim({ messageCount: 0, totalChars: SLIM_CHARS_THRESHOLD + 1 })).toBe(true);
    });

    it("任一阈值超过即触发", () => {
        expect(shouldSuggestSlim({ messageCount: SLIM_MESSAGE_THRESHOLD + 1, totalChars: SLIM_CHARS_THRESHOLD })).toBe(true);
        expect(shouldSuggestSlim({ messageCount: SLIM_MESSAGE_THRESHOLD, totalChars: SLIM_CHARS_THRESHOLD + 1 })).toBe(true);
    });
});

describe("buildSlimSummaryInput", () => {
    it("空消息列表安全返回空字符串", () => {
        expect(buildSlimSummaryInput([])).toBe("");
    });

    it("超长内容保留开头目标和最近进展并标注中段省略", () => {
        const input = buildSlimSummaryInput([
            { role: "user", text: `开头目标${"A".repeat(8_000)}` },
            { role: "assistant", text: `中段内容${"M".repeat(12_000)}` },
            { role: "assistant", text: `${"Z".repeat(12_000)}最近进展` },
        ]);

        expect(input).toContain("开头目标");
        expect(input).toContain("…中段省略…");
        expect(input).toContain("最近进展");
        expect(input.length).toBeLessThanOrEqual(12_000);
    });
});

describe("buildSlimSummaryPrompt", () => {
    it("要求 500 字以内且只输出摘要正文", () => {
        const prompt = buildSlimSummaryPrompt("旧历史");
        expect(prompt).toContain("500 字以内");
        expect(prompt).toContain("只输出摘要正文");
        expect(prompt).toContain("旧历史");
    });
});

describe("composeSlimPrefixedPrompt", () => {
    it("把摘要垫在用户原文前", () => {
        expect(composeSlimPrefixedPrompt("已完成节点 A", "继续生成下一张图")).toBe("【前情摘要（来自上一会话的压缩记忆，供延续上下文）】\n已完成节点 A\n\n继续生成下一张图");
    });
});
