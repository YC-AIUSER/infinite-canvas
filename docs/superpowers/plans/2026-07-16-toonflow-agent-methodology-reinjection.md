# Toonflow Agent 方法论工具结果再入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Agent 对话式驱动改 Toonflow 时,方法论从"开场系统提示挂一次"变为"每次碰到某环节,该环节红线搭在工具返回结果里回来",按环节 kind 精准再入、抗上下文压缩。

**Architecture:** 新增按环节 kind 的压缩红线表(单一事实源在 web `prompts.ts`,canvas-agent 逐字镜像 + sync 测试锁一致,沿用决议 8B 成法)。在 canvas-agent `callTool`(所有 Agent 工具调用总闸门)的返回结果边界,把读路径逻辑抽成纯函数并注入红线:选中/改动命中环节 → echo 该环节红线;读全画布 → 只挂全局三铁律 + 指引(防刷屏)。只动 Agent 路径,确定性按钮路径(`build*Prompt`)一行不碰。

**Tech Stack:** TypeScript;web 侧 vitest(已有 224 测试);canvas-agent 侧本任务新增 vitest;canvas-agent 是独立发布的 npm 包(`@yinchenhuang/canvas-agent`),不能 `import` web/src。

## Global Constraints

- 单一事实源 = `web/src/lib/toonflow/prompts.ts`;canvas-agent 内嵌副本必须逐字一致,由 web `agent-brief-sync` 测试锁定,漂移即 CI 红。
- 确定性按钮路径(`build*Prompt`)、画布数据模型、持久化、级联版本机器**一律不动**。
- 非 Toonflow 节点(节点无 `metadata.toonflow`)**零追加**,不污染普通画布 Agent。
- 5 条环节专属红线字符串在 web override 表与 canvas-agent 表中必须**逐字相同**(全角标点),照抄下方字面量,勿改写。
- canvas-agent tsconfig `include` 为 `src/**/*.ts`——测试文件放 `canvas-agent/test/`,不进 `dist`(且 package.json `files` 只发 `dist`)。
- 提交信息结尾附:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。

### 5 条环节专属红线(逐字字面量,两处共用)

```
video-workbench : 视频工作台：以九宫格故事板页为第一构图参考、每镜与格子逐一1:1，禁止首尾帧续接或硬拼，不合并镜头、不新增机位。
storyboard-page : 故事板页：格子与镜头逐一1:1，把空间合同与180°轴线锁落到每一格构图。
keyframes       : 首帧：线稿是构图锁，只上色不改构图；定点修只改指定的那一处。
storyboard-table: 分镜表：三层分镜，先空间合同再分镜，按九宫格多镜头直出语法组织，禁止首尾帧硬拼。
space-contract  : 空间合同：先定点位＝空间合同，主角恒左、反派恒右，锁死180°轴线。
```

其余 kind(`project`/`script`/`assets`/`shot-contract`/`action-contract`/`compliance`/`seam-check`/`audio-mix`/`export`)回落全局三铁律 `AGENT_METHODOLOGY_BRIEF`。

---

## Task 1: web 侧红线表 + 覆盖测试

**Files:**
- Modify: `web/src/lib/toonflow/schema.ts:20`(把 `const TOONFLOW_NODE_KINDS` 改为 `export const`)
- Modify: `web/src/lib/toonflow/prompts.ts`(顶部加 import;`AGENT_METHODOLOGY_BRIEF` 定义之后加红线表)
- Create/Test: `web/src/lib/toonflow/__tests__/stage-methodology-redlines.test.ts`

**Interfaces:**
- Produces:
  - `TOONFLOW_NODE_KINDS: readonly ToonflowNodeKind[]`(从 schema.ts 导出)
  - `STAGE_METHODOLOGY_REDLINES: Record<ToonflowNodeKind, string>`(从 prompts.ts 导出)
  - 复用已存在的 `export const AGENT_METHODOLOGY_BRIEF`(prompts.ts)

- [ ] **Step 1: 导出 TOONFLOW_NODE_KINDS**

`web/src/lib/toonflow/schema.ts` 第 20 行,把:

```ts
const TOONFLOW_NODE_KINDS = [
```

改为:

```ts
export const TOONFLOW_NODE_KINDS = [
```

(数组内容与 `as const satisfies readonly ToonflowNodeKind[]` 不变。)

- [ ] **Step 2: 在 prompts.ts 顶部补 import**

`web/src/lib/toonflow/prompts.ts` 第 9 行附近,现有:

