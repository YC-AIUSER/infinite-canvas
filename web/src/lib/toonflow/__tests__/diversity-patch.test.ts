import { describe, expect, it } from "vitest";

import { renderLibraries } from "../closed-libraries";
import { applyDiversityPatch } from "../node-runtime";
import { buildDiversityRepairPrompt } from "../prompts";
import { runQualityCheck, type QualityCheckItem, type QualityCheckKind } from "../quality-check";
import { DiversityPatchSchema, parseModelJson, type DiversityPatchItem, type ShotContract, type StoryboardRow } from "../schema";

function row(overrides: Partial<StoryboardRow> = {}): StoryboardRow {
    return {
        segmentId: "seg1",
        shotId: "shot1",
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
        shotId: "shot1",
        scale: "L2 中景/中全景",
        angle: "平视",
        movement: "固定位微动",
        speed: "常速",
        subjectRelation: "单人",
        endpoint: "停在正脸",
        inOut: { include: [], exclude: [] },
        ...overrides,
    };
}

function patch(overrides: Partial<DiversityPatchItem> = {}): DiversityPatchItem {
    return {
        shotId: "shot1",
        target: "shotContract",
        field: "movement",
        oldValue: "固定位微动",
        newValue: "急推/急拉",
        reason: "本段六镜全是固定位微动，改此镜以凑齐 ≥2 种运镜",
        fixes: [{ kind: "cameraMovementDiversity", segmentId: "seg1" }],
        ...overrides,
    };
}

