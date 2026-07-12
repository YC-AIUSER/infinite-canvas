/**
 * 段生命周期遵循 design doc：以稳定 segmentId 为键，segmentIndex 仅表示显示顺序。
 */

import type { StoryboardRow } from "./schema";

export type SegmentPlan = {
    segmentId: string;
    segmentIndex: number;
    shotIds: string[];
};

export type SegmentInstance = {
    segmentId: string;
    nodeIds: {
        storyboardPage?: string;
        keyframes?: string;
        video?: string;
    };
};

export type SegmentDiff = {
    kept: string[];
    added: string[];
    removed: string[];
    reindexed: Array<{ segmentId: string; from: number; to: number }>;
};

export type SegmentValidationIssue = {
    segmentId?: string;
    shotId?: string;
    message: string;
    warning: boolean;
};

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** 生成指定长度的简版随机 base36 字符串。 */
function randomBase36(length: number) {
    let value = "";
    for (let index = 0; index < length; index += 1) {
        value += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
    }
    return value;
}

/** 生成当前集合内唯一的带前缀 ID。 */
function createUniqueId(prefix: "seg" | "shot", usedIds: Set<string>) {
    let id = "";
    do {
        id = `${prefix}_${randomBase36(8)}`;
    } while (usedIds.has(id));
    usedIds.add(id);
    return id;
}

/** 为模型新增的空身份行补充分段与镜头 ID，不修改输入数组。 */
export function assignIds(rows: StoryboardRow[]) {
    const usedSegmentIds = new Set(rows.map((row) => row.segmentId).filter(Boolean));
    const usedShotIds = new Set(rows.map((row) => row.shotId).filter(Boolean));
    const newSegmentIds: string[] = [];
    const newShotIds: string[] = [];

    const assignedRows = rows.map((row) => {
        let segmentId = row.segmentId;
        if (!segmentId) {
            segmentId = createUniqueId("seg", usedSegmentIds);
            newSegmentIds.push(segmentId);
        }

        let shotId = row.shotId;
        if (!shotId) {
            shotId = createUniqueId("shot", usedShotIds);
            newShotIds.push(shotId);
        }

        return { ...row, segmentId, shotId };
    });

    return { rows: assignedRows, newSegmentIds, newShotIds };
}

/** 严格按稳定 segmentId 比较新旧段，并记录显示顺序变化。 */
export function diffSegments(oldPlan: SegmentPlan[], newRows: StoryboardRow[]): SegmentDiff {
    const oldById = new Map(oldPlan.map((segment) => [segment.segmentId, segment]));
    const newSegmentIds = [...new Set(newRows.map((row) => row.segmentId))];
    const newIdSet = new Set(newSegmentIds);
    const kept = newSegmentIds.filter((segmentId) => oldById.has(segmentId));
    const added = newSegmentIds.filter((segmentId) => !oldById.has(segmentId));
    const removed = oldPlan.filter((segment) => !newIdSet.has(segment.segmentId)).map((segment) => segment.segmentId);
    const reindexed = kept.flatMap((segmentId) => {
        const from = oldById.get(segmentId)?.segmentIndex;
        const to = newSegmentIds.indexOf(segmentId);
        return from !== undefined && from !== to ? [{ segmentId, from, to }] : [];
    });

    return { kept, added, removed, reindexed };
}

/** 把段差异转换为实例创建、失效和归档动作。 */
export function reconcileInstances(diff: SegmentDiff, instances: SegmentInstance[]) {
    const keptIds = new Set(diff.kept);
    const removedIds = new Set(diff.removed);
    const toStale = instances
        .filter((instance) => keptIds.has(instance.segmentId))
        .flatMap((instance) => Object.values(instance.nodeIds).filter((nodeId): nodeId is string => Boolean(nodeId)));
    const toArchive = instances.filter((instance) => removedIds.has(instance.segmentId));

    return { toCreate: [...diff.added], toStale, toArchive };
}

/** 按 segmentId 分组，并在每个段内按 shotNo 升序排列。 */
export function groupRowsBySegment(rows: StoryboardRow[]) {
    const groups = new Map<string, StoryboardRow[]>();
    for (const row of rows) {
        const group = groups.get(row.segmentId) ?? [];
        group.push(row);
        groups.set(row.segmentId, group);
    }
    for (const [segmentId, group] of groups) {
        groups.set(segmentId, [...group].sort((left, right) => left.shotNo - right.shotNo));
    }
    return groups;
}

/** 校验镜号、时长、镜头身份与每段最低镜头数，返回可读问题列表。 */
export function validateSegmentRows(rows: StoryboardRow[]): SegmentValidationIssue[] {
    const issues: SegmentValidationIssue[] = [];
    const groups = groupRowsBySegment(rows);
    const shotOwners = new Map<string, string>();

    for (const row of rows) {
        const owner = shotOwners.get(row.shotId);
        if (owner !== undefined) {
            issues.push({
                segmentId: row.segmentId,
                shotId: row.shotId,
                message: `镜头 ID ${row.shotId} 重复，已在段 ${owner} 中使用。`,
                warning: false,
            });
        } else {
            shotOwners.set(row.shotId, row.segmentId);
        }
    }

    for (const [segmentId, segmentRows] of groups) {
        if (segmentRows.length === 0) {
            issues.push({ segmentId, message: `段 ${segmentId} 至少需要 1 镜。`, warning: false });
            continue;
        }

        const shotNumbers = segmentRows.map((row) => row.shotNo);
        const hasContinuousShotNumbers = shotNumbers.every((shotNo, index) => shotNo === index + 1);
        if (!hasContinuousShotNumbers) {
            issues.push({
                segmentId,
                message: `段 ${segmentId} 的 shotNo 必须从 1 开始连续且不重复，当前为 ${shotNumbers.join("、")}。`,
                warning: false,
            });
        }

        const durationSec = segmentRows.reduce((total, row) => total + row.durationSec, 0);
        if (durationSec < 12 || durationSec > 15) {
            issues.push({
                segmentId,
                message: `段 ${segmentId} 总时长为 ${durationSec} 秒，建议控制在 12-15 秒。`,
                warning: true,
            });
        }
    }

    return issues;
}
