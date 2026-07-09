import { CheckCircle2, CircleDashed, Clock3 } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, ToonflowNodeStageStatus } from "@/types/canvas";

const statusTone: Record<ToonflowNodeStageStatus, string> = {
    未开始: "#78716c",
    待生成: "#2563eb",
    生成中: "#ca8a04",
    生成失败: "#dc2626",
    待验收: "#9333ea",
    已通过: "#16a34a",
    已跳过: "#64748b",
};

export function ToonflowNodeContent({ node }: { node: CanvasNodeData }) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const toonflow = node.metadata?.toonflow;
    if (!toonflow) return null;

    const accent = toonflow.accent || theme.node.activeStroke;
    const statusColor = statusTone[toonflow.status] || theme.node.muted;

    return (
        <div className="flex h-full w-full flex-col overflow-hidden p-4" style={{ color: theme.node.text }}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: accent }} />
                        <span className="truncate text-xs font-medium opacity-55">{toonflow.stage}</span>
                    </div>
                    <h3 className="mt-1 truncate text-lg font-semibold leading-6">{node.title}</h3>
                </div>
                <span className="shrink-0 rounded-md px-2 py-1 text-xs font-medium" style={{ background: `${statusColor}18`, color: statusColor }}>
                    {toonflow.status}
                </span>
            </div>

            <p className="mt-3 line-clamp-2 text-sm leading-5 opacity-70">{toonflow.summary}</p>

            <div className="mt-3 grid min-h-0 flex-1 grid-cols-1 gap-1.5">
                {toonflow.checks.slice(0, 3).map((item) => (
                    <div key={item} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-xs" style={{ background: theme.node.fill }}>
                        {toonflow.status === "已通过" ? <CheckCircle2 className="size-3.5 shrink-0" style={{ color: statusColor }} /> : toonflow.status === "待生成" ? <Clock3 className="size-3.5 shrink-0" style={{ color: statusColor }} /> : <CircleDashed className="size-3.5 shrink-0 opacity-45" />}
                        <span className="truncate opacity-75">{item}</span>
                    </div>
                ))}
            </div>

            {toonflow.outputs?.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {toonflow.outputs.slice(0, 2).map((item) => (
                        <span key={item} className="rounded-md px-2 py-1 text-[11px] font-medium" style={{ background: `${accent}16`, color: accent }}>
                            {item}
                        </span>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
