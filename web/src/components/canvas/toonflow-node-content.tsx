import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Checkbox, Input, InputNumber, Popconfirm, Select } from "antd";
import { AlertTriangle, CheckCircle2, ChevronRight, CircleDashed, Clock3 } from "lucide-react";
import { z } from "zod";

import { canvasThemes } from "@/lib/canvas-theme";
import { runQualityCheck, type QualityCheckItem } from "@/lib/toonflow/quality-check";
import { buildRepairPlan, canApproveSegment, emptyQualityReview, evaluateRepairCostGate, QUALITY_REVIEW_LABELS, REPAIR_METHOD_LABELS, segmentApprovalBlockReason, setRepairMethod } from "@/lib/toonflow/node-runtime";
import { ActionContractSchema, parseModelJson, REPAIR_METHODS, ShotContractSchema, type DubbingTrack, type QualityReview, type RepairPlanItem, type StoryboardRow } from "@/lib/toonflow/schema";
import { resolveStreamPreview, type ToonflowStreamPreview } from "@/lib/toonflow/streaming";
import { resolveMediaUrl } from "@/services/file-storage";
import { resolveImageUrl } from "@/services/image-storage";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, ToonflowNodeStageStatus } from "@/types/canvas";

import { ToonflowContinuityTableView, ToonflowDirectingLockView, ToonflowQualityCheckPanel } from "./toonflow-plus-node-views";
import { ToonflowAudioMixPanel, ToonflowSegmentQualityReview } from "./toonflow-delivery-node-views";

const statusTone: Record<ToonflowNodeStageStatus, string> = {
    empty: "#78716c",
    generating: "#ca8a04",
    review: "#9333ea",
    approved: "#16a34a",
    failed: "#dc2626",
    stale: "#d97706",
    skipped: "#64748b",
};

const statusLabel: Record<ToonflowNodeStageStatus, string> = {
    empty: "未开始",
    generating: "生成中",
    review: "待验收",
    approved: "已通过",
    failed: "生成失败",
    stale: "已失效",
    skipped: "已跳过",
};

// creative 是选修环节,默认状态就是 skipped,也必须能手动生成——不列进来的话整个操作区都不渲染,用户点不到任何入口。
const actionableKinds = new Set(["creative", "script", "space-contract", "storyboard-table", "shot-contract", "action-contract"]);

/** 生成中的实时回显。text 模式当正文读,raw 模式是结构化产物的半截 JSON,只给进度感。 */
function ToonflowStreamingView({ preview, background, accent }: { preview: ToonflowStreamPreview; background: string; accent: string }) {
    const scrollRef = useRef<HTMLDivElement>(null);
    // 新内容永远从底部长出来,跟着滚才看得见正在写的那一句。
    useEffect(() => {
        const element = scrollRef.current;
        if (element) element.scrollTop = element.scrollHeight;
    }, [preview.text]);

    return (
        <div className="mt-2 flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: accent }}>
                <span className="inline-block size-1.5 animate-pulse rounded-full" style={{ background: accent }} />
                <span>{preview.mode === "raw" ? "生成中 · 实时输出（完成后转为表格）" : "生成中 · 实时输出"}</span>
            </div>
            <div
                ref={scrollRef}
                className={`mt-1.5 min-h-0 flex-1 overflow-y-auto rounded-md px-2.5 py-2 whitespace-pre-wrap ${preview.mode === "raw" ? "text-[11px] leading-4 opacity-55 break-all" : "text-xs leading-5"}`}
                style={{ background }}
            >
                {preview.text}
            </div>
        </div>
    );
}

type ToonflowNodeContentProps = {
    node: CanvasNodeData;
    cascadeLocked?: boolean;
    onGenerate?: (nodeId: string) => void;
    onRegenerate?: (nodeId: string) => void;
    onApprove?: (nodeId: string) => void;
    onEdit?: (nodeId: string) => void;
    onCascade?: (nodeId: string) => void;
    onHistory?: (nodeId: string) => void;
    onRepair?: (nodeId: string) => void;
    /** 分镜表质量检查的「生成修改方案」入口（设计文档 4.5），不传就不渲染该按钮。 */
    onDiversityRepair?: (nodeId: string, failedItems: QualityCheckItem[]) => void;
    onOpenAssetCards?: (nodeId: string) => void;
    onAdopt?: (nodeId: string) => void;
    onDeleteArchived?: (nodeId: string) => void;
    onOpenExport?: (nodeId: string) => void;
    exportSummary?: { approvedCount: number; totalSegments: number };
    onOpenSeam?: (nodeId: string) => void;
    onSeamSkip?: (nodeId: string) => void;
    seamSummary?: { checkedCount: number; total: number };
    onQualityReviewChange?: (nodeId: string, review: QualityReview) => void;
    onVoiceMapChange?: (nodeId: string, voiceMap: Record<string, string>) => void;
    batchCount?: number;
    batchExpanded?: boolean;
    onToggleBatch?: (nodeId: string) => void;
};

