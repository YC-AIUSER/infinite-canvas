# TODOS

> Toonflow 生成能力二期待办。一期范围见 design doc(~/.gstack/projects/basketikun-infinite-canvas/Administrator-main-design-20260712-103217.md)。

## Toonflow 二期

- [ ] **repair-tail + 段内拼接** — 只重生成段尾坏掉几秒并回并进段视频。需要 ffmpeg(wasm 或后端)裁剪+拼接。背景:一期"单镜修改=整段重生成"(段为原子产物)是为避开拼接依赖的刻意取舍;若阶段 3 数据显示整段重摇成本过高,本项优先级提升。起点:web/src/services/api/video.ts + 新增拼接服务。依赖:成片拼接方案(共用 ffmpeg 决策)。
- [ ] **成片拼接导出** — 段视频+配音混轨拼成单一成片文件。ffmpeg.wasm(内存峰值风险)vs 后端转码,与上一项一并决策。背景:一期 #14 降级为顺序预览+逐段下载。起点:export 节点。
- [ ] **避雷词表更新机制** — seedance_forbidden_terms.json 随即梦平台规则更新的流程(手动季检或社区源)。背景:一期只做静态快照。起点:web/src/lib/toonflow/prompts.ts 词表段。
- [ ] **空间合同点位图交互** — 画布内嵌简易俯视图绘制器或图片上传。背景:方法论要求手绘(AI 生成会漂移),一期只做文本版空间规则。起点:space-contract 节点 UI。
- [ ] **C 路线:粗版一键生成对接** — 一键产出(剧本/分镜/素材)结构化导出并展开进 Toonflow 画布,现有客户直接变画布用户。背景:office-hours 方案 C,被拍板为 B 之后的演化路径;做之前先摸清粗版产物格式与代码库位置(design doc Open Q3)。
- [ ] **E2E 自动化(playwright)** — 一期两条 E2E(全链生成、支配度闭环)用 /qa 人工验收;用户量起来后自动化。起点:eng-review test plan 的 Critical Paths 两条。
- [ ] **分镜表模板 eval** — 阶段 1 模板定稿后,建 3 个固定剧本输入的小型 eval:段划分合理性、格子=镜头纪律、字段完整率(zod 通过率)。背景:分镜表是全链咽喉,模板迭代需要回归防线;基准判定需人工标注一次。依赖:阶段 1 完成。
