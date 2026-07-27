/** Codex 对抗审查 2026-07-27 疑点3 复现：状态守卫只覆盖了完整 update_node。 */
import { describe, expect, it } from "vitest";

import { applyCanvasAgentOps, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function snapshot(nodes: CanvasNodeData[]): CanvasAgentSnapshot {
    return { projectId: "p1", title: "画布", nodes, connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
}

function toonflowNode(): CanvasNodeData {
    return {
        id: "toonflow-project", type: CanvasNodeType.Text, title: "项目 / 剧集", position: { x: 0, y: 0 }, width: 320, height: 190,
        metadata: { content: "占位", toonflow: { kind: "project", stage: "入口", status: "approved", summary: "锁定当前项目。", checks: ["项目已选"] } },
    };
}

function plainNode(): CanvasNodeData {
    return { id: "plain", type: CanvasNodeType.Text, title: "普通文本", position: { x: 0, y: 0 }, width: 320, height: 190, metadata: { content: "随手记" } };
}

describe("对抗审查疑点3：状态守卫覆盖面", () => {
    it("add_node 带非法状态时也要被拦，不能原样落库", () => {
        const next = applyCanvasAgentOps(snapshot([]), [
            { type: "add_node", id: "n-new", nodeType: CanvasNodeType.Text, metadata: { toonflow: { kind: "script", stage: "内容源", status: "ready" as never, summary: "剧本", checks: [] } } },
        ]);

        expect(next.nodes[0].metadata?.toonflow?.status).toBe("empty");
    });

    it("只传 { toonflow: { status } } 的部分更新不能抹掉 kind/stage/summary/checks", () => {
        const next = applyCanvasAgentOps(snapshot([toonflowNode()]), [
            { type: "update_node", id: "toonflow-project", metadata: { toonflow: { status: "review" } as never } },
        ]);
        const toonflow = next.nodes[0].metadata?.toonflow;

        expect(toonflow?.status).toBe("review");
        expect(toonflow?.kind).toBe("project");
        expect(toonflow?.stage).toBe("入口");
        expect(toonflow?.summary).toBe("锁定当前项目。");
        expect(toonflow?.checks).toEqual(["项目已选"]);
    });

    it("普通节点不该被一个残缺的 toonflow 字段污染成 Toonflow 节点", () => {
        const next = applyCanvasAgentOps(snapshot([plainNode()]), [
            { type: "update_node", id: "plain", metadata: { content: "新内容", toonflow: { status: "ready" } as never } },
        ]);

        expect(next.nodes[0].metadata?.content).toBe("新内容");
        expect(next.nodes[0].metadata?.toonflow).toBeUndefined();
    });
});
