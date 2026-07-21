/**
 * Toonflow 分镜表质量检查器——四维镜头语言多样性 + 封闭词库合规 + 格子数一致。
 *
 * 方法论源（判定口径以这两处原文为准，本文件的解读见下方各检查函数注释）：
 * - `ai-manga-workflow/.claude/skills/ai-short-drama-plus/references/05-closed-libraries.md` §1.1（构图多样性阻断规则）
 * - `ai-manga-workflow/.claude/skills/ai-short-drama-plus/references/04-directing-decisions.md` §2（分镜决策锁定表）+ §5（四维多样性阻断）+ D5.1（景别分布）
 * 设计文档：`docs/superpowers/specs/2026-07-21-toonflow-plus-refactor-design.md` §4.5。
 *
 * 决策 D4（设计文档）：只提示不阻断。本模块只输出事实性检查结果，不抛异常、不表达"阻止提交"语义，
 * 是否通过、是否应用一键修改由用户决定；输出结构用于驱动 UI 展示，并为下一轮「一键修改方案」提供
 * 定点修复所需的 shotId 定位。
 *
 * 四维多样性判定口径一览（经与设计需求方复核确认）：
 *
 * | 维度 | 粒度 | 规则 |
 * |:---|:---|:---|
 * | 运镜 | 镜级 | ≥2 种；同种连续 <3 镜 |
 * | 景别 | 镜级 | 可解析镜头数 <3 时不判定（物理上凑不出 3 档）；≥3 时要求 ≥3 档且含极值 L0/L5；连续同景别 <3 镜 |
 * | 角度 | 镜级 | ≥2 种；平视连续 ≤2 镜 |
 * | 构图 | 段级 | ≥2 种；同构图连续 <3 段；居中对称 <50% |
 *
 * 运镜/景别/角度是镜头级字段（ShotContract.movement、StoryboardRow.scale/angle），按 segmentId 分组、
 * 按 shotNo 顺序逐镜判定。构图字段目前只存在于 directing-lock 的段级锁定表
 * （DirectingLockSegment.compositionPrimary/compositionSecondary），schema 里没有镜头级构图字段，
 * 因此构图相关三项按段（segmentId）判定，这与方法论原文"B 表""同构图连续 ≥3 段"的字面表述一致。
 *
 * 短段保护（避免"数据不够却判不达标"的误报）：任何"≥N 种/≥N 档"类判定，若一段内可用于判定的镜头数
 * 本身就小于 N，物理上不可能达标，一律标记 unknown（"物理上无法判定"）而不是 fail——
 * 景别跨度要求可解析镜头数 ≥3（否则物理上凑不出 3 档），运镜/角度多样性要求已知取值的镜头数 ≥2
 * （否则物理上凑不出 2 种）。"连续复用"类判定不受此限——镜头数不足时天然无法形成 ≥3 镜的连续游程，
 * 现有逻辑本就会正确落到 pass，不需要额外判空。
 *
 * 纯函数：不读文件、不调网络、不依赖 React；输入输出均为普通数据结构。
 */
import type { ClosedLibraryCategory } from "./closed-libraries";
import { COMPOSITION_FORMULA_LIBRARY, isInLibrary } from "./closed-libraries";
import type { DirectingLock, DirectingLockSegment, ShotContract, StoryboardRow } from "./schema";
import { groupRowsBySegment } from "./segments";

export type QualityCheckKind =
    | "cameraMovementDiversity"
    | "cameraMovementConsecutiveRepeat"
    | "shotScaleSpan"
    | "shotScaleConsecutiveRepeat"
    | "angleDiversity"
    | "angleLevelConsecutiveRun"
    | "compositionDiversity"
    | "compositionConsecutiveRepeat"
    | "centeredSymmetricRatio"
    | "closedLibraryCompliance"
    | "cellCountMatch";

export type QualityCheckStatus = "pass" | "fail" | "unknown";

export interface QualityCheckItem {
    /** 检查项标识，供 UI 分组与「一键修改方案」按类型定位处理逻辑 */
    kind: QualityCheckKind;
    /** 给用户看的中文检查项名 */
    label: string;
    status: QualityCheckStatus;
    /** 段级判定归属的段（段内判定项：运镜/景别/角度/构图多样性、格子数） */
    segmentId?: string;
    /** 跨段判定涉及的多个段（同构图连续、居中对称占比） */
    segmentIds?: string[];
    /** 涉及的镜头 ID，供「一键修改方案」定点修改到具体镜头 */
    shotIds: string[];
    /** 人类可读的实际值 */
    actualValue: string;
    /** 人类可读的要求值 */
    expectedValue: string;
    /** 中文说明；status 为 unknown 时说明无法判定的原因，不表达"不通过" */
    reason: string;
}

export interface QualityCheckReport {
    items: QualityCheckItem[];
    summary: { total: number; passed: number; failed: number; unknown: number };
}

export interface QualityCheckInput {
    /** 分镜表行，来自 storyboard-table 节点产物；各项检查按 segmentId 分组判定 */
    storyboardRows: StoryboardRow[];
    /** 镜头合同，来自 shot-contract 节点产物；运镜多样性、运镜封闭词库合规依赖此项 */
    shotContracts?: ShotContract[];
    /** 分镜决策锁定表，来自 directing-lock 节点产物；构图相关三项与部分封闭词库合规检查依赖此项 */
    directingLock?: DirectingLock;
    /**
     * 各段故事板格子数，key 为 segmentId，value 为该段故事板页实际画格数量。
     * 本模块不解析图片、不读文件，由调用方从 storyboard-page 节点产物统计后传入。
     */
    storyboardPageCellCounts?: Record<string, number>;
}

