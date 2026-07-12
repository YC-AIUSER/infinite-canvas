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

const TOONFLOW_NODE_KINDS = [
    "project",
    "script",
    "assets",
    "space-contract",
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

export const AudioLineSchema = z.object({
    lineId: z.string(),
    role: z.string(),
    text: z.string(),
    shotId: z.string(),
    order: z.number(),
});

export type AudioLine = z.infer<typeof AudioLineSchema>;

export const AssetCardSchema = z.object({
    cardId: z.string(),
    cardType: z.enum(["character", "scene", "prop", "action", "expression", "outfit", "form"]),
    name: z.string(),
    anchor: z.string(),
    parentCardId: z.string().optional(),
    storageKey: z.string().optional(),
});

export type AssetCard = z.infer<typeof AssetCardSchema>;

export function validateAssetCards(cards: AssetCard[]): string[] {
    const cardById = new Map(cards.map((card) => [card.cardId, card]));
    const issues: string[] = [];
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
