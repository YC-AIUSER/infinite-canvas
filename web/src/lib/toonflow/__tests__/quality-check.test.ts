import { describe, expect, it } from "vitest";

import { runQualityCheck, type QualityCheckItem, type QualityCheckKind } from "../quality-check";
import type { ActionContract, DirectingLock, DirectingLockGlobal, DirectingLockSegment, ShotContract, StoryboardRow } from "../schema";

function row(overrides: Partial<StoryboardRow> = {}): StoryboardRow {
    return {
        segmentId: "seg-1",
        shotId: "shot-1",
        shotNo: 1,
        scale: "L2 中景/中全景",
        angle: "平视",
        action: "角色抬手",
        line: "你好",
        sfx: "环境声",
        mood: "平静",
        durationSec: 3,
        assetSlots: [],
        ...overrides,
    };
}

function contract(overrides: Partial<ShotContract> = {}): ShotContract {
    return {
        shotId: "shot-1",
        scale: "L2 中景/中全景",
        angle: "平视",
        movement: "手持跟拍",
        speed: "常速",
        subjectRelation: "单人",
        endpoint: "停在正脸",
        inOut: { include: [], exclude: [] },
        ...overrides,
    };
}

function actionContract(overrides: Partial<ActionContract> = {}): ActionContract {
    return {
        shotId: "shot-1",
        cause: "对手逼近",
        process: "Speed Ramp：加速触发→顶点→慢放区间→收束停点",
        consequence: "地面震动",
        endState: "角色停在冲锋落点",
        ...overrides,
    };
}

function p7(overrides: Partial<NonNullable<StoryboardRow["p7"]>> = {}): NonNullable<StoryboardRow["p7"]> {
    return {
        primaryPurpose: "速度/冲击/爽感",
        basis: "她冲出门口，险些撞上迎面驶来的车。",
        techniques: ["Crash Zoom", "Whip Pan"],
        transcription: "从门内中景起，向右急甩，在车头切入画面时停住；撞击声与车头入画同点。",
        ...overrides,
    };
}

function segmentLock(overrides: Partial<DirectingLockSegment> = {}): DirectingLockSegment {
    return {
        segmentId: "seg-1",
        compositionPrimary: "权力压迫",
        compositionSecondary: "负空间吞噬",
        compositionDiversity: "通过",
        cameraType: "手持跟拍",
        scaleRange: "L0-L5",
        angleType: "平视/仰视",
        openingType: "钩子开场",
        ...overrides,
    };
}

function globalLock(overrides: Partial<DirectingLockGlobal> = {}): DirectingLockGlobal {
    return {
        visualStyle: "电影感写实",
        colorGrading: "暖金调",
        lighting: "逆光剪影",
        cameraTone: "手持跟拍",
        performanceLevel: "L4 戏剧化",
        unifiedStyleString: "cinematic realism, natural lighting",
        motifs: [],
        ...overrides,
    };
}

/** 从检查结果里按检查项标识取出对应的条目（可能有多条，按段展开）。 */
function itemsOf(items: QualityCheckItem[], kind: QualityCheckKind): QualityCheckItem[] {
    return items.filter((item) => item.kind === kind);
}

