import { describe, expect, it } from "vitest";

import { TOONFLOW_NODE_KINDS } from "../schema";
import { AGENT_METHODOLOGY_BRIEF, STAGE_METHODOLOGY_REDLINES } from "../prompts";

describe("STAGE_METHODOLOGY_REDLINES", () => {
    it("覆盖全部 ToonflowNodeKind 且非空", () => {
        for (const kind of TOONFLOW_NODE_KINDS) {
            expect((STAGE_METHODOLOGY_REDLINES[kind]?.length ?? 0) > 0).toBe(true);
        }
    });

    it("video-workbench 红线含禁首尾帧", () => {
        expect(STAGE_METHODOLOGY_REDLINES["video-workbench"]).toContain("首尾帧");
    });

    it("无专属红线的环节回落全局三铁律", () => {
        expect(STAGE_METHODOLOGY_REDLINES["script"]).toBe(AGENT_METHODOLOGY_BRIEF);
    });
});