const CHECK_LABELS: Record<QualityCheckKind, string> = {
    cameraMovementDiversity: "运镜多样性",
    cameraMovementConsecutiveRepeat: "运镜连续复用",
    shotScaleSpan: "景别跨度",
    shotScaleConsecutiveRepeat: "景别连续复用",
    angleDiversity: "角度多样性",
    angleLevelConsecutiveRun: "平视连续",
    compositionDiversity: "构图多样性",
    compositionConsecutiveRepeat: "同构图连续",
    centeredSymmetricRatio: "居中对称占比",
    closedLibraryCompliance: "封闭词库合规",
    cellCountMatch: "格子数一致",
};

function makeItem(params: Omit<QualityCheckItem, "label">): QualityCheckItem {
    return { ...params, label: CHECK_LABELS[params.kind] };
}

function allShotIds(rowsBySegment: Map<string, StoryboardRow[]>): string[] {
    return [...rowsBySegment.values()].flat().map((row) => row.shotId);
}

/** 从景别字段提取 L0-L5 档位数字；字段不是"L+数字"记号开头时返回 null（无法解析）。 */
function extractShotScaleLevel(scale: string): number | null {
    const match = scale.trim().match(/^L([0-5])\b/);
    return match ? Number(match[1]) : null;
}

/**
 * 在保持原始顺序的取值序列里找出连续重复且长度达到 minLength 的最长游程。
 * `null` 表示该位置数据缺失，会打断游程（不参与也不跨越比较——数据缺失时不假定两侧镜头相同）。
 * 供运镜/景别的"同种连续重复"检查复用。
 */
function findConsecutiveRun<T>(values: Array<T | null>, minLength: number): { value: T; startIndex: number; length: number } | null {
    let bestStart = -1;
    let bestLength = 0;
    let bestValue: T | null = null;
    let runStart = -1;

    for (let index = 0; index <= values.length; index += 1) {
        const value = index < values.length ? values[index] : null;
        const continuesRun = runStart !== -1 && value !== null && values[runStart] === value;

        if (continuesRun) continue;

        if (runStart !== -1) {
            const runLength = index - runStart;
            if (runLength > bestLength) {
                bestLength = runLength;
                bestStart = runStart;
                bestValue = values[runStart];
            }
        }
        runStart = value !== null ? index : -1;
    }

    return bestLength >= minLength && bestValue !== null ? { value: bestValue, startIndex: bestStart, length: bestLength } : null;
}

/** 在取值序列里找出等于 target 的最长连续游程（找不到返回 null）。供"平视连续"这类只关心单一取值的检查复用。 */
function longestRunOfValue(values: Array<string | null>, target: string): { startIndex: number; length: number } | null {
    let bestStart = -1;
    let bestLength = 0;
    let runStart = -1;

    for (let index = 0; index <= values.length; index += 1) {
        const isTarget = index < values.length && values[index] === target;
        if (isTarget) {
            if (runStart === -1) runStart = index;
            continue;
        }
        if (runStart !== -1) {
            const runLength = index - runStart;
            if (runLength > bestLength) {
                bestLength = runLength;
                bestStart = runStart;
            }
            runStart = -1;
        }
    }

    return bestLength > 0 ? { startIndex: bestStart, length: bestLength } : null;
}

/**
 * 运镜（镜级）：①多样性 ≥2 种 ②同种运镜连续重复 <3 镜。
 * 源：04-directing-decisions.md §5「运镜变化 ≥2 种：禁止全程固定位/同种运镜重复 ≥3 镜」。
 * 短段保护（2026-07-21 自查补充，与景别跨度同一类问题）：①要求"≥2 种"，但只有 1 个镜头能读到运镜数据时
 * 物理上不可能凑出 2 种，会被误判 fail——因此镜头数 <2 时①标 unknown，不做"达标/不达标"判断。
 */