describe("runQualityCheck：全部达标", () => {
    it("两段各三镜、运镜/景别/角度/构图/格子数全部满足要求时，全部检查项通过", () => {
        const rows: StoryboardRow[] = [
            row({ segmentId: "seg1", shotId: "shot1", shotNo: 1, scale: "L0 大远景/建立", angle: "平视", p7: p7() }),
            row({ segmentId: "seg1", shotId: "shot2", shotNo: 2, scale: "L2 中景/中全景", angle: "仰视" }),
            row({ segmentId: "seg1", shotId: "shot3", shotNo: 3, scale: "L5 极特写/微距", angle: "俯视" }),
            row({ segmentId: "seg2", shotId: "shot4", shotNo: 1, scale: "L1 远景/全景", angle: "平视", p7: p7() }),
            row({ segmentId: "seg2", shotId: "shot5", shotNo: 2, scale: "L3 近景/中近景", angle: "俯视" }),
            row({ segmentId: "seg2", shotId: "shot6", shotNo: 3, scale: "L5 极特写/微距", angle: "仰视" }),
        ];
        const shotContracts: ShotContract[] = [
            contract({ shotId: "shot1", movement: "急推/急拉" }),
            contract({ shotId: "shot2", movement: "手持跟拍" }),
            contract({ shotId: "shot3", movement: "甩镜/快摇" }),
            contract({ shotId: "shot4", movement: "环绕镜头" }),
            contract({ shotId: "shot5", movement: "低角度推进" }),
            contract({ shotId: "shot6", movement: "滑轨侧跟" }),
        ];
        const directingLock: DirectingLock = {
            global: globalLock(),
            segments: [
                segmentLock({ segmentId: "seg1", compositionPrimary: "权力压迫", compositionSecondary: "负空间吞噬" }),
                segmentLock({ segmentId: "seg2", compositionPrimary: "对角线驱动", compositionSecondary: "前景切割" }),
            ],
        };

        const report = runQualityCheck({
            storyboardRows: rows,
            shotContracts,
            directingLock,
            storyboardPageCellCounts: { seg1: 3, seg2: 3 },
        });

        expect(report.items.length).toBeGreaterThan(0);
        expect(report.items.every((item) => item.status === "pass")).toBe(true);
        expect(report.summary.failed).toBe(0);
        expect(report.summary.unknown).toBe(0);
        expect(report.summary.total).toBe(report.items.length);
        expect(report.summary.passed).toBe(report.items.length);
    });
});

describe("runQualityCheck：运镜多样性（段级 ≥2 种）", () => {
    it("6 镜全用「固定位微动」时不通过，且能取到全部 6 个 shotId", () => {
        const rows: StoryboardRow[] = Array.from({ length: 6 }, (_, index) =>
            row({ segmentId: "segA", shotId: `shot${index + 1}`, shotNo: index + 1 }),
        );
        const shotContracts: ShotContract[] = rows.map((r) => contract({ shotId: r.shotId, movement: "固定位微动" }));

        const report = runQualityCheck({ storyboardRows: rows, shotContracts });
        const [item] = itemsOf(report.items, "cameraMovementDiversity");

        expect(item.status).toBe("fail");
        expect(item.segmentId).toBe("segA");
        expect(new Set(item.shotIds)).toEqual(new Set(["shot1", "shot2", "shot3", "shot4", "shot5", "shot6"]));
    });
});

describe("runQualityCheck：景别跨度（段级 ≥3 档含极值）", () => {
    it("只用中景与近景两档时不通过", () => {
        const rows: StoryboardRow[] = [
            row({ segmentId: "segB", shotId: "shotB1", shotNo: 1, scale: "L2 中景/中全景" }),
            row({ segmentId: "segB", shotId: "shotB2", shotNo: 2, scale: "L3 近景/中近景" }),
            row({ segmentId: "segB", shotId: "shotB3", shotNo: 3, scale: "L2 中景/中全景" }),
            row({ segmentId: "segB", shotId: "shotB4", shotNo: 4, scale: "L3 近景/中近景" }),
        ];

        const report = runQualityCheck({ storyboardRows: rows });
        const [item] = itemsOf(report.items, "shotScaleSpan");

        expect(item.status).toBe("fail");
        expect(item.actualValue).toContain("2 档");
    });
});

