import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../../../types/canvas";
import { assetsCardNodeId, assetsGroupId, isAssetsProjectionNode, reconcileAssetsProjection } from "../toonflow-assets-projection";

function assetsStage(id: string, cards: Array<{ cardId: string; name: string; storageKey?: string }>): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: "资产库",
        position: { x: 100, y: 100 },
        width: 320,
        height: 190,
        metadata: {
            toonflow: {
                kind: "assets",
                stage: "参考资产",
                status: "review",
                summary: "",
                checks: [],
                output: {
                    nodeId: id,
                    kind: "assets",
                    version: 1,
                    status: "review",
                    payload: {
                        cards: cards.map((c) => ({ cardId: c.cardId, cardType: "character" as const, name: c.name, anchor: "锚点", storageKey: c.storageKey })),
                    },
                    upstreamVersions: {},
                    generatedAt: "2026-07-15T00:00:00.000Z",
                },
            },
        },
    };
}

describe("reconcileAssetsProjection", () => {
    it("为每张有 storageKey 的卡建一个子节点 + 一个组", () => {
        const stage = assetsStage("assets-1", [
            { cardId: "c1", name: "主角", storageKey: "image:k1" },
            { cardId: "c2", name: "反派", storageKey: "image:k2" },
        ]);
        const out = reconcileAssetsProjection([stage]);
        const group = out.find((n) => n.id === assetsGroupId("assets-1"));
        expect(group?.type).toBe(CanvasNodeType.Group);
        expect(group?.metadata?.projectionOf).toEqual({ stageNodeId: "assets-1", kind: "assets" });
        const child1 = out.find((n) => n.id === assetsCardNodeId("assets-1", "c1"));
        expect(child1?.type).toBe(CanvasNodeType.Image);
        expect(child1?.metadata?.storageKey).toBe("image:k1");
        expect(child1?.metadata?.groupId).toBe(assetsGroupId("assets-1"));
        expect(child1?.metadata?.cardProjection).toEqual({ stageNodeId: "assets-1", cardId: "c1" });
    });

    it("投影节点一律不带 toonflow(零污染不变量)", () => {
        const stage = assetsStage("assets-1", [{ cardId: "c1", name: "主角", storageKey: "image:k1" }]);
        const out = reconcileAssetsProjection([stage]);
        for (const n of out.filter(isAssetsProjectionNode)) {
            expect(n.metadata?.toonflow).toBeUndefined();
        }
    });

    it("无 storageKey 的卡不投影", () => {
        const stage = assetsStage("assets-1", [{ cardId: "c1", name: "未生成" }]);
        const out = reconcileAssetsProjection([stage]);
        expect(out.find((n) => n.id === assetsCardNodeId("assets-1", "c1"))).toBeUndefined();
        expect(out.find((n) => n.id === assetsGroupId("assets-1"))).toBeUndefined();
    });

    it("幂等:连跑两次结构一致", () => {
        const stage = assetsStage("assets-1", [{ cardId: "c1", name: "主角", storageKey: "image:k1" }]);
        const once = reconcileAssetsProjection([stage]);
        const twice = reconcileAssetsProjection(once);
        expect(twice.map((n) => n.id).sort()).toEqual(once.map((n) => n.id).sort());
    });

    it("删卡后对应子节点被移除", () => {
        const stage = assetsStage("assets-1", [
            { cardId: "c1", name: "主角", storageKey: "image:k1" },
            { cardId: "c2", name: "反派", storageKey: "image:k2" },
        ]);
        const first = reconcileAssetsProjection([stage]);
        const stage2 = assetsStage("assets-1", [{ cardId: "c1", name: "主角", storageKey: "image:k1" }]);
        const nodesAfter = [stage2, ...first.filter(isAssetsProjectionNode)];
        const out = reconcileAssetsProjection(nodesAfter);
        expect(out.find((n) => n.id === assetsCardNodeId("assets-1", "c2"))).toBeUndefined();
        expect(out.find((n) => n.id === assetsCardNodeId("assets-1", "c1"))).toBeDefined();
    });

    it("重跑保留用户拖动过的子节点位置", () => {
        const stage = assetsStage("assets-1", [{ cardId: "c1", name: "主角", storageKey: "image:k1" }]);
        const first = reconcileAssetsProjection([stage]);
        const moved = first.map((n) => (n.id === assetsCardNodeId("assets-1", "c1") ? { ...n, position: { x: 999, y: 888 } } : n));
        const out = reconcileAssetsProjection(moved);
        expect(out.find((n) => n.id === assetsCardNodeId("assets-1", "c1"))?.position).toEqual({ x: 999, y: 888 });
    });

    it("卡片 storageKey 变更时清除旧 content,供异步层重新解析新图", () => {
        const first = reconcileAssetsProjection([assetsStage("assets-1", [{ cardId: "c1", name: "主角", storageKey: "image:k1" }])]);
        const stale = first.map((n) => (n.id === assetsCardNodeId("assets-1", "c1") ? { ...n, metadata: { ...n.metadata, content: "old-url" } } : n));
        const stage = assetsStage("assets-1", [{ cardId: "c1", name: "主角", storageKey: "image:k2" }]);
        const out = reconcileAssetsProjection([stage, ...stale.filter(isAssetsProjectionNode)]);
        expect(out.find((n) => n.id === assetsCardNodeId("assets-1", "c1"))?.metadata?.content).toBeUndefined();
    });

    it("assets 节点被删后,残留投影节点被清除", () => {
        const stage = assetsStage("assets-1", [{ cardId: "c1", name: "主角", storageKey: "image:k1" }]);
        const first = reconcileAssetsProjection([stage]);
        const out = reconcileAssetsProjection(first.filter(isAssetsProjectionNode));
        expect(out.filter(isAssetsProjectionNode)).toHaveLength(0);
    });

    it("重建资产投影时保留段实例 Group 与成员归属", () => {
        const stage = assetsStage("assets-1", [{ cardId: "c1", name: "主角", storageKey: "image:k1" }]);
        const instanceGroup: CanvasNodeData = {
            id: "instance-group-keyframes-root",
            type: CanvasNodeType.Group,
            title: "首帧",
            position: { x: 0, y: 0 },
            width: 500,
            height: 500,
            metadata: { projectionOf: { stageNodeId: "keyframes-root", kind: "keyframes" } },
        };
        const instanceMember: CanvasNodeData = {
            id: "keyframe-seg-1",
            type: CanvasNodeType.Image,
            title: "首帧 · 段1",
            position: { x: 50, y: 50 },
            width: 320,
            height: 190,
            metadata: {
                groupId: instanceGroup.id,
                toonflow: { kind: "keyframes", stage: "视觉首帧", status: "empty", summary: "", checks: [], segmentId: "seg-1", segmentIndex: 0 },
            },
        };

        const out = reconcileAssetsProjection([...reconcileAssetsProjection([stage]), instanceGroup, instanceMember]);

        expect(out.find((node) => node.id === instanceGroup.id)).toEqual(instanceGroup);
        expect(out.find((node) => node.id === instanceMember.id)?.metadata?.groupId).toBe(instanceGroup.id);
    });
});
