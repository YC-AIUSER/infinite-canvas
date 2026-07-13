import { useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Modal } from "antd";
import { Download, Package, Play } from "lucide-react";
import { saveAs } from "file-saver";
import JSZip from "jszip";

import type { ExportCollection, ExportSegment } from "@/lib/toonflow/node-runtime";
import { getMediaBlob, resolveMediaUrl } from "@/services/file-storage";

// 文件名安全化:去掉 Windows/Unix 都禁止的字符,避免下载/打包时非法名。
function safeName(name: string) {
    return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "段视频";
}

function segmentFileName(segment: ExportSegment, order: number) {
    return `${String(order).padStart(2, "0")}-${safeName(segment.title)}.mp4`;
}

export function ToonflowExportModal({ open, collection, onCancel }: { open: boolean; collection: ExportCollection | null; onCancel: () => void }) {
    const { message } = App.useApp();
    const segments = useMemo(() => collection?.segments ?? [], [collection]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [playerUrl, setPlayerUrl] = useState("");
    const [playerMissing, setPlayerMissing] = useState(false);
    const [zipping, setZipping] = useState(false);
    const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

    // 越界兜底:段集收缩后 currentIndex 停在旧值时钳到最后一段,不整体重置(见下方重置 effect 只认 open 上升沿)。
    const clampedIndex = segments.length ? Math.min(currentIndex, segments.length - 1) : 0;
    const currentSegment = segments[clampedIndex];
    const currentKey = currentSegment?.videoKey ?? "";

    // 仅在打开(上升沿)时回到第一段;段集因无关 nodes 变更换身份时不打断正在预览的段。
    useEffect(() => {
        if (open) setCurrentIndex(0);
    }, [open]);

    // 按当前段的 videoKey 解析可播放 URL:依赖 key 而非 collection/segments 身份,避免后台 setNodes 导致的闪烁重载。
    useEffect(() => {
        if (!open || !currentKey) {
            setPlayerUrl("");
            setPlayerMissing(false);
            return;
        }
        let active = true;
        setPlayerUrl("");
        setPlayerMissing(false);
        void resolveMediaUrl(currentKey).then(
            (url) => {
                if (!active) return;
                setPlayerUrl(url);
                setPlayerMissing(!url);
            },
            () => {
                if (!active) return;
                setPlayerUrl("");
                setPlayerMissing(true);
            },
        );
        return () => {
            active = false;
        };
    }, [open, currentKey]);

    async function downloadSegment(segment: ExportSegment, order: number) {
        setDownloadingKey(segment.videoKey);
        try {
            const blob = await getMediaBlob(segment.videoKey);
            if (!blob) {
                message.error(`「${segment.title}」的视频数据缺失，无法下载`);
                return;
            }
            saveAs(blob, segmentFileName(segment, order));
        } catch {
            message.error("下载失败，请重试");
        } finally {
            setDownloadingKey(null);
        }
    }

    async function downloadZip() {
        if (!segments.length) return;
        setZipping(true);
        try {
            const zip = new JSZip();
            let missing = 0;
            for (const [index, segment] of segments.entries()) {
                const blob = await getMediaBlob(segment.videoKey);
                if (!blob) {
                    missing += 1;
                    continue;
                }
                zip.file(segmentFileName(segment, index + 1), blob);
            }
            if (!Object.keys(zip.files).length) {
                message.error("所有段视频数据均缺失，无法打包");
                return;
            }
            const archive = await zip.generateAsync({ type: "blob" });
            saveAs(archive, "toonflow-成片-分段.zip");
            if (missing) message.warning(`已打包 ${segments.length - missing} 段，${missing} 段视频数据缺失被跳过`);
        } catch {
            message.error("打包失败，请重试");
        } finally {
            setZipping(false);
        }
    }

    const totalSegments = collection?.totalSegments ?? 0;

    return (
        <Modal title="成片预览与导出" open={open} footer={null} width={860} onCancel={onCancel}>
            <p className="text-sm leading-6 opacity-70">
                本期交付为<b>分段视频</b>（已通过 {segments.length} / {totalSegments} 段），可顺序预览、逐段下载或打包 ZIP。
                <span className="opacity-80">本期不拼接成单文件</span>（成片拼接为二期能力）。
            </p>

            {segments.length ? (
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[1.6fr_1fr]">
                    <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-black/5">
                        <div className="flex aspect-video items-center justify-center overflow-hidden bg-black/80">
                            {playerUrl ? (
                                <video
                                    key={currentKey}
                                    src={playerUrl}
                                    controls
                                    autoPlay
                                    playsInline
                                    preload="metadata"
                                    className="h-full w-full object-contain"
                                    onEnded={() =>
                                        setCurrentIndex((index) => {
                                            const base = Math.min(index, segments.length - 1);
                                            return base + 1 < segments.length ? base + 1 : base;
                                        })
                                    }
                                />
                            ) : (
                                <span className="text-xs text-white/60">{playerMissing ? "该段视频数据缺失" : "加载视频中…"}</span>
                            )}
                        </div>
                        <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                            <span className="truncate font-medium opacity-75" title={currentSegment?.title}>
                                正在预览：{currentSegment?.title ?? "—"}
                            </span>
                            <span className="shrink-0 opacity-45">
                                第 {clampedIndex + 1} / {segments.length} 段
                            </span>
                        </div>
                    </div>

                    <div className="flex min-h-0 flex-col">
                        <div className="mb-2 flex items-center justify-between">
                            <span className="text-xs font-medium opacity-55">段列表（点击跳播）</span>
                            <Button type="primary" size="small" icon={<Package className="size-3.5" />} loading={zipping} onClick={() => void downloadZip()}>
                                打包下载 ZIP
                            </Button>
                        </div>
                        <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
                            {segments.map((segment, index) => {
                                const active = index === clampedIndex;
                                return (
                                    <div
                                        key={segment.segmentId}
                                        className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm transition-colors ${active ? "border-indigo-400 bg-indigo-500/10" : "hover:bg-black/[0.03]"}`}
                                    >
                                        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setCurrentIndex(index)}>
                                            {active ? <Play className="size-3.5 shrink-0 text-indigo-500" /> : <span className="w-3.5 shrink-0 text-center text-xs opacity-40">{index + 1}</span>}
                                            <span className="truncate" title={segment.title}>
                                                {segment.title}
                                            </span>
                                            <span className="shrink-0 text-[11px] opacity-40">v{segment.version}</span>
                                        </button>
                                        <Button
                                            size="small"
                                            type="text"
                                            icon={<Download className="size-3.5" />}
                                            loading={downloadingKey === segment.videoKey}
                                            onClick={() => void downloadSegment(segment, index + 1)}
                                            aria-label={`下载 ${segment.title}`}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="py-8">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={totalSegments ? `${totalSegments} 段视频尚未通过，先在视频工作台逐段验收` : "还没有可导出的段视频"} />
                </div>
            )}
        </Modal>
    );
}
