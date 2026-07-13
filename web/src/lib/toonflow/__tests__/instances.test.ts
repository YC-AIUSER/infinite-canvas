import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ToonflowNodeKind } from "../../../types/canvas";
import { applyInstanceSync, deleteArchivedInstance, planInstanceSync, resolveConfirmedSync } from "../instances";
import type { NodeOutput, StoryboardRow } from "../schema";

function row(segmentId: string, shotNo: number): StoryboardRow {
    return {
        segmentId,
        shotId: `${segmentId}-shot-${shotNo}`,
        shotNo,
        scale: "中景",
        angle: "平视",
        action: "动作",
        line: "台词",
        sfx: "",
        mood: "平静",
        durationSec: 6,
    };
}

function output(nodeId: string, kind: ToonflowNodeKind, status: NodeOutput["status"] = "approved", payload: NodeOutput["payload"] = {}): NodeOutput {
    return {
        nodeId,
        kind,
        version: 1,
        status,
        payload,
        upstreamVersions: {},
        generatedAt: "2026-07-12T00:00:00.000Z",
    };
}

function root(id: string, kind: "storyboard-page" | "keyframes" | "video-workbench", x: number): CanvasNodeData {
    return {
        id,
        type: kind === "video-workbench" ? CanvasNodeType.Video : CanvasNodeType.Image,
        title: kind === "storyboard-page" ? "故事板页" : kind === "keyframes" ? "分镜图 / 首帧" : "视频工作台",
        position: { x, y: 100 },
        width: 320,
        height: 190,
        metadata: {
            toonflow: {
                kind,
                stage: kind === "storyboard-page" ? "黑白预演" : kind === "keyframes" ? "视觉首帧" : "视频生成",
                status: "empty",
                summary: "摘要",
                checks: ["检查"],
                accent: "#123456",
            },
        },
    };
}

function storyboard(rows: StoryboardRow[]): CanvasNodeData {
    return {
        id: "storyboard",
        type: CanvasNodeType.Text,
        title: "分镜表",
        position: { x: 0, y: 0 },
        width: 320,
        height: 190,
        metadata: {
            toonflow: {
                kind: "storyboard-table",
                stage: "镜头规划",
                status: "approved",
                summary: "摘要",
                checks: ["检查"],
                output: output("storyboard", "storyboard-table", "approved", { table: rows }),
            },
        },
    };
}

function template(rows: StoryboardRow[]) {
    return [storyboard(rows), root("storyboard-root", "storyboard-page", 500), root("keyframes-root", "keyframes", 900), root("video-root", "video-workbench", 1300)];
}

function idFactory() {
    let value = 0;
    return () => `id-${++value}`;
}

function sync(nodes: CanvasNodeData[], connections: CanvasConnection[] = []) {
    const plan = planInstanceSync(nodes, "storyboard");
    expect(plan).not.toBeNull();
    return applyInstanceSync(nodes, connections, plan!, idFactory());
}

