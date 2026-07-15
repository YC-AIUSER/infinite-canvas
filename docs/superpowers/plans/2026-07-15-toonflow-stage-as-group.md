# Toonflow 环节组化(资产库垂直切片)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把资产库环节从"小节点 + 弹窗"升级为"一个组 + 每张资产卡一个真实子图节点",集合铺开在画布上、逐张可操作。

**Architecture:** 镜子路线——资产库节点的 `output.payload.cards[]` 仍是唯一真相源;新增一个纯函数把 `cards[]` 投影成 Group 节点 + 每卡一个 Image 子节点(带 `storageKey`,不带 `toonflow.kind`)。子节点渲染的 `content` 由异步层用 `resolveImageUrl` 从 storageKey 解析(复用现有 `hydrateCanvasImages` 成法)。投影层对级联/版本/导出机器零污染。

**Tech Stack:** React + TypeScript,Zustand,Vitest(`vitest run`,node env),现有画布节点/组机制。

## Global Constraints

- 语言/命名:代码与注释风格跟随 `web/src` 现有中文注释习惯。
- 真相源不可变:任何时候 `assets` 节点的 `output.payload.cards[]` 是唯一真相;投影节点(组 + 子节点)是派生视图,可整体丢弃重算,**禁止**反向把投影当权威写回除"删卡/单卡重生成经 `applyAssetCardsSave` 漏斗"之外的任何数据。
- 零污染不变量:投影节点(组与子节点)**一律不带 `metadata.toonflow`**。`node-runtime.ts` 的 `graphNodes()` / `buildTextCascadeGraph()` / `collectExportSegments()` 只认带 `toonflow` 的节点,故投影节点必须对这些函数不可见。此不变量必须有测试守卫。
- 不改 schema:`AssetCard`(`web/src/lib/toonflow/schema.ts`)字段已够用,本切片不动 zod schema。
- 只做资产库:不碰其它 13 环节;不做本体化/独立版本/跨组连线/组内嵌套(原卡→衍生卡子分组)。
- 测试命令:在 `web/` 目录下 `npm test`(= `vitest run`);单文件 `npx vitest run <path>`。当前基线全绿(约 198 测试),收尾必须仍全绿。
- 提交:从最新 `main` 起新分支 `feat/toonflow-stage-as-group`;当前工作树上未提交的 `docs/` spec/plan 一并纳入首个提交。频繁小步提交。

---

### Task 0: 建分支并纳入 spec/plan

**Files:**
- 无代码改动(仅 git)

- [ ] **Step 1: 从最新 main 建分支**

```bash
cd /d/workspaces/infinite-canvas
git fetch origin
git switch -c feat/toonflow-stage-as-group origin/main
```

- [ ] **Step 2: 提交已写好的 spec 与本 plan**

```bash
git add docs/superpowers/specs/2026-07-15-toonflow-stage-as-group-design.md docs/superpowers/plans/2026-07-15-toonflow-stage-as-group.md
git commit -m "docs: 资产库环节组化切片 spec + 实现计划"
```

---

### Task 1: 类型字段 + 投影纯函数

新增两个 metadata 标记字段与投影核心纯函数 `reconcileAssetsProjection`。这是整个切片的心脏,可完全单测。

**Files:**
- Modify: `web/src/types/canvas.ts`(`CanvasNodeMetadata` 加两字段)
- Create: `web/src/lib/canvas/toonflow-assets-projection.ts`
- Test: `web/src/lib/canvas/__tests__/toonflow-assets-projection.test.ts`

**Interfaces:**
- Consumes:`CanvasNodeData` / `CanvasNodeType`(`types/canvas.ts`);`AssetCard`(经 `node.metadata.toonflow.output.payload.cards`)。
- Produces:
  - `reconcileAssetsProjection(nodes: CanvasNodeData[]): CanvasNodeData[]` —— 幂等;返回"非投影节点原样 + 按当前各 assets 节点 cards[] 重建的组与子节点"。
  - `assetsGroupId(stageNodeId: string): string`
  - `assetsCardNodeId(stageNodeId: string, cardId: string): string`
  - `isAssetsProjectionNode(node: CanvasNodeData): boolean`

- [ ] **Step 1: 加 metadata 字段**

