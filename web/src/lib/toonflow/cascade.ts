/**
 * Cascade execution:
 *
 * root -> topological order -> [first image] -> text-to-image gate
 *                           \-> [first video] -> image-to-video gate
 * node failure -> failurePolicy -> halted branch -> skip descendants
 */

import type { ToonflowNodeKind } from "../../types/canvas";
import { cascadeOrder, failurePolicy, type GraphNode } from "./state-machine";

/** 由 project.tsx 把现有 handleGenerateNode 包装后注入。 */
export type CascadeExecutor = (nodeId: string) => Promise<{ ok: boolean; error?: string }>;

export type CostBoundary = "text-to-image" | "image-to-video";

export const TEXT_KINDS = [
    "project",
    "creative",
    "script",
    "space-contract",
    "continuity-table",
    "directing-lock",
    "storyboard-table",
    "shot-contract",
    "action-contract",
    "compliance",
    "seam-check",
    "audio-mix",
    "export",
] as const satisfies readonly ToonflowNodeKind[];

export const IMAGE_KINDS = ["assets", "storyboard-page", "keyframes"] as const satisfies readonly ToonflowNodeKind[];

export const VIDEO_KINDS = ["video-workbench"] as const satisfies readonly ToonflowNodeKind[];

const IMAGE_KIND_SET: ReadonlySet<ToonflowNodeKind> = new Set(IMAGE_KINDS);
const VIDEO_KIND_SET: ReadonlySet<ToonflowNodeKind> = new Set(VIDEO_KINDS);

export async function runCascade(args: {
    nodes: GraphNode[];
    edges: { from: string; to: string }[];
    rootId: string;
    kinds: Record<string, ToonflowNodeKind>;
    executor: CascadeExecutor;
    isCancelled: () => boolean;
    confirmCostGate: (boundary: CostBoundary, nodeIds: string[]) => Promise<boolean>;
    onNodeStart?: (nodeId: string) => void;
    onNodeDone?: (nodeId: string) => void;
    onNodeFailed?: (nodeId: string) => void;
}): Promise<{ completed: string[]; failed: string[]; skippedByHalt: string[]; cancelled: boolean }> {
    const order = cascadeOrder(args.nodes, args.edges, args.rootId);
    const imageNodeIds = order.filter((nodeId) => IMAGE_KIND_SET.has(args.kinds[nodeId]));
    const videoNodeIds = order.filter((nodeId) => VIDEO_KIND_SET.has(args.kinds[nodeId]));
    const completed: string[] = [];
    const failed: string[] = [];
    const skippedByHalt: string[] = [];
    const haltedNodeIds = new Set<string>();
    let imageGateConfirmed = false;
    let videoGateConfirmed = false;

    for (const nodeId of order) {
        if (haltedNodeIds.has(nodeId)) {
            skippedByHalt.push(nodeId);
            continue;
        }

        if (args.isCancelled()) {
            return { completed, failed, skippedByHalt, cancelled: true };
        }

        const kind = args.kinds[nodeId];
        if (IMAGE_KIND_SET.has(kind) && !imageGateConfirmed) {
            imageGateConfirmed = true;
            if (!(await args.confirmCostGate("text-to-image", imageNodeIds))) {
                return { completed, failed, skippedByHalt, cancelled: true };
            }
        }
        if (VIDEO_KIND_SET.has(kind) && !videoGateConfirmed) {
            videoGateConfirmed = true;
            if (!(await args.confirmCostGate("image-to-video", videoNodeIds))) {
                return { completed, failed, skippedByHalt, cancelled: true };
            }
        }

        args.onNodeStart?.(nodeId);
        const result = await args.executor(nodeId);

        if (result.ok) {
            args.onNodeDone?.(nodeId);
            completed.push(nodeId);
            continue;
        }

        args.onNodeFailed?.(nodeId);
        failed.push(nodeId);
        const { haltedBranch } = failurePolicy(args.nodes, args.edges, nodeId);
        for (const haltedNodeId of haltedBranch) {
            haltedNodeIds.add(haltedNodeId);
        }
    }

    return { completed, failed, skippedByHalt, cancelled: false };
}