```ts
import type { ActionContract, ShotContract, StoryboardRow } from "./schema";
```

改为(加一条类型 import + 一条值 import):

```ts
import { TOONFLOW_NODE_KINDS } from "./schema";
import type { ActionContract, ShotContract, StoryboardRow } from "./schema";
import type { ToonflowNodeKind } from "../../types/canvas";
```

- [ ] **Step 3: 写失败测试**

Create `web/src/lib/toonflow/__tests__/stage-methodology-redlines.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { TOONFLOW_NODE_KINDS } from "../schema";
import { AGENT_METHODOLOGY_BRIEF, STAGE_METHODOLOGY_REDLINES } from "../prompts";

describe("STAGE_METHODOLOGY_REDLINES", () => {
    it("覆盖全部 ToonflowNodeKind 且非空", () => {
        for (const kind of TOONFLOW_NODE_KINDS) {
            expect((STAGE_METHODOLOGY_REDLINES[kind]?.length ?? 0) > 0).toBe(true);
        }
    });

    it("video-workbench 红线含禁首尾帧", () => {
        expect(STAGE_METHODOLOGY_REDLINES["video-workbench"]).toContain("首尾帧");
    });

    it("无专属红线的环节回落全局三铁律", () => {
        expect(STAGE_METHODOLOGY_REDLINES["script"]).toBe(AGENT_METHODOLOGY_BRIEF);
    });
});
```

- [ ] **Step 4: 运行测试确认失败**

Run(在 `web/` 目录):`npx vitest run src/lib/toonflow/__tests__/stage-methodology-redlines.test.ts`
Expected: FAIL —— `STAGE_METHODOLOGY_REDLINES` 未导出(import 报错 / undefined)。

- [ ] **Step 5: 实现红线表**

`web/src/lib/toonflow/prompts.ts`,在 `export const AGENT_METHODOLOGY_BRIEF = "...";`(约第 306 行)**之后**追加:

```ts
// 按环节的压缩方法论红线,供 Agent 工具结果再入用(非长 prompt;长纪律仍在各 build*Prompt)。
// 单一事实源;canvas-agent/src/config.ts 逐字镜像,agent-brief-sync 测试锁一致。勿改写字符串。
const STAGE_REDLINE_OVERRIDES: Partial<Record<ToonflowNodeKind, string>> = {
    "video-workbench": "视频工作台：以九宫格故事板页为第一构图参考、每镜与格子逐一1:1，禁止首尾帧续接或硬拼，不合并镜头、不新增机位。",
    "storyboard-page": "故事板页：格子与镜头逐一1:1，把空间合同与180°轴线锁落到每一格构图。",
    keyframes: "首帧：线稿是构图锁，只上色不改构图；定点修只改指定的那一处。",
    "storyboard-table": "分镜表：三层分镜，先空间合同再分镜，按九宫格多镜头直出语法组织，禁止首尾帧硬拼。",
    "space-contract": "空间合同：先定点位＝空间合同，主角恒左、反派恒右，锁死180°轴线。",
};

export const STAGE_METHODOLOGY_REDLINES: Record<ToonflowNodeKind, string> = Object.fromEntries(
    TOONFLOW_NODE_KINDS.map((kind) => [kind, STAGE_REDLINE_OVERRIDES[kind] ?? AGENT_METHODOLOGY_BRIEF]),
) as Record<ToonflowNodeKind, string>;
```

- [ ] **Step 6: 运行测试确认通过 + tsc**

Run(在 `web/`):`npx vitest run src/lib/toonflow/__tests__/stage-methodology-redlines.test.ts`
Expected: PASS(3 绿)
Run:`npx tsc --noEmit`
Expected: 0 错误。

- [ ] **Step 7: 提交**