function checkCameraMovement(rowsBySegment: Map<string, StoryboardRow[]>, shotContracts?: ShotContract[]): QualityCheckItem[] {
    const diversityKind: QualityCheckKind = "cameraMovementDiversity";
    const repeatKind: QualityCheckKind = "cameraMovementConsecutiveRepeat";

    if (rowsBySegment.size === 0) {
        return [
            makeItem({
                kind: diversityKind,
                status: "unknown",
                shotIds: [],
                actualValue: "无分镜表数据",
                expectedValue: "≥2 种",
                reason: "分镜表为空，无法判定运镜多样性。",
            }),
            makeItem({
                kind: repeatKind,
                status: "unknown",
                shotIds: [],
                actualValue: "无分镜表数据",
                expectedValue: "同种运镜连续 <3 镜",
                reason: "分镜表为空，无法判定运镜连续重复情况。",
            }),
        ];
    }
    if (!shotContracts || shotContracts.length === 0) {
        const shotIds = allShotIds(rowsBySegment);
        return [
            makeItem({
                kind: diversityKind,
                status: "unknown",
                shotIds,
                actualValue: "无镜头合同数据",
                expectedValue: "≥2 种",
                reason: "未提供镜头合同（shot-contract），运镜字段只存在于镜头合同中，无法判定运镜多样性。",
            }),
            makeItem({
                kind: repeatKind,
                status: "unknown",
                shotIds,
                actualValue: "无镜头合同数据",
                expectedValue: "同种运镜连续 <3 镜",
                reason: "未提供镜头合同（shot-contract），无法判定运镜连续重复情况。",
            }),
        ];
    }

    const movementByShotId = new Map(shotContracts.map((contract) => [contract.shotId, contract.movement]));
    const items: QualityCheckItem[] = [];

    for (const [segmentId, rows] of rowsBySegment) {
        const shotIds = rows.map((row) => row.shotId);
        const orderedMovements = shotIds.map((shotId) => {
            const value = movementByShotId.get(shotId)?.trim();
            return value ? value : null;
        });
        const knownMovements = orderedMovements.filter((value): value is string => value !== null);

        if (knownMovements.length === 0) {
            const reason = `段 ${segmentId} 内的镜头都没有在镜头合同里找到运镜字段，无法判定。`;
            items.push(
                makeItem({ kind: diversityKind, status: "unknown", segmentId, shotIds, actualValue: "本段镜头均无匹配的镜头合同", expectedValue: "≥2 种", reason }),
            );
            items.push(
                makeItem({
                    kind: repeatKind,
                    status: "unknown",
                    segmentId,
                    shotIds,
                    actualValue: "本段镜头均无匹配的镜头合同",
                    expectedValue: "同种运镜连续 <3 镜",
                    reason,
                }),
            );
            continue;
        }

        // 短段保护：只有 1 个镜头有运镜数据时，物理上不可能凑出 2 种，标 unknown 而不是 fail。
        if (knownMovements.length < 2) {
            items.push(
                makeItem({
                    kind: diversityKind,
                    status: "unknown",
                    segmentId,
                    shotIds,
                    actualValue: `本段仅 ${knownMovements.length} 个镜头有运镜数据`,
                    expectedValue: "≥2 种",
                    reason: `段 ${segmentId} 仅有 ${knownMovements.length} 个镜头能读到运镜数据，物理上无法达到 2 种运镜，不做判定。`,
                }),
            );
        } else {
            const distinct = [...new Set(knownMovements)];
            const diversityPass = distinct.length >= 2;
            items.push(
                makeItem({
                    kind: diversityKind,
                    status: diversityPass ? "pass" : "fail",
                    segmentId,
                    shotIds,
                    actualValue: `${distinct.length} 种（${distinct.join("、")}）`,
                    expectedValue: "≥2 种",
                    reason: diversityPass
                        ? `段 ${segmentId} 使用了 ${distinct.length} 种运镜，满足多样性要求。`
                        : `段 ${segmentId} 全部镜头只使用了「${distinct.join("、")}」这 1 种运镜，不满足运镜多样性 ≥2 种的要求。`,
                }),
            );
        }

        const run = findConsecutiveRun(orderedMovements, 3);
        if (run) {
            const runShotIds = shotIds.slice(run.startIndex, run.startIndex + run.length);
            items.push(
                makeItem({
                    kind: repeatKind,
                    status: "fail",
                    segmentId,
                    shotIds: runShotIds,
                    actualValue: `连续 ${run.length} 镜同为「${run.value}」`,
                    expectedValue: "同种运镜连续 <3 镜",
                    reason: `段 ${segmentId} 内镜头 ${runShotIds.join("、")} 连续 ${run.length} 镜都用了「${run.value}」这一种运镜，超过连续重复上限（同种运镜连续 ≥3 镜 → 阻断）。`,
                }),
            );
        } else {
            items.push(
                makeItem({
                    kind: repeatKind,
                    status: "pass",
                    segmentId,
                    shotIds,
                    actualValue: "未发现连续 3 镜及以上使用同一运镜",
                    expectedValue: "同种运镜连续 <3 镜",
                    reason: `段 ${segmentId} 未出现连续 3 镜及以上使用同一种运镜。`,
                }),
            );
        }
    }
    return items;
}

/**
 * 景别（镜级）：①跨度 ≥3 档且含极值 L0/L5 ②连续同景别 <3 镜。
 * 源：04-directing-decisions.md §5「景别跨度 ≥3 档：须含至少 1 个极值景别(L5/L0)」+ D5.1「镜数≥5→≥3种景别，
 * 禁止连续3镜同景别」。
 * 短段保护（2026-07-21 修复）：①要求"≥3 档"，但一个段可解析景别的镜头数 <3 时物理上不可能凑出 3 档——
 * 例如 2 镜的段（在 plus 分段规则"贴满 15s 打包"下完全合法，不是异常数据）必然只能有 ≤2 档，若不做保护
 * 会被误判 fail，冤枉合法的短段。因此镜头数 <3 时①标 unknown（"物理上无法判定"），≥3 时维持"≥3 档 + 含极值"
 * 的无条件要求（这比 D5.1"镜数≥5才要求≥3种"更严格，是有意为之，不需要再额外做"镜数≥5"这个触发条件）。
 * "连续3镜同景别"是①之外的独立事实（顺序相关），不受镜头数门槛影响，单独实现为②——镜头数不足 3 时，
 * findConsecutiveRun 天然找不到长度 ≥3 的游程，会正确落到 pass，不需要额外判空。
 */
