import { requestImageQuestion, type AiTextMessage } from "@/services/api/image";
import { modelMatchesCapability, type AiConfig } from "@/stores/use-config-store";

import { PLACEHOLDER_VISUAL_GATE_QUESTIONS, type VisualGateQuestion } from "./visual-gate-failure-modes-placeholder";

export type VisualGateAnswer = "yes" | "no" | "unsure";
export type VisualGateDisposition = "pass" | "review" | "regenerate";

export type VisualGateImage = {
    dataUrl: string;
    label?: string;
};

export type VisualGateQuestionResult = VisualGateQuestion & {
    answer: VisualGateAnswer;
    reason: string;
    disposition: VisualGateDisposition;
};

export type VisualGateEvaluation = {
    rawAnswer: string;
    questionResults: VisualGateQuestionResult[];
    disposition: VisualGateDisposition;
};

export type VisualGateRunResult = VisualGateEvaluation & {
    boardDataUrl: string;
};

type VisualGateRequestOptions = { signal?: AbortSignal };

type BoardItem = Required<VisualGateImage>;

const BOARD_COLUMNS = 2;
const BOARD_PADDING = 24;
const BOARD_GAP = 16;
const BOARD_TILE_WIDTH = 720;
const BOARD_IMAGE_HEIGHT = 440;
const BOARD_LABEL_HEIGHT = 48;

export function buildVisualGateMessages(boardDataUrl: string, questions: VisualGateQuestion[]): AiTextMessage[] {
    const questionText = questions.map((item, index) => `${index + 1}. [${item.id}] ${item.question}`).join("\n");
    return [
        {
            role: "system",
            content: "你是短剧分镜出图后的视觉粗筛助手。只依据对比板中可见内容判断，不推测画外信息。",
        },
        {
            role: "user",
            content: [
                {
                    type: "text",
                    text: `对比板中第一格标为“候选格”，其余格为参考图。请判断每个问题描述的失败现象是否在候选格中成立。\n\n${questionText}\n\n每项 answer 只能是 yes、no、unsure：yes 表示失败现象明确存在；no 表示明确不存在；看不清或证据不足时用 unsure。只返回 JSON，不要 Markdown，格式为 {"answers":[{"id":"问题 id","answer":"yes|no|unsure","reason":"一句简短依据"}]}`,
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
        const parsedAnswer = byId.get(question.id);
        const answer = parsedAnswer?.answer ?? "unsure";
        return {
            ...question,
            answer,
            reason: parsedAnswer?.reason || (answer === "unsure" ? "模型未返回可识别结论，按不确定处理。" : ""),
            disposition: mapVisualGateDisposition(answer, question.actionOnYes),
        };
    });
}

export function mapVisualGateDisposition(answer: VisualGateAnswer, actionOnYes: VisualGateQuestion["actionOnYes"]): VisualGateDisposition {
    return answer === "yes" ? actionOnYes : "pass";
}

export function resolveVisualGateDisposition(results: VisualGateQuestionResult[]): VisualGateDisposition {
    if (results.some((item) => item.disposition === "regenerate")) return "regenerate";
    if (results.some((item) => item.disposition === "review")) return "review";
    return "pass";
}

export function resolveVisualGateTextModel(config: AiConfig): string {
    const candidates = [config.textModel, ...config.textModels].map((item) => item.trim()).filter(Boolean);
    const model = candidates.find((item, index) => candidates.indexOf(item) === index && modelMatchesCapability(item, "text"));
    if (!model) throw new Error("视觉闸门需要可读图的文本模型，请先在设置中配置文本模型");
    return model;
}

export async function askSingleCellVisualGate(
    config: AiConfig,
    boardDataUrl: string,
    questions: VisualGateQuestion[] = PLACEHOLDER_VISUAL_GATE_QUESTIONS,
    onDelta: (text: string) => void = () => undefined,
    options?: VisualGateRequestOptions,
): Promise<VisualGateEvaluation> {
    const model = resolveVisualGateTextModel(config);
    const rawAnswer = await requestImageQuestion({ ...config, model }, buildVisualGateMessages(boardDataUrl, questions), onDelta, options);
    const questionResults = parseVisualGateAnswers(rawAnswer, questions);
    return { rawAnswer, questionResults, disposition: resolveVisualGateDisposition(questionResults) };
}

export async function runSingleCellVisualGate(
    config: AiConfig,
    candidate: VisualGateImage,
    references: VisualGateImage[],
    questions: VisualGateQuestion[] = PLACEHOLDER_VISUAL_GATE_QUESTIONS,
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

function parseAnswerPayload(rawAnswer: string): Array<{ id: string; answer: VisualGateAnswer; reason: string }> {
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
        return [{ id: match[1], answer: normalizeAnswer(match[2]), reason: match[3].replace(/^[-—:：\s]+/, "").trim() }];
    });
}

function normalizeAnswerRecord(value: unknown): Array<{ id: string; answer: VisualGateAnswer; reason: string }> {
    if (!isRecord(value) || typeof value.id !== "string") return [];
    return [{ id: value.id, answer: normalizeAnswer(value.answer), reason: typeof value.reason === "string" ? value.reason.trim() : "" }];
}

function normalizeAnswer(value: unknown): VisualGateAnswer {
    const answer = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (answer === "yes" || answer === "是") return "yes";
    if (answer === "no" || answer === "否") return "no";
    return "unsure";
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
