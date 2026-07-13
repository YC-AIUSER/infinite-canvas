import { z } from "zod";

import type { CanvasConnection, CanvasNodeData, ToonflowNodeKind } from "../../types/canvas";

import {
    buildActionContractPrompt,
    buildKeyframesPrompt,
    buildNodeContext,
    buildScriptPrompt,
    buildShotContractPrompt,
    buildSpaceContractPrompt,
    buildStoryboardPagePrompt,
    buildStoryboardTablePrompt,
    buildVideoWorkbenchPrompt,
    washPrompt,
} from "./prompts";
import {
    ActionContractSchema,
    NODE_STATUSES,
    ShotContractSchema,
    StoryboardRowSchema,
    VERSION_LIMIT_IMAGE,
    VERSION_LIMIT_TEXT,
    VERSION_LIMIT_VIDEO,
    migrateToonflowStatus,
    parseModelJson,
    type ActionContract,
    type AssetCard,
    type NodeOutput,
    type NodeStatus,
    type ShotContract,
    type StoryboardRow,
} from "./schema";
import { assignIds, validateSegmentRows } from "./segments";
import { approveNode, nextStatusOnGenerate, onGenerateFailure, onGenerateSuccess, propagateStale, rollbackToVersion, saveEditedNode, type GraphNode } from "./state-machine";

type GeneratableToonflowKind = "script" | "space-contract" | "storyboard-table" | "shot-contract" | "action-contract";
type WashHit = { term: string; replacement: string };

const PROMPT_BUILDERS: Record<GeneratableToonflowKind, (context: string) => string> = {
    script: buildScriptPrompt,
    "space-contract": buildSpaceContractPrompt,
    "storyboard-table": buildStoryboardTablePrompt,
    "shot-contract": buildShotContractPrompt,
    "action-contract": buildActionContractPrompt,
};

const GENERATABLE_KINDS: ReadonlySet<ToonflowNodeKind> = new Set(Object.keys(PROMPT_BUILDERS) as GeneratableToonflowKind[]);
const NODE_STATUS_SET: ReadonlySet<string> = new Set(NODE_STATUSES);

function isGeneratableKind(kind: ToonflowNodeKind): kind is GeneratableToonflowKind {
    return GENERATABLE_KINDS.has(kind);
}

const ASSET_CARD_TYPE_LABELS: Record<AssetCard["cardType"], string> = {
    character: "角色",
    scene: "场景",
    prop: "道具",
    action: "动作",
    expression: "表情",
    outfit: "服装",
    form: "形态",
};

function formatAssetCard(card: AssetCard, parentNameById: Map<string, string>) {
    const parentName = card.parentCardId ? parentNameById.get(card.parentCardId) : undefined;
    const derivedFrom = (card.cardType === "action" || card.cardType === "expression" || card.cardType === "outfit") && parentName ? `（衍生自${parentName}）` : "";
    if (card.cardType === "form" && parentName) return `【形态】${card.name}（${parentName}的形态）：${card.anchor}`;
    return `【${ASSET_CARD_TYPE_LABELS[card.cardType]}】${card.name}${derivedFrom}：${card.anchor}`;
}

export function readNodeInput(node: CanvasNodeData) {
    const payload = node.metadata?.toonflow?.output?.payload;
    if (payload?.text) return payload.text;
    if (payload?.cards) {
        const parentNameById = new Map(payload.cards.map((card) => [card.cardId, card.name]));
        return payload.cards.map((card) => formatAssetCard(card, parentNameById)).join("\n");
    }
    if (payload?.table) return JSON.stringify(payload.table, null, 2);
    return node.metadata?.content?.trim() || node.metadata?.prompt?.trim() || "";
}

function collectUpstreamNodeIds(connections: CanvasConnection[], nodeId: string) {
    const upstreamByNodeId = new Map<string, string[]>();
    for (const connection of connections) {
        const upstream = upstreamByNodeId.get(connection.toNodeId);
        if (upstream) upstream.push(connection.fromNodeId);
        else upstreamByNodeId.set(connection.toNodeId, [connection.fromNodeId]);
    }

    const result: string[] = [];
    const visited = new Set<string>([nodeId]);
    const queue = [...(upstreamByNodeId.get(nodeId) ?? [])];
    for (let index = 0; index < queue.length; index += 1) {
        const upstreamId = queue[index];
        if (visited.has(upstreamId)) continue;
        visited.add(upstreamId);
        result.push(upstreamId);
        queue.push(...(upstreamByNodeId.get(upstreamId) ?? []));
    }
    return result;
}

function appendInput(inputs: Record<string, string>, key: string, content: string) {
    if (!content) return;
    inputs[key] = inputs[key] ? `${inputs[key]}\n\n${content}` : content;
}

function existingStoryboardIds(node: CanvasNodeData) {
    const rows = node.metadata?.toonflow?.output?.payload.table;
    if (!rows?.length) return "";
    return rows.map((row) => `${row.segmentId}/${row.shotId}`).join("\n");
}

export function buildToonflowGeneration(nodes: CanvasNodeData[], connections: CanvasConnection[], nodeId: string) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const target = nodeById.get(nodeId);
    const kind = target?.metadata?.toonflow?.kind;
    if (!target || !kind || !isGeneratableKind(kind)) {
        throw new Error("当前节点不支持 Toonflow 文本生成");
    }

    const inputs: Record<string, string> = {};
    for (const upstreamId of collectUpstreamNodeIds(connections, nodeId)) {
        const upstream = nodeById.get(upstreamId);
        if (!upstream) continue;
        const inputKey = upstream.metadata?.toonflow?.kind || "source";
        appendInput(inputs, inputKey, readNodeInput(upstream));
    }

    if (kind === "storyboard-table") {
        appendInput(inputs, "existing-ids", existingStoryboardIds(target));
    }

    const prompt = PROMPT_BUILDERS[kind](buildNodeContext(kind, inputs));
    const { washed, hits } = washPrompt(prompt);
    return { finalPrompt: washed, washHits: hits };
}

