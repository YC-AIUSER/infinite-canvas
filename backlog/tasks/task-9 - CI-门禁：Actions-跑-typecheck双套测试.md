---
id: TASK-9
title: CI 门禁：Actions 跑 typecheck+双套测试
status: Done
assignee: []
created_date: '2026-07-28 12:11'
updated_date: '2026-07-28 12:20'
labels: []
dependencies: []
ordinal: 9000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 workflow 文件合入 main
- [x] #2 首次运行绿或降级确认已记录
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
CI 首绿于 run 30358247515（web + canvas-agent 两 job 全 success）。两轮 yaml 修复：① npm ci 加 --legacy-peer-deps（pro-components beta 声明 antd^5 而项目用 antd6）；② 补装 @rollup/rollup-linux-x64-gnu 与 @esbuild/linux-x64（npm cli#4828：legacy-peer-deps 下平台可选依赖被跳装）。仅改 yaml，未改测试。
<!-- SECTION:FINAL_SUMMARY:END -->
