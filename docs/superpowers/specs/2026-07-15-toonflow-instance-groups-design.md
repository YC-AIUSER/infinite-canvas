# Toonflow 段实例环节组化(全量·表现层替换) · 设计文档

- 日期:2026-07-15
- 状态:已通过 brainstorming(用户拍板),待出实现计划
- 涉及:`web/src` 画布 Toonflow 多段环节
- 前置:资产库切片已完成验收(commit f94b5c0)。本文是"全量"的第二块:多段环节。

## 背景与目标

资产库切片验证了"集合→组+子节点"(镜子路线)。全量分析发现:真正"闷在节点+弹窗"的集合只有资产库(已做)。故事板页/首帧/视频工作台的"集合"是**段实例**,`instances.ts` 现用 **batch 机制**(`isBatchRoot`/`batchChildIds`/`imageBatchExpanded`)把段实例铺在画布上(root→实例连线、展开/收起)。

用户要把"每个环节是一个组"贯彻到底:把这三个多段环节的段实例,从 batch 分组换成**无限画布原生 Group 容器**。

### 与资产库切片的本质区别

- 资产库子节点是 **payload 投影**(无 toonflow、零污染级联)。
- 段实例是 **权威节点**(带 toonflow、在级联/导出里)。本设计**不改段实例的权威性**,只把它们的"分组呈现"从 batch 换成 Group。Group 容器本身无 toonflow。

### 目标
- 三个多段环节(storyboard-page / keyframes / video-workbench)各自成为一个真 Group 容器,root 作组内头部,段实例作组内成员。
- 段同步内核(建/归档/重排/连线/stale)**一行不改**。
- 图片批量的 batch 机制**完全不动**(batch 是共享的:图片批量 + 段实例;本设计只解耦段实例)。

### 非目标
- 不改 `instances.ts` 的核心同步算法(danger zone)。
- 不动图片批量 batch。
- 不做段内子项拆分(段内是九宫格单张合成,无子项)。
- 不改段实例的级联/版本/导出语义。

## 关键决策(brainstorming 结论)

### 决策 1:表现层替换(用户拍板)
- `instances.ts` 只删一处:`applyInstanceSync` 里给段实例 root 打 batch 标记的那段(现 line 222-239)。**其余同步逻辑一行不改。**
- 新增投影 `reconcileInstanceGroups(nodes)`(仿 `reconcileAssetsProjection`),在段同步落地后 + 画布加载时运行,给每个段环节维护一个 Group。
- 段实例保留 toonflow(权威、在级联里)。Group 容器无 toonflow。

### 决策 2:root 当组内头部(用户拍板)
- Group 成员 = root 节点 + 该环节的**活跃(未归档)段实例**。
- root 与段实例都设 `groupId = 环节组 id`。

### 决策 3:包围盒生成,不重摆权威节点(低风险)
- Group 的 position/尺寸 = 其成员(root + 活跃实例)**当前位置的包围盒 + padding**。
- **不重新摆放 root 与段实例**(它们由模板/createInstance/用户拖动决定位置,保位)。Group 只是"套在它们外面的容器 + groupId 归属"。
- 新段实例由 `createInstance` 摆在 root 下方(现状不变),下次 reconcile 时 Group 包围盒自动扩含它。

## 数据模型

### 不变(权威)
段实例节点结构、`instances.ts` 的 create/archive/reindex/连线/stale 全不变。段实例仍带 toonflow、segmentId、batchRootId(batchRootId 保留供 `deleteArchivedInstance` 等按现状工作;仅移除 root 侧的 isBatchRoot/batchChildIds/imageBatchExpanded 呈现标记)。

### 新增(投影)
每个段环节 root 派生一个 Group:
```
{
  id: `instance-group-<rootNodeId>`,
  type: Group,
  metadata: { status:"idle", projectionOf: { stageNodeId:<rootId>, kind:<环节kind> } },
}
```
成员(root + 活跃实例)追加 `metadata.groupId = 该组 id`(其余 metadata 不动,segmentIds/toonflow 全保留)。

> 复用资产库已加的 `projectionOf` 字段;无需新增类型。

## 同步行为

`reconcileInstanceGroups(nodes)`(纯同步函数):
1. 找出所有段环节 root(toonflow.kind ∈ {storyboard-page, keyframes, video-workbench} 且无 segmentId)。
2. 每个 root:成员 = root + 同 kind 的活跃(未归档、有 segmentId)实例。
   - 无活跃实例时:不建组(只有 root 时不套组,避免"单节点套组"无意义);若已有组则移除,并清成员 groupId。
   - 有活跃实例:计算成员当前位置包围盒 → Group position/宽高(含 padding);对成员设 groupId=组 id(幂等,已是则不动)。
