/**
 * Toonflow plus 新节点产物视图与质量检查面板的渲染测试。
 * 用 react-dom/server 渲染成静态 HTML 断言：测试环境是 node（无 DOM），三个视图都是纯展示组件，够用。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { QualityCheckItem, QualityCheckReport } from "@/lib/toonflow/quality-check";
import type { ContinuityTable, DirectingLock } from "@/lib/toonflow/schema";
import { ToonflowContinuityTableView, ToonflowDirectingLockView, ToonflowQualityCheckPanel } from "../toonflow-plus-node-views";

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

function renderQualityPanel(items: QualityCheckItem[]): string {
    return renderToStaticMarkup(createElement(ToonflowQualityCheckPanel, { report: report(items), background }));
}

describe("ToonflowQualityCheckPanel", () => {
    it("渲染不达标项的检查项名、实际值/要求值与涉及的镜头", () => {
        const html = renderQualityPanel([item({ kind: "cameraMovementDiversity", status: "fail", segmentId: "seg-1", shotIds: ["S1-03", "S1-04"], reason: "段 seg-1 只用了 1 种运镜。" })]);

        expect(html).toContain("运镜多样性");
        expect(html).toContain("1 种（固定）");
        expect(html).toContain("≥2 种");
        expect(html).toContain("涉及镜头 S1-03、S1-04");
        expect(html).toContain("段 seg-1 只用了 1 种运镜。");
        expect(html).toContain("1 项不达标");
    });

    it("涉及镜头过多时只列前 6 个并折成计数", () => {
        const shotIds = ["S1-01", "S1-02", "S1-03", "S1-04", "S1-05", "S1-06", "S1-07"];
        const html = renderQualityPanel([item({ kind: "shotScaleSpan", status: "fail", shotIds })]);

        expect(html).toContain("涉及镜头 S1-01、S1-02、S1-03、S1-04、S1-05、S1-06 等 7 个");
    });

    it("待定项与不达标项的视觉状态不同（配色 + 标签 + 状态标记都区分开）", () => {
        const failHtml = renderQualityPanel([item({ kind: "cameraMovementDiversity", status: "fail" })]);
        const unknownHtml = renderQualityPanel([item({ kind: "cameraMovementDiversity", status: "unknown" })]);

        expect(failHtml).toContain('data-check-status="fail"');
        expect(failHtml).toContain("不达标");
        expect(failHtml).toContain("#dc2626");

        expect(unknownHtml).toContain('data-check-status="unknown"');
        expect(unknownHtml).toContain("待定");
        expect(unknownHtml).not.toContain("#dc2626");
        expect(unknownHtml).not.toContain("不达标");
        expect(unknownHtml).toContain("#78716c");
    });

    it("全部通过时给简洁通过态，不出现任何不达标/待定字样", () => {
        const html = renderQualityPanel([item({ kind: "cameraMovementDiversity", status: "pass" }), item({ kind: "angleDiversity", status: "pass" })]);

        expect(html).toContain("2 项检查全部通过");
        expect(html).not.toContain("不达标");
        expect(html).not.toContain("待定");
        expect(html).not.toContain('data-check-status="fail"');
    });

    it("有不达标项时不渲染任何按钮（只提示不阻断）", () => {
        const html = renderQualityPanel([item({ kind: "cameraMovementDiversity", status: "fail", shotIds: ["S1-01"] })]);

        expect(html).not.toContain("<button");
        expect(html).not.toContain("disabled");
    });
});

const lock: DirectingLock = {
    global: {
        visualStyle: "写实电影感",
        colorGrading: "冷调低饱和",
        lighting: "侧逆光",
        cameraTone: "手持微晃",
        performanceLevel: "L3",
        unifiedStyleString: "cinematic, cold tone",
        motifs: ["雨", "红伞"],
    },
    segments: [
        {
            segmentId: "seg-1",
            compositionPrimary: "对角线驱动",
            compositionSecondary: "前景切割",
            compositionDiversity: "2 种",
            cameraType: "推",
            scaleRange: "L1-L4",
            angleType: "俯视",
            openingType: "空镜入",
        },
    ],
    seams: [
        {
            fromSegmentId: "seg-1",
            toSegmentId: "seg-2",
            prevEndBeat: "手举到一半",
            nextFirstPanel: "手继续下落",
            scaleOrMotivation: "跳两档到特写",
            soundBridge: "J-cut",
        },
    ],
};

describe("ToonflowDirectingLockView", () => {
    it("摘要给出 A 表锁定项数、B 表段数与缝合同数", () => {
        const html = renderToStaticMarkup(createElement(ToonflowDirectingLockView, { lock, background }));

        expect(html).toContain("A 表已锁 7 项 · B 表 1 段 · 缝合同 1 处");
    });

    it("A 表 / B 表 / 缝合同三块分区展示各自字段", () => {
        const html = renderToStaticMarkup(createElement(ToonflowDirectingLockView, { lock, background }));

        expect(html).toContain("A 表 · 全局锁定");
        expect(html).toContain("写实电影感");
        expect(html).toContain("雨、红伞");
        expect(html).toContain("B 表 · 逐段锁定（1 段）");
        expect(html).toContain("对角线驱动");
        expect(html).toContain("开场类型");
        expect(html).toContain("缝合同（1 处）");
        expect(html).toContain("seg-1 → seg-2");
        expect(html).toContain("J-cut");
    });

    it("缺 B 表与缝合同时只渲染 A 表", () => {
        const html = renderToStaticMarkup(createElement(ToonflowDirectingLockView, { lock: { global: lock.global }, background }));

        expect(html).toContain("A 表已锁 7 项 · B 表 0 段 · 缝合同 0 处");
        expect(html).not.toContain("B 表 · 逐段锁定");
        expect(html).not.toContain("缝合同（");
    });
});

describe("ToonflowContinuityTableView", () => {
    const table: ContinuityTable = {
        propWhitelist: [{ name: "咖啡杯", lockedValue: "半满，杯耳朝右" }],
        blocking: [
            { name: "阿May", lockedValue: "坐左侧" },
            { name: "老陈", lockedValue: "站窗边" },
        ],
        leftovers: [{ name: "碎玻璃", lockedValue: "第 3 段起地面残留" }],
    };

    it("摘要按类目给出条目数，明细逐类展示名称与锁定值", () => {
        const html = renderToStaticMarkup(createElement(ToonflowContinuityTableView, { table, background }));

        expect(html).toContain("3 类共 4 项锁定");
        expect(html).toContain("道具白名单1");
        expect(html).toContain("站位姿态（2 项）");
        expect(html).toContain("半满，杯耳朝右");
        expect(html).toContain("第 3 段起地面残留");
        expect(html).not.toContain("光向天气（");
    });

    it("整表为空时给出空态而不是空白", () => {
        const html = renderToStaticMarkup(createElement(ToonflowContinuityTableView, { table: {}, background }));

        expect(html).toContain("0 类共 0 项锁定");
        expect(html).toContain("继承表暂无锁定项");
    });
});
