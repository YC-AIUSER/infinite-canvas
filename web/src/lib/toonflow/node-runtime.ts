import { z } from "zod";

import type { CanvasConnection, CanvasNodeData, ToonflowNodeKind } from "../../types/canvas";

import {
    buildActionContractPrompt,
    buildContinuityTablePrompt,
    buildCreativePrompt,
    buildDirectingLockPrompt,
    finalizeModule4Text,
    buildKeyframesPrompt,
    buildModule4ComposePrompt,
    buildNodeContext,
    buildScriptPrompt,
    buildShotContractPrompt,
    buildSpaceContractPrompt,
    buildStoryboardPagePrompt,
    buildStoryboardTablePrompt,
    washPrompt,
} from "./prompts";
import { validateModule4 } from "./module4-check";
import { collapseNodeAfterStream, fitHeightToText } from "./streaming";
import {
    ActionContractSchema,
    ContinuityTableSchema,
    DirectingLockSchema,
    NODE_STATUSES,
    SHOT_CONTRACT_PATCH_FIELDS,
    STORYBOARD_ROW_PATCH_FIELDS,
    ShotContractSchema,
    StoryboardRowSchema,
    VERSION_LIMIT_IMAGE,
    VERSION_LIMIT_TEXT,
    VERSION_LIMIT_VIDEO,
    migrateToonflowStatus,
    parseModelJson,
    type ActionContract,
    type AssetCard,
    type DiversityPatchItem,
    type DirectingLock,
    type DubbingTrack,
    type NodeOutput,
    type NodeStatus,
    type QualityReview,
    type QualityReviewKey,
    type RepairMethod,
    type RepairPlanItem,
    type SeamContract,
    type ShotContract,
    type StoryboardRow,
    QUALITY_REVIEW_KEYS,
} from "./schema";
import { assignIds, validateSegmentRows } from "./segments";
import { approveNode, nextStatusOnGenerate, onGenerateFailure, onGenerateSuccess, propagateStale, rollbackToVersion, saveEditedNode, type GraphNode } from "./state-machine";

type GeneratableToonflowKind = "creative" | "script" | "space-contract" | "continuity-table" | "directing-lock" | "storyboard-table" | "shot-contract" | "action-contract";
type WashHit = { term: string; replacement: string };

const PROMPT_BUILDERS: Record<GeneratableToonflowKind, (context: string) => string> = {
    creative: buildCreativePrompt,
    script: buildScriptPrompt,
    "space-contract": buildSpaceContractPrompt,
    "continuity-table": buildContinuityTablePrompt,
    "directing-lock": buildDirectingLockPrompt,
    "storyboard-table": buildStoryboardTablePrompt,
    "shot-contract": buildShotContractPrompt,
    "action-contract": buildActionContractPrompt,
};

const GENERATABLE_KINDS: ReadonlySet<ToonflowNodeKind> = new Set(Object.keys(PROMPT_BUILDERS) as GeneratableToonflowKind[]);
const NODE_STATUS_SET: ReadonlySet<string> = new Set(NODE_STATUSES);

export const QUALITY_REVIEW_LABELS: Record<QualityReviewKey, string> = {
    identity: "身份连续性",
    assets: "资产连续性",
    cinematography: "摄影连续性",
    action: "动作连续性",
    narrative: "叙事与节奏",
    audio: "声音与字幕",
    technical: "技术质量",
};

export const REPAIR_METHOD_LABELS: Record<RepairMethod, string> = {
    "recut-timing": "重新剪辑或调时长",
    "local-visual-fix": "局部画面修复",
    "color-audio-unify": "颜色与声音统一",
    "regenerate-shot": "重生成单镜头",
    "redo-segment": "重做整段",
};

// 依据 09-qc-repair 的最小返修顺序：叙事先剪辑，技术问题先局修，摄影/声音先统一，
// 身份、资产与动作连续性通常需要替换失败镜头；这里只选各类问题的起点，不跳过五级优先顺序。
const REPAIR_METHOD_BY_QUALITY: Record<QualityReviewKey, RepairMethod> = {
    identity: "regenerate-shot",
    assets: "regenerate-shot",
    cinematography: "color-audio-unify",
    action: "regenerate-shot",
    narrative: "recut-timing",
    audio: "color-audio-unify",
    technical: "local-visual-fix",
};

const REGENERATION_ANCHOR = "前一镜尾帧、后一镜首帧或已确认的角色/场景/服装/道具/光线资产";

