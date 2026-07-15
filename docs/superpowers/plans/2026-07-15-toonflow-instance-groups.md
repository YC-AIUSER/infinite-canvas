# Toonflow 段实例环节组化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把 storyboard-page / keyframes / video-workbench 三个多段环节的段实例,从 batch 分组换成真 Group 容器(root 当组内头部),段同步内核与图片批量 batch 一律不动。

**Architecture:** 表现层替换。`instances.ts` 只移除给段实例 root 打 batch 呈现标记的一段;新增纯函数 `reconcileInstanceGroups` 用成员当前位置包围盒生成 Group、给 root+活跃实例设 groupId,在段同步落地/加载/删归档实例后运行。段实例保留 toonflow(权威、在级联里);Group 容器无 toonflow。

**Tech Stack:** React + TS,Vitest(node env)。

## Global Constraints
- 权威真相:段实例的 toonflow/segmentId 及 `instances.ts` 的 create/archive/reindex/连线/stale 是真相;Group 与 groupId 是派生,可整体重算。
- **段同步内核零改动**:除移除"给 root 打 batch 呈现标记"一段外,`instances.ts` 不得有任何其它逻辑改动。
- **图片批量 batch 零影响**:reconcileInstanceGroups 只碰段环节 root(INSTANCE_KINDS 且无 segmentId)与其活跃实例;不得读写 `isBatchRoot` 图片批量节点。
- Group 容器不带 `metadata.toonflow`。复用资产库已加的 `projectionOf` 字段,不新增类型。
- 测试:`cd web && npm test`;单文件 `npx vitest run <path>`。基线 210 全绿,收尾须仍全绿 + `npm run typecheck` 净。
- git 由外部(Claude)处理;实现者不 commit/branch。

---

### Task 1: reconcileInstanceGroups 纯函数 + 单测

**Files:**
- Create: `web/src/lib/canvas/toonflow-instance-groups.ts`
- Test: `web/src/lib/canvas/__tests__/toonflow-instance-groups.test.ts`

**Interfaces (Produces):**
- `reconcileInstanceGroups(nodes: CanvasNodeData[]): CanvasNodeData[]`
- `instanceGroupId(rootNodeId: string): string`
- `isInstanceGroupNode(node: CanvasNodeData): boolean`

- [ ] **Step 1: 写失败测试**