function checkShotScale(rowsBySegment: Map<string, StoryboardRow[]>): QualityCheckItem[] {
    const spanKind: QualityCheckKind = "shotScaleSpan";
    const repeatKind: QualityCheckKind = "shotScaleConsecutiveRepeat";

    if (rowsBySegment.size === 0) {
        return [
            makeItem({
                kind: spanKind,
                status: "unknown",
                shotIds: [],
                actualValue: "无分镜表数据",
                expectedValue: "≥3 档且含 L0 或 L5 极值",
                reason: "分镜表为空，无法判定景别跨度。",
            }),
            makeItem({
                kind: repeatKind,
                status: "unknown",
                shotIds: [],
                actualValue: "无分镜表数据",
                expectedValue: "连续同景别 <3 镜",
                reason: "分镜表为空，无法判定景别连续重复情况。",
            }),
        ];
    }

    const items: QualityCheckItem[] = [];
    for (const [segmentId, rows] of rowsBySegment) {
        const shotIds = rows.map((row) => row.shotId);
        const orderedLevels = rows.map((row) => extractShotScaleLevel(row.scale));
        const knownLevels = orderedLevels.filter((level): level is number => level !== null);

        if (knownLevels.length === 0) {
            const reason = `段 ${segmentId} 的景别字段都不是「L0」~「L5」开头的记号，无法判定。`;
            items.push(
                makeItem({ kind: spanKind, status: "unknown", segmentId, shotIds, actualValue: "景别字段无法解析为 L0-L5 记号", expectedValue: "≥3 档且含 L0 或 L5 极值", reason }),
            );
            items.push(
                makeItem({ kind: repeatKind, status: "unknown", segmentId, shotIds, actualValue: "景别字段无法解析为 L0-L5 记号", expectedValue: "连续同景别 <3 镜", reason }),
            );
            continue;
        }

        // 短段保护：可解析景别的镜头数 <3 时，物理上不可能凑出 3 档，标 unknown 而不是 fail
        // （源文件 D5.1「镜数≥5→≥3种景别」的条件触发思路在这里体现为：数据不够就不判定，而不是照单全严格判 fail）。
        if (knownLevels.length < 3) {
            items.push(
                makeItem({
                    kind: spanKind,
                    status: "unknown",
                    segmentId,
                    shotIds,
                    actualValue: `本段仅 ${knownLevels.length} 个可解析景别的镜头`,
                    expectedValue: "≥3 档且含 L0 或 L5 极值",
                    reason: `段 ${segmentId} 仅有 ${knownLevels.length} 个可解析景别的镜头，物理上无法达到 3 档景别，不做判定。`,
                }),
            );
        } else {
            const distinctLevels = [...new Set(knownLevels)].sort((left, right) => left - right);
            const hasExtreme = distinctLevels.includes(0) || distinctLevels.includes(5);
            const spanPass = distinctLevels.length >= 3 && hasExtreme;
            const spanActualValue = `${distinctLevels.length} 档（${distinctLevels.map((level) => `L${level}`).join("、")}）`;

            let spanReason: string;
            if (spanPass) {
                spanReason = `段 ${segmentId} 使用了 ${distinctLevels.length} 档景别且含极值景别，满足景别跨度要求。`;
            } else if (distinctLevels.length < 3 && !hasExtreme) {
                spanReason = `段 ${segmentId} 只用了 ${distinctLevels.length} 档景别且不含 L0/L5 极值，两个条件都不满足。`;
            } else if (distinctLevels.length < 3) {
                spanReason = `段 ${segmentId} 只用了 ${distinctLevels.length} 档景别，不满足 ≥3 档的要求。`;
            } else {
                spanReason = `段 ${segmentId} 用了 ${distinctLevels.length} 档景别，但不含 L0/L5 极值景别。`;
            }

            items.push(
                makeItem({
                    kind: spanKind,
                    status: spanPass ? "pass" : "fail",
                    segmentId,
                    shotIds,
                    actualValue: spanActualValue,
                    expectedValue: "≥3 档且含 L0 或 L5 极值",
                    reason: spanReason,
                }),
            );
        }

        const run = findConsecutiveRun(orderedLevels, 3);
        if (run) {
            const runShotIds = shotIds.slice(run.startIndex, run.startIndex + run.length);
            items.push(
                makeItem({
                    kind: repeatKind,
                    status: "fail",
                    segmentId,
                    shotIds: runShotIds,
                    actualValue: `连续 ${run.length} 镜同为 L${run.value}`,
                    expectedValue: "连续同景别 <3 镜",
                    reason: `段 ${segmentId} 内镜头 ${runShotIds.join("、")} 连续 ${run.length} 镜都是 L${run.value} 景别，超过连续同景别上限（禁止连续 3 镜同景别）。`,
                }),
            );
        } else {
            items.push(
                makeItem({
                    kind: repeatKind,
                    status: "pass",
                    segmentId,
                    shotIds,
                    actualValue: "未发现连续 3 镜及以上同一景别",
                    expectedValue: "连续同景别 <3 镜",
                    reason: `段 ${segmentId} 未出现连续 3 镜及以上使用同一景别。`,
                }),
            );
        }
    }
    return items;
}

/**
 * 角度（镜级）：①多样性 ≥2 种 ②平视连续 ≤2 镜（连续 ≥3 镜平视即不满足）。
 * 源：04-directing-decisions.md §5「角度变化 ≥2 种：平视连续 ≤2 镜，禁止全程平视」。
 * "禁止全程平视"是"平视连续 ≤2 镜"在镜头数更多时的特例（全程平视意味着从第 1 镜到最后一镜都是一段
 * 平视连续游程），不需要单独实现。
 * 短段保护（2026-07-21 自查补充，与景别跨度同一类问题）：①要求"≥2 种"，但只有 1 个镜头填写了角度时
 * 物理上不可能凑出 2 种，会被误判 fail——因此镜头数 <2 时①标 unknown，不做"达标/不达标"判断。
 * 注：D1.6 角度策略（平视/俯视/仰视/倾斜）不在 closed-libraries.ts 建模的九大封闭词库之列
 * （ClosedLibraryCategory 没有 angle 分类），因此本检查只统计原始字符串，不做封闭词库合规校验。
 */