```bash
git add web/src/lib/toonflow/schema.ts web/src/lib/toonflow/prompts.ts web/src/lib/toonflow/__tests__/stage-methodology-redlines.test.ts
git commit -m "feat(toonflow): 按环节方法论红线表(单一事实源)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: canvas-agent 镜像红线表 + sync 锁

**Files:**
- Modify: `canvas-agent/src/config.ts`(导出现有 brief;加镜像红线表 + `redlineForKind`)
- Modify: `web/src/lib/toonflow/__tests__/agent-brief-sync.test.ts`(扩测试逐字锁红线)

**Interfaces:**
- Consumes: Task 1 的 `STAGE_METHODOLOGY_REDLINES`(web,供 sync 测试读取)
- Produces(canvas-agent config.ts 导出):
  - `TOONFLOW_METHODOLOGY_BRIEF: string`
  - `STAGE_METHODOLOGY_REDLINES: Record<string, string>`(仅 5 个专属 kind)
  - `redlineForKind(kind?: string): string`

- [ ] **Step 1: 导出 canvas-agent 的 brief 并加镜像表**

`canvas-agent/src/config.ts` 第 14 行,把:

```ts
const TOONFLOW_METHODOLOGY_BRIEF =
```

改为:

```ts
export const TOONFLOW_METHODOLOGY_BRIEF =
```

(brief 字符串内容不变——它由现有 agent-brief-sync 测试锁定,一个字都不能动。)

然后在同文件 `AGENT_PROMPT` 定义(第 17 行)**之后**追加:

```ts
// 按环节压缩红线,单一事实源 = web/src/lib/toonflow/prompts.ts 的 STAGE_METHODOLOGY_REDLINES;
// 逐字镜像,web 的 agent-brief-sync 测试逐条锁定,禁止在此改写。只列有专属红线的环节,其余回落 brief。
export const STAGE_METHODOLOGY_REDLINES: Record<string, string> = {
    "video-workbench": "视频工作台：以九宫格故事板页为第一构图参考、每镜与格子逐一1:1，禁止首尾帧续接或硬拼，不合并镜头、不新增机位。",
    "storyboard-page": "故事板页：格子与镜头逐一1:1，把空间合同与180°轴线锁落到每一格构图。",
    keyframes: "首帧：线稿是构图锁，只上色不改构图；定点修只改指定的那一处。",
    "storyboard-table": "分镜表：三层分镜，先空间合同再分镜，按九宫格多镜头直出语法组织，禁止首尾帧硬拼。",
    "space-contract": "空间合同：先定点位＝空间合同，主角恒左、反派恒右，锁死180°轴线。",
};

export function redlineForKind(kind?: string): string {
    return (kind && STAGE_METHODOLOGY_REDLINES[kind]) || TOONFLOW_METHODOLOGY_BRIEF;
}
```

- [ ] **Step 2: 扩 sync 测试(失败态)**

`web/src/lib/toonflow/__tests__/agent-brief-sync.test.ts`,第 7 行 import 改为:

```ts
import { AGENT_METHODOLOGY_BRIEF, STAGE_METHODOLOGY_REDLINES } from "../prompts";
```

在现有 `describe(...)` 块内、末尾 `});` 之前追加一个 it:

```ts
    it("canvas-agent 逐字内嵌每条环节红线(单源一致)", () => {
        const source = readFileSync(canvasAgentConfigPath, "utf8");
        const distinct = [...new Set(Object.values(STAGE_METHODOLOGY_REDLINES))];
        for (const redline of distinct) {
            expect(source).toContain(redline);
        }
    });
```

- [ ] **Step 3: 运行测试**

Run(在 `web/`):`npx vitest run src/lib/toonflow/__tests__/agent-brief-sync.test.ts`
Expected: PASS(2 绿——原 brief 锁 + 新红线锁)。

> 说明:回落 kind 的红线值 === `AGENT_METHODOLOGY_BRIEF`,其文本 === canvas-agent 的 `TOONFLOW_METHODOLOGY_BRIEF`(原测试已锁),故 `toContain` 命中;5 条专属红线由 Step 1 内嵌命中。

若 FAIL:核对报错的红线字符串在 config.ts 与 prompts.ts 两处是否逐字一致(全角标点 `：，；＝°`、数字 `1:1` 半角冒号)。

- [ ] **Step 4: canvas-agent 编译确认**

Run(在 `canvas-agent/`):`npx tsc -p tsconfig.json --noEmit`
Expected: 0 错误。

- [ ] **Step 5: 提交**

```bash
git add canvas-agent/src/config.ts web/src/lib/toonflow/__tests__/agent-brief-sync.test.ts
git commit -m "feat(canvas-agent): 镜像按环节方法论红线 + redlineForKind(sync 锁)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 注入 helper + 接入 callTool + canvas-agent vitest

**Files:**
- Create: `canvas-agent/vitest.config.ts`
- Modify: `canvas-agent/package.json`(加 devDep `vitest` + `test` 脚本)
- Create: `canvas-agent/src/methodology.ts`(纯 helper)
- Create: `canvas-agent/test/methodology.test.ts`
- Modify: `canvas-agent/src/canvas-session.ts`(接线三处 + 收敛 import)

