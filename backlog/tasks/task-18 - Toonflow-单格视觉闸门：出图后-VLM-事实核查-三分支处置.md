---
id: TASK-18
title: Toonflow 单格视觉闸门：出图后 VLM 事实核查 + 三分支处置
status: In Progress
assignee:
  - '@codex'
created_date: '2026-07-31 09:53'
updated_date: '2026-07-31 10:09'
labels:
  - quality
dependencies:
  - TASK-17
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
来源：2026-07-31 DramaClaw 源码调研（报告 D:\workspaces\.claude\reports\dramaclaw-absorption-analysis.html 第 02 节第一梯队第 2、3 项）。现状：我们的质检（web/src/lib/toonflow/quality-check.ts）全部在出图之前、只看分镜表文本，不看图；出图后是否画对完全靠人眼逐格看（2026-07-30 实测 24 格靠人工挑出 15 个问题格）。要补的是出图之后的图像层粗筛：把每一格连同参考图拼成对比板喂给视觉模型，只问登记表中已开闸门的是/否问题，回答 yes/no/unsure，unsure 一律视为通过（宁可放过可疑格，不误杀好格）。判定角色只查客观矛盾（人数、性别、核心动作、场景类型、时间光线、关键道具在不在、构图方向），明确不评表情/构图美感/张力。处置分三支：无问题 / 建议重抽 / 描述本身不可画或自相矛盾（指向改分镜文字并给出修改建议）——第三支是关键，避免对着有问题的描述死磕重抽。最终是否重抽由人拍板，闸门只出建议。注意：DramaClaw 是 Elastic License 2.0，本仓是 AGPL-3.0，不得复制其源码或提示词原文，只按方法自行实现。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 单格出图后可触发视觉判定，输出每格结论（通过/建议重抽/建议改分镜）并标明命中了哪条已登记失败模式
- [ ] #2 unsure 判定落到通过侧，有单测断言不误杀
- [ ] #3 候选格与参考图拼成一张对比板送审，提示词明确只评候选、参考仅作连续性依据
- [ ] #4 处置建议为改分镜时同时给出具体修改建议文本，不是只报错
- [ ] #5 闸门只给建议不自动删改产物，人可忽略
- [ ] #6 typecheck 0 报错；web 双套测试全绿；浏览器实测一轮真实出图走通闸门
<!-- AC:END -->
