---
id: TASK-8
title: 画布高频回车建节点风暴触发 React 最大更新深度崩溃
status: To Do
assignee: []
created_date: '2026-07-28 07:32'
labels: []
dependencies: []
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
验收批4时发现：画布聚焦下 20+ 次高频回车（每次回车快捷建文本节点，逐个弹提示面板）触发 Maximum update depth exceeded，React Router 错误边界接管白屏；刷新恢复、数据无损。栈指向 antd Portal + passive mount effects。正常人工操作难以触发；判定为健壮性边缘问题，与批4改动无关（本批未动弹窗/Portal 代码）。修复思路候选：节点创建防抖/合并 dialogNodeId 抖动、或错误边界内局部恢复。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 高频回车（≥20 连发）不再崩溃页面
- [ ] #2 复现脚本或手动步骤记录在任务里
<!-- AC:END -->