describe("runQualityCheck：短段保护（镜头数不足时物理上无法达标，标 unknown 而不是 fail）", () => {
    it("一个段只有 2 镜时，景别跨度标记为无法判定，而不是不通过（2 镜物理上凑不出 3 档）", () => {
        // 2 镜的段在 plus 分段规则（贴满 15s 打包）下是合法的短段形态，不是异常数据。
        const rows: StoryboardRow[] = [
            row({ segmentId: "segShort", shotId: "shotShort1", shotNo: 1, scale: "L2 中景/中全景", angle: "平视" }),
            row({ segmentId: "segShort", shotId: "shotShort2", shotNo: 2, scale: "L4 特写", angle: "仰视" }),
        ];
        const shotContracts: ShotContract[] = [
            contract({ shotId: "shotShort1", movement: "手持跟拍" }),
            contract({ shotId: "shotShort2", movement: "甩镜/快摇" }),
        ];

        const report = runQualityCheck({ storyboardRows: rows, shotContracts });

        const [spanItem] = itemsOf(report.items, "shotScaleSpan");
        expect(spanItem.status).toBe("unknown");
        expect(spanItem.reason).not.toContain("不满足");

        // 景别的"连续同景别"、运镜/角度的多样性（2 镜刚好能凑出 2 种）不受短段保护影响，照常判定
        expect(itemsOf(report.items, "shotScaleConsecutiveRepeat")[0].status).toBe("pass");
        expect(itemsOf(report.items, "cameraMovementDiversity")[0].status).toBe("pass");
        expect(itemsOf(report.items, "angleDiversity")[0].status).toBe("pass");
    });

    it("一个段只有 1 镜时，运镜多样性与角度多样性都标记为无法判定，而不是不通过（1 镜物理上凑不出 2 种）", () => {
        // 这是复核居中对称问题时顺带自查发现的同类问题（不是团队本轮点名的），一并修在这里。
        const rows: StoryboardRow[] = [row({ segmentId: "segOne", shotId: "shotOne1", shotNo: 1, scale: "L2 中景/中全景", angle: "平视" })];
        const shotContracts: ShotContract[] = [contract({ shotId: "shotOne1", movement: "手持跟拍" })];

        const report = runQualityCheck({ storyboardRows: rows, shotContracts });

        expect(itemsOf(report.items, "cameraMovementDiversity")[0].status).toBe("unknown");
        expect(itemsOf(report.items, "angleDiversity")[0].status).toBe("unknown");
    });
});

describe("runQualityCheck：镜级连续复用规则（同一段内多镜的真实场景）", () => {
    // 团队反馈：构图之外的三项（运镜/景别/角度）是镜头级字段，必须在"一段放 4-5 镜、按 shotNo 顺序变化"
    // 的真实形态数据上验证，不能只用退化的单镜段构造。这里让段首连续 3 镜复用同一取值（触发"连续复用"类
    // 检查失败），段内整体又凑够了 ≥2 种/≥3 档的多样性（多样性类检查应保持通过），证明两类检查互不干扰。
    it("段内 5 镜：整体多样性达标，但段首连续 3 镜复用同一运镜/景别/平视角度时，对应连续复用检查各自不通过", () => {
        const rows: StoryboardRow[] = [
            row({ segmentId: "segM", shotId: "shotM1", shotNo: 1, scale: "L2 中景/中全景", angle: "平视" }),
            row({ segmentId: "segM", shotId: "shotM2", shotNo: 2, scale: "L2 中景/中全景", angle: "平视" }),
            row({ segmentId: "segM", shotId: "shotM3", shotNo: 3, scale: "L2 中景/中全景", angle: "平视" }),
            row({ segmentId: "segM", shotId: "shotM4", shotNo: 4, scale: "L0 大远景/建立", angle: "仰视" }),
            row({ segmentId: "segM", shotId: "shotM5", shotNo: 5, scale: "L5 极特写/微距", angle: "俯视" }),
        ];
        const shotContracts: ShotContract[] = [
            contract({ shotId: "shotM1", movement: "手持跟拍" }),
            contract({ shotId: "shotM2", movement: "手持跟拍" }),
            contract({ shotId: "shotM3", movement: "手持跟拍" }),
            contract({ shotId: "shotM4", movement: "甩镜/快摇" }),
            contract({ shotId: "shotM5", movement: "环绕镜头" }),
        ];

        const report = runQualityCheck({ storyboardRows: rows, shotContracts });
        const expectRun = (kind: QualityCheckKind) => {
            const [item] = itemsOf(report.items, kind);
            expect(item.status).toBe("fail");
            expect(new Set(item.shotIds)).toEqual(new Set(["shotM1", "shotM2", "shotM3"]));
            return item;
        };

        // 整体多样性达标（3 种运镜/3 档景别含极值/3 种角度），不受局部连续复用影响
        expect(itemsOf(report.items, "cameraMovementDiversity")[0].status).toBe("pass");
        expect(itemsOf(report.items, "shotScaleSpan")[0].status).toBe("pass");
        expect(itemsOf(report.items, "angleDiversity")[0].status).toBe("pass");

        // 段首连续 3 镜复用同一取值，各自触发对应的连续复用检查
        expectRun("cameraMovementConsecutiveRepeat");
        expectRun("shotScaleConsecutiveRepeat");
        expectRun("angleLevelConsecutiveRun");
    });
});