function checkAngle(rowsBySegment: Map<string, StoryboardRow[]>): QualityCheckItem[] {
    const diversityKind: QualityCheckKind = "angleDiversity";
    const levelRunKind: QualityCheckKind = "angleLevelConsecutiveRun";
    const LEVEL_ANGLE = "平视";

    if (rowsBySegment.size === 0) {
        return [
            makeItem({ kind: diversityKind, status: "unknown", shotIds: [], actualValue: "无分镜表数据", expectedValue: "≥2 种", reason: "分镜表为空，无法判定角度多样性。" }),
            makeItem({
                kind: levelRunKind,
                status: "unknown",
                shotIds: [],
                actualValue: "无分镜表数据",
                expectedValue: "平视连续 ≤2 镜",
                reason: "分镜表为空，无法判定平视连续情况。",
            }),
        ];
    }

    const items: QualityCheckItem[] = [];
    for (const [segmentId, rows] of rowsBySegment) {
        const shotIds = rows.map((row) => row.shotId);
        const orderedAngles = rows.map((row) => (row.angle?.trim() ? row.angle.trim() : null));
        const knownAngles = orderedAngles.filter((angle): angle is string => angle !== null);

        if (knownAngles.length === 0) {
            const reason = `段 ${segmentId} 的角度字段全部为空，无法判定。`;
            items.push(makeItem({ kind: diversityKind, status: "unknown", segmentId, shotIds, actualValue: "本段镜头均未填写角度字段", expectedValue: "≥2 种", reason }));
            items.push(
                makeItem({ kind: levelRunKind, status: "unknown", segmentId, shotIds, actualValue: "本段镜头均未填写角度字段", expectedValue: "平视连续 ≤2 镜", reason }),
            );
            continue;
        }

        // 短段保护：只有 1 个镜头填了角度时，物理上不可能凑出 2 种，标 unknown 而不是 fail。
        if (knownAngles.length < 2) {
            items.push(
                makeItem({
                    kind: diversityKind,
                    status: "unknown",
                    segmentId,
                    shotIds,
                    actualValue: `本段仅 ${knownAngles.length} 个镜头填写了角度`,
                    expectedValue: "≥2 种",
                    reason: `段 ${segmentId} 仅有 ${knownAngles.length} 个镜头填写了角度，物理上无法达到 2 种角度，不做判定。`,
                }),
            );
        } else {
            const distinct = [...new Set(knownAngles)];
            const diversityPass = distinct.length >= 2;
            items.push(
                makeItem({
                    kind: diversityKind,
                    status: diversityPass ? "pass" : "fail",
                    segmentId,
                    shotIds,
                    actualValue: `${distinct.length} 种（${distinct.join("、")}）`,
                    expectedValue: "≥2 种",
                    reason: diversityPass
                        ? `段 ${segmentId} 使用了 ${distinct.length} 种角度，满足多样性要求。`
                        : `段 ${segmentId} 全部镜头只使用了「${distinct.join("、")}」这 1 种角度，不满足角度多样性 ≥2 种的要求。`,
                }),
            );
        }

        const run = longestRunOfValue(orderedAngles, LEVEL_ANGLE);
        if (run && run.length >= 3) {
            const runShotIds = shotIds.slice(run.startIndex, run.startIndex + run.length);
            items.push(
                makeItem({
                    kind: levelRunKind,
                    status: "fail",
                    segmentId,
                    shotIds: runShotIds,
                    actualValue: `连续 ${run.length} 镜均为平视`,
                    expectedValue: "平视连续 ≤2 镜",
                    reason: `段 ${segmentId} 内镜头 ${runShotIds.join("、")} 连续 ${run.length} 镜均为平视角度，超过连续上限（平视连续 ≤2 镜）。`,
                }),
            );
        } else {
            items.push(
                makeItem({
                    kind: levelRunKind,
                    status: "pass",
                    segmentId,
                    shotIds,
                    actualValue: run ? `连续 ${run.length} 镜平视` : "本段未出现平视角度",
                    expectedValue: "平视连续 ≤2 镜",
                    reason: `段 ${segmentId} 的平视角度连续镜数未超过上限（≤2 镜）。`,
                }),
            );
        }
    }
    return items;
}

/**
 * 构图多样性（段内，主/次构图策略须为 2 个不同策略）。
 * 源：04-directing-decisions.md §2 B 表自检「B 表每段构图主策略 ≠ 构图次策略」。
 * 数据依据：构图字段目前只存在于 directing-lock 的段级锁定表（DirectingLockSegment.compositionPrimary/
 * compositionSecondary），schema 里没有镜头级别的构图字段，因此本检查按段判定，不按镜头判定。
 */
