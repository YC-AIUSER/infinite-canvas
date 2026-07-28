---
id: TASK-4
title: 实测画布数据完整性三修（复制连坐/导出漏键/导入覆盖）
status: Done
assignee:
  - '@claude'
created_date: '2026-07-28 06:12'
updated_date: '2026-07-28 15:36'
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
- [x] #1 生成多图批次→复制批次根→删副本→原批次子图完好；带 Toonflow 产物的画布导出后在另一浏览器导入媒体齐全；同一包导入两次不报错
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
浏览器实测全通过（headless 沙盒，Ve0pabSw 真实画布结构注入，2026-07-28）：①复制批次根 toonflow-storyboard-page(15子图)→节点50→66(+16整体克隆,子图引用0交叉)→删副本→精确回到50,原根+15子图全存活；②导出zip含全部6媒体(4图含3个payload.imageKeys[]数组形态键+1视频video:+1音频audio:),字节与源一致；③同包导入两次:3画布共存,媒体块4→8→12各存一份,导入画布6键与原画布0重叠,数组引用重写,4图片块createImageBitmap全解码,视频音频节点渲染正常。备注:file:前缀(canvas-agent本地引用)媒体块本就不在浏览器存储,导出为空属设计内;'生成多图批次'用生产批次结构等价替代(无API生成)。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
P0 三修实测通过：复制不连坐/导出媒体齐全(含数组键)/重复导入不覆盖，证据=headless 浏览器端到端操作+IndexedDB 断言
<!-- SECTION:FINAL_SUMMARY:END -->
