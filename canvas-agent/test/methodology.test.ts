import { describe, expect, it } from "vitest";

import { redlineForKind } from "../src/config.js";
import {
    annotateMethodology,
    buildSelectionResult,
    buildStateResult,
    toonflowKindOf,
    toonflowKindsForOps,
} from "../src/methodology.js";
import type { CanvasNode } from "../src/types.js";

function node(id: string, kind?: string): CanvasNode {
    return {
        id,
        type: "text",
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: kind ? { toonflow: { kind } } : {},
    };
}

describe("toonflowKindOf", () => {
    it("读 metadata.toonflow.kind", () => {
        expect(toonflowKindOf(node("a", "video-workbench"))).toBe("video-workbench");
    });
    it("非 toonflow 节点返回 undefined", () => {
        expect(toonflowKindOf(node("a"))).toBeUndefined();
    });
});

describe("redlineForKind", () => {
    it("video-workbench 含禁首尾帧", () => {
        expect(redlineForKind("video-workbench")).toContain("首尾帧");
    });
    it("未知 kind 回落全局三铁律", () => {
        expect(redlineForKind("project")).toContain("三铁律");
    });
});

describe("annotateMethodology", () => {
    it("含 toonflow kind 时追加 _methodology", () => {
        const r = annotateMethodology({ ok: true }, ["keyframes"]) as Record<string, unknown>;
        expect(String(r._methodology)).toContain("只上色不改构图");
    });
    it("无 kind 时零追加", () => {
        const r = annotateMethodology({ ok: true }, [undefined, undefined]) as Record<string, unknown>;
        expect(r._methodology).toBeUndefined();
    });
    it("多环节去重(同 kind 只出现一次)", () => {
        const r = annotateMethodology({}, ["keyframes", "keyframes", "video-workbench"]) as Record<string, unknown>;
        expect(String(r._methodology).match(/首帧：/g)?.length).toBe(1);
    });
});

describe("toonflowKindsForOps", () => {
    it("从 ops 的 id/nodeId/ids 解析 kind", () => {
        const nodes = [node("n1", "keyframes"), node("n2", "video-workbench")];
        const ops = [
            { type: "update_node", id: "n1" },
            { type: "run_generation", nodeId: "n2" },
            { type: "delete_node", ids: ["n1"] },
        ];
        expect(toonflowKindsForOps(ops, nodes).filter(Boolean).sort()).toEqual([
            "keyframes",
            "keyframes",
            "video-workbench",
        ]);
    });
    it("非数组返回空", () => {
        expect(toonflowKindsForOps(undefined, [])).toEqual([]);
    });
});

describe("buildSelectionResult", () => {
    it("选中视频环节 → 结果含红线", () => {
        const state = { nodes: [node("n1", "video-workbench")], selectedNodeIds: ["n1"] };
        const r = buildSelectionResult(state) as Record<string, unknown>;
        expect((r.nodes as unknown[]).length).toBe(1);
        expect(String(r._methodology)).toContain("首尾帧");
    });
    it("选中普通节点 → 零追加", () => {
        const state = { nodes: [node("n1")], selectedNodeIds: ["n1"] };
        expect((buildSelectionResult(state) as Record<string, unknown>)._methodology).toBeUndefined();
    });
});

describe("buildStateResult", () => {
    it("含环节 → 挂全局三铁律+指引,不倒逐环节红线", () => {
        const state = { nodes: [node("n1", "video-workbench"), node("n2", "keyframes")] };
        const r = buildStateResult(state) as Record<string, unknown>;
        expect(String(r._methodology)).toContain("三铁律");
        expect(String(r._methodology)).toContain("canvas_get_selection");
        expect(String(r._methodology)).not.toContain("只上色不改构图");
    });
    it("普通画布 → 零追加", () => {
        const state = { nodes: [node("n1")] };
        expect((buildStateResult(state) as Record<string, unknown>)._methodology).toBeUndefined();
    });
});
