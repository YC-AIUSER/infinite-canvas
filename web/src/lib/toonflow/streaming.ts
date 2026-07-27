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
 * 产出落定后的高度上限——再长的产物也不许一个节点吃掉整屏,超出部分由内容区自己滚。
 * 取 520 是跟模板排距(NODE_GAP_Y=300)权衡的结果:内容区约 16 行够读一段完整产出,
 * 又不至于把下一排节点整个压住(压住的部分点一键整理即可排开)。
 */
export const OUTPUT_MAX_HEIGHT = 520;
/** 标题、阶段徽标、校验行与操作按钮占掉的固定高度,内容区拿剩下的。 */
const NODE_CHROME_HEIGHT = 150;
/**
 * 正文区的真实排版参数,来自 toonflow-node-content.tsx 正文 div 的 `text-xs leading-5 px-2.5`
 * 与节点容器的 `p-3.5`。刻意不读 metadata.fontSize——那个字号只作用于普通文本节点,
 * Toonflow 正文的字号是 Tailwind 写死的,拿 fontSize 估算会系统性偏差(Codex 对抗审查 2026-07-27 实锤:
 * Agent 把 fontSize 改成 8 时公式按更小字体估算,实际显示仍是 12px,高度被系统性低估)。
 */
const CONTENT_FONT_SIZE = 12;
const CONTENT_LINE_HEIGHT = 20;
/** 节点容器 p-3.5 左右各 14 + 正文 px-2.5 左右各 10。 */
const CONTENT_PADDING_X = 48;

/**
 * 按产物文本估算节点该有多高。
 * 只增不减:基准是生成前的高度(用户手动调大过就以他的为准),估算值更大才撑,并封顶在 OUTPUT_MAX_HEIGHT。
 * 不这么做的话,流式期间撑到 STREAM_MIN_HEIGHT 的节点会在收尾时被 collapseNodeAfterStream 一路还原回
 * 模板的 190 高,几千字的产物全挤进一个小框(2026-07-27 用户实测)。
 */
export function fitHeightToText(node: CanvasNodeData, text: string, baseHeight: number): number {
    // 中文按一个字号宽估平均字宽(英文更窄,估宽一点换来估高一点,宁可高不可矮)。
    // 下限 4 是为了让被改到极窄的节点仍按"每行几个字"折行,而不是塌成一行、彻底不撑高。
    const charsPerLine = Math.max(4, Math.floor((node.width - CONTENT_PADDING_X) / CONTENT_FONT_SIZE));
    const lines = text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
    const needed = NODE_CHROME_HEIGHT + lines * CONTENT_LINE_HEIGHT;
    // 封顶只约束估算值:用户自己把节点拉到比上限还高是他的选择,不能被这里压回来。
    return Math.max(baseHeight, Math.min(OUTPUT_MAX_HEIGHT, needed));
}

/**
 * 收尾:剥掉流式字段并还原高度。成功/失败/取消三条路径以及刷新后的中断降级都必须过这里,
 * 否则节点会永远卡在撑高状态。对没有流式痕迹的节点返回原对象,便于调用方跳过无谓重渲染。
 * 注:成功路径的 applyGenerationSuccess 会先把 streamRestoreHeight 改写成按产物估算的目标高度,
 * 所以这里的"还原"对成功产物而言就是落到撑好的高度。
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
