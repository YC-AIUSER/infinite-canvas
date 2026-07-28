---
id: TASK-16
title: 启动时孤儿媒体块清扫
status: Done
assignee:
  - '@claude'
created_date: '2026-07-28 15:44'
updated_date: '2026-07-28 17:10'
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

Codex 对抗审查(challenge)：2 P1 + 3 P2 全部核实并修复(8db525c)——①参照集全空熔断(水合静默失败防误删)②会话键改删除时刻实时豁免+登记先于写入(修清扫进行中新上传误删,连带修好既有GC同款竞态)③once守卫挪globalThis防HMR+导入失败可重试；新增6用例,613全绿。

stop-gate 追审修复(第3轮)：单 store 水合降级场景——新增 storage-read-health 降级打标(localforage getItem catch 处)，启动清扫改为'任一状态降级读取即熔断'，全空启发式降为兜底；+3 用例，616 全绿。

stop-gate 追审第2轮修复：水合链路上层异常(JSON损坏/资产重建抛错)走 persist error 通道但回调无视——两 store 的 onRehydrateStorage 现在 error 时打降级标；端到端测试(真实store+损坏持久化)3用例，619全绿(d006ae9 之后新 commit)。

stop-gate 追审第3轮修复：水合失败回调的 setState 会触发 persist 把空初始态回写存储(洗白损坏数据,熔断只延迟一轮)——降级会话现拦截该 store 全部持久化写入,原始数据保盘,每会话重新报降级形成稳定熔断循环;已知取舍=降级会话改动不落盘。+3用例(降级拦写/canvas flush不落盘/健康会话正常写),622全绿。

stop-gate 追审第4轮修复：降级标打上前的时序窗口——水合进行中发起的写入(canvas 防抖队列尤甚)会在标记后落盘覆盖损坏数据；写入门槛改为 canPersist=水合定型&&未降级(storage-read-health 新增 settledHydrations)，新增窗口期测试(水合挂起中 createProject+flush 零落盘)，623 全绿。

stop-gate 追审第5轮：'健康慢水合写入被吞'实证不成立——定型回调 setState 触发的持久化会补落盘窗口期改动(门已开、写最新内存态)；新增测试锁定自愈链路+承重注释，624全绿。zustand rehydrate merge 覆盖窗口期内存态属既有语义、改动前后一致。
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
GC 补启动触发点：双水合后8秒跑一次 cleanupUnusedAppMedia，会话内新键经登记表豁免防误删；5组回归测试锁死红线，typecheck+607用例全绿
<!-- SECTION:FINAL_SUMMARY:END -->