3. 清理:root 已不存在的残留 instance-group、及指向已不存在组的 groupId。
4. 幂等:重跑结构一致;不改成员 position。

调用点:
- `applyStoryboardInstancePlan`(project.tsx:2882,段同步落地后)→ 段同步结果再过 `reconcileInstanceGroups`。
- 加载路径(现有 `applyAssetsProjection` 收口处)→ 同时过 `reconcileInstanceGroups`。
- `deleteArchivedInstance` 后 → 过一遍(归档实例移出组、组包围盒收缩)。

冲突原则:成员集合以"活跃段实例(由 toonflow 决定)"为真相;Group 是派生,可整体重算。

## 零污染 / 安全不变量(必须测试守卫)

1. **Group 容器无 toonflow** → `instances.ts` 的 `findRoot`/`activeInstances`/`segmentInstances`、`node-runtime` 的 `graphNodes`/`collectExportSegments` 都只认 toonflow 节点,**看不见 Group**。加 groupId 到 root/实例**不影响**这些函数(它们不读 groupId)。→ 守卫测试:reconcile 前后,`planInstanceSync` / `collectExportSegments` / `buildTextCascadeGraph` 结果不变。
2. **图片批量不受影响** → reconcileInstanceGroups 只碰段环节 root/实例(INSTANCE_KINDS + segmentId 语义),不碰 `isBatchRoot` 的图片批量节点。→ 守卫测试:含图片批量节点时,batch 字段不被 reconcile 改动。
3. **段同步内核不变** → 移除 root 的 batch 呈现标记后,`applyInstanceSync` 的 create/archive/reindex/连线/stale 输出(除去 batch 三字段)与改前一致。→ 测试:对同一输入,新旧 applyInstanceSync 除 batch 字段外等价。

## 涉及文件

- `web/src/lib/toonflow/instances.ts`:移除 `applyInstanceSync` 末尾给 root 打 batch 标记的映射(现 line 222-239),其余不动。
- `web/src/lib/canvas/toonflow-instance-groups.ts`(新建):`reconcileInstanceGroups` 纯函数 + id 助手。
- `web/src/pages/canvas/project.tsx`:段同步落地(2882)、加载收口、`deleteArchivedInstance` 后接 reconcile。
- 测试:`toonflow-instance-groups.test.ts`(建组/包围盒/幂等/无实例不建组/归档移出)+ `toonflow-instance-groups-isolation.test.ts`(零污染三守卫)。

## 成功标准(验收看证据)

1. 段同步(分镜表通过→建段实例)后,画布上每个多段环节出现一个真 Group,root 在组内当头部,各段实例是组内成员,整组可拖动。
2. 图片批量生成的展开/收起、拖动、删除**完全不受影响**(回归)。
3. 段同步的建/归档/重排/连线/stale 行为不变(下游生成、导出、接缝检查照常)。
4. 刷新页面后段环节组正确恢复(从活跃实例重建,不产生脏组/孤儿)。
5. 全量测试绿(当前 210 + 新增)+ typecheck 净。
6. 浏览器实测:注入分镜表→段同步→三环节组渲染;拖动整组带走 root+实例;图片批量仍正常。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 移除 root batch 标记殃及图片批量 | batch 是共享字段但语义分离:段实例 root 由 INSTANCE_KINDS+无segmentId 识别,图片批量 root 由 isBatchRoot(图片流程 line 2199 设)识别,互不相干。守卫测试锁定图片批量不变。 |
| 段同步内核被误改 | 明令只删呈现标记块;加"applyInstanceSync 除 batch 字段外等价"测试。 |
| Group 与现有布局/自动摆位打架 | 包围盒生成、不重摆成员;Group 只是容器。 |
| 用户拖实例出组 | reconcile 自愈重归(成员真相=活跃实例),与资产库一致。 |
| 段实例同时残留 batchRootId 与 groupId | batchRootId 保留(deleteArchivedInstance 用),但 root 不再是 batchRoot(无 isBatchRoot/batchChildIds),故 batch 渲染/拖动不触发;groupId 接管分组。二者不冲突(canvas-node 按 isGroup/groupId 走)。守卫测试覆盖拖动/删除。 |

## 开放问题(实现计划细化)
1. 三个环节组横向可能相邻重叠(root 在模板同一行相邻)——包围盒重叠时是否需要轻微避让,还是接受用户手动整理(倾向后者,YAGNI)。
2. `deleteArchivedInstance` 后组包围盒收缩的触发点确认。
