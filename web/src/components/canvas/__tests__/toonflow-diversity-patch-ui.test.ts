/**
 * 「一键修改方案」交互层的渲染测试（设计文档 4.5）。
 * 测试环境是 node（无 DOM），用 react-dom/server 静态渲染断言界面上出现/不出现了什么；
 * 勾选→应用这条链路则通过 pickSelectedPatches 这个纯函数接到 applyDiversityPatch 上做端到端断言，
 * 保证「部分应用」是真的只把勾选的那几条传下去，而不是靠断言组件内部状态糊过去。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { applyDiversityPatch, type DiversityPatchSkip } from "@/lib/toonflow/node-runtime";
import type { QualityCheckItem, QualityCheckReport } from "@/lib/toonflow/quality-check";
import type { DiversityPatch, DiversityPatchItem, ShotContract, StoryboardRow } from "@/lib/toonflow/schema";
import { ToonflowDiversityPatchPanel, ToonflowQualityCheckPanel, diversityPatchKey, pickSelectedPatches } from "../toonflow-plus-node-views";

const background = "#292524";

function item(overrides: Partial<QualityCheckItem> & Pick<QualityCheckItem, "kind" | "status">): QualityCheckItem {
    return {
        label: "运镜多样性",
        shotIds: [],
        actualValue: "1 种（固定）",
        expectedValue: "≥2 种",
        reason: "说明文案",
        ...overrides,
    };
}

function report(items: QualityCheckItem[]): QualityCheckReport {
    return {
        items,
        summary: {
            total: items.length,
            passed: items.filter((entry) => entry.status === "pass").length,
            failed: items.filter((entry) => entry.status === "fail").length,
            unknown: items.filter((entry) => entry.status === "unknown").length,
        },
    };
}

function renderQualityPanel(items: QualityCheckItem[], withRepair: boolean): string {
    return renderToStaticMarkup(createElement(ToonflowQualityCheckPanel, { report: report(items), background, onRepair: withRepair ? () => {} : undefined }));
}

describe("质量检查面板上的「生成修改方案」入口", () => {
    it("有不达标项时出现入口", () => {
        const html = renderQualityPanel([item({ kind: "cameraMovementDiversity", status: "fail", shotIds: ["shot2"] })], true);

        expect(html).toContain("生成修改方案");
        expect(html).toContain("<button");
    });

    it("没有不达标项时不出现入口（只剩通过/待定，没什么可修）", () => {
        const passedOnly = renderQualityPanel([item({ kind: "cameraMovementDiversity", status: "pass" })], true);
        const unknownOnly = renderQualityPanel([item({ kind: "cameraMovementDiversity", status: "unknown" })], true);

        expect(passedOnly).not.toContain("生成修改方案");
        expect(unknownOnly).not.toContain("生成修改方案");
    });

    it("调用方不给回调时不渲染入口（保持 D4 的纯提示形态）", () => {
        expect(renderQualityPanel([item({ kind: "cameraMovementDiversity", status: "fail", shotIds: ["shot2"] })], false)).not.toContain("生成修改方案");
    });
});

function patch(overrides: Partial<DiversityPatchItem> = {}): DiversityPatchItem {
    return {
        shotId: "shot1",
        target: "shotContract",
        field: "movement",
        oldValue: "固定位微动",
        newValue: "急推/急拉",
        reason: "本段三镜全是固定位微动，改此镜以凑齐 ≥2 种运镜",
        fixes: [{ kind: "cameraMovementDiversity", segmentId: "seg1" }],
        ...overrides,
    };
}

function row(overrides: Partial<StoryboardRow> = {}): StoryboardRow {
    return {
        segmentId: "seg1",
        shotId: "shot1",
        shotNo: 1,
        scale: "L2 中景/中全景",
        angle: "平视",
        action: "角色抬手",
        line: "你好",
        sfx: "环境声",
        mood: "平静",
        durationSec: 3,
        assetSlots: [],
        ...overrides,
    };
}

function contract(overrides: Partial<ShotContract> = {}): ShotContract {
    return {
        shotId: "shot1",
        scale: "L2 中景/中全景",
        angle: "平视",
        movement: "固定位微动",
        speed: "常速",
        subjectRelation: "单人",
        endpoint: "停在正脸",
        inOut: { include: [], exclude: [] },
        ...overrides,
    };
}

function renderPatchPanel(props: Partial<Parameters<typeof ToonflowDiversityPatchPanel>[0]>): string {
    return renderToStaticMarkup(createElement(ToonflowDiversityPatchPanel, { onApply: () => {}, onClose: () => {}, ...props }));
}

describe("ToonflowDiversityPatchPanel", () => {
    const twoPatches: DiversityPatch = {
        targets: [{ kind: "cameraMovementDiversity", segmentId: "seg1" }],
        patches: [patch(), patch({ shotId: "shot2", target: "storyboardRow", field: "scale", oldValue: "L3 近景/中近景", newValue: "L5 大特写", reason: "本段缺极值景别" })],
        summary: "两条定点修",
    };

    it("逐条列出涉及的镜、改哪份产物的哪个字段、从什么改成什么、为什么改", () => {
        const html = renderPatchPanel({ patch: twoPatches });

        expect(html).toContain("shot1 · 镜头合同运镜");
        expect(html).toContain("固定位微动");
        expect(html).toContain("急推/急拉");
        expect(html).toContain("本段三镜全是固定位微动，改此镜以凑齐 ≥2 种运镜");
        expect(html).toContain("shot2 · 分镜表景别");
        expect(html).toContain("L5 大特写");
        expect(html).toContain("本段缺极值景别");
    });

    it("默认全选，三个操作（忽略 / 应用所选 / 全部应用）都在", () => {
        const html = renderPatchPanel({ patch: twoPatches });

        expect(html).toContain("已选 2 / 2 条");
        // antd 会给两个汉字的按钮文案插空格（忽略 → 忽 略），断言按钮文案前先抹平。
        const buttons = html.replace(/([一-龥])\s+([一-龥])/g, "$1$2");
        expect(buttons).toContain("忽略");
        expect(buttons).toContain("应用所选");
        expect(buttons).toContain("全部应用");
    });

    it("解析失败时把原因显示给用户，不静默失败", () => {
        const html = renderPatchPanel({ error: "JSON 校验失败：patches[0].target 非法" });

        expect(html).toContain("修改方案生成失败");
        expect(html).toContain("JSON 校验失败：patches[0].target 非法");
    });

    it("模型给了空补丁时给出空态而不是空白弹窗", () => {
        expect(renderPatchPanel({ patch: { targets: [], patches: [] } })).toContain("模型没有给出可应用的修改条目。");
    });

    it("skipped 条目对用户可见：逐条列出是哪一条、为什么没应用", () => {
        const skipped: DiversityPatchSkip[] = [{ patch: patch({ shotId: "ghost" }), reason: "镜头合同里找不到镜头 ghost" }];
        const html = renderPatchPanel({ outcome: { appliedCount: 1, skipped } });

        expect(html).toContain("已应用 1 条修改");
        expect(html).toContain("有 1 条未应用");
        expect(html).toContain("ghost · 镜头合同运镜");
        expect(html).toContain("镜头合同里找不到镜头 ghost");
    });
});

describe("部分应用：只有被勾选的补丁进入 applyDiversityPatch", () => {
    it("取消勾选的那条既不出现在 applied，对应镜头也逐字未变", () => {
        const rows = [row({ shotId: "shot1", shotNo: 1 }), row({ shotId: "shot2", shotNo: 2, scale: "L3 近景/中近景", angle: "俯视" })];
        const shotContracts = [contract({ shotId: "shot1" }), contract({ shotId: "shot2" })];
        const patches = [patch({ shotId: "shot1" }), patch({ shotId: "shot2", newValue: "环绕镜头" })];

        // 用户只留下第一条勾选（第二条被取消）。
        const selectedKeys = [diversityPatchKey(patches[0], 0)];
        const selected = pickSelectedPatches(patches, selectedKeys);
        expect(selected).toEqual([patches[0]]);

        const result = applyDiversityPatch({ rows, shotContracts }, selected);

        expect(result.applied).toEqual([patches[0]]);
        expect(result.skipped).toEqual([]);
        expect(result.shotContracts[0].movement).toBe("急推/急拉");
        expect(result.shotContracts[1]).toEqual(shotContracts[1]);
    });

    it("同一镜同一字段的两份产物各有一条补丁时，key 不串（可以只应用其中一条）", () => {
        const patches = [patch({ shotId: "shot1", target: "storyboardRow", field: "scale" }), patch({ shotId: "shot1", target: "shotContract", field: "scale" })];

        expect(diversityPatchKey(patches[0], 0)).not.toBe(diversityPatchKey(patches[1], 1));
        expect(pickSelectedPatches(patches, [diversityPatchKey(patches[1], 1)])).toEqual([patches[1]]);
    });
});
