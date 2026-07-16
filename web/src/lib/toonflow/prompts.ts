/**
 * 方法论源：D:\workspaces\ai-manga-workflow\.claude\skills\ai-short-drama
 * 同步日期：2026-07-12
 * ai-short-drama 是本文件的唯一裁决源；如有冲突，以该方法论为准。
 */

import forbiddenTerms from "./seedance-forbidden-terms.json";

import { TOONFLOW_NODE_KINDS } from "./schema";
import type { ActionContract, ShotContract, StoryboardRow } from "./schema";
import type { ToonflowNodeKind } from "../../types/canvas";

type PromptNodeKind = "script" | "space-contract" | "storyboard-table" | "shot-contract" | "action-contract";
type ContextInputs = Record<string, string | null | undefined>;

const MAX_CONTEXT_CHARS = 8000;

const NODE_INPUT_PRIORITIES: Record<PromptNodeKind, readonly string[]> = {
    script: ["source", "project", "assets"],
    "space-contract": ["script", "assets", "project"],
    "storyboard-table": ["existing-ids", "script", "space-contract", "assets", "project"],
    "shot-contract": ["storyboard-table", "space-contract", "assets", "script"],
    "action-contract": ["storyboard-table", "shot-contract", "script", "space-contract"],
};

function withContext(instructions: string, context: string) {
    return `${instructions}\n\n【输入上下文】\n${context.trim() || "（无额外上下文）"}`;
}

export function buildScriptPrompt(context: string) {
    return withContext(`你是 AI 短剧的编剧与分镜前置策划。请把输入内容改写为可直接进入分镜设计的中文剧本。

必须遵守：
1. 按戏剧节拍切分场次与镜头机会：以目标、阻碍、动作转折、信息揭示、情绪落点为切分依据，不按固定秒数机械等分；允许一个完整动作跨越多个镜头。
2. 禁止 UI、标题卡、字幕卡、屏幕文字解释和画面内倒计时。必须表达倒计时时，将数字改成角色台词、画外音或现场口令。
3. 每个节拍写清场景、时间、人物目标、可见动作、台词、声音线索与节拍结束状态；情绪要转成可拍摄的行为，禁止只写抽象情绪。
4. 不设计无动机的炫技转场，不把故事写成若干互不承接的预告片式片段。
5. 结尾追加“角色实体清单”和“道具实体清单”。角色清单至少含名称、外观锚点、服装、关系、不可漂移特征；道具清单至少含名称、外形锚点、所属角色、首次出现节拍、连续性要求。

输出结构：项目设定摘要 → 分场剧本 → 戏剧节拍列表 → 角色实体清单 → 道具实体清单。只输出成品，不解释方法。`, context);
}

export function buildSpaceContractPrompt(context: string) {
    return withContext(`你是 AI 短剧的场面调度设计师。请根据剧本与资产信息制定“空间合同”，先固定空间，再允许进入分镜。

必须包含：
1. 场景布局：墙、门、窗、出入口、固定家具、重复出现的地标及其相对方位；同一空间的不同朝向不得误写成两个房间。
2. 角色点位与动线：每名角色的起点、终点、行进路径、停留点，以及关键道具的固定位置。
3. 180°轴线规则：明确角色连线、摄影机允许停留的一侧和 2—3 个编号固定机位；任何镜头都不得越轴。
4. 屏幕方向锁：主角恒左、反派恒右；说明正反打、过肩和单人镜头如何维持这一方向。
5. 用简洁的俯视坐标说明或 ASCII 点位图表达布局，并附不可移动元素清单与空间连续性检查项。

本节点只定义全局场景布局、动线、轴线和固定机位，不得编写逐镜 IN/OUT，不得提前拆分具体镜头。只输出空间合同成品。`, context);
}

