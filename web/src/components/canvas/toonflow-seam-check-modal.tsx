import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Empty, Modal } from "antd";
import { ArrowRight } from "lucide-react";

import { extractSegmentFrames, type SegmentFrames } from "@/lib/toonflow/final-cut";
import { isSeamChecked, matchSeamContract, type SeamBoundary, type SeamReview } from "@/lib/toonflow/node-runtime";
import { recommendedSeamEditingMethodNumbers, SEAM_EDITING_METHODS } from "@/lib/toonflow/seam-editing-menu";
import type { DirectingLock, SeamContract } from "@/lib/toonflow/schema";

function ContractRows({ contract }: { contract: SeamContract }) {
    const rows = [
        ["上段末拍", contract.prevEndBeat],
        ["本段首格", contract.nextFirstPanel],
        ["景别/动机", contract.scaleOrMotivation],
        ["声音桥", contract.soundBridge],
        ["音频边界", contract.audioBoundary || "未填写"],
    ];
    return (
        <div className="mt-3 grid gap-1.5 text-xs">
            {rows.map(([label, value]) => (
                <div key={label} className="grid grid-cols-[5.5rem_1fr] gap-2 rounded-md bg-black/[0.035] px-2.5 py-2 dark:bg-white/[0.05]">
                    <span className="font-medium opacity-55">{label}</span>
                    <span className="leading-5 opacity-80">{value}</span>
                </div>
            ))}
        </div>
    );
}

function FrameComparison({ boundary, framesByKey }: { boundary: SeamBoundary; framesByKey: Record<string, SegmentFrames | undefined> }) {
    const fromFrame = framesByKey[boundary.fromVideoKey]?.lastFrame;
    const toFrame = framesByKey[boundary.toVideoKey]?.firstFrame;
    if (!fromFrame || !toFrame) return null;
    return (
        <div className="mt-3 grid grid-cols-2 gap-3">
            <figure className="overflow-hidden rounded-lg border bg-black/80">
                <img src={fromFrame} alt={`${boundary.fromTitle} 尾帧`} className="aspect-video w-full object-contain" />
                <figcaption className="px-2 py-1.5 text-center text-xs text-white/65">上段尾帧</figcaption>
            </figure>
            <figure className="overflow-hidden rounded-lg border bg-black/80">
                <img src={toFrame} alt={`${boundary.toTitle} 首帧`} className="aspect-video w-full object-contain" />
                <figcaption className="px-2 py-1.5 text-center text-xs text-white/65">本段首帧</figcaption>
            </figure>
        </div>
    );
}

export function SeamBoundaryCard({
    boundary,
    contract,
    framesByKey = {},
    checked,
    onToggle,
}: {
    boundary: SeamBoundary;
    contract?: SeamContract;
    framesByKey?: Record<string, SegmentFrames | undefined>;
    checked: boolean;
    onToggle: () => void;
}) {
    const recommended = recommendedSeamEditingMethodNumbers(contract);
    return (
        <div className="rounded-xl border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
                <span className="truncate opacity-80" title={boundary.fromTitle}>{boundary.fromTitle}</span>
                <ArrowRight className="size-4 shrink-0 opacity-45" />
                <span className="truncate opacity-80" title={boundary.toTitle}>{boundary.toTitle}</span>
            </div>
            <FrameComparison boundary={boundary} framesByKey={framesByKey} />
            {contract ? (
                <ContractRows contract={contract} />
            ) : (
                <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    <p className="font-medium">未签合同</p>
                    <p className="mt-1 opacity-80">请回 directing-lock 为 {boundary.fromSegmentId} → {boundary.toSegmentId} 补签五行缝合同。</p>
                </div>
            )}
            <div className="mt-3">
                <p className="text-xs font-medium opacity-55">剪辑手法建议（按“景别/动机”关键词高亮）</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {SEAM_EDITING_METHODS.map((method) => (
                        <span key={method.number} className={`rounded-md border px-2 py-1 text-[11px] ${recommended.has(method.number) ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-current/10 opacity-55"}`} title={`${method.seamTypes.join("、")}：${method.execution}`}>
                            {method.number}. {method.name}
                        </span>
                    ))}
                </div>
            </div>
            <div className="mt-3">
                <Checkbox checked={checked} onChange={onToggle}>本接缝符合合同、连续且无跳变</Checkbox>
            </div>
        </div>
    );
}

export function ToonflowSeamCheckModal({
    open,
    boundaries,
    initialReviews,
    directingLock,
    onSave,
    onCancel,
}: {
    open: boolean;
    boundaries: SeamBoundary[];
    initialReviews: SeamReview[];
    directingLock?: DirectingLock;
    onSave: (reviews: SeamReview[]) => void;
    onCancel: () => void;
}) {
    const initialChecked = useMemo(() => new Set(boundaries.filter((boundary) => isSeamChecked(boundary, initialReviews)).map((boundary) => boundary.key)), [boundaries, initialReviews]);
    const [checked, setChecked] = useState<Set<string>>(initialChecked);
    const [framesByKey, setFramesByKey] = useState<Record<string, SegmentFrames | undefined>>({});

    useEffect(() => {
        if (open) setChecked(new Set(initialChecked));
    }, [open, initialChecked]);

    useEffect(() => {
        if (!open) return;
        let active = true;
        const keys = [...new Set(boundaries.flatMap((boundary) => [boundary.fromVideoKey, boundary.toVideoKey]))];
        setFramesByKey({});
        void Promise.all(keys.map(async (key) => {
            try {
                return [key, await extractSegmentFrames(key)] as const;
            } catch {
                return [key, undefined] as const;
            }
        })).then((entries) => {
            if (active) setFramesByKey(Object.fromEntries(entries));
        });
        return () => {
            active = false;
        };
    }, [open, boundaries]);

    function toggle(key: string) {
        setChecked((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }

    function save() {
        onSave(boundaries.filter((boundary) => checked.has(boundary.key)).map((boundary) => ({ key: boundary.key, fromVersion: boundary.fromVersion, toVersion: boundary.toVersion })));
    }

    const checkedCount = boundaries.filter((boundary) => checked.has(boundary.key)).length;

    return (
        <Modal
            title="核对缝合同"
            open={open}
            width={960}
            onCancel={onCancel}
            footer={[
                <span key="count" className="mr-3 text-xs opacity-55">已勾 {checkedCount} / {boundaries.length} 个接缝</span>,
                <Button key="cancel" onClick={onCancel}>取消</Button>,
                <Button key="save" type="primary" disabled={!boundaries.length} onClick={save}>保存（全勾即通过）</Button>,
            ]}
        >
            <p className="text-sm leading-6 opacity-70">逐边界对照上段尾帧、本段首帧与 directing-lock 五行缝合同。Agent 或 ffmpeg 不可用时仅隐藏抽帧，合同核对与勾选仍可继续。</p>
            {boundaries.length ? (
                <div className="mt-4 max-h-[65vh] space-y-4 overflow-y-auto pr-1">
                    {boundaries.map((boundary) => (
                        <SeamBoundaryCard
                            key={boundary.key}
                            boundary={boundary}
                            contract={matchSeamContract(boundary, directingLock)}
                            framesByKey={framesByKey}
                            checked={checked.has(boundary.key)}
                            onToggle={() => toggle(boundary.key)}
                        />
                    ))}
                </div>
            ) : (
                <div className="py-8"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="至少需要 2 段已通过的视频才有接缝可检" /></div>
            )}
        </Modal>
    );
}