describe("runQualityCheck：同构图连续（跨段）", () => {
    it("连续 3 段（第 3/4/5 段）使用相同构图主策略时不通过，并指出这 3 段涉及的全部镜头", () => {
        // 构图字段只存在于 directing-lock 的段级锁定表，同构图连续是跨段（segmentId）判定，
        // 不是跨镜头判定（见方法论 05-closed-libraries.md §1.1 与团队复核结论）。
        // 每段放 2 镜（而非退化的 1 镜/段），验证失败时报出的是"该段全部镜头"而不是巧合对上的单一 shotId。
        const rows: StoryboardRow[] = [1, 2, 3, 4, 5].flatMap((n) => [
            row({ segmentId: `seg${n}`, shotId: `shot${n}a`, shotNo: 1 }),
            row({ segmentId: `seg${n}`, shotId: `shot${n}b`, shotNo: 2 }),
        ]);
        const directingLock: DirectingLock = {
            global: globalLock(),
            segments: [
                segmentLock({ segmentId: "seg1", compositionPrimary: "权力压迫", compositionSecondary: "负空间吞噬" }),
                segmentLock({ segmentId: "seg2", compositionPrimary: "负空间吞噬", compositionSecondary: "权力压迫" }),
                segmentLock({ segmentId: "seg3", compositionPrimary: "对角线驱动", compositionSecondary: "前景切割" }),
                segmentLock({ segmentId: "seg4", compositionPrimary: "对角线驱动", compositionSecondary: "边缘出画" }),
                segmentLock({ segmentId: "seg5", compositionPrimary: "对角线驱动", compositionSecondary: "倾斜失衡" }),
            ],
        };

        const report = runQualityCheck({ storyboardRows: rows, directingLock });
        const [item] = itemsOf(report.items, "compositionConsecutiveRepeat");

        expect(item.status).toBe("fail");
        expect(item.segmentIds).toEqual(["seg3", "seg4", "seg5"]);
        expect(new Set(item.shotIds)).toEqual(new Set(["shot3a", "shot3b", "shot4a", "shot4b", "shot5a", "shot5b"]));
    });
});

describe("runQualityCheck：居中对称占比（跨段）", () => {
    it("6 段中 4 段构图判定为居中/对称时不通过（4/6 > 50%）", () => {
        // 4 个"命中"段里，2 个是字面选用了对称/中心构图（seg4/seg6），2 个是完全没从构图 8 策略里选、
        // 用了一个自创词（seg3/seg5，"自由构图"不在库内也不含"对称/中心"字样）——验证两条判定路径
        // （未选库内策略 / 字面对称中心）都能各自命中，不是只靠字面匹配撑起结果。
        const rows: StoryboardRow[] = [1, 2, 3, 4, 5, 6].flatMap((n) => [
            row({ segmentId: `seg${n}`, shotId: `shot${n}a`, shotNo: 1 }),
            row({ segmentId: `seg${n}`, shotId: `shot${n}b`, shotNo: 2 }),
        ]);
        const directingLock: DirectingLock = {
            global: globalLock(),
            segments: [
                segmentLock({ segmentId: "seg1", compositionPrimary: "权力压迫", compositionSecondary: "负空间吞噬" }),
                segmentLock({ segmentId: "seg2", compositionPrimary: "尺度反差", compositionSecondary: "纵深分层" }),
                segmentLock({ segmentId: "seg3", compositionPrimary: "自由构图", compositionSecondary: "边缘出画" }),
                segmentLock({ segmentId: "seg4", compositionPrimary: "中心构图 Center", compositionSecondary: "倾斜失衡" }),
                segmentLock({ segmentId: "seg5", compositionPrimary: "自由构图", compositionSecondary: "前景切割" }),
                segmentLock({ segmentId: "seg6", compositionPrimary: "对称构图 Symmetrical", compositionSecondary: "权力压迫" }),
            ],
        };

        const report = runQualityCheck({ storyboardRows: rows, directingLock });
        const [item] = itemsOf(report.items, "centeredSymmetricRatio");

        expect(item.status).toBe("fail");
        expect(item.actualValue).toContain("4/6");
        expect(new Set(item.segmentIds)).toEqual(new Set(["seg3", "seg4", "seg5", "seg6"]));
        expect(new Set(item.shotIds)).toEqual(new Set(["shot3a", "shot3b", "shot4a", "shot4b", "shot5a", "shot5b", "shot6a", "shot6b"]));
    });
});

