/**
 * Agent 的 update_node 是对 metadata 的浅合并，它能往 toonflow.status 里塞任意字符串。
 * 2026-07-27 实测收到过 "ready"：不在七态里，状态徽章会渲染成空白，状态机守卫行为未定义。
 */
import { describe, expect, it } from "vitest";

import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function snapshot(status: string): CanvasAgentSnapshot {
    const node: CanvasNodeData = {
        id: "toonflow-project",
        type: CanvasNodeType.Text,
        title: "项目 / 剧集",
        position: { x: 0, y: 0 },
        width: 320,
        height: 190,
        metadata: { content: "占位", toonflow: { kind: "project", stage: "入口", status: status as never, summary: "锁定当前项目。", checks: [] } },
    };
    return { projectId: "p1", title: "画布", nodes: [node], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
}

describe("applyCanvasAgentOps 守住 toonflow 七态", () => {
    it("Agent 写入非法状态时保留节点原状态，正文照常更新", () => {
        const next = applyCanvasAgentOps(snapshot("approved"), [
            { type: "update_node", id: "toonflow-project", metadata: { content: "本集 165 秒", toonflow: { kind: "project", stage: "入口", status: "ready" as never, summary: "锁定当前项目。", checks: [] } } },
        ]);

        expect(next.nodes[0].metadata?.toonflow?.status).toBe("approved");
        expect(next.nodes[0].metadata?.content).toBe("本集 165 秒");
    });

    it("原状态本身也非法时回落到 empty，不把非法值继续传下去", () => {
        const next = applyCanvasAgentOps(snapshot("ready"), [
            { type: "update_node", id: "toonflow-project", metadata: { content: "新正文", toonflow: { kind: "project", stage: "入口", status: "done" as never, summary: "锁定当前项目。", checks: [] } } },
        ]);

        expect(next.nodes[0].metadata?.toonflow?.status).toBe("empty");
    });

    it("合法状态原样通过", () => {
        const next = applyCanvasAgentOps(snapshot("empty"), [
            { type: "update_node", id: "toonflow-project", metadata: { toonflow: { kind: "project", stage: "入口", status: "review", summary: "锁定当前项目。", checks: [] } } },
        ]);

        expect(next.nodes[0].metadata?.toonflow?.status).toBe("review");
    });
});
