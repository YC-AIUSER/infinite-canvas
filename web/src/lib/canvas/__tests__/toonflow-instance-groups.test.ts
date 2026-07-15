import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasNodeData, type ToonflowNodeKind } from "../../../types/canvas";
import { instanceGroupId, isInstanceGroupNode, reconcileInstanceGroups } from "../toonflow-instance-groups";

function root(id: string, kind: ToonflowNodeKind, x = 0, y = 0): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Video,
        title: "视频工作台",
        position: { x, y },
        width: 300,
        height: 180,
        metadata: { toonflow: { kind, stage: "s", status: "empty", summary: "", checks: [] } },
    };
}

function instance(id: string, kind: ToonflowNodeKind, segmentId: string, x: number, y: number, archived = false): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Video,
        title: `${kind}·段`,
        position: { x, y },
        width: 300,
        height: 180,
        metadata: { batchRootId: `root-${kind}`, toonflow: { kind, stage: "s", status: "empty", summary: "", checks: [], segmentId, segmentIndex: 0, archived } },
    };
}

describe("reconcileInstanceGroups", () => {
    it("为有活跃实例的环节建一个 Group,root+实例都设 groupId", () => {
        const out = reconcileInstanceGroups([root("root-video-workbench", "video-workbench", 0, 0), instance("v1", "video-workbench", "seg1", 0, 240)]);
        const gid = instanceGroupId("root-video-workbench");
        const group = out.find((node) => node.id === gid);

        expect(group?.type).toBe(CanvasNodeType.Group);
        expect(group?.metadata?.projectionOf).toEqual({ stageNodeId: "root-video-workbench", kind: "video-workbench" });
        expect(out.find((node) => node.id === "root-video-workbench")?.metadata?.groupId).toBe(gid);
        expect(out.find((node) => node.id === "v1")?.metadata?.groupId).toBe(gid);
        expect(out.find((node) => node.id === "v1")?.metadata?.batchRootId).toBeUndefined();
    });

    it("Group 是成员当前位置的包围盒(含 root 与实例)", () => {
        const out = reconcileInstanceGroups([root("r", "keyframes", 100, 100), instance("k1", "keyframes", "seg1", 100, 400)]);
        const group = out.find((node) => node.id === instanceGroupId("r"))!;

        expect(group.position.x).toBeLessThanOrEqual(100);
        expect(group.position.y).toBeLessThanOrEqual(100);
        expect(group.position.x + group.width).toBeGreaterThanOrEqual(400);
        expect(group.position.y + group.height).toBeGreaterThanOrEqual(580);
    });

    it("Group 容器不带 toonflow", () => {
        const out = reconcileInstanceGroups([root("r", "keyframes"), instance("k1", "keyframes", "seg1", 0, 240)]);

        expect(out.find(isInstanceGroupNode)?.metadata?.toonflow).toBeUndefined();
    });

    it("无活跃实例(只有 root)不建组", () => {
        const out = reconcileInstanceGroups([root("r", "keyframes")]);

        expect(out.find(isInstanceGroupNode)).toBeUndefined();
        expect(out.find((node) => node.id === "r")?.metadata?.groupId).toBeUndefined();
    });

    it("归档实例移出组(不算成员)", () => {
        const out = reconcileInstanceGroups([root("r", "keyframes"), instance("k1", "keyframes", "seg1", 0, 240), instance("k2", "keyframes", "seg2", 320, 240, true)]);

        expect(out.find((node) => node.id === "k1")?.metadata?.groupId).toBe(instanceGroupId("r"));
        expect(out.find((node) => node.id === "k2")?.metadata?.groupId).toBeUndefined();
    });

    it("幂等:连跑两次结构一致、成员位置不变", () => {
        const once = reconcileInstanceGroups([root("r", "keyframes", 5, 5), instance("k1", "keyframes", "seg1", 5, 300)]);
        const twice = reconcileInstanceGroups(once);

        expect(twice.map((node) => node.id).sort()).toEqual(once.map((node) => node.id).sort());
        expect(twice.find((node) => node.id === "k1")?.position).toEqual({ x: 5, y: 300 });
    });

    it("root 消失后残留组被清、成员 groupId 清除", () => {
        const first = reconcileInstanceGroups([root("r", "keyframes"), instance("k1", "keyframes", "seg1", 0, 240)]);
        const out = reconcileInstanceGroups(first.filter((node) => node.id === "k1"));

        expect(out.find(isInstanceGroupNode)).toBeUndefined();
        expect(out.find((node) => node.id === "k1")?.metadata?.groupId).toBeUndefined();
    });

    it("不碰图片批量节点(isBatchRoot 与其 groupId 无关字段保持)", () => {
        const batchRoot: CanvasNodeData = {
            id: "img",
            type: CanvasNodeType.Image,
            title: "图",
            position: { x: 0, y: 0 },
            width: 100,
            height: 100,
            metadata: { isBatchRoot: true, batchChildIds: ["c1"] },
        };
        const out = reconcileInstanceGroups([batchRoot, root("r", "keyframes"), instance("k1", "keyframes", "seg1", 0, 240)]);
        const image = out.find((node) => node.id === "img");

        expect(image?.metadata?.isBatchRoot).toBe(true);
        expect(image?.metadata?.batchChildIds).toEqual(["c1"]);
        expect(image?.metadata?.groupId).toBeUndefined();
    });

    it("段实例被拖入外来组(groupId 被改)后,reconcile 重新归回其实例组", () => {
        const nodes = [root("r", "keyframes"), instance("k1", "keyframes", "seg1", 0, 240)];
        const grouped = reconcileInstanceGroups(nodes);
        // 模拟"段实例拖进普通 Group":其 groupId 被 snap 改成外来组 id
        const dragged = grouped.map((node) => (node.id === "k1" ? { ...node, metadata: { ...node.metadata, groupId: "some-normal-group" } } : node));
        const out = reconcileInstanceGroups(dragged);
        // 成员身份由 toonflow 决定,权威地归回其实例组,不被外来 groupId 带走
        expect(out.find((node) => node.id === "k1")?.metadata?.groupId).toBe(instanceGroupId("r"));
    });
});
