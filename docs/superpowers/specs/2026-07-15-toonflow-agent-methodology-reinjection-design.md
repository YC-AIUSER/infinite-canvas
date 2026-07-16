# Toonflow Agent 方法论工具结果再入 —— 设计文档

- 日期:2026-07-15
- 分支:`feat/toonflow-agent-methodology-reinjection`
- 状态:APPROVED(brainstorming 阶段用户拍板)
- 相关记忆:`toonflow-generation-next`、`toonflow-stage-as-group`、`cano-video-adapter`

## 1. 问题

Toonflow 短剧生成方法论(源:`ai-short-drama` skill,核心红线=九宫格原生多镜头直出、**禁首尾帧续接/硬拼**、先空间合同再分镜、逐格 1:1)在两条路径落地情况不同:

- **确定性按钮路径(健康)**:每个环节的 `build*Prompt`(`buildStoryboardPagePrompt` / `buildKeyframesPrompt` / `buildVideoWorkbenchPrompt` 等)把纪律内嵌在函数里,每次该环节生成/定点修都重新拼一遍,**不会失忆**。
- **Agent 对话式驱动路径(有缺陷)**:方法论只在开场 `AGENT_PROMPT`(`canvas-agent/src/config.ts:17`,末尾追加 `TOONFLOW_METHODOLOGY_BRIEF` 三铁律)挂**一次**,之后靠模型自己记。

用户实测确认:**当 Claude/Codex 这类模型多轮盯着一个环节改细节时,开场那一发 brief 被上下文压缩/焦点收窄冲淡**,Agent 退回默认人格——重新建议首尾帧工作流、乱加机位、不守九宫格逐格 1:1。这不是数据落盘问题(产物本就在画布上),而是**"怎么做才对"的方法论蒸发**。

根因:方法论是"开场注入一次的指令",不是"每次触碰某环节就重新加载的再入式约束"。越是做单环节精修,离开场那次注入越远,方法论越薄。

## 2. 目标 / 非目标

**目标**:让 Agent 路径的方法论从"开场挂一次"变为**"每次碰到某环节,该环节的红线搭在工具返回结果里回来"**——骑在 Agent 本来就要读的数据上,在编辑发生那一刻按环节精准重灌。

**非目标(本期)**:
- 不动确定性按钮路径(`build*Prompt` 一行不碰,它本就每次重灌)。
- 不改画布数据模型 / 不动持久化 / 不动级联版本机器。
- 不实现产出自查(方案 C),仅列 TODO 二期。
- 不改普通(非 Toonflow)画布的 Agent 行为——非 Toonflow 节点零追加。

## 3. 架构:方案 A —— 工具结果再入(per-stage)

只改 **canvas-agent 包**(Agent 路径)。四个部件。

### 部件 1:单一事实源 —— 按环节短红线表(web 侧)

在 `web/src/lib/toonflow/prompts.ts` 新增导出:

```ts
export const STAGE_METHODOLOGY_REDLINES: Record<ToonflowNodeKind, string>
```

每个环节 kind 一句**压缩红线**(提醒版,非长 prompt)。示意:

| 环节 kind | 红线 |
|---|---|
| `video-workbench` | 九宫格页第一参考、逐格 1:1、**禁首尾帧续接/硬拼**、不合并不加机位 |
| `storyboard-page` | 格子与镜头 1:1、空间合同与 180° 轴线落到每格 |
| `keyframes` | 线稿是构图锁、只上色不改构图、定点修只改一处 |
| `storyboard-table` | 三层分镜、先空间合同再分镜、九宫格多镜头语法 |
| `space-contract` | 先定点位=空间合同、主角恒左、反派恒右 |
| `script` / `assets` / `shot-contract` / `action-contract` / `compliance` / `seam-check` / `audio-mix` / `export` / `project` | 回落全局三铁律(见 `AGENT_METHODOLOGY_BRIEF`) |

约束:
- 表**必须覆盖全部 `ToonflowNodeKind`**(单测锁),无专属红线的 kind 显式回落到全局三铁律常量。
- 长纪律仍留在 `build*Prompt`,本表只是 Agent 再入用的压缩版,**不重复长文**。
- 现有全局 `AGENT_METHODOLOGY_BRIEF`(三铁律)保留:开场仍挂 + 作为回落。

### 部件 2:镜像 + sync 锁进 canvas-agent(沿用决议 8B 成法)

- canvas-agent 是独立发布包,`import` 不到 `web/src`。将 `STAGE_METHODOLOGY_REDLINES` **逐字复制**进 `canvas-agent/src/config.ts`(与现有 `TOONFLOW_METHODOLOGY_BRIEF` 同处)。
- 扩 web 侧 `agent-brief-sync` 测试:把这张表也**逐字锁定一致**,任一处漂移即测试红(与三铁律现有锁同机制)。

### 部件 3:注入点 —— canvas-agent `callTool` 返回结果边界