export type ToonflowImageGeneration = {
    finalPrompt: string;
    washHits: Array<{ term: string; replacement: string }>;
    referenceKeys: string[];
    /** 构图锁等硬约束参考图:任一读取失败必须中止生成,不得降级(首帧只上色不改构图)。 */
    mandatoryKeys: string[];
    warnings: string[];
};

function assetCardSortKey(card: AssetCard, characterOrder: Map<string, number>): [number, number, number] {
    if (card.cardType === "character") return [0, characterOrder.get(card.cardId) ?? 0, 0];
    if (card.cardType === "action" || card.cardType === "expression" || card.cardType === "outfit" || card.cardType === "form") {
        const parentOrder = card.parentCardId ? characterOrder.get(card.parentCardId) : undefined;
        const derivedOrder = card.cardType === "action" ? 1 : card.cardType === "expression" ? 2 : card.cardType === "outfit" ? 3 : 4;
        if (parentOrder !== undefined) return [0, parentOrder, derivedOrder];
        if (card.cardType === "form") return [4, 0, 0];
        return [1, 0, derivedOrder];
    }
    return [card.cardType === "scene" ? 2 : 3, 0, 0];
}

function segmentContracts<T extends ShotContract | ActionContract>(
    nodes: CanvasNodeData[],
    kind: "shot-contract" | "action-contract",
    schema: typeof ShotContractSchema | typeof ActionContractSchema,
    shotIds: Set<string>,
    warnings: string[],
): T[] {
    const label = kind === "shot-contract" ? "镜头合同" : "动作合同";
    const rawText = nodes.find((node) => node.metadata?.toonflow?.kind === kind)?.metadata?.toonflow?.output?.payload.text;
    if (!rawText?.trim()) {
        warnings.push(`${label}缺少产出，已按空合同处理`);
        return [];
    }
    const parsed = parseModelJson(z.array(schema), rawText);
    if (!parsed.ok) {
        warnings.push(`${label}解析失败：${parsed.error}`);
        return [];
    }
    return parsed.data.filter((contract) => shotIds.has(contract.shotId)) as T[];
}

export function buildToonflowImageGeneration(nodes: CanvasNodeData[], connections: CanvasConnection[], nodeId: string, note?: string): ToonflowImageGeneration {
    void connections;
    const target = nodes.find((node) => node.id === nodeId);
    const targetToonflow = target?.metadata?.toonflow;
    if (!target || !targetToonflow?.segmentId || (targetToonflow.kind !== "storyboard-page" && targetToonflow.kind !== "keyframes")) {
        throw new Error("当前节点不支持 Toonflow 图像生成");
    }

    const table = nodes.find((node) => node.metadata?.toonflow?.kind === "storyboard-table")?.metadata?.toonflow?.output?.payload.table;
    const rows = (table ?? []).filter((row) => row.segmentId === targetToonflow.segmentId).sort((left, right) => left.shotNo - right.shotNo);
    if (!rows.length) throw new Error("分镜表中找不到该段镜头");

    const warnings: string[] = [];
    const shotIds = new Set(rows.map((row) => row.shotId));
    const shotContracts = segmentContracts<ShotContract>(nodes, "shot-contract", ShotContractSchema, shotIds, warnings);
    const actionContracts = segmentContracts<ActionContract>(nodes, "action-contract", ActionContractSchema, shotIds, warnings);
    const spaceRules = nodes.find((node) => node.metadata?.toonflow?.kind === "space-contract")?.metadata?.toonflow?.output?.payload.text;
    const allAssetCards = nodes.find((node) => node.metadata?.toonflow?.kind === "assets")?.metadata?.toonflow?.output?.payload.cards ?? [];
    const characterOrder = new Map(allAssetCards.filter((card) => card.cardType === "character").map((card, index) => [card.cardId, index]));
    const parentNameById = new Map(allAssetCards.map((card) => [card.cardId, card.name]));
    const cards = allAssetCards
        .filter((card): card is AssetCard & { storageKey: string } => typeof card.storageKey === "string" && Boolean(card.storageKey))
        .sort((left, right) => {
            const leftKey = assetCardSortKey(left, characterOrder);
            const rightKey = assetCardSortKey(right, characterOrder);
            return leftKey[0] - rightKey[0] || leftKey[1] - rightKey[1] || leftKey[2] - rightKey[2];
        });
    const assetKeys = cards.map((card) => card.storageKey);

    let prompt: string;
    let referenceKeys: string[];
    let mandatoryKeys: string[] = [];
    if (targetToonflow.kind === "storyboard-page") {
        if (!cards.length) warnings.push("无资产卡锚点,画面一致性可能漂移");
        prompt = buildStoryboardPagePrompt({ rows, shotContracts, actionContracts, spaceRules });
        referenceKeys = assetKeys;
    } else {
        // 必须排除已归档实例:分镜表回退使旧段重现时,同 segmentId 会同时存在归档与活跃两个实例,
        // 命中归档节点会拿到过期线稿、掩盖"请先生成该段故事板页"的报错。
        const storyboardKey = nodes.find(
            (node) =>
                node.metadata?.toonflow?.kind === "storyboard-page" &&
                node.metadata.toonflow.segmentId === targetToonflow.segmentId &&
                !node.metadata.toonflow.archived,
        )?.metadata?.toonflow?.output?.payload.imageKeys?.[0];
        if (!storyboardKey) throw new Error("请先生成该段故事板页");
        prompt = buildKeyframesPrompt({ rows, anchors: cards.map((card) => formatAssetCard(card, parentNameById)), note });
        referenceKeys = [storyboardKey, ...assetKeys];
        // 故事板页线稿是首帧的构图锁,读取失败必须中止:只上色不改构图,不能退化为文生图或仅凭资产卡。
        mandatoryKeys = [storyboardKey];
    }

    const { washed, hits } = washPrompt(prompt);
    return { finalPrompt: washed, washHits: hits, referenceKeys, mandatoryKeys, warnings };
}