创建 `web/src/lib/canvas/__tests__/toonflow-instance-groups.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData, type ToonflowNodeKind } from "../../../types/canvas";
import { instanceGroupId, isInstanceGroupNode, reconcileInstanceGroups } from "../toonflow-instance-groups";

function root(id: string, kind: ToonflowNodeKind, x = 0, y = 0): CanvasNodeData {
    return { id, type: CanvasNodeType.Video, title: "视频工作台", position: { x, y }, width: 300, height: 180,
        metadata: { toonflow: { kind, stage: "s", status: "empty", summary: "", checks: [] } } };
}
function instance(id: string, kind: ToonflowNodeKind, segmentId: string, x: number, y: number, archived = false): CanvasNodeData {
    return { id, type: CanvasNodeType.Video, title: `${kind}·段`, position: { x, y }, width: 300, height: 180,
        metadata: { batchRootId: `root-${kind}`, toonflow: { kind, stage: "s", status: "empty", summary: "", checks: [], segmentId, segmentIndex: 0, archived } } };
}

describe("reconcileInstanceGroups", () => {
    it("为有活跃实例的环节建一个 Group,root+实例都设 groupId", () => {
        const nodes = [root("root-video-workbench", "video-workbench", 0, 0), instance("v1", "video-workbench", "seg1", 0, 240)];
        const out = reconcileInstanceGroups(nodes);
        const gid = instanceGroupId("root-video-workbench");
        const group = out.find((n) => n.id === gid);
        expect(group?.type).toBe(CanvasNodeType.Group);
        expect(group?.metadata?.projectionOf).toEqual({ stageNodeId: "root-video-workbench", kind: "video-workbench" });
        expect(out.find((n) => n.id === "root-video-workbench")?.metadata?.groupId).toBe(gid);
        expect(out.find((n) => n.id === "v1")?.metadata?.groupId).toBe(gid);
    });

    it("Group 是成员当前位置的包围盒(含 root 与实例)", () => {
        const nodes = [root("r", "keyframes", 100, 100), instance("k1", "keyframes", "seg1", 100, 400)];
        const out = reconcileInstanceGroups(nodes);
        const g = out.find((n) => n.id === instanceGroupId("r"))!;
        // 包围盒须包住 root(100,100,+300x180)与实例(100,400,+300x180)
        expect(g.position.x).toBeLessThanOrEqual(100);
        expect(g.position.y).toBeLessThanOrEqual(100);
        expect(g.position.x + g.width).toBeGreaterThanOrEqual(400);
        expect(g.position.y + g.height).toBeGreaterThanOrEqual(580);
    });

    it("Group 容器不带 toonflow", () => {
        const out = reconcileInstanceGroups([root("r", "keyframes"), instance("k1", "keyframes", "seg1", 0, 240)]);
        expect(out.find(isInstanceGroupNode)?.metadata?.toonflow).toBeUndefined();
    });

    it("无活跃实例(只有 root)不建组", () => {
        const out = reconcileInstanceGroups([root("r", "keyframes")]);
        expect(out.find(isInstanceGroupNode)).toBeUndefined();
        expect(out.find((n) => n.id === "r")?.metadata?.groupId).toBeUndefined();
    });

    it("归档实例移出组(不算成员)", () => {
        const nodes = [root("r", "keyframes"), instance("k1", "keyframes", "seg1", 0, 240), instance("k2", "keyframes", "seg2", 320, 240, true)];
        const out = reconcileInstanceGroups(nodes);
        expect(out.find((n) => n.id === "k1")?.metadata?.groupId).toBe(instanceGroupId("r"));
        expect(out.find((n) => n.id === "k2")?.metadata?.groupId).toBeUndefined();
    });

    it("幂等:连跑两次结构一致、成员位置不变", () => {
        const nodes = [root("r", "keyframes", 5, 5), instance("k1", "keyframes", "seg1", 5, 300)];
        const once = reconcileInstanceGroups(nodes);
        const twice = reconcileInstanceGroups(once);
        expect(twice.map((n) => n.id).sort()).toEqual(once.map((n) => n.id).sort());
        expect(twice.find((n) => n.id === "k1")?.position).toEqual({ x: 5, y: 300 });
    });

    it("root 消失后残留组被清、成员 groupId 清除", () => {
        const first = reconcileInstanceGroups([root("r", "keyframes"), instance("k1", "keyframes", "seg1", 0, 240)]);
        const orphanMembers = first.filter((n) => n.id === "k1"); // 只留实例,root 与组都不传入
        const out = reconcileInstanceGroups(orphanMembers);
        expect(out.find(isInstanceGroupNode)).toBeUndefined();
        expect(out.find((n) => n.id === "k1")?.metadata?.groupId).toBeUndefined();
    });

    it("不碰图片批量节点(isBatchRoot 与其 groupId 无关字段保持)", () => {
        const batchRoot: CanvasNodeData = { id: "img", type: CanvasNodeType.Image, title: "图", position: { x: 0, y: 0 }, width: 100, height: 100,
            metadata: { isBatchRoot: true, batchChildIds: ["c1"] } };
        const out = reconcileInstanceGroups([batchRoot, root("r", "keyframes"), instance("k1", "keyframes", "seg1", 0, 240)]);
        const img = out.find((n) => n.id === "img");
        expect(img?.metadata?.isBatchRoot).toBe(true);
        expect(img?.metadata?.batchChildIds).toEqual(["c1"]);
        expect(img?.metadata?.groupId).toBeUndefined();
    });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run src/lib/canvas/__tests__/toonflow-instance-groups.test.ts`
Expected: FAIL(未定义)

- [ ] **Step 3: 写实现**

创建 `web/src/lib/canvas/toonflow-instance-groups.ts`:

