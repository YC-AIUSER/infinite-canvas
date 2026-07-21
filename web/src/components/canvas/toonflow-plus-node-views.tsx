/**
 * Toonflow plus 新节点的产物展示：分镜决策锁定表（A 表/B 表/缝合同）、跨段状态继承表、分镜表质量检查结果，
 * 以及质量检查衍生的「一键修改方案」补丁选择界面（设计文档 4.5）。
 *
 * 全部是纯展示组件：数据由调用方传入，自身不读 store、不发请求、不持久化任何东西
 * （补丁面板的勾选是本地 UI 状态，应用动作一律回调给调用方执行）。
 * 质量检查结果按决策 D4「提示不拦」呈现——只显示事实，不禁用任何原有按钮、不拦截验收操作；
 * 「生成修改方案」是可选辅助入口，用户完全可以无视它直接通过。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Checkbox, Modal, Popconfirm } from "antd";
import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";

import type { DiversityPatchSkip } from "@/lib/toonflow/node-runtime";
import type { QualityCheckItem, QualityCheckReport, QualityCheckStatus } from "@/lib/toonflow/quality-check";
import type { ContinuityEntry, ContinuityTable, DirectingLock, DiversityPatch, DiversityPatchItem } from "@/lib/toonflow/schema";

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
 * 决策 D4：只提示不阻断——本组件不禁用、不拦截任何原有操作。
 *
 * onRepair 是「一键修改方案」的可选入口：只在有不达标项且调用方给了回调时才渲染，
 * 点它要调 1 次模型，所以跟其它生成按钮一样先过 Popconfirm。
 */
export function ToonflowQualityCheckPanel({ report, background, onRepair }: { report: QualityCheckReport; background: string; onRepair?: (failedItems: QualityCheckItem[]) => void }) {
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
            {onRepair && failedItems.length ? (
                <div className="mt-2 flex justify-end" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    <Popconfirm title="将调用 1 次文本生成" description="只对不达标的那几镜出定点修补丁，其余镜头与字段原样不动" okText="确认生成" cancelText="取消" onConfirm={() => onRepair(failedItems)}>
                        <Button size="small">生成修改方案</Button>
                    </Popconfirm>
                </div>
            ) : null}
        </>
    );
}

// ============================================================
// 一键修改方案（设计文档 4.5）：补丁逐条展示 + 勾选 + 全部应用 / 应用所选 / 忽略
// ============================================================

/** 补丁能落到的两份产物，展示用中文名。 */
const PATCH_TARGET_LABELS: Record<DiversityPatchItem["target"], string> = {
    storyboardRow: "分镜表",
    shotContract: "镜头合同",
};

/** 可定点修的三个字段，展示用中文名；模型写了库外字段名时原样显示（应用时会被 applyDiversityPatch 跳过并报告）。 */
const PATCH_FIELD_LABELS: Record<string, string> = {
    scale: "景别",
    angle: "角度",
    movement: "运镜",
};

function patchFieldLabel(field: string): string {
    return PATCH_FIELD_LABELS[field] ?? field;
}

/**
 * 一条补丁的稳定标识。同一镜的同一字段在两份产物上各有一条（prompt 铁律 5 要求成对给），
 * 所以 target 必须进 key；再拼下标兜住模型重复给同一条的情况，保证勾选不串。
 */
export function diversityPatchKey(patch: DiversityPatchItem, index: number): string {
    return `${index}|${patch.target}|${patch.shotId}|${patch.field}`;
}

/** 按勾选集筛出要应用的补丁——部分应用就是这么实现的：只有被选中的才会传给 applyDiversityPatch。 */
export function pickSelectedPatches(patches: DiversityPatchItem[], selectedKeys: Iterable<string>): DiversityPatchItem[] {
    const selected = new Set(selectedKeys);
    return patches.filter((patch, index) => selected.has(diversityPatchKey(patch, index)));
}

/** 应用后的结果回执：应用了几条 + 哪几条没应用及原因（skipped 必须让用户看见，不能悄悄吞掉）。 */
export type DiversityPatchOutcome = {
    appliedCount: number;
    skipped: DiversityPatchSkip[];
};

export type ToonflowDiversityPatchPanelProps = {
    /** 正在调模型生成补丁 */
    loading?: boolean;
    /** 生成或解析失败的可见原因 */
    error?: string;
    patch?: DiversityPatch | null;
    /** 有值时说明本轮已应用完，改为展示回执 */
    outcome?: DiversityPatchOutcome | null;
    onApply: (patches: DiversityPatchItem[]) => void;
    onClose: () => void;
};