在 `web/src/types/canvas.ts` 的 `CanvasNodeMetadata` 里,`groupId?: string;` 一行下方加:

```ts
    groupId?: string;
    /** 投影标记:本节点是某 Toonflow 环节(如资产库)的投影组容器。 */
    projectionOf?: { stageNodeId: string; kind: ToonflowNodeKind };
    /** 投影标记:本节点是某环节某张资产卡的投影子节点,回指真相源。 */
    cardProjection?: { stageNodeId: string; cardId: string };
```

- [ ] **Step 2: 写失败测试**

创建 `web/src/lib/canvas/__tests__/toonflow-assets-projection.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../../../types/canvas";
import { assetsCardNodeId, assetsGroupId, isAssetsProjectionNode, reconcileAssetsProjection } from "../toonflow-assets-projection";

function assetsStage(id: string, cards: Array<{ cardId: string; name: string; storageKey?: string }>): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: "资产库",
        position: { x: 100, y: 100 },
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
                    nodeId: id,
                    kind: "assets",
                    version: 1,
                    status: "review",
                    payload: {
                        cards: cards.map((c) => ({ cardId: c.cardId, cardType: "character" as const, name: c.name, anchor: "锚点", storageKey: c.storageKey })),
                    },
                    upstreamVersions: {},
                    generatedAt: "2026-07-15T00:00:00.000Z",
                },
            },
        },
    };
}

describe("reconcileAssetsProjection", () => {
    it("为每张有 storageKey 的卡建一个子节点 + 一个组", () => {
        const stage = assetsStage("assets-1", [
            { cardId: "c1", name: "主角", storageKey: "image:k1" },
            { cardId: "c2", name: "反派", storageKey: "image:k2" },
        ]);
        const out = reconcileAssetsProjection([stage]);
        const group = out.find((n) => n.id === assetsGroupId("assets-1"));
        expect(group?.type).toBe(CanvasNodeType.Group);
        expect(group?.metadata?.projectionOf).toEqual({ stageNodeId: "assets-1", kind: "assets" });
        const child1 = out.find((n) => n.id === assetsCardNodeId("assets-1", "c1"));
        expect(child1?.type).toBe(CanvasNodeType.Image);
        expect(child1?.metadata?.storageKey).toBe("image:k1");
        expect(child1?.metadata?.groupId).toBe(assetsGroupId("assets-1"));
        expect(child1?.metadata?.cardProjection).toEqual({ stageNodeId: "assets-1", cardId: "c1" });
    });

    it("投影节点一律不带 toonflow(零污染不变量)", () => {
        const stage = assetsStage("assets-1", [{ cardId: "c1", name: "主角", storageKey: "image:k1" }]);
        const out = reconcileAssetsProjection([stage]);
        for (const n of out.filter(isAssetsProjectionNode)) {
            expect(n.metadata?.toonflow).toBeUndefined();
        }
    });

    it("无 storageKey 的卡不投影", () => {
        const stage = assetsStage("assets-1", [{ cardId: "c1", name: "未生成" }]);
        const out = reconcileAssetsProjection([stage]);
        expect(out.find((n) => n.id === assetsCardNodeId("assets-1", "c1"))).toBeUndefined();
        expect(out.find((n) => n.id === assetsGroupId("assets-1"))).toBeUndefined();
    });

    it("幂等:连跑两次结构一致", () => {
        const stage = assetsStage("assets-1", [{ cardId: "c1", name: "主角", storageKey: "image:k1" }]);
        const once = reconcileAssetsProjection([stage]);
        const twice = reconcileAssetsProjection(once);
        expect(twice.map((n) => n.id).sort()).toEqual(once.map((n) => n.id).sort());
    });

    it("删卡后对应子节点被移除", () => {
        const stage = assetsStage("assets-1", [
            { cardId: "c1", name: "主角", storageKey: "image:k1" },
            { cardId: "c2", name: "反派", storageKey: "image:k2" },
        ]);
        const first = reconcileAssetsProjection([stage]);
        const stage2 = assetsStage("assets-1", [{ cardId: "c1", name: "主角", storageKey: "image:k1" }]);
        const nodesAfter = [stage2, ...first.filter(isAssetsProjectionNode)];
        const out = reconcileAssetsProjection(nodesAfter);
        expect(out.find((n) => n.id === assetsCardNodeId("assets-1", "c2"))).toBeUndefined();
        expect(out.find((n) => n.id === assetsCardNodeId("assets-1", "c1"))).toBeDefined();
    });

    it("重跑保留用户拖动过的子节点位置", () => {
        const stage = assetsStage("assets-1", [{ cardId: "c1", name: "主角", storageKey: "image:k1" }]);
        const first = reconcileAssetsProjection([stage]);
        const moved = first.map((n) => (n.id === assetsCardNodeId("assets-1", "c1") ? { ...n, position: { x: 999, y: 888 } } : n));
        const out = reconcileAssetsProjection(moved);
        expect(out.find((n) => n.id === assetsCardNodeId("assets-1", "c1"))?.position).toEqual({ x: 999, y: 888 });
    });

    it("assets 节点被删后,残留投影节点被清除", () => {
        const stage = assetsStage("assets-1", [{ cardId: "c1", name: "主角", storageKey: "image:k1" }]);
        const first = reconcileAssetsProjection([stage]);
        const out = reconcileAssetsProjection(first.filter(isAssetsProjectionNode)); // 舞台节点已不在
        expect(out.filter(isAssetsProjectionNode)).toHaveLength(0);
    });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd web && npx vitest run src/lib/canvas/__tests__/toonflow-assets-projection.test.ts`
