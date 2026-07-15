import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../../../types/canvas";
import { buildTextCascadeGraph, collectExportSegments } from "../../toonflow/node-runtime";
import { isAssetsProjectionNode, reconcileAssetsProjection } from "../toonflow-assets-projection";

function assetsStage(id: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: "资产库",
        position: { x: 0, y: 0 },
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
                    payload: { cards: [{ cardId: "c1", cardType: "character", name: "主角", anchor: "a", storageKey: "image:k1" }] },
                    upstreamVersions: {},
                    generatedAt: "2026-07-15T00:00:00.000Z",
                },
            },
        },
    };
}

describe("投影节点零污染", () => {
    it("投影节点不进文本级联图", () => {
        const withProjection = reconcileAssetsProjection([assetsStage("assets-1")]);
        const graph = buildTextCascadeGraph(withProjection, []);
        const graphIds = new Set(graph.nodes.map((n) => n.nodeId));
        for (const projected of withProjection.filter(isAssetsProjectionNode)) {
            expect(graphIds.has(projected.id)).toBe(false);
        }
    });

    it("投影节点不进导出汇总(video-workbench 无关,应为空且不报错)", () => {
        const withProjection = reconcileAssetsProjection([assetsStage("assets-1")]);
        expect(() => collectExportSegments(withProjection)).not.toThrow();
        expect(collectExportSegments(withProjection).segments).toHaveLength(0);
    });
});
