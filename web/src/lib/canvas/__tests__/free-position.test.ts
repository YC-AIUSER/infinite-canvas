import { describe, expect, it } from "vitest";

import { resolveFreePosition, resolveFreePositionsForNodes } from "../free-position";

const size = { width: 100, height: 80 };

function obstacle(x: number, y: number, width = 100, height = 80) {
    return { position: { x, y }, width, height };
}

describe("resolveFreePosition", () => {
    it("空场景原样返回理想位置", () => {
        expect(resolveFreePosition({ x: 10, y: 20 }, size, [])).toEqual({ x: 10, y: 20 });
    });

    it("不重叠时原样返回", () => {
        const result = resolveFreePosition({ x: 0, y: 0 }, size, [obstacle(500, 500)]);
        expect(result).toEqual({ x: 0, y: 0 });
    });

    it("重叠时保持 x 不变、向下挪到不重叠", () => {
        const result = resolveFreePosition({ x: 0, y: 0 }, size, [obstacle(0, 0)], { padding: 0, step: 10 });
        expect(result.x).toBe(0);
        expect(result.y).toBeGreaterThanOrEqual(80);
    });

    it("连续障碍时越过整叠找到下方空位", () => {
        const walls = [obstacle(0, 0), obstacle(0, 90), obstacle(0, 180)];
        const result = resolveFreePosition({ x: 0, y: 0 }, size, walls, { padding: 0, step: 10 });
        expect(result.x).toBe(0);
        // 最后一堵墙底边在 y=260(180+80);padding=0 时恰好贴合不算重叠,故空位为 260。
        expect(result.y).toBeGreaterThanOrEqual(260);
    });

    it("扫描超上限时兜底返回最后位置,不死循环", () => {
        const tallWall = obstacle(0, 0, 100, 100000);
        const result = resolveFreePosition({ x: 0, y: 0 }, size, [tallWall], { padding: 0, step: 10, maxScan: 5 });
        expect(result.x).toBe(0);
        expect(typeof result.y).toBe("number");
    });
});

// 回归背景:同一父节点反复生成,子节点理想位置由父几何决定永远相同,曾出现 4 个节点
// 完全重叠。批量安置必须把"已有节点"和"本批已放下的兄弟"都当障碍。
describe("resolveFreePositionsForNodes(生成子节点批量安置)", () => {
    it("理想位置被既有节点占住时向下让开(反复生成不再重叠)", () => {
        const existing = [obstacle(200, 0)];
        const [placed] = resolveFreePositionsForNodes([{ position: { x: 200, y: 0 }, width: 100, height: 80 }], existing, { padding: 0, step: 10 });
        expect(placed.x).toBe(200);
        expect(placed.y).toBeGreaterThanOrEqual(80);
    });

    it("同批兄弟互为障碍,不会集体挪到同一个空位再叠上", () => {
        const existing = [obstacle(200, 0)];
        const desired = [
            { position: { x: 200, y: 0 }, width: 100, height: 80 },
            { position: { x: 200, y: 0 }, width: 100, height: 80 },
        ];
        const [first, second] = resolveFreePositionsForNodes(desired, existing, { padding: 0, step: 10 });
        expect(first).not.toEqual(second);
        expect(second.y).toBeGreaterThanOrEqual(first.y + 80);
    });

    it("空场景保持理想位置与输入顺序不变", () => {
        const desired = [
            { position: { x: 0, y: 0 }, width: 100, height: 80 },
            { position: { x: 300, y: 0 }, width: 100, height: 80 },
        ];
        expect(resolveFreePositionsForNodes(desired, [], { padding: 0, step: 10 })).toEqual([
            { x: 0, y: 0 },
            { x: 300, y: 0 },
        ]);
    });
});