Expected: FAIL(`reconcileAssetsProjection` 未定义)

- [ ] **Step 4: 写实现**

创建 `web/src/lib/canvas/toonflow-assets-projection.ts`:

```ts
import { CanvasNodeType, type CanvasNodeData } from "../../types/canvas";

const GROUP_PREFIX = "assets-group-";
const CARD_PREFIX = "assets-card-";
const CARD_W = 200;
const CARD_H = 240;
const CARD_GAP = 24;
const GROUP_PAD = 48;
const GROUP_COLS = 4;
const GROUP_OFFSET_Y = 260; // 组默认摆在资产库节点下方

export function assetsGroupId(stageNodeId: string): string {
    return `${GROUP_PREFIX}${stageNodeId}`;
}

export function assetsCardNodeId(stageNodeId: string, cardId: string): string {
    return `${CARD_PREFIX}${stageNodeId}__${cardId}`;
}

export function isAssetsProjectionNode(node: CanvasNodeData): boolean {
    return Boolean(node.metadata?.projectionOf) || Boolean(node.metadata?.cardProjection);
}

/**
 * 把每个 assets 环节节点的 cards[](仅有 storageKey 的)投影成:一个 Group + 每卡一个 Image 子节点。
 * 幂等:非投影节点原样保留;投影节点每次整体重建(保留已存在节点的 position/尺寸)。
 * 真相源是 cards[],投影可整体丢弃重算。投影节点一律不带 toonflow,对级联/版本/导出零污染。
 */
export function reconcileAssetsProjection(nodes: CanvasNodeData[]): CanvasNodeData[] {
    const stageNodes = nodes.filter((node) => node.metadata?.toonflow?.kind === "assets");
    const projectionIds = new Set(nodes.filter(isAssetsProjectionNode).map((node) => node.id));
    if (!stageNodes.length && !projectionIds.size) return nodes;

    const base = nodes.filter((node) => !projectionIds.has(node.id));
    const existingById = new Map(nodes.map((node) => [node.id, node]));
    const added: CanvasNodeData[] = [];

    for (const stage of stageNodes) {
        const cards = (stage.metadata?.toonflow?.output?.payload.cards ?? []).filter((card) => Boolean(card.storageKey));
        if (!cards.length) continue;

        const groupId = assetsGroupId(stage.id);
        const cols = Math.min(cards.length, GROUP_COLS);
        const rows = Math.ceil(cards.length / GROUP_COLS);
        const groupW = GROUP_PAD * 2 + cols * CARD_W + (cols - 1) * CARD_GAP;
        const groupH = GROUP_PAD * 2 + rows * CARD_H + (rows - 1) * CARD_GAP;
        const groupPos = existingById.get(groupId)?.position ?? { x: stage.position.x, y: stage.position.y + GROUP_OFFSET_Y };

        added.push({
            id: groupId,
            type: CanvasNodeType.Group,
            title: stage.title,
            position: groupPos,
            width: groupW,
            height: groupH,
            metadata: { status: "idle", projectionOf: { stageNodeId: stage.id, kind: "assets" } },
        });

        cards.forEach((card, index) => {
            const childId = assetsCardNodeId(stage.id, card.cardId);
            const prev = existingById.get(childId);
            const col = index % GROUP_COLS;
            const row = Math.floor(index / GROUP_COLS);
            const position = prev?.position ?? {
                x: groupPos.x + GROUP_PAD + col * (CARD_W + CARD_GAP),
                y: groupPos.y + GROUP_PAD + row * (CARD_H + CARD_GAP),
            };
            added.push({
                id: childId,
                type: CanvasNodeType.Image,
                title: card.name,
                position,
                width: prev?.width ?? CARD_W,
                height: prev?.height ?? CARD_H,
                metadata: {
                    ...prev?.metadata,
                    status: "success",
                    storageKey: card.storageKey,
                    groupId,
                    cardProjection: { stageNodeId: stage.id, cardId: card.cardId },
                },
            });
        });
    }

    return [...base, ...added];
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd web && npx vitest run src/lib/canvas/__tests__/toonflow-assets-projection.test.ts`
Expected: PASS(全部用例绿)