export function buildStoryboardTablePrompt(context: string) {
    return withContext(`你是 AI 短剧的分镜导演。请用三层分镜法生成结构化分镜表：第一层遵守空间合同与轴线，第二层让构图、机位、动作和声音服务于单一戏剧意图，第三层按九宫格多镜头直出的语法组织镜头。

硬性规则：
1. 换场景或换时间才新建 segment；同一 segment 必须是一个连续场景，段间只在有动机的剧情断点切换。**每段必须包含 2-5 个镜头，禁止一镜一段；整集通常划为 3-6 段**（段是"连续场景"，不是"镜头"的别名）。
2. **shotNo 在段内从 1 开始编号，每进入新段就重新从 1 计数**；不要用跨段的全局连续编号。
3. 每镜只有一个明确、可见、可完成的主体动作，不堆叠多个动作或多个运镜；静态人物也必须有可见微动作。
4. 分镜格子与后续视频 prompt 必须 1:1：不合并格子，不编造格子里没有的机位，不用文字强行改变镜头数量。
5. 如输入上下文包含已有 segmentId/shotId 清单，必须逐项原样回传，不得改写、补零、重排或重新编号；新增 segmentId、shotId 一律填写空字符串。
6. 时长按戏剧节拍和动作完成所需分配，避免机械等长；每镜通常承载约 4—6 秒的完整动作落点。
7. 禁止 UI、字幕卡、标题卡和画面内解释文字。

仅输出合法 JSON 数组，不要 Markdown 代码块、前言或解释。数组每行必须且只能包含这些字段（键名必须逐字使用英文，含义：scale=景别、angle=机位角度、action=动作、line=台词、sfx=音效、mood=情绪、durationSec=时长秒、assetSlots=素材槽位）：
{
    "segmentId": "",
    "shotId": "",
    "shotNo": 1,
    "scale": "",
    "angle": "",
    "action": "",
    "line": "",
    "sfx": "",
    "mood": "",
    "durationSec": 0,
    "assetSlots": []
}`, context);
}

export function buildShotContractPrompt(context: string) {
    return withContext(`你是 AI 短剧的镜头合同设计师。请为分镜表中的每个 shotId 生成可执行的逐镜镜头合同。

每条合同必须按 shotId 绑定，且包含六个镜头字段：景别、角度、运镜、速度、主体关系、落点。另加逐镜 IN 与 OUT：IN 写必须入画的角色、道具、地标，OUT 写必须排除的角色、道具、错误背景或越轴构图。

规则：
1. 每镜只有一个镜头意图和一种主要运镜，所有选择服务于该镜的戏剧节拍。
2. “落点”必须是镜头结束时可观察、可承接下一镜的构图与状态，不得写成抽象情绪。
3. 严守空间合同、固定机位、主角恒左、反派恒右与 180°轴线。
4. 禁止使用“dramatic cinematic zoom”及其中文变体“戏剧性电影变焦”；禁止把多种运镜堆进同一镜。
5. 不得新增、改写或重排 shotId。

仅输出 JSON 数组。每项格式（键名必须逐字使用英文，含义：scale=景别、angle=角度、movement=运镜、speed=速度、subjectRelation=主体关系、endpoint=落点、inOut.include=必须入画、inOut.exclude=必须排除）：{"shotId":"","scale":"","angle":"","movement":"","speed":"","subjectRelation":"","endpoint":"","inOut":{"include":[],"exclude":[]}}。`, context);
}

export function buildActionContractPrompt(context: string) {
    return withContext(`你是 AI 短剧的动作合同设计师。请为分镜表中的每个 shotId 编写能治愈“假静止”的动作链。

每条动作链必须严格按 shotId 绑定，并完整写出：起因 → 过程 → 物理后果 → 结束状态。

规则：
1. 起因是触发动作的可见事件；过程写主体、动作、力度、时机和连续变化；物理后果写环境、道具或另一主体的可见反应；结束状态必须改变人物位置、姿态、持物、视线或场面关系。
2. 每镜只保留一个明确主动作，但动作必须连续发生并落地；禁止循环、悬停、仅摆姿势或“保持不动”。
3. 对话镜头和静态主体也要加入呼吸、视线、手指、衣摆或道具反馈等微动作，并让微动作在镜尾形成状态变化。
4. 动作必须服从镜头合同的落点、空间合同的轴线与分镜表的单镜意图，不得改写、补造或重排 shotId。

仅输出 JSON 数组。每项格式（键名必须逐字使用英文，含义：cause=起因、process=过程、consequence=物理后果、endState=结束状态）：{"shotId":"","cause":"","process":"","consequence":"","endState":""}。`, context);
}

