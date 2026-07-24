import { describe, expect, it } from "vitest";

import {
    VIDEO_CLOSED_MOUTH_SENTENCE,
    VIDEO_SEAM_AUDIO_BOUNDARY_SENTENCE,
    VIDEO_SOUND_SUPPRESSION_SENTENCE,
    buildModule4ComposePrompt,
    buildVideoWorkbenchPrompt,
    finalizeModule4Text,
    type Module4ComposeInput,
} from "../prompts";

function input(overrides: Partial<Module4ComposeInput> = {}): Module4ComposeInput {
    return {
        rows: [
            { segmentId: "seg-b", shotId: "shot-1", shotNo: 1, scale: "近景", angle: "低机位", action: "顾沉舟抓住门把", line: "出口对白-顾沉舟：别开门", sfx: "门把金属轻响", mood: "紧张", durationSec: 5 },
            { segmentId: "seg-b", shotId: "shot-2", shotNo: 2, scale: "全景", angle: "平视", action: "林夏后退", line: "OS-林夏：门后有人", sfx: "脚步摩擦", mood: "恐惧", durationSec: 5 },
            { segmentId: "seg-b", shotId: "shot-3", shotNo: 3, scale: "特写", angle: "俯拍", action: "钥匙滑落", line: "", sfx: "钥匙落地声", mood: "骤停", durationSec: 5 },
        ],
        shotContracts: [
            { shotId: "shot-1", scale: "近景", angle: "低机位", movement: "快速推近", speed: "快", subjectRelation: "顾沉舟在画面左，林夏在画面右", endpoint: "顾沉舟在画面左抓门把", inOut: { include: ["顾沉舟", "门把"], exclude: ["路人"] } },
        ],
        actionContracts: [{ shotId: "shot-1", cause: "门后异响", process: "顾沉舟手指扣紧", consequence: "门把下压", endState: "手腕仍在发力" }],
        assets: [
            { cardType: "character", name: "顾沉舟", anchor: "角色卡" },
            { cardType: "prop", name: "旧钥匙", anchor: "道具卡" },
            { cardType: "scene", name: "走廊", anchor: "场景卡" },
            { cardType: "palette", name: "全片色板", anchor: "冷暖双调" },
        ],
        directingLock: {
            global: {
                visualStyle: "电影写实",
                colorGrading: "低饱和冷暖双调",
                lighting: "冷白侧光从画面左侧进入",
                cameraTone: "克制推进",
                performanceLevel: "L3",
                unifiedStyleString: "电影级写实质感，低饱和冷暖双调",
                motifs: [],
            },
            seams: [],
        },
        spaceRules: "顾沉舟恒左，林夏恒右，摄影机不越轴。",
        scriptText: "【音频要素标签】BGM:低频电子脉冲(紧张)+音效:门响",
        ...overrides,
    };
}

describe("buildVideoWorkbenchPrompt", () => {
    it("输出Module4六段骨架并按角色→物品→场景→色板→故事板构图编号", () => {
        const prompt = buildVideoWorkbenchPrompt(input());
        for (const title of ["1. 参考图索引", "2. 故事线", "3. Tone", "4. BGM衔接", "5. 风格", "6. 画面要求"]) expect(prompt).toContain(title);
        expect(prompt).toContain("@图片1=顾沉舟\n@图片2=旧钥匙\n@图片3=走廊\n@图片4=全片色板\n@图片5=故事板构图");
        expect(prompt).toContain(VIDEO_SOUND_SUPPRESSION_SENTENCE);
        expect(prompt).toContain(VIDEO_CLOSED_MOUTH_SENTENCE);
        expect(prompt).not.toContain("逐镜脚本");
        expect(prompt).not.toContain("1:1");
    });

    it("确定性收口第1/5/6段，只保留模型创作的故事线、Tone与BGM", () => {
        const finalized = finalizeModule4Text(
            input(),
            `1. 参考图索引\n@图片1=错误索引\n\n2. 故事线\n按故事板镜头顺序自然推进，顾沉舟在画面左抓门把。\n\n3. Tone\n紧张。\n\n4. BGM衔接\n低频脉冲收紧。\n\n5. 风格\n错误风格\n\n6. 画面要求\n错误要求`,
        );
        expect(finalized).toContain("@图片1=顾沉舟");
        expect(finalized).not.toContain("错误索引");
        expect(finalized).not.toContain("错误风格");
        expect(finalized).not.toContain("错误要求");
        expect(finalized).toContain("按故事板镜头顺序自然推进，顾沉舟在画面左抓门把。");
        expect(finalized).toContain(VIDEO_SOUND_SUPPRESSION_SENTENCE);
    });
});