function PatchRow({ patch, checked, onToggle }: { patch: DiversityPatchItem; checked: boolean; onToggle: () => void }) {
    return (
        <div className="rounded-xl border p-3">
            <Checkbox checked={checked} onChange={onToggle}>
                <span className="text-sm font-medium">
                    {patch.shotId} · {PATCH_TARGET_LABELS[patch.target]}
                    {patchFieldLabel(patch.field)}
                </span>
            </Checkbox>
            <p className="mt-1.5 text-sm leading-6">
                <span className="opacity-55">{patch.oldValue || "（空）"}</span>
                <span className="mx-2 opacity-40">→</span>
                <span className="font-medium">{patch.newValue || "（空）"}</span>
            </p>
            <p className="mt-0.5 text-xs leading-5 opacity-60">理由：{patch.reason || "（模型未给理由）"}</p>
        </div>
    );
}

/**
 * 补丁选择面板。抽成不含 Modal 外壳的独立组件，既让弹窗只剩一层壳，也让它能被静态渲染测试直接断言。
 * 默认全选：绝大多数情况用户就是想全接受，但每条都能单独取消。
 */
export function ToonflowDiversityPatchPanel({ loading = false, error, patch, outcome, onApply, onClose }: ToonflowDiversityPatchPanelProps) {
    const patches = useMemo(() => patch?.patches ?? [], [patch]);
    const allKeys = useMemo(() => patches.map((item, index) => diversityPatchKey(item, index)), [patches]);
    const [selectedKeys, setSelectedKeys] = useState<string[]>(allKeys);

    // 换了一批补丁就重置为全选（同一批不重置，避免用户取消的勾选被父级重渲染冲掉）。
    useEffect(() => {
        setSelectedKeys(allKeys);
    }, [allKeys]);

    if (outcome) {
        return (
            <div data-testid="diversity-patch-outcome">
                <p className="text-sm leading-6">已应用 {outcome.appliedCount} 条修改，检查结果会随之重算。</p>
                {outcome.skipped.length ? (
                    <div className="mt-3 rounded-xl border p-3">
                        <p className="text-sm font-medium">有 {outcome.skipped.length} 条未应用：</p>
                        {outcome.skipped.map((entry, index) => (
                            <p key={diversityPatchKey(entry.patch, index)} className="mt-1.5 text-xs leading-5 opacity-70">
                                {entry.patch.shotId} · {PATCH_TARGET_LABELS[entry.patch.target]}
                                {patchFieldLabel(entry.patch.field)}：{entry.reason}
                            </p>
                        ))}
                    </div>
                ) : null}
                <div className="mt-4 flex justify-end">
                    <Button type="primary" onClick={onClose}>
                        知道了
                    </Button>
                </div>
            </div>
        );
    }

    if (loading) {
        return <p className="py-8 text-center text-sm opacity-65">正在生成修改方案…</p>;
    }

    if (error) {
        return (
            <div data-testid="diversity-patch-error">
                <p className="text-sm leading-6">修改方案生成失败：{error}</p>
                <p className="mt-1 text-xs leading-5 opacity-60">可以关掉重试一次；不修也不影响验收，检查结果只提示不阻断。</p>
                <div className="mt-4 flex justify-end">
                    <Button onClick={onClose}>关闭</Button>
                </div>
            </div>
        );
    }

    const selected = new Set(selectedKeys);

    return (
        <div>
            <p className="text-sm leading-6 opacity-70">{patch?.summary?.trim() || "只改点名的那几镜，其余镜头与字段原样不动。逐条确认后应用。"}</p>
            {patches.length ? (
                <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                    {patches.map((item, index) => {
                        const key = diversityPatchKey(item, index);
                        return <PatchRow key={key} patch={item} checked={selected.has(key)} onToggle={() => setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((entry) => entry !== key) : [...prev, key]))} />;
                    })}
                </div>
            ) : (
                <p className="py-8 text-center text-sm opacity-65">模型没有给出可应用的修改条目。</p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
                <span className="mr-auto text-xs opacity-55">
                    已选 {selectedKeys.length} / {patches.length} 条
                </span>
                <Button onClick={onClose}>忽略</Button>
                <Button disabled={!selectedKeys.length} onClick={() => onApply(pickSelectedPatches(patches, selectedKeys))}>
                    应用所选
                </Button>
                <Button type="primary" disabled={!patches.length} onClick={() => onApply(patches)}>
                    全部应用
                </Button>
            </div>
        </div>
    );
}

export function ToonflowDiversityPatchModal({ open, ...panelProps }: ToonflowDiversityPatchPanelProps & { open: boolean }) {
    return (
        <Modal title="一键修改方案（定点修）" open={open} width={720} footer={null} onCancel={panelProps.onClose} destroyOnHidden>
            <ToonflowDiversityPatchPanel {...panelProps} />
        </Modal>
    );
}