function checkCompositionDiversity(rowsBySegment: Map<string, StoryboardRow[]>, directingLock?: DirectingLock): QualityCheckItem[] {
    const kind: QualityCheckKind = "compositionDiversity";
    if (rowsBySegment.size === 0) {
        return [
            makeItem({
                kind,
                status: "unknown",
                shotIds: [],
                actualValue: "无分镜表数据",
                expectedValue: "主/次构图策略须为 2 个不同策略",
                reason: "分镜表为空，无法判定构图多样性。",
            }),
        ];
    }
    if (!directingLock?.segments || directingLock.segments.length === 0) {
        return [
            makeItem({
                kind,
                status: "unknown",
                shotIds: allShotIds(rowsBySegment),
                actualValue: "无导演决策锁定表数据",
                expectedValue: "主/次构图策略须为 2 个不同策略",
                reason: "未提供 directing-lock 的分段锁定数据（B 表），无法判定构图多样性。",
            }),
        ];
    }

    const lockBySegment = new Map(directingLock.segments.map((segment) => [segment.segmentId, segment]));
    const items: QualityCheckItem[] = [];
    for (const [segmentId, rows] of rowsBySegment) {
        const shotIds = rows.map((row) => row.shotId);
        const lock = lockBySegment.get(segmentId);
        const primary = lock?.compositionPrimary?.trim();

        if (!lock || !primary) {
            items.push(
                makeItem({
                    kind,
                    status: "unknown",
                    segmentId,
                    shotIds,
                    actualValue: "无锁定表构图主策略数据",
                    expectedValue: "主/次构图策略须为 2 个不同策略",
                    reason: `段 ${segmentId} 在锁定表中缺少构图主策略数据，无法判定构图多样性。`,
                }),
            );
            continue;
        }

        const secondary = lock.compositionSecondary?.trim() ?? "";
        const pass = secondary.length > 0 && secondary !== primary;
        items.push(
            makeItem({
                kind,
                status: pass ? "pass" : "fail",
                segmentId,
                shotIds,
                actualValue: `主=${primary}，次=${secondary || "(空)"}`,
                expectedValue: "主/次构图策略须为 2 个不同策略",
                reason: pass
                    ? `段 ${segmentId} 主/次构图策略不同，满足段内构图多样性要求。`
                    : `段 ${segmentId} 的构图次策略为空或与主策略相同（主=${primary}，次=${secondary || "(空)"}），不满足构图多样性要求。`,
            }),
        );
    }
    return items;
}

/**
 * 同构图连续（跨段，相同构图主策略连续出现的段数须 <3）。
 * 源：05-closed-libraries.md §1.1「多样性阻断规则：同构图连续≥3段→阻断」。
 * 段的顺序取 directingLock.segments 数组的顺序（该数组即 B 表的段序）。
 */
function checkCompositionConsecutiveRepeat(rowsBySegment: Map<string, StoryboardRow[]>, directingLock?: DirectingLock): QualityCheckItem[] {
    const kind: QualityCheckKind = "compositionConsecutiveRepeat";
    const expectedValue = "相同构图主策略连续出现的段数 <3";
    const segments = directingLock?.segments;

    if (!segments || segments.length === 0) {
        return [
            makeItem({
                kind,
                status: "unknown",
                shotIds: [],
                actualValue: "无导演决策锁定表分段数据",
                expectedValue,
                reason: "未提供 directing-lock 的分段数据，无法判定跨段同构图连续情况。",
            }),
        ];
    }

    const shotIdsOfSegments = (segmentList: DirectingLockSegment[]) =>
        segmentList.flatMap((segment) => (rowsBySegment.get(segment.segmentId) ?? []).map((row) => row.shotId));

    let longestRun: DirectingLockSegment[] = [];
    let currentRun: DirectingLockSegment[] = [];
    for (const segment of segments) {
        const primary = segment.compositionPrimary?.trim();
        if (!primary) {
            longestRun = currentRun.length > longestRun.length ? currentRun : longestRun;
            currentRun = [];
            continue;
        }
        const previous = currentRun[currentRun.length - 1];
        if (previous && previous.compositionPrimary.trim() === primary) {
            currentRun.push(segment);
        } else {
            longestRun = currentRun.length > longestRun.length ? currentRun : longestRun;
            currentRun = [segment];
        }
    }
    longestRun = currentRun.length > longestRun.length ? currentRun : longestRun;

    if (longestRun.length >= 3) {
        const segmentIds = longestRun.map((segment) => segment.segmentId);
        return [
            makeItem({
                kind,
                status: "fail",
                segmentIds,
                shotIds: shotIdsOfSegments(longestRun),
                actualValue: `连续 ${longestRun.length} 段均为「${longestRun[0].compositionPrimary}」`,
                expectedValue,
                reason: `段 ${segmentIds.join("、")} 连续 ${longestRun.length} 段主构图策略均为「${longestRun[0].compositionPrimary}」，超过封闭词库多样性阻断规则的连续上限（同构图连续 ≥3 段）。`,
            }),
        ];
    }

    return [
        makeItem({
            kind,
            status: "pass",
            segmentIds: segments.map((segment) => segment.segmentId),
            shotIds: shotIdsOfSegments(segments),
            actualValue: `最长连续同构图段数 = ${longestRun.length}`,
            expectedValue,
            reason: "未发现连续 3 段及以上使用相同构图主策略。",
        }),
    ];
}