**Interfaces:**
- Consumes: Task 2 的 `redlineForKind`、`TOONFLOW_METHODOLOGY_BRIEF`(config.ts);`compactCanvasState`、`compactNode`(tools.ts);`CanvasNode`、`CanvasSnapshot`(types.ts)
- Produces(methodology.ts 导出):
  - `toonflowKindOf(node: CanvasNode | undefined): string | undefined`
  - `annotateMethodology<T>(result: T, kinds: Array<string | undefined>): T`
  - `toonflowKindsForOps(ops: unknown, nodes: CanvasNode[]): Array<string | undefined>`
  - `buildSelectionResult(state: CanvasSnapshot | null): { nodes: unknown[] } & { _methodology?: string }`
  - `buildStateResult(state: CanvasSnapshot | null): Record<string, unknown> & { _methodology?: string }`

- [ ] **Step 1: 给 canvas-agent 装 vitest**

`canvas-agent/package.json` 的 `scripts` 加一行(`build` 之后):

```json
    "test": "vitest run",
```

`devDependencies` 加:

```json
    "vitest": "^2.1.9",
```

Run(在 `canvas-agent/`):`npm install --no-save vitest@^2.1.9 --legacy-peer-deps`(若已在 devDeps 则 `npm install --legacy-peer-deps`)
Expected: 安装成功。
> Windows 坑:若安装后运行 vitest 报缺 `@rollup/rollup-win32-x64-msvc` 之类原生模块,补跑 `npm install @rollup/rollup-win32-x64-msvc --no-save --legacy-peer-deps`(平台包在即有 fallback)。

Create `canvas-agent/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        include: ["test/**/*.test.ts"],
    },
});
```

- [ ] **Step 2: 写失败测试**

Create `canvas-agent/test/methodology.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { redlineForKind } from "../src/config.js";
import {
    annotateMethodology,
    buildSelectionResult,
    buildStateResult,
    toonflowKindOf,
    toonflowKindsForOps,
} from "../src/methodology.js";
import type { CanvasNode } from "../src/types.js";

function node(id: string, kind?: string): CanvasNode {
    return {
        id,
        type: "text",
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: kind ? { toonflow: { kind } } : {},
    };
}

describe("toonflowKindOf", () => {
    it("读 metadata.toonflow.kind", () => {
        expect(toonflowKindOf(node("a", "video-workbench"))).toBe("video-workbench");
    });
    it("非 toonflow 节点返回 undefined", () => {
        expect(toonflowKindOf(node("a"))).toBeUndefined();
    });
});

describe("redlineForKind", () => {
    it("video-workbench 含禁首尾帧", () => {
        expect(redlineForKind("video-workbench")).toContain("首尾帧");
    });
    it("未知 kind 回落全局三铁律", () => {
        expect(redlineForKind("project")).toContain("三铁律");
    });
});

describe("annotateMethodology", () => {
    it("含 toonflow kind 时追加 _methodology", () => {
        const r = annotateMethodology({ ok: true }, ["keyframes"]) as Record<string, unknown>;
        expect(String(r._methodology)).toContain("只上色不改构图");
    });
    it("无 kind 时零追加", () => {
        const r = annotateMethodology({ ok: true }, [undefined, undefined]) as Record<string, unknown>;
        expect(r._methodology).toBeUndefined();
    });
    it("多环节去重(同 kind 只出现一次)", () => {
        const r = annotateMethodology({}, ["keyframes", "keyframes", "video-workbench"]) as Record<string, unknown>;
        expect(String(r._methodology).match(/首帧：/g)?.length).toBe(1);
    });
});

describe("toonflowKindsForOps", () => {
    it("从 ops 的 id/nodeId/ids 解析 kind", () => {
        const nodes = [node("n1", "keyframes"), node("n2", "video-workbench")];
        const ops = [
            { type: "update_node", id: "n1" },
            { type: "run_generation", nodeId: "n2" },
            { type: "delete_node", ids: ["n1"] },
        ];
        expect(toonflowKindsForOps(ops, nodes).filter(Boolean).sort()).toEqual([
            "keyframes",
            "keyframes",
            "video-workbench",
        ]);
    });
    it("非数组返回空", () => {
        expect(toonflowKindsForOps(undefined, [])).toEqual([]);
    });
});

describe("buildSelectionResult", () => {
    it("选中视频环节 → 结果含红线", () => {
        const state = { nodes: [node("n1", "video-workbench")], selectedNodeIds: ["n1"] };
        const r = buildSelectionResult(state) as Record<string, unknown>;
        expect((r.nodes as unknown[]).length).toBe(1);
        expect(String(r._methodology)).toContain("首尾帧");
    });
    it("选中普通节点 → 零追加", () => {
        const state = { nodes: [node("n1")], selectedNodeIds: ["n1"] };
        expect((buildSelectionResult(state) as Record<string, unknown>)._methodology).toBeUndefined();
    });
});

describe("buildStateResult", () => {
    it("含环节 → 挂全局三铁律+指引,不倒逐环节红线", () => {
        const state = { nodes: [node("n1", "video-workbench"), node("n2", "keyframes")] };
        const r = buildStateResult(state) as Record<string, unknown>;
        expect(String(r._methodology)).toContain("三铁律");
        expect(String(r._methodology)).toContain("canvas_get_selection");
        expect(String(r._methodology)).not.toContain("只上色不改构图");
    });
    it("普通画布 → 零追加", () => {
        const state = { nodes: [node("n1")] };
        expect((buildStateResult(state) as Record<string, unknown>)._methodology).toBeUndefined();
    });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run(在 `canvas-agent/`):`npx vitest run`
Expected: FAIL —— `../src/methodology.js` 不存在(模块解析失败)。

- [ ] **Step 4: 实现 methodology.ts**

Create `canvas-agent/src/methodology.ts`:

```ts
import { redlineForKind, TOONFLOW_METHODOLOGY_BRIEF } from "./config.js";
import { compactCanvasState, compactNode } from "./tools.js";
import type { CanvasNode, CanvasSnapshot } from "./types.js";