- [ ] **Step 6: 提交**

```bash
git add web/src/types/canvas.ts web/src/lib/canvas/toonflow-assets-projection.ts web/src/lib/canvas/__tests__/toonflow-assets-projection.test.ts
git commit -m "feat: 资产库投影纯函数——cards[] → 组+子图节点(镜子路线)"
```

---

### Task 2: 零污染守卫测试

用 `node-runtime.ts` 现有导出,断言投影节点不进 toonflow 图/导出,把"零污染"钉成回归测试。

**Files:**
- Test: `web/src/lib/canvas/__tests__/toonflow-assets-projection-isolation.test.ts`

**Interfaces:**
- Consumes:`reconcileAssetsProjection`(Task 1);`buildTextCascadeGraph` / `collectExportSegments`(`web/src/lib/toonflow/node-runtime.ts`)。

- [ ] **Step 1: 写守卫测试**

创建 `web/src/lib/canvas/__tests__/toonflow-assets-projection-isolation.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData } from "../../../types/canvas";
import { buildTextCascadeGraph, collectExportSegments } from "../../toonflow/node-runtime";
import { isAssetsProjectionNode, reconcileAssetsProjection } from "../toonflow-assets-projection";

function assetsStage(id: string): CanvasNodeData {
    return {
        id,
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
                    nodeId: id,
                    kind: "assets",
                    version: 1,
                    status: "review",
                    payload: { cards: [{ cardId: "c1", cardType: "character", name: "主角", anchor: "a", storageKey: "image:k1" }] },
                    upstreamVersions: {},
                    generatedAt: "2026-07-15T00:00:00.000Z",
                },
            },
        },
    };
}

describe("投影节点零污染", () => {
    it("投影节点不进文本级联图", () => {
        const withProjection = reconcileAssetsProjection([assetsStage("assets-1")]);
        const graph = buildTextCascadeGraph(withProjection, []);
        const graphIds = new Set(graph.nodes.map((n) => n.nodeId));
        for (const projected of withProjection.filter(isAssetsProjectionNode)) {
            expect(graphIds.has(projected.id)).toBe(false);
        }
    });

    it("投影节点不进导出汇总(video-workbench 无关,应为空且不报错)", () => {
        const withProjection = reconcileAssetsProjection([assetsStage("assets-1")]);
        expect(() => collectExportSegments(withProjection)).not.toThrow();
        expect(collectExportSegments(withProjection).segments).toHaveLength(0);
    });
});
```

- [ ] **Step 2: 跑测试确认通过**

Run: `cd web && npx vitest run src/lib/canvas/__tests__/toonflow-assets-projection-isolation.test.ts`
Expected: PASS(投影节点因不带 `toonflow` 天然被 `graphNodes`/`collectExportSegments` 忽略)

- [ ] **Step 3: 提交**

```bash
git add web/src/lib/canvas/__tests__/toonflow-assets-projection-isolation.test.ts
git commit -m "test: 守卫投影节点对级联/导出零污染"
```

