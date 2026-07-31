/**
 * 出图后的单格视觉闸门：把候选格与参考图拼成一张对比板，交多模态模型逐条粗筛，产出建议供人拍板。
 *
 * 三条承重设计（改前先读）：
 * 1. 判定问句只来自失败模式登记表里 gateEnabled 的条目（failure-mode-registry.ts）。新增或停用一条
 *    只改登记表数据，闸门代码不动。
 * 2. 保守通过：只有模型明确回答 yes 才算命中；no、unsure、字段缺失、解析失败、请求异常一律落在通过侧。
 *    闸门误杀一次，人就开始无视它；漏判只是回到人工肉眼粗筛的现状。
 * 3. 命中后区分病因：画面没照描述做 → 建议重抽；描述本身不可画或自相矛盾 → 建议改分镜文字，且必须
 *    带具体修改建议（拿不出建议就降级为重抽，不允许出现"让你改但不说改什么"的结论）。
 *
 * 闸门只产出结论，绝不自动删除、覆盖或重抽任何产物。
 */
import { requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import { modelMatchesCapability, type AiConfig } from "@/stores/use-config-store";

import { queryFailureModes, type FailureModePromptKind, type FailureModeRecord } from "./failure-mode-registry";
import type { AssetCard } from "./schema";

export type VisualGateAnswer = "yes" | "no" | "unsure";
/** pass=无问题；regenerate=画面画错了，建议重抽；edit-script=描述本身不可画，建议改分镜文字 */
export type VisualGateDisposition = "pass" | "regenerate" | "edit-script";
/** 命中原因：image=画面没照描述做；script=描述本身不可画或自相矛盾 */
export type VisualGateCause = "image" | "script";

export type VisualGateQuestion = {
    id: string;
    label: string;
    question: string;
};

export type VisualGateImage = {
    dataUrl: string;
    label?: string;
};

export type VisualGateQuestionResult = VisualGateQuestion & {
    answer: VisualGateAnswer;
    cause: VisualGateCause;
    reason: string;
    /** 仅 edit-script 分支非空 */
    scriptSuggestion: string;
    disposition: VisualGateDisposition;
};

export type VisualGateEvaluation = {
    rawAnswer: string;
    questionResults: VisualGateQuestionResult[];
    disposition: VisualGateDisposition;
    /** 请求或解析出错的原因；非空不代表判定失败，只代表这一轮没拿到有效结论（按通过处理） */
    error: string;
};

export type VisualGateRunResult = VisualGateEvaluation & {
    boardDataUrl: string;
};

type VisualGateRequestOptions = { signal?: AbortSignal };

type BoardItem = Required<VisualGateImage>;

type ParsedAnswer = {
    id: string;
    answer: VisualGateAnswer;
    cause: VisualGateCause;
    reason: string;
    scriptSuggestion: string;
};

const BOARD_COLUMNS = 2;
const BOARD_PADDING = 24;
const BOARD_GAP = 16;
const BOARD_TILE_WIDTH = 720;
const BOARD_IMAGE_HEIGHT = 440;
const BOARD_LABEL_HEIGHT = 48;

/**
 * 判定问句由登记表驱动：只取 gateEnabled 条目，detectionRule 作为检查项原文。
 * hasReference 传 false 时会剔除必须看参考图的条目——所以调用方给不给参考图，直接决定问不问那几条。
 */
export function buildVisualGateQuestions(
    promptKind: FailureModePromptKind,
    assetCardType?: AssetCard["cardType"],
    registry?: readonly FailureModeRecord[],
    hasReference = true,
): VisualGateQuestion[] {
    return queryFailureModes({ promptKind, assetCardType, gateOnly: true, hasReference }, registry).map((mode) => ({
        id: mode.id,
        label: mode.title,
        question: mode.detectionRule,
    }));
}

export function buildVisualGateMessages(boardDataUrl: string, questions: VisualGateQuestion[]): AiTextMessage[] {
    const questionText = questions.map((item, index) => `${index + 1}. [${item.id}] ${item.question}`).join("\n");
    return [
        {
            role: "system",
            content:
                "你是短剧分镜出图后的视觉粗筛助手。只依据对比板中可见内容判断，不推测画外信息。" +
                "只查客观矛盾，不评判表情是否到位、构图是否好看、细节是否丰富、张力是否足够。",
        },
        {
            role: "user",
            content: [
                {
                    type: "text",
                    text:
                        "对比板中第一格标为“候选格”，其余格为参考图。只评判候选格；参考图仅作连续性依据，" +
                        "不要因为参考图是图表、色卡或带标注就判候选格失败。\n" +
                        // 对比板的格名与边框是本工具画上去的，不属于候选图内容；不写死豁免会让"画面混入文字"这条稳定误判。
                        "“候选格”“参考图 N”这些格名标签和格子边框是本次比对工具叠加的版面标识，不属于候选格的画面内容，" +
                        "任何检查项都不得因为它们判定命中。\n\n" +
                        `逐条判断下列检查项描述的失败现象在候选格中是否成立：\n${questionText}\n\n` +
                        "每项 answer 只能是 yes、no、unsure：yes 表示失败现象明确存在；no 表示明确不存在；" +
                        "看不清或证据不足时一律用 unsure（宁可放过也不要误判）。\n" +
                        "answer 为 yes 时还要判断病因 cause：画面没照描述做填 \"image\"；描述本身不可画、" +
                        "自相矛盾或物理上做不到填 \"script\"，此时必须在 scriptSuggestion 里写出具体改法。\n" +
                        "只返回 JSON，不要 Markdown，格式为 " +
                        '{"answers":[{"id":"检查项 id","answer":"yes|no|unsure","cause":"image|script","reason":"一句简短依据","scriptSuggestion":"仅 cause 为 script 时填"}]}',
                },
                { type: "image_url", image_url: { url: boardDataUrl } },
            ],
        },
    ];
}

export function parseVisualGateAnswers(rawAnswer: string, questions: VisualGateQuestion[]): VisualGateQuestionResult[] {
    const parsed = parseAnswerPayload(rawAnswer);
    const byId = new Map(parsed.map((item) => [item.id, item]));
    return questions.map((question) => {
        const hit = byId.get(question.id);
        const answer = hit?.answer ?? "unsure";
        const cause = hit?.cause ?? "image";
        const scriptSuggestion = hit?.scriptSuggestion ?? "";
        return {
            ...question,
            answer,
            cause,
            reason: hit?.reason || (answer === "unsure" ? "模型未返回可识别结论，按不确定处理。" : ""),
            scriptSuggestion,
            disposition: mapVisualGateDisposition(answer, cause, scriptSuggestion),
        };
    });
}

/**
 * yes + script + 有修改建议 → edit-script；yes 的其余情况 → regenerate；no / unsure → pass。
 * 说"要改分镜"却拿不出改法的结论对人没用，一律降级为重抽。
 */
export function mapVisualGateDisposition(
    answer: VisualGateAnswer,
    cause: VisualGateCause,
    scriptSuggestion: string,
): VisualGateDisposition {
    if (answer !== "yes") return "pass";
    return cause === "script" && scriptSuggestion.trim() ? "edit-script" : "regenerate";
}

/** 描述不可画时重抽是白费钱，所以 edit-script 优先级高于 regenerate */
export function resolveVisualGateDisposition(results: VisualGateQuestionResult[]): VisualGateDisposition {
    if (results.some((item) => item.disposition === "edit-script")) return "edit-script";
    if (results.some((item) => item.disposition === "regenerate")) return "regenerate";
    return "pass";
}

export function resolveVisualGateTextModel(config: AiConfig): string {
    const candidates = [config.textModel, ...config.textModels].map((item) => item.trim()).filter(Boolean);
    const model = candidates.find((item) => modelMatchesCapability(item, "text"));
    if (!model) throw new Error("视觉闸门需要可读图的文本模型，请先在设置中配置文本模型");
    return model;
}

export async function askSingleCellVisualGate(
    config: AiConfig,
    boardDataUrl: string,
    questions: VisualGateQuestion[],
    onDelta: (text: string) => void = () => undefined,
    options?: VisualGateRequestOptions,
): Promise<VisualGateEvaluation> {
    try {
        const model = resolveVisualGateTextModel(config);
        const rawAnswer = await requestImageQuestion(
            { ...config, model },
            buildVisualGateMessages(boardDataUrl, questions),
            onDelta,
            options,
        );
        const questionResults = parseVisualGateAnswers(rawAnswer, questions);
        return { rawAnswer, questionResults, disposition: resolveVisualGateDisposition(questionResults), error: "" };
    } catch (error) {
        // 请求失败不能把好格判死：落在通过侧，但把原因带回去，让人知道这一轮没真判。
        return {
            rawAnswer: "",
            questionResults: parseVisualGateAnswers("", questions),
            disposition: "pass",
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

export async function runSingleCellVisualGate(
    config: AiConfig,
    candidate: VisualGateImage,
    references: VisualGateImage[],
    questions: VisualGateQuestion[],
    onDelta: (text: string) => void = () => undefined,
    options?: VisualGateRequestOptions,
): Promise<VisualGateRunResult> {
    const boardDataUrl = await composeVisualGateComparisonBoard(candidate, references);
    return { boardDataUrl, ...(await askSingleCellVisualGate(config, boardDataUrl, questions, onDelta, options)) };
}

export async function composeVisualGateComparisonBoard(candidate: VisualGateImage, references: VisualGateImage[]): Promise<string> {
    const items: BoardItem[] = [
        { dataUrl: candidate.dataUrl, label: candidate.label?.trim() || "候选格" },
        ...references.map((item, index) => ({ dataUrl: item.dataUrl, label: item.label?.trim() || `参考图 ${index + 1}` })),
    ];
    const rows = Math.ceil(items.length / BOARD_COLUMNS);
    const canvas = document.createElement("canvas");
    canvas.width = BOARD_PADDING * 2 + BOARD_TILE_WIDTH * BOARD_COLUMNS + BOARD_GAP * (BOARD_COLUMNS - 1);
    canvas.height = BOARD_PADDING * 2 + (BOARD_IMAGE_HEIGHT + BOARD_LABEL_HEIGHT) * rows + BOARD_GAP * Math.max(0, rows - 1);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法创建视觉闸门对比板");

    context.fillStyle = "#f3f4f6";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const images = await Promise.all(items.map((item) => loadBoardImage(item)));

    images.forEach((image, index) => {
        const column = index % BOARD_COLUMNS;
        const row = Math.floor(index / BOARD_COLUMNS);
        const x = BOARD_PADDING + column * (BOARD_TILE_WIDTH + BOARD_GAP);
        const y = BOARD_PADDING + row * (BOARD_IMAGE_HEIGHT + BOARD_LABEL_HEIGHT + BOARD_GAP);
        context.fillStyle = index === 0 ? "#dbeafe" : "#e5e7eb";
        context.fillRect(x, y, BOARD_TILE_WIDTH, BOARD_LABEL_HEIGHT);
        context.fillStyle = "#111827";
        context.font = "600 22px sans-serif";
        context.textBaseline = "middle";
        context.fillText(items[index].label, x + 16, y + BOARD_LABEL_HEIGHT / 2);
        context.fillStyle = "#ffffff";
        context.fillRect(x, y + BOARD_LABEL_HEIGHT, BOARD_TILE_WIDTH, BOARD_IMAGE_HEIGHT);
        drawContainedImage(context, image, x, y + BOARD_LABEL_HEIGHT, BOARD_TILE_WIDTH, BOARD_IMAGE_HEIGHT);
        context.strokeStyle = index === 0 ? "#2563eb" : "#9ca3af";
        context.lineWidth = index === 0 ? 4 : 2;
        context.strokeRect(x, y, BOARD_TILE_WIDTH, BOARD_LABEL_HEIGHT + BOARD_IMAGE_HEIGHT);
    });

    return canvas.toDataURL("image/jpeg", 0.9);
}

function parseAnswerPayload(rawAnswer: string): ParsedAnswer[] {
    const jsonText = extractJson(rawAnswer);
    if (jsonText) {
        try {
            const value = JSON.parse(jsonText) as unknown;
            const records = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.answers) ? value.answers : [];
            return records.flatMap(normalizeAnswerRecord);
        } catch {
            // JSON 不完整时继续尝试逐行解析。
        }
    }
    return rawAnswer.split(/\r?\n/).flatMap((line) => {
        const match = line.match(/^\s*(?:[-*]\s*)?(?:\d+\.\s*)?\[?([^\]\s:：]+)\]?\s*[:：=-]\s*(yes|no|unsure|是|否|不确定)\b\s*(.*)$/i);
        if (!match) return [];
        return [
            {
                id: match[1],
                answer: normalizeAnswer(match[2]),
                cause: "image" as VisualGateCause,
                reason: match[3].replace(/^[-—:：\s]+/, "").trim(),
                scriptSuggestion: "",
            },
        ];
    });
}

function normalizeAnswerRecord(value: unknown): ParsedAnswer[] {
    if (!isRecord(value) || typeof value.id !== "string") return [];
    return [
        {
            id: value.id,
            answer: normalizeAnswer(value.answer),
            cause: normalizeCause(value.cause),
            reason: typeof value.reason === "string" ? value.reason.trim() : "",
            scriptSuggestion: typeof value.scriptSuggestion === "string" ? value.scriptSuggestion.trim() : "",
        },
    ];
}

function normalizeAnswer(value: unknown): VisualGateAnswer {
    const answer = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (answer === "yes" || answer === "是") return "yes";
    if (answer === "no" || answer === "否") return "no";
    return "unsure";
}

function normalizeCause(value: unknown): VisualGateCause {
    return typeof value === "string" && value.trim().toLowerCase() === "script" ? "script" : "image";
}

function extractJson(value: string): string | undefined {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    if (fenced) return fenced;
    const objectStart = value.indexOf("{");
    const objectEnd = value.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) return value.slice(objectStart, objectEnd + 1);
    const arrayStart = value.indexOf("[");
    const arrayEnd = value.lastIndexOf("]");
    return arrayStart >= 0 && arrayEnd > arrayStart ? value.slice(arrayStart, arrayEnd + 1) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function loadBoardImage(item: BoardItem): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`加载对比板图片失败：${item.label}`));
        image.src = item.dataUrl;
    });
}

function drawContainedImage(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}
