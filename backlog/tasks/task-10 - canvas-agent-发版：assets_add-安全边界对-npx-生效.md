---
id: TASK-10
title: canvas-agent 发版：assets_add 安全边界对 npx 生效
status: In Progress
assignee: []
created_date: '2026-07-28 12:24'
updated_date: '2026-07-28 12:29'
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
阻塞点=npm 发布凭据（两条路径任选其一，都需要你先在 npmjs.com 生成 Automation token 并勾 Bypass 2FA）：
【推荐】仓库已有现成的自动发布 workflow（.github/workflows/publish-canvas-agent.yml，上游带的，push 到 main 且 canvas-agent/** 变更时触发，会自动跳过已发布版本）。当前 gh secret list 显示仓库没有配任何 secret，所以它报 ENEEDAUTH。设置 NPM_TOKEN 后重跑该 workflow 即可自动发 0.3.0。
【备选】修本机 ~/.npmrc 的 _authToken（当前已失效，npm whoami 返回 401），然后在 canvas-agent 目录跑 npm publish。
已完成部分：版本 0.2.2→0.3.0（已提交 fffd966）、build 通过、37+14 测试全绿、npm pack --dry-run 确认产物含 dist/local-image-input.js(1.8kB) 与 dist/mcp-server.js（26 文件/40.0kB）。
<!-- SECTION:NOTES:END -->
