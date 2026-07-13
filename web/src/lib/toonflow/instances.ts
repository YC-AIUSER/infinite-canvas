import type { CanvasConnection, CanvasNodeData, ToonflowNodeKind } from "../../types/canvas";
import { diffSegments, groupRowsBySegment, reconcileInstances, type SegmentInstance, type SegmentPlan } from "./segments";

const INSTANCE_KINDS = ["storyboard-page", "keyframes", "video-workbench"] as const;

type InstanceKind = (typeof INSTANCE_KINDS)[number];

export type InstanceSyncPlan = {
    storyboardNodeId: string;
    segments: Array<{ segmentId: string; segmentIndex: number; shotCount: number }>;
    toCreate: Array<{ segmentId: string; segmentIndex: number; kind: "storyboard-page" | "keyframes" | "video-workbench" }>;
    toStale: string[];
    toArchive: string[];
    reindex: Array<{ nodeId: string; segmentIndex: number }>;
    isFirstSync: boolean;
};

function isInstanceKind(kind: ToonflowNodeKind): kind is InstanceKind {
    return INSTANCE_KINDS.includes(kind as InstanceKind);
}

function findRoot(nodes: CanvasNodeData[], kind: InstanceKind) {
    return nodes.find((node) => node.metadata?.toonflow?.kind === kind && !node.metadata.toonflow.segmentId && !node.metadata.batchRootId);
}

function activeInstances(nodes: CanvasNodeData[]) {
    return nodes.filter((node) => {
        const toonflow = node.metadata?.toonflow;
        return Boolean(toonflow && isInstanceKind(toonflow.kind) && toonflow.segmentId && !toonflow.archived);
    });
}

function segmentInstances(nodes: CanvasNodeData[]): SegmentInstance[] {
    const bySegment = new Map<string, SegmentInstance>();
    for (const node of nodes) {
        const toonflow = node.metadata?.toonflow;
        if (!toonflow?.segmentId || !isInstanceKind(toonflow.kind)) continue;
        const instance = bySegment.get(toonflow.segmentId) ?? { segmentId: toonflow.segmentId, nodeIds: {} };
        if (toonflow.kind === "storyboard-page") instance.nodeIds.storyboardPage = node.id;
        if (toonflow.kind === "keyframes") instance.nodeIds.keyframes = node.id;
        if (toonflow.kind === "video-workbench") instance.nodeIds.video = node.id;
        bySegment.set(toonflow.segmentId, instance);
    }
    return [...bySegment.values()];
}

export function planInstanceSync(nodes: CanvasNodeData[], storyboardNodeId: string): InstanceSyncPlan | null {
    const storyboard = nodes.find((node) => node.id === storyboardNodeId);
    const output = storyboard?.metadata?.toonflow?.output;
    const rows = output?.payload.table;
    if (storyboard?.metadata?.toonflow?.kind !== "storyboard-table" || storyboard.metadata.toonflow.status !== "approved" || output?.status !== "approved" || !rows) return null;

    if (!findRoot(nodes, "storyboard-page") || !findRoot(nodes, "keyframes") || !findRoot(nodes, "video-workbench")) return null;

    const groups = groupRowsBySegment(rows);
    const segments = [...groups].map(([segmentId, segmentRows], segmentIndex) => ({ segmentId, segmentIndex, shotCount: segmentRows.length }));
    const active = activeInstances(nodes);
    const oldSegments = new Map<string, SegmentPlan>();
    for (const node of active) {
        const toonflow = node.metadata!.toonflow!;
        if (!oldSegments.has(toonflow.segmentId!)) {
            oldSegments.set(toonflow.segmentId!, {
                segmentId: toonflow.segmentId!,
                segmentIndex: toonflow.segmentIndex ?? oldSegments.size,
                shotIds: [],
            });
        }
    }

    const diff = diffSegments([...oldSegments.values()], rows);
    const reconciled = reconcileInstances(diff, segmentInstances(active));
    const activeBySegmentKind = new Set(active.map((node) => `${node.metadata!.toonflow!.segmentId}:${node.metadata!.toonflow!.kind}`));
    const toCreate = segments.flatMap((segment) =>
        INSTANCE_KINDS.flatMap((kind) => (activeBySegmentKind.has(`${segment.segmentId}:${kind}`) ? [] : [{ segmentId: segment.segmentId, segmentIndex: segment.segmentIndex, kind }])),
    );
    const staleCandidates = new Set(reconciled.toStale);
    const toStale = active.flatMap((node) => {
        const toonflow = node.metadata!.toonflow!;
        return staleCandidates.has(node.id) && toonflow.output && ["review", "approved", "stale"].includes(toonflow.status) ? [node.id] : [];
    });
    const toArchive = reconciled.toArchive.flatMap((instance) => Object.values(instance.nodeIds).filter((nodeId): nodeId is string => Boolean(nodeId)));
    const nextIndexBySegment = new Map(segments.map((segment) => [segment.segmentId, segment.segmentIndex]));
    const reindex = active.flatMap((node) => {
        const toonflow = node.metadata!.toonflow!;
        const segmentIndex = nextIndexBySegment.get(toonflow.segmentId!);
        return segmentIndex !== undefined && segmentIndex !== toonflow.segmentIndex ? [{ nodeId: node.id, segmentIndex }] : [];
    });
    const hasAnyInstances = nodes.some((node) => {
        const toonflow = node.metadata?.toonflow;
        return Boolean(toonflow && isInstanceKind(toonflow.kind) && toonflow.segmentId);
    });

    return { storyboardNodeId, segments, toCreate, toStale, toArchive, reindex, isFirstSync: !hasAnyInstances };
}