---

### Task 3: 接入画布——卡片保存/加载时重建投影

把投影重建接到 `cards[]` 变更的唯一漏斗(`handleToonflowAssetCardsSave`)与画布加载路径;新投影子节点的 `content` 用 `resolveImageUrl` 从 storageKey 异步解析。

**Files:**
- Modify: `web/src/pages/canvas/project.tsx`
  - import 区(顶部,约 `line 48` 一带)加投影模块 import
  - `handleToonflowAssetCardsSave`(约 `line 2922`)
  - 画布加载 hydration(`hydrateToonflowProject` 调用点,配合 `line 4028 hydrateCanvasImages`)

**Interfaces:**
- Consumes:`reconcileAssetsProjection` / `isAssetsProjectionNode`(Task 1);`resolveImageUrl`(`@/services/image-storage`,已在 `line 12` 导入)。
- Produces:`applyAssetsProjection(nodes: CanvasNodeData[]): Promise<CanvasNodeData[]>` —— 组件内异步辅助:先跑纯函数得结构,再为缺 `content` 的投影子节点解析 storageKey→url。

- [ ] **Step 1: 加 import**

在 `web/src/pages/canvas/project.tsx` 顶部 import 区(紧邻其它 `@/lib/canvas` 导入)加:

```ts
import { reconcileAssetsProjection, isAssetsProjectionNode } from "@/lib/canvas/toonflow-assets-projection";
```

- [ ] **Step 2: 加异步投影辅助函数**

在组件内(靠近其它 `handleToonflow*` 定义处,如 `line 2921` 之后)加:

```ts
    // 投影层:纯函数出结构,再为新子节点解析 storageKey→content(复用图片 hydrate 成法)。真相源 cards[] 不变。
    const applyAssetsProjection = useCallback(async (input: CanvasNodeData[]): Promise<CanvasNodeData[]> => {
        const structured = reconcileAssetsProjection(input);
        return Promise.all(
            structured.map(async (node) => {
                if (!isAssetsProjectionNode(node) || node.type !== CanvasNodeType.Image) return node;
                if (node.metadata?.content || !node.metadata?.storageKey) return node;
                const url = await resolveImageUrl(node.metadata.storageKey, "");
                return url ? { ...node, metadata: { ...node.metadata, content: url } } : node;
            }),
        );
    }, []);
```

- [ ] **Step 3: 卡片保存后重建投影**

把 `handleToonflowAssetCardsSave`(约 `line 2922`)改为:

```ts
    const handleToonflowAssetCardsSave = useCallback(
        async (nodeId: string, cards: AssetCard[]) => {
            const saved = applyAssetCardsSave(nodesRef.current, connectionsRef.current, nodeId, cards);
            const next = await applyAssetsProjection(saved);
            nodesRef.current = next;
            setNodes(next);
            setToonflowAssetCardsNodeId(null);
        },
        [applyAssetsProjection],
    );
```

- [ ] **Step 4: 画布加载后重建投影**

找到加载路径里 `hydrateToonflowProject(...)` 的调用点(setNodes(restoredNodes) 一带,约 `line 460`)。在 `hydrateCanvasImages` 之后、`setNodes` 之前,对节点数组补一层 `reconcileAssetsProjection`,并让 `hydrateCanvasImages` 负责解析子节点 content(它已处理带 storageKey+content 的 Image;新子节点需先有 content 才会被解析,故加载路径用与 Step 2 相同的 `applyAssetsProjection` 收口)。将该处替换为:

```ts
            const projected = await applyAssetsProjection(hydratedNodes);
            nodesRef.current = projected;
            setNodes(projected);
```

(`hydratedNodes` = 现有 `hydrateCanvasImages`/`hydrateToonflowProject` 之后的数组变量名;若变量名不同,按实际替换,保持"投影收口在 setNodes 之前"。)

- [ ] **Step 5: 手动冒烟——生成资产后看组**

Run(浏览器,见 Task 5 详细步骤,这里只快速自检):`cd web && npm run dev`,新建 Toonflow 画布 → 生成资产卡 → 确认画布下方出现「资产库」组且组内每卡一图。

- [ ] **Step 6: 跑全量测试确认无回归**

