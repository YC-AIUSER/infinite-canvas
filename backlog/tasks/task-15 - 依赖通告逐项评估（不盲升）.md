---
id: TASK-15
title: 依赖通告逐项评估（不盲升）
status: Done
assignee: []
created_date: '2026-07-28 12:38'
updated_date: '2026-07-28 12:38'
labels: []
dependencies: []
ordinal: 15000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 全部通告有逐项结论
- [x] #2 HTML 报告落盘
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
34 项逐项评估完成（web 19/canvas-agent 8/docs 7），报告 docs/reports/deps-audit-20260728.html（61KB，34 行可排序表 + 9 目录锚点 + 4 组筛选，token 与官方模板逐字一致）。结论分布：建议升级 5（axios/dompurify/vite/vite-node/vitest）、无实际暴露可缓办 25、需进一步确认 4。判断基于代码库实证：canvas-agent 显式绑 127.0.0.1、SPA 不用 RSC、代码高亮链路全项目未引用、dompurify 经 streamdown 摸得到 AI 输出渲染路径。已派生 TASK-12/13/14。未执行任何升级。
<!-- SECTION:FINAL_SUMMARY:END -->
