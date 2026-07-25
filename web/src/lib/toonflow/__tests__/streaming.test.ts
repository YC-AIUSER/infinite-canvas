import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData, type ToonflowNodeKind } from "../../../types/canvas";
import { hydrateToonflowProject } from "../node-runtime";
import { RAW_STREAM_TAIL_LIMIT, STREAM_MIN_HEIGHT, collapseNodeAfterStream, expandNodeForStream, isStructuredStreamKind, resolveStreamPreview, tailText } from "../streaming";

function meta(kind: ToonflowNodeKind, status: "empty" | "generating" | "review" | "approved", streamingText?: string) {
    return { kind, status, streamingText } as const;
}

function streamNode(height: number, extra: Partial<CanvasNodeData["metadata"] extends infer M ? (M extends { toonflow?: infer T } ? T : never) : never> = {}): CanvasNodeData {
    return {
        id: "n1",
        type: CanvasNodeType.Text,
        title: "剧本",
        position: { x: 0, y: 0 },
        width: 320,
        height,
        metadata: { toonflow: { kind: "script", stage: "剧本", status: "generating", summary: "", checks: [], ...extra } },
    };
}

describe("resolveStreamPreview", () => {
    it("非生成中不接管内容区——落定后的产物渲染不能被残留原始流盖住", () => {
        expect(resolveStreamPreview(meta("script", "review", "已经写完的剧本"))).toBeNull();
        expect(resolveStreamPreview(meta("script", "approved", "已经写完的剧本"))).toBeNull();
        expect(resolveStreamPreview(meta("script", "empty", "残留"))).toBeNull();
    });

    it("生成中但流为空/空白时不接管——首字未到之前保持原有的清单占位", () => {
        expect(resolveStreamPreview(meta("script", "generating", undefined))).toBeNull();
        expect(resolveStreamPreview(meta("script", "generating", ""))).toBeNull();
        expect(resolveStreamPreview(meta("script", "generating", "   \n  "))).toBeNull();
    });

    it("纯文本产物按正文全文渲染,不截断", () => {
        const long = "剧".repeat(RAW_STREAM_TAIL_LIMIT * 2);
        expect(resolveStreamPreview(meta("script", "generating", long))).toEqual({ mode: "text", text: long });
        expect(resolveStreamPreview(meta("video-workbench", "generating", "一、参考图索引"))).toEqual({ mode: "text", text: "一、参考图索引" });
        expect(resolveStreamPreview(meta("creative", "generating", "创意流"))).toEqual({ mode: "text", text: "创意流" });
    });

    it("结构化产物走 raw 模式并只留尾部——半截 JSON 不冒充正文", () => {
        const halfJson = `{"table":[${'{"shot":1},'.repeat(200)}`;
        const preview = resolveStreamPreview(meta("storyboard-table", "generating", halfJson));
        expect(preview?.mode).toBe("raw");
        expect(preview?.text.startsWith("…")).toBe(true);
        // 尾部截断后长度 = 省略号 + 上限
        expect(preview?.text.length).toBe(RAW_STREAM_TAIL_LIMIT + 1);
        expect(halfJson.endsWith(preview!.text.slice(1))).toBe(true);
    });

    it("结构化产物短流不加省略号——没截断就不该暗示前面还有内容", () => {
        const preview = resolveStreamPreview(meta("directing-lock", "generating", '{"seams":['));
        expect(preview).toEqual({ mode: "raw", text: '{"seams":[' });
    });
});

describe("isStructuredStreamKind", () => {
    it("四个 JSON 产物环节归为结构化,其余为文本", () => {
        (["storyboard-table", "directing-lock", "continuity-table", "assets"] as ToonflowNodeKind[]).forEach((kind) => {
            expect(isStructuredStreamKind(kind)).toBe(true);
        });
        (["script", "creative", "video-workbench", "shot-contract", "action-contract", "space-contract"] as ToonflowNodeKind[]).forEach((kind) => {
            expect(isStructuredStreamKind(kind)).toBe(false);
        });
    });
});

describe("expandNodeForStream / collapseNodeAfterStream", () => {
    it("矮节点被撑高并记住原高度,收尾原样还回去", () => {
        const node = streamNode(190);
        const expanded = expandNodeForStream(node, "第一段");
        expect(expanded.height).toBe(STREAM_MIN_HEIGHT);
        expect(expanded.metadata?.toonflow?.streamRestoreHeight).toBe(190);
        expect(expanded.metadata?.toonflow?.streamingText).toBe("第一段");

        const collapsed = collapseNodeAfterStream(expanded);
        expect(collapsed.height).toBe(190);
        expect(collapsed.metadata?.toonflow?.streamingText).toBeUndefined();
        expect(collapsed.metadata?.toonflow?.streamRestoreHeight).toBeUndefined();
    });

    it("续写不会把撑高后的高度再记成原高度——否则收尾还原会把节点永久钉死在撑高值", () => {
        const first = expandNodeForStream(streamNode(190), "一");
        const second = expandNodeForStream(first, "一二");
        const third = expandNodeForStream(second, "一二三");
        expect(third.metadata?.toonflow?.streamRestoreHeight).toBe(190);
        expect(third.height).toBe(STREAM_MIN_HEIGHT);
        expect(collapseNodeAfterStream(third).height).toBe(190);
    });

    it("用户自己调得够高的节点不动尺寸,收尾也不改高度", () => {
        const tall = expandNodeForStream(streamNode(600), "内容");
        expect(tall.height).toBe(600);
        expect(tall.metadata?.toonflow?.streamRestoreHeight).toBeUndefined();
        expect(collapseNodeAfterStream(tall).height).toBe(600);
    });

    it("没有流式痕迹时 collapse 返回原对象,调用方可据此跳过重渲染", () => {
        const node = streamNode(190);
        expect(collapseNodeAfterStream(node)).toBe(node);
    });
});

describe("hydrateToonflowProject 与流式残留", () => {
    it("刷新后剥掉残留文本并还原撑高——否则节点永远卡在撑高状态", () => {
        const stuck = expandNodeForStream(streamNode(190), "写到一半就刷新了");
        const [result] = hydrateToonflowProject([stuck]);
        expect(result.height).toBe(190);
        expect(result.metadata?.toonflow?.streamingText).toBeUndefined();
        expect(result.metadata?.toonflow?.streamRestoreHeight).toBeUndefined();
        // 既有行为不变:生成中被刷新仍降级为可重试的 failed
        expect(result.metadata?.toonflow?.status).toBe("failed");
        expect(result.metadata?.errorDetails).toContain("页面已刷新");
    });

    it("状态无需迁移时也要清掉流式残留(不能被短路带回来)", () => {
        const node = expandNodeForStream(streamNode(190, { status: "review" }), "残留");
        const [result] = hydrateToonflowProject([node]);
        expect(result.metadata?.toonflow?.status).toBe("review");
        expect(result.metadata?.toonflow?.streamingText).toBeUndefined();
        expect(result.height).toBe(190);
    });
});

describe("tailText", () => {
    it("未超限原样返回,超限保留尾部", () => {
        expect(tailText("abc", 5)).toBe("abc");
        expect(tailText("abcde", 5)).toBe("abcde");
        expect(tailText("abcdef", 5)).toBe("…bcdef");
    });
});