```ts
import { CanvasNodeType, type CanvasNodeData, type ToonflowNodeKind } from "../../types/canvas";

const INSTANCE_KINDS: ReadonlySet<ToonflowNodeKind> = new Set(["storyboard-page", "keyframes", "video-workbench"]);
const GROUP_PREFIX = "instance-group-";
const GROUP_PAD = 40;

export function instanceGroupId(rootNodeId: string): string {
    return `${GROUP_PREFIX}${rootNodeId}`;
}

export function isInstanceGroupNode(node: CanvasNodeData): boolean {
    return node.type === CanvasNodeType.Group && node.id.startsWith(GROUP_PREFIX) && Boolean(node.metadata?.projectionOf);
}

function isInstanceRoot(node: CanvasNodeData): boolean {
    const tf = node.metadata?.toonflow;
    return Boolean(tf && INSTANCE_KINDS.has(tf.kind) && !tf.segmentId);
}

function activeInstancesOfKind(nodes: CanvasNodeData[], kind: ToonflowNodeKind): CanvasNodeData[] {
    return nodes.filter((n) => {
        const tf = n.metadata?.toonflow;
        return Boolean(tf && tf.kind === kind && tf.segmentId && !tf.archived);
    });
}

/**
 * 给每个"有活跃段实例"的环节 root 维护一个 Group 容器:成员 = root + 活跃实例,
 * Group = 成员当前位置包围盒 + padding。root/实例设 groupId(保位,不重摆)。
 * 段实例保留 toonflow(权威、在级联里);Group 无 toonflow。幂等、可整体重算。
 * 只碰段环节 root/实例,绝不碰图片批量(isBatchRoot)节点。
 */
export function reconcileInstanceGroups(nodes: CanvasNodeData[]): CanvasNodeData[] {
    const roots = nodes.filter(isInstanceRoot);
    const existingGroupIds = new Set(nodes.filter(isInstanceGroupNode).map((n) => n.id));
    if (!roots.length && !existingGroupIds.size) return nodes;

    // 期望:每个有活跃实例的 root → 一个组 + 成员集合
    const desired = new Map<string, { root: CanvasNodeData; memberIds: string[] }>();
    const memberToGroup = new Map<string, string>();
    for (const root of roots) {
        const kind = root.metadata!.toonflow!.kind;
        const instances = activeInstancesOfKind(nodes, kind);
        if (!instances.length) continue;
        const gid = instanceGroupId(root.id);
        const memberIds = [root.id, ...instances.map((n) => n.id)];
        desired.set(gid, { root, memberIds });
        for (const id of memberIds) memberToGroup.set(id, gid);
    }
    const desiredGroupIds = new Set(desired.keys());

    // 1. 移除所有 instance-group 节点(下面按 desired 重建);2. 修正成员 groupId
    const withoutGroups = nodes.filter((n) => !isInstanceGroupNode(n));
    const memberFixed = withoutGroups.map((n) => {
        const desiredGid = memberToGroup.get(n.id);
        const currentGid = n.metadata?.groupId;
        if (desiredGid) {
            return currentGid === desiredGid ? n : { ...n, metadata: { ...n.metadata, groupId: desiredGid } };
        }
        // 曾属某 instance-group 但现已不该(root/实例消失、归档)→ 清 groupId
        if (currentGid && currentGid.startsWith(GROUP_PREFIX)) {
            return { ...n, metadata: { ...n.metadata, groupId: undefined } };
        }
        return n;
    });

    // 3. 用成员当前位置包围盒建组
    const groupNodes: CanvasNodeData[] = [];
    for (const [gid, { root, memberIds }] of desired) {
        const memberNodes = memberIds.map((id) => memberFixed.find((n) => n.id === id)).filter((n): n is CanvasNodeData => Boolean(n));
        if (!memberNodes.length) continue;
        const minX = Math.min(...memberNodes.map((n) => n.position.x));
        const minY = Math.min(...memberNodes.map((n) => n.position.y));
        const maxX = Math.max(...memberNodes.map((n) => n.position.x + n.width));
        const maxY = Math.max(...memberNodes.map((n) => n.position.y + n.height));
        groupNodes.push({
            id: gid,
            type: CanvasNodeType.Group,
            title: root.title,
            position: { x: minX - GROUP_PAD, y: minY - GROUP_PAD },
            width: maxX - minX + GROUP_PAD * 2,
            height: maxY - minY + GROUP_PAD * 2,
            metadata: { status: "idle", projectionOf: { stageNodeId: root.id, kind: root.metadata!.toonflow!.kind } },
        });
    }

    return [...memberFixed, ...groupNodes];
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run src/lib/canvas/__tests__/toonflow-instance-groups.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**(由 Claude 执行;实现者跳过 git)

---

### Task 2: 移除 instances.ts 的段实例 batch 呈现标记 + 等价守卫测试

**Files:**
- Modify: `web/src/lib/toonflow/instances.ts`(移除 `applyInstanceSync` 末尾给 root 打 batch 标记的 `nextNodes = nextNodes.map(...)` 块,现约 line 222-239)
- Test: `web/src/lib/canvas/__tests__/toonflow-instance-groups-isolation.test.ts`

**Interfaces (Consumes):** `applyInstanceSync` / `planInstanceSync`(instances.ts);`reconcileInstanceGroups`(Task 1);`collectExportSegments` / `buildTextCascadeGraph`(node-runtime)。

- [ ] **Step 1: 移除 batch 标记块**

在 `web/src/lib/toonflow/instances.ts` 的 `applyInstanceSync` 内,**删除**这一整段(它给段实例 root 打 `isBatchRoot`/`batchChildIds`/`imageBatchExpanded`):

```ts
    nextNodes = nextNodes.map<CanvasNodeData>((node) => {
        const rootKind = node.metadata?.toonflow?.kind;
        if (!rootKind || !isInstanceKind(rootKind) || roots.get(rootKind)?.id !== node.id) return node;
        const children = instances
            .filter((instance) => instance.metadata!.toonflow!.kind === rootKind)
            .sort((left, right) => left.metadata!.toonflow!.segmentIndex! - right.metadata!.toonflow!.segmentIndex!)
            .map((instance) => instance.id);
        const hadInstances = nodes.some((instance) => instance.metadata?.toonflow?.kind === rootKind && instance.metadata.toonflow.segmentId);
        return {
            ...node,
            metadata: {
                ...node.metadata,
                isBatchRoot: true,
                batchChildIds: children,
                imageBatchExpanded: !hadInstances && children.length ? (node.metadata?.imageBatchExpanded ?? true) : node.metadata?.imageBatchExpanded,
            },
        };
    });
