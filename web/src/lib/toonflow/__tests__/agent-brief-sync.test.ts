import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AGENT_METHODOLOGY_BRIEF, STAGE_METHODOLOGY_REDLINES } from "../prompts";

// 决议 8B:Agent 注入的方法论文案单一事实源 = prompts.ts 的 AGENT_METHODOLOGY_BRIEF。
// canvas-agent 是独立发布包不能 import web/src,故内嵌同一份;此测试逐字锁定,禁止两处漂移。
const here = dirname(fileURLToPath(import.meta.url));
const canvasAgentConfigPath = resolve(here, "../../../../../canvas-agent/src/config.ts");

describe("Agent 方法论注入单源一致(决议 8B)", () => {
    it("canvas-agent 的 config.ts 内嵌与 AGENT_METHODOLOGY_BRIEF 逐字一致", () => {
        const source = readFileSync(canvasAgentConfigPath, "utf8");
        expect(source).toContain(AGENT_METHODOLOGY_BRIEF);
    });

    it("canvas-agent 逐字内嵌每条环节红线(单源一致)", () => {
        const source = readFileSync(canvasAgentConfigPath, "utf8");
        const distinct = [...new Set(Object.values(STAGE_METHODOLOGY_REDLINES))];
        for (const redline of distinct) {
            expect(source).toContain(redline);
        }
    });
});