// 资产锚点卡与派生资产，方法论源 manga-drama asset-card / ai-short-drama S4。
export function buildAssetCardPrompt(
    card: { cardType: "character" | "scene" | "prop" | "action" | "expression" | "outfit" | "form" | "audio"; name: string; anchor: string },
    parent?: { name: string; anchor: string },
): string {
    const subject = card.name.trim() || "未命名主体";
    if (card.cardType === "character") {
        return `生成一张角色全身立绘锚点卡，只画“${subject}”这一个主体。正面全身，自然站姿，服装完整可见，干净纯色浅底，构图简洁。外貌与服装锚点必须逐字遵守：${card.anchor}\n有参考图时风格跟随参考图。画面禁止任何文字、logo、水印或边框。单图输出。`;
    }
    if (card.cardType === "prop") {
        return `生成一张道具锚点卡，只画“${subject}”这一个主体。白底单道具居中，无手持、无人物，形态与细节清晰，构图简洁。外形锚点必须逐字遵守：${card.anchor}\n有参考图时风格跟随参考图。画面禁止任何文字、logo或水印。单图输出。`;
    }
    if (card.cardType === "action") {
        return parent
            ? `以参考图中的角色为唯一主体，让“${parent.name}”执行该动作：${card.anchor}。全身入画、动作姿态清晰、干净纯色浅底；外貌与服装必须与参考图和以下锚点完全一致，逐字遵守：${parent.anchor}；只改动作，不改外观，禁止改变发型、服装、体型；画面禁止任何文字、logo或水印；单图输出。`
            : `生成一张衍生动作锚点卡，只画“${subject}”这一个主体。动作描述：${card.anchor}。全身入画、动作姿态清晰、干净纯色浅底；外观与参考图一致，只改动作，不改外观，禁止改变发型、服装、体型；画面禁止任何文字、logo或水印；单图输出。`;
    }
    if (card.cardType === "expression") {
        return parent
            ? `以参考图中的角色为唯一主体，“${parent.name}”的表情特写（胸像以上）：${card.anchor}。外貌锚点逐字遵守：${parent.anchor}；只改表情不改外观；干净浅底；画面禁止任何文字或水印；单图输出。`
            : `生成一张衍生表情锚点卡，只画“${subject}”这一个主体。表情特写（胸像以上）：${card.anchor}。外观与参考图一致，只改表情不改外观；干净浅底；画面禁止任何文字或水印；单图输出。`;
    }
    if (card.cardType === "outfit") {
        return parent
            ? `以参考图中的角色为唯一主体，为"${parent.name}"更换服装：${card.anchor}。全身入画、服装细节清晰、干净纯色浅底；脸型、发型、体型必须与参考图和以下锚点完全一致，逐字遵守：${parent.anchor}；只换服装，不改容貌；画面禁止任何文字、logo或水印；单图输出。`
            : `生成一张衍生服装锚点卡，只画"${subject}"这一个主体。服装描述：${card.anchor}。全身入画、服装细节清晰、干净纯色浅底；外观与参考图一致，只换服装，不改容貌，禁止改变脸型、发型、体型；画面禁止任何文字、logo或水印；单图输出。`;
    }
    // 形态卡刻意不继承角色外观锚点——变身形态有独立参考或不露脸，注入原形态特征会造成反向漂移（创始人裁决 2026-07-12）。
    if (card.cardType === "form") {
        return `生成一张形态锚点卡，只画"${subject}"这一个主体。形态描述：${card.anchor}。构图完整、主体清晰、干净纯色浅底；有参考图时以参考图为唯一形象基准；画面禁止任何文字、logo或水印；单图输出。`;
    }
    return `生成一张场景锚点图，只画“${subject}”这一个场景。空场景、无人物，固定机位单视角，光线与地标清晰，构图简洁。场景锚点必须逐字遵守：${card.anchor}\n有参考图时风格跟随参考图。画面禁止任何文字、logo或水印。单图输出。`;
}

// 故事板页，方法论源 ai-short-drama S2/S3：格子与镜头 1:1，并把轴线锁落实到每格构图。
export function buildStoryboardPagePrompt(input: {
    rows: StoryboardRow[];
    shotContracts: ShotContract[];
    actionContracts: ActionContract[];
    spaceRules?: string;
}): string {
    const shotContractById = new Map(input.shotContracts.map((contract) => [contract.shotId, contract]));
    const actionContractById = new Map(input.actionContracts.map((contract) => [contract.shotId, contract]));
    const rows = [...input.rows].sort((left, right) => left.shotNo - right.shotNo);
    const panels = rows.map((row, index) => {
        const shotContract = shotContractById.get(row.shotId);
        const actionContract = actionContractById.get(row.shotId);
        const details = [
            `第${index + 1}格（shotNo ${row.shotNo}）`,
            `景别：${row.scale}`,
            `机位角度：${row.angle}`,
            `动作：${row.action}${actionContract ? `；关键瞬间：${actionContract.process}` : ""}`,
        ];
        if (shotContract) {
            details.push(`落点构图：${shotContract.endpoint}`);
            if (shotContract.inOut.include.length) details.push(`必须入画：${shotContract.inOut.include.join("、")}`);
            if (shotContract.inOut.exclude.length) details.push(`必须排除：${shotContract.inOut.exclude.join("、")}`);
        }
        return details.join("\n");
    });
    const spaceRules = input.spaceRules?.trim();

    return `生成该段故事板页：共 ${rows.length} 格、格子=镜头、按 shotNo 顺序排布。每格只画对应镜头，不合并格子，不新增镜头，不编造机位。

【逐格画面】
${panels.join("\n\n")}

【空间与轴线规则】
${spaceRules || "同一角色在所有格中保持同一屏幕侧，摄影机不得跨越 180°轴线。"}

全局画面规则：monochrome rough storyboard，黑白粗线稿，干净构图；同一角色跨格保持外观与屏幕侧一致。默认避免双人并排构图，优先 POV、过肩或单人构图。每格可带小号格号，但画面禁止台词文字、字幕、水印和 logo。`;
}

