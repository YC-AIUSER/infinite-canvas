import { useEffect, useState } from "react";
import { Button, Popconfirm } from "antd";
import { AlertTriangle, CheckCircle2, ChevronRight, CircleDashed, Clock3 } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { resolveMediaUrl } from "@/services/file-storage";
import { resolveImageUrl } from "@/services/image-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, ToonflowNodeStageStatus } from "@/types/canvas";

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

const actionableKinds = new Set(["script", "space-contract", "storyboard-table", "shot-contract", "action-contract"]);

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
    onOpenAssetCards?: (nodeId: string) => void;
    onAdopt?: (nodeId: string) => void;
    onDeleteArchived?: (nodeId: string) => void;
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

export function ToonflowNodeContent({ node, cascadeLocked = false, onGenerate, onRegenerate, onApprove, onEdit, onCascade, onHistory, onRepair, onOpenAssetCards, onAdopt, onDeleteArchived, batchCount = 0, batchExpanded = false, onToggleBatch }: ToonflowNodeContentProps) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const toonflow = node.metadata?.toonflow;
    if (!toonflow) return null;

    const accent = toonflow.accent || theme.node.activeStroke;
    const statusColor = statusTone[toonflow.status] || theme.node.muted;
    const isActionable = actionableKinds.has(toonflow.kind);
    const isInstance = (toonflow.kind === "storyboard-page" || toonflow.kind === "keyframes" || toonflow.kind === "video-workbench") && Boolean(toonflow.segmentId);
    const instanceImageKey = toonflow.output?.payload.imageKeys?.[0];
    const instanceVideoKey = toonflow.output?.payload.videoKeys?.[0];
    const generationKindLabel = toonflow.kind === "video-workbench" ? "视频" : "图像";
    const error = toonflow.output?.error || node.metadata?.errorDetails;
    const washHits = toonflow.washReport?.hits || [];
    const assetCards = toonflow.output?.payload.cards;
    const assetCardSummary = assetCards?.length
        ? assetCards.reduce(
              (summary, card) => {
                  summary[card.cardType] += 1;
                  return summary;
              },
              { character: 0, scene: 0, prop: 0, action: 0, expression: 0, outfit: 0, form: 0 },
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
                        {statusLabel[toonflow.status]}
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
                </p>
            ) : null}

            {toonflow.status === "failed" && error ? (
                <p className="mt-1 line-clamp-1 text-xs" style={{ color: statusColor }} title={error}>
                    {error}
                </p>
            ) : null}
            {toonflow.status === "stale" ? (
                <div className="mt-1 flex items-center gap-1 text-xs font-medium" style={{ color: statusColor }}>
                    <AlertTriangle className="size-3.5" />
                    <span>上游已更新，请重新生成</span>
                </div>
            ) : null}

            {toonflow.kind === "compliance" ? (
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

            {!isActionable && toonflow.kind !== "compliance" && toonflow.outputs?.length ? (
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
                            定点修
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
