import type { CanvasNodeData, ToonflowNodeKind, ToonflowNodeMetadata } from "@/types/canvas";

/**
 * 产物为结构化 JSON 的环节。这些环节的模型输出要整份解析(parseModelJson)才能变成表格/合同,
 * 生成中流出来的是半截 JSON,只能当"进度感"看,所以按 raw 模式小字灰显,不冒充正文。
 * 其余环节产物本身就是纯文本(剧本/创意/Module4 等),流式内容可直接按正文渲染。
 */
export const STRUCTURED_STREAM_KINDS: ReadonlySet<ToonflowNodeKind> = new Set<ToonflowNodeKind>(["storyboard-table", "directing-lock", "continuity-table", "assets"]);

/** raw 模式只留尾部这么多字符——半截 JSON 看头部没有信息量,看"正在写哪一镜"才有。 */
export const RAW_STREAM_TAIL_LIMIT = 400;

export type ToonflowStreamPreview = {
    /** text=当正文渲染;raw=结构化产物的中间态,小字灰显只给进度感 */
    mode: "text" | "raw";
    text: string;
};

export function isStructuredStreamKind(kind: ToonflowNodeKind): boolean {
    return STRUCTURED_STREAM_KINDS.has(kind);
}

/** 取尾部片段;被截断时前置省略号,避免看起来像完整内容。 */
export function tailText(text: string, limit: number): string {
    if (limit <= 0 || text.length <= limit) return text;
    return `…${text.slice(text.length - limit)}`;
}

/**
 * 决定节点内容区是否要让位给流式预览。
 * 只在"生成中 + 有非空原始流"时接管;落定后 streamingText 被产物写入覆盖,自然回到正式渲染。
 */
export function resolveStreamPreview(toonflow: Pick<ToonflowNodeMetadata, "kind" | "status" | "streamingText">): ToonflowStreamPreview | null {
    if (toonflow.status !== "generating") return null;
    const raw = toonflow.streamingText?.trim();
    if (!raw) return null;
    if (isStructuredStreamKind(toonflow.kind)) return { mode: "raw", text: tailText(raw, RAW_STREAM_TAIL_LIMIT) };
    return { mode: "text", text: raw };
}

/** 流式期间节点至少要有这么高,否则模板的 190 高只够挤出一行,回显等于看不见。 */
export const STREAM_MIN_HEIGHT = 440;

/**
 * 写入流式文本,并在需要时把节点临时撑高。
 * 原高度记进 streamRestoreHeight,收尾时原样还回去——用户自己调大过的节点(已高于阈值)不动。
 */
export function expandNodeForStream(node: CanvasNodeData, streamingText: string): CanvasNodeData {
    const toonflow = node.metadata?.toonflow;
    if (!toonflow) return node;
    const needsExpand = node.height < STREAM_MIN_HEIGHT && toonflow.streamRestoreHeight === undefined;
    return {
        ...node,
        height: needsExpand ? STREAM_MIN_HEIGHT : node.height,
        metadata: {
            ...node.metadata,
            toonflow: {
                ...toonflow,
                streamingText,
                ...(needsExpand ? { streamRestoreHeight: node.height } : {}),
            },
        },
    };
}

/**
 * 收尾:剥掉流式字段并还原高度。成功/失败/取消三条路径以及刷新后的中断降级都必须过这里,
 * 否则节点会永远卡在撑高状态。对没有流式痕迹的节点返回原对象,便于调用方跳过无谓重渲染。
 */
export function collapseNodeAfterStream(node: CanvasNodeData): CanvasNodeData {
    const toonflow = node.metadata?.toonflow;
    if (!toonflow || (toonflow.streamingText === undefined && toonflow.streamRestoreHeight === undefined)) return node;
    const { streamingText: _text, streamRestoreHeight, ...rest } = toonflow;
    return {
        ...node,
        height: streamRestoreHeight ?? node.height,
        metadata: { ...node.metadata, toonflow: rest },
    };
}
