---
id: TASK-17
title: Toonflow 失败模式登记表：踩坑经验结构化沉淀 + 三处注入
status: In Progress
assignee:
  - '@codex'
created_date: '2026-07-31 09:53'
updated_date: '2026-07-31 10:03'
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
- [ ] #1 存在失败模式数据结构，每条至少含检测问句/预防规则/修正模板/负向提示词/是否上闸门五个字段，且新增一条不需要改动生成逻辑代码
- [ ] #2 生成提示词时自动拼入已登记条目的预防规则与负向提示词，有单测断言拼入结果
- [ ] #3 首批填入至少 5 条真实已知失败模式（含长刀类造型偏差、画面内混入文字标签、网格留空格被填内容），非占位内容
- [ ] #4 typecheck 0 报错；web 双套测试全绿
<!-- AC:END -->