// 首帧，方法论源 ai-short-drama S4：线稿是构图锁，定点修只改一处。
export function buildKeyframesPrompt(input: { rows: StoryboardRow[]; anchors: string[]; note?: string }): string {
    const rows = [...input.rows].sort((left, right) => left.shotNo - right.shotNo);
    const shotOrder = rows.map((row, index) => `第${index + 1}格=shotNo ${row.shotNo}`).join("；");
    const anchors = input.anchors.length ? input.anchors.map((anchor) => `- ${anchor}`).join("\n") : "（无资产锚点）";
    const correction = input.note
        ? `\n\n【定点修指令】\n只改以下这一处：${input.note}\n除这一处外，其余内容必须与参考图完全一致。`
        : "";

    return `以输入的该段故事板页线稿为唯一构图锁，只上色不改构图。共 ${rows.length} 格，保持原格数与以下顺序：${shotOrder}。

禁止改变机位、景别、裁切和主体位置；禁止增删、合并或重排格子；禁止新增、删除或移动人物、道具与背景元素。

【资产上色锚点（逐字遵守）】
${anchors}

角色外观与配色、场景光线、道具形态必须按锚点上色。画面禁止台词文字、字幕、水印和 logo。${correction}`;
}

// 视频工作台，方法论源 ai-short-drama：九宫格页第一参考、原生多镜头直出、prompt 与格子逐一 1:1、禁首尾帧续接。
export function buildVideoWorkbenchPrompt(input: {
    rows: StoryboardRow[];
    shotContracts: ShotContract[];
    actionContracts: ActionContract[];
    anchors: string[];
    note?: string;
}): { prompt: string; shotPrompts: Record<string, string> } {
    const shotContractById = new Map(input.shotContracts.map((contract) => [contract.shotId, contract]));
    const actionContractById = new Map(input.actionContracts.map((contract) => [contract.shotId, contract]));
    const rows = [...input.rows].sort((left, right) => left.shotNo - right.shotNo);
    const shotPrompts: Record<string, string> = {};
    const panels = rows.map((row, index) => {
        const shotContract = shotContractById.get(row.shotId);
        const actionContract = actionContractById.get(row.shotId);
        const parts = [`景别：${row.scale}`, `机位角度：${row.angle}`, `动作：${row.action}`];
        if (actionContract) parts.push(`关键瞬间：${actionContract.process}`, `以物理后果结束：${actionContract.consequence}`);
        if (shotContract) {
            if (shotContract.movement) parts.push(`运镜：${shotContract.movement}${shotContract.speed ? `（${shotContract.speed}）` : ""}`);
            parts.push(`落点构图：${shotContract.endpoint}`);
            if (shotContract.inOut.include.length) parts.push(`必须入画：${shotContract.inOut.include.join("、")}`);
            if (shotContract.inOut.exclude.length) parts.push(`必须排除：${shotContract.inOut.exclude.join("、")}`);
        }
        const shotPrompt = parts.join("；");
        shotPrompts[row.shotId] = shotPrompt;
        return `第${index + 1}镜（shotNo ${row.shotNo}）：${shotPrompt}`;
    });
    const anchors = input.anchors.length ? input.anchors.map((anchor) => `- ${anchor}`).join("\n") : "（无资产锚点）";
    const correction = input.note
        ? `\n\n【本次调整】\n只调整以下这一处：${input.note}\n其余镜头与参考保持一致。`
        : "";

    return {
        prompt: `以输入的该段故事板页九宫格为第一构图参考、该段首帧组为上色与一致性锚点，原生多镜头直出该段视频（约 12-15 秒）。共 ${rows.length} 个镜头，与故事板格子逐一 1:1，按 shotNo 顺序衔接；不合并镜头、不新增机位，禁止首尾帧续接或硬拼。

【逐镜脚本（与格子 1:1）】
${panels.join("\n")}

【一致性锚点（逐字遵守）】
${anchors}

衔接规则：同一角色保持同一屏幕侧，摄影机不跨越 180°轴线；每镜一个动作并以物理后果改变结束状态。画面禁止字幕、水印和 logo。${correction}`,
        shotPrompts,
    };
}

