import { describe, expect, it } from "vitest";

import { computeFocusViewport, computeNodesBounds } from "../viewport-camera";

const viewportSize = { width: 1000, height: 800 };
const current = { x: 0, y: 0, k: 1 };

describe("viewport-camera", () => {
    it("目标大部分在屏内时不移动镜头", () => {
        expect(computeFocusViewport({ x: 100, y: 120, width: 300, height: 200 }, viewportSize, current)).toBeNull();
    });

    it("屏外目标保持当前缩放并居中", () => {
        expect(computeFocusViewport({ x: 1400, y: 900, width: 200, height: 100 }, viewportSize, current)).toEqual({ x: -1000, y: -550, k: 1 });
    });

    it("多节点使用整批包围盒", () => {
        expect(
            computeNodesBounds([
                { position: { x: 1200, y: 300 }, width: 200, height: 100 },
                { position: { x: 1600, y: 700 }, width: 300, height: 200 },
            ]),
        ).toEqual({ x: 1200, y: 300, width: 700, height: 600 });
    });

    it("当前缩放放不下目标时缩小并钳制最小比例", () => {
        const result = computeFocusViewport({ x: 1000, y: 1000, width: 20000, height: 12000 }, viewportSize, current, { minScale: 0.05 });
        expect(result?.k).toBe(0.05);
    });

    it("聚焦结果为目标保留指定边距", () => {
        const bounds = { x: 1200, y: 500, width: 840, height: 400 };
        const result = computeFocusViewport(bounds, viewportSize, current, { margin: 80 });
        expect(result).not.toBeNull();
        expect(result!.k).toBe(1);
        expect(bounds.x * result!.k + result!.x).toBe(80);
        expect((bounds.x + bounds.width) * result!.k + result!.x).toBe(920);
    });
});