function defaultRepairPlanItem(reviewKey: QualityReviewKey, severity: "P0" | "P1", note?: string): RepairPlanItem {
    const method = REPAIR_METHOD_BY_QUALITY[reviewKey];
    const label = QUALITY_REVIEW_LABELS[reviewKey];
    const regeneratesVisual = method === "regenerate-shot" || method === "redo-segment";
    return {
        reviewKey,
        severity,
        method,
        reason: note?.trim() || `${label}存在 ${severity} 问题`,
        inputAnchor: regeneratesVisual ? REGENERATION_ANCHOR : "当前成片、原分镜表与相邻镜头",
        preservedContent: regeneratesVisual ? "锁定原角色、场景、服装、道具和光线，保留已通过内容与相邻镜头接点" : "保留已通过的镜头、剧情、角色资产与声音结构",
        replacementScope: method === "recut-timing" ? "仅调整问题镜头的入点、出点、顺序或停留时长" : method === "local-visual-fix" ? "仅修复问题画面区域，不改变构图与剧情" : method === "color-audio-unify" ? "仅统一问题范围的色彩、曝光、响度或声音接点" : method === "regenerate-shot" ? "仅替换失败单镜头，并保留足够的前后剪辑手柄" : "最后手段：重做本段全部镜头",
        acceptanceCriteria: `复检“${label}”通过，且前后剪辑点未引入新的身份、空间、节奏或声音问题`,
        regeneratedShotCount: method === "regenerate-shot" ? 1 : undefined,
    };
}

export function buildRepairPlan(review?: QualityReview, currentPlan: RepairPlanItem[] = review?.repairPlan ?? []): RepairPlanItem[] {
    if (!review) return [];
    const currentByKey = new Map(currentPlan.map((item) => [item.reviewKey, item]));
    return review.items.flatMap((item) => {
        if (item.severity !== "P0" && item.severity !== "P1") return [];
        const defaults = defaultRepairPlanItem(item.key, item.severity, item.note);
        const current = currentByKey.get(item.key);
        return [{ ...defaults, ...current, reviewKey: item.key, severity: item.severity }];
    });
}

export function setRepairMethod(item: RepairPlanItem, method: RepairMethod): RepairPlanItem {
    const regeneratesVisual = method === "regenerate-shot" || method === "redo-segment";
    return {
        ...item,
        method,
        inputAnchor: regeneratesVisual ? REGENERATION_ANCHOR : item.inputAnchor,
        preservedContent: regeneratesVisual ? "锁定原角色、场景、服装、道具和光线，保留已通过内容与相邻镜头接点" : item.preservedContent,
        replacementScope: method === "recut-timing" ? "仅调整问题镜头的入点、出点、顺序或停留时长" : method === "local-visual-fix" ? "仅修复问题画面区域，不改变构图与剧情" : method === "color-audio-unify" ? "仅统一问题范围的色彩、曝光、响度或声音接点" : method === "regenerate-shot" ? "仅替换失败单镜头，并保留足够的前后剪辑手柄" : "最后手段：重做本段全部镜头",
        regeneratedShotCount: method === "regenerate-shot" ? item.regeneratedShotCount ?? 1 : undefined,
    };
}

export type RepairCostGate = {
    available: boolean;
    regeneratedShotCount: number;
    totalShotCount: number;
    ratio: number;
    exceeds20Percent: boolean;
};

/**
 * 成本闸门：09-qc-repair §七「预计重做超过全片 20% 镜头时，先给用户返修范围与成本影响再继续」。
 * 分母是**全片**镜头数（对抗审查 2026-07-27 纠正，此前误按本段计算——本段 1/4 会显示 25%，
 * 而全片实际可能只有 1/40）。「重做整段」这一项的成本是本段镜头数，故两个总数都要传。
 */
export function evaluateRepairCostGate(plan?: RepairPlanItem[], totalShotCount = 0, segmentShotCount = 0): RepairCostGate {
    const safeTotal = Math.max(0, Math.floor(totalShotCount));
    const safeSegment = Math.max(0, Math.floor(segmentShotCount));
    const redoSegment = (plan ?? []).some((item) => item.method === "redo-segment");
    const shotIds = new Set<string>();
    let fallbackShotCount = 0;
    if (!redoSegment) {
        for (const item of plan ?? []) {
            if (item.method !== "regenerate-shot") continue;
            const itemShotIds = (item.shotIds ?? []).map((shotId) => shotId.trim()).filter(Boolean);
            if (itemShotIds.length) itemShotIds.forEach((shotId) => shotIds.add(shotId));
            else fallbackShotCount += Math.max(1, Math.floor(item.regeneratedShotCount ?? 1));
        }
    }
    const requestedShotCount = redoSegment ? safeSegment : shotIds.size + fallbackShotCount;
    const regeneratedShotCount = safeTotal > 0 ? Math.min(safeTotal, requestedShotCount) : requestedShotCount;
    const available = safeTotal > 0 && (!redoSegment || safeSegment > 0);
    const ratio = available ? regeneratedShotCount / safeTotal : 0;
    return { available, regeneratedShotCount, totalShotCount: safeTotal, ratio, exceeds20Percent: available && ratio > 0.2 };
}

export function emptyQualityReview(): QualityReview {
    return { items: QUALITY_REVIEW_KEYS.map((key) => ({ key, checked: false })) };
}

