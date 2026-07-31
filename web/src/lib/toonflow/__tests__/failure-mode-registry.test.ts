import { describe, expect, it } from "vitest";

import {
    FAILURE_MODE_REGISTRY,
    composeFailureModePrevention,
    getFailureMode,
    queryFailureModes,
    type FailureModeRecord,
} from "../failure-mode-registry";
import { buildAssetCardPrompt, buildKeyframesPrompt, buildScriptPrompt, buildStoryboardPagePrompt } from "../prompts";
import type { StoryboardRow } from "../schema";

const row: StoryboardRow = {
    segmentId: "seg-a",
    shotId: "seg-a-shot-1",
    shotNo: 1,
    scale: "近景",
    angle: "平视",
    action: "主角拔刀",
    line: "",
    sfx: "",
    mood: "紧张",
    durationSec: 3,
};

describe("失败模式登记表", () => {
    it("包含至少五条可供预防、判定与修复复用的真实记录", () => {
        expect(FAILURE_MODE_REGISTRY.length).toBeGreaterThanOrEqual(5);
        for (const mode of FAILURE_MODE_REGISTRY) {
            expect(mode.id).toBeTruthy();
            expect(mode.preventionRule).toBeTruthy();
            expect(mode.forbiddenSentence).toBeTruthy();
            expect(mode.detectionRule).toBeTruthy();
            expect(mode.repairTemplate).toBeTruthy();
        }
        expect(getFailureMode("prop-shape-substitution")?.forbiddenSentence).toContain("指定刀型");
    });

    it("按提示词入口、资产类型与分类查询适用记录", () => {
        const storyboardIds = queryFailureModes({ promptKind: "storyboard-page" }).map((mode) => mode.id);
        const propIds = queryFailureModes({ promptKind: "asset-card", assetCardType: "prop" }).map((mode) => mode.id);
        const paletteIds = queryFailureModes({ promptKind: "asset-card", assetCardType: "palette" }).map((mode) => mode.id);

        expect(storyboardIds).toContain("intentional-blank-cell-filled");
        expect(storyboardIds).not.toContain("prop-shape-substitution");
        expect(propIds).toContain("prop-shape-substitution");
        expect(paletteIds).toContain("prompt-text-leakage");
        expect(paletteIds).not.toContain("reference-layout-leakage");
        expect(queryFailureModes({ promptKind: "keyframes", category: "layout" }).map((mode) => mode.id)).toEqual([
            "intentional-blank-cell-filled",
            "panel-content-duplication",
        ]);
    });

    it("闸门开关筛出可自动判定的条目，需比对参考图的条目一律不进闸门", () => {
        const gateIds = queryFailureModes({ promptKind: "keyframes", gateOnly: true }).map((mode) => mode.id);

        expect(gateIds).toContain("prompt-text-leakage");
        expect(gateIds).toContain("intentional-blank-cell-filled");
        // 这两条必须留在闸门外：单看候选图判不了，开了会误杀好格
        expect(gateIds).not.toContain("prop-shape-substitution");
        expect(gateIds).not.toContain("subject-count-invention");
        expect(queryFailureModes({ promptKind: "keyframes" }).length).toBeGreaterThan(gateIds.length);
    });

    it("注入结果随登记表数据变化，条目未硬编码进拼装逻辑", () => {
        const synthetic: FailureModeRecord[] = [
            {
                id: "synthetic-only",
                title: "合成条目",
                category: "layout",
                promptKinds: ["storyboard-page"],
                preventionRule: "合成预防规则。",
                forbiddenSentence: "合成禁令句。",
                detectionRule: "合成判定线索。",
                repairTemplate: "合成修复模板。",
                gateEnabled: true,
            },
        ];
        const section = composeFailureModePrevention({ promptKind: "storyboard-page" }, synthetic);

        expect(section).toContain("合成条目：合成预防规则。");
        expect(section).toContain("禁令：合成禁令句。");
        // 真实登记表里的条目不该出现——说明拼装只认传入数据
        expect(section).not.toContain("留空的格位必须保持纯空白");
    });

    it("拼装函数同时输出预防规则与禁令句，并只包含当前范围", () => {
        const section = composeFailureModePrevention({ promptKind: "asset-card", assetCardType: "prop" });
        expect(section).toContain("【失败模式预防（历史踩坑，逐条执行）】");
        expect(section).toContain("关键道具形态被替换");
        expect(section).toContain("禁令：禁止把指定刀型改成另一种刀剑");
        expect(section).not.toContain("刻意留空的网格被自行填充");
    });
});

describe("失败模式生成侧注入", () => {
    it("三个图像提示词入口自动注入适用规则", () => {
        const storyboard = buildStoryboardPagePrompt({ rows: [row], shotContracts: [], actionContracts: [] });
        const asset = buildAssetCardPrompt({ cardType: "prop", name: "雁翎刀", anchor: "单刃窄身雁翎刀" });
        const keyframes = buildKeyframesPrompt({ rows: [row], anchors: ["雁翎刀：单刃窄身"] });

        for (const prompt of [storyboard, asset, keyframes]) expect(prompt).toContain("【失败模式预防（历史踩坑，逐条执行）】");
        expect(storyboard).toContain("留空的格位必须保持纯空白");
        expect(asset).toContain("禁止把指定刀型改成另一种刀剑");
        expect(keyframes).toContain("禁止在留空格中补人物");
    });

    it("文本提示词入口不注入失败模式", () => {
        expect(buildScriptPrompt("测试上下文")).not.toContain("【失败模式预防（历史踩坑，逐条执行）】");
    });
});