export type ToonflowVideoGeneration = ToonflowImageGeneration & { shotPrompts: Record<string, string> };

export function buildToonflowVideoGeneration(nodes: CanvasNodeData[], connections: CanvasConnection[], nodeId: string, note?: string): ToonflowVideoGeneration {
    void connections;
    const target = nodes.find((node) => node.id === nodeId);
    const targetToonflow = target?.metadata?.toonflow;
    if (!target || !targetToonflow?.segmentId || targetToonflow.kind !== "video-workbench") {
        throw new Error("当前节点不支持 Toonflow 视频生成");
    }

    const table = nodes.find((node) => node.metadata?.toonflow?.kind === "storyboard-table")?.metadata?.toonflow?.output?.payload.table;
    const rows = (table ?? []).filter((row) => row.segmentId === targetToonflow.segmentId).sort((left, right) => left.shotNo - right.shotNo);
    if (!rows.length) throw new Error("分镜表中找不到该段镜头");

    const warnings: string[] = [];
    const shotIds = new Set(rows.map((row) => row.shotId));
    const shotContracts = segmentContracts<ShotContract>(nodes, "shot-contract", ShotContractSchema, shotIds, warnings);
    const actionContracts = segmentContracts<ActionContract>(nodes, "action-contract", ActionContractSchema, shotIds, warnings);
    const allAssetCards = nodes.find((node) => node.metadata?.toonflow?.kind === "assets")?.metadata?.toonflow?.output?.payload.cards ?? [];
    const characterOrder = new Map(allAssetCards.filter((card) => card.cardType === "character").map((card, index) => [card.cardId, index]));
    const parentNameById = new Map(allAssetCards.map((card) => [card.cardId, card.name]));
    const cards = allAssetCards
        .filter((card): card is AssetCard & { storageKey: string } => typeof card.storageKey === "string" && Boolean(card.storageKey))
        .sort((left, right) => {
            const leftKey = assetCardSortKey(left, characterOrder);
            const rightKey = assetCardSortKey(right, characterOrder);
            return leftKey[0] - rightKey[0] || leftKey[1] - rightKey[1] || leftKey[2] - rightKey[2];
        });
    const assetKeys = cards.map((card) => card.storageKey);

    // 排除已归档实例:分镜表回退使旧段重现时,同 segmentId 会同时存在归档与活跃两个实例,命中归档会拿到过期产物。
    const activeSegmentImageKey = (kind: "storyboard-page" | "keyframes") =>
        nodes.find(
            (node) =>
                node.metadata?.toonflow?.kind === kind &&
                node.metadata.toonflow.segmentId === targetToonflow.segmentId &&
                !node.metadata.toonflow.archived,
        )?.metadata?.toonflow?.output?.payload.imageKeys?.[0];

    const storyboardKey = activeSegmentImageKey("storyboard-page");
    if (!storyboardKey) throw new Error("请先生成该段故事板页");
    const keyframesKey = activeSegmentImageKey("keyframes");
    if (!keyframesKey) warnings.push("该段尚无首帧组,视频上色一致性可能漂移,建议先生成首帧");

    const { prompt, shotPrompts } = buildVideoWorkbenchPrompt({ rows, shotContracts, actionContracts, anchors: cards.map((card) => formatAssetCard(card, parentNameById)), note });
    const referenceKeys = [storyboardKey, ...(keyframesKey ? [keyframesKey] : []), ...assetKeys];
    // 九宫格故事板页是视频的第一构图参考,读取失败必须中止:失去多镜头直出的构图锁会退化为文生视频。
    const mandatoryKeys = [storyboardKey];

    const { washed, hits } = washPrompt(prompt);
    return { finalPrompt: washed, washHits: hits, referenceKeys, mandatoryKeys, warnings, shotPrompts };
}

function generationMeta(node: CanvasNodeData, _washHits: WashHit[]) {
    const sentPrompt = node.metadata?.prompt || "";
    return {
        model: node.metadata?.model || "",
        provider: "canvas-text-service",
        sentPrompt,
        washedPrompt: sentPrompt,
    };
}

function failedGenerationNode(node: CanvasNodeData, error: string, washHits: WashHit[]): CanvasNodeData {
    const toonflow = node.metadata?.toonflow;
    if (!toonflow) return node;
    const previous = toonflow.output;
    const output: NodeOutput = {
        nodeId: node.id,
        kind: toonflow.kind,
        version: previous?.version ?? 0,
        status: onGenerateFailure(toonflow.status),
        payload: previous?.payload ?? {},
        upstreamVersions: previous?.upstreamVersions ?? {},
        generationMeta: generationMeta(node, washHits),
        error,
        generatedAt: new Date().toISOString(),
    };
    return {
        ...node,
        metadata: {
            ...node.metadata,
            errorDetails: error,
            toonflow: { ...toonflow, status: output.status, output },
        },
    };
}

export function applyGenerationFailure(node: CanvasNodeData, error: string): CanvasNodeData {
    return failedGenerationNode(node, error, []);
}

/** 采集直接上游 toonflow 节点的当前版本快照——写入本次产出的 upstreamVersions,供版本守卫与"沿用旧产出"判定。 */
export function computeUpstreamVersions(nodes: CanvasNodeData[], connections: CanvasConnection[], nodeId: string): Record<string, number> {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const snapshot: Record<string, number> = {};
    for (const connection of connections) {
        if (connection.toNodeId !== nodeId) continue;
        const upstream = nodeById.get(connection.fromNodeId);
        const version = upstream?.metadata?.toonflow?.output?.version;
        if (typeof version === "number") snapshot[connection.fromNodeId] = version;
    }
    return snapshot;
}