/**
 * 居中对称占比（跨段，须 <50%）。
 * 源：05-closed-libraries.md §1.1「多样性阻断规则：居中对称≥50%→阻断」+ 04-directing-decisions.md:250
 * 「构图变化 ≥2 种：禁止全程主体居中对称」。
 *
 * 判定依据（经与设计需求方复核确认）：分镜决策锁定表 B 表的构图字段选自「构图 8 策略」封闭集
 * （权力压迫/负空间吞噬/对角线驱动/前景切割/边缘出画/倾斜失衡/尺度反差/纵深分层）。这 8 个策略逐条看
 * 定义关键词，全部是"主体偏移/遮挡/倾斜/压缩"之类的偏心构图手法——换句话说，这 8 策略本身就是一套
 * "反居中"策略集，没有一个字面意为"居中"或"对称"。因此源文件"禁止全程主体居中对称"的真实含义不是
 * "选中了某个叫居中/对称的策略"（8 策略里根本没有这个选项），而是"没有从这 8 策略里选，退化成了生成模型
 * 不加干预时的默认居中/对称构图"。据此，一段被判定为"居中对称"的条件取以下两者的或：
 * 1. compositionPrimary 不在构图 8 策略封闭集内（`isInLibrary("composition", ...)` 为 false）——
 *    推定为未执行选取协议、退化为默认居中对称构图；
 * 2. compositionPrimary 或 compositionSecondary 字面包含"对称"/"中心"——
 *    这两个词字面对应的是另一个不同封闭集「构图 8 公式」（COMPOSITION_FORMULA_LIBRARY）里的
 *    "对称构图 Symmetrical"/"中心构图 Center"，选中它们同样不在构图 8 策略集内，会被条件 1 覆盖，
 *    此处保留主要是为了让 reason 里能明确指出"字面选用了对称/中心构图"这种更具体的信息。
 */
const CENTERED_SYMMETRIC_LITERAL_NAMES = new Set(
    COMPOSITION_FORMULA_LIBRARY.filter((entry) => entry.name.includes("对称") || entry.name.includes("中心")).map((entry) => entry.name),
);

function isLiteralCenteredSymmetricTerm(term?: string): boolean {
    return Boolean(term && CENTERED_SYMMETRIC_LITERAL_NAMES.has(term.trim()));
}

function isCenteredSymmetricSegment(segment: DirectingLockSegment): boolean {
    const primary = segment.compositionPrimary?.trim();
    if (!primary) return false; // 主策略缺失，不计入（避免把"数据缺失"误判成"退化居中对称"）
    const degradedFromLibrary = !isInLibrary("composition", primary);
    const literalMatch = isLiteralCenteredSymmetricTerm(primary) || isLiteralCenteredSymmetricTerm(segment.compositionSecondary);
    return degradedFromLibrary || literalMatch;
}

function checkCenteredSymmetricRatio(rowsBySegment: Map<string, StoryboardRow[]>, directingLock?: DirectingLock): QualityCheckItem[] {
    const kind: QualityCheckKind = "centeredSymmetricRatio";
    const expectedValue = "<50%";
    const segments = directingLock?.segments;

    if (!segments || segments.length === 0) {
        return [
            makeItem({
                kind,
                status: "unknown",
                shotIds: [],
                actualValue: "无导演决策锁定表分段数据",
                expectedValue,
                reason: "未提供 directing-lock 的分段数据，无法判定居中对称占比。",
            }),
        ];
    }

    const matched = segments.filter((segment) => isCenteredSymmetricSegment(segment));
    const ratio = matched.length / segments.length;
    const pass = ratio < 0.5;
    const percentText = `${Math.round(ratio * 100)}%`;
    const matchedSegmentIds = matched.map((segment) => segment.segmentId);
    const matchedShotIds = matched.flatMap((segment) => (rowsBySegment.get(segment.segmentId) ?? []).map((row) => row.shotId));

    return [
        makeItem({
            kind,
            status: pass ? "pass" : "fail",
            segmentIds: matchedSegmentIds,
            shotIds: matchedShotIds,
            actualValue: `${matched.length}/${segments.length} 段 = ${percentText}`,
            expectedValue,
            reason: pass
                ? `居中/对称构图占比 ${percentText}，未超过 50% 阈值。`
                : `段 ${matchedSegmentIds.join("、")} 未从构图 8 策略中选取或字面选用了对称/中心构图，占比 ${percentText} 已达到或超过阈值（居中对称 ≥50% → 阻断）。`,
        }),
    ];
}

/**
 * 封闭词库合规（跨段/全片，选词须在对应封闭词库内）。
 * 覆盖字段：构图主/次策略（composition）、运镜（cameraMovement，来自镜头合同 movement 与固化卡 cameraTone）、
 * 布光（lighting）、调色（colorGrade）、视觉风格（directorStyle）、表演档位（performanceIntensity）。
 * 不覆盖：景别（shotScale，已由 checkShotScale 用 L0-L5 记号单独判定，不做逐字封闭词库比对，
 * 因为实际数据里景别字段常态是"L2"这类短记号而非"L2 中景/中全景"全名，逐字比对容易产生假阳性）、
 * 角度（无对应封闭词库，见 checkAngle 注释）、空镜 emptyShot 与开场钩子 hook（schema 里没有
 * 对应字段可核对，属于覆盖缺口，需要时再补数据源）。
 */
