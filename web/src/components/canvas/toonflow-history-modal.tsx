import { Button, Empty, Modal } from "antd";

import type { NodeOutput } from "@/lib/toonflow/schema";
import type { CanvasNodeData } from "@/types/canvas";

function outputText(output: NodeOutput | undefined) {
    if (!output) return "";
    if (typeof output.payload.text === "string") return output.payload.text;
    if (output.payload.table) return JSON.stringify(output.payload.table, null, 2);
    return "";
}

export function ToonflowHistoryModal({ open, node, onRollback, onCancel }: { open: boolean; node: CanvasNodeData | null; onRollback: (nodeId: string, version: number) => void; onCancel: () => void }) {
    const toonflow = node?.metadata?.toonflow;
    const current = toonflow?.output;
    const history = [...(toonflow?.history ?? [])].reverse();

    return (
        <Modal title={`版本历史${node?.title ? `：${node.title}` : ""}`} open={open} footer={null} width={760} onCancel={onCancel}>
            <div className="text-xs font-medium opacity-55">当前版本{current ? ` v${current.version}` : ""}</div>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border p-3 text-sm leading-6">{outputText(current) || "暂无正文"}</pre>
            <div className="mt-5 text-xs font-medium opacity-55">历史版本</div>
            {history.length ? (
                <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
                    {history.map((output) => {
                        const text = outputText(output).replace(/\s+/g, " ").trim();
                        return (
                            <div key={`${output.version}-${output.generatedAt}`} className="flex items-start gap-3 rounded-lg border p-3">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 text-xs">
                                        <span className="font-semibold">v{output.version}</span>
                                        <span className="truncate opacity-50" title={output.generatedAt}>
                                            {output.generatedAt}
                                        </span>
                                    </div>
                                    <p className="mt-1 line-clamp-2 text-sm opacity-75">{text.slice(0, 80) || "无正文"}</p>
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