/**
 * shotNo 归一化:模型经常无视"段内从 1 编号"的指令(实测两轮均全局连续编号)。
 * 编号是确定性工作,不赌模型服从——解析后按段内出现顺序重写 1..N;
 * 校验里的 shotNo 规则保留,作为本函数之后的不变量守卫。
 */
function normalizeShotNumbers(rows: StoryboardRow[]): StoryboardRow[] {
    const counters = new Map<string, number>();
    return rows.map((row) => {
        const nextNo = (counters.get(row.segmentId) ?? 0) + 1;
        counters.set(row.segmentId, nextNo);
        return row.shotNo === nextNo ? row : { ...row, shotNo: nextNo };
    });
}

export function applyGenerationSuccess(node: CanvasNodeData, rawText: string, washHits: WashHit[], upstreamVersions?: Record<string, number>): CanvasNodeData {
    const toonflow = node.metadata?.toonflow;
    if (!toonflow || !isGeneratableKind(toonflow.kind)) return node;

    let payload: NodeOutput["payload"] = { text: rawText };
    if (toonflow.kind === "storyboard-table") {
        const parsed = parseModelJson(z.array(StoryboardRowSchema), rawText);
        if (!parsed.ok) return failedGenerationNode(node, parsed.error, washHits);
        const assigned = assignIds(parsed.data);
        assigned.rows = normalizeShotNumbers(assigned.rows);
        const errors = validateSegmentRows(assigned.rows).filter((issue) => !issue.warning);
        if (errors.length) return failedGenerationNode(node, errors.map((issue) => issue.message).join("；"), washHits);
        payload = { table: assigned.rows };
    }

    const previous = toonflow.output;
    const output: NodeOutput = {
        nodeId: node.id,
        kind: toonflow.kind,
        version: (previous?.version ?? 0) + 1,
        status: onGenerateSuccess(toonflow.status),
        payload,
        upstreamVersions: upstreamVersions ?? previous?.upstreamVersions ?? {},
        generationMeta: generationMeta(node, washHits),
        generatedAt: new Date().toISOString(),
    };
    const history = previous ? [...(toonflow.history ?? []), previous].slice(-VERSION_LIMIT_TEXT) : toonflow.history;

    return {
        ...node,
        metadata: {
            ...node.metadata,
            content: rawText,
            status: "success" as const,
            errorDetails: undefined,
            toonflow: { ...toonflow, status: output.status, output, history },
        },
    };
}

export function applyImageGenerationSuccess(
    node: CanvasNodeData,
    storageKeys: string[],
    washHits: Array<{ term: string; replacement: string }>,
    upstreamVersions?: Record<string, number>,
): { node: CanvasNodeData; orphanedKeys: string[] } {
    const toonflow = node.metadata?.toonflow;
    if (!toonflow?.segmentId || (toonflow.kind !== "storyboard-page" && toonflow.kind !== "keyframes")) {
        return { node, orphanedKeys: [] };
    }

    const previous = toonflow.output;
    const allHistory = previous ? [...(toonflow.history ?? []), previous] : [...(toonflow.history ?? [])];
    const history = allHistory.slice(-VERSION_LIMIT_IMAGE);
    const removedHistory = allHistory.slice(0, Math.max(0, allHistory.length - VERSION_LIMIT_IMAGE));
    const referencedKeys = new Set([...storageKeys, ...history.flatMap((output) => output.payload.imageKeys ?? [])]);
    const orphanedKeys = Array.from(new Set(removedHistory.flatMap((output) => output.payload.imageKeys ?? []))).filter((key) => !referencedKeys.has(key));
    const output: NodeOutput = {
        nodeId: node.id,
        kind: toonflow.kind,
        version: (previous?.version ?? 0) + 1,
        status: onGenerateSuccess(toonflow.status),
        payload: { imageKeys: [...storageKeys] },
        upstreamVersions: upstreamVersions ?? previous?.upstreamVersions ?? {},
        generationMeta: generationMeta(node, washHits),
        generatedAt: new Date().toISOString(),
    };

    return {
        node: {
            ...node,
            metadata: {
                ...node.metadata,
                status: "success",
                errorDetails: undefined,
                toonflow: { ...toonflow, status: output.status, output, history },
            },
        },
        orphanedKeys,
    };
}

export function applyVideoGenerationSuccess(
    node: CanvasNodeData,
    storageKeys: string[],
    shotPrompts: Record<string, string>,
    washHits: Array<{ term: string; replacement: string }>,
    upstreamVersions?: Record<string, number>,
    taskId?: string,
): { node: CanvasNodeData; orphanedKeys: string[] } {
    const toonflow = node.metadata?.toonflow;
    if (!toonflow?.segmentId || toonflow.kind !== "video-workbench") {
        return { node, orphanedKeys: [] };
    }

    const previous = toonflow.output;
    const allHistory = previous ? [...(toonflow.history ?? []), previous] : [...(toonflow.history ?? [])];
    const history = allHistory.slice(-VERSION_LIMIT_VIDEO);
    const removedHistory = allHistory.slice(0, Math.max(0, allHistory.length - VERSION_LIMIT_VIDEO));
    const referencedKeys = new Set([...storageKeys, ...history.flatMap((output) => output.payload.videoKeys ?? [])]);
    const orphanedKeys = Array.from(new Set(removedHistory.flatMap((output) => output.payload.videoKeys ?? []))).filter((key) => !referencedKeys.has(key));
    const meta = generationMeta(node, washHits);
    const output: NodeOutput = {
        nodeId: node.id,
        kind: toonflow.kind,
        version: (previous?.version ?? 0) + 1,
        status: onGenerateSuccess(toonflow.status),
        payload: { videoKeys: [...storageKeys], shotPrompts },
        upstreamVersions: upstreamVersions ?? previous?.upstreamVersions ?? {},
        generationMeta: taskId ? { ...meta, taskId } : meta,
        generatedAt: new Date().toISOString(),
    };

    return {
        node: {
            ...node,
            metadata: {
                ...node.metadata,
                status: "success",
                errorDetails: undefined,
                toonflow: { ...toonflow, status: output.status, output, history },
            },
        },
        orphanedKeys,
    };
}