/*
 * 编译顺序（数组左侧优先级最高）：
 * inputs -> [节点优先级数组] -> 去空白/补充未知输入 -> 拼接上下文
 *                                                       |
 * 超过 8000 字符 <- 从最低优先级输入的尾部开始裁剪 <-+
 */
export function buildNodeContext(nodeKind: PromptNodeKind, inputs: ContextInputs) {
    const priorityKeys = NODE_INPUT_PRIORITIES[nodeKind];
    const extraKeys = Object.keys(inputs).filter((key) => !priorityKeys.includes(key));
    const sections = [...priorityKeys, ...extraKeys]
        .map((key) => ({ key, content: inputs[key]?.trim() || "" }))
        .filter((section) => section.content);
    const render = () => sections.map((section) => `【${section.key}】\n${section.content}`).join("\n\n");

    let compiled = render();
    while (compiled.length > MAX_CONTEXT_CHARS && sections.length) {
        const section = sections[sections.length - 1];
        const overflow = compiled.length - MAX_CONTEXT_CHARS;
        if (overflow >= section.content.length) {
            sections.pop();
        } else {
            section.content = section.content.slice(0, -overflow);
        }
        compiled = render();
    }
    return compiled;
}

const forbiddenReplacementMap = forbiddenTerms.forbidden_replacements as Record<string, string>;
const forbiddenTermList = [
    ...forbiddenTerms.nightlife_bgm,
    ...forbiddenTerms.grey_scene,
    ...forbiddenTerms.brand,
];
const washRules = [
    ...forbiddenTermList.map((term) => ({ term, replacement: forbiddenReplacementMap[term] || "合规化描述" })),
    ...Object.entries(forbiddenTerms.violence_softening).map(([term, replacement]) => ({ term, replacement })),
].sort((left, right) => right.term.length - left.term.length);

function escapeRegExp(text: string) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function washPrompt(text: string) {
    let washed = text;
    const hits: Array<{ term: string; replacement: string }> = [];

    for (const rule of washRules) {
        const pattern = new RegExp(escapeRegExp(rule.term), "gi");
        if (!pattern.test(washed)) continue;
        washed = washed.replace(pattern, rule.replacement);
        hits.push(rule);
    }

    return { washed, hits };
}

export const AGENT_METHODOLOGY_BRIEF = "三铁律：导演纪律优先；原生多镜头直出优于单镜硬拼，只在换场景/换时间处切段；先定空间合同与180°轴线，主角恒左、反派恒右。每段用九宫格/多格故事板直出，视频 prompt 必须与格子逐一1:1，不合并、不补造机位。每镜一个动作并以物理后果改变结束状态。禁止建议首尾帧续接或首尾帧硬拼。";

// 按环节的压缩方法论红线,供 Agent 工具结果再入用(非长 prompt;长纪律仍在各 build*Prompt)。
// 单一事实源;canvas-agent/src/config.ts 逐字镜像,agent-brief-sync 测试锁一致。勿改写字符串。
const STAGE_REDLINE_OVERRIDES: Partial<Record<ToonflowNodeKind, string>> = {
    "video-workbench": "视频工作台：以九宫格故事板页为第一构图参考、每镜与格子逐一1:1，禁止首尾帧续接或硬拼，不合并镜头、不新增机位。",
    "storyboard-page": "故事板页：格子与镜头逐一1:1，把空间合同与180°轴线锁落到每一格构图。",
    keyframes: "首帧：线稿是构图锁，只上色不改构图；定点修只改指定的那一处。",
    "storyboard-table": "分镜表：三层分镜，先空间合同再分镜，按九宫格多镜头直出语法组织，禁止首尾帧硬拼。",
    "space-contract": "空间合同：先定点位＝空间合同，主角恒左、反派恒右，锁死180°轴线。",
};

export const STAGE_METHODOLOGY_REDLINES: Record<ToonflowNodeKind, string> = Object.fromEntries(
    TOONFLOW_NODE_KINDS.map((kind) => [kind, STAGE_REDLINE_OVERRIDES[kind] ?? AGENT_METHODOLOGY_BRIEF]),
) as Record<ToonflowNodeKind, string>;
