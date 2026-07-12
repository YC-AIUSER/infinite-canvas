import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ToonflowNodeKind } from "../../../types/canvas";
import { applyAssetCardsSave, buildToonflowImageGeneration, parseEntityHints, readNodeInput } from "../node-runtime";
import { buildAssetCardPrompt } from "../prompts";
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

    it("接受动作和表情衍生卡并拒绝非法类型", () => {
        expect(AssetCardSchema.safeParse({ cardId: "action-1", cardType: "action", parentCardId: "card-1", name: "拔剑", anchor: "拔剑前冲" }).success).toBe(true);
        expect(AssetCardSchema.safeParse({ cardId: "expression-1", cardType: "expression", parentCardId: "card-1", name: "惊讶", anchor: "瞳孔放大" }).success).toBe(true);
        expect(AssetCardSchema.safeParse({ cardId: "bad", cardType: "vehicle", name: "车", anchor: "红色" }).success).toBe(false);
    });
});

describe("validateAssetCards", () => {
    it("报告衍生卡缺少父卡", () => {
        expect(validateAssetCards([{ cardId: "action-1", cardType: "action", name: "拔剑", anchor: "拔剑前冲" }])).toEqual([expect.stringContaining("缺少父卡")]);
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
});

describe("buildAssetCardPrompt", () => {
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
});

describe("buildToonflowImageGeneration 衍生资产", () => {
    it("参考图按父角色、动作、表情、场景、道具排序", () => {
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
        const target = node("target", "storyboard-page", "generating", CanvasNodeType.Image);
        target.metadata!.toonflow!.segmentId = "seg-a";

        const result = buildToonflowImageGeneration([table, assets, target], [], "target");
        expect(result.referenceKeys).toEqual(["image:anchor-1", "image:action", "image:expression", "image:scene", "image:prop"]);
    });
});
