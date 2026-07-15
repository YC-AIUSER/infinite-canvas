import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ToonflowNodeKind } from "../../../types/canvas";
import { applyInstanceSync, planInstanceSync } from "../../toonflow/instances";
import { buildTextCascadeGraph, collectExportSegments } from "../../toonflow/node-runtime";
import type { StoryboardRow } from "../../toonflow/schema";
import { reconcileInstanceGroups } from "../toonflow-instance-groups";

const table: StoryboardRow[] = [
    { segmentId: "seg1", shotId: "s1", shotNo: 1, scale: "", angle: "", action: "", line: "", sfx: "", mood: "", durationSec: 5 },
    { segmentId: "seg2", shotId: "s2", shotNo: 1, scale: "", angle: "", action: "", line: "", sfx: "", mood: "", durationSec: 5 },
];

function stageNode(id: string, kind: ToonflowNodeKind, y: number): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Video,
        title: id,
        position: { x: 0, y },
        width: 300,
        height: 180,
        metadata: { toonflow: { kind, stage: "s", status: "empty", summary: "", checks: [] } },
    };
}

function buildBaseGraph(): { nodes: CanvasNodeData[]; connections: CanvasConnection[] } {
    const storyboardTable: CanvasNodeData = {
        id: "table",
        type: CanvasNodeType.Text,
        title: "分镜表",
        position: { x: 0, y: 0 },
        width: 300,
        height: 180,
        metadata: {
            toonflow: {
                kind: "storyboard-table",
                stage: "s",
                status: "approved",
                summary: "",
                checks: [],
                output: { nodeId: "table", kind: "storyboard-table", version: 1, status: "approved", payload: { table }, upstreamVersions: {}, generatedAt: "2026-07-15T00:00:00.000Z" },
            },
        },
    };
    return {
        nodes: [storyboardTable, stageNode("root-sp", "storyboard-page", 300), stageNode("root-kf", "keyframes", 500), stageNode("root-vw", "video-workbench", 700)],
        connections: [],
    };
}

function withStoryboardTable(nodes: CanvasNodeData[], nextTable: StoryboardRow[]) {
    return nodes.map((node) =>
        node.id === "table"
            ? { ...node, metadata: { ...node.metadata, toonflow: { ...node.metadata!.toonflow!, output: { ...node.metadata!.toonflow!.output!, payload: { table: nextTable } } } } }
            : node,
    );
}

describe("段实例组化 · 隔离守卫", () => {
    it("reconcile 前后 planInstanceSync、导出与文本级联图不变", () => {
        const { nodes, connections } = buildBaseGraph();
        let id = 0;
        const synced = applyInstanceSync(nodes, connections, planInstanceSync(nodes, "table")!, () => `gen-${id++}`);
        const grouped = reconcileInstanceGroups(synced.nodes);

        expect(planInstanceSync(grouped, "table")).toEqual(planInstanceSync(synced.nodes, "table"));
        expect(collectExportSegments(grouped)).toEqual(collectExportSegments(synced.nodes));
        expect(buildTextCascadeGraph(grouped, synced.connections)).toEqual(buildTextCascadeGraph(synced.nodes, synced.connections));
    });

    it("段实例 root 不再带 batch 呈现标记，创建、归档、重排与连线保持", () => {
        const { nodes, connections } = buildBaseGraph();
        let id = 0;
        const firstPlan = planInstanceSync(nodes, "table")!;
        const synced = applyInstanceSync(nodes, connections, firstPlan, () => `gen-${id++}`);
        const roots = synced.nodes.filter((node) => ["storyboard-page", "keyframes", "video-workbench"].includes(node.metadata?.toonflow?.kind as string) && !node.metadata?.toonflow?.segmentId);

        expect(firstPlan.toCreate).toHaveLength(6);
        expect(synced.connections).toHaveLength(10);
        for (const root of roots) {
            expect(root.metadata?.isBatchRoot).toBeUndefined();
            expect(root.metadata?.batchChildIds).toBeUndefined();
            expect(root.metadata?.imageBatchExpanded).toBeUndefined();
        }

        const reorderedNodes = withStoryboardTable(synced.nodes, [table[1], table[0]]);
        const reindexPlan = planInstanceSync(reorderedNodes, "table")!;
        const reordered = applyInstanceSync(reorderedNodes, synced.connections, reindexPlan, () => `gen-${id++}`);
        expect(reindexPlan.reindex).toHaveLength(6);
        expect(reordered.connections).toHaveLength(synced.connections.length);

        const archivedNodes = withStoryboardTable(reordered.nodes, [table[0]]);
        const archivePlan = planInstanceSync(archivedNodes, "table")!;
        const archived = applyInstanceSync(archivedNodes, reordered.connections, archivePlan, () => `gen-${id++}`);
        expect(archivePlan.toArchive).toHaveLength(3);
        expect(archived.connections).toHaveLength(5);
        expect(archived.nodes.filter((node) => node.metadata?.toonflow?.archived)).toHaveLength(3);
    });

    it("图片批量节点不受 reconcile 影响", () => {
        const { nodes } = buildBaseGraph();
        const imageBatch: CanvasNodeData = {
            id: "image-batch",
            type: CanvasNodeType.Image,
            title: "图片批量",
            position: { x: 900, y: 0 },
            width: 100,
            height: 100,
            metadata: { isBatchRoot: true, batchChildIds: ["image-child"], imageBatchExpanded: false },
        };
        const imageChild: CanvasNodeData = {
            id: "image-child",
            type: CanvasNodeType.Image,
            title: "图片子项",
            position: { x: 1020, y: 0 },
            width: 100,
            height: 100,
            metadata: { batchRootId: "image-batch" },
        };
        const out = reconcileInstanceGroups([imageBatch, imageChild, ...nodes]);

        expect(out.find((node) => node.id === "image-batch")).toEqual(imageBatch);
        expect(out.find((node) => node.id === "image-child")).toEqual(imageChild);
    });
});
