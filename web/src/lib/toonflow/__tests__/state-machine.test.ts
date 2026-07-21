import { describe, expect, it } from "vitest";

import type { NodeOutput, NodeStatus } from "../schema";
import {
    approveNode,
    cascadeOrder,
    failurePolicy,
    nextStatusOnGenerate,
    onGenerateFailure,
    onGenerateSuccess,
    propagateStale,
    rollbackToVersion,
    saveEditedNode,
    type GraphNode,
} from "../state-machine";

function graphNode(
    nodeId: string,
    status: NodeStatus = "approved",
    upstreamVersions: Record<string, number> = {},
    skipped?: boolean,
): GraphNode {
    return { nodeId, status, version: 1, upstreamVersions, skipped };
}

function output(overrides: Partial<NodeOutput> = {}): NodeOutput {
    return {
        nodeId: "node-1",
        kind: "script",
        version: 1,
        status: "review",
        payload: { text: "当前内容" },
        upstreamVersions: {},
        generatedAt: "2026-07-12T12:00:00.000Z",
        ...overrides,
    };
}

describe("propagateStale", () => {
    it("直接下游标记为 stale", () => {
        const nodes = [graphNode("root"), graphNode("child", "approved", { root: 1 })];
        expect(propagateStale(nodes, [{ from: "root", to: "child" }], "root", 2)).toEqual(["child"]);
    });

    it("间接下游也标记为 stale", () => {
        const nodes = [
            graphNode("root"),
            graphNode("child", "approved", { root: 1 }),
            graphNode("grandchild", "review", { root: 1 }),
        ];
        const edges = [
            { from: "root", to: "child" },
            { from: "child", to: "grandchild" },
        ];
        expect(propagateStale(nodes, edges, "root", 2)).toEqual(["child", "grandchild"]);
    });

    it("快照版本不旧时跳过并终止该分支", () => {
        const nodes = [
            graphNode("root"),
            graphNode("guard", "approved", { root: 2 }),
            graphNode("descendant", "approved", { root: 1 }),
        ];
        const edges = [
            { from: "root", to: "guard" },
            { from: "guard", to: "descendant" },
        ];
        expect(propagateStale(nodes, edges, "root", 2)).toEqual([]);
    });

    it("skipped 节点穿透但自身不标记", () => {
        const nodes = [graphNode("root"), graphNode("skipped", "skipped"), graphNode("child")];
        const edges = [
            { from: "root", to: "skipped" },
            { from: "skipped", to: "child" },
        ];
        expect(propagateStale(nodes, edges, "root", 2)).toEqual(["child"]);
    });

    it("empty 与 generating 节点穿透但不标记", () => {
        const nodes = [
            graphNode("root"),
            graphNode("empty", "empty"),
            graphNode("generating", "generating"),
            graphNode("child", "failed"),
        ];
        const edges = [
            { from: "root", to: "empty" },
            { from: "empty", to: "generating" },
            { from: "generating", to: "child" },
        ];
        expect(propagateStale(nodes, edges, "root", 2)).toEqual(["child"]);
    });

    it("环图不会死循环", () => {
        const nodes = [graphNode("root"), graphNode("a"), graphNode("b")];
        const edges = [
            { from: "root", to: "a" },
            { from: "a", to: "b" },
            { from: "b", to: "a" },
        ];
        expect(propagateStale(nodes, edges, "root", 2)).toEqual(["a", "b"]);
    });
});

describe("approveNode", () => {
    it("review 转 approved 且不传播", () => {
        const result = approveNode(output({ status: "review" }));
        expect(result.next.status).toBe("approved");
        expect(result.propagate).toBe(false);
    });

    it("非 review 状态抛错", () => {
        expect(() => approveNode(output({ status: "approved" }))).toThrow("非法状态迁移");
    });
});

describe("saveEditedNode", () => {
    it("approved 保存后版本加一、保持 approved 且传播", () => {
        const result = saveEditedNode(output({ status: "approved", version: 4 }));
        expect(result.next).toMatchObject({ status: "approved", version: 5 });
        expect(result.propagate).toBe(true);
    });

    it("非 approved 状态抛错", () => {
        expect(() => saveEditedNode(output({ status: "review" }))).toThrow("非法状态迁移");
    });
});

