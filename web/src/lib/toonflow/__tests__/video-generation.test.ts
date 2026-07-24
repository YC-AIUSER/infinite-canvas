import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData, type ToonflowNodeKind } from "../../../types/canvas";
import { applyModule4CompositionFailure, applyModule4CompositionSuccess, applyVideoGenerationSuccess, buildToonflowModule4Composition, buildToonflowVideoGeneration } from "../node-runtime";
import { VERSION_LIMIT_VIDEO, type NodeOutput, type StoryboardRow } from "../schema";

const module4Text = `1. 参考图索引
@图片1=主角
@图片2=门把
@图片3=走廊
@图片4=故事板构图

2. 故事线
按故事板镜头顺序自然推进，主角在画面左抬手触到门把，反派在画面右后退，摄影机缓慢推进，冷白侧光从左侧进入，金属轻响与紧张呼吸同步收紧。

3. Tone
压抑紧张。

4. BGM衔接
低频电子脉冲逐渐收紧，动作落点处短促停顿，段尾自然回落。

5. 风格
统一电影写实风格。

6. 画面要求
Generate environmental sound effects only. Do not generate any human voice, dialogue, narration, or vocal audio. Dialogue text is for lip-sync control only. No subtitles, watermarks, or logos.`;

function row(shotNo: number, segmentId = "seg-a"): StoryboardRow {
    return {
        segmentId,
        shotId: `${segmentId}-shot-${shotNo}`,
        shotNo,
        scale: shotNo === 1 ? "近景" : "全景",
        angle: shotNo === 1 ? "低机位" : "俯拍",
        action: shotNo === 1 ? "主角抬手" : "反派后退",
        line: shotNo === 1 ? "出口对白-主角：别开门" : "OS-反派：来不及了",
        sfx: "门把金属轻响",
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
            toonflow: { kind, stage: "测试", status, summary: "摘要", checks: [], segmentId, output: payload ? output(id, kind, payload, 1, status) : undefined },
        },
    };
}

function baseNodes() {
    return [
        node("script", "script", { text: "【音频要素标签】BGM:低频电子脉冲(紧张)" }),
        node("table", "storyboard-table", { table: [row(2), row(1)] }),
        node("shots", "shot-contract", {
            text: JSON.stringify([
                { shotId: "seg-a-shot-1", scale: "近景", angle: "低机位", movement: "推近", speed: "慢", subjectRelation: "主角在画面左，反派在画面右", endpoint: "手停在画面中央", inOut: { include: ["主角"], exclude: ["窗外路人"] } },
            ]),
        }),
        node("actions", "action-contract", {
            text: JSON.stringify([{ shotId: "seg-a-shot-1", cause: "听见声响", process: "手指刚触到门把", consequence: "门把下压", endState: "身体前倾" }]),
        }),
        node("space", "space-contract", { text: "主角恒左，反派恒右，摄影机不得越轴。" }),
        node("lock", "directing-lock", {
            directingLock: {
                global: {
                    visualStyle: "电影写实",
                    colorGrading: "冷暖双调",
                    lighting: "L3柔侧后光，主光从画面左后侧进入",
                    cameraTone: "克制推进",
                    performanceLevel: "L3",
                    unifiedStyleString: "统一电影写实风格",
                    motifs: [],
                },
                seams: [],
            },
        }),
        node("assets", "assets", {
            cards: [
                { cardId: "scene", cardType: "scene", name: "走廊", anchor: "冷蓝顶灯", storageKey: "image:scene" },
                { cardId: "prop", cardType: "prop", name: "门把", anchor: "黄铜圆形", storageKey: "image:prop" },
                { cardId: "character", cardType: "character", name: "主角", anchor: "红衣黑发", storageKey: "image:character" },
            ],
        }),
        node("storyboard-page", "storyboard-page", { imageKeys: ["image:storyboard"] }, "seg-a"),
        node("keyframes", "keyframes", { imageKeys: ["image:keyframes"] }, "seg-a"),
        node("target", "video-workbench", { text: module4Text }, "seg-a", "review"),
    ];
}

