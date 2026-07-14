# 画布自动摆位 · 设计文档

- 日期:2026-07-14
- 状态:已通过 brainstorming,待出实现计划
- 涉及:`web/src` 画布(Toonflow 生成流)

## 背景与目标

Toonflow 画布是一条逐级扇出的生产流:剧本 → 分镜 → 段实例 → 图像 → 视频。
当前每条生成路径都有各自的相对摆位规则(段实例排在根节点下方两列网格、批量变体从根节点级联堆、agent 建流往最右接),
但存在两个缺口,本设计补齐它们:

1. **生成时不做防重叠**:摆位只认相对根节点的固定坐标,不检测那块地方是否已被占,画布挤时新节点会盖到已有节点上。
2. **没有一键重排**:画布拖乱或积累多了,没有把全部节点重新排整齐的能力。

目标:
- 功能 1 —— 生成新节点时自动避开已有节点(轻量避让,不扰动现有布局)。
- 功能 2 —— 一键把整个画布按生产流重排整齐,且能整体撤销。

非目标(本期不做):
- 可见的组容器框(Figma frame 式)。
- 只整理选中子集(本期固定整个画布)。
- 引入第三方布局库。

## 关键决策(brainstorming 结论)

| 决策点 | 选定 | 理由 |
|---|---|---|
| 整理的排法 | 顺连接流向分层(left→right) | 最贴 Toonflow 生产流,一眼看清谁生成谁 |
| 防重叠力度 | 只避碰撞(撞上才轻推) | 改动最小,不扰乱手摆布局 |
| 整理范围 | 总是整个画布 | 简单直接,无需选区交互 |
| 组内变多怎么摆 | 紧凑方阵(接近正方形) | 组再大也是平衡方块,不抽成长竹竿 |
| 组是否画可见框 | 不画,靠间距分组 | 保持画布简洁、实现轻、避免容器渲染+联动的大工程 |
| 撤销 | 复用现有历史,一次 commit | Ctrl+Z 整体退回,无需额外确认弹窗 |
| 布局实现 | 手写分层+打包(不引库) | 节点自带 batchRootId/segmentId 分组语义,手写能精确保持;避开 Windows 原生模块/依赖坑,bun 项目更干净 |

方向 left→right 为默认;top→bottom 仅为一个参数切换,本期实现 left→right。

## 现状事实(代码锚点)

- 节点数据:`position {x,y}`、`width`、`height`、`type`、`metadata`(含 `batchRootId`、`batchChildIds`、`segmentId`、`segmentIndex`、`toonflow`)。
- 连接(边):`CanvasConnection { fromNodeId, toNodeId }`(`web/src/types/canvas.ts:123`)——定义有向图。
- 现有摆位:段实例两列网格 `web/src/lib/toonflow/instances.ts:127-129`;批量子卡级联堆 `web/src/pages/canvas/project.tsx:758-762`;agent 建流往最右接 `canvas-agent/src/tools.ts:23`;手动/技能流落画布中心 `web/src/pages/canvas/project.tsx:866,882`。
- 撤销系统:`historyRef { past, future }`(`web/src/pages/canvas/project.tsx:276`),工具栏已有 Undo/Redo。
- 工具栏:`CanvasToolbar`(`web/src/components/canvas/canvas-toolbar.tsx`)、缩放控件 `CanvasZoomControls`——整理按钮的落点。

## 功能 1 · 生成时防碰撞

### 接口
```
resolveFreePosition(
  desired: { x: number; y: number },
  size: { width: number; height: number },
  existing: Array<{ position; width; height }>,
  opts?: { padding?: number; step?: number; maxScan?: number }
): { x: number; y: number }
```
纯函数,无副作用,独立文件(建议 `web/src/lib/canvas/free-position.ts`),便于单测。

### 逻辑
1. 先按**现有规则**算出 `desired`(本函数不改现有摆位规则,只做后处理)。
2. 用 `desired + size` 构成矩形,与每个 `existing` 节点矩形做 AABB 相交判断(带 `padding`,默认如 16px)。
3. 不相交 → 原样返回 `desired`。
4. 相交 → 从 `desired.y` 起以 `step`(如节点高度的一部分或固定 24px)**向下**逐步平移,每步重新检测,取第一个与所有节点都不相交的位置返回。
5. 扫描上限 `maxScan`(如 200 步)兜底,超限则返回最后位置(退化为原行为,不卡死)。

向下优先:符合 Toonflow 纵向展开习惯,避免横向乱窜。

