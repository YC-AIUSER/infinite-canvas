import { describe, expect, it } from "vitest";

import { resolveFreePosition } from "../free-position";

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