function InstanceImage({ storageKey, name, background, borderColor }: { storageKey: string; name: string; background: string; borderColor: string }) {
    const [url, setUrl] = useState("");

    useEffect(() => {
        let active = true;
        setUrl("");
        void resolveImageUrl(storageKey).then(
            (resolved) => {
                if (active) setUrl(resolved);
            },
            () => {
                if (active) setUrl("");
            },
        );
        return () => {
            active = false;
        };
    }, [storageKey]);

    return (
        <div className="mt-2 h-24 overflow-hidden rounded-lg border" style={{ background, borderColor }}>
            {url ? <img src={url} alt={name} className="h-full w-full object-contain" /> : null}
        </div>
    );
}

function InstanceVideo({ storageKey, name, background, borderColor }: { storageKey: string; name: string; background: string; borderColor: string }) {
    const [url, setUrl] = useState("");

    useEffect(() => {
        let active = true;
        setUrl("");
        void resolveMediaUrl(storageKey).then(
            (resolved) => {
                if (active) setUrl(resolved);
            },
            () => {
                if (active) setUrl("");
            },
        );
        return () => {
            active = false;
        };
    }, [storageKey]);

    return (
        <div className="mt-2 h-24 overflow-hidden rounded-lg border" style={{ background, borderColor }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            {url ? <video src={url} aria-label={name} controls muted playsInline preload="metadata" className="h-full w-full object-contain" /> : null}
        </div>
    );
}

const ShotContractListSchema = z.array(ShotContractSchema);
const ActionContractListSchema = z.array(ActionContractSchema);

/** 在画布工程里找到该节点所在的那份节点列表（节点状态由 project 页同步进 store，这里只读不写）。 */
function findSiblingNodes(projects: Array<{ nodes: CanvasNodeData[] }>, nodeId: string): CanvasNodeData[] | undefined {
    return projects.find((project) => project.nodes.some((item) => item.id === nodeId))?.nodes;
}

function findToonflowNode(projects: Array<{ nodes: CanvasNodeData[] }>, nodeId: string, kind: string) {
    return findSiblingNodes(projects, nodeId)?.find((item) => item.metadata?.toonflow?.kind === kind)?.metadata?.toonflow;
}

/**
 * 分镜表节点上的质量检查：检查器是纯函数、输入全在画布节点里，所以渲染时实时算，
 * 不落库、不进 schema。selector 只取镜头/动作合同文本与锁定表三个引用，画布其它改动不会触发重算。
 */
function StoryboardQualityCheck({ nodeId, rows, background, onDiversityRepair }: { nodeId: string; rows: StoryboardRow[]; background: string; onDiversityRepair?: (nodeId: string, failedItems: QualityCheckItem[]) => void }) {
    const shotContractText = useCanvasStore((state) => findToonflowNode(state.projects, nodeId, "shot-contract")?.output?.payload.text);
    const actionContractText = useCanvasStore((state) => findToonflowNode(state.projects, nodeId, "action-contract")?.output?.payload.text);
    const directingLock = useCanvasStore((state) => findToonflowNode(state.projects, nodeId, "directing-lock")?.output?.payload.directingLock);
    const report = useMemo(() => {
        const parsedShotContracts = shotContractText?.trim() ? parseModelJson(ShotContractListSchema, shotContractText) : null;
        const parsedActionContracts = actionContractText?.trim() ? parseModelJson(ActionContractListSchema, actionContractText) : null;
        // 故事板格子数无法从节点数据里读出（要数图上的画格），不传：检查器会把「格子数一致」标成待定，而不是误报不达标。
        return runQualityCheck({
            storyboardRows: rows,
            shotContracts: parsedShotContracts?.ok ? parsedShotContracts.data : undefined,
            actionContracts: parsedActionContracts?.ok ? parsedActionContracts.data : undefined,
            directingLock,
        });
    }, [rows, shotContractText, actionContractText, directingLock]);

    return <ToonflowQualityCheckPanel report={report} background={background} onRepair={onDiversityRepair ? (failedItems) => onDiversityRepair(nodeId, failedItems) : undefined} />;
}

const repairMethodOptions = REPAIR_METHODS.map((method) => ({ value: method, label: REPAIR_METHOD_LABELS[method] }));

/**
 * 返修计划的长文本输入：本地 draft，失焦才写回画布。
 * 逐字符 onChange 会一路走到 updateProject → projects 换新引用 → 全体 selector 重扫，
 * 长文本连打时可感知卡顿(对抗审查 P2-4)。外部值变化时同步回本地——编辑期间外部值不会变
 * (本地还没提交)，所以不会打断正在输入的内容。
 */
function RepairDraftTextArea({ value, onCommit }: { value: string; onCommit: (next: string) => void }) {
    const [draft, setDraft] = useState(value);

    useEffect(() => {
        setDraft(value);
    }, [value]);

    return (
        <Input.TextArea
            autoSize={{ minRows: 1, maxRows: 3 }}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => {
                if (draft !== value) onCommit(draft);
            }}
        />
    );
}

