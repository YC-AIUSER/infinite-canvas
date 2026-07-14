export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Obstacle = { position: Point; width: number; height: number };
export type FreePositionOptions = { padding?: number; step?: number; maxScan?: number };

type Rect = { x: number; y: number; width: number; height: number };

function overlaps(a: Rect, b: Rect, padding: number): boolean {
    return (
        a.x < b.x + b.width + padding &&
        a.x + a.width + padding > b.x &&
        a.y < b.y + b.height + padding &&
        a.y + a.height + padding > b.y
    );
}

// 先按现有规则算出理想位置(desired),本函数只做后处理:
// 若矩形压到已有节点,保持 x 不变、沿 y 向下逐步挪到第一个不重叠处。
export function resolveFreePosition(desired: Point, size: Size, existing: Obstacle[], options: FreePositionOptions = {}): Point {
    const padding = options.padding ?? 16;
    const step = options.step ?? 24;
    const maxScan = options.maxScan ?? 200;
    const obstacles: Rect[] = existing.map((node) => ({ x: node.position.x, y: node.position.y, width: node.width, height: node.height }));
    let y = desired.y;
    for (let i = 0; i <= maxScan; i++) {
        const candidate: Rect = { x: desired.x, y, width: size.width, height: size.height };
        if (!obstacles.some((obstacle) => overlaps(candidate, obstacle, padding))) return { x: desired.x, y };
        y += step;
    }
    return { x: desired.x, y };
}
