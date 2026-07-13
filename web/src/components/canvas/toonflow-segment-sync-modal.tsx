import { Modal, Tag, theme } from "antd";

import type { InstanceSyncPlan } from "@/lib/toonflow/instances";
import type { CanvasNodeData } from "@/types/canvas";

type ToonflowSegmentSyncModalProps = {
    open: boolean;
    plan: InstanceSyncPlan | null;
    nodes: CanvasNodeData[];
    onConfirm: () => void;
    onCancel: () => void;
};

export function ToonflowSegmentSyncModal({ open, plan, nodes, onConfirm, onCancel }: ToonflowSegmentSyncModalProps) {
    const { token } = theme.useToken();
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const addedSegmentIds = new Set(plan?.toCreate.map((item) => item.segmentId) ?? []);
    const addedSegments = plan?.segments.filter((segment) => addedSegmentIds.has(segment.segmentId)) ?? [];
    const archivedSegments = [...new Map(
        (plan?.toArchive ?? []).flatMap((nodeId) => {
            const toonflow = nodeById.get(nodeId)?.metadata?.toonflow;
            return toonflow?.segmentId ? [[toonflow.segmentId, toonflow.segmentIndex ?? 0] as const] : [];
        }),
    )];
    const reindexedSegments = [...new Map(
        (plan?.reindex ?? []).flatMap(({ nodeId, segmentIndex }) => {
            const toonflow = nodeById.get(nodeId)?.metadata?.toonflow;
            return toonflow?.segmentId ? [[toonflow.segmentId, { from: toonflow.segmentIndex ?? 0, to: segmentIndex }] as const] : [];
        }),
    )];

    return (
        <Modal title="同步分段实例" open={open} centered okText="确认同步" cancelText="取消" onOk={onConfirm} onCancel={onCancel}>
            <p className="mb-4 text-sm" style={{ color: token.colorTextSecondary }}>
                分镜表的段结构已变化。确认后会更新故事板页、首帧与视频实例，已有产物不会被删除。
            </p>
            <div className="space-y-4">
                {addedSegments.length ? (
                    <section>
                        <h4 className="mb-2 text-sm font-medium">新增段</h4>
                        <div className="flex flex-wrap gap-2">
                            {addedSegments.map((segment) => (
                                <Tag key={segment.segmentId} color="green">
                                    段{segment.segmentIndex + 1} · {segment.shotCount} 镜
                                </Tag>
                            ))}
                        </div>
                    </section>
                ) : null}
                {archivedSegments.length ? (
                    <section>
                        <h4 className="mb-2 text-sm font-medium">消失段</h4>
                        <div className="flex flex-wrap gap-2">
                            {archivedSegments.map(([segmentId, segmentIndex]) => (
                                <Tag key={segmentId} color="orange">
                                    段{segmentIndex + 1} · 将归档，产物保留
                                </Tag>
                            ))}
                        </div>
                    </section>
                ) : null}
                {reindexedSegments.length ? (
                    <section>
                        <h4 className="mb-2 text-sm font-medium">顺序变化</h4>
                        <div className="flex flex-wrap gap-2">
                            {reindexedSegments.map(([segmentId, index]) => (
                                <Tag key={segmentId}>
                                    段{index.from + 1} → 段{index.to + 1}
                                </Tag>
                            ))}
                        </div>
                    </section>
                ) : null}
            </div>
        </Modal>
    );
}
