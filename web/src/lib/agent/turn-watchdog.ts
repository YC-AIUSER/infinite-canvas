// 结束事件(agent_done/turn.completed)走 SSE 丢失时(如浏览器后台标签页节流),前端会永久卡在
// waiting=true、既转圈又发不出新消息。此判据用于自愈:静默超时后探后端 /health 的 activeTurns,
// 只有后端确认无活跃 turn 时才清状态,绝不误伤仍在跑的长 turn 或前端长任务。
export const STUCK_TURN_TIMEOUT_MS = 60_000;

export function shouldAutoRecoverTurn(params: {
    waiting: boolean;
    hasPendingTool: boolean;
    silentMs: number;
    backendActiveTurns: number | null;
    timeoutMs?: number;
}): boolean {
    const { waiting, hasPendingTool, silentMs, backendActiveTurns, timeoutMs = STUCK_TURN_TIMEOUT_MS } = params;
    if (!waiting || hasPendingTool) return false;
    if (silentMs < timeoutMs) return false;
    return backendActiveTurns === 0;
}
