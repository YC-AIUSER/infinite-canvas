import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestImageQuestion } from "@/services/api/image";
import { defaultConfig } from "@/stores/use-config-store";

import type { FailureModeRecord } from "../failure-mode-registry";
import {
    askSingleCellVisualGate,
    buildVisualGateMessages,
    buildVisualGateQuestions,
    mapVisualGateDisposition,
    parseVisualGateAnswers,
    resolveVisualGateDisposition,
    type VisualGateQuestion,
} from "../visual-gate";

vi.mock("@/services/api/image", () => ({ requestImageQuestion: vi.fn() }));

const questions: VisualGateQuestion[] = [
    { id: "leak", label: "文字泄漏", question: "画面中是否出现不该有的文字或标签？" },
    { id: "blank", label: "留空格被填", question: "指定留空的格子是否出现了内容？" },
];

const answersJson = (records: Array<Record<string, unknown>>) => JSON.stringify({ answers: records });

describe("视觉闸门判定问句来源", () => {
    it("只取登记表中已开闸门的条目，需要任务侧上下文的条目不进提问", () => {
        const built = buildVisualGateQuestions("storyboard-page");
        const ids = built.map((item) => item.id);

        expect(ids).toContain("prompt-text-leakage");
        expect(ids).toContain("panel-content-duplication");
        // 这两条判起来需要闸门当前拿不到的任务侧上下文（版式与镜头数、任务要求主体数），开着只会逼出 unsure
        expect(ids).not.toContain("intentional-blank-cell-filled");
        expect(ids).not.toContain("subject-count-invention");
        expect(built.every((item) => item.question.trim().length > 0)).toBe(true);
    });

    it("有参考图才问需要比对参考图的条目——刀型被换这类关键项不能因为无参考被静默丢掉", () => {
        const withRef = buildVisualGateQuestions("keyframes").map((item) => item.id);
        const withoutRef = buildVisualGateQuestions("keyframes", undefined, undefined, false).map((item) => item.id);

        // 对比板带参考图时，最该查的道具形态替换必须在问句里（早前按"要比对参考图就关闭"的错标准把它漏掉了）
        expect(withRef).toContain("prop-shape-substitution");
        expect(withRef).toContain("reference-layout-leakage");
        // 没有参考图时才剔除，避免问出必然的 unsure
        expect(withoutRef).not.toContain("prop-shape-substitution");
        expect(withoutRef).not.toContain("reference-layout-leakage");
        expect(withoutRef).toContain("prompt-text-leakage");
    });

    it("问句随登记表数据变化，未硬编码进闸门", () => {
        const synthetic: FailureModeRecord[] = [
            {
                id: "synthetic-gate",
                title: "合成检查项",
                category: "layout",
                promptKinds: ["storyboard-page"],
                preventionRule: "合成预防。",
                forbiddenSentence: "合成禁令。",
                detectionRule: "合成判定线索是否成立？",
                repairTemplate: "合成修复。",
                gateEnabled: true,
            },
        ];

        expect(buildVisualGateQuestions("storyboard-page", undefined, synthetic)).toEqual([
            { id: "synthetic-gate", label: "合成检查项", question: "合成判定线索是否成立？" },
        ]);
    });
});

describe("视觉闸门提问", () => {
    it("对比板与全部检查项进同一次多模态请求，并明确只评判候选格", () => {
        const messages = buildVisualGateMessages("data:image/jpeg;base64,board", questions);
        const content = messages[1].content as Array<{ type: string; text?: string }>;
        const [text] = content;

        expect(messages).toHaveLength(2);
        expect(text.text).toContain("只评判候选格");
        expect(text.text).toContain("参考图仅作连续性依据");
        expect(text.text).toContain("[leak] 画面中是否出现不该有的文字或标签？");
        expect(text.text).toContain("[blank] 指定留空的格子是否出现了内容？");
        expect(content).toContainEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,board" } });
    });

    it("写死对比板格名豁免，避免闸门把自己画的标签当成画面混入文字", () => {
        const [, user] = buildVisualGateMessages("data:image/jpeg;base64,board", questions);
        const [text] = user.content as Array<{ text?: string }>;

        expect(text.text).toContain("版面标识");
        expect(text.text).toContain("不得因为它们判定命中");
    });

    it("提问要求区分病因并在改分镜时给出具体改法", () => {
        const [, user] = buildVisualGateMessages("data:image/jpeg;base64,board", questions);
        const [text] = user.content as Array<{ text?: string }>;

        expect(text.text).toContain("scriptSuggestion");
        expect(text.text).toContain("宁可放过也不要误判");
    });
});