### 接入点
在这些创建路径落点前包一层 `resolveFreePosition`:
- 段实例:`instances.ts:127` 的 position 计算之后。
- 批量变体:`project.tsx:758` 级联堆坐标之后。
- 通用新建:`project.tsx` `createCanvasNode` / agent ops 应用处(视 ops 结构择点)。

### 边界
- `existing` 应排除"正在创建的这批节点自身"(同批多节点要相互避让,用逐个落点、把已落下的加入 existing 累积集)。
- 不重排已有节点,只决定新节点落点。

## 功能 2 · 一键整理(顺流向、成组打包)

### 入口
`CanvasToolbar` / 缩放控件区加一个"整理"按钮(魔法棒或网格图标),点击即整理整个画布。

### 布局算法(纯函数)
建议 `web/src/lib/canvas/auto-layout.ts`,输入 `nodes + connections`,输出 `Map<nodeId, {x,y}>`(只算坐标,不碰其他字段)。

1. **建图**:由 `connections` 建邻接表(父→子)与入度表。
2. **分组(块)**:识别"父节点 + 其直接下游子节点"为一个块;`batchRootId`/`segmentId` 相同的节点归入同一父块。块是布局的基本单位。
3. **分层**:从入度为 0 的根(剧本类)开始,按到根的深度(最长路径分层,避免回退)给每个块分配"列号 col"。剧本 col0,分镜 col1,段实例 col2,图/视频依次递增。
4. **组内紧凑方阵**:一个块内的子节点数 n,取 `cols = ceil(sqrt(n))`、`rows = ceil(n / cols)`,在块内排成接近正方形的网格;块的宽高由方阵尺寸 + 节点间距决定。
5. **同层纵向排开**:同一 col 的块从上到下按块高 + 组间距(较大,用于替代可见框做视觉分组)依次堆叠;col 的水平位置 = 前一 col 右缘 + 列间距。
6. **父节点垂直居中**:父节点对齐到它那一整块方阵的垂直中心,不吊在顶部。
7. **游离节点**:入度=0 且出度=0(没连任何线)的节点,统一收到画布下方一条"未连接"横带里等距排开。
8. 输出所有节点新坐标。

### 应用与安全
- 点击 → 计算新坐标 → **一次性**将"整批位置变更"作为单个历史条目写入 `historyRef`(与现有 move 提交路径一致)。
- Ctrl+Z 整体退回,Ctrl+Shift+Z/Redo 再来一次。
- 位置变更走现有节点 transition,呈现平滑移动动画(参考 `batchMotionById` 的过渡基础)。
- 整理后可选自动 fitView / 居中到内容(复用现有 `getCanvasCenter` / 视口能力),让用户立即看到整理结果。

### 实现说明
- 手写,不引 dagre/elkjs:节点自带分组语义,手写能精确保持 Toonflow 成组;避开原生模块/依赖坑;算法约百来行,可控可测。
- 若未来布局需求变复杂,可换纯 JS 的 dagre(不涉原生模块),届时另议。

## 单元拆分与职责

| 单元 | 文件 | 职责 | 依赖 |
|---|---|---|---|
| 防碰撞 | `web/src/lib/canvas/free-position.ts` | 给定理想位+尺寸+已有节点,返回不重叠的落点(纯函数) | 无 |
| 自动布局 | `web/src/lib/canvas/auto-layout.ts` | 给定节点+连接,返回每个节点新坐标(纯函数) | 无 |
| 接线(生成) | `instances.ts` / `project.tsx` 生成路径 | 落点前调用 free-position | free-position |
| 接线(整理) | `project.tsx` + `CanvasToolbar` | 整理按钮 → 调 auto-layout → 提交历史 → 动画 | auto-layout, historyRef |

两个纯函数与画布状态解耦,可独立理解与测试;接线层只负责把它们插进现有生成/工具栏流程。

## 测试

- `free-position`:不重叠原样返回;重叠向下找到最近空位;同批多节点相互避让;扫描超限兜底。
- `auto-layout`:分层正确(剧本 col0…视频末列);组内方阵尺寸(9→3×3);父节点垂直居中于子块;游离节点入下方带;空画布/单节点/无连接等退化情形。
- 接线:生成路径调用 free-position 后无重叠;整理后可 Ctrl+Z 整体还原(历史条目为单条)。

## 风险与取舍

- **分层遇到环/交叉连接**:用最长路径分层 + visited 守卫,避免死循环;非纯树的交叉边容许子节点被就近归到某一父块(不追求完美)。
- **组间距替代可见框**:靠留白分组,极度密集时分组感可能减弱——本期接受,后续若需要再评估可见容器框(已列为非目标)。
- **动画性能**:大量节点同时过渡在低配机可能掉帧——复用现有 transition 机制;必要时对超大画布关闭动画直接落位。
