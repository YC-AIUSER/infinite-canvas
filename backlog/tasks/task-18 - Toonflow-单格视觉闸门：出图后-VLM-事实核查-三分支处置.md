---
id: TASK-18
title: Toonflow 单格视觉闸门：出图后 VLM 事实核查 + 三分支处置
status: In Progress
assignee:
  - '@codex'
created_date: '2026-07-31 09:53'
updated_date: '2026-07-31 10:28'
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
- [x] #1 单格出图后可触发视觉判定，输出每格结论（通过/建议重抽/建议改分镜）并标明命中了哪条已登记失败模式
- [x] #2 unsure 判定落到通过侧，有单测断言不误杀
- [x] #3 候选格与参考图拼成一张对比板送审，提示词明确只评候选、参考仅作连续性依据
- [x] #4 处置建议为改分镜时同时给出具体修改建议文本，不是只报错
- [x] #5 闸门只给建议不自动删改产物，人可忽略
- [ ] #6 typecheck 0 报错；web 双套测试全绿；浏览器实测一轮真实出图走通闸门
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Codex 骨架(ff56a6c) + Claude 验收补丁(292de9c, 572fdb6)。对抗审查抓到两处不符并自行修复(回派成本大于自改)：①三分支语义错——AC#4 要的第三支是'描述本身不可画→建议改分镜并给具体改法'，原实现做成 review=人工复核，无改分镜语义也无建议字段，且测试按它自己那套断言(测试迎合实现实锤)；现改为 pass/regenerate/edit-script，命中后由模型判病因 image|script，script 且带 scriptSuggestion 才走 edit-script，拿不出改法降级重抽，总结论 edit-script 优先于 regenerate。②请求异常直接抛出，未按'算通过但保留错误信息'处理；现捕获后落通过侧并把原因放 error 字段，连'无可用文本模型'也不抛。同时把占位契约换成真实登记表(问句取 gateEnabled 条目的 detectionRule)，删除 placeholder 文件。Claude 独立验证：typecheck 0；vitest 63 文件/643 用例全绿；grep 确认闸门内无新增 axios/fetch、无硬编码端点或密钥。浏览器实测(用户 VPS 渠道 gpt-5.6-luna, 138.128.193.164:18318，两次真实调用)：脏图(真实产出图叠 'DIALOGUE beat 3 / MGNQN_x71')→ prompt-text-leakage=yes/cause=image → regenerate，耗时 9.3s；干净原图 → 三项全 no → pass，耗时 12.8s，无误杀；unsure 项确认落通过侧。实测另发现闸门自造误判源：对比板格名文字本身会触发'画面混入文字'这条，已写死豁免(572fdb6)。AC#6 只勾一半：typecheck+vitest 已过，但豁免句改后未在真实模型复跑(:3000 被其他应用占用)，且闸门尚无画布 UI 入口(按简报未做)，故状态留 In Progress。
<!-- SECTION:NOTES:END -->
