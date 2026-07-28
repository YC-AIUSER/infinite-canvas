---
id: TASK-7
title: 正确性收尾批4：水合失败收尾 / 持久化关页 flush / 换媒体回收 / WebDAV 限明文 / 节点内滚动
status: In Progress
assignee: []
created_date: '2026-07-28 06:54'
labels: []
dependencies: []
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex 全面审计其他类五条：① 参考图水合在 try 外失败导致运行标与请求永不收尾；② canvas store 400ms 防抖 + 视口 500ms 定时器，立即关页丢最后操作；③ 节点替换媒体后旧 blob 不回收渐耗 IndexedDB；④ WebDAV 允许 http 明文发 Basic 凭据；⑤ 画布 wheel 全量 preventDefault 吞掉节点内文本滚动。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 hydrate 失败时运行标/生成请求正确收尾并有用户可见错误提示
- [ ] #2 pagehide/visibilitychange(hidden) 时画布与视口的待写状态立即落库；新增 flush 相关测试
- [ ] #3 替换节点媒体后触发既有全量 GC 清理旧 blob
- [ ] #4 WebDAV 拒绝公网 http（私网/回环/.local 放行并提示明文风险）；isPrivateHost 纯函数带测试
- [ ] #5 节点内可滚动内容 wheel 正常滚动、ctrl+wheel 仍缩放画布；浏览器实测
- [ ] #6 web typecheck + npm test 全绿
<!-- AC:END -->
