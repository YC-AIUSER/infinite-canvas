import { useEffect, useMemo, useState } from "react";
import { Checkbox, Input, Select } from "antd";

import { audioVoiceOptions } from "@/lib/audio-generation";
import { buildDubbingPlan, emptyQualityReview, QUALITY_REVIEW_LABELS } from "@/lib/toonflow/node-runtime";
import { QUALITY_REVIEW_KEYS, type DubbingTrack, type QualityReview, type QualityReviewItem, type StoryboardRow } from "@/lib/toonflow/schema";
import { resolveMediaUrl } from "@/services/file-storage";

const severityOptions = [
    { value: "P0", label: "P0 阻断交付" },
    { value: "P1", label: "P1 影响观看" },
    { value: "P2", label: "P2 建议优化" },
];

function normalizedReview(review?: QualityReview): QualityReview {
    const itemByKey = new Map(review?.items.map((item) => [item.key, item]));
    return { items: QUALITY_REVIEW_KEYS.map((key) => itemByKey.get(key) ?? emptyQualityReview().items.find((item) => item.key === key)!) };
}

export function ToonflowSegmentQualityReview({ review, background, blockReason, onChange }: { review?: QualityReview; background: string; blockReason?: string; onChange: (review: QualityReview) => void }) {
    const normalized = normalizedReview(review);
    const checkedCount = normalized.items.filter((item) => item.checked).length;
    const p0Count = normalized.items.filter((item) => item.severity === "P0").length;

    function update(key: QualityReviewItem["key"], patch: Partial<QualityReviewItem>) {
        onChange({ items: normalized.items.map((item) => (item.key === key ? { ...item, ...patch } : item)) });
    }

    return (
        <details className="mt-2 rounded-md px-2.5 py-2 text-xs" style={{ background }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <summary className="cursor-pointer select-none font-medium">
                七项质检 · {checkedCount}/7 已查{p0Count ? ` · ${p0Count} 项 P0 未清` : ""}
            </summary>
            {blockReason ? <p className="mt-1.5 text-amber-600 dark:text-amber-300">暂不可通过：{blockReason}</p> : null}
            <div data-canvas-scrollable className="mt-2 max-h-52 space-y-2 overflow-y-auto pr-1">
                {normalized.items.map((item) => (
                    <div key={item.key} className="rounded-md border border-current/10 p-2">
                        <div className="flex items-center justify-between gap-2">
                            <Checkbox checked={item.checked} onChange={(event) => update(item.key, { checked: event.target.checked })}>
                                {QUALITY_REVIEW_LABELS[item.key]}
                            </Checkbox>
                            <Select
                                size="small"
                                allowClear
                                className="w-32"
                                placeholder="无问题"
                                value={item.severity}
                                options={severityOptions}
                                onChange={(severity) => update(item.key, { severity })}
                            />
                        </div>
                        <Input size="small" className="mt-1.5" placeholder="短备注（可选）" value={item.note ?? ""} onChange={(event) => update(item.key, { note: event.target.value || undefined })} />
                    </div>
                ))}
            </div>
        </details>
    );
}

function AudioTrackPreview({ track }: { track: DubbingTrack }) {
    const [url, setUrl] = useState("");
    useEffect(() => {
        let active = true;
        void resolveMediaUrl(track.audioKey).then((value) => {
            if (active) setUrl(value);
        });
        return () => {
            active = false;
        };
    }, [track.audioKey]);

    return (
        <div className="rounded-md border border-current/10 p-2">
            <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{track.type === "os" ? "OS" : "对白"} · {track.speaker}</span>
                <span className="shrink-0 opacity-55">{track.plannedOffsetSec.toFixed(1)}s · {track.voice}</span>
            </div>
            <p className="mt-1 line-clamp-2 opacity-70">{track.text}</p>
            {url ? <audio className="mt-1.5 h-7 w-full" src={url} controls preload="metadata" /> : <span className="mt-1 block opacity-45">音频加载中…</span>}
        </div>
    );
}

export function ToonflowAudioMixPanel({
    rows,
    voiceMap,
    dubbing,
    background,
    onVoiceMapChange,
}: {
    rows: StoryboardRow[];
    voiceMap: Record<string, string>;
    dubbing: DubbingTrack[];
    background: string;
    onVoiceMapChange: (voiceMap: Record<string, string>) => void;
}) {
    const plan = useMemo(() => buildDubbingPlan(rows, voiceMap), [rows, voiceMap]);
    const roles = useMemo(() => {
        const values = new Set(plan.map((item) => item.speaker));
        if (plan.some((item) => item.type === "os")) values.add("旁白");
        return [...values];
    }, [plan]);

    return (
        <div data-canvas-scrollable className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-md px-2.5 py-2 text-xs" style={{ background }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <details open>
                <summary className="cursor-pointer select-none font-medium">角色音色 · {roles.length} 项</summary>
                <div className="mt-2 space-y-1.5">
                    {roles.map((role) => (
                        <label key={role} className="flex items-center gap-2">
                            <span className="w-16 shrink-0 truncate" title={role}>{role}</span>
                            <Select
                                size="small"
                                className="min-w-0 flex-1"
                                options={audioVoiceOptions}
                                placeholder="默认 Alloy"
                                value={voiceMap[role]}
                                onChange={(voice) => onVoiceMapChange({ ...voiceMap, [role]: voice })}
                            />
                        </label>
                    ))}
                    {!roles.length ? <p className="opacity-55">本段没有对白或 OS，无需生成配音。</p> : null}
                    {plan.some((item) => item.type === "os") ? <p className="opacity-50">OS 角色未单独配置时，使用“旁白”音色兜底。</p> : null}
                </div>
            </details>
            <details className="mt-2" open={Boolean(dubbing.length)}>
                <summary className="cursor-pointer select-none font-medium">配音轨 · {dubbing.length || plan.length} 句</summary>
                <div className="mt-2 space-y-2">
                    {dubbing.length ? dubbing.map((track) => <AudioTrackPreview key={`${track.shotId}-${track.plannedOffsetSec}`} track={track} />) : plan.map((item) => (
                        <div key={`${item.shotId}-${item.plannedOffsetSec}`} className="rounded-md border border-dashed border-current/15 px-2 py-1.5 opacity-65">
                            {item.type === "os" ? "OS" : "对白"} · {item.speaker} · {item.plannedOffsetSec.toFixed(1)}s · 待生成
                        </div>
                    ))}
                </div>
            </details>
        </div>
    );
}
