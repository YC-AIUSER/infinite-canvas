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

function videoWorkbench(segmentId?: string, withProblem = false): CanvasNodeData {
    return {
        ...toonflowNode("video-workbench", "approved", "视频工作台"),
        type: CanvasNodeType.Video,
        metadata: {
            toonflow: {
                ...toonflowNode("video-workbench", "approved").metadata!.toonflow!,
                stage: "视频生成",
                segmentId,
                output: {
                    nodeId: "node-1",
                    kind: "video-workbench",
                    version: 1,
                    status: "approved",
                    payload: {
                        videoKeys: ["video:legacy"],
                        qualityReview: withProblem ? { items: [{ key: "identity", checked: true, severity: "P1", note: "角色脸漂移" }] } : undefined,
                    },
                    upstreamVersions: {},
                    generatedAt: "2026-07-27T00:00:00.000Z",
                },
            },
        },
    };
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

    it("无 segmentId 但有 videoKeys 的旧视频工作台仍渲染七项质检", () => {
        const html = render(videoWorkbench());

        expect(html).toContain("身份连续性");
        expect(html).toContain("技术质量");
    });

    it("缺少分镜表镜头数时显示成本不可计算，并提供可选镜头号输入与回退说明", () => {
        const html = render(videoWorkbench("seg-a", true));

        expect(html).toContain("无法计算返修成本（缺少分镜表镜头数）");
        expect(html).toContain("镜头号（可选，逗号分隔）");
        expect(html).toContain("未指定镜头号时按项累加，可能高估");
    });
});

/**
 * 内容区的正文渲染。两条都是 2026-07-27 用户实测暴露的缺口：
 * 纯文本产物没有渲染分支（生成完正文原地消失），Agent 写进 metadata.content 的内容也不显示
 * （用户让 Agent 写完看画布纹丝不动，只能判断"Agent 没写进去"）。
 */
describe("ToonflowNodeContent 正文渲染", () => {
    function withOutputText(text: string): CanvasNodeData {
        const base = toonflowNode("script", "review", "剧本");
        return { ...base, metadata: { ...base.metadata, toonflow: { ...base.metadata!.toonflow!, output: { nodeId: "node-1", kind: "script", version: 1, status: "review", payload: { text }, upstreamVersions: {}, generatedAt: "2026-07-27T00:00:00.000Z" } } } };
    }

    it("纯文本产物直接渲染在节点上，而不是退回 checks 清单", () => {
        const html = render(withOutputText("第1场天台对峙：林野扔下伞。"));

        expect(html).toContain("第1场天台对峙：林野扔下伞。");
        expect(html).not.toContain("爽点覆盖");
    });

    it("没有产物时兜底渲染 Agent 写入的 metadata.content", () => {
        const base = toonflowNode("project", "empty", "项目 / 剧集");
        const html = render({ ...base, metadata: { ...base.metadata, content: "本集 165 秒，倒叙结构，三处爽点落在 12/48/120 秒。" } });

        expect(html).toContain("本集 165 秒，倒叙结构");
    });

    it("模板初始占位文案不占用正文区，仍显示 checks 清单", () => {
        const base = toonflowNode("project", "empty", "项目 / 剧集");
        const html = render({ ...base, metadata: { ...base.metadata, content: `项目 / 剧集\n${base.metadata!.toonflow!.summary}` } });

        expect(html).toContain("爽点覆盖");
        expect(html).not.toContain("选修环节，可整节跳过。选修环节");
    });
});

/** Codex 对抗审查 2026-07-27 疑点4：占位判据依赖标题，标题被 Agent 改写后判据失效。 */
describe("ToonflowNodeContent 占位判据", () => {
    it("标题被 Agent 改写后，模板占位文案仍不该被当成正文顶掉 checks 清单", () => {
        const base = toonflowNode("project", "empty", "项目 / 剧集");
        const summary = base.metadata!.toonflow!.summary;
        const html = render({ ...base, title: "项目 / 剧集｜EP1 起源-门开了", metadata: { ...base.metadata, content: `项目 / 剧集\n${summary}` } });

        expect(html).toContain("爽点覆盖");
        expect(html).not.toContain(`${summary}${summary}`);
    });
});
