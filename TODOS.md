# TODOS

> Toonflow 生成能力二期待办。一期范围见 design doc(~/.gstack/projects/basketikun-infinite-canvas/Administrator-main-design-20260712-103217.md)。

## T9 阶段2 对抗审查遗留(2026-07-12,Codex adversarial review 后 Claude 处置)

> 4 critical 已修(C1 版本快照前移/C2 僵尸实例覆盖守卫/C3 首帧构图锁读取失败中止/C4 删媒体前全局引用过滤),M5/M6/M8-limit/m3/M4 已修。以下为核实后延后/不做项,均非正确性 critical。
>
> 2026-07-13 续修:M9/M8/M7 已修,M10 部分补强(见下)。另查清并修复"30+节点卡10-30秒"性能问题——真根因是渲染记忆化失效(非存储序列化,推翻了原假设),已加 CanvasNode memo 比较器,实测 4-8× 提速;原"创始人裁决存储重构"降级为观察项(报告 docs/reports/storage-perf-investigation.html)。

- [ ] **M2 段同步计划非事务** — InstanceSyncPlan 无分镜版本/内容摘要,弹窗确认时用旧计划套最新 nodesRef,取消不回退不记待同步。真问题但需给 plan 加版本戳+确认时重算比对,改动面较大。缓解:当前首次同步免确认、结构变化才弹窗,竞态窗口小。起点:instances.ts planInstanceSync + project.tsx 确认回调。**← 唯一剩下的 M 项,待评估**
- [x] **M7 资产卡 Blob 泄漏** — 已修(e67a499):弹窗加 sessionKeysRef 跟踪本会话上传/生成的 key,取消全清、保存清被替换的。残留:`open` 被父级程序化置 false(非取消/保存)的路径仍靠全局兜底扫。
- [x] **M8 图像回退不清被裁版本媒体** — 已修(caf200f):applyRollback 改返回 {nodes, orphanedKeys},用最终状态反查引用集算孤儿,handler 清理;+2 不变量测试。
- [ ] **M1 段实例同步过度标 stale** — 保留段有产出实例一律标 stale,不比分镜表版本/镜头内容。过度标 stale 是安全侧(多重生成一次),非错误。可选优化:按 upstreamVersions 比对豁免未变段。起点:instances.ts planInstanceSync toStale 计算。
- [x] **M9 cardId 冲突未校验** — 已修(4cf14f0):validateAssetCards 加重复 cardId 检测(每键只报一次)+不变量测试。
- [ ] **格子数=行数无结果校验(major)** — "格子=镜头"只写进 prompt,模型返回图不做格子数/合并检测。受 P3"不加量化指标"裁决约束,属方法论已接受风险,靠 prompt 控制。二期若上视觉分析可加。
- [ ] **测试规格化补强(M10)** — 已为 C3/M5/M6/M8/M9 补规格不变量测试;审查指出的 state-machine/segments/instances 若干"验证实现行为"用例仍待改为验证不变量。起点:各 __tests__ 逐个过。

## Toonflow 二期

- [ ] **repair-tail + 段内拼接** — 只重生成段尾坏掉几秒并回并进段视频。需要 ffmpeg(wasm 或后端)裁剪+拼接。背景:一期"单镜修改=整段重生成"(段为原子产物)是为避开拼接依赖的刻意取舍;若阶段 3 数据显示整段重摇成本过高,本项优先级提升。起点:web/src/services/api/video.ts + 新增拼接服务。依赖:成片拼接方案(共用 ffmpeg 决策)。
- [ ] **成片拼接导出** — 段视频+配音混轨拼成单一成片文件。ffmpeg.wasm(内存峰值风险)vs 后端转码,与上一项一并决策。背景:一期 #14 降级为顺序预览+逐段下载。起点:export 节点。
- [ ] **避雷词表更新机制** — seedance_forbidden_terms.json 随即梦平台规则更新的流程(手动季检或社区源)。背景:一期只做静态快照。起点:web/src/lib/toonflow/prompts.ts 词表段。
- [ ] **空间合同点位图交互** — 画布内嵌简易俯视图绘制器或图片上传。背景:方法论要求手绘(AI 生成会漂移),一期只做文本版空间规则。起点:space-contract 节点 UI。
- [ ] **C 路线:粗版一键生成对接** — 一键产出(剧本/分镜/素材)结构化导出并展开进 Toonflow 画布,现有客户直接变画布用户。背景:office-hours 方案 C,被拍板为 B 之后的演化路径;做之前先摸清粗版产物格式与代码库位置(design doc Open Q3)。
- [ ] **E2E 自动化(playwright)** — 一期两条 E2E(全链生成、支配度闭环)用 /qa 人工验收;用户量起来后自动化。起点:eng-review test plan 的 Critical Paths 两条。
- [ ] **分镜表模板 eval** — 阶段 1 模板定稿后,建 3 个固定剧本输入的小型 eval:段划分合理性、格子=镜头纪律、字段完整率(zod 通过率)。背景:分镜表是全链咽喉,模板迭代需要回归防线;基准判定需人工标注一次。依赖:阶段 1 完成。