describe("runQualityCheck：封闭词库合规", () => {
    it("出现自创运镜词（不在运镜 8 种封闭词库内）时不通过", () => {
        const rows: StoryboardRow[] = [row({ segmentId: "segC", shotId: "shotC1", shotNo: 1 })];
        const shotContracts: ShotContract[] = [contract({ shotId: "shotC1", movement: "综合运用推拉摇移" })];

        const report = runQualityCheck({ storyboardRows: rows, shotContracts });
        const [item] = itemsOf(report.items, "closedLibraryCompliance");

        expect(item.status).toBe("fail");
        expect(item.shotIds).toContain("shotC1");
        expect(item.reason).toContain("综合运用推拉摇移");
    });
});

describe("runQualityCheck：P7 导演技法决策", () => {
    it("旧产物不带 p7 时判 unknown，不判 fail", () => {
        const report = runQualityCheck({ storyboardRows: [row()] });
        const [item] = itemsOf(report.items, "p7Decision");

        expect(item.status).toBe("unknown");
        expect(report.summary.failed).toBe(0);
    });

    it("自创技法名判 fail，并在提示中点出原名", () => {
        const report = runQualityCheck({ storyboardRows: [row({ p7: p7({ techniques: ["Crash Zoom", "超级推镜"] }) })] });
        const [item] = itemsOf(report.items, "p7Decision");

        expect(item.status).toBe("fail");
        expect(item.warning).toBe(true);
        expect(item.reason).toContain("超级推镜");
        expect(item).not.toHaveProperty("blocking");
        expect(item).not.toHaveProperty("error");
    });

    it("有辅目的时 2 个技法判 fail，3 个且归属主辅目的行时通过", () => {
        const twoTechniques = runQualityCheck({
            storyboardRows: [row({ p7: p7({ secondaryPurpose: "转场/段落连接" }) })],
        });
        const threeTechniques = runQualityCheck({
            storyboardRows: [row({ p7: p7({ secondaryPurpose: "转场/段落连接", techniques: ["Crash Zoom", "Whip Pan", "声音桥"] }) })],
        });

        expect(itemsOf(twoTechniques.items, "p7Decision")[0].status).toBe("fail");
        expect(itemsOf(twoTechniques.items, "p7Decision")[0].reason).toContain("至少需要 3 个");
        expect(itemsOf(threeTechniques.items, "p7Decision")[0].status).toBe("pass");
    });

    it("转写含“综合考虑”时判 fail", () => {
        const report = runQualityCheck({ storyboardRows: [row({ p7: p7({ transcription: "综合考虑画面节奏，强化冲击感。" }) })] });
        const [item] = itemsOf(report.items, "p7Decision");

        expect(item.status).toBe("fail");
        expect(item.reason).toContain("综合考虑");
    });

    it("主目的越出九类或依据为空时判 fail", () => {
        const report = runQualityCheck({ storyboardRows: [row({ p7: p7({ primaryPurpose: "制造大片感", basis: "" }) })] });
        const [item] = itemsOf(report.items, "p7Decision");

        expect(item.status).toBe("fail");
        expect(item.reason).toContain("制造大片感");
        expect(item.reason).toContain("basis 为空");
    });
});