Run: `cd web && npm test`
Expected: PASS(基线全绿 + Task 1/2 新测试)

- [ ] **Step 7: 提交**

```bash
git add web/src/pages/canvas/project.tsx
git commit -m "feat: 资产卡保存/加载时重建组投影,子节点解析 storageKey"
```

---

### Task 4: 子节点操作——删卡同步 + 单卡重生成

让投影子节点可"删除"(同步删 `cards[]`)与"重生成"(复用 `handleToonflowAssetCardGenerate`,写回 `cards[]`),两者都经 `handleToonflowAssetCardsSave` 漏斗,保持真相源单向。

**Files:**
- Create: `web/src/lib/canvas/__tests__/toonflow-assets-card-ops.test.ts`
- Modify: `web/src/lib/canvas/toonflow-assets-projection.ts`(加纯辅助 `removeCardFromStageCards`)
- Modify: `web/src/pages/canvas/project.tsx`(子节点删除/重生成处理器 + hover 工具条接线)
- Modify: `web/src/components/canvas/canvas-node-hover-toolbar.tsx`(投影子节点显示"重生成/删除"两个动作)

**Interfaces:**
- Consumes:`reconcileAssetsProjection`;`handleToonflowAssetCardsSave`(Task 3);`handleToonflowAssetCardGenerate`(`project.tsx` 约 `line 2929`,签名 `(nodeId, card, allCards) => Promise<string | undefined>`,返回新 storageKey)。
- Produces:
  - `removeCardFromStageCards(nodes, stageNodeId, cardId): AssetCard[]` —— 返回删掉该卡后的 cards[](纯,供保存漏斗)。
  - `CanvasNodeHoverToolbar` 新增 prop `onRegenerateCard: (node: CanvasNodeData) => void`。

**正确性要点(必须遵守):** 投影子节点无 `toonflow`,现有工具条会把它当普通图片、自动挂裁剪/放大/蒙版等**通用图片编辑工具**——这些会改图节点却不回写 `cards[]`,破坏单一真相源。因此子节点必须走**专用精简工具条(信息/重生成/删除/下载)**,禁止暴露通用图片编辑入口。

**已知边界(本切片不处理,happy path 之外):** 仅"hover 工具条对单个子节点删除"会同步 `cards[]`;框选多个一起删、或直接删投影组节点,不保证同步(组会在下次 reconcile 自愈重建)。这些留待推广阶段。

- [ ] **Step 1: 写纯辅助的失败测试**

创建 `web/src/lib/canvas/__tests__/toonflow-assets-card-ops.test.ts`:

```ts
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
                kind: "assets", stage: "参考资产", status: "review", summary: "", checks: [],
                output: {
                    nodeId: "assets-1", kind: "assets", version: 1, status: "review",
                    payload: { cards: cardIds.map((id) => ({ cardId: id, cardType: "character" as const, name: id, anchor: "a", storageKey: `image:${id}` })) },
                    upstreamVersions: {}, generatedAt: "2026-07-15T00:00:00.000Z",
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run src/lib/canvas/__tests__/toonflow-assets-card-ops.test.ts`
Expected: FAIL(`removeCardFromStageCards` 未定义)

- [ ] **Step 3: 实现纯辅助**

在 `web/src/lib/canvas/toonflow-assets-projection.ts` 末尾加:

```ts
import type { AssetCard } from "../toonflow/schema";

/** 从某 assets 环节的 cards[] 里删掉一张卡,返回新数组(供保存漏斗;真相源单向)。 */
export function removeCardFromStageCards(nodes: CanvasNodeData[], stageNodeId: string, cardId: string): AssetCard[] {
    const stage = nodes.find((node) => node.id === stageNodeId && node.metadata?.toonflow?.kind === "assets");
    const cards = stage?.metadata?.toonflow?.output?.payload.cards ?? [];
    return cards.filter((card) => card.cardId !== cardId);
}
```

