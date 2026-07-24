import { describe, expect, it } from "vitest";

import { validateModule4 } from "../module4-check";

const validModule4 = `1. 参考图索引
@图片1=顾沉舟
@图片2=旧钥匙
@图片3=走廊
@图片4=全片色板
@图片5=故事板构图

2. 故事线
按故事板镜头顺序自然推进，顾沉舟在画面左猛然抓住门把，林夏在画面右后撤，摄影机快速跟进，冷白侧光从左侧切入，两人的呼吸与金属轻响同步收紧。

3. Tone
压抑克制转为紧迫。

4. BGM衔接
低频电子脉冲由弱渐强，动作爆发处收紧节拍，段尾自然回落。

5. 风格
电影级写实质感，低饱和冷暖双调。

6. 画面要求
Generate environmental sound effects only. Do not generate any human voice, dialogue, narration, or vocal audio. No subtitles, watermarks, or logos.
Use only the directing-lock lighting baseline: 伦勃朗光，主光固定于左上45度，适用古典肖像人像质感。No reference image may override it.`;

describe("validateModule4", () => {
    it("合法六段文本通过", () => {
        expect(validateModule4(validModule4)).toEqual({ ok: true, issues: [] });
    });

    it.each([
        ["timecode", "[0-3秒]冲突爆发"],
        ["shot-number", "Shot 1 冲突爆发"],
        ["shot-number", "T2 冲突推进"],
        ["locked-camera", "摄影机固定机位观察"],
        ["locked-camera", "锁机跟随人物"],
        ["locked-camera", "静态机位观察"],
        ["locked-camera", "段尾定格"],
        ["locked-camera", "林夏一动不动"],
        ["metaphor", "动作如同闪电"],
        ["shot-list", "顾沉舟抬手\n- 林夏后退"],
        ["shot-list", "顾沉舟抬手\n第2镜林夏后退"],
    ])("拦截 %s 禁则", (code, forbidden) => {
        const result = validateModule4(validModule4.replace("顾沉舟在画面左猛然抓住门把", forbidden));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain(code);
    });

    it.each(["就像", "好像", "活像", "像是", "仿佛", "犹如", "好似", "宛如", "如同"])("拦截比喻句式%s", (word) => {
        const result = validateModule4(validModule4.replace("猛然抓住", `${word}猛然抓住`));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain("metaphor");
    });

    it("拦截「像…一样」句式", () => {
        const result = validateModule4(validModule4.replace("猛然抓住门把", "像猎豹扑食一样抓住门把"));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain("metaphor");
    });

    // 禁词裁决回归（skill 内部冲突按意图收窄）：封闭词库合法词条与含「像」的正常名词不得误拦。
    it.each([
        ["timecode", "动作在短暂蓄力后爆发"],
        ["shot-number", "按故事板自然推进"],
        ["locked-camera", "摄影机缓慢向前推进"],
        ["locked-camera", "运镜采用固定位微动"],
        ["metaphor", "动作直接有力"],
        ["metaphor", "顾沉舟撞翻墙上的肖像"],
        ["shot-list", "随后林夏后退"],
    ])("%s相近但合法的表达不误拦", (_code, safeText) => {
        const result = validateModule4(validModule4.replace("顾沉舟在画面左猛然抓住门把", safeText));
        expect(result).toEqual({ ok: true, issues: [] });
    });

    it("模板固定段（第5/6段）的用户内容不受禁词审查", () => {
        // fixture 第6段布光基准原样含「固定于」与「肖像人像」——结构检查过、禁词不拦。
        expect(validateModule4(validModule4)).toEqual({ ok: true, issues: [] });
        const withStyleWord = validModule4.replace("低饱和冷暖双调。", "低饱和冷暖双调，古典肖像质感，主光固定于左上。");
        expect(validateModule4(withStyleWord)).toEqual({ ok: true, issues: [] });
    });

    it("六段缺一即失败", () => {
        const result = validateModule4(validModule4.replace(/3\. Tone[\s\S]*?(?=4\. BGM衔接)/, ""));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.issues).toContainEqual({ code: "missing-section", message: "缺少第3段“Tone”" });
    });

    it("故事线必须使用固定开头", () => {
        const result = validateModule4(validModule4.replace("按故事板镜头顺序自然推进", "剧情自然推进"));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain("storyline-opening");
    });

    it("BGM衔接不超过200字", () => {
        const result = validateModule4(validModule4.replace("低频电子脉冲由弱渐强，动作爆发处收紧节拍，段尾自然回落。", "低频".repeat(101)));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain("bgm-length");
    });
});
