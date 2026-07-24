import { describe, expect, it } from "vitest";

import { STUCK_TURN_TIMEOUT_MS, shouldAutoRecoverTurn } from "../turn-watchdog";

// 根因:结束事件(agent_done/turn.completed)走 SSE 丢失时,前端永久卡在 waiting=true。
// 自愈判据:waiting 且无待确认工具,SSE 静默超过 timeout,且后端确认无活跃 turn(activeTurns===0)才清。
// 后端确认是关键——绝不在后端仍有活跃 turn(长 turn / 前端长任务)时误清。
describe("shouldAutoRecoverTurn(丢结束事件自愈)", () => {
    const base = { waiting: true, hasPendingTool: false, silentMs: STUCK_TURN_TIMEOUT_MS, backendActiveTurns: 0 };

    it("后端确认无活跃 turn 且静默超时 → 清(核心场景)", () => {
        expect(shouldAutoRecoverTurn(base)).toBe(true);
    });

    it("没在 waiting → 不清", () => {
        expect(shouldAutoRecoverTurn({ ...base, waiting: false })).toBe(false);
    });

    it("静默未到 timeout → 不清", () => {
        expect(shouldAutoRecoverTurn({ ...base, silentMs: STUCK_TURN_TIMEOUT_MS - 1 })).toBe(false);
    });

    it("后端仍有活跃 turn(真在跑的长 turn)→ 不清,绝不误伤", () => {
        expect(shouldAutoRecoverTurn({ ...base, backendActiveTurns: 1 })).toBe(false);
    });

    it("有待确认工具(等用户点确认,非卡死)→ 不清", () => {
        expect(shouldAutoRecoverTurn({ ...base, hasPendingTool: true })).toBe(false);
    });

    it("后端状态未知(探活失败 / 老版本无该字段)→ 不清,保守", () => {
        expect(shouldAutoRecoverTurn({ ...base, backendActiveTurns: null })).toBe(false);
    });

    it("尊重自定义 timeoutMs", () => {
        expect(shouldAutoRecoverTurn({ ...base, silentMs: 5000, timeoutMs: 4000 })).toBe(true);
        expect(shouldAutoRecoverTurn({ ...base, silentMs: 5000, timeoutMs: 6000 })).toBe(false);
    });
});