(把该文件顶部 import 补上 `AssetCard` 类型;若已按顺序放在文件头更好——将 `import type { AssetCard } ...` 移到文件顶部 import 区。)

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run src/lib/canvas/__tests__/toonflow-assets-card-ops.test.ts`
Expected: PASS

- [ ] **Step 5: project.tsx 加子节点删除/重生成处理器**

在 `project.tsx` 组件内(`handleToonflowAssetCardsSave` 之后)加:

```ts
    // 投影子节点"删除":删对应 cards[] 一张卡,经保存漏斗同步(会连带重建投影)。
    const handleAssetCardNodeDelete = useCallback(
        async (childNode: CanvasNodeData) => {
            const ref = childNode.metadata?.cardProjection;
            if (!ref) return;
            const nextCards = removeCardFromStageCards(nodesRef.current, ref.stageNodeId, ref.cardId);
            await handleToonflowAssetCardsSave(ref.stageNodeId, nextCards);
        },
        [handleToonflowAssetCardsSave],
    );

    // 投影子节点"重生成":复用单卡生成,写回该卡 storageKey,经保存漏斗同步。
    const handleAssetCardNodeRegenerate = useCallback(
        async (childNode: CanvasNodeData) => {
            const ref = childNode.metadata?.cardProjection;
            if (!ref) return;
            const stage = nodesRef.current.find((node) => node.id === ref.stageNodeId);
            const cards = stage?.metadata?.toonflow?.output?.payload.cards ?? [];
            const card = cards.find((item) => item.cardId === ref.cardId);
            if (!card) return;
            const newKey = await handleToonflowAssetCardGenerate(ref.stageNodeId, card, cards);
            if (!newKey) return;
            const nextCards = cards.map((item) => (item.cardId === ref.cardId ? { ...item, storageKey: newKey } : item));
            await handleToonflowAssetCardsSave(ref.stageNodeId, nextCards);
        },
        [handleToonflowAssetCardGenerate, handleToonflowAssetCardsSave],
    );
```

顶部 import 补 `removeCardFromStageCards`:

```ts
import { reconcileAssetsProjection, isAssetsProjectionNode, removeCardFromStageCards } from "@/lib/canvas/toonflow-assets-projection";
```

- [ ] **Step 6a: 工具条组件加专用精简工具条**

在 `web/src/components/canvas/canvas-node-hover-toolbar.tsx`:

其一,`CanvasNodeHoverToolbarProps` 类型里 `onDelete` 一行之上加一个 prop:

```ts
    onRegenerateCard: (node: CanvasNodeData) => void;
    onDelete: (node: CanvasNodeData) => void;
```

其二,在函数参数解构里(`onDelete,` 一行之前)加 `onRegenerateCard,`。

其三,在 `const top = ...`(约 `line 105`)之后、`const isToonflow = ...` 之前,插入投影子节点的专用早返回(用到已在上方声明的 `left`/`top`/`showImageToolLabels`):

```ts
    const isAssetCard = Boolean(node.metadata?.cardProjection);
    if (isAssetCard) {
        const cardTools: ToolbarTool[] = [
            { id: "info", title: "查看节点信息", label: "信息", icon: <Info className="size-4" />, onClick: () => onInfo(node) },
            { id: "regenCard", title: "重生成这张资产卡", label: "重生成", icon: <RefreshCw className="size-4" />, onClick: () => onRegenerateCard(node) },
            ...(node.metadata?.content ? [{ id: "download", title: "下载图片", label: "下载", icon: <Download className="size-4" />, onClick: () => onDownload(node) }] : []),
            { id: "delete", title: "删除这张资产卡", label: "删除", icon: <Trash2 className="size-4" />, onClick: () => onDelete(node), danger: true },
        ];
        return (
            <div
                className="absolute z-[70] flex h-12 -translate-x-1/2 -translate-y-full items-center overflow-visible rounded-[18px] border border-black/10 bg-white text-[15px] text-[#242529] shadow-[0_8px_28px_rgba(15,23,42,.12)]"
                style={{ left, top }}
                onMouseEnter={() => onKeep(node.id)}
                onMouseLeave={() => onLeave()}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                {cardTools.map((tool) => (
                    <ToolbarAction key={tool.id} {...tool} showLabel={showImageToolLabels} />
                ))}
            </div>
        );
    }
