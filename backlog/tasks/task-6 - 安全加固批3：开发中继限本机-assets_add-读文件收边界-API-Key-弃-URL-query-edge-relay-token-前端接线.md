---
id: TASK-6
title: >-
  安全加固批3：开发中继限本机 / assets_add 读文件收边界 / API Key 弃 URL query / edge-relay token
  前端接线
status: Done
assignee: []
created_date: '2026-07-28 06:31'
updated_date: '2026-07-28 06:47'
labels: []
dependencies: []
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex 全面审计安全类四条：① dev CORS 中继无客户端限制，--host 0.0.0.0 下局域网任意设备可当开放代理打内网(SSRF)；② canvas-agent MCP assets_add 可读任意本机绝对路径、无扩展名与大小限制，任意文件被 base64 后可随画布外泄；③ README 推荐 ?apiKey= 传密钥，进访问日志/浏览器历史后前端才清除；④ edge-relay 服务端强制 x-relay-token 但前端从不发送，按文档部署全 401。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 dev 中继默认仅接受回环地址客户端，RELAY_ALLOW_LAN=1 显式放开，拒绝时返回 403 明确提示
- [x] #2 assets_add 本地读文件仅限图片扩展名白名单且有大小上限，越界返回可读错误；canvas-agent 测试全绿
- [x] #3 配置导入支持 #fragment 传参并在导入后清理，README 改推荐 fragment；旧 query 方式保留兼容
- [x] #4 前端可配置 relay 访问 token，请求命中 /relay/ 转发形态时附带 x-relay-token；typecheck+web 测试全绿
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
四条全修并验收：typecheck+579 web 测试+canvas-agent 测试全绿，浏览器实测 fragment 解析与 relay 判定。注意：dev 中继需重启 dev server 生效；canvas-agent 需重新发版对 npx 用户生效。
<!-- SECTION:FINAL_SUMMARY:END -->