export function splitMediaKeysByStore(keys: string[]): { imageKeys: string[]; mediaKeys: string[] } {
    return {
        imageKeys: keys.filter((key) => key.startsWith("image:")),
        mediaKeys: keys.filter((key) => !key.startsWith("image:")),
    };
}

function graphNodes(nodes: CanvasNodeData[]): GraphNode[] {
    return nodes.flatMap((node) => {
        const toonflow = node.metadata?.toonflow;
        if (!toonflow) return [];
        return [
            {
                nodeId: node.id,
                status: toonflow.status,
                version: toonflow.output?.version ?? 0,
                upstreamVersions: toonflow.output?.upstreamVersions ?? {},
                skipped: toonflow.status === "skipped",
            },
        ];
    });
}

function graphEdges(connections: CanvasConnection[]) {
    return connections.map((connection) => ({ from: connection.fromNodeId, to: connection.toNodeId }));
}

export function applyApprove(nodes: CanvasNodeData[], _connections: CanvasConnection[], nodeId: string): CanvasNodeData[] {
    return nodes.map<CanvasNodeData>((node) => {
        const metadata = node.metadata;
        const toonflow = metadata?.toonflow;
        const currentOutput = toonflow?.output;
        if (node.id !== nodeId || !metadata || !toonflow || !currentOutput) return node;
        const result = approveNode(currentOutput);
        return {
            ...node,
            metadata: {
                ...metadata,
                toonflow: { ...toonflow, status: result.next.status, output: result.next },
            },
        };
    });
}

/**
 * 进入生成态。注意:此处不做失效传播——传播的触发事件是"新版本产生"
 * (生成成功后由 propagateAfterNewVersion 执行),点击重生成时下游不受影响,
 * 生成失败也不会误标下游(design doc 状态机语义)。
 */
export function applyRegenerate(nodes: CanvasNodeData[], _connections: CanvasConnection[], nodeId: string): CanvasNodeData[] {
    const target = nodes.find((node) => node.id === nodeId);
    const toonflow = target?.metadata?.toonflow;
    if (!target || !toonflow) return nodes;

    const status = nextStatusOnGenerate(toonflow.status);

    return nodes.map((node) => {
        const nodeToonflow = node.metadata?.toonflow;
        if (!nodeToonflow || node.id !== nodeId) return node;
        return {
            ...node,
            metadata: {
                ...node.metadata,
                status: "loading" as const,
                errorDetails: undefined,
                toonflow: { ...nodeToonflow, status },
            },
        };
    });
}

/**
 * 新版本产生后(生成成功进入 review)执行失效传播:
 * 按 BFS+版本守卫把下游标 stale(快照已含新版本者豁免并断支,skipped 穿透)。
 */
export function propagateAfterNewVersion(nodes: CanvasNodeData[], connections: CanvasConnection[], nodeId: string): CanvasNodeData[] {
    const target = nodes.find((node) => node.id === nodeId);
    const newVersion = target?.metadata?.toonflow?.output?.version;
    if (typeof newVersion !== "number" || newVersion <= 0) return nodes;

    const staleNodeIds = new Set(propagateStale(graphNodes(nodes), graphEdges(connections), nodeId, newVersion));
    if (!staleNodeIds.size) return nodes;

    return nodes.map((node) => {
        const nodeToonflow = node.metadata?.toonflow;
        if (!nodeToonflow || !staleNodeIds.has(node.id)) return node;
        return {
            ...node,
            metadata: {
                ...node.metadata,
                toonflow: {
                    ...nodeToonflow,
                    status: "stale",
                    output: nodeToonflow.output ? { ...nodeToonflow.output, status: "stale" } : undefined,
                },
            },
        };
    });
}

function hydratedStatus(status: unknown): NodeStatus {
    if (typeof status === "string" && NODE_STATUS_SET.has(status)) return status as NodeStatus;
    return migrateToonflowStatus(typeof status === "string" ? status : "");
}

/** 迁移 output/history 内嵌的旧中文状态——否则 approveNode 等迁移守卫会在旧数据上收到非法状态报错。 */
function migrateOutputStatus(output: NodeOutput): NodeOutput {
    const migrated = hydratedStatus(output.status);
    return migrated === output.status ? output : { ...output, status: migrated };
}

export function hydrateToonflowProject(nodes: CanvasNodeData[]) {
    return nodes.map((node) => {
        const toonflow = node.metadata?.toonflow;
        if (!toonflow) return node;
        // 页面刷新/崩溃时，仅保留"活跃(未归档)视频节点 + 已有 provider taskId"继续恢复;其余生成降级为 failed 可重试。
        const migrated = hydratedStatus(toonflow.status);
        const recoverableVideoTask = migrated === "generating" && toonflow.kind === "video-workbench" && !toonflow.archived && Boolean(toonflow.pendingVideoTask);
        const status = migrated === "generating" && !recoverableVideoTask ? "failed" : migrated;
        // 不可恢复的节点不留 pendingVideoTask 残留(归档/非视频/降级为 failed 的),避免脏数据与后续误恢复。
        const pendingVideoTask = recoverableVideoTask ? toonflow.pendingVideoTask : undefined;
        const pendingChanged = pendingVideoTask !== toonflow.pendingVideoTask;
        const output = toonflow.output ? migrateOutputStatus(toonflow.output) : toonflow.output;
        const migratedHistory = toonflow.history?.map(migrateOutputStatus);
        const historyChanged = Boolean(migratedHistory?.some((item, index) => item !== toonflow.history?.[index]));
        if (status === toonflow.status && output === toonflow.output && !historyChanged && !pendingChanged) return node;
        return {
            ...node,
            metadata: {
                ...node.metadata,
                errorDetails: status === "failed" && migrated === "generating" ? "生成被中断(页面已刷新),请重试" : node.metadata?.errorDetails,
                toonflow: { ...toonflow, status, output, history: historyChanged ? migratedHistory : toonflow.history, pendingVideoTask },
            },
        };
    });
}

