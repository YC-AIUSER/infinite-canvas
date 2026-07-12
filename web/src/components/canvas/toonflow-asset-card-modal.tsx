import { useEffect, useMemo, useState } from "react";
import { App, Button, Dropdown, Empty, Input, Modal, Popconfirm, Select, Tag, Upload, theme } from "antd";
import { ImageIcon, ImagePlus, Pencil, Plus, Trash2, UploadIcon } from "lucide-react";
import { nanoid } from "nanoid";

import { parseEntityHints } from "@/lib/toonflow/node-runtime";
import { validateAssetCards, type AssetCard } from "@/lib/toonflow/schema";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import type { CanvasNodeData } from "@/types/canvas";

const CARD_TYPE_LABELS: Record<AssetCard["cardType"], string> = {
    character: "角色",
    scene: "场景",
    prop: "道具",
    action: "动作",
    expression: "表情",
};

const CARD_TYPE_COLORS: Record<AssetCard["cardType"], string> = {
    character: "blue",
    scene: "green",
    prop: "orange",
    action: "purple",
    expression: "cyan",
};

type ToonflowAssetCardModalProps = {
    open: boolean;
    node: CanvasNodeData | null;
    scriptText: string;
    onSave: (nodeId: string, cards: AssetCard[]) => void;
    onGenerateCard: (nodeId: string, card: AssetCard, allCards: AssetCard[]) => Promise<string | undefined>;
    onCancel: () => void;
};

function AssetCardImage({ storageKey, name }: { storageKey?: string; name: string }) {
    const { token } = theme.useToken();
    const [url, setUrl] = useState("");

    useEffect(() => {
        let active = true;
        if (!storageKey) {
            setUrl("");
            return () => {
                active = false;
            };
        }
        void resolveImageUrl(storageKey).then((resolved) => {
            if (active) setUrl(resolved);
        });
        return () => {
            active = false;
        };
    }, [storageKey]);

    return url ? (
        <img src={url} alt={name} className="h-full w-full object-contain" />
    ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-xs" style={{ color: token.colorTextQuaternary }}>
            <ImageIcon className="size-7" />
            <span>暂无锚点图</span>
        </div>
    );
}

function extractEntityListText(scriptText: string) {
    const lines = scriptText.split(/\r?\n/);
    const result: string[] = [];
    let collecting = false;
    for (const line of lines) {
        const isTargetTitle = line.includes("角色实体清单") || line.includes("道具实体清单");
        if (isTargetTitle) collecting = true;
        else if (collecting && line.includes("清单")) collecting = false;
        if (collecting) result.push(line);
    }
    if (result.length) return result.join("\n").trim();
    const fallbackStart = lines.findIndex((line) => line.includes("实体清单"));
    return fallbackStart >= 0 ? lines.slice(fallbackStart).join("\n").trim() : "";
}

