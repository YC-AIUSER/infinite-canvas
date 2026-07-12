import { describe, expect, it, vi } from "vitest";

import type { StoryboardRow } from "../schema";
import {
    assignIds,
    diffSegments,
    groupRowsBySegment,
    reconcileInstances,
    validateSegmentRows,
    type SegmentDiff,
    type SegmentInstance,
    type SegmentPlan,
} from "../segments";

function row(overrides: Partial<StoryboardRow> = {}): StoryboardRow {
    return {
        segmentId: "seg-a",
        shotId: "shot-a-1",
        shotNo: 1,
        scale: "中景",
        angle: "平视",
        action: "角色抬手",
        line: "你好",
        sfx: "环境声",
        mood: "平静",
        durationSec: 12,
        assetSlots: [],
        ...overrides,
    };
}

describe("assignIds", () => {
    it("为空 ID 分配新 ID", () => {
        const result = assignIds([row({ segmentId: "", shotId: "" })]);
        expect(result.rows[0].segmentId).not.toBe("");
        expect(result.rows[0].shotId).not.toBe("");
        expect(result.newSegmentIds).toEqual([result.rows[0].segmentId]);
        expect(result.newShotIds).toEqual([result.rows[0].shotId]);
    });

    it("保留非空 ID", () => {
        const result = assignIds([row({ segmentId: "seg-fixed", shotId: "shot-fixed" })]);
        expect(result.rows[0]).toMatchObject({ segmentId: "seg-fixed", shotId: "shot-fixed" });
        expect(result.newSegmentIds).toEqual([]);
        expect(result.newShotIds).toEqual([]);
    });

    it("不修改输入数组及其行对象", () => {
        const input = [row({ segmentId: "", shotId: "" })];
        const snapshot = structuredClone(input);
        const result = assignIds(input);
        expect(input).toEqual(snapshot);
        expect(result.rows).not.toBe(input);
        expect(result.rows[0]).not.toBe(input[0]);
    });

    it("新 ID 唯一且带正确前缀", () => {
        let call = 0;
        const randomSpy = vi.spyOn(Math, "random").mockImplementation(() => (call++ % 36) / 36);
        try {
            const result = assignIds([
                row({ segmentId: "", shotId: "" }),
                row({ segmentId: "", shotId: "", shotNo: 2 }),
            ]);
            expect(new Set(result.newSegmentIds).size).toBe(2);
            expect(new Set(result.newShotIds).size).toBe(2);
            expect(result.newSegmentIds.every((id) => /^seg_[0-9a-z]{8}$/.test(id))).toBe(true);
            expect(result.newShotIds.every((id) => /^shot_[0-9a-z]{8}$/.test(id))).toBe(true);
        } finally {
            randomSpy.mockRestore();
        }
    });
});

describe("diffSegments", () => {
    it("按 segmentId 匹配 kept、added 与 removed", () => {
        const oldPlan: SegmentPlan[] = [
            { segmentId: "seg-a", segmentIndex: 0, shotIds: ["shot-a"] },
            { segmentId: "seg-b", segmentIndex: 1, shotIds: ["shot-b"] },
        ];
        const newRows = [row({ segmentId: "seg-a" }), row({ segmentId: "seg-c", shotId: "shot-c" })];
        expect(diffSegments(oldPlan, newRows)).toMatchObject({
            kept: ["seg-a"],
            added: ["seg-c"],
            removed: ["seg-b"],
        });
    });

    it("顺序变化记录为 reindexed", () => {
        const oldPlan: SegmentPlan[] = [
            { segmentId: "seg-a", segmentIndex: 0, shotIds: [] },
            { segmentId: "seg-b", segmentIndex: 1, shotIds: [] },
        ];
        const newRows = [
            row({ segmentId: "seg-b", shotId: "shot-b" }),
            row({ segmentId: "seg-a", shotId: "shot-a" }),
        ];
        expect(diffSegments(oldPlan, newRows).reindexed).toEqual([
            { segmentId: "seg-b", from: 1, to: 0 },
            { segmentId: "seg-a", from: 0, to: 1 },
        ]);
    });
});

describe("reconcileInstances", () => {
    const diff: SegmentDiff = {
        kept: ["seg-kept"],
        added: ["seg-added"],
        removed: ["seg-removed"],
        reindexed: [],
    };
    const removedInstance: SegmentInstance = {
        segmentId: "seg-removed",
        nodeIds: { storyboardPage: "removed-page" },
    };
    const instances: SegmentInstance[] = [
        {
            segmentId: "seg-kept",
            nodeIds: { storyboardPage: "page", keyframes: "keyframes", video: "video" },
        },
        removedInstance,
    ];

    it("kept 段的全部实例 nodeId 进入 toStale", () => {
        expect(reconcileInstances(diff, instances).toStale).toEqual(["page", "keyframes", "video"]);
    });

    it("added 段进入 toCreate", () => {
        expect(reconcileInstances(diff, instances).toCreate).toEqual(["seg-added"]);
    });

    it("removed 段实例进入 toArchive", () => {
        expect(reconcileInstances(diff, instances).toArchive).toEqual([removedInstance]);
    });
});

describe("groupRowsBySegment", () => {
    it("按段分组且段内按 shotNo 升序", () => {
        const groups = groupRowsBySegment([
            row({ segmentId: "seg-a", shotId: "shot-a-2", shotNo: 2 }),
            row({ segmentId: "seg-b", shotId: "shot-b-1", shotNo: 1 }),
            row({ segmentId: "seg-a", shotId: "shot-a-1", shotNo: 1 }),
        ]);
        expect([...groups.keys()]).toEqual(["seg-a", "seg-b"]);
        expect(groups.get("seg-a")?.map((item) => item.shotNo)).toEqual([1, 2]);
    });
});

describe("validateSegmentRows", () => {
    it("shotNo 不连续时返回 error", () => {
        const issues = validateSegmentRows([
            row({ shotId: "shot-1", shotNo: 1, durationSec: 6 }),
            row({ shotId: "shot-3", shotNo: 3, durationSec: 6 }),
        ]);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({ segmentId: "seg-a", warning: false });
        expect(issues[0].message).toContain("shotNo");
    });

    it("shotId 跨段重复时返回 error", () => {
        const issues = validateSegmentRows([
            row({ segmentId: "seg-a", shotId: "shot-dup" }),
            row({ segmentId: "seg-b", shotId: "shot-dup" }),
        ]);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({ segmentId: "seg-b", shotId: "shot-dup", warning: false });
        expect(issues[0].message).toContain("重复");
    });

    it("总时长超界时仅返回 warning", () => {
        const issues = validateSegmentRows([row({ durationSec: 10 })]);
        expect(issues).toHaveLength(1);
        expect(issues[0].warning).toBe(true);
        expect(issues.every((issue) => issue.warning)).toBe(true);
    });

    it("正常数据返回零 issue", () => {
        const issues = validateSegmentRows([
            row({ shotId: "shot-1", shotNo: 1, durationSec: 6 }),
            row({ shotId: "shot-2", shotNo: 2, durationSec: 6 }),
        ]);
        expect(issues).toEqual([]);
    });
});
