import { beforeEach, describe, expect, it, vi } from "vitest";

import { requestImageQuestion } from "@/services/api/image";
import { defaultConfig } from "@/stores/use-config-store";

import {
    askSingleCellVisualGate,
    buildVisualGateMessages,
    mapVisualGateDisposition,
    parseVisualGateAnswers,
    resolveVisualGateDisposition,
} from "../visual-gate";
import type { VisualGateQuestion } from "../visual-gate-failure-modes-placeholder";

vi.mock("@/services/api/image", () => ({ requestImageQuestion: vi.fn() }));

const questions: VisualGateQuestion[] = [
    { id: "identity", label: "身份", question: "角色身份是否明显错误？", actionOnYes: "regenerate" },
    { id: "composition", label: "构图", question: "构图是否需要人工确认？", actionOnYes: "review" },
];

describe("Toonflow 单格视觉闸门", () => {
    beforeEach(() => vi.clearAllMocks());

    it("把对比板和全部判定问句拼进一次多模态请求", () => {
        const messages = buildVisualGateMessages("data:image/jpeg;base64,board", questions);
        expect(messages).toHaveLength(2);
        expect(messages[1].content).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ type: "text", text: expect.stringContaining("[identity] 角色身份是否明显错误？") }),
                expect.objectContaining({ type: "text", text: expect.stringContaining("[composition] 构图是否需要人工确认？") }),
                { type: "image_url", image_url: { url: "data:image/jpeg;base64,board" } },
            ]),
        );
    });

    it("解析 yes/no/unsure，并让 unsure 落在通过侧", () => {
        const results = parseVisualGateAnswers(
            JSON.stringify({ answers: [{ id: "identity", answer: "unsure", reason: "遮挡" }, { id: "composition", answer: "yes", reason: "轴线偏移" }] }),
            questions,
        );
        expect(results).toEqual([
            expect.objectContaining({ id: "identity", answer: "unsure", disposition: "pass" }),
            expect.objectContaining({ id: "composition", answer: "yes", disposition: "review" }),
        ]);
    });

    it("把 yes 映射到问句指定处置，把 no 和 unsure 映射为通过", () => {
        expect(mapVisualGateDisposition("yes", "review")).toBe("review");
        expect(mapVisualGateDisposition("yes", "regenerate")).toBe("regenerate");
        expect(mapVisualGateDisposition("no", "regenerate")).toBe("pass");
        expect(mapVisualGateDisposition("unsure", "regenerate")).toBe("pass");
    });

    it("总处置按重生成、人工复核、通过三分支取最强结论", () => {
        const parsed = (answer: string) => parseVisualGateAnswers(answer, questions);
        expect(resolveVisualGateDisposition(parsed('{"answers":[{"id":"identity","answer":"yes"}]}'))).toBe("regenerate");
        expect(resolveVisualGateDisposition(parsed('{"answers":[{"id":"composition","answer":"yes"}]}'))).toBe("review");
        expect(resolveVisualGateDisposition(parsed('{"answers":[{"id":"identity","answer":"unsure"},{"id":"composition","answer":"no"}]}'))).toBe("pass");
    });

    it("复用 requestImageQuestion 且只选择 textModels，不使用当前生图模型", async () => {
        vi.mocked(requestImageQuestion).mockResolvedValue('{"answers":[{"id":"identity","answer":"no"},{"id":"composition","answer":"no"}]}');
        const config = {
            ...defaultConfig,
            model: "default::gpt-image-2",
            imageModels: ["default::gpt-image-2"],
            textModel: "default::gpt-5.5",
            textModels: ["default::gpt-5.5"],
        };

        const result = await askSingleCellVisualGate(config, "data:image/jpeg;base64,board", questions);

        expect(requestImageQuestion).toHaveBeenCalledWith(expect.objectContaining({ model: "default::gpt-5.5" }), expect.any(Array), expect.any(Function), undefined);
        expect(result.disposition).toBe("pass");
    });
});
