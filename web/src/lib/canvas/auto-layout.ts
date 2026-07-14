import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export type LayoutPoint = { x: number; y: number };
export type LayoutOptions = { gapX?: number; gapY?: number; groupGap?: number; gridThreshold?: number };

// 顺连接流向分层布局(left→right):
// - 每个父节点连同其直接子节点为一"块",父节点垂直居中对齐子块;
// - 子节点全为叶子且数量 ≥ gridThreshold 时排成接近正方形的紧凑方阵,否则各子树纵向堆叠;
// - 游离节点(无任何连线)收到画布下方一行;成环/未放置节点回退原坐标。
export function computeAutoLayout(nodes: CanvasNodeData[], connections: CanvasConnection[], options: LayoutOptions = {}): Map<string, LayoutPoint> {
    const gapX = options.gapX ?? 120;
    const gapY = options.gapY ?? 40;
    const groupGap = options.groupGap ?? 80;
    const gridThreshold = options.gridThreshold ?? 4;

    const byId = new Map(nodes.map((node) => [node.id, node]));
    const result = new Map<string, LayoutPoint>();

    // 父→子邻接;单亲认领(同一子节点只归第一条入边的父)。
    const childrenOf = new Map<string, string[]>();
    const claimed = new Set<string>();
    const hasEdge = new Set<string>();
    for (const conn of connections) {
        if (!byId.has(conn.fromNodeId) || !byId.has(conn.toNodeId)) continue;
        hasEdge.add(conn.fromNodeId);
        hasEdge.add(conn.toNodeId);
        if (conn.fromNodeId === conn.toNodeId || claimed.has(conn.toNodeId)) continue;
        claimed.add(conn.toNodeId);
        const list = childrenOf.get(conn.fromNodeId) ?? [];
        list.push(conn.toNodeId);
        childrenOf.set(conn.fromNodeId, list);
    }

    // 子节点排序:按 segmentIndex → title → id,保证确定性与网格顺序。
    const orderKey = (id: string): [number, string, string] => {
        const node = byId.get(id)!;
        const seg = node.metadata?.toonflow?.segmentIndex ?? Number.MAX_SAFE_INTEGER;
        return [seg, node.title ?? "", node.id];
    };
    for (const list of childrenOf.values()) {
        list.sort((a, b) => {
            const ka = orderKey(a);
            const kb = orderKey(b);
            return ka[0] - kb[0] || ka[1].localeCompare(kb[1]) || ka[2].localeCompare(kb[2]);
        });
    }

    const children = (id: string) => childrenOf.get(id) ?? [];
    const isLeaf = (id: string) => children(id).length === 0;
    const useGrid = (kids: string[]) => kids.length >= gridThreshold && kids.every(isLeaf);

    // 子块高度(记忆化 + 成环守卫)。
    const heightMemo = new Map<string, number>();
    const inProgress = new Set<string>();
    function blockHeight(id: string): number {
        const cached = heightMemo.get(id);
        if (cached !== undefined) return cached;
        const node = byId.get(id)!;
        if (inProgress.has(id)) return node.height;
        inProgress.add(id);
        const kids = children(id);
        let height: number;
        if (kids.length === 0) {
            height = node.height;
        } else if (useGrid(kids)) {
            const cols = Math.ceil(Math.sqrt(kids.length));
            const rows = Math.ceil(kids.length / cols);
            const cellH = Math.max(...kids.map((k) => byId.get(k)!.height)) + gapY;
            height = rows * cellH - gapY;
        } else {
            height = kids.reduce((sum, k) => sum + blockHeight(k), 0) + (kids.length - 1) * groupGap;
        }
        height = Math.max(height, node.height);
        inProgress.delete(id);
        heightMemo.set(id, height);
        return height;
    }

    // 放置子树:node 放在列 x,整块顶部对齐 topY,node 垂直居中于块。
    const placed = new Set<string>();
    function place(id: string, x: number, topY: number): void {
        if (placed.has(id)) return;
        placed.add(id);
        const node = byId.get(id)!;
        const height = blockHeight(id);
        result.set(id, { x, y: topY + (height - node.height) / 2 });
        const kids = children(id);
        if (kids.length === 0) return;
        const childX = x + node.width + gapX;
        if (useGrid(kids)) {
            const cols = Math.ceil(Math.sqrt(kids.length));
            const cellW = Math.max(...kids.map((k) => byId.get(k)!.width)) + gapX;
            const cellH = Math.max(...kids.map((k) => byId.get(k)!.height)) + gapY;
            kids.forEach((k, index) => {
                const col = index % cols;
                const rowIndex = Math.floor(index / cols);
                result.set(k, { x: childX + col * cellW, y: topY + rowIndex * cellH });
                placed.add(k);
            });
        } else {
            let running = topY;
            for (const k of kids) {
                place(k, childX, running);
                running += blockHeight(k) + groupGap;
            }
        }
    }

    // 连接根:有连线且从未被认领为子节点;游离节点:完全无连线。
    const roots = nodes.filter((node) => hasEdge.has(node.id) && !claimed.has(node.id));
    const floating = nodes.filter((node) => !hasEdge.has(node.id));

    let running = 0;
    let maxBottom = 0;
    for (const root of roots) {
        place(root.id, 0, running);
        running += blockHeight(root.id) + groupGap;
        maxBottom = Math.max(maxBottom, running);
    }

    let floatX = 0;
    const floatY = maxBottom + groupGap * 2;
    for (const node of floating) {
        result.set(node.id, { x: floatX, y: floatY });
        floatX += node.width + gapX;
    }

    // 兜底:成环等未放置的节点保留原坐标。
    for (const node of nodes) {
        if (!result.has(node.id)) result.set(node.id, { x: node.position.x, y: node.position.y });
    }

    return result;
}
