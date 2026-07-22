import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ToonflowNodeKind } from "../../../types/canvas";
import { applyAssetCardsSave, buildToonflowImageGeneration, parseEntityHints, readNodeInput } from "../node-runtime";
import { PALETTE_ANCHOR_SENTENCE, buildAssetCardPrompt, buildStoryboardPagePrompt } from "../prompts";
import { AssetCardSchema, NodeOutputSchema, validateAssetCards, type AssetCard, type NodeOutput, type NodeStatus } from "../schema";

const cards: AssetCard[] = [{ cardId: "card-1", cardType: "character", name: "阿青", anchor: "黑色短发，青色长衫", storageKey: "image:anchor-1" }];

function node(id: string, kind: ToonflowNodeKind, status: NodeStatus = "empty", type = CanvasNodeType.Text): CanvasNodeData {
    return {
        id,
        type,
        title: id,
        position: { x: 0, y: 0 },
        width: 320,
        height: 190,
        metadata: { toonflow: { kind, stage: "测试", status, summary: "测试", checks: [] } },
    };
}

function output(nodeId: string, kind: ToonflowNodeKind, version: number, status: NodeStatus, payload: NodeOutput["payload"] = { text: "旧产出" }): NodeOutput {
    return { nodeId, kind, version, status, payload, upstreamVersions: {}, generatedAt: "2026-07-12T00:00:00.000Z" };
}

