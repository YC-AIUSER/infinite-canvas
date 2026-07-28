import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

export function copyCanvasNodes(nodes: CanvasNodeData[]) {
    return nodes.map((node) => ({ ...node, position: { ...node.position }, metadata: node.metadata ? structuredClone(node.metadata) : undefined }));
}

export function cloneCanvasNodes(sourceNodes: CanvasNodeData[], allNodes: CanvasNodeData[], createId: (node: CanvasNodeData, index: number) => string) {
    const nodeById = new Map(allNodes.map((node) => [node.id, node]));
    const sourceIds = new Set(sourceNodes.map((node) => node.id));
    const orderedSources = [...sourceNodes];
    for (let index = 0; index < orderedSources.length; index += 1) {
        const node = orderedSources[index];
        node.metadata?.batchChildIds?.forEach((childId) => {
            const child = nodeById.get(childId);
            if (!child || sourceIds.has(childId)) return;
            sourceIds.add(childId);
            orderedSources.push(child);
        });
    }

    const idMap = new Map<string, string>();
    orderedSources.forEach((node, index) => idMap.set(node.id, createId(node, index)));
    const remapId = (id: string | undefined): string | undefined => (id ? idMap.get(id) || id : undefined);
    const remapRequiredId = (id: string) => idMap.get(id) || id;
    const nodes = copyCanvasNodes(orderedSources).map((node) => {
        const metadata = node.metadata;
        if (!metadata) return { ...node, id: idMap.get(node.id)! };
        const { cardProjection: _cardProjection, ...nextMetadata } = metadata;
        const remappedMetadata: CanvasNodeMetadata = {
            ...nextMetadata,
            batchChildIds: metadata.batchChildIds?.map(remapRequiredId),
            batchRootId: remapId(metadata.batchRootId),
            primaryImageId: remapId(metadata.primaryImageId),
            groupId: remapId(metadata.groupId),
        };
        return {
            ...node,
            id: idMap.get(node.id)!,
            metadata: remappedMetadata,
        };
    });
    return { nodes, idMap };
}
