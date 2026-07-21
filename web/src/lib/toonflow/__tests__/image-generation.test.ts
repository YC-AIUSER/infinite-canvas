import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/image-utils", () => ({ readImageMeta: vi.fn() }));

import { collectMediaStorageKeys } from "../../../services/file-storage";
import { collectImageStorageKeys } from "../../../services/image-storage";
import { CanvasNodeType, type CanvasNodeData, type ToonflowNodeKind } from "../../../types/canvas";
import {
    applyImageGenerationSuccess,
    buildToonflowImageGeneration,
    splitMediaKeysByStore,
} from "../node-runtime";
import { buildKeyframesPrompt, buildStoryboardPagePrompt } from "../prompts";
import { VERSION_LIMIT_IMAGE, type NodeOutput, type StoryboardRow } from "../schema";

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
    return {
        nodeId,
        kind,
        version,
        status,
        payload,
        upstreamVersions: {},
        generatedAt: "2026-07-12T00:00:00.000Z",
    };
}

function node(id: string, kind: ToonflowNodeKind, payload?: NodeOutput["payload"], segmentId?: string, status: NodeOutput["status"] = "approved"): CanvasNodeData {
    return {
        id,
        type: kind === "storyboard-page" || kind === "keyframes" ? CanvasNodeType.Image : CanvasNodeType.Text,
        title: id,
        position: { x: 0, y: 0 },
        width: 320,
        height: 190,
        metadata: {
            prompt: "生图提示词",
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

function baseNodes(targetKind: "storyboard-page" | "keyframes" = "storyboard-page") {
    return [
        node("table", "storyboard-table", { table: [row(2), row(1)] }),
        node("shots", "shot-contract", {
            text: JSON.stringify([
                {
                    shotId: "seg-a-shot-1",
                    scale: "近景",
                    angle: "低机位",
                    movement: "固定",
                    speed: "慢",
                    subjectRelation: "单人",
                    endpoint: "手停在画面中央",
                    inOut: { include: ["主角"], exclude: ["窗外路人"] },
                },
            ]),
        }),
        node("actions", "action-contract", {
            text: JSON.stringify([
                {
                    shotId: "seg-a-shot-1",
                    cause: "听见声响",
                    process: "手指刚触到门把",
                    consequence: "门把下压",
                    endState: "身体前倾",
                },
            ]),
        }),
        node("space", "space-contract", { text: "主角恒左，反派恒右，摄影机不得越轴。" }),
        node("assets", "assets", {
            cards: [
                { cardId: "prop", cardType: "prop", name: "门把", anchor: "黄铜圆形", storageKey: "image:prop" },
                { cardId: "character", cardType: "character", name: "主角", anchor: "红衣黑发", storageKey: "image:character" },
                { cardId: "scene", cardType: "scene", name: "走廊", anchor: "冷蓝顶灯", storageKey: "image:scene" },
            ],
        }),
        node("target", targetKind, undefined, "seg-a", "generating"),
    ];
}

describe("Toonflow 图像提示词", () => {
    it("故事板页格数等于行数且逐格按三层空间语法给出景别、角度与前景主体", () => {
        const prompt = buildStoryboardPagePrompt({ rows: [row(2), row(1)], shotContracts: [], actionContracts: [] });
        expect(prompt).toContain("共 2 格，一格 = 一镜 = 一个时点 = 一个景别");
        expect(prompt.indexOf("shotNo 1")).toBeLessThan(prompt.indexOf("shotNo 2"));
        expect(prompt).toContain("景别：近景（本格只有这一个景别）");
        expect(prompt).toContain("机位角度：低机位");
        expect(prompt).toContain("前景（浅灰亮面）：主角抬手");
        expect(prompt).toContain("中景（中灰暗面）：");
        expect(prompt).toContain("背景（深灰阴影）：");
    });

    it("故事板页注入镜头落点、排除项和动作关键瞬间", () => {
        const prompt = buildStoryboardPagePrompt({
            rows: [row(1)],
            shotContracts: [{ shotId: "seg-a-shot-1", scale: "近景", angle: "低机位", movement: "固定", speed: "慢", subjectRelation: "单人", endpoint: "手停在中央", inOut: { include: ["主角"], exclude: ["路人"] } }],
            actionContracts: [{ shotId: "seg-a-shot-1", cause: "声响", process: "手指触到门把", consequence: "门把下压", endState: "前倾" }],
        });
        expect(prompt).toContain("落点构图：手停在中央");
        expect(prompt).toContain("必须排除：路人");
        expect(prompt).toContain("停在这一瞬间：手指触到门把");
        // 主体关系有值时吃进中景层，没有才回落到「按空间合同补足」。
        expect(prompt).toContain("中景（中灰暗面）：单人");
    });

    // Module3 是照相级首帧，plus 线弃用「黑白粗线稿 + 首帧上色」两步走。
    it("故事板页是 Module3 照相级首帧，不再出现黑白线稿表述", () => {
        const prompt = buildStoryboardPagePrompt({ rows: [row(1)], shotContracts: [], actionContracts: [] });
        expect(prompt).toContain("这张图就是该段视频的首帧主参考");
        for (const retired of ["monochrome", "黑白", "线稿"]) expect(prompt).not.toContain(retired);
    });

    it("故事板页按镜数给出画格排列矩阵（3-5→3+2、6→3+3、7-8→4+4）", () => {
        const layoutOf = (count: number) =>
            buildStoryboardPagePrompt({ rows: Array.from({ length: count }, (_, index) => row(index + 1)), shotContracts: [], actionContracts: [] });
        expect(layoutOf(1)).toContain("画格排列 单行 1 格");
        expect(layoutOf(4)).toContain("画格排列 3+2 矩阵");
        expect(layoutOf(6)).toContain("画格排列 3+3 矩阵（上下各 3 格）");
        expect(layoutOf(8)).toContain("画格排列 4+4 矩阵（上下各 4 格）");
        for (const count of [1, 4, 6, 8]) expect(layoutOf(count)).toContain("画布 16:9 横版");
    });

    it("故事板页含三层空间语法禁令、单一视觉任务与禁制清单", () => {
        const prompt = buildStoryboardPagePrompt({ rows: [row(1)], shotContracts: [], actionContracts: [] });
        expect(prompt).toContain("禁止位置百分比语言");
        expect(prompt).toContain("占画面 1/5");
        expect(prompt).toContain("禁止成品渲染词汇");
        expect(prompt).toContain("每格只有 1 个前景主体 + 至多 1 个背景暗示");
        for (const ban of ["速度线", "残影与运动模糊", "同一角色在同一格里出现两次", "拟声词", "跨格共享元素"]) {
            expect(prompt).toContain(ban);
        }
        for (const styleBan of ["漫画", "卡通", "动画", "插画风", "手绘风", "水墨", "Q版"]) expect(prompt).toContain(styleBan);
        // 单镜物理可行性四档。
        expect(prompt).toContain("L5：最多 1 个主体局部 + 1 个相邻小元素");
        expect(prompt).toContain("L3：上半身 + 手持物");
        // 调度信息内部化。
        expect(prompt).toContain("因果锚点、主视觉任务标签、空间锚点编号、道具状态链一律不画、不写");
    });

    // §1.8 实证：故事板是首帧主参考，其外观污染强于 Module4 文字绑定句，裸称人物会丢装备。
    it("故事板页要求人物标签携带装备特征，禁止裸称", () => {
        const prompt = buildStoryboardPagePrompt({ rows: [row(1)], shotContracts: [], actionContracts: [] });
        expect(prompt).toContain("人物标签必须携带装备特征");
        expect(prompt).toContain("头戴四镜筒头盔的瘦高男");
        expect(prompt).toContain("一件都不能省");
    });

    it("故事板页把缝合同落进首末格", () => {
        const prompt = buildStoryboardPagePrompt({
            rows: [row(1), row(2)],
            shotContracts: [],
            actionContracts: [],
            seams: [
                { fromSegmentId: "seg-0", toSegmentId: "seg-a", prevEndBeat: "上段收手到一半", nextFirstPanel: "接住同一次收手的后半", scaleOrMotivation: "景别跳 2 档", soundBridge: "J-cut 提前 0.3s" },
                { fromSegmentId: "seg-a", toSegmentId: "seg-b", prevEndBeat: "下摇到 1/3 截止", nextFirstPanel: "下一段接同一次下摇", scaleOrMotivation: "POV 运镜动机", soundBridge: "L-cut 拖尾 0.5s" },
            ],
        });
        expect(prompt).toContain("首格（第 1 格）承接上一段：接住同一次收手的后半");
        expect(prompt).toContain("禁止重新建立空间");
        expect(prompt).toContain("末格（第 2 格）交给下一段：下摇到 1/3 截止");
        expect(prompt).toContain("动作画到中间态截止");
        // 只取与本段相关的两条缝，不把别段的缝抄进来。
        expect(prompt).not.toContain("上段收手到一半");
        expect(prompt).not.toContain("下一段接同一次下摇");
    });

    it("没有缝合同时不出现缝合同区块", () => {
        const prompt = buildStoryboardPagePrompt({ rows: [row(1)], shotContracts: [], actionContracts: [], seams: [] });
        expect(prompt).not.toContain("【缝合同");
    });

    it("首帧逐字注入 anchors 且 note 进入只改一处的定点修指令", () => {
        const prompt = buildKeyframesPrompt({ rows: [row(1)], anchors: ["主角：红衣黑发", "走廊：冷蓝顶灯"], note: "只把外套改为深红色" });
        expect(prompt).toContain("只上色不改构图");
        expect(prompt).toContain("主角：红衣黑发");
        expect(prompt).toContain("走廊：冷蓝顶灯");
        expect(prompt).toContain("只改以下这一处：只把外套改为深红色");
        expect(prompt).toContain("其余内容必须与参考图完全一致");
    });
});

describe("buildToonflowImageGeneration", () => {
    it("故事板页按角色、场景、道具顺序返回资产卡参考", () => {
        const result = buildToonflowImageGeneration(baseNodes(), [], "target");
        expect(result.referenceKeys).toEqual(["image:character", "image:scene", "image:prop"]);
        expect(result.finalPrompt).toContain("主角恒左，反派恒右，摄影机不得越轴。");
    });

    it("故事板页没有资产卡时给出一致性 warning", () => {
        const nodes = baseNodes().filter((item) => item.id !== "assets");
        const result = buildToonflowImageGeneration(nodes, [], "target");
        expect(result.referenceKeys).toEqual([]);
        expect(result.warnings).toContain("无资产卡锚点,画面一致性可能漂移");
    });

    it("首帧参考首位固定为同段故事板页图", () => {
        const nodes = baseNodes("keyframes");
        nodes.push(node("storyboard-page", "storyboard-page", { imageKeys: ["image:storyboard"] }, "seg-a"));
        const result = buildToonflowImageGeneration(nodes, [], "target", "只改灯光");
        expect(result.referenceKeys).toEqual(["image:storyboard", "image:character", "image:scene", "image:prop"]);
        expect(result.finalPrompt).toContain("只改以下这一处：只改灯光");
    });

    it("首帧把故事板页线稿标为强制参考,故事板页自身无强制参考", () => {
        const keyframeNodes = baseNodes("keyframes");
        keyframeNodes.push(node("storyboard-page", "storyboard-page", { imageKeys: ["image:storyboard"] }, "seg-a"));
        // 首帧构图锁=故事板页线稿,必须进 mandatoryKeys(读取失败要中止,不能降级)
        expect(buildToonflowImageGeneration(keyframeNodes, [], "target").mandatoryKeys).toEqual(["image:storyboard"]);
        // 故事板页的资产卡只是可选锚点,不强制
        expect(buildToonflowImageGeneration(baseNodes("storyboard-page"), [], "target").mandatoryKeys).toEqual([]);
    });

    it("首帧缺少同段故事板页图时抛错", () => {
        expect(() => buildToonflowImageGeneration(baseNodes("keyframes"), [], "target")).toThrow("请先生成该段故事板页");
    });

    it("首帧忽略同段已归档故事板页实例", () => {
        const nodes = baseNodes("keyframes");
        const archived = node("storyboard-archived", "storyboard-page", { imageKeys: ["image:archived"] }, "seg-a");
        archived.metadata!.toonflow!.archived = true;
        nodes.push(archived);
        // 只有归档实例时视同缺图,不得拿过期线稿凑数
        expect(() => buildToonflowImageGeneration(nodes, [], "target")).toThrow("请先生成该段故事板页");
        // 归档与活跃并存时必须命中活跃实例
        nodes.push(node("storyboard-active", "storyboard-page", { imageKeys: ["image:active"] }, "seg-a"));
        const result = buildToonflowImageGeneration(nodes, [], "target");
        expect(result.referenceKeys[0]).toBe("image:active");
    });

    it("合同解析失败只进入 warnings 不阻断生成", () => {
        const nodes = baseNodes().map((item) => (item.id === "shots" ? node("shots", "shot-contract", { text: "不是 JSON" }) : item));
        const result = buildToonflowImageGeneration(nodes, [], "target");
        expect(result.warnings.some((warning) => warning.startsWith("镜头合同解析失败"))).toBe(true);
        expect(result.finalPrompt).toContain("共 2 格");
    });

    it("非段实例拒绝 Toonflow 图像生成", () => {
        expect(() => buildToonflowImageGeneration([node("script", "script", { text: "剧本" })], [], "script")).toThrow("当前节点不支持 Toonflow 图像生成");
    });
});

describe("applyImageGenerationSuccess", () => {
    it("版本加一、进入 review 并保持 metadata.content 不变", () => {
        const target = node("target", "storyboard-page", { imageKeys: ["image:old"] }, "seg-a", "generating");
        target.metadata!.content = "不要改";
        const result = applyImageGenerationSuccess(target, ["image:new"], [], { table: 3 });
        expect(result.node.metadata?.toonflow?.output).toMatchObject({ version: 2, status: "review", payload: { imageKeys: ["image:new"] }, upstreamVersions: { table: 3 } });
        expect(result.node.metadata?.toonflow?.status).toBe("review");
        expect(result.node.metadata?.content).toBe("不要改");
    });

    it("history 裁到 5 且只把被裁版本独占 key 列为孤儿", () => {
        const target = node("target", "storyboard-page", { imageKeys: ["image:current"] }, "seg-a", "generating");
        target.metadata!.toonflow!.output = output("target", "storyboard-page", { imageKeys: ["image:current"] }, 7, "approved");
        target.metadata!.toonflow!.history = [
            output("target", "storyboard-page", { imageKeys: ["image:orphan", "image:shared"] }, 1),
            output("target", "storyboard-page", { imageKeys: ["image:v2"] }, 2),
            output("target", "storyboard-page", { imageKeys: ["image:shared"] }, 3),
            output("target", "storyboard-page", { imageKeys: ["image:v4"] }, 4),
            output("target", "storyboard-page", { imageKeys: ["image:v5"] }, 5),
            output("target", "storyboard-page", { imageKeys: ["image:v6"] }, 6),
        ];
        const result = applyImageGenerationSuccess(target, ["image:new"], []);
        expect(result.node.metadata?.toonflow?.history).toHaveLength(VERSION_LIMIT_IMAGE);
        expect(result.node.metadata?.toonflow?.history?.map((item) => item.version)).toEqual([3, 4, 5, 6, 7]);
        expect(result.orphanedKeys).toEqual(expect.arrayContaining(["image:orphan", "image:v2"]));
        expect(result.orphanedKeys).not.toContain("image:shared");
    });

    it("非段实例原样返回", () => {
        const target = node("script", "script", { text: "剧本" }, undefined, "generating");
        expect(applyImageGenerationSuccess(target, ["image:new"], [])).toEqual({ node: target, orphanedKeys: [] });
    });
});

describe("媒体键收集与分流", () => {
    it("图像收集器识别裸数组 key 且保留 storageKey 旧行为", () => {
        const keys = collectImageStorageKeys({ output: { imageKeys: ["image:a", "video:b"] }, card: { storageKey: "image:legacy" } });
        expect(keys).toEqual(new Set(["image:a", "image:legacy"]));
    });

    it("媒体收集器识别三类裸数组 key 且保留 storageKey 旧行为", () => {
        const keys = collectMediaStorageKeys({ imageKeys: ["image:a"], videoKeys: ["video:b"], audioKeys: ["无前缀", "audio:c"], item: { storageKey: "media:legacy" } });
        expect(keys).toEqual(new Set(["image:a", "video:b", "audio:c", "media:legacy"]));
    });

    it("媒体 key 按 image 前缀分流", () => {
        expect(splitMediaKeysByStore(["image:a", "video:b", "audio:c"])).toEqual({ imageKeys: ["image:a"], mediaKeys: ["video:b", "audio:c"] });
    });
});
