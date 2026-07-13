import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData, type ToonflowNodeKind } from "../../../types/canvas";
import { applyVideoGenerationSuccess, buildToonflowVideoGeneration } from "../node-runtime";
import { buildVideoWorkbenchPrompt } from "../prompts";
import { VERSION_LIMIT_VIDEO, type NodeOutput, type StoryboardRow } from "../schema";

function row(shotNo: number, segmentId = "seg-a"): StoryboardRow {
    return {
        segmentId,
        shotId: `${segmentId}-shot-${shotNo}`,
        shotNo,
        scale: shotNo === 1 ? "近景" : "全景",
        angle: shotNo === 1 ? "低机位" : "俯拍",
        action: shotNo === 1 ? "主角抬手" : "反派后退",
        line: "台词",
        sfx: "",
        mood: "紧张",
        durationSec: 5,
    };
}

function output(nodeId: string, kind: ToonflowNodeKind, payload: NodeOutput["payload"], version = 1, status: NodeOutput["status"] = "approved"): NodeOutput {
    return { nodeId, kind, version, status, payload, upstreamVersions: {}, generatedAt: "2026-07-13T00:00:00.000Z" };
}

function nodeTypeFor(kind: ToonflowNodeKind): CanvasNodeType {
    if (kind === "video-workbench") return CanvasNodeType.Video;
    if (kind === "storyboard-page" || kind === "keyframes") return CanvasNodeType.Image;
    return CanvasNodeType.Text;
}

function node(id: string, kind: ToonflowNodeKind, payload?: NodeOutput["payload"], segmentId?: string, status: NodeOutput["status"] = "approved"): CanvasNodeData {
    return {
        id,
        type: nodeTypeFor(kind),
        title: id,
        position: { x: 0, y: 0 },
        width: 320,
        height: 190,
        metadata: {
            prompt: "视频提示词",
            model: "test-model",
            toonflow: {
                kind,
                stage: "测试",
                status,
                summary: "摘要",
                checks: [],
                segmentId,
                output: payload ? output(id, kind, payload, 1, status) : undefined,
            },
        },
    };
}

function baseNodes() {
    return [
        node("table", "storyboard-table", { table: [row(2), row(1)] }),
        node("shots", "shot-contract", {
            text: JSON.stringify([
                { shotId: "seg-a-shot-1", scale: "近景", angle: "低机位", movement: "推近", speed: "慢", subjectRelation: "单人", endpoint: "手停在画面中央", inOut: { include: ["主角"], exclude: ["窗外路人"] } },
            ]),
        }),
        node("actions", "action-contract", {
            text: JSON.stringify([{ shotId: "seg-a-shot-1", cause: "听见声响", process: "手指刚触到门把", consequence: "门把下压", endState: "身体前倾" }]),
        }),
        node("assets", "assets", {
            cards: [
                { cardId: "prop", cardType: "prop", name: "门把", anchor: "黄铜圆形", storageKey: "image:prop" },
                { cardId: "character", cardType: "character", name: "主角", anchor: "红衣黑发", storageKey: "image:character" },
                { cardId: "scene", cardType: "scene", name: "走廊", anchor: "冷蓝顶灯", storageKey: "image:scene" },
            ],
        }),
        node("storyboard-page", "storyboard-page", { imageKeys: ["image:storyboard"] }, "seg-a"),
        node("keyframes", "keyframes", { imageKeys: ["image:keyframes"] }, "seg-a"),
        node("target", "video-workbench", undefined, "seg-a", "generating"),
    ];
}

describe("buildVideoWorkbenchPrompt", () => {
    it("逐镜与格子 1:1、按 shotNo 顺序、返回逐格 shotPrompts", () => {
        const { prompt, shotPrompts } = buildVideoWorkbenchPrompt({ rows: [row(2), row(1)], shotContracts: [], actionContracts: [], anchors: [] });
        expect(prompt).toContain("共 2 个镜头");
        expect(prompt.indexOf("shotNo 1")).toBeLessThan(prompt.indexOf("shotNo 2"));
        expect(Object.keys(shotPrompts)).toEqual(["seg-a-shot-1", "seg-a-shot-2"]);
        expect(shotPrompts["seg-a-shot-1"]).toContain("景别：近景");
    });

    it("方法论硬约束:多镜头直出、禁首尾帧续接", () => {
        const { prompt } = buildVideoWorkbenchPrompt({ rows: [row(1)], shotContracts: [], actionContracts: [], anchors: [] });
        expect(prompt).toContain("原生多镜头直出");
        expect(prompt).toContain("禁止首尾帧续接或硬拼");
    });

    it("注入合同落点/排除项/动作后果,note 进入本次调整", () => {
        const { prompt, shotPrompts } = buildVideoWorkbenchPrompt({
            rows: [row(1)],
            shotContracts: [{ shotId: "seg-a-shot-1", scale: "近景", angle: "低机位", movement: "推近", speed: "慢", subjectRelation: "单人", endpoint: "手停在中央", inOut: { include: ["主角"], exclude: ["路人"] } }],
            actionContracts: [{ shotId: "seg-a-shot-1", cause: "声响", process: "手指触到门把", consequence: "门把下压", endState: "前倾" }],
            anchors: ["主角：红衣黑发"],
            note: "把运镜改为固定机位",
        });
        expect(prompt).toContain("落点构图：手停在中央");
        expect(prompt).toContain("必须排除：路人");
        expect(prompt).toContain("以物理后果结束：门把下压");
        expect(prompt).toContain("主角：红衣黑发");
        expect(prompt).toContain("只调整以下这一处：把运镜改为固定机位");
        expect(shotPrompts["seg-a-shot-1"]).toContain("运镜：推近（慢）");
    });
});