function connection(fromNodeId: string, toNodeId: string): CanvasConnection {
    return { id: `${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId };
}

describe("applyAssetCardsSave", () => {
    it("首存生成 v1 review 并传播下游 stale", () => {
        const assets = node("assets", "assets", "empty", CanvasNodeType.Image);
        const downstream = node("space", "space-contract", "approved");
        downstream.metadata!.toonflow!.output = { ...output("space", "space-contract", 1, "approved"), upstreamVersions: { assets: 0 } };
        const result = applyAssetCardsSave([assets, downstream], [connection("assets", "space")], "assets", cards);

        expect(result[0].metadata?.toonflow?.output).toMatchObject({ version: 1, status: "review", payload: { cards } });
        expect(result[0].metadata?.status).toBe("success");
        expect(result[1].metadata?.toonflow?.status).toBe("stale");
    });

    it("approved 后再存版本加一、保持 approved 并传播", () => {
        const assets = node("assets", "assets", "approved", CanvasNodeType.Image);
        assets.metadata!.toonflow!.output = output("assets", "assets", 1, "approved", { cards });
        const downstream = node("space", "space-contract", "approved");
        downstream.metadata!.toonflow!.output = { ...output("space", "space-contract", 1, "approved"), upstreamVersions: { assets: 1 } };
        const result = applyAssetCardsSave([assets, downstream], [connection("assets", "space")], "assets", [{ ...cards[0], anchor: "新锚点" }]);

        expect(result[0].metadata?.toonflow?.output).toMatchObject({ version: 2, status: "approved" });
        expect(result[0].metadata?.toonflow?.history?.map((item) => item.version)).toEqual([1]);
        expect(result[1].metadata?.toonflow?.status).toBe("stale");
    });

    it("review 再存版本加一且仍为 review", () => {
        const assets = node("assets", "assets", "review", CanvasNodeType.Image);
        assets.metadata!.toonflow!.output = output("assets", "assets", 1, "review", { cards });
        const result = applyAssetCardsSave([assets], [], "assets", cards);
        expect(result[0].metadata?.toonflow?.output).toMatchObject({ version: 2, status: "review" });
    });

    it("目标不是 assets 时原样返回", () => {
        const nodes = [node("script", "script")];
        expect(applyAssetCardsSave(nodes, [], "script", cards)).toBe(nodes);
    });
});

describe("资产卡输入与实体清单", () => {
    it("readNodeInput 逐卡文本化且不包含 storageKey", () => {
        const assets = node("assets", "assets", "approved", CanvasNodeType.Image);
        assets.metadata!.toonflow!.output = output("assets", "assets", 1, "approved", {
            cards: [
                cards[0],
                { cardId: "card-2", cardType: "scene", name: "院落", anchor: "青砖院墙" },
                { cardId: "card-3", cardType: "prop", name: "油纸伞", anchor: "旧竹骨红伞" },
            ],
        });
        expect(readNodeInput(assets)).toBe("【角色】阿青：黑色短发，青色长衫\n【场景】院落：青砖院墙\n【道具】油纸伞：旧竹骨红伞");
        expect(readNodeInput(assets)).not.toContain("image:anchor-1");
    });

    it("readNodeInput 标注衍生卡的父角色", () => {
        const assets = node("assets", "assets", "approved", CanvasNodeType.Image);
        assets.metadata!.toonflow!.output = output("assets", "assets", 1, "approved", {
            cards: [cards[0], { cardId: "action-1", cardType: "action", parentCardId: "card-1", name: "阿青·拔剑", anchor: "右手拔剑，侧身前倾" }],
        });
        expect(readNodeInput(assets)).toContain("【动作】阿青·拔剑（衍生自阿青）：右手拔剑，侧身前倾");
    });

    it("readNodeInput 区分角色形态与独立形态", () => {
        const assets = node("assets", "assets", "approved", CanvasNodeType.Image);
        assets.metadata!.toonflow!.output = output("assets", "assets", 1, "approved", {
            cards: [
                cards[0],
                { cardId: "form-1", cardType: "form", parentCardId: "card-1", name: "阿青·青龙形态", anchor: "青色龙鳞覆盖全身" },
                { cardId: "form-2", cardType: "form", name: "机械核心", anchor: "悬浮的金属球形核心" },
            ],
        });
        expect(readNodeInput(assets)).toContain("【形态】阿青·青龙形态（阿青的形态）：青色龙鳞覆盖全身");
        expect(readNodeInput(assets)).toContain("【形态】机械核心：悬浮的金属球形核心");
    });

    it("提取角色和道具清单，兼容中文冒号与破折号", () => {
        const result = parseEntityHints("## 角色实体清单\n1. 阿青：黑色短发，青色长衫\n- 老周—花白短发，灰夹克\n## 道具实体清单\n* 油纸伞：旧竹骨红伞");
        expect(result).toEqual([
            { cardType: "character", name: "阿青", note: "黑色短发，青色长衫" },
            { cardType: "character", name: "老周", note: "花白短发，灰夹克" },
            { cardType: "prop", name: "油纸伞", note: "旧竹骨红伞" },
        ]);
    });

    it("乱格式没有可解析条目时返回空数组", () => {
        expect(parseEntityHints("角色实体清单\n这里是一段没有条目分隔符的说明\n道具实体清单\n也没有规范条目")).toEqual([]);
    });
});

describe("AssetCardSchema", () => {
    it("校验资产卡且旧 NodeOutput 无 cards 字段仍兼容", () => {
        expect(AssetCardSchema.safeParse(cards[0]).success).toBe(true);
        expect(AssetCardSchema.safeParse({ ...cards[0], cardType: "vehicle" }).success).toBe(false);
        expect(
            NodeOutputSchema.safeParse({
                nodeId: "script",
                kind: "script",
                version: 1,
                status: "approved",
                payload: { text: "旧数据" },
                upstreamVersions: {},
                generatedAt: "2026-07-12T00:00:00.000Z",
            }).success,
        ).toBe(true);
    });

    it("接受动作、表情、服装、形态和质感样板卡并拒绝非法类型", () => {
        expect(AssetCardSchema.safeParse({ cardId: "action-1", cardType: "action", parentCardId: "card-1", name: "拔剑", anchor: "拔剑前冲" }).success).toBe(true);
        expect(AssetCardSchema.safeParse({ cardId: "expression-1", cardType: "expression", parentCardId: "card-1", name: "惊讶", anchor: "瞳孔放大" }).success).toBe(true);
        expect(AssetCardSchema.safeParse({ cardId: "outfit-1", cardType: "outfit", parentCardId: "card-1", name: "夜行装", anchor: "黑色束袖夜行衣" }).success).toBe(true);
        expect(AssetCardSchema.safeParse({ cardId: "form-1", cardType: "form", name: "青龙形态", anchor: "青色龙鳞覆盖全身" }).success).toBe(true);
        expect(AssetCardSchema.safeParse({ cardId: "swatch-1", cardType: "styleSwatch", name: "全片质感样板", anchor: "" }).success).toBe(true);
        expect(AssetCardSchema.safeParse({ cardId: "bad", cardType: "vehicle", name: "车", anchor: "红色" }).success).toBe(false);
    });

    it("拒绝把 dataUrl 写入资产卡 storageKey", () => {
        expect(AssetCardSchema.safeParse({ ...cards[0], storageKey: "data:image/png;base64,AAAA" }).success).toBe(false);
        expect(AssetCardSchema.safeParse({ ...cards[0], storageKey: "image:ok" }).success).toBe(true);
    });
});

describe("validateAssetCards", () => {
    it("报告衍生卡缺少父卡", () => {
        expect(validateAssetCards([{ cardId: "action-1", cardType: "action", name: "拔剑", anchor: "拔剑前冲" }])).toEqual([expect.stringContaining("缺少父卡")]);
    });

    it("报告服装卡缺少父卡", () => {
        expect(validateAssetCards([{ cardId: "outfit-1", cardType: "outfit", name: "夜行装", anchor: "黑色束袖夜行衣" }])).toEqual([expect.stringContaining("缺少父卡")]);
    });

    it("允许形态卡不挂父角色", () => {
        expect(validateAssetCards([{ cardId: "form-1", cardType: "form", name: "青龙形态", anchor: "青色龙鳞覆盖全身" }])).toEqual([]);
    });

    it("质感样板是独立卡，不要求父角色", () => {
        expect(validateAssetCards([{ cardId: "swatch-1", cardType: "styleSwatch", name: "全片质感样板", anchor: "" }])).toEqual([]);
    });

    it("报告形态卡父卡不是角色卡", () => {
        expect(
            validateAssetCards([
                { cardId: "prop-1", cardType: "prop", name: "龙珠", anchor: "青色发光宝珠" },
                { cardId: "form-1", cardType: "form", parentCardId: "prop-1", name: "青龙形态", anchor: "青色龙鳞覆盖全身" },
            ]),
        ).toEqual([expect.stringContaining("父卡不是角色卡")]);
    });

    it("报告父卡不存在", () => {
        expect(validateAssetCards([{ cardId: "action-1", cardType: "action", parentCardId: "missing", name: "拔剑", anchor: "拔剑前冲" }])).toEqual([expect.stringContaining("不存在的父卡")]);
    });

    it("报告父卡不是角色卡", () => {
        expect(
            validateAssetCards([
                { cardId: "prop-1", cardType: "prop", name: "剑", anchor: "青铜剑" },
                { cardId: "action-1", cardType: "action", parentCardId: "prop-1", name: "拔剑", anchor: "拔剑前冲" },
            ]),
        ).toEqual([expect.stringContaining("父卡不是角色卡")]);
    });

    it("合法父子关系通过", () => {
        expect(
            validateAssetCards([
                cards[0],
                { cardId: "action-1", cardType: "action", parentCardId: "card-1", name: "拔剑", anchor: "拔剑前冲" },
                { cardId: "expression-1", cardType: "expression", parentCardId: "card-1", name: "惊讶", anchor: "瞳孔放大" },
            ]),
        ).toEqual([]);
    });

    it("报告重复 cardId 且每个重复键只报一次", () => {
        const issues = validateAssetCards([
            cards[0],
            { cardId: "card-1", cardType: "prop", name: "撞车道具", anchor: "青铜剑" },
            { cardId: "card-1", cardType: "scene", name: "再撞一次", anchor: "青砖院墙" },
        ]);
        expect(issues.filter((issue) => issue.includes("重复"))).toEqual([expect.stringContaining("card-1")]);
    });
});

describe("buildAssetCardPrompt", () => {
    it("角色卡生成 16:9 横版人物设定页并覆盖四视图、装备细节与底部总述", () => {
        const prompt = buildAssetCardPrompt({ cardType: "character", name: "阿青", anchor: "黑色短发，青色长衫" });
        expect(prompt).toContain("16:9 横版人物设定页");
        expect(prompt).toContain("顶部标题栏");
        expect(prompt).toContain("正面");
        expect(prompt).toContain("侧面");
        expect(prompt).toContain("背面");
        expect(prompt).toContain("面部特写");
        expect(prompt).toContain("角色的识别特征需在此格可见");
        expect(prompt).toContain("装备细节");
        expect(prompt).toContain("中文说明");
        expect(prompt).toContain("底部一行中文总述");
    });

    it("角色卡使用传入的关键状态，未传时降级为代表性动态姿态且没有空占位符", () => {
        const keyStatePrompt = buildAssetCardPrompt(
            { cardType: "character", name: "阿青", anchor: "黑色短发，青色长衫" },
            undefined,
            { name: "负伤迎战状态", description: "左臂带伤，右手持剑前冲" },
        );
        const fallbackPrompt = buildAssetCardPrompt({ cardType: "character", name: "阿青", anchor: "黑色短发，青色长衫" });

        expect(keyStatePrompt).toContain("负伤迎战状态");
        expect(keyStatePrompt).toContain("左臂带伤，右手持剑前冲");
        expect(fallbackPrompt).toContain("角色的代表性动态姿态");
        expect(fallbackPrompt).not.toContain("undefined");
        expect(fallbackPrompt).not.toContain("null");
        expect(fallbackPrompt).not.toContain("{{");
        expect(fallbackPrompt).not.toContain("待填写");
    });

    it("动作卡逐字注入父锚点并约束只改动作", () => {
        const prompt = buildAssetCardPrompt({ cardType: "action", name: "阿青·拔剑", anchor: "右手拔剑，侧身前倾" }, { name: "阿青", anchor: "黑色短发，青色长衫" });
        expect(prompt).toContain("黑色短发，青色长衫");
        expect(prompt).toContain("只改动作，不改外观");
        expect(prompt).toContain("禁止改变发型、服装、体型");
    });

    it("表情卡逐字注入父锚点并约束只改表情", () => {
        const prompt = buildAssetCardPrompt({ cardType: "expression", name: "阿青·惊讶", anchor: "瞳孔放大，嘴唇微张" }, { name: "阿青", anchor: "黑色短发，青色长衫" });
        expect(prompt).toContain("黑色短发，青色长衫");
        expect(prompt).toContain("只改表情不改外观");
        expect(prompt).toContain("胸像以上");
    });

    it("服装卡逐字注入父锚点并约束只换服装", () => {
        const prompt = buildAssetCardPrompt({ cardType: "outfit", name: "阿青·夜行装", anchor: "黑色束袖夜行衣" }, { name: "阿青", anchor: "黑色短发，清瘦体型" });
        expect(prompt).toContain("黑色短发，清瘦体型");
        expect(prompt).toContain("只换服装，不改容貌");
        expect(prompt).toContain("脸型、发型、体型必须");
    });

    it("形态卡即使传入父角色也只使用自身锚点", () => {
        const prompt = buildAssetCardPrompt({ cardType: "form", name: "阿青·青龙形态", anchor: "青色龙鳞覆盖全身" }, { name: "阿青", anchor: "父锚点绝不能出现" });
        expect(prompt).toContain("青色龙鳞覆盖全身");
        expect(prompt).not.toContain("父锚点绝不能出现");
        expect(prompt).not.toContain("阿青的外貌");
    });

    it("色板卡出 13 色冷暖双调色板并逐字带 HEX 与中文描述要求", () => {
        const prompt = buildAssetCardPrompt({ cardType: "palette", name: "全片色板", anchor: "低饱和冷调都市夜色" });
        expect(prompt).toContain("film color palette, 13 color swatches, warm-cool dual tone system");
        expect(prompt).toContain("13 个色块按冷暖双调分区排列");
        expect(prompt).toContain("HEX 色号与一句中文色彩描述");
        expect(prompt).toContain("低饱和冷调都市夜色");
    });

    it("质感样板生成六格无人物材质微距，并收回布光权", () => {
        const prompt = buildAssetCardPrompt({ cardType: "styleSwatch", name: "全片质感样板", anchor: "" });
        expect(prompt).toContain("16:9 横版的 2×3 六格质感样板");
        expect(prompt).toContain("全部是在漫射光下拍摄的材质微距");
        expect(prompt).toContain("主服装织物");
        expect(prompt).toContain("织带与金属扣具接合处");
        expect(prompt).toContain("旧皮革");
        expect(prompt).toContain("橡胶鞋底齿纹");
        expect(prompt).toContain("干燥土石");
        expect(prompt).toContain("粗织帆布褶皱");
        expect(prompt).toContain("不得出现人物、人脸、人手、人体、剪影人形");
        expect(prompt).toContain("不得出现天空、地平线、远景、光束、太阳或任何环境空镜");
        expect(prompt).toContain("不表达任何光位");
        expect(prompt).not.toContain(PALETTE_ANCHOR_SENTENCE);
    });

    it("质感样板锚点替换默认取材，但保留版式、硬约束与照明要求", () => {
        const prompt = buildAssetCardPrompt({ cardType: "styleSwatch", name: "定制样板", anchor: "陶瓷釉面、锈蚀铁板、湿润苔藓、碳纤维、磨砂塑料、烧焦木纹" });
        expect(prompt).toContain("六格取材全部替换为以下具体材质描述");
        expect(prompt).toContain("陶瓷釉面、锈蚀铁板、湿润苔藓、碳纤维、磨砂塑料、烧焦木纹");
        expect(prompt).not.toContain("主服装织物");
        expect(prompt).toContain("2×3 六格质感样板");
        expect(prompt).toContain("不得出现人物、人脸");
        expect(prompt).toContain("中性柔和漫射光");
    });
});

// ST 色板全局锚定（03-assets.md §6.3，阻断级）。两句一体：第二句是防泄漏句，
// 2026-07-18 A/B 实证里 B 组零图表泄漏全靠它，任何人不许以「太长」为由删掉。
describe("色板锚定句", () => {
    it("逐字等于方法论源 03-assets.md §6.3", () => {
        expect(PALETTE_ANCHOR_SENTENCE).toBe(
            "strictly follow the confirmed color palette (13 colors, warm-cool dual tone), no color deviation from palette. The palette reference image is a color grading source only — do NOT render any swatches, charts or labels in the output",
        );
    });

    it.each([
        ["角色卡", { cardType: "character", name: "阿青", anchor: "黑色短发" }],
        ["场景卡", { cardType: "scene", name: "长街", anchor: "青砖长街" }],
        ["动作卡", { cardType: "action", name: "阿青·拔剑", anchor: "右手拔剑" }],
        ["表情卡", { cardType: "expression", name: "阿青·惊讶", anchor: "瞳孔放大" }],
        ["服装卡", { cardType: "outfit", name: "阿青·夜行装", anchor: "黑色夜行衣" }],
        ["形态卡", { cardType: "form", name: "阿青·青龙形态", anchor: "青色龙鳞" }],
    ] as const)("%s 追加锚定句且防泄漏句齐全", (_name, card) => {
        const prompt = buildAssetCardPrompt(card);
        expect(prompt).toContain(PALETTE_ANCHOR_SENTENCE);
        expect(prompt).toContain("The palette reference image is a color grading source only");
    });

    it("色板卡自身不追加锚定句（它的成品就是色卡，带防泄漏句自相矛盾）", () => {
        expect(buildAssetCardPrompt({ cardType: "palette", name: "全片色板", anchor: "冷调" })).not.toContain(PALETTE_ANCHOR_SENTENCE);
    });

    it("质感样板自身不追加色板锚定句，避免两路基准互相打架", () => {
        expect(buildAssetCardPrompt({ cardType: "styleSwatch", name: "全片质感样板", anchor: "" })).not.toContain(PALETTE_ANCHOR_SENTENCE);
    });

    it("Module3 blockout 故事板不追加色板锚定句", () => {
        const prompt = buildStoryboardPagePrompt({
            rows: [{ segmentId: "seg-a", shotId: "seg-a-shot-1", shotNo: 1, scale: "L3 近景", angle: "平视", action: "抬手", line: "", sfx: "", mood: "紧张", durationSec: 3 }],
            shotContracts: [],
            actionContracts: [],
        });
        expect(prompt).not.toContain(PALETTE_ANCHOR_SENTENCE);
    });
});

describe("buildToonflowImageGeneration 衍生资产", () => {
    it("兼容 keyframes 参考图按故事板、父角色、动作、表情、场景、道具排序", () => {
        const table = node("table", "storyboard-table", "approved");
        table.metadata!.toonflow!.output = output("table", "storyboard-table", 1, "approved", {
            table: [
                {
                    segmentId: "seg-a",
                    shotId: "shot-1",
                    shotNo: 1,
                    scale: "中景",
                    angle: "平视",
                    action: "拔剑",
                    line: "",
                    sfx: "",
                    mood: "紧张",
                    durationSec: 3,
                },
            ],
        });
        const assets = node("assets", "assets", "approved", CanvasNodeType.Image);
        assets.metadata!.toonflow!.output = output("assets", "assets", 1, "approved", {
            cards: [
                { cardId: "scene-1", cardType: "scene", name: "院落", anchor: "青砖院墙", storageKey: "image:scene" },
                { cardId: "expression-1", cardType: "expression", parentCardId: "card-1", name: "阿青·惊讶", anchor: "瞳孔放大", storageKey: "image:expression" },
                { cardId: "prop-1", cardType: "prop", name: "剑", anchor: "青铜剑", storageKey: "image:prop" },
                cards[0],
                { cardId: "action-1", cardType: "action", parentCardId: "card-1", name: "阿青·拔剑", anchor: "拔剑前冲", storageKey: "image:action" },
            ],
        });
        const storyboard = node("storyboard", "storyboard-page", "approved", CanvasNodeType.Image);
        storyboard.metadata!.toonflow!.segmentId = "seg-a";
        storyboard.metadata!.toonflow!.output = output("storyboard", "storyboard-page", 1, "approved", { imageKeys: ["image:storyboard"] });
        const target = node("target", "keyframes", "generating", CanvasNodeType.Image);
        target.metadata!.toonflow!.segmentId = "seg-a";

        const result = buildToonflowImageGeneration([table, assets, storyboard, target], [], "target");
        expect(result.referenceKeys).toEqual(["image:storyboard", "image:anchor-1", "image:action", "image:expression", "image:scene", "image:prop"]);
    });

    it("挂父形态跟随角色，独立形态排在道具之后", () => {
        const table = node("table", "storyboard-table", "approved");
        table.metadata!.toonflow!.output = output("table", "storyboard-table", 1, "approved", {
            table: [
                {
                    segmentId: "seg-a",
                    shotId: "shot-1",
                    shotNo: 1,
                    scale: "中景",
                    angle: "平视",
                    action: "变身",
                    line: "",
                    sfx: "",
                    mood: "紧张",
                    durationSec: 3,
                },
            ],
        });
        const assets = node("assets", "assets", "approved", CanvasNodeType.Image);
        assets.metadata!.toonflow!.output = output("assets", "assets", 1, "approved", {
            cards: [
                { cardId: "form-independent", cardType: "form", name: "机械核心", anchor: "球形核心", storageKey: "image:form-independent" },
                cards[0],
                { cardId: "character-2", cardType: "character", name: "老周", anchor: "花白短发", storageKey: "image:character-2" },
                { cardId: "form-2", cardType: "form", parentCardId: "character-2", name: "老周·石像形态", anchor: "石质躯体", storageKey: "image:form-2" },
                { cardId: "prop-1", cardType: "prop", name: "剑", anchor: "青铜剑", storageKey: "image:prop" },
                { cardId: "outfit-1", cardType: "outfit", parentCardId: "card-1", name: "阿青·夜行装", anchor: "黑色束袖夜行衣", storageKey: "image:outfit" },
                { cardId: "form-1", cardType: "form", parentCardId: "card-1", name: "阿青·青龙形态", anchor: "青色龙鳞", storageKey: "image:form-1" },
                { cardId: "action-1", cardType: "action", parentCardId: "card-1", name: "阿青·拔剑", anchor: "拔剑前冲", storageKey: "image:action" },
                { cardId: "expression-1", cardType: "expression", parentCardId: "card-1", name: "阿青·惊讶", anchor: "瞳孔放大", storageKey: "image:expression" },
                { cardId: "scene-1", cardType: "scene", name: "院落", anchor: "青砖院墙", storageKey: "image:scene" },
            ],
        });
        const storyboard = node("storyboard", "storyboard-page", "approved", CanvasNodeType.Image);
        storyboard.metadata!.toonflow!.segmentId = "seg-a";
        storyboard.metadata!.toonflow!.output = output("storyboard", "storyboard-page", 1, "approved", { imageKeys: ["image:storyboard"] });
        const target = node("target", "keyframes", "generating", CanvasNodeType.Image);
        target.metadata!.toonflow!.segmentId = "seg-a";

        const result = buildToonflowImageGeneration([table, assets, storyboard, target], [], "target");
        expect(result.referenceKeys).toEqual([
            "image:storyboard",
            "image:anchor-1",
            "image:action",
            "image:expression",
            "image:outfit",
            "image:form-1",
            "image:character-2",
            "image:form-2",
            "image:scene",
            "image:prop",
            "image:form-independent",
        ]);
    });
});