```

此早返回绕过通用图片工具与快捷工具过滤,子节点只暴露"信息/重生成/下载/删除"。

- [ ] **Step 6b: project.tsx 挂载点传入两个 card-aware 回调**

在 `<CanvasNodeHoverToolbar ...>`(约 `line 3539`)里,把 `onDelete`(约 `line 3563`)改成 card-aware,并新增 `onRegenerateCard`:

```tsx
                    onRegenerateCard={(node) => void handleAssetCardNodeRegenerate(node)}
                    onDelete={(node) => {
                        if (node.metadata?.cardProjection) return void handleAssetCardNodeDelete(node);
                        deleteNodes(new Set([node.id]));
                    }}
```

删除投影子节点即经 `handleAssetCardNodeDelete → removeCardFromStageCards → handleToonflowAssetCardsSave`(会 bump 版本、向下游传播 stale)→ reconcile 同步。不触发浏览器原生 confirm。

- [ ] **Step 7: 手动冒烟 + 全量测试**

浏览器:对某子节点点「重生成」→ 图更新;点「删除」→ 子节点消失且资产弹窗内该卡也没了(cards[] 同步)。
Run: `cd web && npm test`
Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add web/src/lib/canvas/toonflow-assets-projection.ts web/src/lib/canvas/__tests__/toonflow-assets-card-ops.test.ts web/src/pages/canvas/project.tsx web/src/components/canvas/canvas-node-hover-toolbar.tsx
git commit -m "feat: 投影子节点支持删卡同步与单卡重生成(经保存漏斗)"
```

---

### Task 5: 浏览器端到端验证 + 收尾

按 spec 成功标准逐条实测,证据留档。

**Files:**
- 无(验证任务;如发现 bug,回到对应 Task 修)

- [ ] **Step 1: 起服务**

Run: `cd web && npm run dev`,浏览器开本地地址,新建「Toonflow 生产画布」。

- [ ] **Step 2: 验收标准 1——集合铺开免弹窗**

生成资产卡后,画布出现「资产库」组,组内每张卡一个真实图节点,直接可见,不必开弹窗。截图留证。

- [ ] **Step 3: 验收标准 2——单选/拖动/删卡同步**

单张子节点可选中、拖动;整组可拖动;删一张子节点 → 该子节点消失,打开资产弹窗确认对应卡也已删除。

- [ ] **Step 4: 验收标准 3——单卡重生成**

对某子节点点「重生成」,确认该子节点图更新,资产弹窗内该卡图同步更新。

- [ ] **Step 5: 验收标准 4——下游不受影响**

继续往下生成故事板页/首帧/视频(至少跑通一段),确认下游读取 `payload.cards` 正常、端到端产出不受投影影响。

- [ ] **Step 6: 验收标准 6——刷新恢复**

刷新页面,确认组与子节点正确恢复,无脏节点/孤儿(节点数与卡数一致)。

- [ ] **Step 7: 验收标准 5——全量测试绿**

Run: `cd web && npm test`
Expected: PASS(基线 + 新增 projection/isolation/card-ops 测试全绿)

- [ ] **Step 8: 更新 CHANGELOG 并提交**

在 `CHANGELOG.md` 顶部加一条(风格跟随现有条目):资产库环节组化——集合铺开为画布子节点(镜子路线,零污染)。

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG 补资产库环节组化切片"
```

---

## 自查(spec 覆盖对照)

- spec「数据模型 · 投影层」→ Task 1(组/子节点结构 + 两个 metadata 字段)。
- spec「零污染不变量」→ Task 1 用例 + Task 2 守卫测试。
- spec「同步行为」表:生成/编辑后重建 → Task 3;加载重建 → Task 3 Step 4;拖动保位 → Task 1 用例;删子节点 → Task 4;单卡重生成 → Task 4;删 assets 节点连带清投影 → Task 1 用例(舞台消失即清)。
- spec「决策 3 复用 batch 成法」→ 子节点为真实持久化节点 + `groupId`,复用现有归组/拖动(Task 1 产出 + 现有 `project.tsx` group 机制)。
- spec「成功标准 1-6」→ Task 5 逐条实测。
- spec 非目标(其它环节/本体化/嵌套)→ 计划内无对应任务,符合边界。
- spec 开放问题①单卡重生成路径 → 已确认复用 `handleToonflowAssetCardGenerate`(Task 4);②位置持久化 → 采"子节点真实持久化 + reconcile 保位"(Task 1);③组标题/角标 → 组标题=环节名(Task 1),状态角标本切片从简。
