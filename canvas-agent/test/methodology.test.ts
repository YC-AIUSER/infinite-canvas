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
    // 本条锁的是「有 toonflow kind 就追加该环节红线」这个行为,不是红线的字面内容。
    // 断言只挑红线里稳定的特征词,别锁整句——方法论文案会随 skill 更新改写,锁死会误伤。
    it("含 toonflow kind 时追加 _methodology", () => {
        const r = annotateMethodology({ ok: true }, ["keyframes"]) as Record<string, unknown>;
        expect(String(r._methodology)).toContain("已退役");
    });
    it("无 kind 时零追加", () => {
        const r = annotateMethodology({ ok: true }, [undefined, undefined]) as Record<string, unknown>;
        expect(r._methodology).toBeUndefined();
    });
    it("多环节去重(同 kind 只出现一次)", () => {
        const r = annotateMethodology({}, ["keyframes", "keyframes", "video-workbench"]) as Record<string, unknown>;
        expect(String(r._methodology).match(/首帧：/g)?.length).toBe(1);
    });
    it("多个回落 kind 只堆一遍全局 brief", () => {
        const r = annotateMethodology({}, ["script", "assets"]) as Record<string, unknown>;
        expect(String(r._methodology).match(/三铁律/g)?.length).toBe(1);
    });
    it("数组结果原样返回,不退化成对象", () => {
        const r = annotateMethodology([1, 2, 3], ["keyframes"]) as unknown;
        expect(Array.isArray(r)).toBe(true);
        expect((r as Record<string, unknown>)._methodology).toBeUndefined();
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
    it("识别 connect_nodes 的 fromNodeId/toNodeId 端点", () => {
        const nodes = [node("n1", "keyframes"), node("n2", "video-workbench")];
        const ops = [{ type: "connect_nodes", fromNodeId: "n1", toNodeId: "n2" }];
        expect(toonflowKindsForOps(ops, nodes).filter(Boolean).sort()).toEqual(["keyframes", "video-workbench"]);
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
    // 同上:反向断言也要挑当前红线里真实存在的特征词,否则红线改写后这条会退化成永远为真的空断言。
    it("含环节 → 挂全局三铁律+指引,不倒逐环节红线", () => {
        const state = { nodes: [node("n1", "video-workbench"), node("n2", "keyframes")] };
        const r = buildStateResult(state) as Record<string, unknown>;
        expect(String(r._methodology)).toContain("三铁律");
        expect(String(r._methodology)).toContain("canvas_get_selection");
        expect(String(r._methodology)).not.toContain("已退役");
    });
    it("普通画布 → 零追加", () => {
        const state = { nodes: [node("n1")] };
        expect((buildStateResult(state) as Record<string, unknown>)._methodology).toBeUndefined();
    });
});
