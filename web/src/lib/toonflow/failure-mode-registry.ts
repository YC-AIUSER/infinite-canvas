import type { AssetCard } from "./schema";

export type FailureModePromptKind = "storyboard-page" | "asset-card" | "keyframes";
export type FailureModeCategory = "identity" | "layout" | "content-leak" | "reference-leak" | "subject-count";

export type FailureModeRecord = {
    id: string;
    title: string;
    category: FailureModeCategory;
    promptKinds: readonly FailureModePromptKind[];
    assetCardTypes?: readonly AssetCard["cardType"][];
    preventionRule: string;
    forbiddenSentence: string;
    detectionRule: string;
    repairTemplate: string;
    /**
     * 是否允许出图后的视觉闸门自动判定这一条（visual-gate.ts 消费）。
     *
     * 判定标准是"闸门手上有没有判它所需的证据"，不是"能不能单看候选图判"——闸门送审的是一张
     * 带参考图的对比板，所以"要比对参考图"根本不是关闭理由（早前按那条错标准写过一版，把最该查的
     * 刀型被换给关掉了，2026-07-31 后台审查抓出）。
     *
     * 关闭的只有一类：判它需要闸门当前拿不到的任务侧上下文（版式与镜头数、任务要求的主体数量）。
     * 这类条目开着等于每轮白问一遍，模型只会回 unsure，还让人误以为查过了——实测已验证。
     * 等闸门把这些上下文一起送审时再逐条开启。
     */
    gateEnabled: boolean;
    /**
     * 判这条必须看到参考图。对比板里没有参考图时，闸门不会拿它提问（无参考却问"和参考图是否一致"
     * 只能逼出 unsure 或凭空猜测）。
     */
    gateRequiresReference?: boolean;
};

export type FailureModeQuery = {
    promptKind: FailureModePromptKind;
    assetCardType?: AssetCard["cardType"];
    category?: FailureModeCategory;
    /** 只取已开启视觉闸门的条目 */
    gateOnly?: boolean;
    /**
     * 送审的对比板里是否带了参考图。仅在 gateOnly 时生效：为 false 时剔除 gateRequiresReference 条目，
     * 免得在没有参考图的情况下问"和参考图是否一致"，只能逼出 unsure。
     */
    hasReference?: boolean;
};

