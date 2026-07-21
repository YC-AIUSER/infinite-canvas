import { describe, expect, it } from "vitest";

import {
    CAMERA_MOVEMENT_BASIC_LIBRARY,
    CAMERA_MOVEMENT_LIBRARY,
    CAMERA_MOVEMENT_SPECIAL_LIBRARY,
    COLOR_GRADE_LIBRARY,
    COMPOSITION_FORMULA_LIBRARY,
    COMPOSITION_LIBRARY,
    DIRECTOR_STYLE_FILMING_TECHNIQUES,
    DIRECTOR_STYLE_FILM_GRAIN_HEAVY_PRESET,
    DIRECTOR_STYLE_LIBRARY,
    EMPTY_SHOT_LIBRARY,
    HOOK_LIBRARY,
    isInLibrary,
    LIGHTING_FORMULA_LIBRARY,
    LIGHTING_LIBRARY,
    PERFORMANCE_BODY_PART_CODING,
    PERFORMANCE_EMOTION_TEMPLATES,
    PERFORMANCE_INTENSITY_LIBRARY,
    PERFORMANCE_MICRO_LAYERS,
    renderLibraries,
    SHOT_SCALE_LIBRARY,
} from "../closed-libraries";

describe("closed-libraries：逐库计数与源文件一致", () => {
    it("构图：8 策略 + 8 公式", () => {
        expect(COMPOSITION_LIBRARY).toHaveLength(8);
        expect(COMPOSITION_FORMULA_LIBRARY).toHaveLength(8);
    });

    it("布光：10 方案 + 10 公式", () => {
        expect(LIGHTING_LIBRARY).toHaveLength(10);
        expect(LIGHTING_FORMULA_LIBRARY).toHaveLength(10);
    });

    it("运镜：8 种 + 基础 10 + 特殊 6", () => {
        expect(CAMERA_MOVEMENT_LIBRARY).toHaveLength(8);
        expect(CAMERA_MOVEMENT_BASIC_LIBRARY).toHaveLength(10);
        expect(CAMERA_MOVEMENT_SPECIAL_LIBRARY).toHaveLength(6);
    });

    it("景别：L0-L5 六档", () => {
        expect(SHOT_SCALE_LIBRARY).toHaveLength(6);
    });

    it("表演：强度 5 档 + 五部位编码 5 + 12 种情绪模板 + 微表演 6 层次", () => {
        expect(PERFORMANCE_INTENSITY_LIBRARY).toHaveLength(5);
        expect(PERFORMANCE_BODY_PART_CODING).toHaveLength(5);
        expect(PERFORMANCE_EMOTION_TEMPLATES).toHaveLength(12);
        expect(PERFORMANCE_MICRO_LAYERS).toHaveLength(6);
    });

    it("调色：22 组，且四个子分组数量各自成立", () => {
        expect(COLOR_GRADE_LIBRARY).toHaveLength(22);
        const byGroup = (group: string) => COLOR_GRADE_LIBRARY.filter((entry) => entry.group === group).length;
        expect(byGroup("基础6款")).toBe(6);
        expect(byGroup("影视工业6款")).toBe(6);
        expect(byGroup("情绪类型片6款")).toBe(6);
        expect(byGroup("质感风格化4款")).toBe(4);
    });

    it("空镜：A-E 五类", () => {
        expect(EMPTY_SHOT_LIBRARY).toHaveLength(5);
    });

    it("导演风格：9 种主风格 + 5 种拍摄手法 + 第10档重型预设独立导出", () => {
        expect(DIRECTOR_STYLE_LIBRARY).toHaveLength(9);
        expect(DIRECTOR_STYLE_FILMING_TECHNIQUES).toHaveLength(5);
        expect(DIRECTOR_STYLE_FILM_GRAIN_HEAVY_PRESET.name).toContain("第10档");
        // 第10档不计入 9 种主清单，避免污染计数断言
        expect(DIRECTOR_STYLE_LIBRARY.some((entry) => entry.name.includes("第10档"))).toBe(false);
    });

    it("开场钩子：4 类", () => {
        expect(HOOK_LIBRARY).toHaveLength(4);
    });
});

describe("closed-libraries：源文件未收录独立定义的词条必须如实标注，不得杜撰", () => {
    it("布光 10 方案：全部 10 项 keywords 留空，均带 note", () => {
        for (const entry of LIGHTING_LIBRARY) {
            expect(entry.keywords).toBe("");
            expect(entry.note).toBeTruthy();
        }
    });

    it("运镜「滑轨侧跟」「固定位微动」无独立定义，keywords 留空并标注", () => {
        const sliderTrack = CAMERA_MOVEMENT_LIBRARY.find((entry) => entry.name === "滑轨侧跟");
        const staticMicroMotion = CAMERA_MOVEMENT_LIBRARY.find((entry) => entry.name === "固定位微动");
        expect(sliderTrack?.keywords).toBe("");
        expect(sliderTrack?.note).toBeTruthy();
        expect(staticMicroMotion?.keywords).toBe("");
        expect(staticMicroMotion?.note).toBeTruthy();
    });
});

describe("closed-libraries：isInLibrary 校验封闭词库", () => {
    it("库内词逐字命中返回 true", () => {
        expect(isInLibrary("composition", "权力压迫")).toBe(true);
        expect(isInLibrary("lighting", "逆光剪影")).toBe(true);
        expect(isInLibrary("cameraMovement", "手持跟拍")).toBe(true);
        expect(isInLibrary("shotScale", "L4 特写")).toBe(true);
        expect(isInLibrary("performanceIntensity", "L3 自然")).toBe(true);
        expect(isInLibrary("colorGrade", "暖金调")).toBe(true);
        expect(isInLibrary("emptyShot", "A. 环境空镜")).toBe(true);
        expect(isInLibrary("directorStyle", "电影感写实")).toBe(true);
        expect(isInLibrary("hook", "强冲突")).toBe(true);
    });

    it("自创词/架空措辞不在库内，返回 false", () => {
        expect(isInLibrary("composition", "综合运用推拉摇移")).toBe(false);
        expect(isInLibrary("cameraMovement", "灵活运镜")).toBe(false);
        expect(isInLibrary("colorGrade", "随便调个色")).toBe(false);
    });

    it("跨库混用应判假——构图公式的名称不在构图 8 策略库内", () => {
        expect(isInLibrary("composition", "三分法 Rule of Thirds")).toBe(false);
    });

    it("空字符串或纯空白一律判假", () => {
        expect(isInLibrary("hook", "")).toBe(false);
        expect(isInLibrary("hook", "   ")).toBe(false);
    });
});

describe("closed-libraries：renderLibraries 只取指定类", () => {
    it("只取 composition 时，输出不含其他库的词条", () => {
        const rendered = renderLibraries(["composition"]);
        expect(rendered).toContain("权力压迫");
        expect(rendered).not.toContain("逆光剪影");
        expect(rendered).not.toContain("手持跟拍");
        expect(rendered).not.toContain("暖金调");
    });

    it("取多类时按顺序拼接，各类词条均出现", () => {
        const rendered = renderLibraries(["lighting", "hook"]);
        expect(rendered).toContain("逆光剪影");
        expect(rendered).toContain("强冲突");
        expect(rendered).not.toContain("权力压迫");
    });

    it("对无独立定义的词条渲染时不留空白，回退到 note 或占位说明", () => {
        const rendered = renderLibraries(["lighting"]);
        expect(rendered).toContain("窗光自然：源库未收录同名公式");
    });
});
