import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../../../types/canvas";
import { cloneCanvasNodes } from "../node-clone";

function node(id: string, metadata?: CanvasNodeData["metadata"]): CanvasNodeData {
    return { id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata };
}

describe("节点复制", () => {
    it("复制批次根时重建子节点及全部批次引用", () => {
        const root = node("root-old", { isBatchRoot: true, batchChildIds: ["child-old"], primaryImageId: "child-old" });
        const child = node("child-old", { batchRootId: "root-old", references: ["image:source"] });

        const { nodes } = cloneCanvasNodes([root], [root, child], (_node, index) => `clone-${index}`);
        const clonedRoot = nodes[0];
        const clonedChild = nodes[1];

        expect(nodes).toHaveLength(2);
        expect(clonedRoot.metadata?.batchChildIds).toEqual([clonedChild.id]);
        expect(clonedRoot.metadata?.batchChildIds).not.toContain(child.id);
        expect(clonedRoot.metadata?.primaryImageId).toBe(clonedChild.id);
        expect(clonedChild.metadata?.batchRootId).toBe(clonedRoot.id);
        expect(clonedChild.metadata?.batchRootId).not.toBe(root.id);
    });

    it("复制资产卡投影时剥离 cardProjection", () => {
        const source = node("projection-old", { cardProjection: { stageNodeId: "assets-old", cardId: "card-old" } });

        const { nodes } = cloneCanvasNodes([source], [source], () => "projection-new");

        expect(nodes[0].metadata?.cardProjection).toBeUndefined();
    });
});