function VideoQualityRepairSection({
    nodeId,
    segmentId,
    review,
    background,
    blockReason,
    onChange,
}: {
    nodeId: string;
    segmentId: string;
    review?: QualityReview;
    background: string;
    blockReason?: string;
    onChange: (review: QualityReview) => void;
}) {
    const table = useCanvasStore((state) => findToonflowNode(state.projects, nodeId, "storyboard-table")?.output?.payload.table);
    // 闸门分母按全片镜头数(09-qc-repair §七 原文是「全片 20%」);段内镜头数只用于「重做整段」的成本。
    const filmShotCount = useMemo(() => (table ?? []).length, [table]);
    const segmentShotCount = useMemo(() => (table ?? []).filter((row) => row.segmentId === segmentId).length, [table, segmentId]);
    const currentReview = review ?? emptyQualityReview();
    const repairPlan = buildRepairPlan(currentReview);
    const gate = evaluateRepairCostGate(repairPlan, filmShotCount, segmentShotCount);
    const p2Items = currentReview.items.filter((item) => item.severity === "P2");

    function saveReview(nextReview: QualityReview) {
        const nextPlan = buildRepairPlan(nextReview, repairPlan);
        const nextGate = evaluateRepairCostGate(nextPlan, filmShotCount, segmentShotCount);
        onChange({
            ...nextReview,
            repairPlan: nextPlan.length ? nextPlan : undefined,
            // 勾质检项、改备注不改变返修规模,已做的成本确认不该被清掉(改返修计划本身才清,见 updateRepair)。
            // 取值必须走 currentReview:七项质检面板的 onChange 只回传 items,nextReview 上永远没有这个字段。
            repairCostConfirmed: nextGate.available && nextGate.exceeds20Percent ? currentReview.repairCostConfirmed : undefined,
        });
    }

    function updateRepair(index: number, patch: Partial<RepairPlanItem>) {
        const nextPlan = repairPlan.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
        const nextGate = evaluateRepairCostGate(nextPlan, filmShotCount, segmentShotCount);
        onChange({
            ...currentReview,
            repairPlan: nextPlan,
            repairCostConfirmed: nextGate.exceeds20Percent ? undefined : currentReview.repairCostConfirmed,
        });
    }

    return (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <ToonflowSegmentQualityReview review={review} background={background} blockReason={blockReason} onChange={saveReview} />
            <details className="mt-2 rounded-md px-2.5 py-2 text-xs" style={{ background }} open={repairPlan.length > 0 || p2Items.length > 0}>
                <summary className="cursor-pointer select-none font-medium">最小返修计划 · {repairPlan.length} 项</summary>
                {!repairPlan.length ? <p className="mt-2 opacity-55">P0/P1 问题会自动进入返修计划；P2 只列为建议优化。</p> : null}
                {p2Items.length ? (
                    <div className="mt-2 rounded-md border border-current/10 px-2 py-1.5 opacity-70">
                        建议优化（不默认返修）：{p2Items.map((item) => `${QUALITY_REVIEW_LABELS[item.key]}${item.note ? `：${item.note}` : ""}`).join("；")}
                    </div>
                ) : null}
                <div className="mt-2 space-y-2">
                    {repairPlan.map((item, index) => (
                        <div key={item.reviewKey} className="rounded-md border border-current/10 p-2">
                            <div className="flex items-center gap-2">
                                <span className="shrink-0 font-medium">{item.severity} · {QUALITY_REVIEW_LABELS[item.reviewKey]}</span>
                                <Select
                                    size="small"
                                    className="min-w-0 flex-1"
                                    value={item.method}
                                    options={repairMethodOptions}
                                    onChange={(method) => updateRepair(index, setRepairMethod(item, method))}
                                />
                            </div>
                            <label className="mt-2 block">
                                <span className="opacity-55">原因</span>
                                <RepairDraftTextArea value={item.reason} onCommit={(next) => updateRepair(index, { reason: next })} />
                            </label>
                            <label className="mt-1.5 block">
                                <span className="opacity-55">输入锚点</span>
                                <RepairDraftTextArea value={item.inputAnchor} onCommit={(next) => updateRepair(index, { inputAnchor: next })} />
                            </label>
                            <label className="mt-1.5 block">
                                <span className="opacity-55">保留内容</span>
                                <RepairDraftTextArea value={item.preservedContent} onCommit={(next) => updateRepair(index, { preservedContent: next })} />
                            </label>
                            <label className="mt-1.5 block">
                                <span className="opacity-55">替换范围</span>
                                <RepairDraftTextArea value={item.replacementScope} onCommit={(next) => updateRepair(index, { replacementScope: next })} />
                            </label>
                            <label className="mt-1.5 block">
                                <span className="opacity-55">验收标准</span>
                                <RepairDraftTextArea value={item.acceptanceCriteria} onCommit={(next) => updateRepair(index, { acceptanceCriteria: next })} />
                            </label>
                            {item.method === "regenerate-shot" ? (
                                <div className="mt-1.5">
                                    <label className="block">
                                        <span className="opacity-55">镜头号（可选，逗号分隔）</span>
                                        <Input
                                            key={`${item.reviewKey}:${(item.shotIds ?? []).join(",")}`}
                                            size="small"
                                            placeholder="例如 shot-01, shot-02"
                                            defaultValue={(item.shotIds ?? []).join(", ")}
                                            onBlur={(event) => {
                                                const shotIds = event.target.value.split(/[,，]/).map((shotId) => shotId.trim()).filter(Boolean);
                                                updateRepair(index, { shotIds: shotIds.length ? shotIds : undefined });
                                            }}
                                        />
                                    </label>
                                    <label className="mt-1 flex items-center gap-2">
                                        <span className="opacity-55">预计重生成镜头数</span>
                                        <InputNumber size="small" min={1} max={Math.max(1, filmShotCount)} value={item.regeneratedShotCount ?? 1} onChange={(value) => updateRepair(index, { regeneratedShotCount: value ?? 1 })} />
                                    </label>
                                    <p className="mt-1 opacity-55">未指定镜头号时按项累加，可能高估。</p>
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>
                {repairPlan.length && !gate.available ? (
                    <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 font-medium text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                        <span>无法计算返修成本（缺少分镜表镜头数）</span>
                    </div>
                ) : gate.exceeds20Percent ? (
                    <div className="mt-2 rounded-md border border-red-500/50 bg-red-500/10 p-2 text-red-700 dark:text-red-300">
                        <div className="flex items-start gap-1.5 font-medium">
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                            <span>成本闸门：预计重生成 {gate.regeneratedShotCount}/{gate.totalShotCount} 个镜头（{Math.round(gate.ratio * 100)}%），超过 20%。继续前请先确认返修范围与成本影响。</span>
                        </div>
                        <Checkbox className="mt-2" checked={currentReview.repairCostConfirmed === true} onChange={(event) => onChange({ ...currentReview, repairPlan, repairCostConfirmed: event.target.checked || undefined })}>
                            我已确认返修范围与成本影响
                        </Checkbox>
                    </div>
                ) : null}
                {repairPlan.length ? (
                    <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-amber-700 dark:text-amber-300">
                        同一问题连续两次生成仍失败时，停止盲目重试，改镜头设计或采用剪辑规避。保留原始素材和版本，不覆盖唯一文件。
                    </div>
                ) : null}
            </details>
        </div>
    );
}

/**
 * 音频混音节点的分镜行选取。selector 只准返回稳定引用（分镜表 payload 本体），
 * 段内过滤放 useMemo——在 selector 里 filter 或返回 [] 字面量都是每次新引用，
 * 快照比较永远不等，会无限重渲染直接把画布页打崩（Maximum update depth exceeded，实测）。
 */
function AudioMixSection({ nodeId, segmentId, voiceMap, dubbing, background, onVoiceMapChange }: { nodeId: string; segmentId: string; voiceMap: Record<string, string>; dubbing: DubbingTrack[]; background: string; onVoiceMapChange: (voiceMap: Record<string, string>) => void }) {
    const table = useCanvasStore((state) => findToonflowNode(state.projects, nodeId, "storyboard-table")?.output?.payload.table);
    const rows = useMemo(() => (table ?? []).filter((row) => row.segmentId === segmentId), [table, segmentId]);
    return <ToonflowAudioMixPanel rows={rows} voiceMap={voiceMap} dubbing={dubbing} background={background} onVoiceMapChange={onVoiceMapChange} />;
}

export function ToonflowNodeContent({
    node,
    cascadeLocked = false,
    onGenerate,
    onRegenerate,
    onApprove,
    onEdit,
    onCascade,
    onHistory,
    onRepair,
    onDiversityRepair,
    onOpenAssetCards,
    onAdopt,
    onDeleteArchived,
    onOpenExport,
    exportSummary,
    onOpenSeam,
    onSeamSkip,
    seamSummary,
    onQualityReviewChange,
    onVoiceMapChange,
    batchCount = 0,
    batchExpanded = false,
    onToggleBatch,
}: ToonflowNodeContentProps) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const toonflow = node.metadata?.toonflow;
    if (!toonflow) return null;

    const accent = toonflow.accent || theme.node.activeStroke;
    const isExport = toonflow.kind === "export";
    const isSeam = toonflow.kind === "seam-check";
    // 导出节点是终端节点,不做 approved 存储仪式:显示状态实时由已通过段数推导(全就绪=已通过/部分=待导出/无=未开始),存储状态保持 empty。
    const displayStatus: ToonflowNodeStageStatus =
        isExport && exportSummary
            ? exportSummary.totalSegments > 0 && exportSummary.approvedCount >= exportSummary.totalSegments
                ? "approved"
                : exportSummary.approvedCount > 0
                  ? "review"
                  : "empty"
            : toonflow.status;
    const statusColor = statusTone[displayStatus] || theme.node.muted;
    const isActionable = actionableKinds.has(toonflow.kind);
    const isInstance = (toonflow.kind === "storyboard-page" || toonflow.kind === "keyframes" || toonflow.kind === "video-workbench" || toonflow.kind === "audio-mix") && Boolean(toonflow.segmentId);
    const instanceImageKey = toonflow.output?.payload.imageKeys?.[0];
    const instanceVideoKey = toonflow.output?.payload.videoKeys?.[0];
    const generationKindLabel = toonflow.kind === "video-workbench" ? "文本" : toonflow.kind === "audio-mix" ? "音频" : "图像";
    const error = toonflow.output?.error || node.metadata?.errorDetails;
    const directingLock = toonflow.kind === "directing-lock" ? toonflow.output?.payload.directingLock : undefined;
    const continuityTable = toonflow.kind === "continuity-table" ? toonflow.output?.payload.continuityTable : undefined;
    const storyboardRows = toonflow.kind === "storyboard-table" ? toonflow.output?.payload.table : undefined;
    const washHits = toonflow.washReport?.hits || [];
    // 生成中的实时回显接管内容区,落定后 streamingText 被清掉,自动回到下面的正式渲染分支。
    const streamPreview = resolveStreamPreview(toonflow);
    const assetCards = toonflow.output?.payload.cards;
    const module4Text = toonflow.kind === "video-workbench" ? toonflow.output?.payload.text : undefined;
    const module4Issues = toonflow.kind === "video-workbench" ? toonflow.output?.payload.module4Issues ?? [] : [];
    const qualityReview = toonflow.kind === "video-workbench" ? toonflow.output?.payload.qualityReview : undefined;
    const approvalBlockReason = toonflow.kind === "video-workbench" && instanceVideoKey ? segmentApprovalBlockReason(qualityReview) : undefined;
    const dubbing = toonflow.kind === "audio-mix" ? toonflow.output?.payload.dubbing ?? [] : [];
    const awaitingVideoConfirmation = toonflow.kind === "video-workbench" && toonflow.status === "review" && Boolean(module4Text) && !instanceVideoKey;
    const assetCardSummary = assetCards?.length
        ? assetCards.reduce(
              (summary, card) => {
                  summary[card.cardType] += 1;
                  return summary;
              },
              { character: 0, scene: 0, prop: 0, action: 0, expression: 0, outfit: 0, form: 0, audio: 0, palette: 0, styleSwatch: 0 },
          )
        : null;

    return (
        <div className="flex h-full w-full flex-col overflow-hidden p-3.5" style={{ color: theme.node.text }}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: accent }} />
                        <span className="truncate text-xs font-medium opacity-55">{toonflow.stage}</span>
                    </div>
                    <h3 className="mt-1 truncate text-lg font-semibold leading-6">{node.title}</h3>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                    {batchCount > 1 ? (
                        <Button
                            size="small"
                            type="text"
                            aria-label={batchExpanded ? "收起段实例" : "展开段实例"}
                            onClick={(event) => {
                                event.stopPropagation();
                                onToggleBatch?.(node.id);
                            }}
                            onMouseDown={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                        >
                            <span className="inline-flex items-center gap-1">
                                <span>{batchCount}</span>
                                <ChevronRight className={`size-3.5 transition-transform ${batchExpanded ? "rotate-90" : ""}`} />
                            </span>
                        </Button>
                    ) : null}
                    {toonflow.output && toonflow.output.version > 0 ? <span className="text-[11px] font-medium opacity-45">v{toonflow.output.version}</span> : null}
                    {toonflow.archived ? (
                        <span className="rounded-md px-2 py-1 text-xs font-medium" style={{ background: `${theme.node.muted}18`, color: theme.node.muted }}>
                            已归档
                        </span>
                    ) : null}
                    <span className="rounded-md px-2 py-1 text-xs font-medium" style={{ background: `${statusColor}18`, color: statusColor }}>
                        {statusLabel[displayStatus]}
                    </span>
                </div>
            </div>

            <p className="mt-2 line-clamp-1 text-sm leading-5 opacity-70">{toonflow.summary}</p>

            {isInstance && instanceImageKey ? <InstanceImage storageKey={instanceImageKey} name={node.title} background={theme.node.fill} borderColor={`${theme.node.muted}30`} /> : null}
            {isInstance && instanceVideoKey ? <InstanceVideo storageKey={instanceVideoKey} name={node.title} background={theme.node.fill} borderColor={`${theme.node.muted}30`} /> : null}

            {assetCardSummary ? (
                <p className="mt-1 truncate text-xs font-medium opacity-60">
                    {assetCards?.length ?? 0} 张卡：角色{assetCardSummary.character} · 场景{assetCardSummary.scene} · 道具{assetCardSummary.prop}
                    {assetCardSummary.action + assetCardSummary.expression + assetCardSummary.outfit + assetCardSummary.form > 0
                        ? ` · 衍生${assetCardSummary.action + assetCardSummary.expression + assetCardSummary.outfit + assetCardSummary.form}`
                        : ""}
                    {assetCardSummary.styleSwatch > 0 ? ` · 质感样板${assetCardSummary.styleSwatch}` : ""}
                </p>
            ) : null}

            {toonflow.status === "failed" && error ? (
                <p className="mt-1 line-clamp-1 text-xs" style={{ color: statusColor }} title={error}>
                    {error}
                </p>
            ) : null}
            {toonflow.status === "failed" && module4Issues.length ? (
                <div className="mt-1 max-h-20 overflow-y-auto rounded-md px-2 py-1.5 text-xs" style={{ background: `${statusColor}12`, color: statusColor }}>
                    {module4Issues.map((issue) => (
                        <div key={issue}>· {issue}</div>
                    ))}
                </div>
            ) : null}
            {toonflow.status === "stale" ? (
                <div className="mt-1 flex items-center gap-1 text-xs font-medium" style={{ color: statusColor }}>
                    <AlertTriangle className="size-3.5" />
                    <span>上游已更新，请重新生成</span>
                </div>
            ) : null}

            {streamPreview ? (
                <ToonflowStreamingView preview={streamPreview} background={theme.node.fill} accent={accent} />
            ) : toonflow.kind === "compliance" ? (
                <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-md px-2 py-1.5 text-xs" style={{ background: theme.node.fill }}>
                    {washHits.length ? (
                        washHits.map((hit) => (
                            <div key={`${hit.term}-${hit.replacement}`} className="truncate" title={`${hit.term} → ${hit.replacement}`}>
                                {hit.term} → {hit.replacement}
                            </div>
                        ))
                    ) : (
                        <span className="opacity-65">无避雷词命中</span>
                    )}
                </div>
            ) : isExport ? (
                <div className="mt-2 flex min-h-0 flex-1 flex-col">
                    <div className="rounded-md px-3 py-2.5" style={{ background: theme.node.fill }}>
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-2xl font-semibold leading-none" style={{ color: statusColor }}>
                                {exportSummary?.approvedCount ?? 0}
                            </span>
                            <span className="text-sm opacity-55">/ {exportSummary?.totalSegments ?? 0} 段已通过</span>
                        </div>
                        <p className="mt-1.5 text-xs opacity-60">顺序预览 · 逐段下载 · 打包 ZIP（本期不拼接）</p>
                    </div>
                    <div className="mt-auto flex justify-end pt-2" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                        <Button
                            size="small"
                            type="primary"
                            disabled={!exportSummary?.approvedCount}
                            onClick={(event) => {
                                event.stopPropagation();
                                onOpenExport?.(node.id);
                            }}
                        >
                            打开成片
                        </Button>
                    </div>
                </div>
            ) : isSeam ? (
                <div className="mt-2 flex min-h-0 flex-1 flex-col">
                    <div className="rounded-md px-3 py-2.5" style={{ background: theme.node.fill }}>
                        <div className="flex items-baseline gap-1.5">
                            <span className="text-2xl font-semibold leading-none" style={{ color: statusColor }}>
                                {seamSummary?.checkedCount ?? 0}
                            </span>
                            <span className="text-sm opacity-55">/ {seamSummary?.total ?? 0} 接缝已检</span>
                        </div>
                        <p className="mt-1.5 text-xs opacity-60">相邻段连续性检查 · 可跳过</p>
                    </div>
                    <div className="mt-auto flex justify-end gap-2 pt-2" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                        {toonflow.status !== "approved" && toonflow.status !== "skipped" ? (
                            <Button
                                size="small"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onSeamSkip?.(node.id);
                                }}
                            >
                                跳过
                            </Button>
                        ) : null}
                        <Button
                            size="small"
                            type="primary"
                            disabled={!seamSummary?.total}
                            onClick={(event) => {
                                event.stopPropagation();
                                onOpenSeam?.(node.id);
                            }}
                        >
                            打开检查
                        </Button>
                    </div>
                </div>
            ) : directingLock ? (
                <ToonflowDirectingLockView lock={directingLock} background={theme.node.fill} />
            ) : continuityTable ? (
                <ToonflowContinuityTableView table={continuityTable} background={theme.node.fill} />
            ) : storyboardRows?.length ? (
                <StoryboardQualityCheck nodeId={node.id} rows={storyboardRows} background={theme.node.fill} onDiversityRepair={onDiversityRepair} />
            ) : toonflow.kind === "video-workbench" && instanceVideoKey ? (
                toonflow.segmentId ? (
                    <VideoQualityRepairSection nodeId={node.id} segmentId={toonflow.segmentId} review={qualityReview} background={theme.node.fill} blockReason={approvalBlockReason} onChange={(review) => onQualityReviewChange?.(node.id, review)} />
                ) : (
                    <ToonflowSegmentQualityReview review={qualityReview} background={theme.node.fill} blockReason={approvalBlockReason} onChange={(review) => onQualityReviewChange?.(node.id, review)} />
                )
            ) : toonflow.kind === "audio-mix" && toonflow.segmentId ? (
                <AudioMixSection nodeId={node.id} segmentId={toonflow.segmentId} voiceMap={toonflow.voiceMap ?? {}} dubbing={dubbing} background={theme.node.fill} onVoiceMapChange={(voiceMap) => onVoiceMapChange?.(node.id, voiceMap)} />
            ) : module4Text ? (
                <div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-md px-2.5 py-2 text-xs leading-5 whitespace-pre-wrap" style={{ background: theme.node.fill }}>
                    {module4Text}
                </div>
            ) : (
                <div className="mt-2 grid min-h-0 flex-1 grid-cols-1 gap-1.5">
                    {toonflow.checks.slice(0, isActionable ? 2 : 3).map((item) => (
                        <div key={item} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-xs" style={{ background: theme.node.fill }}>
                            {toonflow.status === "approved" ? (
                                <CheckCircle2 className="size-3.5 shrink-0" style={{ color: statusColor }} />
                            ) : toonflow.status === "generating" ? (
                                <Clock3 className="size-3.5 shrink-0" style={{ color: statusColor }} />
                            ) : (
                                <CircleDashed className="size-3.5 shrink-0 opacity-45" />
                            )}
                            <span className="truncate opacity-75">{item}</span>
                        </div>
                    ))}
                </div>
            )}

            {!isActionable && !isExport && !isSeam && toonflow.kind !== "compliance" && !directingLock && !continuityTable && toonflow.outputs?.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {toonflow.outputs.slice(0, 2).map((item) => (
                        <span key={item} className="rounded-md px-2 py-1 text-[11px] font-medium" style={{ background: `${accent}16`, color: accent }}>
                            {item}
                        </span>
                    ))}
                </div>
            ) : null}

            {toonflow.archived && toonflow.segmentId ? (
                <div className="mt-2 flex justify-end" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    <Popconfirm title="删除已归档实例？" description="该实例的产物与版本历史将一并清理。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => onDeleteArchived?.(node.id)}>
                        <Button size="small" danger>
                            删除
                        </Button>
                    </Popconfirm>
                </div>
            ) : null}

            {toonflow.kind === "assets" && !toonflow.archived ? (
                <div className="mt-2 flex flex-wrap justify-end gap-2" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    {toonflow.status === "review" ? (
                        <Button
                            size="small"
                            disabled={cascadeLocked}
                            onClick={(event) => {
                                event.stopPropagation();
                                onApprove?.(node.id);
                            }}
                        >
                            通过
                        </Button>
                    ) : null}
                    {toonflow.status === "stale" ? (
                        <Button
                            size="small"
                            disabled={cascadeLocked}
                            onClick={(event) => {
                                event.stopPropagation();
                                onAdopt?.(node.id);
                            }}
                        >
                            沿用
                        </Button>
                    ) : null}
                    <Button
                        size="small"
                        type="primary"
                        disabled={cascadeLocked}
                        onClick={(event) => {
                            event.stopPropagation();
                            onOpenAssetCards?.(node.id);
                        }}
                    >
                        资产卡池
                    </Button>
                </div>
            ) : null}

            {isInstance && !toonflow.archived && toonflow.status !== "generating" ? (
                <div className="mt-2 flex flex-wrap justify-end gap-2" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    {toonflow.status === "review" ? (
                        // 视频工作台两步生成:review 且已有 Module4 文本但还没有视频时,"通过"实际会调用一次
                        // 计费的视频生成(handleToonflowApprove 拦截),必须给费用确认;其余实例的通过只是状态流转。
                        awaitingVideoConfirmation ? (
                            <Popconfirm title="确认使用当前Module4文本调用 1 次视频生成？" okText="确认生成" cancelText="取消" onConfirm={() => onApprove?.(node.id)}>
                                <Button size="small" type="primary" disabled={cascadeLocked}>
                                    确认并生成视频
                                </Button>
                            </Popconfirm>
                        ) : (
                            <Button
                                size="small"
                                disabled={cascadeLocked || (toonflow.kind === "video-workbench" && Boolean(instanceVideoKey) && !canApproveSegment(qualityReview))}
                                title={toonflow.kind === "video-workbench" ? approvalBlockReason : undefined}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onApprove?.(node.id);
                                }}
                            >
                                通过
                            </Button>
                        )
                    ) : null}
                    {toonflow.status === "empty" ? (
                        <Popconfirm title={`将调用 1 次${generationKindLabel}生成`} okText="确认生成" cancelText="取消" onConfirm={() => onGenerate?.(node.id)}>
                            <Button size="small" type="primary" disabled={cascadeLocked}>
                                生成
                            </Button>
                        </Popconfirm>
                    ) : null}
                    {toonflow.status === "failed" ? (
                        <Popconfirm title={`将调用 1 次${generationKindLabel}生成`} okText="确认重试" cancelText="取消" onConfirm={() => onGenerate?.(node.id)}>
                            <Button size="small" type="primary" disabled={cascadeLocked}>
                                重试
                            </Button>
                        </Popconfirm>
                    ) : null}
                    {["stale", "review", "approved"].includes(toonflow.status) ? (
                        <Popconfirm title={`将调用 1 次${generationKindLabel}生成`} okText="确认重生成" cancelText="取消" onConfirm={() => onGenerate?.(node.id)}>
                            <Button size="small" type={toonflow.status === "stale" ? "primary" : "default"} disabled={cascadeLocked}>
                                重生成
                            </Button>
                        </Popconfirm>
                    ) : null}
                    {toonflow.status === "stale" ? (
                        <Button
                            size="small"
                            disabled={cascadeLocked}
                            onClick={(event) => {
                                event.stopPropagation();
                                onAdopt?.(node.id);
                            }}
                        >
                            沿用
                        </Button>
                    ) : null}
                    {toonflow.status === "review" || toonflow.status === "approved" ? (
                        <Button
                            size="small"
                            disabled={cascadeLocked}
                            onClick={(event) => {
                                event.stopPropagation();
                                onHistory?.(node.id);
                            }}
                        >
                            历史
                        </Button>
                    ) : null}
                    {(toonflow.kind === "keyframes" || toonflow.kind === "video-workbench") && (toonflow.status === "review" || toonflow.status === "approved") ? (
                        <Button
                            size="small"
                            disabled={cascadeLocked}
                            onClick={(event) => {
                                event.stopPropagation();
                                onRepair?.(node.id);
                            }}
                        >
                            {toonflow.kind === "video-workbench" ? "调提示词" : "定点修"}
                        </Button>
                    ) : null}
                </div>
            ) : null}

            {isActionable ? (
                <div className="mt-2 flex flex-wrap justify-end gap-2" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    {toonflow.status === "approved" && toonflow.kind !== "storyboard-table" ? (
                        <Button
                            size="small"
                            disabled={cascadeLocked}
                            onClick={(event) => {
                                event.stopPropagation();
                                onEdit?.(node.id);
                            }}
                        >
                            编辑
                        </Button>
                    ) : null}
                    {toonflow.status === "approved" ? (
                        <Button
                            size="small"
                            type="primary"
                            disabled={cascadeLocked}
                            onClick={(event) => {
                                event.stopPropagation();
                                onCascade?.(node.id);
                            }}
                        >
                            向下重生成
                        </Button>
                    ) : null}
                    {toonflow.status === "approved" && toonflow.history?.length ? (
                        <Button
                            size="small"
                            disabled={cascadeLocked}
                            onClick={(event) => {
                                event.stopPropagation();
                                onHistory?.(node.id);
                            }}
                        >
                            历史
                        </Button>
                    ) : null}
                    {toonflow.status === "review" ? (
                        <Button
                            size="small"
                            disabled={cascadeLocked}
                            onClick={(event) => {
                                event.stopPropagation();
                                onApprove?.(node.id);
                            }}
                        >
                            通过
                        </Button>
                    ) : null}
                    {toonflow.status === "review" ? (
                        <Button
                            size="small"
                            disabled={cascadeLocked}
                            onClick={(event) => {
                                event.stopPropagation();
                                (onRegenerate ?? onGenerate)?.(node.id);
                            }}
                        >
                            重生成
                        </Button>
                    ) : null}
                    {toonflow.status === "stale" ? (
                        <Button
                            size="small"
                            type="primary"
                            disabled={cascadeLocked}
                            onClick={(event) => {
                                event.stopPropagation();
                                (onRegenerate ?? onGenerate)?.(node.id);
                            }}
                        >
                            重生成
                        </Button>
                    ) : null}
                    {toonflow.status === "stale" ? (
                        <Button
                            size="small"
                            disabled={cascadeLocked}
                            onClick={(event) => {
                                event.stopPropagation();
                                onAdopt?.(node.id);
                            }}
                        >
                            沿用
                        </Button>
                    ) : null}
                    {toonflow.status === "skipped" ? (
                        // 选修环节的入口:状态机允许 skipped → generating(一键跑全链仍会跳过),文案说清点它等于"启用这个环节"。
                        <Popconfirm title="启用该选修环节并生成？" okText="启用并生成" cancelText="取消" onConfirm={() => onGenerate?.(node.id)}>
                            <Button size="small" type="primary" disabled={cascadeLocked}>
                                启用并生成
                            </Button>
                        </Popconfirm>
                    ) : null}
                    {["empty", "failed"].includes(toonflow.status) ? (
                        <Button
                            size="small"
                            type="primary"
                            disabled={cascadeLocked}
                            onClick={(event) => {
                                event.stopPropagation();
                                onGenerate?.(node.id);
                            }}
                        >
                            生成
                        </Button>
                    ) : null}
                    {toonflow.status === "generating" ? (
                        <Button size="small" type="primary" loading disabled>
                            生成中
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