export function ToonflowAssetCardModal({ open, node, scriptText, onSave, onGenerateCard, onCancel }: ToonflowAssetCardModalProps) {
    const { message } = App.useApp();
    const { token } = theme.useToken();
    const [cards, setCards] = useState<AssetCard[]>([]);
    const [draft, setDraft] = useState<AssetCard | null>(null);
    const [editingCardId, setEditingCardId] = useState<string | null>(null);
    const [generatingCardIds, setGeneratingCardIds] = useState<Set<string>>(new Set());
    const [uploadingCardIds, setUploadingCardIds] = useState<Set<string>>(new Set());
    const hints = useMemo(() => parseEntityHints(scriptText), [scriptText]);
    const entityListText = useMemo(() => extractEntityListText(scriptText), [scriptText]);

    useEffect(() => {
        if (!open) return;
        setCards(node?.metadata?.toonflow?.output?.payload.cards?.map((card) => ({ ...card })) ?? []);
        setDraft(null);
        setEditingCardId(null);
        setGeneratingCardIds(new Set());
        setUploadingCardIds(new Set());
    }, [open, node?.id]);

    const parentCards = cards.filter((card) => card.cardType === "character");
    const parentNameById = new Map(cards.map((card) => [card.cardId, card.name]));
    const cardGroups = [
        { key: "base", label: "基础卡", cards: cards.filter((card) => card.cardType !== "action" && card.cardType !== "expression") },
        { key: "derived", label: "衍生卡", cards: cards.filter((card) => card.cardType === "action" || card.cardType === "expression") },
    ].filter((group) => group.cards.length);

    const startNewCard = (preset?: Partial<Pick<AssetCard, "cardType" | "name" | "anchor" | "parentCardId">>) => {
        setEditingCardId(null);
        setDraft({
            cardId: nanoid(),
            cardType: preset?.cardType ?? "character",
            name: preset?.name ?? "",
            anchor: preset?.anchor ?? "",
            parentCardId: preset?.parentCardId,
        });
    };

    const startEditCard = (card: AssetCard) => {
        setEditingCardId(card.cardId);
        setDraft({ ...card });
    };

    const saveDraft = () => {
        if (!draft?.name.trim() || !draft.anchor.trim()) {
            message.warning("请填写名称和锚点文字");
            return;
        }
        if ((draft.cardType === "action" || draft.cardType === "expression") && !draft.parentCardId) {
            message.warning("请选择父角色卡");
            return;
        }
        const normalized = { ...draft, name: draft.name.trim(), anchor: draft.anchor.trim() };
        setCards((current) => (editingCardId ? current.map((card) => (card.cardId === editingCardId ? normalized : card)) : [...current, normalized]));
        setDraft(null);
        setEditingCardId(null);
    };

    const updateCardStorageKey = (cardId: string, storageKey: string) => {
        setCards((current) => current.map((card) => (card.cardId === cardId ? { ...card, storageKey } : card)));
        setDraft((current) => (current?.cardId === cardId ? { ...current, storageKey } : current));
    };

    const handleUpload = async (cardId: string, file: File) => {
        setUploadingCardIds((current) => new Set(current).add(cardId));
        try {
            const uploaded = await uploadImage(file);
            updateCardStorageKey(cardId, uploaded.storageKey);
            message.success("锚点图已上传");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "上传失败");
        } finally {
            setUploadingCardIds((current) => {
                const next = new Set(current);
                next.delete(cardId);
                return next;
            });
        }
    };

    const handleGenerate = async (card: AssetCard) => {
        if (!node) return;
        setGeneratingCardIds((current) => new Set(current).add(card.cardId));
        try {
            const storageKey = await onGenerateCard(node.id, card, cards);
            if (storageKey) {
                updateCardStorageKey(card.cardId, storageKey);
                message.success("锚点图已生成");
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : "锚点图生成失败");
        } finally {
            setGeneratingCardIds((current) => {
                const next = new Set(current);
                next.delete(card.cardId);
                return next;
            });
        }
    };

    const handleSaveCards = () => {
        if (!node) return;
        const issues = validateAssetCards(cards);
        if (issues.length) {
            message.error(issues[0]);
            return;
        }
        onSave(node.id, cards);
    };

    return (
        <Modal
            title={`资产卡池${node?.title ? `：${node.title}` : ""}`}
            open={open}
            width={1040}
            centered
            onCancel={onCancel}
            footer={
                <div className="flex justify-end gap-2">
                    <Button onClick={onCancel}>取消</Button>
                    <Button type="primary" onClick={handleSaveCards}>
                        保存卡池
                    </Button>
                </div>
            }
        >
            <div className="max-h-[72vh] space-y-5 overflow-y-auto pr-1">
                <section>
                    <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                            <h3 className="text-sm font-semibold">锚点卡</h3>
                            <p className="mt-0.5 text-xs" style={{ color: token.colorTextSecondary }}>
                                角色、场景、道具及角色衍生动作与表情集中在这里，下游会逐字复用锚点文字。
                            </p>
                        </div>
                        <Button icon={<Plus className="size-4" />} onClick={() => startNewCard()}>
                            新建卡片
                        </Button>
                    </div>

                    {cards.length ? (
                        <div className="space-y-4">
                            {cardGroups.map((group) => (
                                <div key={group.key}>
                                    <h4 className="mb-2 text-xs font-medium" style={{ color: token.colorTextSecondary }}>
                                        {group.label}
                                    </h4>
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                        {group.cards.map((card) => {
                                            const generating = generatingCardIds.has(card.cardId);
                                            const uploading = uploadingCardIds.has(card.cardId);
                                            const parentName = card.parentCardId ? parentNameById.get(card.parentCardId) : undefined;
                                            return (
                                                <article key={card.cardId} className="overflow-hidden rounded-xl border" style={{ borderColor: token.colorBorderSecondary, background: token.colorBgContainer }}>
                                                    <div className="aspect-[4/3]" style={{ background: token.colorFillAlter }}>
                                                        <AssetCardImage storageKey={card.storageKey} name={card.name} />
                                                    </div>
                                                    <div className="space-y-2.5 p-3">
                                                        <div className="flex items-start justify-between gap-2">
                                                            <h4 className="truncate text-sm font-semibold" title={card.name}>
                                                                {card.name}
                                                            </h4>
                                                            <span className="flex shrink-0 flex-wrap justify-end gap-1">
                                                                <Tag color={CARD_TYPE_COLORS[card.cardType]} className="!mr-0">
                                                                    {CARD_TYPE_LABELS[card.cardType]}
                                                                </Tag>
                                                                {parentName ? <Tag className="!mr-0">衍生自 {parentName}</Tag> : null}
                                                            </span>
                                                        </div>
                                                        <p className="line-clamp-2 min-h-10 text-xs leading-5" style={{ color: token.colorTextSecondary }} title={card.anchor}>
                                                            {card.anchor}
                                                        </p>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => startEditCard(card)}>
                                                                编辑
                                                            </Button>
                                                            {card.cardType === "character" ? (
                                                                <Dropdown
                                                                    trigger={["click"]}
                                                                    menu={{
                                                                        items: [
                                                                            { key: "action", label: "衍生动作" },
                                                                            { key: "expression", label: "衍生表情" },
                                                                        ],
                                                                        onClick: ({ key }) => startNewCard({ cardType: key as "action" | "expression", parentCardId: card.cardId, name: `${card.name}·` }),
                                                                    }}
                                                                >
                                                                    <Button size="small" icon={<Plus className="size-3.5" />}>
                                                                        衍生
                                                                    </Button>
                                                                </Dropdown>
                                                            ) : null}
                                                            <Popconfirm
                                                                title={card.cardType === "character" ? "删除这张角色卡？" : "删除这张资产卡？"}
                                                                description={card.cardType === "character" ? "其衍生卡将一并删除。" : undefined}
                                                                okText="删除"
                                                                cancelText="取消"
                                                                okButtonProps={{ danger: true }}
                                                                onConfirm={() => setCards((current) => current.filter((item) => item.cardId !== card.cardId && item.parentCardId !== card.cardId))}
                                                            >
                                                                <Button size="small" danger icon={<Trash2 className="size-3.5" />}>
                                                                    删除
                                                                </Button>
                                                            </Popconfirm>
                                                            <Upload
                                                                accept="image/*"
                                                                showUploadList={false}
                                                                beforeUpload={(file) => {
                                                                    void handleUpload(card.cardId, file);
                                                                    return false;
                                                                }}
                                                            >
                                                                <Button size="small" loading={uploading} disabled={generating} icon={<UploadIcon className="size-3.5" />}>
                                                                    上传图
                                                                </Button>
                                                            </Upload>
                                                            <Popconfirm title="将调用 1 次图像生成" description={card.storageKey ? "当前锚点图会作为参考图参与生成。" : "将根据锚点文字从零生成。"} okText="确认生成" cancelText="取消" onConfirm={() => handleGenerate(card)}>
                                                                <Button size="small" loading={generating} disabled={uploading} icon={<ImagePlus className="size-3.5" />}>
                                                                    生成锚点图
                                                                </Button>
                                                            </Popconfirm>
                                                        </div>
                                                    </div>
                                                </article>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-xl border py-6" style={{ borderColor: token.colorBorderSecondary }}>
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无资产卡，可手动新建或从实体清单预填" />
                        </div>
                    )}
                </section>

                {draft ? (
                    <section className="rounded-xl border p-4" style={{ borderColor: token.colorBorderSecondary, background: token.colorFillAlter }}>
                        <div className="mb-3 flex items-center justify-between">
                            <h3 className="text-sm font-semibold">{editingCardId ? "编辑资产卡" : "新建资产卡"}</h3>
                            <Button size="small" type="text" onClick={() => setDraft(null)}>
                                关闭
                            </Button>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                            <Select<AssetCard["cardType"]>
                                value={draft.cardType}
                                options={Object.entries(CARD_TYPE_LABELS).map(([value, label]) => ({ value: value as AssetCard["cardType"], label }))}
                                onChange={(cardType) =>
                                    setDraft((current) => {
                                        if (!current) return current;
                                        if (cardType === "action" || cardType === "expression") return { ...current, cardType };
                                        const next = { ...current, cardType };
                                        delete next.parentCardId;
                                        return next;
                                    })
                                }
                            />
                            <Input value={draft.name} placeholder="名称" onChange={(event) => setDraft((current) => (current ? { ...current, name: event.target.value } : current))} />
                        </div>
                        {draft.cardType === "action" || draft.cardType === "expression" ? (
                            <Select
                                className="mt-3 w-full"
                                value={draft.parentCardId}
                                placeholder="选择父角色卡"
                                options={parentCards.map((card) => ({ value: card.cardId, label: card.name }))}
                                onChange={(parentCardId) => setDraft((current) => (current ? { ...current, parentCardId } : current))}
                            />
                        ) : null}
                        <Input.TextArea className="mt-3" value={draft.anchor} autoSize={{ minRows: 3, maxRows: 7 }} placeholder="外貌、外形或场景锚点文字；保存后下游逐字复用" onChange={(event) => setDraft((current) => (current ? { ...current, anchor: event.target.value } : current))} />
                        <div className="mt-3 flex justify-end gap-2">
                            <Button onClick={() => setDraft(null)}>取消</Button>
                            <Button type="primary" onClick={saveDraft}>
                                {editingCardId ? "保存修改" : "添加到卡池"}
                            </Button>
                        </div>
                    </section>
                ) : null}

                <section className="rounded-xl border p-4" style={{ borderColor: token.colorBorderSecondary }}>
                    <h3 className="text-sm font-semibold">从实体清单建卡</h3>
                    <p className="mt-1 text-xs" style={{ color: token.colorTextSecondary }}>
                        点击条目只会预填新卡，确认内容后再添加到卡池。
                    </p>
                    {hints.length ? (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {hints.map((hint, index) => (
                                <button
                                    key={`${hint.cardType}-${hint.name}-${index}`}
                                    type="button"
                                    className="rounded-lg border p-3 text-left transition hover:-translate-y-0.5"
                                    style={{ borderColor: token.colorBorderSecondary, background: token.colorFillAlter }}
                                    onClick={() => startNewCard({ cardType: hint.cardType, name: hint.name, anchor: hint.note })}
                                >
                                    <span className="flex items-center gap-2">
                                        <Tag color={CARD_TYPE_COLORS[hint.cardType]} className="!mr-0">
                                            {CARD_TYPE_LABELS[hint.cardType]}
                                        </Tag>
                                        <strong className="truncate text-sm">{hint.name}</strong>
                                    </span>
                                    <span className="mt-1.5 line-clamp-2 block text-xs leading-5" style={{ color: token.colorTextSecondary }}>
                                        {hint.note}
                                    </span>
                                </button>
                            ))}
                        </div>
                    ) : entityListText ? (
                        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg p-3 text-xs leading-5" style={{ background: token.colorFillAlter, color: token.colorTextSecondary }}>
                            {entityListText}
                        </pre>
                    ) : (
                        <Empty className="mt-3" image={Empty.PRESENTED_IMAGE_SIMPLE} description="直接上游剧本中没有可用的实体清单" />
                    )}
                </section>
            </div>
        </Modal>
    );
}
