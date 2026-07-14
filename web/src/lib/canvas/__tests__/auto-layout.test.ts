import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../../../types/canvas";
import { computeAutoLayout } from "../auto-layout";

function node(id: string): CanvasNodeData {
    return { id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width: 100, height: 80, metadata: {} };
}

function conn(from: string, to: string): CanvasConnection {
    return { id: `${from}->${to}`, fromNodeId: from, toNodeId: to };
}

describe("computeAutoLayout", () => {
    it("链式 A→B→C→D:x 递增、y 相同", () => {
        const nodes = ["A", "B", "C", "D"].map(node);
        const pos = computeAutoLayout(nodes, [conn("A", "B"), conn("B", "C"), conn("C", "D")]);
        const xs = ["A", "B", "C", "D"].map((id) => pos.get(id)!.x);
        expect(xs[0]).toBeLessThan(xs[1]);
        expect(xs[1]).toBeLessThan(xs[2]);
        expect(xs[2]).toBeLessThan(xs[3]);
        const ys = ["A", "B", "C", "D"].map((id) => pos.get(id)!.y);
        expect(new Set(ys).size).toBe(1);
    });

    it("父节点带 9 个叶子:排成 3×3 方阵,父节点垂直居中", () => {
        const kids = Array.from({ length: 9 }, (_, i) => node(`k${i}`));
        const nodes = [node("P"), ...kids];
        const conns = kids.map((k) => conn("P", k.id));
        const pos = computeAutoLayout(nodes, conns);
        const kidXs = new Set(kids.map((k) => pos.get(k.id)!.x));
        const kidYs = new Set(kids.map((k) => pos.get(k.id)!.y));
        expect(kidXs.size).toBe(3); // 3 列
        expect(kidYs.size).toBe(3); // 3 行
        const pY = pos.get("P")!.y;
        const minY = Math.min(...kids.map((k) => pos.get(k.id)!.y));
        const maxY = Math.max(...kids.map((k) => pos.get(k.id)!.y));
        expect(pY).toBeGreaterThanOrEqual(minY);
        expect(pY).toBeLessThanOrEqual(maxY);
    });

    it("游离节点(无连线)排到所有连接节点下方", () => {
        const nodes = [node("A"), node("B"), node("F")];
        const pos = computeAutoLayout(nodes, [conn("A", "B")]);
        const connectedMaxY = Math.max(pos.get("A")!.y, pos.get("B")!.y);
        expect(pos.get("F")!.y).toBeGreaterThan(connectedMaxY);
    });

    it("布局后任意两节点不重叠", () => {
        const kids = Array.from({ length: 5 }, (_, i) => node(`k${i}`));
        const nodes = [node("P"), ...kids, node("F")];
        const conns = kids.map((k) => conn("P", k.id));
        const pos = computeAutoLayout(nodes, conns);
        const rects = nodes.map((n) => ({ ...pos.get(n.id)!, w: n.width, h: n.height }));
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                const a = rects[i];
                const b = rects[j];
                const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
                expect(overlap).toBe(false);
            }
        }
    });
});
