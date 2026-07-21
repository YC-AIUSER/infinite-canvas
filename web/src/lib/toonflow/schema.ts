/**
 * NodeOutput 保存节点在七态流转中的版本化产物与生成上下文：
 *
 * empty -> generating -> review -> approved
 *   |          |          |          |
 *   +----------+----------+----------+--> stale -> generating
 *              +--> failed -----------> generating
 *   +----------------------------------> skipped
 */
import { z } from "zod";

import type { ToonflowNodeKind } from "../../types/canvas";

export const NODE_STATUSES = ["empty", "generating", "review", "approved", "failed", "stale", "skipped"] as const;

export type NodeStatus = (typeof NODE_STATUSES)[number];

const NodeStatusSchema = z.enum(NODE_STATUSES);

export const TOONFLOW_NODE_KINDS = [
    "project",
    "creative",
    "script",
    "assets",
    "space-contract",
    "continuity-table",
    "directing-lock",
    "storyboard-table",
    "shot-contract",
    "action-contract",
    "storyboard-page",
    "keyframes",
    "compliance",
    "video-workbench",
    "seam-check",
    "audio-mix",
    "export",
] as const satisfies readonly ToonflowNodeKind[];

const ToonflowNodeKindSchema = z.enum(TOONFLOW_NODE_KINDS);

const STATUS_MIGRATIONS: Record<string, NodeStatus> = {
    未开始: "empty",
    待生成: "empty",
    生成中: "generating",
    生成失败: "failed",
    待验收: "review",
    已通过: "approved",
    已跳过: "skipped",
};

export function migrateToonflowStatus(old: string): NodeStatus {
    return STATUS_MIGRATIONS[old.trim()] ?? "empty";
}

export const GenerationMetaSchema = z.object({
    model: z.string(),
    provider: z.string(),
    taskId: z.string().optional(),
    sentPrompt: z.string(),
    washedPrompt: z.string().optional(),
    referenceOrder: z.array(z.string()).optional(),
    durationMs: z.number().optional(),
    costHint: z.number().optional(),
});

export type GenerationMeta = z.infer<typeof GenerationMetaSchema>;

export const StoryboardRowSchema = z.object({
    segmentId: z.string(),
    shotId: z.string(),
    shotNo: z.number(),
    scale: z.string(), // 景别
    angle: z.string(), // 机位角度
    action: z.string(), // 动作
    line: z.string(), // 台词
    sfx: z.string(), // 音效
    mood: z.string(), // 情绪
    durationSec: z.number(),
    assetSlots: z.array(z.string()).optional(),
});

export type StoryboardRow = z.infer<typeof StoryboardRowSchema>;

export const ShotContractSchema = z.object({
    shotId: z.string(),
    scale: z.string(),
    angle: z.string(),
    movement: z.string(),
    speed: z.string(),
    subjectRelation: z.string(),
    endpoint: z.string(),
    inOut: z.object({
        include: z.array(z.string()),
        exclude: z.array(z.string()),
    }),
    // 口型要求:台词剥离后视频只出音效,谁张嘴谁闭口只能靠 prompt 控制(设计文档 4.4)。
    lipSync: z
        .object({
            speaking: z.array(z.string()), // 本镜张嘴说话的角色
            silent: z.array(z.string()), // 本镜必须闭口的角色(旁白/内心段落全员闭口)
        })
        .optional(),
});

export type ShotContract = z.infer<typeof ShotContractSchema>;

export const ActionContractSchema = z.object({
    shotId: z.string(),
    cause: z.string(),
    process: z.string(),
    consequence: z.string(),
    endState: z.string(),
});

export type ActionContract = z.infer<typeof ActionContractSchema>;

// ============================================================
// 「一键修改方案」定点修补丁(设计文档 4.5)
// 检查器判不达标后调模型产出的定点修改集:只改点名的那几镜、其余字段原样不动(不是整表重生成)。
// prompt 见 prompts.ts 的 buildDiversityRepairPrompt,应用逻辑见 node-runtime.ts 的 applyDiversityPatch。
// ============================================================

