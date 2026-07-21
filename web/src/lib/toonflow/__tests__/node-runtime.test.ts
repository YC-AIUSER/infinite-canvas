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
import { cascadeOrder } from "../state-machine";

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

    it("分镜校验出现 error 级问题时进入 failed(跨段重复 shotId)", () => {
        const target = node("storyboard", "storyboard-table", "", "generating");
        const raw = JSON.stringify([storyboardRow({ segmentId: "seg-a", shotId: "dup" }), storyboardRow({ segmentId: "seg-b", shotId: "dup" })]);
        const result = applyGenerationSuccess(target, raw, []);
        expect(result.metadata?.toonflow?.status).toBe("failed");
        expect(result.metadata?.toonflow?.output?.error).toContain("重复");
    });

    it("模型输出全局连续 shotNo 时按段自动归一化(不再指望模型服从)", () => {
        const raw = JSON.stringify([
            storyboardRow({ segmentId: "seg-a", shotId: "s1", shotNo: 1, durationSec: 6 }),
            storyboardRow({ segmentId: "seg-a", shotId: "s2", shotNo: 2, durationSec: 6 }),
            storyboardRow({ segmentId: "seg-b", shotId: "s3", shotNo: 3, durationSec: 7 }),
            storyboardRow({ segmentId: "seg-b", shotId: "s4", shotNo: 4, durationSec: 7 }),
        ]);
        const target = node("storyboard", "storyboard-table", "", "generating");
        const result = applyGenerationSuccess(target, raw, []);
        expect(result.metadata?.toonflow?.status).toBe("review");
        expect(result.metadata?.toonflow?.output?.payload.table?.map((row) => row.shotNo)).toEqual([1, 2, 1, 2]);
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

describe("plus 三个新节点的生成路径", () => {
    function directingLockJson() {
        return JSON.stringify({
            global: {
                visualStyle: "王家卫",
                colorGrading: "青橙对比",
                lighting: "伦勃朗布光，主光左前上方",
                cameraTone: "手持跟随",
                performanceLevel: "L3",
                unifiedStyleString: "cinematic teal-orange, 35mm",
                motifs: ["骰子"],
            },
            segments: [
                {
                    segmentId: "seg-a",
                    compositionPrimary: "三分法",
                    compositionSecondary: "框中框",
                    compositionDiversity: "两种构图交替",
                    cameraType: "推镜 + 摇镜",
                    scaleRange: "L0-L4",
                    angleType: "平视 + 俯视",
                    openingType: "动作中途切入",
                },
            ],
            seams: [
                {
                    fromSegmentId: "seg-a",
                    toSegmentId: "seg-b",
                    prevEndBeat: "手举到杯沿停住",
                    nextFirstPanel: "同一只手落下把杯子按在桌上",
                    scaleOrMotivation: "L4 跳 L1",
                    soundBridge: "J-cut：本段音效提前 0.3s",
                },
            ],
        });
    }

    function continuityTableJson() {
        return JSON.stringify({
            propWhitelist: [{ name: "茶杯", lockedValue: "桌右侧，杯口朝上" }],
            blocking: [{ name: "老陈", lockedValue: "坐姿，恒在画面左侧" }],
            lightingWeather: [{ name: "主光", lockedValue: "左前上方，允许 ±15°" }],
            characterGear: [],
            leftovers: [],
        });
    }

    it("创意节点产出自由文本,落进 payload.text", () => {
        const target = node("creative", "creative", "", "generating");
        const result = applyGenerationSuccess(target, "体检模式：缺反转打脸爽点", []);
        expect(result.metadata?.toonflow?.status).toBe("review");
        expect(result.metadata?.toonflow?.output?.payload).toEqual({ text: "体检模式：缺反转打脸爽点" });
    });

    it("创意节点可作为可生成节点构建提示词", () => {
        const nodes = [node("script", "script", "已有剧本正文"), node("creative", "creative")];
        const result = buildToonflowGeneration(nodes, [connection("script", "creative")], "creative");
        expect(result.finalPrompt).toContain("【script】\n已有剧本正文");
    });

    it("分镜决策锁定表解析为对象并落进 payload.directingLock", () => {
        const target = node("lock", "directing-lock", "", "generating");
        const result = applyGenerationSuccess(target, directingLockJson(), []);
        expect(result.metadata?.toonflow?.status).toBe("review");
        expect(result.metadata?.toonflow?.output?.payload.text).toBeUndefined();
        expect(result.metadata?.toonflow?.output?.payload.directingLock?.global.visualStyle).toBe("王家卫");
        expect(result.metadata?.toonflow?.output?.payload.directingLock?.segments?.[0].segmentId).toBe("seg-a");
        expect(result.metadata?.toonflow?.output?.payload.directingLock?.seams?.[0].soundBridge).toContain("J-cut");
    });

    it("分镜决策锁定表 JSON 非法时转 failed 且错误可见", () => {
        const target = node("lock", "directing-lock", "", "generating");
        const result = applyGenerationSuccess(target, "不是 JSON", []);
        expect(result.metadata?.toonflow?.status).toBe("failed");
        expect(result.metadata?.toonflow?.output?.error).toContain("JSON 解析失败");
        expect(result.metadata?.errorDetails).toContain("JSON 解析失败");
    });

    it("分镜决策锁定表缺 A 表必填字段时按校验失败转 failed", () => {
        const target = node("lock", "directing-lock", "", "generating");
        const result = applyGenerationSuccess(target, JSON.stringify({ global: { visualStyle: "王家卫" } }), []);
        expect(result.metadata?.toonflow?.status).toBe("failed");
        expect(result.metadata?.toonflow?.output?.error).toContain("JSON 校验失败");
    });

    it("跨段继承表解析为对象并落进 payload.continuityTable", () => {
        const target = node("continuity", "continuity-table", "", "generating");
        const result = applyGenerationSuccess(target, continuityTableJson(), []);
        expect(result.metadata?.toonflow?.status).toBe("review");
        expect(result.metadata?.toonflow?.output?.payload.text).toBeUndefined();
        expect(result.metadata?.toonflow?.output?.payload.continuityTable?.propWhitelist).toEqual([{ name: "茶杯", lockedValue: "桌右侧，杯口朝上" }]);
    });

    it("跨段继承表条目缺 lockedValue 时转 failed 且错误可见", () => {
        const target = node("continuity", "continuity-table", "", "generating");
        const result = applyGenerationSuccess(target, JSON.stringify({ propWhitelist: [{ name: "茶杯" }] }), []);
        expect(result.metadata?.toonflow?.status).toBe("failed");
        expect(result.metadata?.toonflow?.output?.error).toContain("JSON 校验失败");
    });

    it("锁定表与继承表的结构化产出能被下游读成上下文(payload 无 text 也不丢)", () => {
        const lock = node("lock", "directing-lock", "", "review");
        lock.metadata!.toonflow!.output = { ...output("lock", "directing-lock", 1), payload: JSON.parse(`{"directingLock":${directingLockJson()}}`) };
        // 清掉 content 兜底,确保读到的是 payload 而不是 metadata.content。
        lock.metadata!.content = "";
        const storyboard = node("storyboard", "storyboard-table");
        const result = buildToonflowGeneration([lock, storyboard], [connection("lock", "storyboard")], "storyboard");
        expect(result.finalPrompt).toContain("【directing-lock】");
        expect(result.finalPrompt).toContain("cinematic teal-orange");
    });
});

describe("选修节点(skipped)的启用与级联豁免", () => {
    it("手动生成 skipped 的选修节点可行:直接进入 generating", () => {
        const creative = node("creative", "creative", "", "skipped");
        const result = applyRegenerate([creative], [], creative.id);
        expect(result[0].metadata?.toonflow?.status).toBe("generating");
    });

    it("一键跑全链不执行 skipped 节点,但下游仍被穿透纳入", () => {
        const nodes = [node("creative", "creative", "", "skipped"), node("script", "script"), node("space", "space-contract")];
        const graph = buildTextCascadeGraph(nodes, [connection("creative", "script"), connection("script", "space")]);
        expect(cascadeOrder(graph.nodes, graph.edges, "creative")).toEqual(["script", "space"]);
    });

    it("选修节点被手动生成后不再豁免,后续一键跑全链会带上它", () => {
        const nodes = [node("creative", "creative", "创意产出", "review"), node("script", "script")];
        const graph = buildTextCascadeGraph(nodes, [connection("creative", "script")]);
        expect(cascadeOrder(graph.nodes, graph.edges, "creative")).toEqual(["creative", "script"]);
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

    it("hydrate 保留带 pendingVideoTask 的生成中视频节点", () => {
        const target = node("video", "video-workbench", "", "generating");
        target.metadata!.toonflow!.pendingVideoTask = {
            taskId: "task-1",
            provider: "seedance",
            model: "seedance-2.0",
            upstreamSnapshot: { storyboard: 3 },
            shotPrompts: { "seg-a-shot-1": "镜1" },
            washHits: [],
            startedAt: "2026-07-13T00:00:00.000Z",
        };
        const result = hydrateToonflowProject([target]);
        expect(result[0]).toBe(target);
        expect(result[0].metadata?.toonflow?.status).toBe("generating");
    });

    it("hydrate 将无 pendingVideoTask 的生成中视频节点降级为 failed", () => {
        const target = node("video", "video-workbench", "", "generating");
        const result = hydrateToonflowProject([target]);
        expect(result[0].metadata?.toonflow?.status).toBe("failed");
        expect(result[0].metadata?.errorDetails).toContain("页面已刷新");
    });

    it("hydrate 继续将生成中文本节点降级为 failed", () => {
        const target = node("script", "script", "", "generating");
        const result = hydrateToonflowProject([target]);
        expect(result[0].metadata?.toonflow?.status).toBe("failed");
        expect(result[0].metadata?.errorDetails).toContain("页面已刷新");
    });

    it("hydrate 对已归档的生成中视频节点降级为 failed 并剥离 pendingVideoTask(不留僵尸态)", () => {
        const target = node("video", "video-workbench", "", "generating");
        target.metadata!.toonflow!.archived = true;
        target.metadata!.toonflow!.pendingVideoTask = {
            taskId: "task-z",
            provider: "cano",
            model: "seedance-2.0-mini-720p",
            upstreamSnapshot: {},
            shotPrompts: {},
            washHits: [],
            startedAt: "2026-07-13T00:00:00.000Z",
        };
        const result = hydrateToonflowProject([target]);
        expect(result[0].metadata?.toonflow?.status).toBe("failed");
        expect(result[0].metadata?.toonflow?.pendingVideoTask).toBeUndefined();
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

    it("hydrate 同时迁移 output 与 history 内嵌的旧中文状态", () => {
        const target = node("script", "script", "", "review");
        Object.assign(target.metadata!.toonflow!, { status: "待验收" });
        target.metadata!.toonflow!.output = { ...output(target.id, "script", 3, "review"), status: "待验收" as NodeStatus };
        target.metadata!.toonflow!.history = [{ ...output(target.id, "script", 2, "approved"), status: "已通过" as NodeStatus }];
        const result = hydrateToonflowProject([target]);
        expect(result[0].metadata?.toonflow?.output?.status).toBe("review");
        expect(result[0].metadata?.toonflow?.history?.[0].status).toBe("approved");
        // 迁移后 output.status=review,approveNode(review -> approved) 不应再因中文非法状态报错
        expect(() => applyApprove(result, [], target.id)).not.toThrow();
        expect(applyApprove(result, [], target.id)[0].metadata?.toonflow?.status).toBe("approved");
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
        expect(result.nodes[0].metadata?.toonflow?.output).toMatchObject({ version: 4, status: "approved", payload: { text: "版本 1" } });
        expect(result.nodes[0].metadata?.toonflow?.history?.map((item) => item.version)).toEqual([1, 2, 3]);
        expect(result.orphanedKeys).toEqual([]);
    });

    it("回退新版本后传播下游 stale", () => {
        const target = node("script", "script", "版本 3", "approved");
        target.metadata!.toonflow!.output = output(target.id, "script", 3, "approved");
        target.metadata!.toonflow!.history = [output(target.id, "script", 1, "approved")];
        const downstream = node("space", "space-contract", "空间", "approved");
        downstream.metadata!.toonflow!.output = { ...output(downstream.id, "space-contract", 1, "approved"), upstreamVersions: { script: 3 } };
        const result = applyRollback([target, downstream], [connection("script", "space")], target.id, 1);
        expect(result.nodes[1].metadata?.toonflow?.status).toBe("stale");
    });

    it("找不到目标历史版本时不修改节点", () => {
        const target = node("script", "script", "版本 2", "approved");
        target.metadata!.toonflow!.output = output(target.id, "script", 2, "approved");
        const nodes = [target];
        const result = applyRollback(nodes, [], target.id, 1);
        expect(result.nodes).toBe(nodes);
        expect(result.orphanedKeys).toEqual([]);
    });

    const imageOutput = (nodeId: string, version: number, keys: string[]): NodeOutput => ({
        nodeId,
        kind: "storyboard-page",
        version,
        status: "approved",
        payload: { imageKeys: keys },
        upstreamVersions: {},
        generatedAt: `2026-07-12T00:00:${String(version).padStart(2, "0")}.000Z`,
    });

    it("图像节点回退超版本上限时,返回被裁旧版本独有的孤儿媒体键", () => {
        // 图像历史上限 5:5 个历史版本 + 当前版本,回退触发 appendHistory 从头裁掉 v1。
        const target = node("page", "storyboard-page", "首帧", "approved");
        target.metadata!.toonflow!.output = imageOutput("page", 6, ["image:cur"]);
        target.metadata!.toonflow!.history = [1, 2, 3, 4, 5].map((v) => imageOutput("page", v, [`image:v${v}`]));
        const result = applyRollback([target], [], target.id, 3);
        // allHistory = [v1..v5, cur](6 项),裁到后 5 项 [v2..v5,cur],被裁 v1 → image:v1 成孤儿。
        expect(result.orphanedKeys).toEqual(["image:v1"]);
    });

    it("回退不误删仍被保留历史/恢复版本引用的媒体键", () => {
        const target = node("page", "storyboard-page", "首帧", "approved");
        // v1 与 cur 共享 image:shared;裁掉 v1 后 image:shared 仍被 cur 引用,不得算孤儿。
        target.metadata!.toonflow!.output = imageOutput("page", 6, ["image:shared"]);
        target.metadata!.toonflow!.history = [imageOutput("page", 1, ["image:shared"]), ...[2, 3, 4, 5].map((v) => imageOutput("page", v, [`image:v${v}`]))];
        const result = applyRollback([target], [], target.id, 3);
        expect(result.orphanedKeys).not.toContain("image:shared");
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

    it("buildTextCascadeGraph 桥接被剔除的非文本节点(Toonflow 模板线性链场景)", () => {
        // 复刻真实模板顺序:剧本→资产库(图像)→空间合同,直接过滤会剪断链
        const nodes = [node("script", "script"), node("assets", "assets"), node("space", "space-contract"), node("storyboard", "storyboard-table")];
        const graph = buildTextCascadeGraph(nodes, [connection("script", "assets"), connection("assets", "space"), connection("space", "storyboard")]);
        expect(graph.edges).toEqual([
            { from: "script", to: "space" },
            { from: "space", to: "storyboard" },
        ]);
    });
});
