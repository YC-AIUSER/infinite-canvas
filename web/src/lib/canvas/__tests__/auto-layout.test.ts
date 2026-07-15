import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../../../types/canvas";
import { computeAutoLayout } from "../auto-layout";

function node(id: string): CanvasNodeData {
    return { id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width: 100, height: 80, metadata: {} };
}

function conn(from: string, to: string): CanvasConnection {
    return { id: `${from}->${to}`, fromNodeId: from, toNodeId: to };
}

function assertNoOverlap(nodes: CanvasNodeData[], pos: Map<string, { x: number; y: number }>) {
    const rects = nodes.map((n) => ({ ...pos.get(n.id)!, w: n.width, h: n.height }));
    for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i];
            const b = rects[j];
            const overlap = a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
            expect(overlap).toBe(false);
        }
    }
}

const range = (values: number[]) => Math.max(...values) - Math.min(...values);

// 布局方向为 top→bottom(dagre rankdir "TB"):流向沿 y 递增,同一层节点沿 x 铺开。
describe("computeAutoLayout (top→bottom)", () => {
    it("链式 A→B→C→D:y 递增、x 基本对齐(单条竖直水流)", () => {
        const nodes = ["A", "B", "C", "D"].map(node);
        const pos = computeAutoLayout(nodes, [conn("A", "B"), conn("B", "C"), conn("C", "D")]);
        const ys = ["A", "B", "C", "D"].map((id) => pos.get(id)!.y);
        expect(ys[0]).toBeLessThan(ys[1]);
        expect(ys[1]).toBeLessThan(ys[2]);
        expect(ys[2]).toBeLessThan(ys[3]);
        const xs = ["A", "B", "C", "D"].map((id) => pos.get(id)!.x);
        expect(range(xs)).toBeLessThan(1); // 一条直链应对齐成一列
    });

    it("父节点带 9 个子节点:子节点落在下一层同一行横向排开,父节点在上一层", () => {
        const kids = Array.from({ length: 9 }, (_, i) => node(`k${i}`));
        const nodes = [node("P"), ...kids];
        const conns = kids.map((k) => conn("P", k.id));
        const pos = computeAutoLayout(nodes, conns);
        const kidXs = kids.map((k) => pos.get(k.id)!.x);
        const kidYs = kids.map((k) => pos.get(k.id)!.y);
        expect(range(kidYs)).toBeLessThan(1); // 同一层 → 同一行(y 相同)
        expect(new Set(kidXs).size).toBe(9); // 横向 9 个不同 x
        expect(pos.get("P")!.y).toBeLessThan(kidYs[0]); // 父在子的上一层
        assertNoOverlap(nodes, pos);
    });

    it("菱形(多父节点)A→B、A→C、B→D、C→D:按层分行,汇聚点 D 在最下", () => {
        const nodes = ["A", "B", "C", "D"].map(node);
        const pos = computeAutoLayout(nodes, [conn("A", "B"), conn("A", "C"), conn("B", "D"), conn("C", "D")]);
        const [yA, yB, yC, yD] = ["A", "B", "C", "D"].map((id) => pos.get(id)!.y);
        expect(Math.abs(yB - yC)).toBeLessThan(1); // B、C 同层同行
        expect(yA).toBeLessThan(yB); // A 最上
        expect(yB).toBeLessThan(yD); // D 在 B/C 下方
        assertNoOverlap(nodes, pos);
    });

    it("多个独立起点铺成多行,而非横堆一行", () => {
        const roots = Array.from({ length: 9 }, (_, i) => node(`R${i}`));
        const kids = Array.from({ length: 9 }, (_, i) => node(`c${i}`));
        const nodes = [...roots, ...kids];
        const conns = roots.map((r, i) => conn(r.id, `c${i}`));
        const pos = computeAutoLayout(nodes, conns);
        const allYs = new Set(nodes.map((n) => pos.get(n.id)!.y));
        expect(allYs.size).toBeGreaterThan(1); // 至少两行(起点行 + 子节点行)
        assertNoOverlap(nodes, pos);
    });

    it("游离节点(无连线)排到所有连接节点下方", () => {
        const nodes = [node("A"), node("B"), node("F")];
        const pos = computeAutoLayout(nodes, [conn("A", "B")]);
        const connectedMaxY = Math.max(pos.get("A")!.y, pos.get("B")!.y);
        expect(pos.get("F")!.y).toBeGreaterThan(connectedMaxY);
    });

    it("组当刚性块:成员随容器整体平移,组内相对布局不变", () => {
        const container: CanvasNodeData = { id: "G", type: CanvasNodeType.Group, title: "G", position: { x: 0, y: 0 }, width: 200, height: 200, metadata: {} };
        const m1: CanvasNodeData = { id: "m1", type: CanvasNodeType.Image, title: "m1", position: { x: 20, y: 20 }, width: 50, height: 50, metadata: { groupId: "G" } };
        const m2: CanvasNodeData = { id: "m2", type: CanvasNodeType.Image, title: "m2", position: { x: 120, y: 120 }, width: 50, height: 50, metadata: { groupId: "G" } };
        const a = node("A");
        const pos = computeAutoLayout([container, m1, m2, a], [conn("A", "m1")]);
        // 成员之间相对偏移不变(整体刚性平移)
        expect(pos.get("m2")!.x - pos.get("m1")!.x).toBeCloseTo(100, 5);
        expect(pos.get("m2")!.y - pos.get("m1")!.y).toBeCloseTo(100, 5);
        // 成员相对容器的偏移不变
        expect(pos.get("m1")!.x - pos.get("G")!.x).toBeCloseTo(20, 5);
        expect(pos.get("m1")!.y - pos.get("G")!.y).toBeCloseTo(20, 5);
        // 外部节点 A 连到组成员 → A 应在组块上方(流向 A→组)
        expect(pos.get("A")!.y).toBeLessThan(pos.get("G")!.y);
    });

    it("布局后任意两节点不重叠", () => {
        const kids = Array.from({ length: 5 }, (_, i) => node(`k${i}`));
        const nodes = [node("P"), ...kids, node("F")];
        const conns = kids.map((k) => conn("P", k.id));
        const pos = computeAutoLayout(nodes, conns);
        assertNoOverlap(nodes, pos);
    });
});
