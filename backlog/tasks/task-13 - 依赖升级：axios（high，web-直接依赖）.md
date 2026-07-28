---
id: TASK-13
title: 依赖升级：axios（high，web 直接依赖）
status: Done
assignee: []
created_date: '2026-07-28 12:37'
updated_date: '2026-07-28 12:59'
labels: []
dependencies: []
ordinal: 13000
---

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 web 升级 axios 到覆盖 10 条通告的版本，602 测试全绿且生图/视频请求实测正常
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
axios 1.16.0 → 1.18.1，10 条通告全部消除（audit 列表里已无 axios 条目，web 通告 19 → 18 项）。验证：typecheck 0、602 测试全绿、浏览器实测真实请求路径（fetchImageModels 走用户渠道配置成功拉回 9 个模型，2.5s）。仅动一行 dependency。踩坑：--legacy-peer-deps 安装会跳掉平台可选二进制（npm cli#4828），本地需补 npm i --no-save @rollup/rollup-win32-x64-msvc，CI 侧已在 ci.yml 里处理过 Linux 版本。
<!-- SECTION:FINAL_SUMMARY:END -->
