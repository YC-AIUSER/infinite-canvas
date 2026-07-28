---
id: TASK-1
title: P1 数据正确性三修：WebDAV 墓碑 / GC 计入工作台历史 / 画布串写防护
status: Done
assignee: []
created_date: '2026-07-28 06:05'
updated_date: '2026-07-28 06:07'
labels: []
dependencies: []
ordinal: 1000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Codex 全面审计 P1 批次。三处修复：WebDAV 同步增加删除墓碑（180天/1000条上限，清单向后兼容），删除的画布/素材/工作台历史不再被同步复活；垃圾回收 used 集合计入生图/视频工作台历史，历史引用的媒体不再被物理误删；/canvas/:id 组件复用下的项目 ID 守卫，切画布时旧画布的持久化与在途异步结果不再串写进新画布。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 web 目录 npm run typecheck 退出码 0
- [x] #2 npm test 全绿且新增墓碑合并与 GC 收集回归测试
- [x] #3 墓碑合并覆盖：删除不复活/删后重编辑胜出/旧清单无 deletions 字段兼容/超龄超量裁剪
- [x] #4 浏览器实测：GC 读到真实工作台历史，历史引用媒体不被误删
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
追溯建档：本任务在 Backlog 规则生效前已派工（codex-task canvas-sync-gc-guards-p1）
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
验收通过并已提交 5a5d01a（分支 fix/canvas-sync-gc-guards-p1）。对抗审查发现并处置：日志存储收敛为共享实例（storeName 核对一致，无灾难风险）、一处缩进错位已修、粘贴 groupId 语义与复制入口统一（行为变化已记 pending-test）。验证：typecheck 过、53 文件 572 测试全绿、浏览器实测 GC 读到真实工作台历史且墓碑链路走通。遗留：切画布中止在途生成会连弹多条丢弃提示（UX 小瑕疵）；已知取舍见 pending-test.mdx。
<!-- SECTION:FINAL_SUMMARY:END -->
