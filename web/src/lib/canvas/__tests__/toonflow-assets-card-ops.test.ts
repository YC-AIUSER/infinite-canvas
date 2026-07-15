import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../../../types/canvas";
import { removeCardFromStageCards } from "../toonflow-assets-projection";

function stage(cardIds: string[]): CanvasNodeData {
    return {
        id: "assets-1",
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
                    nodeId: "assets-1",
                    kind: "assets",
                    version: 1,
                    status: "review",
                    payload: { cards: cardIds.map((id) => ({ cardId: id, cardType: "character" as const, name: id, anchor: "a", storageKey: `image:${id}` })) },
                    upstreamVersions: {},
                    generatedAt: "2026-07-15T00:00:00.000Z",
                },
            },
        },
    };
}

describe("removeCardFromStageCards", () => {
    it("删掉指定 cardId,其余保留顺序", () => {
        const out = removeCardFromStageCards([stage(["a", "b", "c"])], "assets-1", "b");
        expect(out.map((c) => c.cardId)).toEqual(["a", "c"]);
    });

    it("stageNodeId 不存在时返回空数组", () => {
        expect(removeCardFromStageCards([stage(["a"])], "nope", "a")).toEqual([]);
    });
});
