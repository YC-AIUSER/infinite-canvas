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
    DIRECTOR_TECHNIQUE_MAPPING_LIBRARY,
    EMPTY_SHOT_LIBRARY,
    HOOK_LIBRARY,
    isInLibrary,
    isTechniqueInPurpose,
    LIGHTING_FORMULA_LIBRARY,
    LIGHTING_LIBRARY,
    PERFORMANCE_BODY_PART_CODING,
    PERFORMANCE_EMOTION_TEMPLATES,
    PERFORMANCE_INTENSITY_LIBRARY,
    PERFORMANCE_MICRO_LAYERS,
    renderLibraries,
    SHOT_SCALE_LIBRARY,
    SPEED_FREEZE_LIBRARY,
    techniquesForPurpose,
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

    it("P7 导演技法映射：9 类叙事目的；顿帧两式：2 条", () => {
        expect(DIRECTOR_TECHNIQUE_MAPPING_LIBRARY).toHaveLength(9);
        expect(SPEED_FREEZE_LIBRARY).toHaveLength(2);
    });
});

describe("closed-libraries：P7 导演技法逐字对齐", () => {
    it("具体技法名存在于对应叙事目的条目", () => {
        const pressure = DIRECTOR_TECHNIQUE_MAPPING_LIBRARY.find((entry) => entry.name === "压迫/威胁/权力差");
        const impact = DIRECTOR_TECHNIQUE_MAPPING_LIBRARY.find((entry) => entry.name === "速度/冲击/爽感");
        expect(pressure?.keywords).toContain("窄门框限制");
        expect(impact?.keywords).toContain("Crash Zoom");
    });

    it("按叙事目的拆出具体技法，并拒绝跨目的混用", () => {
        expect(techniquesForPurpose("速度/冲击/爽感")).toContain("Crash Zoom");
        expect(isTechniqueInPurpose("速度/冲击/爽感", "Crash Zoom")).toBe(true);
        expect(isTechniqueInPurpose("速度/冲击/爽感", "窄门框限制")).toBe(false);
    });

    // 时间操控行的「…收束停点四要素）· 慢动作突入」中点前没有空格,按固定 " · " 切会把两项粘成一项,
    // 模型逐字选「慢动作突入」反被判成自创技法。九行数量逐行锁死,防止分隔符再退化。
    it("九类技法逐行切分数量与源表一致，含分隔符异常的时间操控行", () => {
        const counts = DIRECTOR_TECHNIQUE_MAPPING_LIBRARY.map((entry) => [entry.name, techniquesForPurpose(entry.name).length]);
        expect(counts).toEqual([
            ["压迫/威胁/权力差", 10],
            ["揭示/悬念/信息延迟", 8],
            ["速度/冲击/爽感", 10],
            ["心理/犹豫/不安", 9],
            ["亲密/观察/纪实", 8],
            ["空间/调度/迁移", 7],
            ["产品/道具/证据", 8],
            ["转场/段落连接", 10],
            ["时间操控/速度骤变", 4],
        ]);
        expect(isTechniqueInPurpose("时间操控/速度骤变", "慢动作突入")).toBe(true);
        expect(isTechniqueInPurpose("时间操控/速度骤变", "Speed Ramp（加速触发→顶点→慢放区间→收束停点四要素）")).toBe(true);
    });

    it("Speed Ramp 四要素与顿帧两式英文模板逐字保留", () => {
        const timeControl = DIRECTOR_TECHNIQUE_MAPPING_LIBRARY.find((entry) => entry.name === "时间操控/速度骤变");
        expect(timeControl?.keywords).toContain("Speed Ramp（加速触发→顶点→慢放区间→收束停点四要素）");
        expect(SPEED_FREEZE_LIBRARY[0].english).toBe(
            "speed-freeze frame at the moment of [action], air compression ripples expand outward from the impact point, motion blur residual trails visible",
        );
        expect(SPEED_FREEZE_LIBRARY[1].english).toBe(
            "impact freeze frame as [object] hits [target], shockwave rings radiate outward, material deformation visible (dent/crack/scatter), surrounding particles/droplets suspended mid-air for 1-2 frames",
        );
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
        expect(isInLibrary("directorTechnique", "速度/冲击/爽感")).toBe(true);
        expect(isInLibrary("speedFreeze", "Impact freeze（冲击定格）")).toBe(true);
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