describe("runQualityCheck：高潮/爆点镜三件套 warning", () => {
    const climaxRow = row({
        segmentId: "seg-climax",
        shotId: "shot-climax",
        scale: "L4 特写",
        action: "她猛地推开门冲进雨里",
        mood: "高潮/爆点镜，决绝",
    });
    const climaxContract = contract({
        shotId: "shot-climax",
        scale: "L4 特写",
        movement: "手持跟拍",
        speed: "急",
        endpoint: "停在雨幕中",
    });
    const completeClimaxActionContract = actionContract({
        shotId: "shot-climax",
        cause: "门外的呼救声逼近",
        process:
            "L5 五部位：头部=向左猛转35度、幅度拉满、0.2秒完成；肩背=紧绷至极限并上提8厘米；手部=攥紧门把、最大力度、每秒2次加压；身形=向前大幅倾斜40度并跨出两步；身段=决绝凌厉的攻击气质；Speed Ramp：加速触发=推门前0.2秒急起；顶点=门板撞墙瞬间；慢放区间=雨水飞散后的0.4秒；收束停点=右脚落地后停住",
        consequence: "门板撞墙，雨水被带进屋内",
        endState: "她站在门外雨幕中锁定前方",
    });

    it("普通非高潮镜不产生 climaxTrio 的 fail", () => {
        const report = runQualityCheck({ storyboardRows: [row({ action: "她推开门走进屋", mood: "平静" })] });
        const [item] = itemsOf(report.items, "climaxTrio");

        expect(item.status).toBe("pass");
        expect(item.warning).not.toBe(true);
    });

    it("日常冲刺赶公交没有高潮 mood 前缀或高强度信号时不判 fail", () => {
        const report = runQualityCheck({ storyboardRows: [row({ action: "她冲刺去赶公交", mood: "着急", scale: "L2 中景/中全景" })] });
        const [item] = itemsOf(report.items, "climaxTrio");

        expect(item.status).not.toBe("fail");
        expect(item.warning).not.toBe(true);
    });

    it("五部位同处一句且只有手部参数时不能伪造通过", () => {
        const report = runQualityCheck({
            storyboardRows: [climaxRow],
            shotContracts: [climaxContract],
            actionContracts: [
                actionContract({
                    shotId: "shot-climax",
                    process:
                        "L5 五部位：头部、肩背、手部、身形、身段同处一个描述，仅手部抬起30度；Speed Ramp：加速触发=推门前0.2秒急起；顶点=门板撞墙瞬间；慢放区间=雨水飞散后的0.4秒；收束停点=右脚落地后停住",
                }),
            ],
        });
        const [item] = itemsOf(report.items, "climaxTrio");

        expect(item.status).not.toBe("pass");
        expect(item.actualValue).toContain("需人工确认");
    });

    it("高潮镜没有表演与节奏信息时标记为 unknown，而不是 fail", () => {
        const report = runQualityCheck({ storyboardRows: [climaxRow], shotContracts: [climaxContract] });
        const [item] = itemsOf(report.items, "climaxTrio");

        expect(item.status).toBe("unknown");
        expect(item.warning).toBe(false);
        expect(item.actualValue).toContain("需人工确认");
        expect(item.actualValue).toContain("L5 五部位");
        expect(item.actualValue).toContain("Speed Ramp 四要素");
    });

    it("高潮镜写了弱词时判 fail、warning 为 true 且不阻断", () => {
        const report = runQualityCheck({
            storyboardRows: [climaxRow],
            shotContracts: [climaxContract],
            actionContracts: [
                actionContract({
                    shotId: "shot-climax",
                    process: "L5 五部位：头部=微微低头5度；肩背=全力上提8厘米；手部=攥紧门把、最大力度、每秒2次加压；身形=向前大幅倾斜40度并跨出两步；身段=决绝凌厉的攻击气质",
                }),
            ],
        });
        const [item] = itemsOf(report.items, "climaxTrio");

        expect(item.status).toBe("fail");
        expect(item.warning).toBe(true);
        expect(item.actualValue).toContain("弱词");
        expect(item.reason).toContain("不阻断生成、不返回 error");
        expect(item).not.toHaveProperty("blocking");
        expect(item).not.toHaveProperty("error");
        expect(item.shotIds).toEqual(["shot-climax"]);
    });

    it("高潮镜写了 Speed Ramp 但四要素不全时判 fail、warning 为 true", () => {
        const report = runQualityCheck({
            storyboardRows: [climaxRow],
            shotContracts: [climaxContract],
            actionContracts: [actionContract({ shotId: "shot-climax", process: "Speed Ramp：加速触发=她突然冲刺；顶点=门板撞墙" })],
        });
        const [item] = itemsOf(report.items, "climaxTrio");

        expect(item.status).toBe("fail");
        expect(item.warning).toBe(true);
        expect(item.actualValue).toContain("慢放区间");
        expect(item.actualValue).toContain("收束停点");
    });

    it("高潮镜景别为 L2 时第三项判 fail", () => {
        const lowScaleContract = { ...climaxContract, scale: "L2 中景/中全景" };
        const report = runQualityCheck({
            storyboardRows: [{ ...climaxRow, scale: lowScaleContract.scale }],
            shotContracts: [lowScaleContract],
            actionContracts: [completeClimaxActionContract],
        });
        const [item] = itemsOf(report.items, "climaxTrio");

        expect(item.status).toBe("fail");
        expect(item.warning).toBe(true);
        expect(item.actualValue).toContain("③ L4/L5 关键特写");
        expect(item.actualValue).toContain("L2");
    });

    it.each(["L4 特写", "L5 极特写"])("高潮镜景别为 %s 时三件套通过，且不受全局 L3 表演基调影响", (scale) => {
        const report = runQualityCheck({
            storyboardRows: [{ ...climaxRow, scale }],
            shotContracts: [{ ...climaxContract, scale }],
            actionContracts: [completeClimaxActionContract],
            directingLock: { global: globalLock({ performanceLevel: "L3 自然" }) },
        });
        const [item] = itemsOf(report.items, "climaxTrio");

        expect(item.status).toBe("pass");
        expect(item.warning).toBe(false);
    });
});