/** 补丁能落到的两类产物。四维里的运镜只存在于镜头合同(ShotContract.movement),不在分镜表行上。 */
export const DIVERSITY_PATCH_TARGETS = ["storyboardRow", "shotContract"] as const;

export type DiversityPatchTarget = (typeof DIVERSITY_PATCH_TARGETS)[number];

/** 分镜表行上允许被定点修的字段:只开放四维多样性涉及的镜级字段,不开放 action/line 等内容字段,避免补丁越权改剧情。 */
export const STORYBOARD_ROW_PATCH_FIELDS = ["scale", "angle"] as const;

/** 镜头合同上允许被定点修的字段。 */
export const SHOT_CONTRACT_PATCH_FIELDS = ["scale", "angle", "movement"] as const;

/**
 * 指回某一条质量检查项:kind 逐字对应 QualityCheckItem.kind,段级项另带 segmentId。
 * 刻意用 z.string() 而非 QualityCheckKind 枚举——quality-check.ts 依赖本文件,反向引用会成环;
 * 且模型把 kind 写错时不该让整批补丁解析失败(决策 D4:只提示不阻断)。
 */
export const QualityCheckRefSchema = z.object({
    kind: z.string(),
    segmentId: z.string().optional(),
});

export type QualityCheckRef = z.infer<typeof QualityCheckRefSchema>;

/**
 * 一条补丁 = 对某一镜的某一个字段的一次定点修改。target + shotId + field 三者共同定位,不产生歧义
 * (scale/angle 在分镜表行与镜头合同上同名,只给 field 无法区分改的是哪一份产物)。
 * field 用 z.string() 而非枚举:字段名非法时由 applyDiversityPatch 跳过并报告,不连累同批其余补丁。
 */
export const DiversityPatchItemSchema = z.object({
    shotId: z.string(),
    target: z.enum(DIVERSITY_PATCH_TARGETS),
    field: z.string(),
    oldValue: z.string(),
    newValue: z.string(),
    reason: z.string(),
    /** 本条修改解决的是哪几条不达标项 */
    fixes: z.array(QualityCheckRefSchema).optional(),
});

export type DiversityPatchItem = z.infer<typeof DiversityPatchItemSchema>;

export const DiversityPatchSchema = z.object({
    /** 本补丁集对应的不达标检查项,供 UI 回链到标红项并支持「忽略」 */
    targets: z.array(QualityCheckRefSchema),
    patches: z.array(DiversityPatchItemSchema),
    summary: z.string().optional(),
});

export type DiversityPatch = z.infer<typeof DiversityPatchSchema>;

// P3 分镜决策锁定表 A 表:全局一次锁死,后续环节只引用不复判(设计文档 4.1)。
// 词条值一律用 z.string():封闭词库合规由检查器报告,不在 schema 层硬阻断(决策 D4)。
export const DirectingLockGlobalSchema = z.object({
    visualStyle: z.string(), // 视觉风格
    colorGrading: z.string(), // 调色主策略
    lighting: z.string(), // 布光主策略
    cameraTone: z.string(), // 运镜基调
    performanceLevel: z.string(), // 表演档位 L1-L5
    unifiedStyleString: z.string(), // 全段统一风格串
    motifs: z.array(z.string()), // 母题必落项
});

export type DirectingLockGlobal = z.infer<typeof DirectingLockGlobalSchema>;

// B 表:逐段锁构图与镜头语法。
export const DirectingLockSegmentSchema = z.object({
    segmentId: z.string(),
    compositionPrimary: z.string(), // 构图主策略
    compositionSecondary: z.string(), // 构图次策略
    compositionDiversity: z.string(), // 构图多样性
    cameraType: z.string(), // 运镜类型
    scaleRange: z.string(), // 景别跨度
    angleType: z.string(), // 角度类型
    openingType: z.string(), // 开场类型
});

export type DirectingLockSegment = z.infer<typeof DirectingLockSegmentSchema>;