export function canApproveSegment(review?: QualityReview): boolean {
    if (!review) return false;
    const itemByKey = new Map(review.items.map((item) => [item.key, item]));
    return QUALITY_REVIEW_KEYS.every((key) => itemByKey.get(key)?.checked === true) && !review.items.some((item) => item.severity === "P0");
}

export function segmentApprovalBlockReason(review?: QualityReview): string | undefined {
    if (!review) return "请先完成七项质检";
    if (review.items.some((item) => item.severity === "P0")) return "仍有未清 P0 问题";
    const itemByKey = new Map(review.items.map((item) => [item.key, item]));
    const unchecked = QUALITY_REVIEW_KEYS.filter((key) => itemByKey.get(key)?.checked !== true).map((key) => QUALITY_REVIEW_LABELS[key]);
    return unchecked.length ? `尚未检查：${unchecked.join("、")}` : undefined;
}

export type DubbingPlanItem = Omit<DubbingTrack, "audioKey" | "durationMs">;

function parseDubbingLine(line: string): Pick<DubbingPlanItem, "type" | "speaker" | "text"> | undefined {
    const value = line.trim();
    if (!value) return undefined;
    const dialogue = value.match(/^出口对白-([^：:]+)[：:]\s*(.+)$/);
    if (dialogue) return { type: "dialogue", speaker: dialogue[1].trim(), text: dialogue[2].trim() };
    const os = value.match(/^OS-([^：:]+)[：:]\s*(.+)$/i);
    if (os) return { type: "os", speaker: os[1].trim(), text: os[2].trim() };
    return { type: "os", speaker: "旁白", text: value };
}

export function buildDubbingPlan(rows: StoryboardRow[], voiceMap: Record<string, string> = {}, defaultVoice = "alloy"): DubbingPlanItem[] {
    let offsetSec = 0;
    const plan: DubbingPlanItem[] = [];
    for (const row of [...rows].sort((left, right) => left.shotNo - right.shotNo)) {
        const line = parseDubbingLine(row.line);
        if (line) {
            const voice = line.type === "os" ? voiceMap[line.speaker] || voiceMap["旁白"] || defaultVoice : voiceMap[line.speaker] || defaultVoice;
            plan.push({ shotId: row.shotId, ...line, plannedOffsetSec: offsetSec, voice });
        }
        offsetSec += Math.max(0, row.durationSec);
    }
    return plan;
}

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
    audio: "音频",
    palette: "色板",
    styleSwatch: "质感样板",
};

function formatAssetCard(card: AssetCard, parentNameById: Map<string, string>) {
    const parentName = card.parentCardId ? parentNameById.get(card.parentCardId) : undefined;
    const derivedFrom = (card.cardType === "action" || card.cardType === "expression" || card.cardType === "outfit") && parentName ? `（衍生自${parentName}）` : "";
    if (card.cardType === "form" && parentName) return `【形态】${card.name}（${parentName}的形态）：${card.anchor}`;
    return `【${ASSET_CARD_TYPE_LABELS[card.cardType]}】${card.name}${derivedFrom}：${card.anchor}`;
}

/**
 * 模板初始节点的正文是"标题 + 换行 + 摘要"的占位文案，不是用户或 Agent 写的内容。
 * 判据只比对摘要那一半：标题会被 Agent 改写（实测改成过「项目 / 剧集｜EP1 起源-门开了」），
 * 让标题参与比对，判据在改名后就会失效、占位文案会被当成正文（Codex 对抗审查 2026-07-27 实锤）。
 */
export function isTemplatePlaceholderContent(node: CanvasNodeData): boolean {
    const content = node.metadata?.content?.trim();
    const summary = node.metadata?.toonflow?.summary?.trim();
    if (!content || !summary) return false;
    const firstBreak = content.indexOf("\n");
    return firstBreak >= 0 && content.slice(firstBreak + 1).trim() === summary;
}

