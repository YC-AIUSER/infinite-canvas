import { describe, expect, it } from "vitest";

import { TOONFLOW_NODE_KINDS } from "../schema";
import { AGENT_METHODOLOGY_BRIEF, STAGE_METHODOLOGY_REDLINES } from "../prompts";

describe("STAGE_METHODOLOGY_REDLINES", () => {
    it("覆盖全部 ToonflowNodeKind 且非空", () => {
        for (const kind of TOONFLOW_NODE_KINDS) {
            expect((STAGE_METHODOLOGY_REDLINES[kind]?.length ?? 0) > 0).toBe(true);
        }
    });

    it("video-workbench 红线锁定Module4两步生成、禁则与缝合同", () => {
        const redline = STAGE_METHODOLOGY_REDLINES["video-workbench"];
        expect(redline).toContain("Module4六段文本");
        expect(redline).toContain("违规带反馈自动重试1次");
        expect(redline).toContain("用户确认才用该文本调用cano");
        expect(redline).toContain("按故事板镜头顺序自然推进");
        expect(redline).toContain("逐句写死左右站位");
        expect(redline).toContain("ST色板锚定句");
        expect(redline).toContain("有入缝首句接同一动作后半");
        expect(redline).toContain("限制段尾0.5s持续音");
        expect(redline).toContain("禁人声/对白/旁白与字幕水印");
        expect(redline).not.toContain("1:1");
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

    it("brief 与各环节红线不再依赖九宫格旧表述", () => {
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
            "video-workbench",
        ] as const) {
            expect(STAGE_METHODOLOGY_REDLINES[kind]).not.toContain("九宫格");
        }
    });

    it("故事板页红线锁定 Module3 blockout 灰模职责", () => {
        const redline = STAGE_METHODOLOGY_REDLINES["storyboard-page"];
        expect(redline).toContain("Module3 blockout粗模");
        expect(redline).toContain("未贴图灰模");
        expect(redline).toContain("同一种哑光中性灰");
        expect(redline).toContain("三层空间语法");
        expect(redline).toContain("POV点明前景锚点物");
        expect(redline).toContain("装备仅保留最大一级体积轮廓");
        expect(redline).toContain("人物外观与装备由视频层角色卡承担");
        expect(redline).toContain("缝合同画进首末格");
        expect(redline).toContain("不追加ST色板锚定句");
        for (const retired of ["照相级", "首帧主参考", "装备一起画全"]) expect(redline).not.toContain(retired);
    });

    it("首帧红线标明已退役、仅为兼容旧画布保留", () => {
        const redline = STAGE_METHODOLOGY_REDLINES["keyframes"];
        expect(redline).toContain("已退役");
        expect(redline).toContain("兼容旧画布");
        expect(redline).toContain("不生成、不引用首帧组");
        expect(redline).not.toContain("只上色不改构图");
    });
});