// 缝合同四行:分段即分缝,缝在第一块签,供故事板画进画面、视频层核对(设计文档 4.3)。
export const SeamContractSchema = z.object({
    fromSegmentId: z.string(),
    toSegmentId: z.string(),
    prevEndBeat: z.string(), // 上段末拍:动作做到中间态截止
    nextFirstPanel: z.string(), // 本段首格:同一动作的后半段,禁止重新建立空间
    scaleOrMotivation: z.string(), // 景别跳档或运镜动机
    soundBridge: z.string(), // 声音桥:J-cut / L-cut(后期怎么编排台词轨与音效轨)
    // 音频边界:生成时就别造出跨缝的持续音,让缝天生可切。与 soundBridge 分工不同——
    // soundBridge 管后期编排,本行管生成约束,落进两侧段视频的生成 prompt。
    // 由来:跑刀 v3.17 实战撞出「墩柜声与人声同帧不可分」,想在那儿裁一刀声音必然带伤。
    // 台词剥离(设计文档 4.4)只解决了人声,视频自带的环境音效仍由模型烧进视频轨、仍会跨缝。
    // 事后发现切不开只能绕,所以把它前置成生成要求——同铁律 11 ⓪「缝在装配层消灭」的思路。
    audioBoundary: z.string().optional(),
});

export type SeamContract = z.infer<typeof SeamContractSchema>;

export const DirectingLockSchema = z.object({
    global: DirectingLockGlobalSchema,
    segments: z.array(DirectingLockSegmentSchema).optional(),
    seams: z.array(SeamContractSchema).optional(),
});

export type DirectingLock = z.infer<typeof DirectingLockSchema>;

// 跨段状态继承表的一项:名称 + 锁定值。
export const ContinuityEntrySchema = z.object({
    name: z.string(),
    lockedValue: z.string(),
});

export type ContinuityEntry = z.infer<typeof ContinuityEntrySchema>;

// 全片一张,逐段更新;不适用的类目可整项缺省(设计文档 4.1)。
export const ContinuityTableSchema = z.object({
    propWhitelist: z.array(ContinuityEntrySchema).optional(), // 桌面道具白名单:只许被角色的手改变
    blocking: z.array(ContinuityEntrySchema).optional(), // 人物站位与姿态
    lightingWeather: z.array(ContinuityEntrySchema).optional(), // 光向与天气
    characterGear: z.array(ContinuityEntrySchema).optional(), // 角色装备
    leftovers: z.array(ContinuityEntrySchema).optional(), // 遗留物
});

export type ContinuityTable = z.infer<typeof ContinuityTableSchema>;

export const AudioLineSchema = z.object({
    lineId: z.string(),
    role: z.string(),
    text: z.string(),
    shotId: z.string(),
    order: z.number(),
    // 出口对白/旁白内心/音效;决定口型要求与配音轨(设计文档 4.4)。旧画布无此字段,故 optional。
    type: z.enum(["dialogue", "os", "sfx"]).optional(),
});

export type AudioLine = z.infer<typeof AudioLineSchema>;

export const AssetCardSchema = z.object({
    cardId: z.string(),
    // palette = ST 全片色板（13 色冷暖双调），P2 资产阶段开头出、之后所有图像生成拿它当调色参考。
    // 追加枚举值只放宽取值域,旧画布的卡不带 palette、读取不受影响(设计文档 4.8)。
    cardType: z.enum(["character", "scene", "prop", "action", "expression", "outfit", "form", "audio", "palette"]),
    name: z.string(),
    anchor: z.string(),
    parentCardId: z.string().optional(),
    // 资产卡图片一律存储键,禁止 dataUrl 写入(与媒体键同规则,防导入数据把整图塞进画布持久化)。
    storageKey: z
        .string()
        .refine((value) => !value.startsWith("data:"), { message: "资产卡图片必须使用存储键，禁止 dataUrl" })
        .optional(),
});

export type AssetCard = z.infer<typeof AssetCardSchema>;

