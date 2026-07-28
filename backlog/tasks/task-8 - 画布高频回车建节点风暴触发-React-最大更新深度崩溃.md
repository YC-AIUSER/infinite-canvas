---
id: TASK-8
title: 画布高频回车建节点风暴触发 React 最大更新深度崩溃
status: Done
assignee: []
created_date: '2026-07-28 07:32'
updated_date: '2026-07-28 12:46'
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
- [x] #1 高频回车（≥20 连发）不再崩溃页面
- [x] #2 复现脚本或手动步骤记录在任务里
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
根因：节点创建菜单在 React 提交完成前不卸载，已聚焦按钮可被回车重复触发；每次触发 createNode 提交多组状态更新，叠加 @rc-component/portal 中无依赖数组的 passive effect（每次提交都 setInnerContainer），提交风暴触发 React 更新深度保护。修复：NodeCreateMenu（Codex）与 ConnectionCreateMenu（Claude 对抗审查补齐，同构同病）各加同步 creatingRef 锁，一次菜单实例只放行首次创建；菜单条件渲染关闭即卸载，重开自然复位。验证：typecheck+602 测试全绿；浏览器实测双击建菜单后 60 连发回车仅建 1 节点无崩溃（修复前同操作建 26+ 并白屏），重开菜单建图片节点正常。
<!-- SECTION:FINAL_SUMMARY:END -->
