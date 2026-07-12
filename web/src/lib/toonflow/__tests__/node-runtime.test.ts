import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ToonflowNodeKind } from "../../../types/canvas";
import type { NodeOutput, NodeStatus, StoryboardRow } from "../schema";
import { applyApprove, applyGenerationSuccess, applyRegenerate, buildToonflowGeneration, computeUpstreamVersions, hydrateToonflowProject, propagateAfterNewVersion } from "../node-runtime";

function node(id: string, kind?: ToonflowNodeKind, content = "", status: NodeStatus = "empty"): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Text,
        title: id,
        position: { x: 0, y: 0 },
        width: 320,
        height: 190,
        metadata: {
            content,
            prompt: "已发送提示词",
            model: "test-model",
            toonflow: kind
                ? {
                      kind,
                      stage: "测试",
                      status,
                      summary: "测试节点",
                      checks: [],
                  }
                : undefined,
        },
    };
}

function connection(fromNodeId: string, toNodeId: string): CanvasConnection {
    return { id: `${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId };
}

function output(nodeId: string, kind: ToonflowNodeKind, version: number, status: NodeStatus = "review"): NodeOutput {
    return {
        nodeId,
        kind,
        version,
        status,
        payload: { text: `版本 ${version}` },
        upstreamVersions: {},
        generatedAt: `2026-07-12T00:00:${String(version).padStart(2, "0")}.000Z`,
    };
}

function storyboardRow(overrides: Partial<StoryboardRow> = {}): StoryboardRow {
    return {
        segmentId: "seg-a",
        shotId: "shot-a",
        shotNo: 1,
        scale: "中景",
        angle: "平视",
        action: "抬手",
        line: "你好",
        sfx: "环境声",
        mood: "平静",
        durationSec: 12,
        assetSlots: [],
        ...overrides,
    };
}

describe("buildToonflowGeneration", () => {
    it("把 project 祖先映射为 script 的 project 输入并执行洗词", () => {
        const nodes = [node("project", "project", "使用 iPhone 的项目"), node("script", "script")];
        const result = buildToonflowGeneration(nodes, [connection("project", "script")], "script");
        expect(result.finalPrompt).toContain("【project】");
        expect(result.finalPrompt).toContain("智能手机");
        expect(result.washHits).toEqual([{ term: "iPhone", replacement: "智能手机" }]);
    });

    it("递归收集分镜表的 script 与 space-contract 祖先并按优先级排列", () => {
        const nodes = [node("script", "script", "剧本"), node("space", "space-contract", "空间"), node("storyboard", "storyboard-table")];
        const result = buildToonflowGeneration(nodes, [connection("script", "space"), connection("space", "storyboard")], "storyboard");
        expect(result.finalPrompt.indexOf("【script】")).toBeLessThan(result.finalPrompt.indexOf("【space-contract】"));
    });

    it("把普通上游文本节点映射为 source 输入", () => {
        const nodes = [node("source", undefined, "原始故事"), node("script", "script")];
        expect(buildToonflowGeneration(nodes, [connection("source", "script")], "script").finalPrompt).toContain("【source】\n原始故事");
    });

    it("分镜表重生成包含现有 segmentId 与 shotId", () => {
        const target = node("storyboard", "storyboard-table", "", "review");
        target.metadata!.toonflow!.output = { ...output(target.id, "storyboard-table", 1), payload: { table: [storyboardRow()] } };
        const result = buildToonflowGeneration([target], [], target.id);
        expect(result.finalPrompt).toContain("【existing-ids】");
        expect(result.finalPrompt).toContain("seg-a/shot-a");
    });
});

describe("applyGenerationSuccess", () => {
    it("普通文本生成写入 review 输出与生成元数据", () => {
        const target = node("script", "script", "", "generating");
        const result = applyGenerationSuccess(target, "生成正文", [{ term: "iPhone", replacement: "智能手机" }]);
        expect(result.metadata?.content).toBe("生成正文");
        expect(result.metadata?.toonflow?.output).toMatchObject({
            version: 1,
            status: "review",
            payload: { text: "生成正文" },
            generationMeta: { model: "test-model", sentPrompt: "已发送提示词", washedPrompt: "已发送提示词" },
        });
    });

    it("分镜 JSON 解析失败时进入 failed 并保留解析原因", () => {
        const target = node("storyboard", "storyboard-table", "", "generating");
        const result = applyGenerationSuccess(target, "不是 JSON", []);
        expect(result.metadata?.toonflow?.status).toBe("failed");
        expect(result.metadata?.toonflow?.output?.error).toContain("JSON 解析失败");
    });

    it("分镜校验出现 error 级问题时进入 failed", () => {
        const target = node("storyboard", "storyboard-table", "", "generating");
        const raw = JSON.stringify([storyboardRow({ shotNo: 2 })]);
        const result = applyGenerationSuccess(target, raw, []);
        expect(result.metadata?.toonflow?.status).toBe("failed");
        expect(result.metadata?.toonflow?.output?.error).toContain("shotNo");
    });

    it("合法分镜为空 ID 分配稳定格式 ID", () => {
        const target = node("storyboard", "storyboard-table", "", "generating");
        const raw = JSON.stringify([storyboardRow({ segmentId: "", shotId: "" })]);
        const result = applyGenerationSuccess(target, raw, []);
        const row = result.metadata?.toonflow?.output?.payload.table?.[0];
        expect(result.metadata?.toonflow?.status).toBe("review");
        expect(row?.segmentId).toMatch(/^seg_[0-9a-z]{8}$/);
        expect(row?.shotId).toMatch(/^shot_[0-9a-z]{8}$/);
    });

    it("history 超过 10 条时裁掉最旧版本", () => {
        const target = node("script", "script", "", "generating");
        target.metadata!.toonflow!.output = output(target.id, "script", 11);
        target.metadata!.toonflow!.history = Array.from({ length: 10 }, (_, index) => output(target.id, "script", index + 1));
        const result = applyGenerationSuccess(target, "新版本", []);
        expect(result.metadata?.toonflow?.history).toHaveLength(10);
        expect(result.metadata?.toonflow?.history?.map((item) => item.version)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        expect(result.metadata?.toonflow?.output?.version).toBe(12);
    });
});

describe("状态动作与 hydrate", () => {
    it("review 节点通过后同步为 approved", () => {
        const target = node("script", "script", "", "review");
        target.metadata!.toonflow!.output = output(target.id, "script", 1);
        const result = applyApprove([target], [], target.id);
        expect(result[0].metadata?.toonflow).toMatchObject({ status: "approved", output: { status: "approved" } });
    });

    it("重生成只进入 generating,不做失效传播(生成失败不得误标下游)", () => {
        const source = node("script", "script", "", "approved");
        source.metadata!.toonflow!.output = output(source.id, "script", 2, "approved");
        const downstream = node("space", "space-contract", "", "approved");
        downstream.metadata!.toonflow!.output = { ...output(downstream.id, "space-contract", 1, "approved"), upstreamVersions: { script: 2 } };
        const result = applyRegenerate([source, downstream], [connection("script", "space")], source.id);
        expect(result[0].metadata?.toonflow?.status).toBe("generating");
        expect(result[1].metadata?.toonflow?.status).toBe("approved");
    });

    it("新版本产生后传播:旧快照下游标 stale,快照已含新版本者豁免", () => {
        const source = node("script", "script", "", "review");
        source.metadata!.toonflow!.output = output(source.id, "script", 3, "review");
        const staleTarget = node("space", "space-contract", "", "approved");
        staleTarget.metadata!.toonflow!.output = { ...output(staleTarget.id, "space-contract", 1, "approved"), upstreamVersions: { script: 2 } };
        const guarded = node("storyboard", "storyboard-table", "", "approved");
        guarded.metadata!.toonflow!.output = { ...output(guarded.id, "storyboard-table", 1, "approved"), upstreamVersions: { script: 3 } };
        const result = propagateAfterNewVersion([source, staleTarget, guarded], [connection("script", "space"), connection("script", "storyboard")], source.id);
        expect(result[1].metadata?.toonflow?.status).toBe("stale");
        expect(result[2].metadata?.toonflow?.status).toBe("approved");
    });

    it("computeUpstreamVersions 只取直接上游的当前版本", () => {
        const grand = node("project", "project", "", "approved");
        grand.metadata!.toonflow!.output = output(grand.id, "project", 5, "approved");
        const parent = node("script", "script", "", "approved");
        parent.metadata!.toonflow!.output = output(parent.id, "script", 2, "approved");
        const child = node("space", "space-contract");
        const snapshot = computeUpstreamVersions([grand, parent, child], [connection("project", "script"), connection("script", "space")], child.id);
        expect(snapshot).toEqual({ script: 2 });
    });

    it("applyGenerationSuccess 记录传入的上游版本快照", () => {
        const target = node("script", "script", "", "generating");
        const result = applyGenerationSuccess(target, "正文", [], { project: 4 });
        expect(result.metadata?.toonflow?.output?.upstreamVersions).toEqual({ project: 4 });
    });

    it("迁移旧中文状态且重复 hydrate 保持幂等", () => {
        const target = node("script", "script");
        Object.assign(target.metadata!.toonflow!, { status: "待验收" });
        const once = hydrateToonflowProject([target]);
        const twice = hydrateToonflowProject(once);
        expect(once[0].metadata?.toonflow?.status).toBe("review");
        expect(twice).toEqual(once);
        expect(twice[0]).toBe(once[0]);
    });
});