```

删除后 `return { nodes: nextNodes, connections: nextConnections };` 直接返回上一步的 `nextNodes`(create/archive/reindex/连线均已在此之前完成,不受影响)。`instances`/`hadInstances` 若因此变为未使用需一并清理(避免 lint/typecheck 报未使用;`instances` 仍被上方连线逻辑使用则保留)。

- [ ] **Step 2: 写守卫测试(先失败/或直接验证)**

创建 `web/src/lib/canvas/__tests__/toonflow-instance-groups-isolation.test.ts`。用一个"分镜表已通过 + 三 root 存在"的最小图,断言:
1. `reconcileInstanceGroups` 前后 `planInstanceSync` 结果不变(加 groupId/Group 不影响段同步计划)。
2. `reconcileInstanceGroups` 后 `collectExportSegments` 与 `buildTextCascadeGraph` 结果与之前一致(Group/groupId 对导出/级联不可见)。
3. `applyInstanceSync` 输出的段实例节点**不再带** isBatchRoot/batchChildIds/imageBatchExpanded(呈现标记已移除),但 create/archive/reindex 与连线数量不变。

```ts
import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../../../types/canvas";
import { applyInstanceSync, planInstanceSync } from "../../toonflow/instances";
import { collectExportSegments } from "../../toonflow/node-runtime";
import { reconcileInstanceGroups } from "../toonflow-instance-groups";

