import { useEffect, useState } from "react";
import { Button, Empty, Modal } from "antd";

import type { NodeOutput } from "@/lib/toonflow/schema";
import { resolveImageUrl } from "@/services/image-storage";
import type { CanvasNodeData } from "@/types/canvas";

function outputText(output: NodeOutput | undefined) {
    if (!output) return "";
    if (typeof output.payload.text === "string") return output.payload.text;
    if (output.payload.table) return JSON.stringify(output.payload.table, null, 2);
    return "";
}

function VersionImage({ storageKey, alt, className }: { storageKey: string; alt: string; className: string }) {
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

    return url ? <img src={url} alt={alt} className={className} /> : null;
}

export function ToonflowHistoryModal({ open, node, onRollback, onCancel }: { open: boolean; node: CanvasNodeData | null; onRollback: (nodeId: string, version: number) => void; onCancel: () => void }) {
    const toonflow = node?.metadata?.toonflow;
    const current = toonflow?.output;
    const currentText = outputText(current);
    const currentImageKeys = current?.payload.imageKeys ?? [];
    const history = [...(toonflow?.history ?? [])].reverse();

    return (
        <Modal title={`版本历史${node?.title ? `：${node.title}` : ""}`} open={open} footer={null} width={760} onCancel={onCancel}>
            <div className="text-xs font-medium opacity-55">当前版本{current ? ` v${current.version}` : ""}</div>
            {currentText ? (
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border p-3 text-sm leading-6">{currentText}</pre>
            ) : currentImageKeys.length ? (
                <div className="mt-2 flex max-h-56 items-center justify-center overflow-hidden rounded-lg border p-2">
                    <VersionImage storageKey={currentImageKeys[0]} alt={`${node?.title ?? "当前版本"} v${current?.version ?? ""}`} className="max-h-52 w-full object-contain" />
                </div>
            ) : (
                <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border p-3 text-sm leading-6">暂无正文</pre>
            )}
            <div className="mt-5 text-xs font-medium opacity-55">历史版本</div>
            {history.length ? (
                <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
                    {history.map((output) => {
                        const text = outputText(output).replace(/\s+/g, " ").trim();
                        const imageKeys = output.payload.imageKeys ?? [];
                        return (
                            <div key={`${output.version}-${output.generatedAt}`} className="flex items-start gap-3 rounded-lg border p-3">
                                {imageKeys.length ? (
                                    <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md border">
                                        <VersionImage storageKey={imageKeys[0]} alt={`v${output.version}`} className="h-full w-full object-contain" />
                                    </div>
                                ) : null}
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 text-xs">
                                        <span className="font-semibold">v{output.version}</span>
                                        <span className="truncate opacity-50" title={output.generatedAt}>
                                            {output.generatedAt}
                                        </span>
                                    </div>
                                    <p className="mt-1 line-clamp-2 text-sm opacity-75">{text.slice(0, 80) || (imageKeys.length ? `图像版本 · ${imageKeys.length} 张` : "无正文")}</p>
                                </div>
                                <Button size="small" onClick={() => node && onRollback(node.id, output.version)}>
                                    回退到此版
                                </Button>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无历史版本" />
            )}
        </Modal>
    );
}