/** 三镜一段的基线数据：分镜表行与镜头合同 shotId 一一对应。 */
function baseline() {
    const rows = [
        row({ shotId: "shot1", shotNo: 1 }),
        row({ shotId: "shot2", shotNo: 2, scale: "L3 近景/中近景", angle: "俯视" }),
        row({ shotId: "shot3", shotNo: 3, scale: "L4 特写", angle: "仰视" }),
    ];
    const shotContracts = [contract({ shotId: "shot1" }), contract({ shotId: "shot2" }), contract({ shotId: "shot3" })];
    return { rows, shotContracts };
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function itemsOf(items: QualityCheckItem[], kind: QualityCheckKind): QualityCheckItem[] {
    return items.filter((item) => item.kind === kind);
}

describe("applyDiversityPatch：定点修", () => {
    it("只改补丁点名的那一镜的那一个字段，其余镜头逐字不变", () => {
        const { rows, shotContracts } = baseline();

        const result = applyDiversityPatch({ rows, shotContracts }, [patch({ shotId: "shot2", newValue: "环绕镜头" })]);

        expect(result.applied).toHaveLength(1);
        expect(result.skipped).toEqual([]);
        // 被点名的镜头只有 movement 变了，其它字段原样
        expect(result.shotContracts[1]).toEqual({ ...shotContracts[1], movement: "环绕镜头" });
        // 未被点名的镜头逐字不变（深比较）
        expect(result.shotContracts.filter((item) => item.shotId !== "shot2")).toEqual(shotContracts.filter((item) => item.shotId !== "shot2"));
        // 补丁只落在镜头合同上时，分镜表整表不变
        expect(result.rows).toEqual(rows);
    });

    it("景别成对补丁：分镜表行与镜头合同各改一条，两处同镜同值，其余镜头不受影响", () => {
        const { rows, shotContracts } = baseline();

        const result = applyDiversityPatch({ rows, shotContracts }, [
            patch({ shotId: "shot3", target: "storyboardRow", field: "scale", oldValue: "L4 特写", newValue: "L0 大远景/建立" }),
            patch({ shotId: "shot3", target: "shotContract", field: "scale", oldValue: "L2 中景/中全景", newValue: "L0 大远景/建立" }),
        ]);

        expect(result.applied).toHaveLength(2);
        expect(result.rows[2].scale).toBe("L0 大远景/建立");
        expect(result.shotContracts[2].scale).toBe("L0 大远景/建立");
        expect(result.rows.slice(0, 2)).toEqual(rows.slice(0, 2));
        expect(result.shotContracts.slice(0, 2)).toEqual(shotContracts.slice(0, 2));
    });

    it("部分应用：只选其中 1 条时，另一条涉及的镜头完全不受影响", () => {
        const { rows, shotContracts } = baseline();
        const patchForShot1 = patch({ shotId: "shot1", newValue: "环绕镜头" });
        const patchForShot3 = patch({ shotId: "shot3", newValue: "甩镜/快摇" });

        // UI 的「部分应用」= 只把用户勾选的那几条传进来
        const result = applyDiversityPatch({ rows, shotContracts }, [patchForShot1]);

        expect(result.applied).toEqual([patchForShot1]);
        expect(result.shotContracts[0].movement).toBe("环绕镜头");
        expect(result.shotContracts[2]).toEqual(shotContracts[2]);
        expect(result.shotContracts[2].movement).not.toBe(patchForShot3.newValue);
    });

    it("补丁引用不存在的 shotId 时跳过并报告，同批其余补丁照常应用", () => {
        const { rows, shotContracts } = baseline();
        const ghostPatch = patch({ shotId: "shot404", newValue: "环绕镜头" });
        const goodPatch = patch({ shotId: "shot2", newValue: "甩镜/快摇" });

        const result = applyDiversityPatch({ rows, shotContracts }, [ghostPatch, goodPatch]);

        expect(result.applied).toEqual([goodPatch]);
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0].patch).toBe(ghostPatch);
        expect(result.skipped[0].reason).toContain("shot404");
        expect(result.shotContracts[1].movement).toBe("甩镜/快摇");
    });

    it("补丁指向非法字段时跳过并报告，不写入任何数据", () => {
        const { rows, shotContracts } = baseline();
        const illegalOnRow = patch({ shotId: "shot1", target: "storyboardRow", field: "action", newValue: "改剧情" });
        // movement 只存在于镜头合同，写到分镜表行上同样非法
        const movementOnRow = patch({ shotId: "shot1", target: "storyboardRow", field: "movement", newValue: "环绕镜头" });
        const illegalOnContract = patch({ shotId: "shot1", target: "shotContract", field: "endpoint", newValue: "改落点" });

        const result = applyDiversityPatch({ rows, shotContracts }, [illegalOnRow, movementOnRow, illegalOnContract]);

        expect(result.applied).toEqual([]);
        expect(result.skipped.map((skip) => skip.patch)).toEqual([illegalOnRow, movementOnRow, illegalOnContract]);
        expect(result.skipped[0].reason).toContain("action");
        expect(result.skipped[2].reason).toContain("endpoint");
        expect(result.rows).toEqual(rows);
        expect(result.shotContracts).toEqual(shotContracts);
    });

    it("纯函数：入参数组与其中的对象都不被修改", () => {
        const { rows, shotContracts } = baseline();
        const rowsBefore = clone(rows);
        const contractsBefore = clone(shotContracts);

        applyDiversityPatch({ rows, shotContracts }, [
            patch({ shotId: "shot1", newValue: "环绕镜头" }),
            patch({ shotId: "shot2", target: "storyboardRow", field: "angle", oldValue: "俯视", newValue: "仰视" }),
        ]);

        expect(rows).toEqual(rowsBefore);
        expect(shotContracts).toEqual(contractsBefore);
    });

    it("没有镜头合同时，落在镜头合同上的补丁跳过并报告，分镜表补丁照常应用", () => {
        const { rows } = baseline();

        const result = applyDiversityPatch({ rows }, [
            patch({ shotId: "shot1" }),
            patch({ shotId: "shot1", target: "storyboardRow", field: "angle", oldValue: "平视", newValue: "仰视" }),
        ]);

        expect(result.shotContracts).toEqual([]);
        expect(result.skipped).toHaveLength(1);
        expect(result.applied).toHaveLength(1);
        expect(result.rows[0].angle).toBe("仰视");
    });
});

