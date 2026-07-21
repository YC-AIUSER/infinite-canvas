/**
 * Toonflow plus 新节点的产物展示：分镜决策锁定表（A 表/B 表/缝合同）、跨段状态继承表、分镜表质量检查结果。
 *
 * 三个视图都是纯展示组件：数据全部由调用方传入，自身不读 store、不发请求、不持久化任何东西。
 * 质量检查结果按决策 D4「提示不拦」呈现——只显示事实，不禁用任何按钮、不拦截验收操作。
 */
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";

import type { QualityCheckItem, QualityCheckReport, QualityCheckStatus } from "@/lib/toonflow/quality-check";
import type { ContinuityEntry, ContinuityTable, DirectingLock } from "@/lib/toonflow/schema";

/** 检查项状态配色：沿用节点状态条同一套色值（通过=绿、不达标=红、待定=灰），不另造配色。 */
const checkStatusTone: Record<QualityCheckStatus, string> = {
    pass: "#16a34a",
    fail: "#dc2626",
    unknown: "#78716c",
};

const checkStatusLabel: Record<QualityCheckStatus, string> = {
    pass: "通过",
    fail: "不达标",
    unknown: "待定",
};

/** 涉及镜头过多时只列前几个，其余折成计数，避免撑爆节点卡片。 */
const SHOT_ID_PREVIEW_LIMIT = 6;

function formatShotIds(shotIds: string[]): string {
    if (shotIds.length <= SHOT_ID_PREVIEW_LIMIT) return shotIds.join("、");
    return `${shotIds.slice(0, SHOT_ID_PREVIEW_LIMIT).join("、")} 等 ${shotIds.length} 个`;
}

function ViewSection({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="mt-2 first:mt-0">
            <div className="truncate text-[11px] font-medium opacity-45">{title}</div>
            <div className="mt-1">{children}</div>
        </div>
    );
}

function FieldRow({ label, value }: { label: string; value?: string }) {
    if (!value?.trim()) return null;
    return (
        <div className="flex min-w-0 gap-2 text-[11px] leading-4">
            <span className="w-16 shrink-0 opacity-45">{label}</span>
            <span className="min-w-0 flex-1 break-words opacity-75">{value}</span>
        </div>
    );
}

function DetailScroll({ background, children }: { background: string; children: ReactNode }) {
    return (
        <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-md px-2 py-1.5" style={{ background }}>
            {children}
        </div>
    );
}

/** 分镜决策锁定表：A 表全局锁定 + B 表逐段锁定 + 缝合同，三块分区展示。 */
export function ToonflowDirectingLockView({ lock, background }: { lock: DirectingLock; background: string }) {
    const segments = lock.segments ?? [];
    const seams = lock.seams ?? [];
    const globalFields = [
        { label: "视觉风格", value: lock.global.visualStyle },
        { label: "调色主策略", value: lock.global.colorGrading },
        { label: "布光主策略", value: lock.global.lighting },
        { label: "运镜基调", value: lock.global.cameraTone },
        { label: "表演档位", value: lock.global.performanceLevel },
        { label: "统一风格串", value: lock.global.unifiedStyleString },
        { label: "母题必落项", value: lock.global.motifs.join("、") },
    ];
    const lockedCount = globalFields.filter((field) => field.value.trim()).length;

    return (
        <>
            <p className="mt-1 truncate text-xs font-medium opacity-60">
                A 表已锁 {lockedCount} 项 · B 表 {segments.length} 段 · 缝合同 {seams.length} 处
            </p>
            <DetailScroll background={background}>
                <ViewSection title="A 表 · 全局锁定">
                    {globalFields.map((field) => (
                        <FieldRow key={field.label} label={field.label} value={field.value} />
                    ))}
                </ViewSection>
                {segments.length ? (
                    <ViewSection title={`B 表 · 逐段锁定（${segments.length} 段）`}>
                        {segments.map((segment) => (
                            <div key={segment.segmentId} className="mt-1.5 first:mt-0">
                                <div className="truncate text-[11px] font-medium opacity-70">段 {segment.segmentId}</div>
                                <FieldRow label="构图主策略" value={segment.compositionPrimary} />
                                <FieldRow label="构图次策略" value={segment.compositionSecondary} />
                                <FieldRow label="构图多样性" value={segment.compositionDiversity} />
                                <FieldRow label="运镜类型" value={segment.cameraType} />
                                <FieldRow label="景别跨度" value={segment.scaleRange} />
                                <FieldRow label="角度类型" value={segment.angleType} />
                                <FieldRow label="开场类型" value={segment.openingType} />
                            </div>
                        ))}
                    </ViewSection>
                ) : null}
                {seams.length ? (
                    <ViewSection title={`缝合同（${seams.length} 处）`}>
                        {seams.map((seam) => (
                            <div key={`${seam.fromSegmentId}-${seam.toSegmentId}`} className="mt-1.5 first:mt-0">
                                <div className="truncate text-[11px] font-medium opacity-70">
                                    {seam.fromSegmentId} → {seam.toSegmentId}
                                </div>
                                <FieldRow label="上段末拍" value={seam.prevEndBeat} />
                                <FieldRow label="本段首格" value={seam.nextFirstPanel} />
                                <FieldRow label="景别/动机" value={seam.scaleOrMotivation} />
                                <FieldRow label="声音桥" value={seam.soundBridge} />
                            </div>
                        ))}
                    </ViewSection>
                ) : null}
            </DetailScroll>
        </>
    );
}

