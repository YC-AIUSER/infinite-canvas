# 画布自动摆位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Toonflow 画布加两个能力——生成新节点时轻量防碰撞、一键按连接流向把整个画布重排整齐。

**Architecture:** 两个纯函数与画布状态解耦:`resolveFreePosition`(撞上才向下轻推)接进生成路径;`computeAutoLayout`(顺连接分层 + 以组为块 + 组内紧凑方阵 + 父节点垂直居中)接进工具栏"整理"按钮。整理只调 `setNodes` 写新坐标,复用现有防抖历史 effect 自动提交单条撤销记录,CSS 过渡自动出动画。

**Tech Stack:** React + TypeScript(web/,Vite),测试用 vitest,包管理 bun。不引第三方布局库。

## Global Constraints

- 测试框架:vitest;运行命令一律在 `web/` 目录下 `npx vitest run <path>`。
- 类型检查:`cd web && npx tsc --noEmit` 必须 0 错。
- 纯函数不得引入副作用、不得读取 React 状态,只接收入参返回结果。
- 不新增第三方依赖(不装 dagre/elkjs 等)。
- 源码文件用 `@/` 路径别名引类型;测试文件用相对路径 `../../../types/canvas`(与现有 `web/src/lib/toonflow/__tests__` 一致)。
- 连接类型:`CanvasConnection = { id: string; fromNodeId: string; toNodeId: string }`(`web/src/types/canvas.ts:123`)。
- 节点默认尺寸见 `web/src/constant/canvas.ts` `NODE_DEFAULT_SIZE`(Image 340×240、Video 420×236 等)。

---

## File Structure

| 文件 | 职责 | 新建/修改 |
|---|---|---|
| `web/src/lib/canvas/free-position.ts` | 防碰撞纯函数 | 新建 |
| `web/src/lib/canvas/__tests__/free-position.test.ts` | 防碰撞测试 | 新建 |
| `web/src/lib/canvas/auto-layout.ts` | 自动布局纯函数 | 新建 |
| `web/src/lib/canvas/__tests__/auto-layout.test.ts` | 自动布局测试 | 新建 |
| `web/src/lib/toonflow/instances.ts` | 段实例生成:落点前调防碰撞 | 修改 |
| `web/src/lib/toonflow/__tests__/instances.test.ts` | 加"实例不压已有节点"测试 | 修改 |
| `web/src/components/canvas/canvas-toolbar.tsx` | 加"整理"按钮 + `onTidy` 回调 | 修改 |
| `web/src/pages/canvas/project.tsx` | `tidyCanvas` 处理器 + 接线工具栏 | 修改 |

---

## Task 1: 防碰撞纯函数 free-position

