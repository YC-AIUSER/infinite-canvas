// 有线程记录大小时只按真实 rollout 字节数判断；旧版 Agent 或文件查找失败时才用宽松兜底。
export const SLIM_ROLLOUT_BYTES_THRESHOLD = 500_000;
export const SLIM_MESSAGE_THRESHOLD = 120;
export const SLIM_CHARS_THRESHOLD = 300_000;

const SLIM_INPUT_MAX_CHARS = 12_000;
const SLIM_OMISSION_MARK = "\n\n…中段省略…\n\n";

type SlimMessage = {
    role?: string;
    title?: string;
    text?: string;
};

export function shouldSuggestSlim({ messageCount, totalChars, rolloutBytes }: { messageCount: number; totalChars: number; rolloutBytes?: number }): boolean {
    if (rolloutBytes !== undefined) return rolloutBytes > SLIM_ROLLOUT_BYTES_THRESHOLD;
    return messageCount > SLIM_MESSAGE_THRESHOLD || totalChars > SLIM_CHARS_THRESHOLD;
}

export function buildSlimSummaryInput(messages: readonly SlimMessage[]): string {
    const input = messages
        .map((item, index) => {
            const title = item.title?.trim();
            const label = [roleLabel(item.role), title].filter(Boolean).join(" · ");
            return `【${index + 1}｜${label}】\n${item.text?.trim() || ""}`;
        })
        .join("\n\n");
    if (input.length <= SLIM_INPUT_MAX_CHARS) return input;

    const contentBudget = SLIM_INPUT_MAX_CHARS - SLIM_OMISSION_MARK.length;
    const headLength = Math.floor(contentBudget / 3);
    const tailLength = contentBudget - headLength;
    return `${input.slice(0, headLength)}${SLIM_OMISSION_MARK}${input.slice(-tailLength)}`;
}

export function buildSlimSummaryPrompt(input: string): string {
    return `请把下面的旧会话压缩成 500 字以内的结构化前情摘要，供新会话无缝延续。

摘要必须覆盖：
1. 本次目标
2. 已完成
3. 关键决策
4. 进行中与下一步
5. 涉及的画布节点或素材关键名称

忠实保留事实、约束、未解决问题和必要名称，不要补充原文没有的信息。只输出摘要正文，不要解释摘要过程，也不要使用代码围栏。

旧会话内容：
${input}`;
}

export function composeSlimPrefixedPrompt(summary: string, userText: string): string {
    return `【前情摘要（来自上一会话的压缩记忆，供延续上下文）】\n${summary}\n\n${userText}`;
}

function roleLabel(role?: string) {
    if (role === "user") return "用户";
    if (role === "assistant") return "Codex";
    if (role === "tool") return "工具";
    if (role === "system") return "系统";
    if (role === "error") return "错误";
    return role?.trim() || "消息";
}