在 `canvas-agent/src/canvas-session.ts` 的 `callTool`(所有 Agent 工具调用总闸门)返回前,经新增 helper 追加方法论提醒:

```ts
function annotateToonflowMethodology(result, kinds: ToonflowNodeKind[]): result
```

当本次操作**碰到 Toonflow 环节**(节点带 `metadata.toonflow.kind`)时,在结果尾部追加对应红线块。三条触发路径,**按环节精准、防淹没**:

1. **`canvas_get_selection`**(选中某环节 = "我正要动它")→ 追加**选中环节 distinct kind** 的红线。**主再入点**。
2. **改动类 op 命中 toonflow 节点**(`canvas_run_generation` / `canvas_update_node` / `canvas_apply_ops` 打到带 `metadata.toonflow` 的目标节点)→ 结果里 echo 该环节红线(从当前 `canvasState` 解析目标节点 kind)。
3. **`canvas_get_state`**(读全画布)→ **只挂全局三铁律 + 一句指引**("画布含 N 个 Toonflow 环节,改前用 canvas_get_selection 取该环节红线"),**不倒出全部 14 条红线**,避免刷屏。

关键:红线骑在 Agent 那一轮本来就要读的工具结果里 → 新鲜、未压缩、随编辑动作精准重灌。

### 部件 4(二期可选,方案 C):产出自查

改完 `video-workbench` / `storyboard-page` 后跑确定性检查(如产出文本出现"首尾帧 / 首帧尾帧 / last frame"当工作流建议、镜头数与格子数对不上),命中就在结果里挂 ⚠ 让 Agent 重做。**本期不做,列 TODO 二期**(理由:部分违规是语义判断、事后拦对话式 Agent 的 UX 别扭、工程量最大;A 已是预防性主干)。

## 4. 数据流

```
Agent 对话轮
  → callTool(canvas_get_selection)
      → 解析选中节点 metadata.toonflow.kind = "video-workbench"
      → annotateToonflowMethodology(result, ["video-workbench"])
      → 结果尾部追加:"⚠ 你正操作环节[视频工作台]。铁律:九宫格页第一参考、逐格1:1、禁首尾帧续接/硬拼…"
  → 模型这一轮读到红线(新鲜,未压缩)
  → callTool(canvas_run_generation / canvas_update_node 命中该节点)
      → 再 echo 一次该环节红线
  → 模型守纪律产出
```

非 Toonflow 节点:`kinds` 为空 → helper 直接返回原结果,零追加。

## 5. 错误处理与边界

- **认不出 kind**:节点无 `metadata.toonflow` 或 kind 不在枚举 → 视为非 Toonflow,零追加(不报错)。
- **表缺 kind**:类型上 `Record<ToonflowNodeKind, string>` 强制全覆盖 + 单测锁;运行时缺失回落全局三铁律。
- **get_state 刷屏**:全画布读取绝不逐环节追加,只挂全局 + 指引。
- **token 成本**:仅在碰 Toonflow 环节时追加一句;普通画布/普通节点无额外开销。
- **sync 漂移**:web/canvas-agent 两处表由 agent-brief-sync 测试逐字锁,漂移即 CI 红。

## 6. 测试计划

**web 侧**
- 扩 `agent-brief-sync` 测试:逐字锁定 `STAGE_METHODOLOGY_REDLINES`(web ↔ canvas-agent 一致)。
- 新单测:表覆盖全部 `ToonflowNodeKind`(无遗漏 key)。

**canvas-agent 侧**
- `annotateToonflowMethodology` 单测:
  - 选中 `video-workbench` 节点 → 结果含"禁首尾帧"红线。
  - 改动 op 命中 `keyframes` 节点 → 结果含"只上色不改构图"。
  - `get_state` 含多个环节 → 只含全局三铁律 + 指引,不含逐环节红线。
  - 无 Toonflow 节点(普通画布)→ 结果与原 result 完全一致(零追加)。

**现场**
- 活体 Agent 端到端受 CDP 限制(记忆有载:CDP 驱动不了此 app 的 React 交互),靠单测 + 亲验工具结果形状兜底;可选人工在真实 Agent 会话里抽验一次红线是否回显。

## 7. 影响面 / 可回退性

- 改动集中在:`web/src/lib/toonflow/prompts.ts`(加导出)、web `agent-brief-sync` 测试、`canvas-agent/src/config.ts`(镜像表)、`canvas-agent/src/canvas-session.ts`(注入 helper + 三处接线)。
- 无破坏性:确定性路径、数据模型、持久化、级联全不动;普通画布 Agent 行为不变。
- 回退:删 helper 调用即回到现状,无数据迁移。
- 发布:canvas-agent 是独立 npm 包,改后需用户 `npm publish`(沿用既有发布流程)。

## 8. TODO(二期)

- 方案 C 产出自查(硬红线违规检测 + ⚠ 回退提示)。
- 若日后有更多环节获得专属长纪律,评估是否把长版也纳入再入(当前只压缩版)。
