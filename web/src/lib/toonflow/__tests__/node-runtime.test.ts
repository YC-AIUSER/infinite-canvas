import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ToonflowNodeKind } from "../../../types/canvas";
import type { NodeOutput, NodeStatus, StoryboardRow } from "../schema";
import {
    applyAdoptStale,
    applyApprove,
    approveChain,
    applyEditSave,
    applyGenerationSuccess,
    applyRegenerate,
    applyRollback,
    buildTextCascadeGraph,
    buildToonflowGeneration,
    computeUpstreamVersions,
    hydrateToonflowProject,
    propagateAfterNewVersion,
} from "../node-runtime";

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

describe("文本支配度闭环", () => {
    it("编辑 approved 文本后版本加一并保持 approved", () => {
        const target = node("script", "script", "旧正文", "approved");
        target.metadata!.toonflow!.output = output(target.id, "script", 2, "approved");
        const result = applyEditSave([target], [], target.id, "新正文");
        expect(result[0].metadata?.toonflow?.output).toMatchObject({ version: 3, status: "approved", payload: { text: "新正文" } });
        expect(result[0].metadata?.content).toBe("新正文");
        expect(result[0].metadata?.toonflow?.history?.map((item) => item.version)).toEqual([2]);
    });

    it("编辑保存刷新直接上游快照并把旧快照下游传播为 stale", () => {
        const parent = node("project", "project", "项目", "approved");
        parent.metadata!.toonflow!.output = output(parent.id, "project", 4, "approved");
        const target = node("script", "script", "旧正文", "approved");
        target.metadata!.toonflow!.output = { ...output(target.id, "script", 2, "approved"), upstreamVersions: { project: 3 } };
        const downstream = node("space", "space-contract", "空间", "approved");
        downstream.metadata!.toonflow!.output = { ...output(downstream.id, "space-contract", 1, "approved"), upstreamVersions: { script: 2 } };
        const connections = [connection("project", "script"), connection("script", "space")];
        const result = applyEditSave([parent, target, downstream], connections, target.id, "新正文");
        expect(result[1].metadata?.toonflow?.output?.upstreamVersions).toEqual({ project: 4 });
        expect(result[2].metadata?.toonflow?.status).toBe("stale");
    });

    it("storyboard-table 拒绝文本编辑并返回原数组", () => {
        const target = node("storyboard", "storyboard-table", "", "approved");
        target.metadata!.toonflow!.output = { ...output(target.id, "storyboard-table", 1, "approved"), payload: { table: [storyboardRow()] } };
        const nodes = [target];
        expect(applyEditSave(nodes, [], target.id, "非法编辑")).toBe(nodes);
    });

    it("非 approved 文本拒绝编辑", () => {
        const target = node("script", "script", "正文", "review");
        target.metadata!.toonflow!.output = output(target.id, "script", 1, "review");
        const nodes = [target];
        expect(applyEditSave(nodes, [], target.id, "修改")).toBe(nodes);
    });

    it("回退历史内容会生成 approved 新版本并把当前版本推入 history", () => {
        const target = node("script", "script", "版本 3", "approved");
        target.metadata!.toonflow!.output = output(target.id, "script", 3, "approved");
        target.metadata!.toonflow!.history = [output(target.id, "script", 1, "approved"), output(target.id, "script", 2, "approved")];
        const result = applyRollback([target], [], target.id, 1);
        expect(result[0].metadata?.toonflow?.output).toMatchObject({ version: 4, status: "approved", payload: { text: "版本 1" } });
        expect(result[0].metadata?.toonflow?.history?.map((item) => item.version)).toEqual([1, 2, 3]);
    });

    it("回退新版本后传播下游 stale", () => {
        const target = node("script", "script", "版本 3", "approved");
        target.metadata!.toonflow!.output = output(target.id, "script", 3, "approved");
        target.metadata!.toonflow!.history = [output(target.id, "script", 1, "approved")];
        const downstream = node("space", "space-contract", "空间", "approved");
        downstream.metadata!.toonflow!.output = { ...output(downstream.id, "space-contract", 1, "approved"), upstreamVersions: { script: 3 } };
        const result = applyRollback([target, downstream], [connection("script", "space")], target.id, 1);
        expect(result[1].metadata?.toonflow?.status).toBe("stale");
    });

    it("找不到目标历史版本时不修改节点", () => {
        const target = node("script", "script", "版本 2", "approved");
        target.metadata!.toonflow!.output = output(target.id, "script", 2, "approved");
        const nodes = [target];
        expect(applyRollback(nodes, [], target.id, 1)).toBe(nodes);
    });

    it("沿用 stale 产出恢复 approved、刷新快照且不增加版本", () => {
        const upstream = node("script", "script", "剧本", "approved");
        upstream.metadata!.toonflow!.output = output(upstream.id, "script", 5, "approved");
        const target = node("space", "space-contract", "旧空间", "stale");
        target.metadata!.toonflow!.output = { ...output(target.id, "space-contract", 2, "stale"), upstreamVersions: { script: 4 } };
        const result = applyAdoptStale([upstream, target], [connection("script", "space")], target.id);
        expect(result[1].metadata?.toonflow?.output).toMatchObject({ version: 2, status: "approved", upstreamVersions: { script: 5 } });
        expect(result[1].metadata?.toonflow?.history).toBeUndefined();
    });

    it("沿用旧产出不向更下游传播", () => {
        const upstream = node("script", "script", "剧本", "approved");
        upstream.metadata!.toonflow!.output = output(upstream.id, "script", 2, "approved");
        const target = node("space", "space-contract", "空间", "stale");
        target.metadata!.toonflow!.output = output(target.id, "space-contract", 1, "stale");
        const downstream = node("shots", "shot-contract", "镜头", "approved");
        downstream.metadata!.toonflow!.output = { ...output(downstream.id, "shot-contract", 1, "approved"), upstreamVersions: { space: 1 } };
        const result = applyAdoptStale([upstream, target, downstream], [connection("script", "space"), connection("space", "shots")], target.id);
        expect(result[2].metadata?.toonflow?.status).toBe("approved");
    });

    it("approveChain 只通过指定集合中的 review 文本节点并返回数量", () => {
        const script = node("script", "script", "", "review");
        script.metadata!.toonflow!.output = output(script.id, "script", 1, "review");
        const space = node("space", "space-contract", "", "review");
        space.metadata!.toonflow!.output = output(space.id, "space-contract", 1, "review");
        const project = node("project", "project", "", "review");
        project.metadata!.toonflow!.output = output(project.id, "project", 1, "review");
        const result = approveChain([script, space, project], [], [script.id, project.id]);
        expect(result.approvedCount).toBe(1);
        expect(result.nodes.map((item) => item.metadata?.toonflow?.status)).toEqual(["approved", "review", "review"]);
    });

    it("approveChain 未传节点集合时通过全部 review 文本节点", () => {
        const script = node("script", "script", "", "review");
        script.metadata!.toonflow!.output = output(script.id, "script", 1, "review");
        const space = node("space", "space-contract", "", "review");
        space.metadata!.toonflow!.output = output(space.id, "space-contract", 1, "review");
        const result = approveChain([script, space], []);
        expect(result.approvedCount).toBe(2);
        expect(result.nodes.every((item) => item.metadata?.toonflow?.status === "approved")).toBe(true);
    });

    it("buildTextCascadeGraph 只保留五种可生成文本节点及其内部连线", () => {
        const nodes = [
            node("script", "script"),
            node("space", "space-contract"),
            node("storyboard", "storyboard-table"),
            node("shots", "shot-contract"),
            node("actions", "action-contract"),
            node("project", "project"),
            node("assets", "assets"),
        ];
        const graph = buildTextCascadeGraph(nodes, [
            connection("project", "script"),
            connection("script", "space"),
            connection("space", "storyboard"),
            connection("storyboard", "shots"),
            connection("shots", "actions"),
            connection("actions", "assets"),
        ]);
        expect(graph.nodes.map((item) => item.nodeId)).toEqual(["script", "space", "storyboard", "shots", "actions"]);
        expect(graph.edges).toEqual([
            { from: "script", to: "space" },
            { from: "space", to: "storyboard" },
            { from: "storyboard", to: "shots" },
            { from: "shots", to: "actions" },
        ]);
        expect(graph.kinds).toEqual({ script: "script", space: "space-contract", storyboard: "storyboard-table", shots: "shot-contract", actions: "action-contract" });
    });
});