export const FAILURE_MODE_REGISTRY: readonly FailureModeRecord[] = [
    {
        id: "prop-shape-substitution",
        title: "关键道具形态被替换",
        category: "identity",
        promptKinds: ["asset-card", "keyframes"],
        assetCardTypes: ["character", "prop", "action", "outfit", "form"],
        preventionRule: "锚点或参考图已经指定刀、剑、枪械等关键道具的类型、轮廓、数量与持握关系时，逐项照做，不用相近品类替代。",
        forbiddenSentence: "禁止把指定刀型改成另一种刀剑，禁止擅自增减部件、数量或改变持握方向。",
        detectionRule: "对照锚点与参考图检查关键道具的品类、主轮廓、部件数量和持握方向，任一不一致即命中。",
        repairTemplate: "只把{道具名称}修正为{正确形态与数量}，保持人物、姿态、构图、光线和其余元素不变。",
        gateEnabled: true,
        gateRequiresReference: true,
    },
    {
        id: "prompt-text-leakage",
        title: "提示词或内部标签泄漏进画面",
        category: "content-leak",
        promptKinds: ["storyboard-page", "asset-card", "keyframes"],
        preventionRule: "只允许画面任务明确要求展示的标题、格名、HEX 与中文说明；其余提示词、规则名、镜头参数和内部标签全部只用于理解，不得渲染。",
        forbiddenSentence: "禁止出现未被画面任务明确要求的英文标签、提示词片段、参数名、规则标题、乱码、字幕或水印。",
        detectionRule: "检查画面中的每段文字；凡无法对应到任务明确要求展示的文字，或出现提示词/参数痕迹，即命中。",
        repairTemplate: "删除{泄漏文字或标签}，补回被文字遮挡的原画面内容，其他构图与主体保持不变。",
        gateEnabled: true,
    },
    {
        id: "intentional-blank-cell-filled",
        title: "刻意留空的网格被自行填充",
        category: "layout",
        promptKinds: ["storyboard-page", "keyframes"],
        preventionRule: "版式规定留空的格位必须保持纯空白；实际镜头数决定有内容的格数，空位不是待模型补全的内容槽。",
        forbiddenSentence: "禁止在留空格中补人物、场景、装饰、文字、色块或复制相邻画格。",
        detectionRule: "按镜头数与版式逐格核对，任何指定空位出现可见内容即命中。",
        repairTemplate: "清空第{空位编号}格的全部内容并恢复为纯空白，其他画格不变。",
        gateEnabled: false,
    },
    {
        id: "panel-content-duplication",
        title: "跨格复制或单格重复主体",
        category: "layout",
        promptKinds: ["storyboard-page", "keyframes"],
        preventionRule: "每格只表现该镜头的一个时点；同一主体在单格只出现一次，各格内容按 shotNo 独立落位。",
        forbiddenSentence: "禁止跨格共享身体或道具，禁止复制相邻格内容，禁止同一角色在同一格出现两次。",
        detectionRule: "检查画格边界、重复轮廓与主体数量；发现跨边界共享元素或同格重复主体即命中。",
        repairTemplate: "移除第{画格编号}格中的重复{主体}并补齐背景，保留该格正确时点与其他画格。",
        gateEnabled: true,
    },
    {
        id: "reference-layout-leakage",
        title: "参考图版式泄漏到成图",
        category: "reference-leak",
        promptKinds: ["asset-card", "keyframes"],
        assetCardTypes: ["character", "scene", "prop", "action", "expression", "outfit", "form", "styleSwatch"],
        preventionRule: "参考图只提供任务指定的外观、色彩或构图信息，不复制参考图中的色卡、网格、边框、说明文字和界面元素。",
        forbiddenSentence: "禁止把参考图的色块、图表、标签、边框、缩略图或界面控件画进输出。",
        detectionRule: "检查输出是否出现来自参考图的非主体版式元素；发现色卡、图表、边框或界面残留即命中。",
        repairTemplate: "删除来自参考图的{泄漏元素}，用当前画面的自然背景补齐，主体外观与构图不变。",
        gateEnabled: true,
        gateRequiresReference: true,
    },
    {
        id: "subject-count-invention",
        title: "擅自增加主体或背景角色",
        category: "subject-count",
        promptKinds: ["asset-card", "keyframes"],
        assetCardTypes: ["scene", "prop", "action", "expression", "outfit", "form", "styleSwatch"],
        preventionRule: "严格按任务指定的主体数量生成；单主体卡只保留一个主体，空场景与材质样板不得补人物或剪影。",
        forbiddenSentence: "禁止新增陪衬人物、重复主体、手持者、路人、动物或未要求的背景物件。",
        detectionRule: "把可见主体数量与任务要求逐项对照，任何多出的主体、人物局部或剪影均命中。",
        repairTemplate: "移除多出的{主体}并自然补齐背景，保留指定主体、构图与光线。",
        gateEnabled: false,
    },
];

export function getFailureMode(id: string): FailureModeRecord | undefined {
    return FAILURE_MODE_REGISTRY.find((mode) => mode.id === id);
}

/**
 * registry 参数只为可测性而存在（注入合成登记表以证明拼装结果随数据变化，未硬编码条目）；
 * 生产调用一律省略，走 FAILURE_MODE_REGISTRY。
 */
export function queryFailureModes(
    query: FailureModeQuery,
    registry: readonly FailureModeRecord[] = FAILURE_MODE_REGISTRY,
): FailureModeRecord[] {
    return registry.filter((mode) => {
        if (!mode.promptKinds.includes(query.promptKind)) return false;
        if (query.gateOnly && !mode.gateEnabled) return false;
        if (query.gateOnly && mode.gateRequiresReference && query.hasReference === false) return false;
        if (query.category && mode.category !== query.category) return false;
        if (query.promptKind !== "asset-card" || !query.assetCardType || !mode.assetCardTypes) return true;
        return mode.assetCardTypes.includes(query.assetCardType);
    });
}

export function composeFailureModePrevention(
    query: FailureModeQuery,
    registry: readonly FailureModeRecord[] = FAILURE_MODE_REGISTRY,
): string {
    const modes = queryFailureModes(query, registry);
    if (!modes.length) return "";
    return `【失败模式预防（历史踩坑，逐条执行）】\n${modes
        .map((mode) => `- ${mode.title}：${mode.preventionRule}\n  禁令：${mode.forbiddenSentence}`)
        .join("\n")}`;
}
