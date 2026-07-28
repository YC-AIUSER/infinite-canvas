---
id: TASK-14
title: 依赖评估遗留：fast-uri / next / sharp 暴露面待确认
status: Done
assignee: []
created_date: '2026-07-28 12:37'
updated_date: '2026-07-28 13:02'
labels: []
dependencies: []
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
报告里 4 条结论为「需进一步确认」：fast-uri（两处，未定位引入方）、docs 的 next 与 sharp（需确认文档站是否只做静态构建）。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 四条各有明确结论（升级或排除）
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
四条「需进一步确认」已定案：

1. fast-uri（web，high）→ 无实际暴露。引入链 shadcn → @modelcontextprotocol/sdk → ajv → fast-uri；shadcn 是脚手架 CLI，全项目零源码引用，不进浏览器产物。已顺手把 shadcn 从 dependencies 移到 devDependencies（提交 edc84f1），连带 @hono/node-server、@modelcontextprotocol/sdk、hono 三条一并移出生产依赖树；npm audit --omit=dev 从 18 降到 8 项。

2. fast-uri（canvas-agent，high）→ 无实际暴露可缓办。经 MCP SDK → ajv 用于 JSON Schema 校验，schema 由 canvas-agent 自己定义、非攻击者提供；host 混淆需要攻击者控制 $ref URI。

3+4. next / sharp（docs，high）→ 取决于部署方式，需你回答一句：docs/next.config.mjs 是 output: "standalone"（服务端构建，非静态导出），且有 docs-docker-image.yml 在 v* tag 上构建镜像。若你只在本机跑 npm run dev 写文档 → 无暴露；若把这个镜像部署到公网 → Next 的 9 条（SSRF/缓存混淆/Server Actions DoS/图片优化 SVG DoS）与 sharp 的 libvips CVE 都是真实可达，应升级 next 与 sharp。附注：本次 tag 名 yc-v0.7.0 不匹配 v* 通配，未触发该镜像构建。
<!-- SECTION:FINAL_SUMMARY:END -->
