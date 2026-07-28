---
id: TASK-16
title: 启动时孤儿媒体块清扫
status: Done
assignee:
  - '@claude'
created_date: '2026-07-28 15:44'
updated_date: '2026-07-28 15:59'
labels: []
dependencies: []
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
GC(cleanupUnusedAppMedia)目前只在删素材/删画布/替换媒体时触发，中断的上传(如页面隐藏时序/串写防护丢弃)和导入失败留下的孤儿媒体块会无限期滞留。2026-07-28 TASK-4 实测时实际产生过一个孤儿video:块。方案:水合完成后空闲时机跑一次现有 cleanupUnusedAppMedia，复用批4③的在途上传计入引用机制防误删。
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 应用启动完全水合后自动跑一次全量媒体清理，中断上传/导入失败留下的无引用块被清除；被 assets/projects/工作台历史/在途上传引用的块绝不误删（有回归测试断言）；typecheck+双套测试全绿
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1.session-media-keys 登记表(4个写入咽喉点登记) 2.startup-media-sweep 双水合门+8s延迟+once 3.ClientRootInit 挂载接线 4.vitest 5组测试
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
实现：session-media-keys 登记表(uploadImage/setImageBlob/uploadMediaFile/setMediaBlob 四咽喉点登记)+startup-media-sweep(双store水合门+8s延迟+模块级once)+ClientRootInit 挂载接线。验证：typecheck 0；vitest 58文件/607用例全绿(新增5用例)；新增行无 console.log/TODO。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
GC 补启动触发点：双水合后8秒跑一次 cleanupUnusedAppMedia，会话内新键经登记表豁免防误删；5组回归测试锁死红线，typecheck+607用例全绿
<!-- SECTION:FINAL_SUMMARY:END -->
