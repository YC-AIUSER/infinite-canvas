---
id: TASK-10
title: canvas-agent 发版：assets_add 安全边界对 npx 生效
status: In Progress
assignee: []
created_date: '2026-07-28 12:24'
updated_date: '2026-07-28 12:25'
labels: []
dependencies: []
ordinal: 10000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 npm 新版已发布且 npm view 可见
- [x] #2 pack 产物含 local-image-input 编译文件
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
阻塞：npm publish 返回 404（实为认证失败，npm whoami 返回 401 Unauthorized）——~/.npmrc 里的 _authToken 已失效/过期。已完成：版本 0.2.2→0.3.0、build 通过、37+14 测试全绿、npm pack --dry-run 确认产物含 dist/local-image-input.js(1.8kB) 与更新后的 dist/mcp-server.js（26 文件/40.0kB）。待用户在 npmjs.com 生成新 token（需勾 Bypass 2FA）并写入 ~/.npmrc 后，在 canvas-agent 目录跑 npm publish 即可。
<!-- SECTION:NOTES:END -->