function instanceTitle(root: CanvasNodeData, segmentIndex: number) {
    return `${root.title} · 段${segmentIndex + 1}`;
}

function createInstance(root: CanvasNodeData, segmentId: string, segmentIndex: number, id: string): CanvasNodeData {
    const toonflow = root.metadata!.toonflow!;
    return {
        id,
        type: root.type,
        title: instanceTitle(root, segmentIndex),
        position: {
            x: root.position.x + (segmentIndex % 2) * (root.width + 36),
            y: root.position.y + root.height + 60 + Math.floor(segmentIndex / 2) * (root.height + 48),
        },
        width: root.width,
        height: root.height,
        metadata: {
            batchRootId: root.id,
            toonflow: {
                kind: toonflow.kind,
                stage: toonflow.stage,
                summary: toonflow.summary,
                checks: toonflow.checks,
                accent: toonflow.accent,
                status: "empty",
                segmentId,
                segmentIndex,
            },
        },
    };
}

function appendConnection(connections: CanvasConnection[], fromNodeId: string, toNodeId: string, createId: () => string) {
    if (connections.some((connection) => connection.fromNodeId === fromNodeId && connection.toNodeId === toNodeId)) return connections;
    return [...connections, { id: createId(), fromNodeId, toNodeId }];
}

export function applyInstanceSync(
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    plan: InstanceSyncPlan,
    createId: () => string,
): { nodes: CanvasNodeData[]; connections: CanvasConnection[] } {
    const roots = new Map<InstanceKind, CanvasNodeData>();
    for (const kind of INSTANCE_KINDS) {
        const root = findRoot(nodes, kind);
        if (root) roots.set(kind, root);
    }
    if (roots.size !== INSTANCE_KINDS.length) return { nodes, connections };

    const staleIds = new Set(plan.toStale);
    const archiveIds = new Set(plan.toArchive);
    const reindexById = new Map(plan.reindex.map((item) => [item.nodeId, item.segmentIndex]));
    let nextNodes = nodes.map<CanvasNodeData>((node) => {
        const toonflow = node.metadata?.toonflow;
        if (!toonflow) return node;
        if (archiveIds.has(node.id)) {
            return { ...node, metadata: { ...node.metadata, toonflow: { ...toonflow, archived: true } } };
        }
        const segmentIndex = reindexById.get(node.id);
        const root = isInstanceKind(toonflow.kind) ? roots.get(toonflow.kind) : undefined;
        const stale = staleIds.has(node.id);
        if (segmentIndex === undefined && !stale) return node;
        return {
            ...node,
            title: segmentIndex !== undefined && root ? instanceTitle(root, segmentIndex) : node.title,
            metadata: {
                ...node.metadata,
                toonflow: {
                    ...toonflow,
                    segmentIndex: segmentIndex ?? toonflow.segmentIndex,
                    status: stale ? "stale" : toonflow.status,
                    output: stale && toonflow.output ? { ...toonflow.output, status: "stale" } : toonflow.output,
                },
            },
        };
    });

    for (const item of plan.toCreate) {
        const root = roots.get(item.kind)!;
        nextNodes.push(createInstance(root, item.segmentId, item.segmentIndex, createId()));
    }

    let nextConnections = connections.filter((connection) => !archiveIds.has(connection.fromNodeId) && !archiveIds.has(connection.toNodeId));
    const instances = activeInstances(nextNodes);
    for (const kind of INSTANCE_KINDS) {
        const root = roots.get(kind)!;
        for (const instance of instances) {
            if (instance.metadata!.toonflow!.kind === kind) nextConnections = appendConnection(nextConnections, root.id, instance.id, createId);
        }
    }

    const instancesBySegment = segmentInstances(instances);
    for (const instance of instancesBySegment) {
        if (instance.nodeIds.storyboardPage && instance.nodeIds.keyframes) {
            nextConnections = appendConnection(nextConnections, instance.nodeIds.storyboardPage, instance.nodeIds.keyframes, createId);
        }
        if (instance.nodeIds.keyframes && instance.nodeIds.video) {
            nextConnections = appendConnection(nextConnections, instance.nodeIds.keyframes, instance.nodeIds.video, createId);
        }
    }

    nextNodes = nextNodes.map<CanvasNodeData>((node) => {
        const rootKind = node.metadata?.toonflow?.kind;
        if (!rootKind || !isInstanceKind(rootKind) || roots.get(rootKind)?.id !== node.id) return node;
        const children = instances
            .filter((instance) => instance.metadata!.toonflow!.kind === rootKind)
            .sort((left, right) => left.metadata!.toonflow!.segmentIndex! - right.metadata!.toonflow!.segmentIndex!)
            .map((instance) => instance.id);
        const hadInstances = nodes.some((instance) => instance.metadata?.toonflow?.kind === rootKind && instance.metadata.toonflow.segmentId);
        return {
            ...node,
            metadata: {
                ...node.metadata,
                isBatchRoot: true,
                batchChildIds: children,
                imageBatchExpanded: !hadInstances && children.length ? (node.metadata?.imageBatchExpanded ?? true) : node.metadata?.imageBatchExpanded,
            },
        };
    });

    return { nodes: nextNodes, connections: nextConnections };
}