describe("rollbackToVersion", () => {
    it("使用历史 payload、版本加一、落 approved 且传播", () => {
        const current = output({ status: "failed", version: 7, payload: { text: "当前版" } });
        const historical = output({ version: 2, payload: { text: "历史版", imageKeys: ["image-old"] } });
        const result = rollbackToVersion(current, historical);
        expect(result.next.payload).toEqual(historical.payload);
        expect(result.next.payload).not.toBe(historical.payload);
        expect(result.next).toMatchObject({ version: 8, status: "approved" });
        expect(result.propagate).toBe(true);
    });
});

describe("生成状态迁移", () => {
    it("nextStatusOnGenerate 支持所有合法来源状态", () => {
        for (const status of ["empty", "failed", "stale", "approved", "review"] as const) {
            expect(nextStatusOnGenerate(status)).toBe("generating");
        }
    });

    // 选修环节(P0 创意)默认落 skipped,用户手动点生成必须能启用它,否则功能不可达。
    // 「一键跑全链不碰 skipped」由 cascadeOrder 过滤保证,不由本迁移守卫,见下方 cascadeOrder 用例。
    it("nextStatusOnGenerate 允许手动生成 skipped 的选修节点", () => {
        expect(nextStatusOnGenerate("skipped")).toBe("generating");
    });

    it("nextStatusOnGenerate 遇到非法来源状态时抛错", () => {
        expect(() => nextStatusOnGenerate("generating")).toThrow("非法状态迁移");
    });

    it("onGenerateSuccess 将 generating 转为 review", () => {
        expect(onGenerateSuccess("generating")).toBe("review");
    });

    it("onGenerateSuccess 遇到非法来源状态时抛错", () => {
        expect(() => onGenerateSuccess("empty")).toThrow("非法状态迁移");
    });

    it("onGenerateFailure 将 generating 转为 failed", () => {
        expect(onGenerateFailure("generating")).toBe("failed");
    });

    it("onGenerateFailure 遇到非法来源状态时抛错", () => {
        expect(() => onGenerateFailure("review")).toThrow("非法状态迁移");
    });
});

describe("cascadeOrder", () => {
    it("菱形图返回拓扑序", () => {
        const nodes = [graphNode("root"), graphNode("a"), graphNode("b"), graphNode("c")];
        const edges = [
            { from: "root", to: "a" },
            { from: "root", to: "b" },
            { from: "a", to: "c" },
            { from: "b", to: "c" },
        ];
        expect(cascadeOrder(nodes, edges, "root")).toEqual(["root", "a", "b", "c"]);
    });

    it("skipped 节点不出现但其下游仍出现", () => {
        const nodes = [graphNode("root"), graphNode("skipped", "skipped"), graphNode("child")];
        const edges = [
            { from: "root", to: "skipped" },
            { from: "skipped", to: "child" },
        ];
        expect(cascadeOrder(nodes, edges, "root")).toEqual(["root", "child"]);
    });

    // 不变量:即便 skipped 已进入可生成状态集合(手动可生成),一键跑全链仍不得执行它——两条路径各管各的。
    it("skipped 节点即使是级联根也不被执行", () => {
        const nodes = [graphNode("skipped", "skipped"), graphNode("child")];
        expect(cascadeOrder(nodes, [{ from: "skipped", to: "child" }], "skipped")).toEqual(["child"]);
    });

    it("存在环时抛错", () => {
        const nodes = [graphNode("root"), graphNode("a")];
        const edges = [
            { from: "root", to: "a" },
            { from: "a", to: "root" },
        ];
        expect(() => cascadeOrder(nodes, edges, "root")).toThrow("存在环");
    });

    it("根节点不存在时返回空数组", () => {
        expect(cascadeOrder([graphNode("a")], [], "missing")).toEqual([]);
    });
});

describe("failurePolicy", () => {
    it("失败节点下游全部 halted，上游与并行分支 unaffected", () => {
        const nodes = [
            graphNode("root"),
            graphNode("failed", "failed"),
            graphNode("downstream"),
            graphNode("deep"),
            graphNode("parallel"),
            graphNode("parallel-child"),
        ];
        const edges = [
            { from: "root", to: "failed" },
            { from: "failed", to: "downstream" },
            { from: "downstream", to: "deep" },
            { from: "root", to: "parallel" },
            { from: "parallel", to: "parallel-child" },
        ];
        expect(failurePolicy(nodes, edges, "failed")).toEqual({
            haltedBranch: ["downstream", "deep"],
            unaffected: ["root", "parallel", "parallel-child"],
        });
    });
});
