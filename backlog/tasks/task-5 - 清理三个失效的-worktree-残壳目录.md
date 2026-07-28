---
id: TASK-5
title: 清理三个失效的 worktree 残壳目录
status: Done
assignee: []
created_date: '2026-07-28 06:12'
updated_date: '2026-07-28 06:52'
labels: []
dependencies: []
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
infinite-canvas-wt-climax / wt-p7 / wt-qcrepair 三个目录还在 D:\workspaces 下，但 git worktree list 已不认它们（branch 为空、dirty 0）。属于残壳，占盘且干扰项目列表。删前先确认里面没有未合并的改动。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 git worktree prune 跑过；三个目录已删除或确认有价值后正式转为 worktree；D:\workspaces 下不再有 infinite-canvas-wt-*
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
三目录确认无未合并改动（16 天内无非依赖文件改动、本地无 codex 分支残留）后删除；junction 先摘再删，主仓 web/node_modules 完好（602 顶层包）；git worktree prune 已跑，D:\workspaces 无 wt-* 残留。
<!-- SECTION:FINAL_SUMMARY:END -->