describe("buildToonflowModule4Composition", () => {
    it("合成提示词读取本段合同、锁定表、F4 BGM与空间规则", () => {
        const result = buildToonflowModule4Composition(baseNodes(), [], "target");
        expect(result.finalPrompt).toContain("主角说：'别开门'");
        expect(result.finalPrompt).toContain("OS（禁止写进故事线口播）=反派：来不及了");
        expect(result.finalPrompt).toContain("L3柔侧后光，主光从画面左后侧进入");
        expect(result.finalPrompt).toContain("BGM:低频电子脉冲(紧张)");
        expect(result.finalPrompt).toContain("主角恒左，反派恒右");
    });
});

describe("buildToonflowVideoGeneration", () => {
    it("使用已审Module4原文，参考顺序=角色→物品→场景→故事板构图", () => {
        const result = buildToonflowVideoGeneration(baseNodes(), [], "target");
        expect(result.finalPrompt).toBe(module4Text);
        expect(result.module4Text).toBe(module4Text);
        expect(result.referenceKeys).toEqual(["image:character", "image:prop", "image:scene", "image:storyboard"]);
        expect(result.mandatoryKeys).toEqual(["image:storyboard"]);
    });

    it("质感样板排在色板之后、故事板构图之前", () => {
        const nodes = baseNodes().filter((item) => item.id !== "assets");
        nodes.push(
            node("assets", "assets", {
                cards: [
                    { cardId: "swatch", cardType: "styleSwatch", name: "全片质感", anchor: "", storageKey: "image:swatch" },
                    { cardId: "palette", cardType: "palette", name: "全片色板", anchor: "", storageKey: "image:palette" },
                    { cardId: "form", cardType: "form", name: "机械核心", anchor: "球形核心", storageKey: "image:form" },
                    { cardId: "prop", cardType: "prop", name: "门把", anchor: "黄铜圆形", storageKey: "image:prop" },
                    { cardId: "character", cardType: "character", name: "主角", anchor: "红衣黑发", storageKey: "image:character" },
                    { cardId: "scene", cardType: "scene", name: "走廊", anchor: "冷蓝顶灯", storageKey: "image:scene" },
                ],
            }),
        );
        expect(buildToonflowVideoGeneration(nodes, [], "target").referenceKeys).toEqual([
            "image:character",
            "image:prop",
            "image:form",
            "image:scene",
            "image:palette",
            "image:swatch",
            "image:storyboard",
        ]);
    });

    it("缺同段故事板页图时抛错", () => {
        const nodes = baseNodes().filter((item) => item.id !== "storyboard-page");
        expect(() => buildToonflowVideoGeneration(nodes, [], "target")).toThrow("请先生成该段故事板页");
    });

    it("音频卡不进本批参考输入", () => {
        const nodes = baseNodes().filter((item) => item.id !== "assets");
        nodes.push(
            node("assets", "assets", {
                cards: [
                    { cardId: "character", cardType: "character", name: "主角", anchor: "红衣黑发", storageKey: "image:character" },
                    { cardId: "voice", cardType: "audio", name: "主角人声", anchor: "低沉嗓音", storageKey: "audio:voice" },
                ],
            }),
        );
        expect(buildToonflowVideoGeneration(nodes, [], "target").referenceKeys).toEqual(["image:character", "image:storyboard"]);
    });

    it("缺 keyframes 不产生 warning，且不改变视频参考图", () => {
        const result = buildToonflowVideoGeneration(
            baseNodes().filter((item) => item.id !== "keyframes"),
            [],
            "target",
        );
        expect(result.referenceKeys).toEqual(["image:character", "image:prop", "image:scene", "image:storyboard"]);
        expect(result.warnings.some((warning) => warning.includes("首帧") || warning.includes("keyframes"))).toBe(false);
    });

    it("忽略同段已归档故事板页实例", () => {
        const nodes = baseNodes();
        const archived = node("storyboard-archived", "storyboard-page", { imageKeys: ["image:archived"] }, "seg-a");
        archived.metadata!.toonflow!.archived = true;
        nodes.unshift(archived);
        expect(buildToonflowVideoGeneration(nodes, [], "target").referenceKeys.at(-1)).toBe("image:storyboard");
    });

    it("未合成Module4时拒绝建视频任务", () => {
        const nodes = baseNodes().map((item) => (item.id === "target" ? node("target", "video-workbench", undefined, "seg-a", "review") : item));
        expect(() => buildToonflowVideoGeneration(nodes, [], "target")).toThrow("请先合成并确认Module4提示词");
    });

    it("非视频段实例拒绝 Toonflow 视频生成", () => {
        expect(() => buildToonflowVideoGeneration([node("script", "script", { text: "剧本" })], [], "script")).toThrow("当前节点不支持 Toonflow 视频生成");
    });
});