describe("buildModule4ComposePrompt", () => {
    it("有入缝时要求首句接同一动作后半且禁止重新建立空间", () => {
        const prompt = buildModule4ComposePrompt(
            input({
                incomingSeam: {
                    fromSegmentId: "seg-a",
                    toSegmentId: "seg-b",
                    prevEndBeat: "顾沉舟手腕仍在发力",
                    nextFirstPanel: "顾沉舟继续压下门把",
                    scaleOrMotivation: "动作中切",
                    soundBridge: "L-cut",
                },
            }),
        );
        expect(prompt).toContain("【入缝合同】");
        expect(prompt).toContain("顾沉舟继续压下门把");
        expect(prompt).toContain("故事线首句必须接同一动作后半，禁止重新建立空间");
        expect(prompt).not.toContain("【出缝合同】");
    });

    it("有出缝时要求末句收在中间态并把音频边界句写入画面要求", () => {
        const prompt = buildModule4ComposePrompt(
            input({
                outgoingSeam: {
                    fromSegmentId: "seg-b",
                    toSegmentId: "seg-c",
                    prevEndBeat: "钥匙仍在下坠",
                    nextFirstPanel: "钥匙继续下坠后落地",
                    scaleOrMotivation: "动作中切",
                    soundBridge: "J-cut",
                    audioBoundary: "段尾不启动持续音",
                },
            }),
        );
        expect(prompt).toContain("【出缝合同】");
        expect(prompt).toContain("本段末句必须收在动作中间态：钥匙仍在下坠");
        expect(prompt).toContain(VIDEO_SEAM_AUDIO_BOUNDARY_SENTENCE);
        expect(prompt).not.toContain("【入缝合同】");
    });

    it("无缝合同时不注入两侧约束与音频边界句", () => {
        const prompt = buildModule4ComposePrompt(input());
        expect(prompt).not.toContain("【入缝合同】");
        expect(prompt).not.toContain("【出缝合同】");
        expect(prompt).not.toContain(VIDEO_SEAM_AUDIO_BOUNDARY_SENTENCE);
    });

    it("dialogue进入故事线素材并控口型，OS不进故事线口播，sfx正常进入", () => {
        const prompt = buildModule4ComposePrompt(input());
        expect(prompt).toContain("dialogue=顾沉舟说：'别开门'，仅顾沉舟做口型");
        expect(prompt).toContain("OS（禁止写进故事线口播）=林夏：门后有人");
        expect(prompt).toContain("音效=门把金属轻响");
        expect(prompt).toContain("音效=钥匙落地声");
        expect(prompt).toContain(VIDEO_CLOSED_MOUTH_SENTENCE);
    });

    it("无前缀台词按OS处理", () => {
        const rows = input().rows.map((row, index) => (index === 0 ? { ...row, line: "门后有人" } : row));
        const prompt = buildModule4ComposePrompt(input({ rows }));
        expect(prompt).toContain("OS（禁止写进故事线口播）=门后有人");
        expect(prompt).not.toContain("dialogue=顾沉舟");
    });

    it("校验反馈进入自动重试提示", () => {
        const prompt = buildModule4ComposePrompt(input({ feedback: ["禁止使用[N-N秒]时间码", "缺少第3段“Tone”"] }));
        expect(prompt).toContain("【上次校验违规，必须逐项修正】");
        expect(prompt).toContain("- 禁止使用[N-N秒]时间码");
        expect(prompt).toContain("- 缺少第3段“Tone”");
    });
});
