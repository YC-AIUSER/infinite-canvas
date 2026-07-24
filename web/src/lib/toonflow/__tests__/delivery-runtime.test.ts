import { describe, expect, it } from "vitest";

import { buildDubbingPlan, canApproveSegment, emptyQualityReview, matchSeamContract } from "../node-runtime";
import type { DirectingLock, QualityReview, StoryboardRow } from "../schema";

function rows(...items: Array<Partial<StoryboardRow> & Pick<StoryboardRow, "shotId" | "shotNo">>): StoryboardRow[] {
    return items.map((item) => ({
        segmentId: "seg-a",
        scale: "中景",
        angle: "平视",
        action: "动作",
        line: "",
        sfx: "",
        mood: "紧张",
        durationSec: 1,
        ...item,
    }));
}

function checkedReview(): QualityReview {
    return { items: emptyQualityReview().items.map((item) => ({ ...item, checked: true })) };
}

const lock = {
    global: {
        visualStyle: "写实",
        colorGrading: "冷调",
        lighting: "侧光",
        cameraTone: "克制",
        performanceLevel: "L4",
        unifiedStyleString: "统一",
        motifs: [],
    },
    seams: [
        {
            fromSegmentId: "seg-a",
            toSegmentId: "seg-b",
            prevEndBeat: "抬手停在半空",
            nextFirstPanel: "手继续落下",
            scaleOrMotivation: "近景切全景，跳两档",
            soundBridge: "L-cut 拖尾 0.4s",
            audioBoundary: "段尾 0.5s 不起新持续音",
        },
    ],
} satisfies DirectingLock;

describe("canApproveSegment", () => {
    it("七项全勾且无 P0 时允许通过", () => {
        expect(canApproveSegment(checkedReview())).toBe(true);
    });

    it("存在未清 P0 时拦截", () => {
        const review = checkedReview();
        review.items[0] = { ...review.items[0], severity: "P0", note: "角色变脸" };
        expect(canApproveSegment(review)).toBe(false);
    });

    it("任一项未勾时拦截", () => {
        const review = checkedReview();
        review.items[3] = { ...review.items[3], checked: false };
        expect(canApproveSegment(review)).toBe(false);
    });
});

describe("matchSeamContract", () => {
    it("按 fromSegment/toSegment 段序命中", () => {
        expect(matchSeamContract({ fromSegmentId: "seg-a", toSegmentId: "seg-b" }, lock)?.prevEndBeat).toBe("抬手停在半空");
    });

    it("未签合同返回 undefined", () => {
        expect(matchSeamContract({ fromSegmentId: "seg-a", toSegmentId: "seg-c" }, lock)).toBeUndefined();
    });

    it("段序反向不能错位命中", () => {
        expect(matchSeamContract({ fromSegmentId: "seg-b", toSegmentId: "seg-a" }, lock)).toBeUndefined();
    });
});

describe("buildDubbingPlan", () => {
    it("按段内前序镜头 durationSec 累计计划偏移", () => {
        const plan = buildDubbingPlan(rows(
            { shotId: "s1", shotNo: 1, line: "出口对白-顾沉舟：别开门", durationSec: 2.5 },
            { shotId: "s2", shotNo: 2, durationSec: 3 },
            { shotId: "s3", shotNo: 3, line: "出口对白-林夏：来不及了", durationSec: 1 },
        ), { 顾沉舟: "onyx", 林夏: "nova" });

        expect(plan.map((item) => [item.shotId, item.plannedOffsetSec, item.voice])).toEqual([
            ["s1", 0, "onyx"],
            ["s3", 5.5, "nova"],
        ]);
    });

    it("OS 角色未配音色时使用旁白音色兜底", () => {
        const plan = buildDubbingPlan(rows({ shotId: "s1", shotNo: 1, line: "OS-林夏：门后有人" }), { 旁白: "shimmer" });
        expect(plan[0]).toMatchObject({ type: "os", speaker: "林夏", voice: "shimmer" });
    });

    it("无对白和 OS 的段返回空计划", () => {
        expect(buildDubbingPlan(rows({ shotId: "s1", shotNo: 1, line: "" }, { shotId: "s2", shotNo: 2, line: "" }))).toEqual([]);
    });
});