describe("Toonflow segment instances", () => {
    it("首次同步为每段创建三类实例、链式配对并写入三个根的 batchChildIds", () => {
        const result = sync(template([row("seg-a", 1), row("seg-a", 2), row("seg-b", 1)]));
        const instances = result.nodes.filter((node) => node.metadata?.toonflow?.segmentId);

        expect(instances).toHaveLength(6);
        expect(instances.map((node) => [node.metadata?.toonflow?.segmentId, node.metadata?.toonflow?.kind])).toEqual([
            ["seg-a", "storyboard-page"],
            ["seg-a", "keyframes"],
            ["seg-a", "video-workbench"],
            ["seg-b", "storyboard-page"],
            ["seg-b", "keyframes"],
            ["seg-b", "video-workbench"],
        ]);
        expect(result.nodes.find((node) => node.id === "storyboard-root")?.metadata?.batchChildIds).toEqual(["id-1", "id-4"]);
        expect(result.nodes.find((node) => node.id === "keyframes-root")?.metadata?.batchChildIds).toEqual(["id-2", "id-5"]);
        expect(result.nodes.find((node) => node.id === "video-root")?.metadata?.batchChildIds).toEqual(["id-3", "id-6"]);
        expect(result.connections.map((connection) => [connection.fromNodeId, connection.toNodeId])).toEqual([
            ["storyboard-root", "id-1"],
            ["storyboard-root", "id-4"],
            ["keyframes-root", "id-2"],
            ["keyframes-root", "id-5"],
            ["video-root", "id-3"],
            ["video-root", "id-6"],
            ["id-1", "id-2"],
            ["id-2", "id-3"],
            ["id-4", "id-5"],
            ["id-5", "id-6"],
        ]);
        expect(instances[0].position).toEqual({ x: 500, y: 350 });
        expect(instances[3].position).toEqual({ x: 856, y: 350 });
    });

    it("再次同步仅把有产出的保留实例置 stale，empty 实例不动", () => {
        const first = sync(template([row("seg-a", 1)]));
        const nodes = first.nodes.map((node) => {
            const toonflow = node.metadata?.toonflow;
            if (toonflow?.segmentId === "seg-a" && toonflow.kind === "storyboard-page") {
                return { ...node, metadata: { ...node.metadata, toonflow: { ...toonflow, status: "approved" as const, output: output(node.id, toonflow.kind) } } };
            }
            return node;
        });
        const plan = planInstanceSync(nodes, "storyboard")!;
        const result = applyInstanceSync(nodes, first.connections, plan, idFactory());
        const storyboardInstance = result.nodes.find((node) => node.metadata?.toonflow?.kind === "storyboard-page" && node.metadata.toonflow.segmentId);
        const keyframesInstance = result.nodes.find((node) => node.metadata?.toonflow?.kind === "keyframes" && node.metadata.toonflow.segmentId);

        expect(plan.toCreate).toEqual([]);
        expect(plan.toStale).toEqual([storyboardInstance?.id]);
        expect(storyboardInstance?.metadata?.toonflow?.status).toBe("stale");
        expect(storyboardInstance?.metadata?.toonflow?.output?.status).toBe("stale");
        expect(keyframesInstance?.metadata?.toonflow?.status).toBe("empty");
    });

    it("新增段时只创建新增段的三类实例", () => {
        const first = sync(template([row("seg-a", 1)]));
        const nodes = first.nodes.map((node) => (node.id === "storyboard" ? storyboard([row("seg-a", 1), row("seg-b", 1)]) : node));
        const plan = planInstanceSync(nodes, "storyboard")!;
        const result = applyInstanceSync(nodes, first.connections, plan, idFactory());

        expect(plan.toCreate).toEqual([
            { segmentId: "seg-b", segmentIndex: 1, kind: "storyboard-page" },
            { segmentId: "seg-b", segmentIndex: 1, kind: "keyframes" },
            { segmentId: "seg-b", segmentIndex: 1, kind: "video-workbench" },
        ]);
        expect(result.nodes.filter((node) => node.metadata?.toonflow?.segmentId === "seg-b")).toHaveLength(3);
        expect(result.nodes.filter((node) => node.metadata?.toonflow?.segmentId)).toHaveLength(6);
    });

    it("消失段会归档、断开全部连线并从根 batchChildIds 剔除", () => {
        const first = sync(template([row("seg-a", 1), row("seg-b", 1)]));
        const segBIds = first.nodes.filter((node) => node.metadata?.toonflow?.segmentId === "seg-b").map((node) => node.id);
        const nodes = first.nodes.map((node) => (node.id === "storyboard" ? storyboard([row("seg-a", 1)]) : node));
        const plan = planInstanceSync(nodes, "storyboard")!;
        const result = applyInstanceSync(nodes, first.connections, plan, idFactory());

        expect(new Set(plan.toArchive)).toEqual(new Set(segBIds));
        expect(result.nodes.filter((node) => segBIds.includes(node.id)).every((node) => node.metadata?.toonflow?.archived)).toBe(true);
        expect(result.connections.some((connection) => segBIds.includes(connection.fromNodeId) || segBIds.includes(connection.toNodeId))).toBe(false);
        expect(result.nodes.find((node) => node.id === "storyboard-root")?.metadata?.batchChildIds).not.toContain(segBIds[0]);
        expect(result.nodes.find((node) => node.id === "keyframes-root")?.metadata?.batchChildIds).not.toContain(segBIds[1]);
        expect(result.nodes.find((node) => node.id === "video-root")?.metadata?.batchChildIds).not.toContain(segBIds[2]);
    });

    it("已归档实例不参与后续差分并会为重新出现的段新建实例", () => {
        const first = sync(template([row("seg-a", 1)]));
        const removedNodes = first.nodes.map((node) => (node.id === "storyboard" ? storyboard([]) : node));
        const archived = applyInstanceSync(removedNodes, first.connections, planInstanceSync(removedNodes, "storyboard")!, idFactory());
        const returnedNodes = archived.nodes.map((node) => (node.id === "storyboard" ? storyboard([row("seg-a", 1)]) : node));
        const plan = planInstanceSync(returnedNodes, "storyboard")!;

        expect(plan.isFirstSync).toBe(false);
        expect(plan.toArchive).toEqual([]);
        expect(plan.toCreate).toHaveLength(3);
        expect(plan.toCreate.every((item) => item.segmentId === "seg-a")).toBe(true);
    });

    it("段顺序变化会更新实例 segmentIndex 与根节点排序", () => {
        const first = sync(template([row("seg-a", 1), row("seg-b", 1)]));
        const nodes = first.nodes.map((node) => (node.id === "storyboard" ? storyboard([row("seg-b", 1), row("seg-a", 1)]) : node));
        const plan = planInstanceSync(nodes, "storyboard")!;
        const result = applyInstanceSync(nodes, first.connections, plan, idFactory());
        const segA = result.nodes.filter((node) => node.metadata?.toonflow?.segmentId === "seg-a");
        const segB = result.nodes.filter((node) => node.metadata?.toonflow?.segmentId === "seg-b");

        expect(plan.reindex).toHaveLength(6);
        expect(segA.every((node) => node.metadata?.toonflow?.segmentIndex === 1)).toBe(true);
        expect(segB.every((node) => node.metadata?.toonflow?.segmentIndex === 0)).toBe(true);
        expect(result.nodes.find((node) => node.id === "storyboard-root")?.metadata?.batchChildIds).toEqual(["id-4", "id-1"]);
        expect(result.nodes.find((node) => node.id === "video-root")?.metadata?.batchChildIds).toEqual(["id-6", "id-3"]);
        expect(segA.every((node) => node.title.endsWith("段2"))).toBe(true);
    });

    it("删除归档实例会收集 output 与 history 媒体键并清除节点连线", () => {
        const archivedNode: CanvasNodeData = {
            ...root("archived", "storyboard-page", 0),
            metadata: {
                batchRootId: "storyboard-root",
                toonflow: {
                    ...root("archived", "storyboard-page", 0).metadata!.toonflow!,
                    segmentId: "seg-a",
                    segmentIndex: 0,
                    archived: true,
                    output: output("archived", "storyboard-page", "approved", { imageKeys: ["image-a"], videoKeys: ["video-a"] }),
                    history: [output("archived", "storyboard-page", "approved", { imageKeys: ["image-b", "image-a"], audioKeys: ["audio-a"] })],
                },
            },
        };
        const rootNode = { ...root("storyboard-root", "storyboard-page", 0), metadata: { ...root("storyboard-root", "storyboard-page", 0).metadata, batchChildIds: ["archived"] } };
        const result = deleteArchivedInstance([rootNode, archivedNode], [{ id: "line", fromNodeId: "storyboard-root", toNodeId: "archived" }], "archived");

        expect(new Set(result.mediaKeys)).toEqual(new Set(["image-a", "image-b", "video-a", "audio-a"]));
        expect(result.nodes.some((node) => node.id === "archived")).toBe(false);
        expect(result.nodes[0].metadata?.batchChildIds).toEqual([]);
        expect(result.connections).toEqual([]);
    });

    it("三个模板根缺一时不生成同步计划", () => {
        const nodes = [storyboard([row("seg-a", 1)]), root("storyboard-root", "storyboard-page", 500), root("keyframes-root", "keyframes", 900)];
        expect(planInstanceSync(nodes, "storyboard")).toBeNull();
    });

    it("确认时状态未变则按用户所见应用同一计划", () => {
        const first = sync(template([row("seg-a", 1)]));
        const changed = first.nodes.map((node) => (node.id === "storyboard" ? storyboard([row("seg-a", 1), row("seg-b", 1)]) : node));
        const confirmed = planInstanceSync(changed, "storyboard")!;
        const fresh = planInstanceSync(changed, "storyboard")!;

        expect(resolveConfirmedSync(confirmed, fresh)).toEqual({ action: "apply", plan: fresh });
    });

    it("确认时分镜表已再次变化则用最新计划重新弹窗而非套旧计划", () => {
        const first = sync(template([row("seg-a", 1)]));
        const changed = first.nodes.map((node) => (node.id === "storyboard" ? storyboard([row("seg-a", 1), row("seg-b", 1)]) : node));
        const confirmed = planInstanceSync(changed, "storyboard")!;
        const changedAgain = first.nodes.map((node) => (node.id === "storyboard" ? storyboard([row("seg-a", 1), row("seg-b", 1), row("seg-c", 1)]) : node));
        const fresh = planInstanceSync(changedAgain, "storyboard")!;

        expect(fresh.toCreate.map((item) => item.segmentId)).toContain("seg-c");
        expect(resolveConfirmedSync(confirmed, fresh)).toEqual({ action: "represent", plan: fresh });
    });

    it("确认时改动已被应用则关闭弹窗不重复建实例", () => {
        const first = sync(template([row("seg-a", 1)]));
        const changed = first.nodes.map((node) => (node.id === "storyboard" ? storyboard([row("seg-a", 1), row("seg-b", 1)]) : node));
        const confirmed = planInstanceSync(changed, "storyboard")!;
        const applied = applyInstanceSync(changed, first.connections, confirmed, idFactory());
        const fresh = planInstanceSync(applied.nodes, "storyboard");

        expect(resolveConfirmedSync(confirmed, fresh)).toEqual({ action: "dismiss" });
    });
});