const IMAGE_HISTORY_KINDS: ReadonlySet<ToonflowNodeKind> = new Set(["storyboard-page", "keyframes"]);

/** 各类节点历史上限:视频 3、图像 5、文本 10。回退/编辑/生成成功各路径统一走此函数,避免误用他类上限累积超额版本。 */
function historyLimitForKind(kind: ToonflowNodeKind) {
    if (kind === "video-workbench") return VERSION_LIMIT_VIDEO;
    return IMAGE_HISTORY_KINDS.has(kind) ? VERSION_LIMIT_IMAGE : VERSION_LIMIT_TEXT;
}

/** 节点产出里受版本管理的媒体键:收全 image/video/audio 三类(每类节点只存自己那类,收全对现有类等价且不漏 audio)。裁历史算孤儿时用,防跨类漏清。 */
function historyMediaKeys(output: NodeOutput): string[] {
    return [...(output.payload.imageKeys ?? []), ...(output.payload.videoKeys ?? []), ...(output.payload.audioKeys ?? [])];
}

function appendHistory(history: NodeOutput[] | undefined, output: NodeOutput, kind: ToonflowNodeKind) {
    return [...(history ?? []), output].slice(-historyLimitForKind(kind));
}

export type ExportSegment = {
    segmentId: string;
    segmentIndex: number;
    title: string;
    videoKey: string;
    version: number;
};

export type ExportCollection = {
    /** 已通过且有视频的段,按段序升序;供 #14 成片导出顺序预览/逐段下载/打包。 */
    segments: ExportSegment[];
    /** 视频工作台的段总数(未归档,含未通过),用于"X/Y 段已通过"。 */
    totalSegments: number;
    /** 已通过段数,即 segments.length。 */
    approvedCount: number;
};

/** 汇总"已通过"的视频工作台段实例产出,供 #14 成片导出节点顺序预览/逐段下载/打包。
 *  只认未归档 video-workbench 段实例:已通过且有 videoKey 的进 segments(按段序);同段多实例取最新版本(防御,正常每段一实例)。 */
export function collectExportSegments(nodes: CanvasNodeData[]): ExportCollection {
    const segmentIds = new Set<string>();
    const bySegment = new Map<string, ExportSegment>();
    for (const node of nodes) {
        const toonflow = node.metadata?.toonflow;
        if (!toonflow || toonflow.kind !== "video-workbench" || !toonflow.segmentId || toonflow.archived) continue;
        segmentIds.add(toonflow.segmentId);
        const videoKey = toonflow.output?.payload.videoKeys?.[0];
        if (toonflow.status !== "approved" || !videoKey) continue;
        const candidate: ExportSegment = {
            segmentId: toonflow.segmentId,
            segmentIndex: toonflow.segmentIndex ?? 0,
            title: node.title,
            videoKey,
            version: toonflow.output!.version,
        };
        const existing = bySegment.get(candidate.segmentId);
        if (!existing || candidate.version > existing.version) bySegment.set(candidate.segmentId, candidate);
    }
    const segments = [...bySegment.values()].sort((left, right) => left.segmentIndex - right.segmentIndex);
    return { segments, totalSegments: segmentIds.size, approvedCount: segments.length };
}

export type SeamBoundary = {
    /** 稳定边界身份:两段 segmentId 拼接。 */
    key: string;
    fromSegmentId: string;
    fromTitle: string;
    fromVideoKey: string;
    fromVersion: number;
    toSegmentId: string;
    toTitle: string;
    toVideoKey: string;
    toVersion: number;
};

export type SeamReview = { key: string; fromVersion: number; toVersion: number };

/** #12 接缝检查:相邻已通过段两两配对(N 段 → N-1 个接缝),按段序。 */
export function collectSeamBoundaries(nodes: CanvasNodeData[]): SeamBoundary[] {
    const segments = collectExportSegments(nodes).segments;
    const boundaries: SeamBoundary[] = [];
    for (let index = 0; index < segments.length - 1; index += 1) {
        const from = segments[index];
        const to = segments[index + 1];
        boundaries.push({
            key: `${from.segmentId}__${to.segmentId}`,
            fromSegmentId: from.segmentId,
            fromTitle: from.title,
            fromVideoKey: from.videoKey,
            fromVersion: from.version,
            toSegmentId: to.segmentId,
            toTitle: to.title,
            toVideoKey: to.videoKey,
            toVersion: to.version,
        });
    }
    return boundaries;
}

/** 接缝节点的已检记录存在 output.payload.text(JSON,复用 text 字段免改 schema)。 */
export function parseSeamReviews(seamNode: CanvasNodeData | undefined): SeamReview[] {
    const text = seamNode?.metadata?.toonflow?.output?.payload.text;
    if (!text) return [];
    try {
        const parsed = JSON.parse(text) as { reviewed?: SeamReview[] };
        return Array.isArray(parsed.reviewed) ? parsed.reviewed : [];
    } catch {
        return [];
    }
}

/** 一个接缝"已检"当且仅当有 review 记录 key 相同且双方版本都一致——任一段重生成→版本变→该接缝需重检。 */
export function isSeamChecked(boundary: SeamBoundary, reviews: SeamReview[]): boolean {
    return reviews.some((review) => review.key === boundary.key && review.fromVersion === boundary.fromVersion && review.toVersion === boundary.toVersion);
}