function checkClosedLibraryCompliance(shotContracts?: ShotContract[], directingLock?: DirectingLock): QualityCheckItem[] {
    const kind: QualityCheckKind = "closedLibraryCompliance";
    const expectedValue = "全部选词命中对应封闭词库";

    if ((!shotContracts || shotContracts.length === 0) && !directingLock) {
        return [
            makeItem({
                kind,
                status: "unknown",
                shotIds: [],
                actualValue: "无镜头合同与导演决策锁定表数据",
                expectedValue,
                reason: "未提供镜头合同与导演决策锁定表数据，无法核对封闭词库合规性。",
            }),
        ];
    }

    const violations: Array<{ term: string; label: string; shotId?: string; segmentId?: string }> = [];

    const checkTerm = (
        term: string | undefined,
        category: ClosedLibraryCategory,
        label: string,
        location: { shotId?: string; segmentId?: string },
    ) => {
        const value = term?.trim();
        if (value && !isInLibrary(category, value)) {
            violations.push({ term: value, label, ...location });
        }
    };

    for (const segment of directingLock?.segments ?? []) {
        checkTerm(segment.compositionPrimary, "composition", "构图主策略", { segmentId: segment.segmentId });
        checkTerm(segment.compositionSecondary, "composition", "构图次策略", { segmentId: segment.segmentId });
    }

    if (directingLock?.global) {
        const global = directingLock.global;
        checkTerm(global.lighting, "lighting", "布光主策略", {});
        checkTerm(global.colorGrading, "colorGrade", "调色主策略", {});
        checkTerm(global.visualStyle, "directorStyle", "视觉风格", {});
        checkTerm(global.performanceLevel, "performanceIntensity", "表演档位", {});
        checkTerm(global.cameraTone, "cameraMovement", "运镜基调", {});
    }

    for (const contract of shotContracts ?? []) {
        checkTerm(contract.movement, "cameraMovement", "运镜", { shotId: contract.shotId });
    }

    const shotIds = [...new Set(violations.map((violation) => violation.shotId).filter((value): value is string => Boolean(value)))];
    const segmentIds = [...new Set(violations.map((violation) => violation.segmentId).filter((value): value is string => Boolean(value)))];

    if (violations.length === 0) {
        return [
            makeItem({
                kind,
                status: "pass",
                shotIds: [],
                actualValue: "0 处越界用词",
                expectedValue,
                reason: "抽查的构图/布光/调色/视觉风格/表演档位/运镜字段均命中对应封闭词库。",
            }),
        ];
    }

    return [
        makeItem({
            kind,
            status: "fail",
            segmentIds: segmentIds.length > 0 ? segmentIds : undefined,
            shotIds,
            actualValue: `${violations.length} 处越界用词`,
            expectedValue,
            reason: violations.map((violation) => `${violation.label}「${violation.term}」不在封闭词库内`).join("；"),
        }),
    ];
}

/**
 * 格子数一致（段内，分镜表行数 = 故事板格子数）。设计文档 §4.5，解 TODOS 遗留的格子数校验需求。
 */
function checkCellCountMatch(rowsBySegment: Map<string, StoryboardRow[]>, storyboardPageCellCounts?: Record<string, number>): QualityCheckItem[] {
    const kind: QualityCheckKind = "cellCountMatch";
    const expectedValue = "分镜表行数 = 故事板格子数";

    if (rowsBySegment.size === 0) {
        return [
            makeItem({ kind, status: "unknown", shotIds: [], actualValue: "无分镜表数据", expectedValue, reason: "分镜表为空，无法核对格子数。" }),
        ];
    }
    if (!storyboardPageCellCounts) {
        return [
            makeItem({
                kind,
                status: "unknown",
                shotIds: allShotIds(rowsBySegment),
                actualValue: "未提供故事板格子数",
                expectedValue,
                reason: "未提供 storyboardPageCellCounts，无法核对格子数是否一致。",
            }),
        ];
    }

    const items: QualityCheckItem[] = [];
    for (const [segmentId, rows] of rowsBySegment) {
        const shotIds = rows.map((row) => row.shotId);
        const cellCount = storyboardPageCellCounts[segmentId];

        if (cellCount === undefined) {
            items.push(
                makeItem({
                    kind,
                    status: "unknown",
                    segmentId,
                    shotIds,
                    actualValue: "未提供该段故事板格子数",
                    expectedValue,
                    reason: `未提供段 ${segmentId} 的故事板格子数，无法核对。`,
                }),
            );
            continue;
        }

        const pass = rows.length === cellCount;
        items.push(
            makeItem({
                kind,
                status: pass ? "pass" : "fail",
                segmentId,
                shotIds,
                actualValue: `分镜表 ${rows.length} 行 / 故事板 ${cellCount} 格`,
                expectedValue,
                reason: pass
                    ? `段 ${segmentId} 分镜表行数与故事板格子数一致。`
                    : `段 ${segmentId} 分镜表有 ${rows.length} 行，但故事板只有 ${cellCount} 格，两者不一致。`,
            }),
        );
    }
    return items;
}

/** 对分镜表运行全部质量检查项，结果只描述事实，不阻断、不表达"必须修改"。 */
export function runQualityCheck(input: QualityCheckInput): QualityCheckReport {
    const rowsBySegment = groupRowsBySegment(input.storyboardRows);

    const items: QualityCheckItem[] = [
        ...checkCameraMovement(rowsBySegment, input.shotContracts),
        ...checkShotScale(rowsBySegment),
        ...checkAngle(rowsBySegment),
        ...checkCompositionDiversity(rowsBySegment, input.directingLock),
        ...checkCompositionConsecutiveRepeat(rowsBySegment, input.directingLock),
        ...checkCenteredSymmetricRatio(rowsBySegment, input.directingLock),
        ...checkClosedLibraryCompliance(input.shotContracts, input.directingLock),
        ...checkCellCountMatch(rowsBySegment, input.storyboardPageCellCounts),
    ];

    const summary = items.reduce(
        (accumulator, item) => {
            accumulator.total += 1;
            if (item.status === "pass") accumulator.passed += 1;
            else if (item.status === "fail") accumulator.failed += 1;
            else accumulator.unknown += 1;
            return accumulator;
        },
        { total: 0, passed: 0, failed: 0, unknown: 0 },
    );

    return { items, summary };
}
