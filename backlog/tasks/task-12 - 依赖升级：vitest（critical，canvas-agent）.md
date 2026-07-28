---
id: TASK-12
title: 依赖升级：vitest（critical，canvas-agent）
status: Done
assignee: []
created_date: '2026-07-28 12:37'
updated_date: '2026-07-28 12:57'
labels: []
dependencies: []
ordinal: 12000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 canvas-agent 升级 vitest 到修复版本，npm test 仍全绿
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
vitest 2.1.9 → 3.2.7（连带 vite 5.4.21 → 7.3.6、@vitest/mocker、vite-node）。canvas-agent 通告从 8 项降到 3 项，唯一的 critical（vitest UI server 任意文件读+执行 GHSA-5xrq-8626-4rwp）已清零。验证：npm test 37+14 全绿、npm run build 退出码 0。仅动 devDependency，不影响发布产物（devDeps 不随包发布）。剩余 3 项：fast-uri(high，属 TASK-14 待确认)、@modelcontextprotocol/sdk 与 @hono/node-server(moderate，报告判定无实际暴露——canvas-agent 显式绑 127.0.0.1)。
<!-- SECTION:FINAL_SUMMARY:END -->