// 构造:storyboard-table(approved,2 段)+ 三 root(storyboard-page/keyframes/video-workbench,无 segmentId)
function buildBaseGraph(): { nodes: CanvasNodeData[]; connections: CanvasConnection[] } {
    const table = [
        { segmentId: "seg1", shotId: "s1", shotNo: 1, scale: "", angle: "", action: "", line: "", sfx: "", mood: "", durationSec: 5 },
        { segmentId: "seg2", shotId: "s2", shotNo: 1, scale: "", angle: "", action: "", line: "", sfx: "", mood: "", durationSec: 5 },
    ];
    const tf = (kind: any, extra: any = {}) => ({ metadata: { toonflow: { kind, stage: "s", status: "empty", summary: "", checks: [], ...extra } } });
    const node = (id: string, kind: any, y: number, extra: any = {}): CanvasNodeData => ({ id, type: CanvasNodeType.Video, title: id, position: { x: 0, y }, width: 300, height: 180, ...tf(kind, extra) } as any);
    const storyboardTable: CanvasNodeData = {
        id: "table", type: CanvasNodeType.Text, title: "分镜表", position: { x: 0, y: 0 }, width: 300, height: 180,
        metadata: { toonflow: { kind: "storyboard-table", stage: "s", status: "approved", summary: "", checks: [],
            output: { nodeId: "table", kind: "storyboard-table", version: 1, status: "approved", payload: { table }, upstreamVersions: {}, generatedAt: "2026-07-15T00:00:00.000Z" } } },
    };
    const nodes = [storyboardTable, node("root-sp", "storyboard-page", 300), node("root-kf", "keyframes", 500), node("root-vw", "video-workbench", 700)];
    return { nodes, connections: [] };
}

describe("段实例组化 · 零污染/内核守卫", () => {
    it("reconcile 前后 planInstanceSync 不变;导出不受 Group 影响", () => {
        const { nodes, connections } = buildBaseGraph();
        let id = 0; const mkId = () => `gen-${id++}`;
        const plan = planInstanceSync(nodes, "table")!;
        const synced = applyInstanceSync(nodes, connections, plan, mkId);
        // 段实例 root 不再带 batch 呈现标记
        const roots = synced.nodes.filter((n) => ["storyboard-page", "keyframes", "video-workbench"].includes(n.metadata?.toonflow?.kind as string) && !n.metadata?.toonflow?.segmentId);
        for (const r of roots) {
            expect(r.metadata?.isBatchRoot).toBeUndefined();
            expect(r.metadata?.batchChildIds).toBeUndefined();
        }
        // reconcile 后 planInstanceSync 与 collectExportSegments 不变
        const grouped = reconcileInstanceGroups(synced.nodes);
        const planAfter = planInstanceSync(grouped, "table");
        const planBefore = planInstanceSync(synced.nodes, "table");
        expect(JSON.stringify(planAfter)).toEqual(JSON.stringify(planBefore));
        expect(collectExportSegments(grouped).segments.length).toEqual(collectExportSegments(synced.nodes).segments.length);
    });
});
```

- [ ] **Step 3: 更新现存 instances.test.ts(删冗余 batch 断言,保行为覆盖)**

移除段实例 batch 标记后,`web/src/lib/toonflow/__tests__/instances.test.ts` 里若干 `batchChildIds` 断言会失效。**这些断言与"连线/segmentIndex"断言重复,配对与重排行为已被后者覆盖**。按下述**替换**(不是删覆盖):

- 用例「首次同步…写入三个根的 batchChildIds」(约 line 92):**删除** line 105-107 的三条 `batchChildIds` 断言;标题改为「首次同步为每段创建三类实例、链式配对」。**保留** 97-104 的实例顺序断言与 108-119 的连线断言(配对由连线验)。
- 用例「消失段…从根 batchChildIds 剔除」(约 line 160):**删除** line 170-172 的三条 `batchChildIds` 断言;标题改为「消失段会归档并断开全部连线」。保留归档(168)与连线断开(169)断言。
- 用例「段顺序变化…根节点排序」(约 line 188):**删除** line 199-200 的两条 `batchChildIds` 断言;标题改为「段顺序变化会更新实例 segmentIndex」。保留 197-198 的 segmentIndex 断言与 201 的 title 断言(重排由 segmentIndex 验)。
- 用例「删除归档实例…」(约 line 204):**不动**(它测的是 `deleteArchivedInstance`,本任务未改该函数;它手动构造 batchChildIds,仍通过)。

**硬约束:只删这四处与已移除的 batch 标记直接相关的冗余断言,不得删改任何验证 create/archive/reindex/连线/stale/位置 的断言。**

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `cd web && npx vitest run src/lib/canvas/__tests__/toonflow-instance-groups-isolation.test.ts && npm test`
Expected: PASS(instances.test.ts 更新后仍绿,覆盖不减)

- [ ] **Step 5: 提交**(Claude)

---

### Task 3: 接入画布(段同步落地 / 加载 / 删归档实例后 reconcile)

**Files:**
- Modify: `web/src/pages/canvas/project.tsx`

- [ ] **Step 1: import**

顶部加(与资产库投影同处):
```ts
import { reconcileInstanceGroups } from "@/lib/canvas/toonflow-instance-groups";
```

- [ ] **Step 2: 段同步落地后 reconcile**

`applyStoryboardInstancePlan`(约 line 2882)改为在 setNodes 前过 `reconcileInstanceGroups`:
```ts
    const applyStoryboardInstancePlan = useCallback((plan: InstanceSyncPlan) => {
        const synced = applyInstanceSync(nodesRef.current, connectionsRef.current, plan, () => nanoid());
        const withGroups = reconcileInstanceGroups(synced.nodes);
        nodesRef.current = withGroups;
        connectionsRef.current = synced.connections;
        setNodes(withGroups);
        setConnections(synced.connections);
    }, []);