export function seamReviewSummary(nodes: CanvasNodeData[], seamNode: CanvasNodeData | undefined): { checkedCount: number; total: number } {
    const boundaries = collectSeamBoundaries(nodes);
    const reviews = parseSeamReviews(seamNode);
    return { checkedCount: boundaries.filter((boundary) => isSeamChecked(boundary, reviews)).length, total: boundaries.length };
}

/** 保存接缝勾选:全部接缝已检=approved(勾选完成即 approved),部分=review。只存当前版本的已检记录。 */
export function applySeamReviewSave(nodes: CanvasNodeData[], nodeId: string, reviews: SeamReview[]): CanvasNodeData[] {
    const boundaries = collectSeamBoundaries(nodes);
    const allChecked = boundaries.length > 0 && boundaries.every((boundary) => isSeamChecked(boundary, reviews));
    const status: NodeStatus = allChecked ? "approved" : "review";
    return nodes.map<CanvasNodeData>((node) => {
        const toonflow = node.metadata?.toonflow;
        if (node.id !== nodeId || !toonflow || toonflow.kind !== "seam-check") return node;
        const output: NodeOutput = {
            nodeId,
            kind: "seam-check",
            version: (toonflow.output?.version ?? 0) + 1,
            status,
            payload: { text: JSON.stringify({ reviewed: reviews }) },
            upstreamVersions: {},
            generatedAt: new Date().toISOString(),
        };
        return { ...node, metadata: { ...node.metadata, toonflow: { ...toonflow, status, output } } };
    });
}

/** 跳过接缝检查(可跳过白名单):置 skipped,下游透明。 */
export function applySeamSkip(nodes: CanvasNodeData[], nodeId: string): CanvasNodeData[] {
    return nodes.map<CanvasNodeData>((node) => {
        const toonflow = node.metadata?.toonflow;
        if (node.id !== nodeId || !toonflow || toonflow.kind !== "seam-check") return node;
        return { ...node, metadata: { ...node.metadata, toonflow: { ...toonflow, status: "skipped" } } };
    });
}

export function applyAssetCardsSave(nodes: CanvasNodeData[], connections: CanvasConnection[], nodeId: string, cards: AssetCard[]): CanvasNodeData[] {
    const target = nodes.find((node) => node.id === nodeId);
    const toonflow = target?.metadata?.toonflow;
    if (!target || !toonflow || toonflow.kind !== "assets") return nodes;

    const previous = toonflow.output;
    const status: NodeStatus = toonflow.status === "approved" && previous?.status === "approved" ? "approved" : "review";
    const output: NodeOutput = {
        nodeId,
        kind: "assets",
        version: (previous?.version ?? 0) + 1,
        status,
        payload: { cards },
        upstreamVersions: computeUpstreamVersions(nodes, connections, nodeId),
        generatedAt: new Date().toISOString(),
    };
    const next = nodes.map<CanvasNodeData>((node) =>
        node.id === nodeId
            ? {
                  ...node,
                  metadata: {
                      ...node.metadata,
                      status: "success",
                      errorDetails: undefined,
                      toonflow: { ...toonflow, status, output, history: previous ? appendHistory(toonflow.history, previous, toonflow.kind) : toonflow.history },
                  },
              }
            : node,
    );
    return propagateAfterNewVersion(next, connections, nodeId);
}

export function parseEntityHints(scriptText: string): Array<{ cardType: "character" | "prop"; name: string; note: string }> {
    const hints: Array<{ cardType: "character" | "prop"; name: string; note: string }> = [];
    let activeType: "character" | "prop" | null = null;

    for (const rawLine of scriptText.split(/\r?\n/)) {
        if (rawLine.includes("角色实体清单")) {
            activeType = "character";
            continue;
        }
        if (rawLine.includes("道具实体清单")) {
            activeType = "prop";
            continue;
        }
        if (activeType && rawLine.includes("清单")) {
            activeType = null;
            continue;
        }
        if (!activeType) continue;

        const line = rawLine
            .trim()
            .replace(/^[-*•]\s*/, "")
            .replace(/^\d+[.)、]\s*/, "")
            .trim();
        if (!line) continue;
        const separator = line.search(/[:：—]/);
        if (separator <= 0) continue;
        const name = line.slice(0, separator).trim();
        const note = line.slice(separator + 1).trim();
        if (name && note) hints.push({ cardType: activeType, name, note });
    }

    return hints;
}

function payloadContent(payload: NodeOutput["payload"]) {
    if (typeof payload.text === "string") return payload.text;
    if (payload.table) return JSON.stringify(payload.table, null, 2);
    return "";
}

export function applyEditSave(nodes: CanvasNodeData[], connections: CanvasConnection[], nodeId: string, newText: string): CanvasNodeData[] {
    const target = nodes.find((node) => node.id === nodeId);
    const toonflow = target?.metadata?.toonflow;
    const currentOutput = toonflow?.output;
    if (!target || !toonflow || toonflow.kind === "storyboard-table" || toonflow.status !== "approved" || currentOutput?.status !== "approved" || typeof currentOutput.payload.text !== "string") return nodes;

    const edited = saveEditedNode(currentOutput).next;
    const output: NodeOutput = {
        ...edited,
        payload: { ...edited.payload, text: newText },
        upstreamVersions: computeUpstreamVersions(nodes, connections, nodeId),
        generatedAt: new Date().toISOString(),
    };
    const next = nodes.map<CanvasNodeData>((node) =>
        node.id === nodeId
            ? {
                  ...node,
                  metadata: {
                      ...node.metadata,
                      content: newText,
                      status: "success",
                      errorDetails: undefined,
                      toonflow: { ...toonflow, status: output.status, output, history: appendHistory(toonflow.history, currentOutput, toonflow.kind) },
                  },
              }
            : node,
    );
    return propagateAfterNewVersion(next, connections, nodeId);
}