export function validateAssetCards(cards: AssetCard[]): string[] {
    const cardById = new Map(cards.map((card) => [card.cardId, card]));
    const issues: string[] = [];
    // 重复 cardId 会让 cardById(取最后项)与按名/按图的取首项逻辑指向不同对象,先拦下。
    const seenCardIds = new Set<string>();
    const reportedDuplicates = new Set<string>();
    for (const card of cards) {
        if (seenCardIds.has(card.cardId)) {
            if (!reportedDuplicates.has(card.cardId)) {
                issues.push(`资产卡 cardId“${card.cardId}”重复,请确保每张卡的 cardId 唯一`);
                reportedDuplicates.add(card.cardId);
            }
        } else {
            seenCardIds.add(card.cardId);
        }
    }
    for (const card of cards) {
        const requiresParent = card.cardType === "action" || card.cardType === "expression" || card.cardType === "outfit";
        if (!requiresParent && card.cardType !== "form") continue;
        if (!card.parentCardId) {
            if (requiresParent) issues.push(`衍生卡“${card.name}”缺少父卡`);
            continue;
        }
        const parent = cardById.get(card.parentCardId);
        const cardLabel = card.cardType === "form" ? "形态卡" : "衍生卡";
        if (!parent) {
            issues.push(`${cardLabel}“${card.name}”指向不存在的父卡`);
        } else if (parent.cardType !== "character") {
            issues.push(`${cardLabel}“${card.name}”的父卡不是角色卡`);
        }
    }
    return issues;
}

export const MediaKeySchema = z.string().refine((value) => !value.startsWith("data:"), {
    message: "历史记录禁止保存 dataUrl，请使用媒体存储键",
});

export type MediaKey = z.infer<typeof MediaKeySchema>;

export const NodeOutputSchema = z.object({
    nodeId: z.string(),
    kind: ToonflowNodeKindSchema,
    version: z.number(),
    status: NodeStatusSchema,
    segmentIndex: z.number().optional(),
    payload: z.object({
        text: z.string().optional(),
        table: z.array(StoryboardRowSchema).optional(),
        imageKeys: z.array(MediaKeySchema).optional(),
        videoKeys: z.array(MediaKeySchema).optional(),
        audioKeys: z.array(MediaKeySchema).optional(),
        shotPrompts: z.record(z.string(), z.string()).optional(),
        audioLines: z.array(AudioLineSchema).optional(),
        cards: z.array(AssetCardSchema).optional(),
        directingLock: DirectingLockSchema.optional(),
        continuityTable: ContinuityTableSchema.optional(),
    }),
    upstreamVersions: z.record(z.string(), z.number()),
    generationMeta: GenerationMetaSchema.optional(),
    error: z.string().optional(),
    generatedAt: z.string(),
});

export type NodeOutput = z.infer<typeof NodeOutputSchema>;

export const VERSION_LIMIT_TEXT = 10;
export const VERSION_LIMIT_IMAGE = 5;
export const VERSION_LIMIT_VIDEO = 3;

function extractJsonText(rawText: string): string {
    const normalized = rawText
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
    const start = normalized.search(/[\[{]/);

    if (start === -1) {
        throw new Error("未找到 JSON 对象或数组");
    }

    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (let index = start; index < normalized.length; index += 1) {
        const character = normalized[index];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }

        if (character === '"') {
            inString = true;
        } else if (character === "{" || character === "[") {
            stack.push(character);
        } else if (character === "}" || character === "]") {
            const opening = stack.pop();
            const matches = (opening === "{" && character === "}") || (opening === "[" && character === "]");

            if (!matches) {
                throw new Error("JSON 括号不匹配");
            }
            if (stack.length === 0) {
                return normalized.slice(start, index + 1);
            }
        }
    }

    throw new Error("JSON 内容未闭合");
}

function formatZodError(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "根节点";
            return `${path}: ${issue.message}`;
        })
        .join("；");
}

export function parseModelJson<T>(schema: z.ZodType<T>, rawText: string): { ok: true; data: T } | { ok: false; error: string } {
    let parsed: unknown;

    try {
        parsed = JSON.parse(extractJsonText(rawText));
    } catch (error) {
        return {
            ok: false,
            error: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
        };
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
        return { ok: false, error: `JSON 校验失败：${formatZodError(result.error)}` };
    }

    return { ok: true, data: result.data };
}
