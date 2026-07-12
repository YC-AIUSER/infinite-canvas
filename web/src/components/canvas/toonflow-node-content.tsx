import { Button } from "antd";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock3 } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
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

export function ToonflowNodeContent({ node, onGenerate, onApprove }: { node: CanvasNodeData; onGenerate?: (nodeId: string) => void; onApprove?: (nodeId: string) => void }) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const toonflow = node.metadata?.toonflow;
    if (!toonflow) return null;

    const accent = toonflow.accent || theme.node.activeStroke;
    const statusColor = statusTone[toonflow.status] || theme.node.muted;
    const isActionable = actionableKinds.has(toonflow.kind);
    const error = toonflow.output?.error || node.metadata?.errorDetails;
    const washHits = toonflow.washReport?.hits || [];

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
                    {toonflow.output && toonflow.output.version > 0 ? <span className="text-[11px] font-medium opacity-45">v{toonflow.output.version}</span> : null}
                    <span className="rounded-md px-2 py-1 text-xs font-medium" style={{ background: `${statusColor}18`, color: statusColor }}>
                        {statusLabel[toonflow.status]}
                    </span>
                </div>
            </div>

            <p className="mt-2 line-clamp-1 text-sm leading-5 opacity-70">{toonflow.summary}</p>

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

            {isActionable && ["empty", "failed", "stale", "review", "generating"].includes(toonflow.status) ? (
                <div className="mt-2 flex justify-end gap-2" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    {toonflow.status === "review" ? (
                        <Button
                            size="small"
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
                            onClick={(event) => {
                                event.stopPropagation();
                                onGenerate?.(node.id);
                            }}
                        >
                            重生成
                        </Button>
                    ) : null}
                    {["empty", "failed", "stale"].includes(toonflow.status) ? (
                        <Button
                            size="small"
                            type="primary"
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