export function toonflowKindOf(node: CanvasNode | undefined): string | undefined {
    const tf = node?.metadata?.toonflow as { kind?: unknown } | undefined;
    return tf && typeof tf.kind === "string" ? tf.kind : undefined;
}

function attach<T>(result: T, methodology: string): T {
    if (result === null || typeof result !== "object") return result;
    return { ...(result as object), _methodology: methodology } as T;
}

export function annotateMethodology<T>(result: T, kinds: Array<string | undefined>): T {
    const distinct = [...new Set(kinds.filter((kind): kind is string => Boolean(kind)))];
    if (!distinct.length) return result;
    const body = distinct.map((kind) => redlineForKind(kind)).join("\n");
    return attach(result, `⚠ 你正在操作 Toonflow 环节，必须守方法论：\n${body}`);
}

export function toonflowKindsForOps(ops: unknown, nodes: CanvasNode[]): Array<string | undefined> {
    if (!Array.isArray(ops)) return [];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const ids: string[] = [];
    for (const op of ops) {
        if (!op || typeof op !== "object") continue;
        const record = op as Record<string, unknown>;
        if (typeof record.id === "string") ids.push(record.id);
        if (typeof record.nodeId === "string") ids.push(record.nodeId);
        if (Array.isArray(record.ids)) for (const id of record.ids) if (typeof id === "string") ids.push(id);
    }
    return ids.map((id) => toonflowKindOf(byId.get(id)));
}

export function buildSelectionResult(state: CanvasSnapshot | null) {
    const ids = new Set(state?.selectedNodeIds || []);
    const selected = (state?.nodes || []).filter((node) => ids.has(node.id));
    return annotateMethodology({ nodes: selected.map(compactNode) }, selected.map(toonflowKindOf));
}

export function buildStateResult(state: CanvasSnapshot | null) {
    const result = compactCanvasState(state);
    const count = (state?.nodes || []).filter((node) => toonflowKindOf(node)).length;
    if (!count) return result;
    return attach(
        result,
        `画布含 ${count} 个 Toonflow 环节。${TOONFLOW_METHODOLOGY_BRIEF} 改某环节前用 canvas_get_selection 取该环节红线。`,
    );
}
```

- [ ] **Step 5: 运行测试确认通过**

Run(在 `canvas-agent/`):`npx vitest run`
Expected: PASS(methodology.test.ts 全绿)。

- [ ] **Step 6: 接线进 callTool**

`canvas-agent/src/canvas-session.ts` 改三处 + import。

(a) 顶部 import(第 5 行)现为:

```ts
import { compactCanvasState, compactNode, isToolName, nextCanvasX, parseToolInput } from "./tools.js";
```

改为(移出将不再直接使用的 compactCanvasState/compactNode,加 methodology import):

```ts
import { isToolName, nextCanvasX, parseToolInput } from "./tools.js";
import { annotateMethodology, buildSelectionResult, buildStateResult, toonflowKindsForOps } from "./methodology.js";
```

(b) get_state / export_snapshot 分支(第 70 行)现为:

```ts
        if (tool === "canvas_get_state" || tool === "canvas_export_snapshot") return compactCanvasState(this.canvasState);