describe("视觉闸门三分支处置", () => {
    it("画面没照做判重抽，描述不可画判改分镜并带修改建议", () => {
        const results = parseVisualGateAnswers(
            answersJson([
                { id: "leak", answer: "yes", cause: "image", reason: "右上角有英文标签" },
                {
                    id: "blank",
                    answer: "yes",
                    cause: "script",
                    reason: "描述要求 5 镜但版式只有 4 格",
                    scriptSuggestion: "把第 5 镜合并进第 4 镜，或改用 3+2 版式",
                },
            ]),
            questions,
        );

        expect(results[0]).toMatchObject({ disposition: "regenerate", cause: "image" });
        expect(results[1]).toMatchObject({ disposition: "edit-script", cause: "script" });
        expect(results[1].scriptSuggestion).toBe("把第 5 镜合并进第 4 镜，或改用 3+2 版式");
        // 描述不可画时重抽是白费钱，总结论必须优先给改分镜
        expect(resolveVisualGateDisposition(results)).toBe("edit-script");
    });

    it("说要改分镜却拿不出改法时降级为重抽，不给无内容的改分镜结论", () => {
        expect(mapVisualGateDisposition("yes", "script", "   ")).toBe("regenerate");
        expect(mapVisualGateDisposition("yes", "script", "把长刀改成短刀")).toBe("edit-script");
        expect(mapVisualGateDisposition("yes", "image", "")).toBe("regenerate");
    });

    it("unsure、no 与缺字段全部落在通过侧", () => {
        const results = parseVisualGateAnswers(answersJson([{ id: "leak", answer: "unsure", reason: "遮挡看不清" }]), questions);

        expect(results[0]).toMatchObject({ answer: "unsure", disposition: "pass" });
        // blank 这一项模型压根没回答，也必须按不确定通过
        expect(results[1]).toMatchObject({ answer: "unsure", disposition: "pass" });
        expect(results[1].reason).toContain("按不确定处理");
        expect(resolveVisualGateDisposition(results)).toBe("pass");
        expect(mapVisualGateDisposition("no", "image", "")).toBe("pass");
    });

    it("返回内容完全无法解析时按通过处理，不误杀", () => {
        const results = parseVisualGateAnswers("模型胡言乱语，没有任何结构", questions);

        expect(results.every((item) => item.disposition === "pass")).toBe(true);
        expect(resolveVisualGateDisposition(results)).toBe("pass");
    });
});

describe("视觉闸门请求", () => {
    beforeEach(() => vi.clearAllMocks());

    it("复用 requestImageQuestion 并只取文本模型，不碰生图模型", async () => {
        vi.mocked(requestImageQuestion).mockResolvedValue(answersJson([{ id: "leak", answer: "no" }, { id: "blank", answer: "no" }]));
        const config = {
            ...defaultConfig,
            model: "default::gpt-image-2",
            imageModels: ["default::gpt-image-2"],
            textModel: "default::gpt-5.5",
            textModels: ["default::gpt-5.5"],
        };

        const result = await askSingleCellVisualGate(config, "data:image/jpeg;base64,board", questions);

        expect(requestImageQuestion).toHaveBeenCalledWith(
            expect.objectContaining({ model: "default::gpt-5.5" }),
            expect.any(Array),
            expect.any(Function),
            undefined,
        );
        expect(result.disposition).toBe("pass");
        expect(result.error).toBe("");
    });

    it("请求失败时判通过但保留错误原因，不静默吞掉也不误杀", async () => {
        vi.mocked(requestImageQuestion).mockRejectedValue(new Error("网关 502"));
        const config = { ...defaultConfig, textModel: "default::gpt-5.5", textModels: ["default::gpt-5.5"] };

        const result = await askSingleCellVisualGate(config, "data:image/jpeg;base64,board", questions);

        expect(result.disposition).toBe("pass");
        expect(result.error).toBe("网关 502");
        expect(result.questionResults).toHaveLength(2);
        expect(result.questionResults.every((item) => item.answer === "unsure")).toBe(true);
    });

    it("没有可用文本模型时也不抛异常，按通过并带出配置提示", async () => {
        const config = { ...defaultConfig, textModel: "", textModels: [] };

        const result = await askSingleCellVisualGate(config, "data:image/jpeg;base64,board", questions);

        expect(result.disposition).toBe("pass");
        expect(result.error).toContain("请先在设置中配置文本模型");
        expect(requestImageQuestion).not.toHaveBeenCalled();
    });
});
