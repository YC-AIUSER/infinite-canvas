import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, Empty, Modal } from "antd";
import { ArrowRight } from "lucide-react";

import type { SeamBoundary, SeamReview } from "@/lib/toonflow/node-runtime";
import { isSeamChecked } from "@/lib/toonflow/node-runtime";
import { resolveMediaUrl } from "@/services/file-storage";

function SeamVideo({ storageKey, label }: { storageKey: string; label: string }) {
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
        <div className="flex aspect-video min-w-0 flex-1 items-center justify-center overflow-hidden rounded-lg border bg-black/80">
            {url ? <video src={url} aria-label={label} controls muted playsInline preload="metadata" className="h-full w-full object-contain" /> : <span className="text-xs text-white/60">加载中…</span>}
        </div>
    );
}

export function ToonflowSeamCheckModal({
    open,
    boundaries,
    initialReviews,
    onSave,
    onCancel,
}: {
    open: boolean;
    boundaries: SeamBoundary[];
    initialReviews: SeamReview[];
    onSave: (reviews: SeamReview[]) => void;
    onCancel: () => void;
}) {
    // 初始勾选:已检记录中 key+双方版本都匹配当前边界的,视为已勾。
    const initialChecked = useMemo(() => new Set(boundaries.filter((boundary) => isSeamChecked(boundary, initialReviews)).map((boundary) => boundary.key)), [boundaries, initialReviews]);
    const [checked, setChecked] = useState<Set<string>>(initialChecked);

    // 每次打开(或边界/初值变化)以持久化状态重置本地勾选。
    useEffect(() => {
        if (open) setChecked(new Set(initialChecked));
    }, [open, initialChecked]);

    function toggle(key: string) {
        setChecked((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }

    function save() {
        const reviews: SeamReview[] = boundaries.filter((boundary) => checked.has(boundary.key)).map((boundary) => ({ key: boundary.key, fromVersion: boundary.fromVersion, toVersion: boundary.toVersion }));
        onSave(reviews);
    }

    const checkedCount = boundaries.filter((boundary) => checked.has(boundary.key)).length;

    return (
        <Modal
            title="接缝检查（相邻段连续性）"
            open={open}
            width={900}
            onCancel={onCancel}
            footer={[
                <span key="count" className="mr-3 text-xs opacity-55">
                    已勾 {checkedCount} / {boundaries.length} 个接缝
                </span>,
                <Button key="cancel" onClick={onCancel}>
                    取消
                </Button>,
                <Button key="save" type="primary" disabled={!boundaries.length} onClick={save}>
                    保存（全勾即通过）
                </Button>,
            ]}
        >
            <p className="text-sm leading-6 opacity-70">逐个查看相邻两段的尾首衔接：动作尾首是否顺、角色方向是否连续、画面是否不跳。确认无问题就勾选；不调 AI，人工判定。</p>
            {boundaries.length ? (
                <div className="mt-4 max-h-[60vh] space-y-4 overflow-y-auto pr-1">
                    {boundaries.map((boundary) => (
                        <div key={boundary.key} className="rounded-xl border p-3">
                            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                                <span className="truncate opacity-80" title={boundary.fromTitle}>
                                    {boundary.fromTitle}
                                </span>
                                <ArrowRight className="size-4 shrink-0 opacity-45" />
                                <span className="truncate opacity-80" title={boundary.toTitle}>
                                    {boundary.toTitle}
                                </span>
                            </div>
                            <div className="flex gap-3">
                                <SeamVideo storageKey={boundary.fromVideoKey} label={`${boundary.fromTitle}（尾）`} />
                                <SeamVideo storageKey={boundary.toVideoKey} label={`${boundary.toTitle}（首）`} />
                            </div>
                            <div className="mt-2.5">
                                <Checkbox checked={checked.has(boundary.key)} onChange={() => toggle(boundary.key)}>
                                    本接缝连续、无跳变
                                </Checkbox>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="py-8">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="至少需要 2 段已通过的视频才有接缝可检" />
                </div>
            )}
        </Modal>
    );
}