describe("buildToonflowVideoGeneration", () => {
    it("参考顺序=故事板页(第一)→首帧→资产卡(角色/场景/道具)", () => {
        const result = buildToonflowVideoGeneration(baseNodes(), [], "target");
        expect(result.referenceKeys).toEqual(["image:storyboard", "image:keyframes", "image:character", "image:scene", "image:prop"]);
        expect(result.mandatoryKeys).toEqual(["image:storyboard"]);
        expect(result.shotPrompts["seg-a-shot-1"]).toBeTruthy();
    });

    it("缺同段故事板页图时抛错(九宫格是第一参考,必须先有)", () => {
        const nodes = baseNodes().filter((item) => item.id !== "storyboard-page");
        expect(() => buildToonflowVideoGeneration(nodes, [], "target")).toThrow("请先生成该段故事板页");
    });

    it("音频卡(人声)进 audioReferenceKeys、不混入图像 referenceKeys", () => {
        const nodes = baseNodes().filter((item) => item.id !== "assets");
        nodes.push(
            node("assets", "assets", {
                cards: [
                    { cardId: "character", cardType: "character", name: "主角", anchor: "红衣黑发", storageKey: "image:character" },
                    { cardId: "voice", cardType: "audio", name: "主角人声", anchor: "低沉嗓音", storageKey: "audio:voice" },
                ],
            }),
        );
        const result = buildToonflowVideoGeneration(nodes, [], "target");
        expect(result.referenceKeys).toContain("image:character");
        expect(result.referenceKeys).not.toContain("audio:voice");
        expect(result.audioReferenceKeys).toEqual(["audio:voice"]);
    });

    it("缺首帧组只给 warning 不阻断,参考里没有首帧键", () => {
        const nodes = baseNodes().filter((item) => item.id !== "keyframes");
        const result = buildToonflowVideoGeneration(nodes, [], "target");
        expect(result.referenceKeys).toEqual(["image:storyboard", "image:character", "image:scene", "image:prop"]);
        expect(result.warnings.some((warning) => warning.includes("尚无首帧组"))).toBe(true);
    });

    it("忽略同段已归档故事板页实例,命中活跃实例", () => {
        const nodes = baseNodes();
        const archived = node("storyboard-archived", "storyboard-page", { imageKeys: ["image:archived"] }, "seg-a");
        archived.metadata!.toonflow!.archived = true;
        nodes.push(archived);
        const result = buildToonflowVideoGeneration(nodes, [], "target");
        expect(result.referenceKeys[0]).toBe("image:storyboard");
    });

    it("非视频段实例拒绝 Toonflow 视频生成", () => {
        expect(() => buildToonflowVideoGeneration([node("script", "script", { text: "剧本" })], [], "script")).toThrow("当前节点不支持 Toonflow 视频生成");
    });
});

describe("applyVideoGenerationSuccess", () => {
    it("版本加一、进入 review、payload 写 videoKeys 与 shotPrompts、taskId 入 meta", () => {
        const target = node("target", "video-workbench", { videoKeys: ["video:old"] }, "seg-a", "generating");
        target.metadata!.content = "不要改";
        const result = applyVideoGenerationSuccess(target, ["video:new"], { "seg-a-shot-1": "镜1脚本" }, [], { table: 3 }, "seedance-task-9");
        expect(result.node.metadata?.toonflow?.output).toMatchObject({
            version: 2,
            status: "review",
            payload: { videoKeys: ["video:new"], shotPrompts: { "seg-a-shot-1": "镜1脚本" } },
            upstreamVersions: { table: 3 },
        });
        expect(result.node.metadata?.toonflow?.output?.generationMeta?.taskId).toBe("seedance-task-9");
        expect(result.node.metadata?.content).toBe("不要改");
    });

    it("history 裁到 3 且只把被裁版本独占的 videoKey 列为孤儿", () => {
        const target = node("target", "video-workbench", { videoKeys: ["video:current"] }, "seg-a", "generating");
        target.metadata!.toonflow!.output = output("target", "video-workbench", { videoKeys: ["video:current"] }, 5, "approved");
        target.metadata!.toonflow!.history = [
            output("target", "video-workbench", { videoKeys: ["video:orphan", "video:shared"] }, 1),
            output("target", "video-workbench", { videoKeys: ["video:v2"] }, 2),
            output("target", "video-workbench", { videoKeys: ["video:shared"] }, 3),
            output("target", "video-workbench", { videoKeys: ["video:v4"] }, 4),
        ];
        const result = applyVideoGenerationSuccess(target, ["video:new"], {}, []);
        expect(result.node.metadata?.toonflow?.history).toHaveLength(VERSION_LIMIT_VIDEO);
        expect(result.node.metadata?.toonflow?.history?.map((item) => item.version)).toEqual([3, 4, 5]);
        expect(result.orphanedKeys).toEqual(expect.arrayContaining(["video:orphan", "video:v2"]));
        expect(result.orphanedKeys).not.toContain("video:shared");
    });

    it("非视频段实例原样返回", () => {
        const target = node("script", "script", { text: "剧本" }, undefined, "generating");
        expect(applyVideoGenerationSuccess(target, ["video:new"], {}, [])).toEqual({ node: target, orphanedKeys: [] });
    });
});
