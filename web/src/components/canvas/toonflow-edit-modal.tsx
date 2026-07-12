import { useEffect, useState } from "react";
import { Input, Modal } from "antd";

import type { CanvasNodeData } from "@/types/canvas";

export function ToonflowEditModal({ open, node, onSave, onCancel }: { open: boolean; node: CanvasNodeData | null; onSave: (nodeId: string, text: string) => void; onCancel: () => void }) {
    const text = node?.metadata?.toonflow?.output?.payload.text ?? "";
    const [value, setValue] = useState(text);

    useEffect(() => {
        if (open) setValue(text);
    }, [open, text]);

    return (
        <Modal
            title={`编辑${node?.title ? `：${node.title}` : "节点"}`}
            open={open}
            okText="保存"
            cancelText="取消"
            width={720}
            onCancel={onCancel}
            onOk={() => {
                if (node) onSave(node.id, value);
            }}
        >
            <Input.TextArea value={value} autoSize={{ minRows: 14, maxRows: 24 }} onChange={(event) => setValue(event.target.value)} placeholder="请输入节点正文" />
        </Modal>
    );
}