```

改为:

```ts
        if (tool === "canvas_get_state" || tool === "canvas_export_snapshot") return buildStateResult(this.canvasState);
```

(c) get_selection 分支(第 71-74 行)现为:

```ts
        if (tool === "canvas_get_selection") {
            const ids = new Set(this.canvasState?.selectedNodeIds || []);
            return { nodes: (this.canvasState?.nodes || []).filter((node) => ids.has(node.id)).map(compactNode) };
        }
```

改为:

```ts
        if (tool === "canvas_get_selection") return buildSelectionResult(this.canvasState);
```

(d) 末尾改动路径(第 165-166 行)现为:

```ts
        if (!this.clients.size) throw new Error("当前没有已连接画布");
        return await this.requestCanvasTool(tool, input);
```

改为:

```ts
        if (!this.clients.size) throw new Error("当前没有已连接画布");
        const result = await this.requestCanvasTool(tool, input);
        return annotateMethodology(result, toonflowKindsForOps(input.ops, this.canvasState?.nodes || []));
```

- [ ] **Step 7: 编译 + 全测试**

Run(在 `canvas-agent/`):`npx tsc -p tsconfig.json --noEmit`
Expected: 0 错误(若报 compactCanvasState/compactNode 未使用——本仓 tsconfig 未开 noUnusedLocals,不会报;若报则确认已从 import 移除)。
Run:`npx vitest run`
Expected: PASS。
Run(回 `web/` 目录)全量:`npx vitest run` + `npx tsc --noEmit`
Expected: web 全绿(含 Task 1/2 新测)+ 0 类型错误。

- [ ] **Step 8: 提交**

```bash
git add canvas-agent/package.json canvas-agent/package-lock.json canvas-agent/vitest.config.ts canvas-agent/src/methodology.ts canvas-agent/test/methodology.test.ts canvas-agent/src/canvas-session.ts
git commit -m "feat(canvas-agent): 工具结果按环节再入方法论红线 + vitest

Agent 读选中/改动命中环节时结果尾追加该环节红线,读全画布只挂全局三铁律+指引。
只动 Agent 路径,确定性按钮路径不碰。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review(计划作者已跑)

**1. Spec coverage:**
- 部件 1(红线表单源)→ Task 1 ✓
- 部件 2(canvas-agent 镜像 + sync 锁)→ Task 2 ✓
- 部件 3(callTool 注入:get_selection / 改动命中 / get_state 只全局)→ Task 3 Step 6 (b)(c)(d) ✓,对应单测 buildSelectionResult / toonflowKindsForOps+annotateMethodology / buildStateResult ✓
- 部件 4(产出自查)→ spec 明列二期,本计划不含 ✓(非遗漏)
- 错误处理(认不出 kind 零追加 / get_state 防刷屏 / token 成本 / sync 漂移)→ methodology.ts 守卫 + buildStateResult 分支 + sync 测试 ✓
- 测试计划(sync 锁 / 覆盖测试 / helper 四类断言)→ Task 1/2/3 测试 ✓

**2. Placeholder scan:** 无 TBD/TODO(除 spec 明列的二期 C,不在本计划范围);每个 code step 均给完整代码。

**3. Type consistency:** `toonflowKindOf`/`annotateMethodology`/`toonflowKindsForOps`/`buildSelectionResult`/`buildStateResult`/`redlineForKind` 命名在 Interfaces、实现、测试、接线四处一致;`STAGE_METHODOLOGY_REDLINES` web 侧 `Record<ToonflowNodeKind,string>`(全覆盖)、canvas-agent 侧 `Record<string,string>`(仅 5 专属)——差异是有意的(canvas-agent 靠 `redlineForKind` 回落),sync 测试只锁 distinct 值,一致。

**4. 现场验证限制:** 活体 Agent 端到端受 CDP 限制(记忆有载),读路径逻辑已抽纯函数直接单测覆盖;改动路径 wiring 由 `toonflowKindsForOps`+`annotateMethodology` 单测覆盖,`requestCanvasTool` 需真实连接的部分靠 tsc + 人工抽验兜底。

## 发布提醒(非本计划任务)

canvas-agent 改动落地后,生效需用户 `npm publish`(独立包,沿用既有发布流程)。本计划只到代码 + 测试 + 提交,不含发布。
