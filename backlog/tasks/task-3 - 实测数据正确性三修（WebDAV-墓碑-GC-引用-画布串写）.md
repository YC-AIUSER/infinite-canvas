---
id: TASK-3
title: 实测数据正确性三修（WebDAV 墓碑/GC 引用/画布串写）
status: To Do
assignee: []
created_date: '2026-07-28 06:12'
updated_date: '2026-07-28 06:13'
labels: []
dependencies:
  - TASK-1
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
来源：docs/content/docs/progress/pending-test.mdx 2026-07-28 第一条，Codex 全面审计 P1。三项改动都标注需实测。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 设备 A 删画布→WebDAV 同步→设备 B 该画布消失且不复活；删素材后生图工作台历史里的图仍能打开；画布 A 上传大文件立即切到画布 B，B 里不出现 A 的图且有丢弃提示
<!-- AC:END -->