describe("runQualityCheck：格子数一致", () => {
    it("分镜表 5 行但故事板只有 4 格时不通过", () => {
        const rows: StoryboardRow[] = Array.from({ length: 5 }, (_, index) =>
            row({ segmentId: "segX", shotId: `shotX${index + 1}`, shotNo: index + 1 }),
        );

        const report = runQualityCheck({ storyboardRows: rows, storyboardPageCellCounts: { segX: 4 } });
        const [item] = itemsOf(report.items, "cellCountMatch");

        expect(item.status).toBe("fail");
        expect(item.actualValue).toContain("5 行");
        expect(item.actualValue).toContain("4 格");
    });
});

describe("runQualityCheck：数据缺失时优雅降级为「无法判定」", () => {
    it("分镜表为空时，全部检查项标记为无法判定，不崩溃也不误判为不通过", () => {
        const report = runQualityCheck({ storyboardRows: [] });

        expect(report.items.length).toBeGreaterThan(0);
        expect(report.items.every((item) => item.status === "unknown")).toBe(true);
        expect(report.summary.failed).toBe(0);
    });

    it("没有镜头合同时，运镜多样性与运镜连续复用都标记为无法判定，而不是不通过", () => {
        const rows: StoryboardRow[] = [
            row({ segmentId: "seg1", shotId: "shot1", shotNo: 1 }),
            row({ segmentId: "seg1", shotId: "shot2", shotNo: 2 }),
        ];

        const report = runQualityCheck({ storyboardRows: rows });

        expect(itemsOf(report.items, "cameraMovementDiversity").every((item) => item.status === "unknown")).toBe(true);
        expect(itemsOf(report.items, "cameraMovementConsecutiveRepeat").every((item) => item.status === "unknown")).toBe(true);
    });
});