export function deleteArchivedInstance(
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
    nodeId: string,
): { nodes: CanvasNodeData[]; connections: CanvasConnection[]; mediaKeys: string[] } {
    const target = nodes.find((node) => node.id === nodeId);
    const toonflow = target?.metadata?.toonflow;
    if (!target || !toonflow?.segmentId || !toonflow.archived || !isInstanceKind(toonflow.kind)) return { nodes, connections, mediaKeys: [] };

    const mediaKeys = new Set<string>();
    for (const output of [toonflow.output, ...(toonflow.history ?? [])]) {
        output?.payload.imageKeys?.forEach((key) => mediaKeys.add(key));
        output?.payload.videoKeys?.forEach((key) => mediaKeys.add(key));
        output?.payload.audioKeys?.forEach((key) => mediaKeys.add(key));
    }
    const nextNodes = nodes
        .filter((node) => node.id !== nodeId)
        .map((node) =>
            node.metadata?.batchChildIds?.includes(nodeId)
                ? { ...node, metadata: { ...node.metadata, batchChildIds: node.metadata.batchChildIds.filter((childId) => childId !== nodeId) } }
                : node,
        );
    const nextConnections = connections.filter((connection) => connection.fromNodeId !== nodeId && connection.toNodeId !== nodeId);
    return { nodes: nextNodes, connections: nextConnections, mediaKeys: [...mediaKeys] };
}
