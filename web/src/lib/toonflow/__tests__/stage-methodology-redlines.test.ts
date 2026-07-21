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

    it("第一块新增的三个环节各有专属红线", () => {
        for (const kind of ["creative", "directing-lock", "continuity-table"] as const) {
            expect(STAGE_METHODOLOGY_REDLINES[kind]).not.toBe(AGENT_METHODOLOGY_BRIEF);
        }
        expect(STAGE_METHODOLOGY_REDLINES["directing-lock"]).toContain("只引用不复判");
        expect(STAGE_METHODOLOGY_REDLINES["continuity-table"]).toContain("道具只许被角色的手改变");
        expect(STAGE_METHODOLOGY_REDLINES["creative"]).toContain("零铺垫冲突先行");
    });

    // plus 弃用九宫格；只剩第三块的 video-workbench 尚未重构，其红线仍留旧表述，本轮不动。
    it("brief 与第一、二块环节红线不再出现九宫格表述", () => {
        expect(AGENT_METHODOLOGY_BRIEF).not.toContain("九宫格");
        for (const kind of [
            "creative",
            "script",
            "space-contract",
            "directing-lock",
            "continuity-table",
            "storyboard-table",
            "shot-contract",
            "action-contract",
            "storyboard-page",
            "keyframes",
        ] as const) {
            expect(STAGE_METHODOLOGY_REDLINES[kind]).not.toContain("九宫格");
        }
    });

    it("故事板页红线换成 Module3 照相级首帧，不再讲黑白线稿", () => {
        const redline = STAGE_METHODOLOGY_REDLINES["storyboard-page"];
        expect(redline).toContain("Module3照相级故事板");
        expect(redline).toContain("三层空间语法");
        expect(redline).toContain("缝合同画进首末格");
        expect(redline).toContain("ST色板锚定句");
        // 「线稿」只许以否定形式出现（不是线稿预演），不许再出现「黑白粗线稿 / 只上色不改构图」这类旧线要求。
        expect(redline).toContain("不是线稿预演");
        expect(redline).not.toContain("黑白");
        expect(redline).not.toContain("只上色");
    });

    it("首帧红线标明已退役、仅为兼容旧画布保留", () => {
        const redline = STAGE_METHODOLOGY_REDLINES["keyframes"];
        expect(redline).toContain("已退役");
        expect(redline).toContain("兼容旧画布");
        expect(redline).not.toContain("只上色不改构图");
    });
});