export function readNodeInput(node: CanvasNodeData) {
    const payload = node.metadata?.toonflow?.output?.payload;
    if (payload?.text) return payload.text;
    if (payload?.cards) {
        const parentNameById = new Map(payload.cards.map((card) => [card.cardId, card.name]));
        return payload.cards.map((card) => formatAssetCard(card, parentNameById)).join("\n");
    }
    if (payload?.table) return JSON.stringify(payload.table, null, 2);
    // 锁定表/继承表的产物只落结构化字段(无 text),下游要读到必须在此显式序列化。
    if (payload?.directingLock) return JSON.stringify(payload.directingLock, null, 2);
    if (payload?.continuityTable) return JSON.stringify(payload.continuityTable, null, 2);
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

/**
 * 找一份"真的写过东西"的剧本给创意用。
 * 不能直接 nodes.find(kind === "script")：模板初始的 script 节点带占位文案，把它注进去会让
 * buildCreativePrompt 判定"已有剧本"、对着一份不存在的剧本做体检；画布上还可能有用户复制的
 * 旧剧本节点，取到第一个未必是目标（Codex 对抗审查 2026-07-27 实锤两点）。
 * 优先级：有产物的 > 正文被写过的；都没有就不注入，让创意正常走冷启动模式。
 */
function findAuthoredScript(nodes: CanvasNodeData[]): CanvasNodeData | undefined {
    const scripts = nodes.filter((node) => node.metadata?.toonflow?.kind === "script");
    return scripts.find((node) => node.metadata?.toonflow?.output?.payload.text?.trim()) ?? scripts.find((node) => node.metadata?.content?.trim() && !isTemplatePlaceholderContent(node));
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

    // 创意 P0 的体检模式要对着剧本挑毛病,但模板拓扑里剧本是创意的下游(项目→创意→剧本),
    // 只走上游遍历永远拿不到剧本,于是 buildCreativePrompt 的模式判定必然落到冷启动,凭空另编一个故事
    // (2026-07-27 用户实测:Agent 把剧情写进剧本节点后,创意生成的产出与剧本毫无关系)。
    // 按镜头合同/分镜表既有的做法从全画布直取,不改模板连线以免与既有的创意→剧本连线成环。
    if (kind === "creative" && !inputs.script) {
        const script = findAuthoredScript(nodes);
        if (script) appendInput(inputs, "script", readNodeInput(script));
    }

    const prompt = PROMPT_BUILDERS[kind](buildNodeContext(kind, inputs));
    const { washed, hits } = washPrompt(prompt);
    return { finalPrompt: washed, washHits: hits };
}

export type ToonflowImageGeneration = {
    finalPrompt: string;
    washHits: Array<{ term: string; replacement: string }>;
    referenceKeys: string[];
    /** 构图锁等硬约束参考图:任一读取失败必须中止生成,不得降级。 */
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
    if (card.cardType === "styleSwatch") return [5, 0, 0];
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
    // 音频卡不是图像参考,从图像生成的锚点与参考图里剔除(其 storageKey 是音频媒体键,误入会当图像参考读取失败)。
    const cards = allAssetCards
        .filter((card): card is AssetCard & { storageKey: string } => typeof card.storageKey === "string" && Boolean(card.storageKey) && card.cardType !== "audio")
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
        prompt = buildStoryboardPagePrompt({ rows, shotContracts, actionContracts, spaceRules });
        // blockout 只锁构图与体块，传角色/装备/色板参考会把不该出现的细节带进粗模。
        referenceKeys = [];
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

function videoAssetSortKey(card: AssetCard, characterOrder: Map<string, number>): [number, number, number] {
    if (card.cardType === "character") return [0, characterOrder.get(card.cardId) ?? 0, 0];
    if (card.cardType === "action" || card.cardType === "expression" || card.cardType === "outfit") {
        return [0, card.parentCardId ? characterOrder.get(card.parentCardId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER, card.cardType === "action" ? 1 : card.cardType === "expression" ? 2 : 3];
    }
    if (card.cardType === "prop" || card.cardType === "form") return [1, 0, card.cardType === "prop" ? 0 : 1];
    if (card.cardType === "scene") return [2, 0, 0];
    if (card.cardType === "palette") return [3, 0, 0];
    return [4, 0, 0];
}

function videoWorkbenchSources(nodes: CanvasNodeData[], nodeId: string) {
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
    const spaceRules = nodes.find((node) => node.metadata?.toonflow?.kind === "space-contract")?.metadata?.toonflow?.output?.payload.text;
    const directingLock = nodes.find((node) => node.metadata?.toonflow?.kind === "directing-lock")?.metadata?.toonflow?.output?.payload.directingLock;
    if (!directingLock) throw new Error("请先生成分镜决策锁定表");
    const scriptText = nodes.find((node) => node.metadata?.toonflow?.kind === "script")?.metadata?.toonflow?.output?.payload.text;
    const allAssetCards = nodes.find((node) => node.metadata?.toonflow?.kind === "assets")?.metadata?.toonflow?.output?.payload.cards ?? [];
    const characterOrder = new Map(allAssetCards.filter((card) => card.cardType === "character").map((card, index) => [card.cardId, index]));
    const withStorageKey = allAssetCards.filter((card): card is AssetCard & { storageKey: string } => typeof card.storageKey === "string" && Boolean(card.storageKey));
    const cards = withStorageKey
        .filter((card) => card.cardType !== "audio")
        .sort((left, right) => {
            const leftKey = videoAssetSortKey(left, characterOrder);
            const rightKey = videoAssetSortKey(right, characterOrder);
            return leftKey[0] - rightKey[0] || leftKey[1] - rightKey[1] || leftKey[2] - rightKey[2];
        });
    const assetKeys = cards.map((card) => card.storageKey);

    return {
        target,
        segmentId: targetToonflow.segmentId,
        rows,
        warnings,
        shotContracts,
        actionContracts,
        spaceRules,
        directingLock,
        scriptText,
        cards,
        assetKeys,
        incomingSeam: directingLock.seams?.find((seam) => seam.toSegmentId === targetToonflow.segmentId),
        outgoingSeam: directingLock.seams?.find((seam) => seam.fromSegmentId === targetToonflow.segmentId),
    };
}

export type ToonflowModule4Composition = { finalPrompt: string; washHits: WashHit[]; warnings: string[]; finalize: (text: string) => string };

export function buildToonflowModule4Composition(nodes: CanvasNodeData[], connections: CanvasConnection[], nodeId: string, note?: string, feedback?: string[]): ToonflowModule4Composition {
    void connections;
    const source = videoWorkbenchSources(nodes, nodeId);
    const prompt = buildModule4ComposePrompt({
        rows: source.rows,
        shotContracts: source.shotContracts,
        actionContracts: source.actionContracts,
        assets: source.cards,
        directingLock: source.directingLock,
        incomingSeam: source.incomingSeam,
        outgoingSeam: source.outgoingSeam,
        spaceRules: source.spaceRules,
        scriptText: source.scriptText,
        note,
        feedback,
    });
    const { washed, hits } = washPrompt(prompt);
    return {
        finalPrompt: washed,
        washHits: hits,
        warnings: source.warnings,
        finalize: (text) =>
            finalizeModule4Text(
                {
                    rows: source.rows,
                    shotContracts: source.shotContracts,
                    actionContracts: source.actionContracts,
                    assets: source.cards,
                    directingLock: source.directingLock,
                    incomingSeam: source.incomingSeam,
                    outgoingSeam: source.outgoingSeam,
                    spaceRules: source.spaceRules,
                    scriptText: source.scriptText,
                    note,
                    feedback,
                },
                text,
            ),
    };
}

export type ToonflowVideoGeneration = ToonflowImageGeneration & { module4Text: string };

export function buildToonflowVideoGeneration(nodes: CanvasNodeData[], connections: CanvasConnection[], nodeId: string): ToonflowVideoGeneration {
    void connections;
    const source = videoWorkbenchSources(nodes, nodeId);
    const module4Text = source.target.metadata?.toonflow?.output?.payload.text?.trim();
    if (!module4Text) throw new Error("请先合成并确认Module4提示词");
    const validation = validateModule4(module4Text);
    if (!validation.ok) throw new Error(`Module4校验未通过：${validation.issues.map((issue) => issue.message).join("；")}`);

    // 排除已归档实例:分镜表回退使旧段重现时,同 segmentId 会同时存在归档与活跃两个实例,命中归档会拿到过期产物。
    const storyboardKey = nodes.find(
        (node) =>
            node.metadata?.toonflow?.kind === "storyboard-page" &&
            node.metadata.toonflow.segmentId === source.segmentId &&
            !node.metadata.toonflow.archived,
    )?.metadata?.toonflow?.output?.payload.imageKeys?.[0];
    if (!storyboardKey) throw new Error("请先生成该段故事板页");

    const referenceKeys = [...source.assetKeys, storyboardKey];
    // blockout 故事板页是视频的构图基准,读取失败必须中止:失去镜序与构图锁会退化为文生视频。
    const mandatoryKeys = [storyboardKey];
    return { finalPrompt: module4Text, module4Text, washHits: [], referenceKeys, mandatoryKeys, warnings: source.warnings };
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

function videoHistory(toonflow: NonNullable<CanvasNodeData["metadata"]>["toonflow"], currentKeys: string[]) {
    const previous = toonflow?.output;
    const allHistory = previous ? [...(toonflow.history ?? []), previous] : [...(toonflow?.history ?? [])];
    const history = allHistory.slice(-VERSION_LIMIT_VIDEO);
    const removedHistory = allHistory.slice(0, Math.max(0, allHistory.length - VERSION_LIMIT_VIDEO));
    const referencedKeys = new Set([...currentKeys, ...history.flatMap((output) => output.payload.videoKeys ?? [])]);
    const orphanedKeys = Array.from(new Set(removedHistory.flatMap((output) => output.payload.videoKeys ?? []))).filter((key) => !referencedKeys.has(key));
    return { previous, history, orphanedKeys };
}

export function applyModule4CompositionSuccess(
    node: CanvasNodeData,
    rawText: string,
    washHits: WashHit[],
    upstreamVersions?: Record<string, number>,
): { node: CanvasNodeData; orphanedKeys: string[] } {
    const toonflow = node.metadata?.toonflow;
    if (!toonflow?.segmentId || toonflow.kind !== "video-workbench") return { node, orphanedKeys: [] };
    const { previous, history, orphanedKeys } = videoHistory(toonflow, []);
    const output: NodeOutput = {
        nodeId: node.id,
        kind: toonflow.kind,
        version: (previous?.version ?? 0) + 1,
        status: onGenerateSuccess(toonflow.status),
        payload: { text: rawText },
        upstreamVersions: upstreamVersions ?? previous?.upstreamVersions ?? {},
        generationMeta: generationMeta(node, washHits),
        generatedAt: new Date().toISOString(),
    };
    return {
        node: {
            ...node,
            metadata: {
                ...node.metadata,
                content: rawText,
                status: "success",
                errorDetails: undefined,
                toonflow: { ...toonflow, status: output.status, output, history },
            },
        },
        orphanedKeys,
    };
}

export function applyModule4CompositionFailure(node: CanvasNodeData, rawText: string, issues: string[], washHits: WashHit[]): CanvasNodeData {
    const failed = failedGenerationNode(node, `Module4校验未通过：${issues.join("；")}`, washHits);
    const toonflow = failed.metadata?.toonflow;
    const output = toonflow?.output;
    if (!toonflow || !output) return failed;
    return {
        ...failed,
        metadata: {
            ...failed.metadata,
            content: rawText,
            toonflow: { ...toonflow, output: { ...output, payload: { ...output.payload, text: rawText, module4Issues: issues } } },
        },
    };
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
    // 创意读剧本是隐式依赖:剧本在创意的下游,连线方向表达不了它(反向加边会与既有的 creative→script 成环)。
    // 生成时确实读了剧本,这里就必须把它记进快照,否则剧本出新版本时创意不会失效、画布会一直把基于旧剧本的
    // 创意显示为有效(Codex 对抗审查 2026-07-27 实锤)。
    if (nodeById.get(nodeId)?.metadata?.toonflow?.kind === "creative") {
        const script = findAuthoredScript(nodes);
        const version = script?.metadata?.toonflow?.output?.version;
        if (script && typeof version === "number") snapshot[script.id] = version;
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
    } else if (toonflow.kind === "directing-lock") {
        // 锁定表是单个 JSON 对象(A 表 global + B 表 segments + 缝合同 seams),不是数组。
        const parsed = parseModelJson(DirectingLockSchema, rawText);
        if (!parsed.ok) return failedGenerationNode(node, parsed.error, washHits);
        payload = { directingLock: parsed.data };
    } else if (toonflow.kind === "continuity-table") {
        // 跨段状态继承表同样是单个 JSON 对象,五类锁定项各为一个数组。
        const parsed = parseModelJson(ContinuityTableSchema, rawText);
        if (!parsed.ok) return failedGenerationNode(node, parsed.error, washHits);
        payload = { continuityTable: parsed.data };
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

    // 纯文本产物按内容撑高。表格/锁定表/继承表的产物是结构化视图,rawText 是 JSON,按它的长度算高度没有意义。
    // 基准取生成前的高度(流式撑高过就用 streamRestoreHeight 里记着的原值),只增不减。
    const baseHeight = toonflow.streamRestoreHeight ?? node.height;
    const fittedHeight = payload.text === undefined ? baseHeight : fitHeightToText(node, payload.text, baseHeight);

    return {
        ...node,
        height: fittedHeight,
        metadata: {
            ...node.metadata,
            content: rawText,
            status: "success" as const,
            errorDetails: undefined,
            toonflow: {
                ...toonflow,
                status: output.status,
                output,
                history,
                // 正常成功路径拿到的是不含流式展示字段的准备快照(project.tsx 刻意不把流式态同步进 nodesRef),
                // 所以这里通常是 undefined、走不到改写。留着是为防守带流式态的节点进来时,
                // 收尾的 collapseNodeAfterStream 用旧值把刚撑好的高度还原回去。
                ...(toonflow.streamRestoreHeight === undefined ? {} : { streamRestoreHeight: fittedHeight }),
            },
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
    module4Text: string,
    washHits: Array<{ term: string; replacement: string }>,
    upstreamVersions?: Record<string, number>,
    taskId?: string,
): { node: CanvasNodeData; orphanedKeys: string[] } {
    const toonflow = node.metadata?.toonflow;
    if (!toonflow?.segmentId || toonflow.kind !== "video-workbench") {
        return { node, orphanedKeys: [] };
    }

    const { previous, history, orphanedKeys } = videoHistory(toonflow, storageKeys);
    const meta = generationMeta(node, washHits);
    const output: NodeOutput = {
        nodeId: node.id,
        kind: toonflow.kind,
        version: (previous?.version ?? 0) + 1,
        status: onGenerateSuccess(toonflow.status),
        payload: { text: module4Text, videoKeys: [...storageKeys] },
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
        if (toonflow.kind === "video-workbench" && currentOutput.payload.videoKeys?.length && !canApproveSegment(currentOutput.payload.qualityReview)) return node;
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

export function applySegmentQualityReview(nodes: CanvasNodeData[], nodeId: string, qualityReview: QualityReview): CanvasNodeData[] {
    return nodes.map<CanvasNodeData>((node) => {
        const toonflow = node.metadata?.toonflow;
        const output = toonflow?.output;
        if (node.id !== nodeId || toonflow?.kind !== "video-workbench" || !output?.payload.videoKeys?.length) return node;
        return {
            ...node,
            metadata: {
                ...node.metadata,
                toonflow: { ...toonflow, output: { ...output, payload: { ...output.payload, qualityReview } } },
            },
        };
    });
}

export function applyAudioMixVoiceMap(nodes: CanvasNodeData[], nodeId: string, voiceMap: Record<string, string>): CanvasNodeData[] {
    return nodes.map<CanvasNodeData>((node) => {
        const toonflow = node.metadata?.toonflow;
        if (node.id !== nodeId || toonflow?.kind !== "audio-mix") return node;
        return { ...node, metadata: { ...node.metadata, toonflow: { ...toonflow, voiceMap } } };
    });
}

export function applyAudioMixSuccess(node: CanvasNodeData, dubbing: DubbingTrack[], upstreamVersions?: Record<string, number>): { node: CanvasNodeData; orphanedKeys: string[] } {
    const toonflow = node.metadata?.toonflow;
    if (toonflow?.kind !== "audio-mix" || !toonflow.segmentId) return { node, orphanedKeys: [] };
    const previous = toonflow.output;
    const allHistory = previous ? [...(toonflow.history ?? []), previous] : [...(toonflow.history ?? [])];
    const history = allHistory.slice(-VERSION_LIMIT_TEXT);
    const removedHistory = allHistory.slice(0, Math.max(0, allHistory.length - VERSION_LIMIT_TEXT));
    const audioKeys = dubbing.map((item) => item.audioKey);
    const referencedKeys = new Set([...audioKeys, ...history.flatMap((output) => output.payload.audioKeys ?? [])]);
    const orphanedKeys = Array.from(new Set(removedHistory.flatMap((output) => output.payload.audioKeys ?? []))).filter((key) => !referencedKeys.has(key));
    const output: NodeOutput = {
        nodeId: node.id,
        kind: "audio-mix",
        version: (previous?.version ?? 0) + 1,
        status: onGenerateSuccess(toonflow.status),
        segmentIndex: toonflow.segmentIndex,
        payload: { audioKeys, dubbing },
        upstreamVersions: upstreamVersions ?? previous?.upstreamVersions ?? {},
        generationMeta: generationMeta(node, []),
        generatedAt: new Date().toISOString(),
    };
    return {
        node: { ...node, metadata: { ...node.metadata, status: "success", errorDetails: undefined, toonflow: { ...toonflow, status: output.status, output, history } } },
        orphanedKeys,
    };
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
    // 连线之外的隐式依赖(创意读剧本)在图上没有边,只在产物的 upstreamVersions 里留了痕。
    // 反查这份"我生成时依赖了谁的哪个版本"的记录,谁记着我的旧版本谁就过期了。
    // 只标直接依赖者、不再往下传:它自己重新生成产出新版本时,会再走一次本函数把它的下游带上。
    for (const node of nodes) {
        if (node.id === nodeId || staleNodeIds.has(node.id)) continue;
        const recorded = node.metadata?.toonflow?.output?.upstreamVersions?.[nodeId];
        if (typeof recorded === "number" && recorded < newVersion) staleNodeIds.add(node.id);
    }
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
    return nodes.map((original) => {
        if (!original.metadata?.toonflow) return original;
        // 流式回显是纯展示态:刷新后一律剥掉残留文本并还原被撑高的高度,否则节点会永远卡在撑高状态。
        const node = collapseNodeAfterStream(original);
        const toonflow = node.metadata!.toonflow!;
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
        // 注意:这里回落到 node(已剥离流式)而不是 original,流式残留才不会被短路带回来。
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

export type ExportDubbingTrack = DubbingTrack & { segmentId: string; segmentIndex: number };

export type ExportDubbingCollection = {
    tracks: ExportDubbingTrack[];
    approvedSegments: number;
    totalSegments: number;
    allApproved: boolean;
};

export function collectExportDubbing(nodes: CanvasNodeData[]): ExportDubbingCollection {
    const video = collectExportSegments(nodes);
    const allSegmentIds = new Set<string>();
    for (const node of nodes) {
        const toonflow = node.metadata?.toonflow;
        if (toonflow?.kind === "video-workbench" && toonflow.segmentId && !toonflow.archived) allSegmentIds.add(toonflow.segmentId);
    }
    const audioBySegment = new Map<string, CanvasNodeData>();
    for (const node of nodes) {
        const toonflow = node.metadata?.toonflow;
        if (toonflow?.kind !== "audio-mix" || !toonflow.segmentId || toonflow.archived) continue;
        const existing = audioBySegment.get(toonflow.segmentId);
        if (!existing || (toonflow.output?.version ?? 0) > (existing.metadata?.toonflow?.output?.version ?? 0)) audioBySegment.set(toonflow.segmentId, node);
    }
    const approvedSegments = [...allSegmentIds].filter((segmentId) => audioBySegment.get(segmentId)?.metadata?.toonflow?.status === "approved").length;
    const exportIndexBySegment = new Map(video.segments.map((segment, index) => [segment.segmentId, index]));
    const tracks: ExportDubbingTrack[] = [];
    for (const [segmentId, node] of audioBySegment) {
        const toonflow = node.metadata?.toonflow;
        const segmentIndex = exportIndexBySegment.get(segmentId);
        if (segmentIndex === undefined || toonflow?.status !== "approved") continue;
        for (const track of toonflow.output?.payload.dubbing ?? []) tracks.push({ ...track, segmentId, segmentIndex });
    }
    const totalSegments = allSegmentIds.size;
    return {
        tracks,
        approvedSegments,
        totalSegments,
        allApproved: totalSegments > 0 && video.approvedCount === totalSegments && approvedSegments === totalSegments,
    };
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

export function matchSeamContract(boundary: Pick<SeamBoundary, "fromSegmentId" | "toSegmentId">, lock?: DirectingLock): SeamContract | undefined {
    return lock?.seams?.find((seam) => seam.fromSegmentId === boundary.fromSegmentId && seam.toSegmentId === boundary.toSegmentId);
}

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
    if (payload.directingLock) return JSON.stringify(payload.directingLock, null, 2);
    if (payload.continuityTable) return JSON.stringify(payload.continuityTable, null, 2);
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

// ============================================================
// 一键修改方案(设计文档 4.5):把定点修补丁落回分镜表与镜头合同
// ============================================================

type StoryboardRowPatchField = (typeof STORYBOARD_ROW_PATCH_FIELDS)[number];
type ShotContractPatchField = (typeof SHOT_CONTRACT_PATCH_FIELDS)[number];

const STORYBOARD_ROW_PATCH_FIELD_SET: ReadonlySet<string> = new Set(STORYBOARD_ROW_PATCH_FIELDS);
const SHOT_CONTRACT_PATCH_FIELD_SET: ReadonlySet<string> = new Set(SHOT_CONTRACT_PATCH_FIELDS);

function isStoryboardRowPatchField(field: string): field is StoryboardRowPatchField {
    return STORYBOARD_ROW_PATCH_FIELD_SET.has(field);
}

function isShotContractPatchField(field: string): field is ShotContractPatchField {
    return SHOT_CONTRACT_PATCH_FIELD_SET.has(field);
}

export type DiversityPatchApplyInput = {
    rows: StoryboardRow[];
    shotContracts?: ShotContract[];
};

/** 被跳过的补丁 + 跳过原因;UI 需要如实告诉用户"这条没应用",不能静默丢弃。 */
export type DiversityPatchSkip = {
    patch: DiversityPatchItem;
    reason: string;
};

export type DiversityPatchApplyResult = {
    rows: StoryboardRow[];
    shotContracts: ShotContract[];
    applied: DiversityPatchItem[];
    skipped: DiversityPatchSkip[];
};

/**
 * 应用定点修补丁,返回新的分镜表行与镜头合同。纯函数:入参不被修改,未被补丁点名的行/合同原样沿用引用。
 *
 * 部分应用由调用方决定——只传用户勾选的那几条即可,本函数不做筛选。
 * 补丁指向不存在的 shotId 或非法字段时跳过该条并记进 skipped,同批其余补丁照常应用(不静默丢弃、不整批失败)。
 * 应用后不重跑质量检查,由调用方自行再调 runQualityCheck。
 */
export function applyDiversityPatch(input: DiversityPatchApplyInput, patches: DiversityPatchItem[]): DiversityPatchApplyResult {
    let rows = input.rows;
    let shotContracts = input.shotContracts ?? [];
    const applied: DiversityPatchItem[] = [];
    const skipped: DiversityPatchSkip[] = [];

    for (const patch of patches) {
        if (patch.target === "storyboardRow") {
            if (!isStoryboardRowPatchField(patch.field)) {
                skipped.push({ patch, reason: `分镜表行没有可定点修的字段「${patch.field}」(可改字段:${STORYBOARD_ROW_PATCH_FIELDS.join("、")})` });
                continue;
            }
            const index = rows.findIndex((row) => row.shotId === patch.shotId);
            if (index === -1) {
                skipped.push({ patch, reason: `分镜表里找不到镜头 ${patch.shotId}` });
                continue;
            }
            if (rows === input.rows) rows = [...rows];
            const nextRow = { ...rows[index] };
            nextRow[patch.field] = patch.newValue;
            rows[index] = nextRow;
            applied.push(patch);
            continue;
        }

        if (!isShotContractPatchField(patch.field)) {
            skipped.push({ patch, reason: `镜头合同没有可定点修的字段「${patch.field}」(可改字段:${SHOT_CONTRACT_PATCH_FIELDS.join("、")})` });
            continue;
        }
        const index = shotContracts.findIndex((contract) => contract.shotId === patch.shotId);
        if (index === -1) {
            skipped.push({ patch, reason: `镜头合同里找不到镜头 ${patch.shotId}` });
            continue;
        }
        if (shotContracts === input.shotContracts) shotContracts = [...shotContracts];
        const nextContract = { ...shotContracts[index] };
        nextContract[patch.field] = patch.newValue;
        shotContracts[index] = nextContract;
        applied.push(patch);
    }

    return { rows, shotContracts, applied, skipped };
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
