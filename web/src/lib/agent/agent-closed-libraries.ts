import { CLOSED_LIBRARY_CATEGORIES, renderLibraries } from "@/lib/toonflow/closed-libraries";
import type { CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";

/**
 * 给 Toonflow 画布的状态返回挂上封闭词库全文。
 *
 * Agent 侧收到的方法论红线只有"构图/布光/运镜/景别/表演/调色一律从封闭词库逐字选取"这条命令，
 * 词库实体在 closed-libraries.ts，而 canvas-agent 的工具没有一个能读到它，于是 Agent 只能停下来
 * 向用户要词库（2026-07-27 实测卡在分镜决策锁定表："画布没有提供构图、布光、运镜、景别、表演、
 * 调色的封闭词库，因此没有擅自生成分镜或视频"）。停下来是它守规矩的表现，缺的是投喂。
 *
 * 挂在状态返回而不是新增一个取词库的工具：Agent 的系统提示要求任何涉及画布的请求都先调
 * canvas_get_state，挂这里它必然拿到、不会忘记去取，也不必改 canvas-agent 包重新发版。
 * 全量 11 类渲染出来约 3.3k 字符，相对画布状态本身的体积可以接受；非 Toonflow 画布不附加。
 * 词条一律由 renderLibraries 现取，不在此处手抄（closed-libraries.ts 是唯一取词入口）。
 */
export function withClosedLibraries<T>(result: T, snapshot: Pick<CanvasAgentSnapshot, "nodes">): T {
    if (result === null || typeof result !== "object" || Array.isArray(result)) return result;
    if (!snapshot.nodes.some((node) => node.metadata?.toonflow)) return result;
    const libraries = renderLibraries([...CLOSED_LIBRARY_CATEGORIES]);
    return { ...(result as object), _closedLibraries: `以下是 Toonflow 方法论要求逐字选取的封闭词库全文。选词只许从中抄名称与定义关键词，禁自创、禁改名、禁简写：\n${libraries}` } as T;
}
