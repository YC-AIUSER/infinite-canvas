/**
 * ToonflowNodeContent 的操作区渲染测试（react-dom/server 静态渲染，node 环境无 DOM，够断言按钮存在与否）。
 * 重点锁死一条不变量：选修环节节点（creative，模板默认状态就是 skipped）必须有生成入口。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ToonflowNodeContent } from "@/components/canvas/toonflow-node-content";
import { CanvasNodeType, type CanvasNodeData, type ToonflowNodeKind, type ToonflowNodeStageStatus } from "@/types/canvas";

function toonflowNode(kind: ToonflowNodeKind, status: ToonflowNodeStageStatus, title = "创意（选修）"): CanvasNodeData {
    return {
        id: "node-1",
        type: CanvasNodeType.Text,
        title,
        position: { x: 0, y: 0 },
        width: 320,
        height: 190,
        metadata: {
            toonflow: {
                kind,
                stage: "P0 创意",
                status,
                summary: "选修环节，可整节跳过。",
                checks: ["爽点覆盖", "结尾钩子"],
                outputs: ["创意体检报告"],
            },
        },
    };
}

/** antd 会给两个汉字的按钮文案自动插空格（生成 → 生 成），断言前先把汉字之间的空格去掉。 */
function normalize(html: string): string {
    return html.replace(/([一-龥])\s+([一-龥])/g, "$1$2");
}

function render(node: CanvasNodeData, cascadeLocked = false): string {
    return normalize(renderToStaticMarkup(createElement(ToonflowNodeContent, { node, cascadeLocked })));
}

describe("ToonflowNodeContent 操作区", () => {
    it("选修环节节点处于 skipped 时仍渲染出生成入口", () => {
        // 回归防线：creative 模板默认状态是 skipped（一键跑全链不为选修环节花钱），
        // 状态机允许 skipped → generating，但如果操作区不给按钮，用户在画布上永远点不到，功能不可达。
        const html = render(toonflowNode("creative", "skipped"));

        expect(html).toContain("启用并生成");
        expect(html).toContain("<button");
    });

    it("skipped 的生成入口默认可点，只有级联锁定时才禁用", () => {
        expect(render(toonflowNode("creative", "skipped"))).not.toContain("disabled");
        expect(render(toonflowNode("creative", "skipped"), true)).toContain("disabled");
    });

    it("选修环节生成完进入 review 后走通用操作区（通过 / 重生成），不再出现启用入口", () => {
        const html = render(toonflowNode("creative", "review"));

        expect(html).toContain("通过");
        expect(html).toContain("重生成");
        expect(html).not.toContain("启用并生成");
    });

    it("未开始的常规节点仍是「生成」而不是「启用并生成」", () => {
        const html = render(toonflowNode("script", "empty", "剧本"));

        expect(html).toContain("生成");
        expect(html).not.toContain("启用并生成");
    });
});