const CONTINUITY_GROUPS: Array<{ key: keyof ContinuityTable; label: string }> = [
    { key: "propWhitelist", label: "道具白名单" },
    { key: "blocking", label: "站位姿态" },
    { key: "lightingWeather", label: "光向天气" },
    { key: "characterGear", label: "角色装备" },
    { key: "leftovers", label: "遗留物" },
];

/** 跨段状态继承表：五类锁定项，逐类列出「名称 → 锁定值」。 */
export function ToonflowContinuityTableView({ table, background }: { table: ContinuityTable; background: string }) {
    const groups = CONTINUITY_GROUPS.map((group) => ({ ...group, entries: (table[group.key] ?? []) as ContinuityEntry[] })).filter((group) => group.entries.length > 0);
    const totalEntries = groups.reduce((total, group) => total + group.entries.length, 0);

    return (
        <>
            <p className="mt-1 truncate text-xs font-medium opacity-60">
                {groups.length} 类共 {totalEntries} 项锁定
                {groups.length ? `：${groups.map((group) => `${group.label}${group.entries.length}`).join(" · ")}` : ""}
            </p>
            <DetailScroll background={background}>
                {groups.length ? (
                    groups.map((group) => (
                        <ViewSection key={group.key} title={`${group.label}（${group.entries.length} 项）`}>
                            {group.entries.map((entry) => (
                                <FieldRow key={`${group.key}-${entry.name}`} label={entry.name} value={entry.lockedValue} />
                            ))}
                        </ViewSection>
                    ))
                ) : (
                    <span className="text-xs opacity-65">继承表暂无锁定项</span>
                )}
            </DetailScroll>
        </>
    );
}

function QualityCheckItemRow({ item }: { item: QualityCheckItem }) {
    const tone = checkStatusTone[item.status];
    const StatusIcon = item.status === "fail" ? AlertTriangle : CircleDashed;

    return (
        <div data-check-kind={item.kind} data-check-status={item.status} className="mt-1.5 first:mt-0">
            <div className="flex min-w-0 items-center gap-1.5">
                <StatusIcon className="size-3.5 shrink-0" style={{ color: tone }} />
                <span className="truncate text-xs font-medium" style={{ color: tone }}>
                    {item.label}
                </span>
                {item.segmentId ? <span className="shrink-0 text-[11px] opacity-45">段 {item.segmentId}</span> : null}
                <span className="ml-auto shrink-0 rounded px-1.5 text-[11px] font-medium" style={{ background: `${tone}18`, color: tone }}>
                    {checkStatusLabel[item.status]}
                </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-4 opacity-75">
                实际 {item.actualValue} · 要求 {item.expectedValue}
            </p>
            <p className="mt-0.5 text-[11px] leading-4 opacity-55">{item.reason}</p>
            {item.shotIds.length ? <p className="mt-0.5 truncate text-[11px] leading-4 opacity-45">涉及镜头 {formatShotIds(item.shotIds)}</p> : null}
        </div>
    );
}

/**
 * 分镜表质量检查结果：不达标项标红在前，待定项（数据不足/物理上无法判定）用灰色区分在后，通过项只折成一行计数。
 * 决策 D4：只提示不阻断——本组件不渲染任何按钮，也不影响节点上的验收操作。
 */
export function ToonflowQualityCheckPanel({ report, background }: { report: QualityCheckReport; background: string }) {
    const failedItems = report.items.filter((item) => item.status === "fail");
    const unknownItems = report.items.filter((item) => item.status === "unknown");
    const allPassed = report.summary.total > 0 && failedItems.length === 0 && unknownItems.length === 0;

    return (
        <>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 truncate text-xs font-medium">
                <span className="opacity-60">质量检查 {report.summary.total} 项</span>
                {failedItems.length ? <span style={{ color: checkStatusTone.fail }}>{failedItems.length} 项不达标</span> : null}
                {unknownItems.length ? <span style={{ color: checkStatusTone.unknown }}>{unknownItems.length} 项待定</span> : null}
                {report.summary.passed ? <span className="opacity-45">{report.summary.passed} 项通过</span> : null}
            </p>
            <DetailScroll background={background}>
                {allPassed ? (
                    <div className="flex items-center gap-1.5 text-xs">
                        <CheckCircle2 className="size-3.5 shrink-0" style={{ color: checkStatusTone.pass }} />
                        <span className="opacity-75">{report.summary.total} 项检查全部通过</span>
                    </div>
                ) : (
                    <>
                        {failedItems.map((item) => (
                            <QualityCheckItemRow key={`${item.kind}-${item.segmentId ?? "all"}`} item={item} />
                        ))}
                        {unknownItems.map((item) => (
                            <QualityCheckItemRow key={`${item.kind}-${item.segmentId ?? "all"}`} item={item} />
                        ))}
                        {report.summary.passed ? <p className="mt-1.5 text-[11px] leading-4 opacity-45">其余 {report.summary.passed} 项检查通过</p> : null}
                        {report.summary.total === 0 ? <span className="text-xs opacity-65">暂无检查结果</span> : null}
                    </>
                )}
            </DetailScroll>
        </>
    );
}