```

- [ ] **Step 3: 加载路径 reconcile**

在现有 `applyAssetsProjection` 收口处(加载 restore 里),对节点数组再过一层 `reconcileInstanceGroups`。将 `const projected = await applyAssetsProjection(restoredNodes);` 之后接:
```ts
            const withInstanceGroups = reconcileInstanceGroups(projected);
```
并把随后 `nodesRef.current` / `setNodes` / `lastHistoryRef.nodes` 从 `projected` 改用 `withInstanceGroups`。

- [ ] **Step 4: 删归档实例后 reconcile**

`handleDeleteArchivedInstance`(约 line 2989)里,`deleteArchivedInstance` 返回后,对 `next.nodes` 过一层 `reconcileInstanceGroups` 再 setNodes(使归档实例移出组、包围盒收缩):
```ts
        const withGroups = reconcileInstanceGroups(next.nodes);
        nodesRef.current = withGroups;
        connectionsRef.current = next.connections;
        setNodes(withGroups);
        setConnections(next.connections);
```
(媒体清理逻辑不变,基于 `next.nodes` 的引用集计算即可,或改用 `withGroups`——两者节点集等价,Group 不含媒体键。)

- [ ] **Step 5: 手动冒烟 + 全量测试 + typecheck**

Run: `cd web && npm test && npm run typecheck`
Expected: PASS

- [ ] **Step 6: 提交**(Claude)

---

### Task 4:(Claude 执行)浏览器端到端验收 + CHANGELOG

按 spec 成功标准 1-6 浏览器实测:段同步→三环节组渲染、整组拖动带走 root+实例、**图片批量仍正常展开/收起/拖动/删除(回归)**、刷新恢复、下游生成/导出照常。全量测试绿 + typecheck 净。CHANGELOG 补一条。git 提交。

## 自查(spec 覆盖)
- 表现层替换 → Task 1(reconcile)+ Task 2(移 batch 标记)。
- 三守卫(段同步不变/导出级联不变/图片批量不动)→ Task 1 图片批量用例 + Task 2 隔离测试。
- 接入三处(同步/加载/删归档)→ Task 3。
- 成功标准 1-6 → Task 4 实测。
- 非目标(内核算法、图片批量、段内拆分)→ 无对应任务,符合边界。