**Files:**
- Create: `web/src/lib/canvas/free-position.ts`
- Test: `web/src/lib/canvas/__tests__/free-position.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces:
  ```ts
  type Point = { x: number; y: number };
  type Size = { width: number; height: number };
  type Obstacle = { position: Point; width: number; height: number };
  type FreePositionOptions = { padding?: number; step?: number; maxScan?: number };
  function resolveFreePosition(desired: Point, size: Size, existing: Obstacle[], options?: FreePositionOptions): Point;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/canvas/__tests__/free-position.test.ts
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
        expect(result.y).toBeGreaterThanOrEqual(270);
    });

    it("扫描超上限时兜底返回最后位置,不死循环", () => {
        const tallWall = obstacle(0, 0, 100, 100000);
        const result = resolveFreePosition({ x: 0, y: 0 }, size, [tallWall], { padding: 0, step: 10, maxScan: 5 });
        expect(result.x).toBe(0);
        expect(typeof result.y).toBe("number");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/canvas/__tests__/free-position.test.ts`
Expected: FAIL —— `Failed to resolve import "../free-position"`。

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/lib/canvas/free-position.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/canvas/__tests__/free-position.test.ts`
Expected: PASS(5 个用例全绿)。

- [ ] **Step 5: 类型检查**

Run: `cd web && npx tsc --noEmit`
Expected: 0 错。

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/canvas/free-position.ts web/src/lib/canvas/__tests__/free-position.test.ts
git commit -m "feat: 画布防碰撞纯函数 resolveFreePosition(撞上才向下轻推)"
```

---

## Task 2: 段实例生成接入防碰撞

**Files:**
- Modify: `web/src/lib/toonflow/instances.ts`(`createInstance` 保持算理想位;`applyInstanceSync` 的 `toCreate` 循环落点前调 `resolveFreePosition`)
- Test: `web/src/lib/toonflow/__tests__/instances.test.ts`(新增 1 个用例)

**Interfaces:**
- Consumes: `resolveFreePosition`(Task 1)。
- Produces: `applyInstanceSync` 行为不变、签名不变;仅新建实例落点改为避开已有节点。

- [ ] **Step 1: Write the failing test**

在 `web/src/lib/toonflow/__tests__/instances.test.ts` 末尾追加(复用文件内已有 helper `template` / `sync` / `row`;若某 helper 未导出到该作用域,直接沿用文件顶部定义):

```ts
describe("applyInstanceSync 生成防碰撞", () => {
    it("新建实例不与画布上已有节点重叠", () => {
        // storyboard-page 根在 (500,100) 320x190;段0 实例理想落点约 (500,350)。
        // 放一个挡在该处的无关节点,新建实例应被向下挪开。
        const blocker: CanvasNodeData = {
            id: "blocker",
            type: CanvasNodeType.Image,
            title: "无关节点",
            position: { x: 500, y: 350 },
            width: 320,
            height: 190,
            metadata: {},
        };
        const nodes = [...template([row("seg-1", 1)]), blocker];
        const plan = planInstanceSync(nodes, "storyboard");
        expect(plan).not.toBeNull();
        const result = applyInstanceSync(nodes, [], plan!, idFactory());

        const created = result.nodes.filter((node) => node.metadata?.toonflow?.segmentId === "seg-1");
        expect(created.length).toBeGreaterThan(0);
        const overlap = (a: CanvasNodeData, b: CanvasNodeData) =>
            a.position.x < b.position.x + b.width && a.position.x + a.width > b.position.x && a.position.y < b.position.y + b.height && a.position.y + a.height > b.position.y;
        for (const node of created) {
            expect(overlap(node, blocker)).toBe(false);
        }
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/toonflow/__tests__/instances.test.ts -t "生成防碰撞"`
Expected: FAIL —— 新建实例落点仍是死板的 (500,350),与 blocker 重叠,`overlap` 为 true。

- [ ] **Step 3: Write minimal implementation**

在 `web/src/lib/toonflow/instances.ts` 顶部加导入:

```ts
import { resolveFreePosition } from "../canvas/free-position";
```

把 `applyInstanceSync` 里创建实例的循环(现为 `web/src/lib/toonflow/instances.ts:196-198`):

```ts
    for (const item of plan.toCreate) {
        const root = roots.get(item.kind)!;
        nextNodes.push(createInstance(root, item.segmentId, item.segmentIndex, createId()));
    }
```

改为(逐个落点、把已落下的累积进 `nextNodes` 让同批实例也相互避让):

```ts
    for (const item of plan.toCreate) {
        const root = roots.get(item.kind)!;
        const instance = createInstance(root, item.segmentId, item.segmentIndex, createId());
        const position = resolveFreePosition(instance.position, { width: instance.width, height: instance.height }, nextNodes);
        nextNodes.push({ ...instance, position });
    }
```

`createInstance` 本身不改(它算的仍是理想位,`web/src/lib/toonflow/instances.ts:127-129`)。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/toonflow/__tests__/instances.test.ts`
Expected: PASS(新用例绿,原有实例用例仍全绿)。

- [ ] **Step 5: 类型检查**

Run: `cd web && npx tsc --noEmit`
Expected: 0 错。

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/toonflow/instances.ts web/src/lib/toonflow/__tests__/instances.test.ts
git commit -m "feat: 段实例生成接入防碰撞——落点避开已有节点"
```

---

## Task 3: 自动布局纯函数 auto-layout

**Files:**
- Create: `web/src/lib/canvas/auto-layout.ts`
- Test: `web/src/lib/canvas/__tests__/auto-layout.test.ts`

**Interfaces:**
- Consumes: `CanvasNodeData`、`CanvasConnection`(`@/types/canvas`)。
- Produces:
  ```ts
  type LayoutPoint = { x: number; y: number };
  type LayoutOptions = { gapX?: number; gapY?: number; groupGap?: number; gridThreshold?: number };
  function computeAutoLayout(nodes: CanvasNodeData[], connections: CanvasConnection[], options?: LayoutOptions): Map<string, LayoutPoint>;
  ```
- 规则:顺连接分层(left→right);父节点垂直居中对齐其子块;子节点若"全是叶子且数量 ≥ gridThreshold"排成紧凑方阵(cols=ceil(√n)),否则各自子树纵向堆叠;游离节点(无任何连线)收到画布下方一行;成环/未放置节点回退到原坐标。

- [ ] **Step 1: Write the failing test**

```ts
// web/src/lib/canvas/__tests__/auto-layout.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npx vitest run src/lib/canvas/__tests__/auto-layout.test.ts`
Expected: FAIL —— `Failed to resolve import "../auto-layout"`。

- [ ] **Step 3: Write minimal implementation**

```ts
// web/src/lib/canvas/auto-layout.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npx vitest run src/lib/canvas/__tests__/auto-layout.test.ts`
Expected: PASS(4 个用例全绿)。

- [ ] **Step 5: 类型检查**

Run: `cd web && npx tsc --noEmit`
Expected: 0 错。

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/canvas/auto-layout.ts web/src/lib/canvas/__tests__/auto-layout.test.ts
git commit -m "feat: 画布自动布局纯函数——顺流向分层+组内紧凑方阵+父节点居中"
```

---

## Task 4: "整理"按钮接线(工具栏 + 处理器)

**Files:**
- Modify: `web/src/components/canvas/canvas-toolbar.tsx`(加 `onTidy` prop + 按钮)
- Modify: `web/src/pages/canvas/project.tsx`(加 `tidyCanvas` 处理器 + 传入工具栏)

**Interfaces:**
- Consumes: `computeAutoLayout`(Task 3);`nodes`、`connections`、`setNodes`、`setSelectedNodeIds`(project.tsx 已有);`CanvasToolbar`(已有)。
- Produces: 无(UI 接线)。行为:点击按钮 → 计算全画布新坐标 → `setNodes` 写入 → 现有防抖历史 effect 自动提交单条撤销记录 → 节点 CSS 过渡出动画。

> 说明:这是 UI 接线,验证靠类型检查 + 手动实测(整理按钮是对已单测过的纯函数 `computeAutoLayout` 的一次调用),不新增单测。

- [ ] **Step 1: 给 CanvasToolbar 增加 onTidy prop 与按钮**

在 `web/src/components/canvas/canvas-toolbar.tsx`:

1. 导入图标(在现有 `lucide-react` 导入行追加 `Wand2`):
```ts
import { CircleDot, Eraser, FolderOpen, Grid2x2, Group, Hand, Image as ImageIcon, Info, Moon, Music2, Palette, Redo2, Settings2, Square, Sun, Trash2, Type, Undo2, Upload, Video, Wand2 } from "lucide-react";
```

2. 在组件参数解构里(`onAddGroup,` 之后)加 `onTidy,`;在下方 props 类型里(`onAddGroup: () => void;` 之后)加:
```ts
    onTidy: () => void;
```

3. 在工具栏按钮区,紧挨 Undo/Redo 按钮附近加一个"整理"按钮,样式对齐同排现有 `Button`(以现有 Undo 按钮为模板复制,替换 icon/handler/title):
```tsx
                <Button type="text" size="small" icon={<Wand2 size={16} />} onClick={onTidy} title="一键整理" />
```
(若同排按钮用的是自定义包装而非 antd `Button`,则照抄相邻按钮的写法,仅替换 `icon={<Wand2 size={16} />}`、`onClick={onTidy}`、提示文案为"一键整理"。)

- [ ] **Step 2: 在 project.tsx 加处理器**

在 `web/src/pages/canvas/project.tsx` 顶部导入区加:
```ts
import { computeAutoLayout } from "@/lib/canvas/auto-layout";
```

在其他 `useCallback` 处理器附近(如 `undoCanvas` 定义之后)加:
```ts
    const tidyCanvas = useCallback(() => {
        const layout = computeAutoLayout(nodes, connections);
        setNodes((prev) => prev.map((node) => {
            const next = layout.get(node.id);
            return next ? { ...node, position: next } : node;
        }));
        setSelectedNodeIds(new Set());
    }, [nodes, connections]);
```
(`setNodes` 触发后,现有防抖历史 effect(`web/src/pages/canvas/project.tsx:490`)会在 180ms 内自动提交单条撤销记录,无需手动 push 历史。)

- [ ] **Step 3: 接线到工具栏**

在 `<CanvasToolbar ... />`(`web/src/pages/canvas/project.tsx:3554`)的 props 里,`onAddGroup={...}` 附近加:
```tsx
                    onTidy={tidyCanvas}
```

- [ ] **Step 4: 类型检查**

Run: `cd web && npx tsc --noEmit`
Expected: 0 错(尤其确认 `onTidy` 在 CanvasToolbar props 类型与调用处都存在,否则 TS 报缺 prop)。

- [ ] **Step 5: 全量测试回归**

Run: `cd web && npx vitest run`
Expected: 全绿(含 Task 1/2/3 新增用例 + 原有全部用例)。

- [ ] **Step 6: 手动实测(启动开发服)**

Run: `cd web && npm run dev`
在浏览器打开画布,验证:
1. 工具栏出现"整理"按钮;点击后节点按剧本→分镜→段实例→图→视频从左到右分层铺开,同段多图排成方阵,父节点垂直居中,游离节点在下方。
2. 生成节点时新节点不压已有节点(挤的画布下生成段实例,落点自动下移)。
3. 整理后按 Ctrl+Z 整个画布一次性还原;节点移动有平滑动画。

- [ ] **Step 7: Commit**

```bash
git add web/src/components/canvas/canvas-toolbar.tsx web/src/pages/canvas/project.tsx
git commit -m "feat: 画布工具栏加一键整理按钮——顺流向重排,复用撤销历史"
```

---

## Self-Review 记录

- **Spec 覆盖**:防碰撞纯函数(Task 1)+ 生成接入(Task 2);自动布局纯函数(Task 3)+ 按钮接线与撤销/动画(Task 4)。spec 的 7 项决策——顺流向分层、只避碰撞、整个画布、组内方阵、不画框、复用撤销、手写不引库——均落到对应 Task。游离节点下方带、父节点居中、成组方阵均有测试锚点。
- **占位符扫描**:无 TBD/TODO;所有代码步骤含完整代码;测试步骤含真实断言。
- **类型一致**:`resolveFreePosition` / `computeAutoLayout` 的签名在定义(Task 1/3)与调用(Task 2/4)处一致;`onTidy` 在 CanvasToolbar 定义与 project.tsx 调用处一致。
- **接入点取舍**:批量变体的"级联堆"(`project.tsx:758` `batchMotionById`)是渲染期的折叠堆叠视觉,节点本就是刻意叠放,不纳入防碰撞;防碰撞聚焦有明确落点计算的段实例路径(已测)。手动/agent 新建若后续需要,可复用同一 `resolveFreePosition`,不在本期范围。