describe("Module4两步产物状态", () => {
    it("合成成功先进入review且payload只写可审Module4文本", () => {
        const target = node("target", "video-workbench", undefined, "seg-a", "generating");
        const result = applyModule4CompositionSuccess(target, module4Text, [], { table: 2 });
        expect(result.node.metadata?.toonflow?.output).toMatchObject({ status: "review", payload: { text: module4Text }, upstreamVersions: { table: 2 } });
        expect(result.node.metadata?.content).toBe(module4Text);
    });

    it("两次校验仍失败时进入failed并保存违规清单", () => {
        const target = node("target", "video-workbench", undefined, "seg-a", "generating");
        const result = applyModule4CompositionFailure(target, "坏文本", ["缺少第1段“参考图索引”", "禁止使用[N-N秒]时间码"], []);
        expect(result.metadata?.toonflow?.status).toBe("failed");
        expect(result.metadata?.toonflow?.output?.payload.module4Issues).toEqual(["缺少第1段“参考图索引”", "禁止使用[N-N秒]时间码"]);
    });

    it("视频成功进入review并同时保留Module4文本与videoKey", () => {
        const target = node("target", "video-workbench", { text: module4Text }, "seg-a", "generating");
        const result = applyVideoGenerationSuccess(target, ["video:new"], module4Text, [], { table: 3 }, "seedance-task-9");
        expect(result.node.metadata?.toonflow?.output).toMatchObject({
            version: 2,
            status: "review",
            payload: { text: module4Text, videoKeys: ["video:new"] },
            upstreamVersions: { table: 3 },
        });
        expect(result.node.metadata?.toonflow?.output?.generationMeta?.taskId).toBe("seedance-task-9");
    });

    it("history裁到3且只把被裁版本独占的videoKey列为孤儿", () => {
        const target = node("target", "video-workbench", { text: module4Text, videoKeys: ["video:current"] }, "seg-a", "generating");
        target.metadata!.toonflow!.output = output("target", "video-workbench", { text: module4Text, videoKeys: ["video:current"] }, 5, "approved");
        target.metadata!.toonflow!.history = [
            output("target", "video-workbench", { videoKeys: ["video:orphan", "video:shared"] }, 1),
            output("target", "video-workbench", { videoKeys: ["video:v2"] }, 2),
            output("target", "video-workbench", { videoKeys: ["video:shared"] }, 3),
            output("target", "video-workbench", { videoKeys: ["video:v4"] }, 4),
        ];
        const result = applyVideoGenerationSuccess(target, ["video:new"], module4Text, []);
        expect(result.node.metadata?.toonflow?.history).toHaveLength(VERSION_LIMIT_VIDEO);
        expect(result.node.metadata?.toonflow?.history?.map((item) => item.version)).toEqual([3, 4, 5]);
        expect(result.orphanedKeys).toEqual(expect.arrayContaining(["video:orphan", "video:v2"]));
        expect(result.orphanedKeys).not.toContain("video:shared");
    });

    it("非视频段实例原样返回", () => {
        const target = node("script", "script", { text: "剧本" }, undefined, "generating");
        expect(applyVideoGenerationSuccess(target, ["video:new"], module4Text, [])).toEqual({ node: target, orphanedKeys: [] });
    });
});
