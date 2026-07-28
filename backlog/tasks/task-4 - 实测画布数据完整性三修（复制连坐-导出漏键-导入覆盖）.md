---
id: TASK-4
title: 实测画布数据完整性三修（复制连坐/导出漏键/导入覆盖）
status: In Progress
assignee:
  - '@claude'
created_date: '2026-07-28 06:12'
updated_date: '2026-07-28 14:42'
labels: []
dependencies: []
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
来源：pending-test.mdx 2026-07-28 第二条，Codex 全面审计 P0。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 生成多图批次→复制批次根→删副本→原批次子图完好；带 Toonflow 产物的画布导出后在另一浏览器导入媒体齐全；同一包导入两次不报错
<!-- AC:END -->
