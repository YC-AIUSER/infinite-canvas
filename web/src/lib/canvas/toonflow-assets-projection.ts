import { CanvasNodeType, type CanvasNodeData } from "../../types/canvas";
import type { AssetCard } from "../toonflow/schema";

const GROUP_PREFIX = "assets-group-";
const CARD_PREFIX = "assets-card-";
const CARD_W = 200;
const CARD_H = 240;
const CARD_GAP = 24;
const GROUP_PAD = 48;
const GROUP_COLS = 4;
const GROUP_OFFSET_Y = 260;

export function assetsGroupId(stageNodeId: string): string {
    return `${GROUP_PREFIX}${stageNodeId}`;
}

export function assetsCardNodeId(stageNodeId: string, cardId: string): string {
    return `${CARD_PREFIX}${stageNodeId}__${cardId}`;
}

export function isAssetsProjectionNode(node: CanvasNodeData): boolean {
    return Boolean(node.metadata?.projectionOf) || Boolean(node.metadata?.cardProjection);
}

/**
 * 把每个 assets 环节节点的 cards[](仅有 storageKey 的)投影成:一个 Group + 每卡一个 Image 子节点。
 * 幂等:非投影节点原样保留;投影节点每次整体重建(保留已存在节点的 position/尺寸)。
 * 真相源是 cards[],投影可整体丢弃重算。投影节点一律不带 toonflow,对级联/版本/导出零污染。
 */
export function reconcileAssetsProjection(nodes: CanvasNodeData[]): CanvasNodeData[] {
    const stageNodes = nodes.filter((node) => node.metadata?.toonflow?.kind === "assets");
    const projectionIds = new Set(nodes.filter(isAssetsProjectionNode).map((node) => node.id));
    if (!stageNodes.length && !projectionIds.size) return nodes;

    const base = nodes.filter((node) => !projectionIds.has(node.id));
    const existingById = new Map(nodes.map((node) => [node.id, node]));
    const added: CanvasNodeData[] = [];

    for (const stage of stageNodes) {
        const cards = (stage.metadata?.toonflow?.output?.payload.cards ?? []).filter((card) => Boolean(card.storageKey));
        if (!cards.length) continue;

        const groupId = assetsGroupId(stage.id);
        const cols = Math.min(cards.length, GROUP_COLS);
        const rows = Math.ceil(cards.length / GROUP_COLS);
        const groupW = GROUP_PAD * 2 + cols * CARD_W + (cols - 1) * CARD_GAP;
        const groupH = GROUP_PAD * 2 + rows * CARD_H + (rows - 1) * CARD_GAP;
        const groupPos = existingById.get(groupId)?.position ?? { x: stage.position.x, y: stage.position.y + GROUP_OFFSET_Y };

        added.push({
            id: groupId,
            type: CanvasNodeType.Group,
            title: stage.title,
            position: groupPos,
            width: groupW,
            height: groupH,
            metadata: { status: "idle", projectionOf: { stageNodeId: stage.id, kind: "assets" } },
        });

        cards.forEach((card, index) => {
            const childId = assetsCardNodeId(stage.id, card.cardId);
            const prev = existingById.get(childId);
            const { toonflow: _toonflow, ...previousMetadata } = prev?.metadata ?? {};
            const col = index % GROUP_COLS;
            const row = Math.floor(index / GROUP_COLS);
            const position = prev?.position ?? {
                x: groupPos.x + GROUP_PAD + col * (CARD_W + CARD_GAP),
                y: groupPos.y + GROUP_PAD + row * (CARD_H + CARD_GAP),
            };
            added.push({
                id: childId,
                type: CanvasNodeType.Image,
                title: card.name,
                position,
                width: prev?.width ?? CARD_W,
                height: prev?.height ?? CARD_H,
                metadata: {
                    ...previousMetadata,
                    status: "success",
                    storageKey: card.storageKey,
                    content: prev?.metadata?.storageKey === card.storageKey ? previousMetadata.content : undefined,
                    groupId,
                    cardProjection: { stageNodeId: stage.id, cardId: card.cardId },
                },
            });
        });
    }

    return [...base, ...added];
}

/** 从某 assets 环节的 cards[] 里删掉一张卡,返回新数组(供保存漏斗;真相源单向)。 */
export function removeCardFromStageCards(nodes: CanvasNodeData[], stageNodeId: string, cardId: string): AssetCard[] {
    const stage = nodes.find((node) => node.id === stageNodeId && node.metadata?.toonflow?.kind === "assets");
    const cards = stage?.metadata?.toonflow?.output?.payload.cards ?? [];
    return cards.filter((card) => card.cardId !== cardId);
}