export function applyRollback(nodes: CanvasNodeData[], connections: CanvasConnection[], nodeId: string, targetVersion: number): { nodes: CanvasNodeData[]; orphanedKeys: string[] } {
    const target = nodes.find((node) => node.id === nodeId);
    const toonflow = target?.metadata?.toonflow;
    const currentOutput = toonflow?.output;
    const historical = toonflow?.history?.find((output) => output.version === targetVersion);
    if (!target || !toonflow || !currentOutput || !historical) return { nodes, orphanedKeys: [] };

    const output: NodeOutput = { ...rollbackToVersion(currentOutput, historical).next, generatedAt: new Date().toISOString() };
    // appendHistory 会从头部裁掉超版本上限的旧历史;被裁历史里独有的媒体键成孤儿,需返回给调用方清理(否则 image_files/media_files 泄漏)。
    const limit = historyLimitForKind(toonflow.kind);
    const allHistory = [...(toonflow.history ?? []), currentOutput];
    const history = allHistory.slice(-limit);
    const removedHistory = allHistory.slice(0, Math.max(0, allHistory.length - limit));
    // 用最终状态(恢复的 output + 保留的 history)反查引用集,任何仍被引用的键都不算孤儿,防误删共享 Blob。
    const referencedKeys = new Set<string>([...historyMediaKeys(output), ...history.flatMap((item) => historyMediaKeys(item))]);
    const orphanedKeys = Array.from(new Set(removedHistory.flatMap((item) => historyMediaKeys(item)))).filter((key) => !referencedKeys.has(key));

    const next = nodes.map<CanvasNodeData>((node) =>
        node.id === nodeId
            ? {
                  ...node,
                  metadata: {
                      ...node.metadata,
                      content: payloadContent(output.payload),
                      status: "success",
                      errorDetails: undefined,
                      toonflow: { ...toonflow, status: output.status, output, history },
                  },
              }
            : node,
    );
    return { nodes: propagateAfterNewVersion(next, connections, nodeId), orphanedKeys };
}

export function applyAdoptStale(nodes: CanvasNodeData[], connections: CanvasConnection[], nodeId: string): CanvasNodeData[] {
    const target = nodes.find((node) => node.id === nodeId);
    const toonflow = target?.metadata?.toonflow;
    const currentOutput = toonflow?.output;
    if (!target || !toonflow || toonflow.status !== "stale" || currentOutput?.status !== "stale") return nodes;

    const output: NodeOutput = {
        ...currentOutput,
        status: "approved",
        upstreamVersions: computeUpstreamVersions(nodes, connections, nodeId),
    };
    return nodes.map<CanvasNodeData>((node) =>
        node.id === nodeId
            ? {
                  ...node,
                  metadata: {
                      ...node.metadata,
                      status: "success",
                      errorDetails: undefined,
                      toonflow: { ...toonflow, status: "approved", output },
                  },
              }
            : node,
    );
}

export function approveChain(nodes: CanvasNodeData[], connections: CanvasConnection[], rootIds?: string | string[]) {
    const selectedIds = rootIds === undefined ? null : new Set(Array.isArray(rootIds) ? rootIds : [rootIds]);
    let next = nodes;
    let approvedCount = 0;

    for (const node of nodes) {
        const toonflow = node.metadata?.toonflow;
        if (selectedIds && !selectedIds.has(node.id)) continue;
        if (!toonflow || !isGeneratableKind(toonflow.kind) || toonflow.status !== "review" || toonflow.output?.status !== "review") continue;
        next = applyApprove(next, connections, node.id);
        approvedCount += 1;
    }

    return { nodes: next, approvedCount };
}

/**
 * 文本级联子图。Toonflow 模板是一条线性链,文本节点之间夹着非文本节点
 * (如 剧本→资产库(图像)→空间合同):直接丢弃非文本节点会把链剪断,
 * 因此过滤时必须**桥接**——从每个文本节点向下穿过任意非文本节点,
 * 直到抵达下一个文本节点,补一条 from→to 的直连边。
 *
 *   script ─→ [assets] ─→ space ─→ table        原图
 *   script ────────────→ space ─→ table         桥接后
 */
export function buildTextCascadeGraph(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const textNodes = nodes.filter((node) => {
        const kind = node.metadata?.toonflow?.kind;
        return kind ? isGeneratableKind(kind) : false;
    });
    const nodeIds = new Set(textNodes.map((node) => node.id));
    const kinds: Record<string, ToonflowNodeKind> = {};
    for (const node of textNodes) {
        kinds[node.id] = node.metadata!.toonflow!.kind;
    }

    const childrenByNodeId = new Map<string, string[]>();
    for (const connection of connections) {
        const children = childrenByNodeId.get(connection.fromNodeId);
        if (children) children.push(connection.toNodeId);
        else childrenByNodeId.set(connection.fromNodeId, [connection.toNodeId]);
    }

    const edges: Array<{ from: string; to: string }> = [];
    for (const textNode of textNodes) {
        const visited = new Set<string>([textNode.id]);
        const queue = [...(childrenByNodeId.get(textNode.id) ?? [])];
        for (let index = 0; index < queue.length; index += 1) {
            const currentId = queue[index];
            if (visited.has(currentId)) continue;
            visited.add(currentId);
            if (nodeIds.has(currentId)) {
                edges.push({ from: textNode.id, to: currentId });
                continue; // 抵达下一个文本节点即停,不穿透它继续(它自己会桥接自己的下游)
            }
            queue.push(...(childrenByNodeId.get(currentId) ?? []));
        }
    }

    return { nodes: graphNodes(textNodes), edges, kinds };
}
