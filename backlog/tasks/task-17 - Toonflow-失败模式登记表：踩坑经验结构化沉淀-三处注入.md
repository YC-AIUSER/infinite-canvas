---
id: TASK-17
title: Toonflow 失败模式登记表：踩坑经验结构化沉淀 + 三处注入
status: Done
assignee:
  - '@codex'
created_date: '2026-07-31 09:53'
updated_date: '2026-07-31 10:14'
labels:
  - quality
dependencies: []
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
来源：2026-07-31 DramaClaw 源码调研（报告 D:\workspaces\.claude\reports\dramaclaw-absorption-analysis.html 第 02 节第一梯队第 1 项）。目前分镜/出图踩过的坑（如'长刀被画成别的刀''画面冒出英文标签''留空格被模型填内容'）只存在于人的记忆里，换项目即丢失，每轮重抽都要人现场口述补参考。DramaClaw 的做法是把每条失败模式做成一条结构化记录，同时带四样东西：检测问句（给视觉模型判定用）、预防规则（回注生成提示词）、修正模板（重抽/修复时套用）、负向提示词；外加是否上自动闸门的开关与命中计数。一条经验因此在生成前、出图后、修复时三个地方自动生效。注意：DramaClaw 是 Elastic License 2.0，本仓是 AGPL-3.0，不得复制其源码或提示词原文，只按方法自行实现。本任务只做登记表本体与注入点，出图后的自动判定属于后续任务。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 存在失败模式数据结构，每条至少含检测问句/预防规则/修正模板/负向提示词/是否上闸门五个字段，且新增一条不需要改动生成逻辑代码
- [x] #2 生成提示词时自动拼入已登记条目的预防规则与负向提示词，有单测断言拼入结果
- [x] #3 首批填入至少 5 条真实已知失败模式（含长刀类造型偏差、画面内混入文字标签、网格留空格被填内容），非占位内容
- [x] #4 typecheck 0 报错；web 双套测试全绿
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Codex 实现 + Claude 验收补丁。实现：web/src/lib/toonflow/failure-mode-registry.ts（6 条真实条目，每条含 preventionRule/forbiddenSentence/detectionRule/repairTemplate/gateEnabled）+ prompts.ts 三个图像入口经 withFailureModePrevention 按 promptKind/assetCardType 筛选注入；文本类入口不注入（buildScriptPrompt 有反向断言）。对抗审查抓到两处对不上，Claude 自行补齐（回派成本大于自改）：①原实现缺'是否上闸门'布尔开关，AC#1 明写要求，且会让 TASK-18 的占位契约接不上——补 gateEnabled + gateOnly 筛选，只对文字泄漏/留空格被填/跨格重复/参考图版式泄漏 4 条开闸，道具形态替换与主体数量增加 2 条留在闸门外（单看候选图判不了，开了会误杀）；②缺'新增条目后注入随之变化'回归测试——拼装函数加 registry 注入参数，用合成登记表断言输出随数据变化，锁死未硬编码。另记：detectionRule 是陈述式检查指令而非是否问句，TASK-18 的闸门提示词需自行包装成'逐条回答 yes/no/unsure'，不需要返工。Claude 独立验证：typecheck 0；vitest 62 文件/631 用例全绿（基线 61/624，既有测试文件零改动）。已提交 8bdc806。未做真实生图验证失败率（需真实模型，已登记 pending-test.mdx）。
<!-- SECTION:NOTES:END -->