describe("buildDiversityRepairPrompt", () => {
    const rows = [
        row({ shotId: "shotP1", shotNo: 1 }),
        row({ shotId: "shotP2", shotNo: 2 }),
        row({ shotId: "shotP3", shotNo: 3 }),
    ];
    const shotContracts = [contract({ shotId: "shotP1" }), contract({ shotId: "shotP2" }), contract({ shotId: "shotP3" })];
    const failedItems = itemsOf(runQualityCheck({ storyboardRows: rows, shotContracts }).items, "cameraMovementDiversity");

    it("点名可改的 shotId，并声明清单外镜头一个字不许动", () => {
        const prompt = buildDiversityRepairPrompt({ rows, shotContracts, failedItems });

        expect(prompt).toContain("【只许修改这些 shotId】");
        expect(prompt).toContain("shotP1、shotP2、shotP3");
        expect(prompt).toContain("清单外的镜头一个字不许动");
        expect(prompt).toContain("禁止新增、删除、重排镜头");
    });

    it("带上不达标项的判定事实与当前分镜数据，并要求逐条给理由", () => {
        const prompt = buildDiversityRepairPrompt({ rows, shotContracts, failedItems });

        expect(prompt).toContain("kind=cameraMovementDiversity");
        expect(prompt).toContain(failedItems[0].reason);
        expect(prompt).toContain("固定位微动");
        expect(prompt).toContain("fixes");
        expect(prompt).toContain("reason");
    });

    // 铁律 3：词条只能来自 closed-libraries.ts，prompt 里不许手抄。
    it("逐字注入 renderLibraries 的运镜与景别词库产物", () => {
        const prompt = buildDiversityRepairPrompt({ rows, shotContracts, failedItems });

        expect(prompt).toContain("【封闭词库 · 逐字选取");
        expect(prompt).toContain(renderLibraries(["cameraMovement", "shotScale"]));
    });

    it("要求只输出 JSON 且给出补丁的英文键名", () => {
        const prompt = buildDiversityRepairPrompt({ rows, shotContracts, failedItems });

        expect(prompt).toContain("仅输出合法 JSON 对象，不要 Markdown 代码块");
        for (const key of ["targets", "patches", "shotId", "target", "field", "oldValue", "newValue"]) {
            expect(prompt).toContain(key);
        }
    });

    it("没有镜头合同的镜头如实标注，不编造运镜", () => {
        const prompt = buildDiversityRepairPrompt({ rows, failedItems });

        expect(prompt).toContain("（该镜没有镜头合同）");
    });
});

describe("一键修改回路：检查不达标 → 补丁 → 应用 → 复检通过", () => {
    it("6 镜全「固定位微动」判运镜不达标，应用补丁后该项转为通过", () => {
        const rows: StoryboardRow[] = Array.from({ length: 6 }, (_, index) =>
            row({ segmentId: "segLoop", shotId: `shotL${index + 1}`, shotNo: index + 1 }),
        );
        const shotContracts: ShotContract[] = rows.map((item) => contract({ shotId: item.shotId, movement: "固定位微动" }));

        const before = runQualityCheck({ storyboardRows: rows, shotContracts });
        expect(itemsOf(before.items, "cameraMovementDiversity")[0].status).toBe("fail");
        expect(itemsOf(before.items, "cameraMovementConsecutiveRepeat")[0].status).toBe("fail");

        // 模型会返回 JSON 文本，这里按同一条解析路径走一遍，验证 schema 能接住补丁产物。
        const rawPatchJson = JSON.stringify({
            targets: [{ kind: "cameraMovementDiversity", segmentId: "segLoop" }],
            patches: [
                {
                    shotId: "shotL3",
                    target: "shotContract",
                    field: "movement",
                    oldValue: "固定位微动",
                    newValue: "急推/急拉",
                    reason: "第 3 镜改急推/急拉，凑齐第 2 种运镜并打断连续游程",
                    fixes: [{ kind: "cameraMovementDiversity", segmentId: "segLoop" }],
                },
                {
                    shotId: "shotL6",
                    target: "shotContract",
                    field: "movement",
                    oldValue: "固定位微动",
                    newValue: "环绕镜头",
                    reason: "第 6 镜改环绕镜头，避免第 4-6 镜再次形成 3 连同种运镜",
                    fixes: [{ kind: "cameraMovementConsecutiveRepeat", segmentId: "segLoop" }],
                },
            ],
        });
        const parsed = parseModelJson(DiversityPatchSchema, rawPatchJson);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;

        const result = applyDiversityPatch({ rows, shotContracts }, parsed.data.patches);
        expect(result.skipped).toEqual([]);

        const after = runQualityCheck({ storyboardRows: result.rows, shotContracts: result.shotContracts });
        expect(itemsOf(after.items, "cameraMovementDiversity")[0].status).toBe("pass");
        expect(itemsOf(after.items, "cameraMovementConsecutiveRepeat")[0].status).toBe("pass");

        // 定点修不许波及其它镜头：没被点名的 4 镜逐字不变
        const untouched = new Set(["shotL1", "shotL2", "shotL4", "shotL5"]);
        expect(result.shotContracts.filter((item) => untouched.has(item.shotId))).toEqual(shotContracts.filter((item) => untouched.has(item.shotId)));
        expect(result.rows).toEqual(rows);
    });
});
