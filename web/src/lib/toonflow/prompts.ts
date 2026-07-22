/**
 * 方法论源：D:\workspaces\ai-manga-workflow\.claude\skills\ai-short-drama-plus
 * 同步日期：2026-07-21（第一块 · 文本决策层；第二块 · 图像层）
 * ai-short-drama-plus 是本文件的唯一裁决源；如有冲突，以该方法论为准。
 * 口型补充源：manga-drama/references/1renmanju-prompt-skills/video-voice-lipsync.md（plus 未收录，台词剥离后必需）。
 * 注：video-workbench 属第三块，仍是旧线（九宫格 1:1）文案，本轮不动。
 */

import forbiddenTerms from "./seedance-forbidden-terms.json";

import { renderLibraries, type ClosedLibraryCategory } from "./closed-libraries";
import type { QualityCheckItem } from "./quality-check";
import { TOONFLOW_NODE_KINDS } from "./schema";
import type { ActionContract, SeamContract, ShotContract, StoryboardRow } from "./schema";
import { groupRowsBySegment } from "./segments";
import type { ToonflowNodeKind } from "../../types/canvas";

type PromptNodeKind =
    | "creative"
    | "script"
    | "space-contract"
    | "continuity-table"
    | "directing-lock"
    | "storyboard-table"
    | "shot-contract"
    | "action-contract";
type ContextInputs = Record<string, string | null | undefined>;

const MAX_CONTEXT_CHARS = 8000;

const NODE_INPUT_PRIORITIES: Record<PromptNodeKind, readonly string[]> = {
    creative: ["script", "source", "project"],
    script: ["source", "creative", "project", "assets"],
    "space-contract": ["script", "assets", "project"],
    "continuity-table": ["script", "assets", "space-contract", "project"],
    "directing-lock": ["script", "space-contract", "assets", "project"],
    "storyboard-table": ["existing-ids", "directing-lock", "continuity-table", "script", "space-contract", "assets", "project"],
    "shot-contract": ["storyboard-table", "directing-lock", "space-contract", "assets", "script"],
    "action-contract": ["storyboard-table", "shot-contract", "script", "space-contract"],
};

function withContext(instructions: string, context: string) {
    return `${instructions}\n\n【输入上下文】\n${context.trim() || "（无额外上下文）"}`;
}

// 封闭词库按环节注入：renderLibraries 是唯一取词入口，禁止在 prompt 里手抄词条（源：SKILL.md 铁律 3）。
function withLibraries(instructions: string, categories: ClosedLibraryCategory[]) {
    return `${instructions}\n\n【封闭词库 · 逐字选取（抄名 + 抄定义关键词；禁自创、禁“综合考虑/灵活运用”等架空措辞）】\n${renderLibraries(categories)}`;
}

// P0 创意（选修节点）：有剧本走体检模式，无剧本走冷启动模式（设计文档 D5）。
export function buildCreativePrompt(context: string) {
    return withContext(
        withLibraries(
            `你是 AI 短剧的创意策划（P0 创意层）。先判定模式并在开头写明判定依据（引用输入上下文原话）：上下文里已有剧本或分集大纲 → 走【体检模式】；没有 → 走【冷启动模式】。

【冷启动模式】
1. 碰撞法三步。Step 1 选反直觉设定：从 A 列表（能力/身份：看见别人说谎 / 听到别人的心声 / 时间倒流5分钟 / 交换身体 / 预知死亡时间 / 读心术 / 看见前世记忆 / 隐身 / 改变天气）与 B 列表（限制/代价：只能看见爱人说谎 / 只能听到骂自己的心声 / 每天只能用一次用完晕倒 / 只能和陌生人交换持续24小时 / 无法改变也无法告诉本人 / 停不下来人群中全是噪音 / 只能看见自己前世的死法 / 碰到水就显形 / 情绪失控时天气也失控）各选一词碰撞——一句话能说清、第一反应“不可能”、细想又“有意思”。Step 2 设计情绪配方（主情绪 + 反转情绪）：甜蜜+恐惧=甜宠悬疑 / 愤怒+爽感=复仇打脸 / 悲伤+希望=虐心治愈 / 搞笑+感动=喜剧温情 / 猎奇+共情=悬疑反转。Step 3 打造社交传播五要素：金句 / 站队 / 共情炸弹 / 爽感瞬间 / 反转炸弹。
2. 从 31 种主流题材表选定题材，写明受众、核心爽点、典型设定：都市情感 / 霸道总裁 / 甜宠 / 重生穿越 / 战神归来 / 古装宫廷 / 励志逆袭 / 家庭伦理 / 萌宝 / 悬疑探案 / 软科幻 / 末日重生 / 喜剧 / 反套路霸总 / 古风甜虐 / 宠物拟人 / 职场反卷 / 奇幻治愈 / 性别反转 / 浪浪山系 / 新国风 / 泰式魔性搞笑 / 替身文学 / 先婚后爱 / 破镜重圆 / 年下恋 / 契约恋人 / 追妻火葬场 / 双向暗恋 / 娱乐圈 / 马甲文。可做题材叠加组合，须写明理由。
3. 按二阶段冲击模型排布集数：冲击段（前 80%，情绪 7→10/10，每集一个核心冲突从中间切入，连续推进，以最强钩子收尾）+ 终结段（后 20%，情绪 8→10/10，收束但保持冲突密度）。零铺垫、冲突先行——第一集第一秒即入冲突核心；禁止“建立世界观 / 场景引入 / 角色出场 / 关系铺垫 / 背景交代 / 过渡集 / 缓冲集”任何标签，背景信息一律在冲突进程中以对话、动作、视觉符号自然释放。
4. 输出分集规划表，每集三标签：核心冲突事件（可视觉化事件，不写“矛盾升级”这类抽象状态）/ 情绪高点（情绪·段·强度 x/10）/ 结尾钩子类型（四类结尾钩子四选一）/ 关键信息释放（在哪些冲突对话或动作中释放了什么背景）。
5. 锁定三大付费卡点位置与主导情绪弧线。

【体检模式】
不重写故事，对照四张表逐项体检已有内容，指出缺什么、缺在哪一集、怎么补：
1. 七大爽点：身份碾压 / 实力碾压 / 反转打脸 / 守护救场 / 悬念揭秘 / 情感共鸣 / 喜剧反差。核对已有哪几类、缺哪几类；爽点前是否有“憋屈”蓄力（没有压抑就没有爽）；是否同一类型爽点连续 3 集。
2. 四类结尾钩子：悬念钩（建立期待→接近答案→揭晓前切断）/ 反转钩（观众以为 A，最后一秒揭示是 B）/ 情绪钩（强烈情感冲击在高潮点切断）/ 危机钩（生存、命运、关系临界点切断）。逐集核对；信息钩已被裁掉，出现即判不合格。
3. 三大付费卡点：第 10 集附近（反转钩或悬念钩，L4）/ 第 20-25 集（危机钩+反转钩叠加，L5）/ 第 30-35 集（终极反转或身份全面揭露，L5）。核对是否落位，以及是否卡在“观众最想知道答案”的时刻、而非“故事讲完”的时刻。
4. 六情绪弧线：ARC-SWEET 甜蜜上升波 / ARC-ANGST 虐心深谷波 / ARC-BITTER 酸甜交替波 / ARC-POWER 爽感阶梯波 / ARC-SUSPENSE 悬疑螺旋波 / ARC-COMEDY 欢乐脉冲波。判定当前弧线，并核对与题材是否兼容（如甜宠选 ARC-ANGST 即不兼容）。

【阻断项（两种模式都要核对，命中就在报告里单列）】情绪弧线与题材不兼容 / 冲击段情绪强度 <7/10 / 出现“建立、过渡、缓冲、场景引入”标签 / 钩子类型里出现信息钩。

【六项创意自检，逐条给结论】一句话测试 / 反直觉测试 / 情绪测试 / 社交测试 / 可执行测试 / 合规测试。

每段 0-3s 的开场钩子类型必须从下列封闭词库的开场钩子四类中逐字选取；开场类型只许是“身体关系叙事”或“动作中间瞬间”。

只输出成品，不解释方法。`,
            ["hook"],
        ),
        context,
    );
}

export function buildScriptPrompt(context: string) {
    return withContext(`你是 AI 短剧的编剧（P1 剧本层）。请把输入内容改写为可直接进入资产与分镜决策的中文剧本。剧本只回答“发生了什么”，是下游所有环节的唯一事实源；镜头语言、色卡数值、精确时间码一律不得反向渗透进剧本层。

【格式铁律 F1-F7（缺任一项即判不合格）】
F1 动作描写一律用「△」起头，禁止写成【画面】或无符号。
F2 场景头必须含内景/外景与日夜标注（日内 / 日外 / 夜内 / 夜外）。
F3 场次编号格式「## 场次{N}-{M}」。
F4 每个场次含【音频要素标签】：BGM:{音乐风格}({情绪}) + 音效:{音效列表} + 角色声音:{角色音色}。
F5 资产引用用「[资产名]」格式。
F6 每场既有动作描写也有情绪表达，不许只有台词没有动作、或只有动作没有情绪。
F7 台词格式「**角色名**（神态）："台词"」，神态指示 3-5 字。

符号系统：「△」动作描写 /「()」语气神态指示 /「OS」画外音（画面外同一空间）/「【闪回】」与「【闪回结束】」/「【字幕】」。「△」后跟动词短语（“取伞”“付钱”“推门”），只写节点不写流水账，不写“怎么走过去的”。

【冲突先行 · 零铺垫三段式】
每一集、每一段按 0-3s 冲突切入 / 3-12s 冲突推进 / 12-15s 钩子收尾 三段组织。
1. 0-3s：从冲突中间切入，情绪强度 ≥7/10。开场类型二选一——身体关系叙事（画面内人物位置关系与身体距离直接讲清谁强谁弱，观众不识字也看得懂）或动作中间瞬间（从关键动作的中间帧切入，起幅已发生、落幅还没到）。钩子类型四选一：强冲突（双方物理接触或即将接触）/ 强危机（生命或命运悬于一线）/ 强福利（一个画面包含多重信息）/ 强反差（观众预期与画面剧烈冲突）。
2. 每一集的第一个「△」必须在 30 字内呈现钩子画面：角色名 + 动作 + 关系或冲突暗示。
3. 三类铺垫全集全段绝对禁止：场景空镜或环境建立、角色静态站位定位、因果前置解释。零铺垫 = 从冲突中间切入，不解释来龙去脉。
4. 3-12s：动作与台词持续释放信息增量，不折返解释起因，不插入空镜停顿。
5. 12-15s：卡在情绪最高点或冲突最激烈处，情绪强度 ≥8/10。卡点三选一——悬念卡点（信息缺口最大化）/ 危机卡点（威胁最大化）/ 反转卡点（认知颠覆最大化）。上一集结尾卡点画面必须在下一集开场 3 秒内接续，禁止复述上集发生了什么。

【剧本层禁令（分镜指令泄漏进剧本即判不合格）】
禁止镜头推进、切换、拉远、跟拍、画面切至、定格等镜头动作；禁止色温数值（写“冷白光”“暖黄调”）；禁止音符频率（写“极低频长音”）；禁止精确数值（写“瞬间”“短暂”“缓慢”）；禁止摄影机参数（焦段、光圈、帧率）；禁止角色代称（写全名，不写“他看着她”）；禁止文学比喻词（像 / 仿佛 / 犹如）。禁止 UI、标题卡、字幕卡、屏幕文字解释和画面内倒计时——必须表达倒计时时，把数字改成角色台词、画外音或现场口令。

【万能敷衍词黑名单（出现即替换成具体身体动作）】
微微一笑 / 淡淡一笑 / 笑而不语 / 若有所思 / 意味深长 / 神情复杂 / 不动声色 / 轻描淡写 / 眼底闪过 / 嘴角勾起 / 瞳孔微缩 / 眉头紧锁 / 紧皱眉头。

【台词铁律】
每句台词必须有信息增量，可删的台词就是该删的台词；单句 ≤25 字，超了就拆；关键台词前必有动作或神态；禁止解释性台词，用行动替代解释；OS 每场次 ≤2 句，且只在“角色嘴上说的和心里想的相反”时使用。

【戏剧单元四要素】
按行动、信息、关系、状态的可见变化拆分戏剧单元，不按字数或固定秒数切。每个单元写清：主动者 / 表面目标 / 真实目标 / 阻力（属于人物、环境、时间、身体、资源还是规则）/ 必须被直接呈现的可见行动 / 结果改变了关系、信息、位置、资源、权力还是身体状态。只有情绪没有行动的段落，先补一个可执行目标；补不出就删掉这段无因果的情绪展示。

【实体清单（下游资产环节依赖，必须产出）】
结尾追加“角色实体清单”和“道具实体清单”。角色清单至少含名称、外观锚点、服装、关系、不可漂移特征；道具清单至少含名称、外形锚点、所属角色、首次出现节拍、连续性要求。

输出结构：项目设定摘要 → 分场剧本 → 结尾钩子 → 角色实体清单 → 道具实体清单。只输出成品，不解释方法。`, context);
}

export function buildSpaceContractPrompt(context: string) {
    return withContext(`你是 AI 短剧的场面调度设计师（P4.5 空间调度层）。请根据剧本与资产信息制定“空间合同”，先固定空间与运动方向，才允许进入分镜与故事板。

【必须包含】
1. 场景布局：墙、门、窗、出入口、固定家具、重复出现的地标及其相对方位；同一空间的不同朝向不得误写成两个房间。
2. 角色点位与动线：每名角色的起点、终点、行进路径、停留点，以及关键道具的固定位置。
3. 180°轴线规则：明确角色连线、摄影机允许停留的一侧和 2—3 个编号固定机位；任何镜头都不得越轴。
4. 屏幕方向锁：主角恒左、反派恒右；说明正反打、过肩和单人镜头如何维持这一方向。
5. 用简洁的俯视坐标说明或 ASCII 点位图表达布局，并附不可移动元素清单与空间连续性检查项。

【俯视调度图（触发条件命中即必须出，否则跳过本节直接进故事板）】
触发条件（满足任一）：一镜到底 / 多区域穿行 / 多人换位 / 追逐 / 绕行 / 穿门 / 上下楼 / 狭窄通道 / 障碍空间 / 跨镜头组精确位置继承（上一镜末位 = 下一镜首位）/ 有明确朝向或迁移方向的运动镜（冲锋、逃跑、由远及近、腾空飞行）。简单固定机位与普通单人动作跳过本节。
画法：纯简化线稿——墙线 + 门洞 + 火柴人 + 虚线箭头，禁止画成俯视插图或写实渲染图。人物用稳定的字母编号加颜色，摄影机用独立颜色的机位图标并标出视线方向，道具用对象轮廓，障碍与不可通行区用统一阴影；图例不遮挡路线与结构。
人物路线每条含起点、终点、方向箭头、关键停顿或动作点、动作先后；多人互动标顺序、接触点、距离变化。摄影机路线标起始机位、镜头朝向、移动路线、关注对象、转向点、最终落点，并区分摄影机位置与镜头视线（这是两件不同的事）。路线图不填视频时长、不按秒数拆图；拆分依据是空间表达清晰度，不是秒数。
每个节拍按此模板记录：节拍 / 适用镜头组与范围 / 剧情目的 / 底图资产编号 / 人物起点与终点 / 人物路线与关键动作 / 摄影机起点、路径与落点 / 跨层对应 / 障碍与道具 / 连续性风险。
多楼层用横切面加分层俯视图，横切面的跨层起终点必须与相应楼层俯视图位置一致；未知内容标“待确认”，禁止自动补楼梯、扶梯、电梯、坡道、门窗。

【运动方向锁四条（阻断级，防倒飞、越轴、穿墙、朝向跳变）】
1. 运动方向锁：每个运动主体标明“朝哪走”（向镜头 / 背镜头 / 左 / 右）以及推进或受力方向。焰与尾迹的方向 = 运动的反方向，写死在标注里，下游不得违背。
2. 180°轴线锁：双人、对话、对峙镜的摄影机必须在轴线同一侧；俯视图上画出轴线与机位，相邻画格机位不越轴。
3. 空间锚点锁：入口、货架、远景目标等锚点在俯视图上定位；每个画格里主体相对锚点的方位一致，冲锋镜的目标物恒在运动方向前方。
4. 朝向连续性锁：主体朝向改变必须有可见的转身过程，正面直接变背影而无过程即判不合格。三种落实方式——主体转身（甩镜或快摇 + 头部领转、脚步碾地换向，单设转身画格）；摄影机环绕裹转身（环绕的同时主体转身，朝向切换融进环绕运动，不设生硬转身画格）；把转身折进变身或形变里同步完成（形变结束时主体已朝目标方向，少一次朝向跳变的机会）。

【物理检查】
人物与摄影机不穿越不存在的空间、不跳位；路线与真实障碍、通行宽度、高低差一致；摄影机必须位于真实可通行区域；跨镜头组位置能继承。人物路线与摄影机路线是两条独立成立的线，分别验证，不混为一谈。真实底图未出现前，下游一律写“提示词预案／待真实底图绑定”，不虚构精确坐标、路线或完成状态。

本节点只定义全局场景布局、动线、轴线、固定机位与运动方向锁，不得编写逐镜 IN/OUT，不得提前拆分具体镜头。只输出空间合同成品，不解释方法。`, context);
}

// 跨段状态继承表：全片一张、逐段更新，锁死道具/站位/光向/装备/遗留物（SKILL.md 铁律 11 ②）。
export function buildContinuityTablePrompt(context: string) {
    return withContext(
        withLibraries(
            `你是 AI 短剧的连续性管理员（跨段状态继承表）。全片只有一张表，逐段更新：每段生成前引用本表，生成后回写变化。目标是消灭跨段的道具漂移、站位漂移、光向漂移与装备漂移。

【五类锁定项】
1. 桌面道具白名单：列出场上允许存在的道具及其锁定状态（位置、朝向、持有者、可见性）。道具只许被角色的手改变，禁止凭空增减；白名单以外的道具不得出现在任何一段画面里。
2. 人物站位与姿态：每个角色的坐立状态与左右恒位，与空间合同的屏幕方向锁一致。
3. 光向与天气：写锁定值 + 允许的变化范围。主光方向须与空间结构一致；同一场景同一段内的雨量、风量、光量必须一致。天气必须反映到角色外观——雨对应湿发、湿衣或雨具（缺失即判不合格）；雪对应积雪与呼气白雾；夜对应光比差异。
4. 角色装备：与角色资产卡逐段核对，装备变化必须有剧情内的可见原因。
5. 遗留物：上一段留下的物理痕迹（如掷出后留在桌上的骰子、打翻的杯子）必须在后续段落里继续存在。

光向锁定值必须逐字引用下列封闭词库的布光方案名称，并写明主光方向。

仅输出合法 JSON 对象，不要 Markdown 代码块、前言或解释。每一类是一个数组，数组每项只有两个字段（键名必须逐字使用英文，含义：name=锁定对象名称、lockedValue=锁定值与允许的变化范围）；某一类不适用时给空数组：
{"propWhitelist":[{"name":"","lockedValue":""}],"blocking":[{"name":"","lockedValue":""}],"lightingWeather":[{"name":"","lockedValue":""}],"characterGear":[{"name":"","lockedValue":""}],"leftovers":[{"name":"","lockedValue":""}]}`,
            ["lighting"],
        ),
        context,
    );
}

// P3 分镜决策锁定表：一次锁死 A 表 + B 表 + 缝合同，后续环节只引用不复判（SKILL.md 铁律 2）。
export function buildDirectingLockPrompt(context: string) {
    return withContext(
        withLibraries(
            `你是 AI 短剧的分镜决策导演（P3 分镜决策锁定表）。分镜决策先锁后执行——本表是全片导演判断的唯一定稿，一次性填满，不可分步追加，不可凭印象采样；填完后所有段的分镜表与镜头合同只读本表、只引用不复判，不再重新判断。

【A 表 · 全局视觉策略】
视觉风格（导演风格 9 种选 1）/ 调色主策略（调色 22 组选 1，末尾追加 but avoid over-color grading）/ 布光主策略（布光 10 方案选 1，并写明主光方向）/ 运镜基调（运镜 8 种选 1）/ 表演档位（表演强度 L1-L5 选 1）/ 全段统一风格串（英文风格串，全段每段一字不差复用，跨段不得漂移）/ 母题必落项。
烘焙顺序不可打乱：视觉风格 → 调色 → 表演档位 → 构图主策略 → 布光主策略 → 运镜基调 → 母题必落 → 全段统一风格串。

【B 表 · 逐段锁定】
每段填：构图主策略（构图 8 策略选 1）/ 构图次策略（构图 8 策略选 1，且 ≠ 主策略）/ 构图多样性结论 / 运镜类型（≥2 种）/ 景别跨度（写成 Lx-Lx，跨度 ≥3 档且至少含一个极值 L0 或 L5）/ 角度类型（≥2 种：平视 / 俯视 / 仰视 / 倾斜荷兰角，倾斜全段 ≤2 镜）/ 开场类型（下列六路径之一）。
开场六路径：路径 A 压迫吞噬（核心情绪是恐惧、渺小或被控制 → 开场镜 L0 大远景或 L5 极特写，禁中景近景）/ 路径 B 接缝入场（承接上段未解信息 → 开场镜延续上段尾镜同一主体，禁止重新建立空间）/ 路径 C 断裂入场（情绪强烈反差 → 景别至少跳 2 档 + 不同角度 + 运动，禁渐变）/ 路径 D 渐进入场（平稳推进 → 开场镜景别为上段尾镜 ±1 档，禁跳极端景别）/ 路径 E 悬念延宕（插入镜头拖延 2-3s 再切入主体）/ 路径 F 钩子开场（景别 L4、L5 或 L0，运动必须带急推、急降、甩镜或快摇，0-3s 须有声音冲击点；禁 L1、L2、L3 与固定镜头）。首段必须走路径 F；非首段情绪强度 ≥8 也须走路径 F。

【锁定表自检八条，全部通过才算锁成】
1. 每段构图主策略 ≠ 构图次策略；2. 全程至少使用 2 种不同构图策略；3. 无全程同一构图（全段同构图阻断 / 同构图连续 ≥3 段阻断 / 居中对称占比 ≥50% 阻断）；4. 每段运镜 ≥2 种；5. 每段景别跨度 ≥3 档；6. 每段角度 ≥2 种；7. 四维多样性检查通过（运镜 ≥2 种、景别跨度 ≥3 档且含极值、角度 ≥2 种、构图 ≥2 种）；8. 全段风格串统一。

【缝合同（分段即分缝，每两个相邻段之间签一份，五行齐全）】
上段末拍 = 动作做到中间态截止（如下摇到 1/3、收手机到一半、欲击掌未合）
本段首格 = 同一动作的后半段，禁止重新建立空间
景别/动机 = 景别跳 ≥2 档，或正反打（严守 180°轴线，勿越轴），或 POV 运镜动机（下摇、抬头、转头、前推、回头），或时间省略
声音桥 = J-cut（本段某句台词或音效提前 0.2-0.5s）或 L-cut（上段某声音拖尾 0.3-0.6s）
音频边界 = 写清这个缝两侧生成时的音效约束，让缝天生可切：上段末 0.5s 内不起新的持续音、环境音在段尾自然收束；本段开头不设承接性音效残留。台词已独立成轨不受此限，此行只管视频自带的环境音与音效——它们由模型烧进视频轨，跨缝的持续音（长鸣、爆炸余响、金属滑落）会让这一刀切下去带伤

每一项选取都必须逐字抄取封闭词库里的名称与定义关键词，禁止自创名称。选取时必须能引用剧本原文或本段叙事目的作为理由（理由不进 JSON，JSON 只回填最终选定的名称与值）。

仅输出合法 JSON 对象，不要 Markdown 代码块、前言或解释。格式（键名必须逐字使用英文，含义：global=A 表全局策略、segments=B 表逐段锁定、seams=段间缝合同）：
{"global":{"visualStyle":"","colorGrading":"","lighting":"","cameraTone":"","performanceLevel":"","unifiedStyleString":"","motifs":[]},"segments":[{"segmentId":"","compositionPrimary":"","compositionSecondary":"","compositionDiversity":"","cameraType":"","scaleRange":"","angleType":"","openingType":""}],"seams":[{"fromSegmentId":"","toSegmentId":"","prevEndBeat":"","nextFirstPanel":"","scaleOrMotivation":"","soundBridge":"","audioBoundary":""}]}`,
            ["directorStyle", "colorGrade", "lighting", "cameraMovement", "performanceIntensity", "composition", "shotScale"],
        ),
        context,
    );
}

export function buildStoryboardTablePrompt(context: string) {
    return withContext(
        withLibraries(
            `你是 AI 短剧的分镜导演。构图、运镜、角度、景别策略已在分镜决策锁定表里锁死——本环节只读锁定表、只引用不复判，不得重新判断这四项策略。

【Layer 1 决策前件（六项，任一缺失就不许生成本段）】
P1 剧本锚定：摘取本段完整剧本原文（含台词与动作描述），不可概括缩写。每条决策都要引用剧本原文作为理由，禁止“打斗所以选密集蒙太奇”这类去内容化答案。
P2 上下文感知：读取本集集名与梗概、上段尾镜画面（非首段）、本段角色名与情绪状态、本段场景名与空间特征、本集母题清单与出场记录、锁定表 A 表固化值、开篇卡点规范。
P6 黄金三秒钩子锚定（0-3s 必须是身体关系叙事或动作中间瞬间；场景空镜、角色定位、因果前置三类铺垫全禁）。必须写满六字段并引用剧本原文：开场类型={身体关系叙事/动作中间瞬间}、钩子类型={强冲突/强危机/强福利/强反差}、钩子画面={0-3s 冲突切入画面，不是“建立空间”}、情绪强度={7-10}/10、人物关系呈现={权力差/距离/视线/朝向}、情绪冲突锚点={开场情绪对抗核心}，另附剧本依据。自检六问：未看剧本的观众能否在 0-3s 一句话说出“谁和谁、什么关系、对抗还是靠近”？0-3s 是否含身体冲突接触、身份揭露认知颠覆、生存威胁或情绪爆发之一？0-3s 是否零铺垫？开场镜景别是否 ≤L3？开场镜是否为运动镜头？0-3s 是否有至少一个声音冲击点？
P7 导演技法映射：先判定叙事目的（压迫威胁 / 揭示悬念 / 速度冲击 / 心理不安 / 亲密观察 / 空间调度 / 产品道具 / 转场连接 / 时间操控 中选一个主目的，最多加一个辅目的，附引用剧本的一句话依据）；再选 ≥2 个导演技法（辅目的非空时 ≥3 个）；最后逐条转写为可执行指令——运镜写“起点 → 方向 → 速度 → 停点”，构图写主体画框位置与占比、前景遮挡、留白、压迫线条，布光写主光方向、光源软硬、阴影落点、色温关系，剪辑写为什么切、切到什么、观众多知道或多感觉到什么，声音写声音从哪来、提前还是延后、与动作同点还是反差。禁止“配合某技法”“强化某效果”这类无参数的架空指令。
P3 母题出场：本段是否需要视觉母题出场。是则写明哪个母题、第几次出场、任务是初现、强化、转折还是收束；否则写明为什么不需要。“不需要因为不需要”不是有效答案。
P5 相邻段接缝（非首段必做）：写清上段尾镜的景别、内容、情绪强度、镜头时长，本段开头情绪强度与情绪关系（递进 / 转折 / 对比 / 延续 / 断裂），以及接缝策略。“自然过渡”本身就是不合格答案。

【分段规则（缝在装配层消灭）】
1. 打包贴满：以贴满 15 秒为目标，把相邻的因果画格打包进同一段，压缩真缝数量——段内镜头切换由模型在一次生成里原生完成，天然连贯。
2. 缝位选择：段边界优先落在场景或时间转换处（连续性需求最低点，硬切无需动作衔接），其次是可被动机化的切点（POV 或正反打）。
3. 连续动作不拆段：一个连续动作（变身、冲锋、追逐）塞不进 15 秒才拆；一旦拆开，就必须按缝合同五行处理该缝。
换段只在换场景或换时间时发生；同一 segment 必须是一个连续场景。

【逐镜硬性规则】
1. shotNo 在段内从 1 开始编号，每进入新段就重新从 1 计数；不要用跨段的全局连续编号。
2. 每行 = 一个画格 = 一个因果步骤。画格数 = 因果步骤数，画格对故事线的覆盖率必须是 100%，不新增、不跳过、不重排。
3. 每镜只有一个明确、可见、可完成的主体动作，不堆叠多个动作或多个运镜；静态人物也必须有可见微动作。
4. 景别与角度必须落在锁定表 B 表为本段锁定的景别跨度与角度类型之内；镜数 ≥5 时至少 3 种景别，禁止连续 3 镜同景别；关键动作接触（握手、接物、触碰、推门、签字、按下）必须给 L4-L5 特写。
5. 如输入上下文包含已有 segmentId/shotId 清单，必须逐项原样回传，不得改写、补零、重排或重新编号；新增 segmentId、shotId 一律填写空字符串。
6. 时长按戏剧节拍和动作完成所需分配，避免机械等长；镜头数 ≥4 时最长镜须 ≥ 最短镜的 2.5 倍。
7. 禁止 UI、字幕卡、标题卡和画面内解释文字。

【台词类型标注（台词已从视频剥离、独立成配音轨）】
line 字段写成 “出口对白-{角色名}：台词原文”（该角色在本镜做口型）或 “OS-{角色名}：台词原文”（旁白或内心，该段画面全员闭口，任何人不得对该内容做口型）。无前缀的旁白性描写一律按 OS 处理。纯环境音与拟音写进 sfx 字段，不写进 line。同一句台词或 OS 在整段内只出现一次，被其时长覆盖到的后续镜头 line 留空。

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
}`,
            ["hook", "shotScale"],
        ),
        context,
    );
}

export function buildShotContractPrompt(context: string) {
    return withContext(
        withLibraries(
            `你是 AI 短剧的镜头合同设计师（D5 逐镜决策）。请为分镜表中的每个 shotId 生成可执行的逐镜镜头合同。

每条合同必须按 shotId 绑定，且包含六个镜头字段：景别、角度、运镜、速度、主体关系、落点。另加逐镜 IN 与 OUT：IN 写必须入画的角色、道具、地标，OUT 写必须排除的角色、道具、错误背景或越轴构图。再加本镜的口型要求。

【封闭词库逐字选取（阻断级）】
景别、构图、布光、运镜一律从下列封闭词库逐字选取名称并抄取定义关键词，禁止自创名称。选取结果必须与分镜决策锁定表为本段锁定的策略一致，不得另行拍脑袋。
- 景别：从景别 L0-L5 选取。
- 构图：以锁定表 B 表的构图主次策略为权威；单镜信息密度上限——前景主体 ≤1、背景暗示 ≤1，辅助元素降为模糊小剪影。
- 布光：逐字抄取方案名称并写明主光方向，主光方向须与空间合同的空间结构一致。
- 运镜：逐字抄取类型名称，且每个运动镜必须写明“起点 → 方向 → 速度 → 停点”；写“运镜”“动态镜头”“高级运镜”一律不合格。对话与对峙段固定机位占 ≥70%，追逐与打斗段运动镜占 ≥60%。

【规则】
1. 每镜只有一个镜头意图和一种主要运镜，所有选择服务于该镜的戏剧节拍。
2. “落点”必须是镜头结束时可观察、可承接下一镜的构图与状态，不得写成抽象情绪。
3. 严守空间合同、固定机位、主角恒左、反派恒右与 180°轴线；对视、对话、对峙镜的摄影机必须停在轴线同一侧。
4. 禁止使用“dramatic cinematic zoom”及其中文变体“戏剧性电影变焦”；禁止把多种运镜堆进同一镜。
5. 不得新增、改写或重排 shotId。

【口型要求（台词已剥离成独立配音轨，视频层只出音效，口型只能靠本字段控制）】
- 分镜表 line 标 “出口对白-{角色名}” 的镜：该角色写进 speaking，其余在场角色全部写进 silent。
- 分镜表 line 标 “OS-{角色名}” 的镜：speaking 留空数组，在场角色全部写进 silent——严禁任何人对旁白或内心内容做口型。
- 纯音效镜与口型无关：speaking 与 silent 都留空数组。
- speaking 与 silent 里的人一律用“画面方位 + 服饰或发型特征”指认（如“画面左侧、穿蓝袍的束发者”），不要只写角色名——目标模型不认名字，只写名字会找错人。
- 出口对白镜优先单人主体构图（说话人近景或特写，其余人背对、侧身、虚化或出画）；非特写镜头的人物不直面镜头说话，走斜 45°、侧拍或过肩。

仅输出 JSON 数组。每项格式（键名必须逐字使用英文，含义：scale=景别、angle=角度、movement=运镜、speed=速度、subjectRelation=主体关系、endpoint=落点、inOut.include=必须入画、inOut.exclude=必须排除、lipSync.speaking=本镜张嘴说话的角色、lipSync.silent=本镜必须闭口的角色）：{"shotId":"","scale":"","angle":"","movement":"","speed":"","subjectRelation":"","endpoint":"","inOut":{"include":[],"exclude":[]},"lipSync":{"speaking":[],"silent":[]}}。`,
            ["shotScale", "composition", "lighting", "cameraMovement"],
        ),
        context,
    );
}

export function buildActionContractPrompt(context: string) {
    return withContext(`你是 AI 短剧的动作合同设计师。请为分镜表中的每个 shotId 编写能治愈“假静止”的动作链，并把相邻镜之间的因果关系锚死。

每条动作链必须严格按 shotId 绑定，并完整写出：起因 → 过程 → 物理后果 → 结束状态。

【因果锚点（每个非首镜必做，缺失即判不合格）】
构思第 N 镜（N ≥ 2）之前先回答三问：上一镜的哪个具体画面元素导致了本镜的哪个具体画面元素？视线从哪个区域移到了哪个区域？可视证据是什么？答不出就不许构思这一镜。禁止用“自然过渡”作答。
逐对相邻镜标注因果模式，四选一：A 动作 → 反应 / B 建立 → 推进 / C 原因 → 结果 / D 收紧聚焦。因果覆盖率必须是 100%，每一对相邻镜都要有模式归属。
断裂检测（命中即须补过渡镜或补因果，不得放行）：位置跳变却无过渡镜；两个独立动作之间既无视线也无动作连接、又没插反应镜；只给事前最后一帧和事后物理证据、缺过程镜或反应镜（不得以“导演意图”“制造惊吓”为由省略）；景别跳变 ≥2 档却没有合法理由（合法理由限于角色视线引导、动作物理结果、渐进收紧链、情绪冲击点）；因果锚点字段缺失。
景别联动：模式 A 的反应镜景别 ≤ 动作镜；模式 B 的推进镜景别 ≤ 建立镜；模式 C 可宽可紧。
角色移动连续性：相邻镜空间位置不同且距离 ≥2 步时，必须有移动过渡镜。
首镜例外：本段第 1 镜是“第一因”，不受前镜约束；第 1 镜到第 2 镜允许“冲击 → 反应”，因果检测从第 2 镜到第 3 镜开始生效。

【规则】
1. 起因是触发动作的可见事件；过程写主体、动作、力度、时机和连续变化；物理后果写环境、道具或另一主体的可见反应；结束状态必须改变人物位置、姿态、持物、视线或场面关系。
2. 每镜只保留一个明确主动作，但动作必须连续发生并落地；禁止循环、悬停、仅摆姿势或“保持不动”。
3. 表演写成可观测的物理细节，抽象情绪词为零——禁止“冷静地看着”“愤怒”这类形容词，必须写成{身体部位}+{具体动作}+{力度、速度或方向}+{与物品或空间的关系}。
4. 对话镜头和静态主体也要加入呼吸、视线、手指、衣摆或道具反馈等微动作，并让微动作在镜尾形成状态变化。
5. 动作必须服从镜头合同的落点、空间合同的轴线与运动方向锁、分镜表的单镜意图，不得改写、补造或重排 shotId。

仅输出 JSON 数组。每项格式（键名必须逐字使用英文，含义：cause=起因、process=过程、consequence=物理后果、endState=结束状态）：{"shotId":"","cause":"","process":"","consequence":"","endState":""}。`, context);
}

/**
 * 一键修改方案（设计文档 4.5）：质量检查判不达标后，让模型只对不达标项点名的那几镜出定点修补丁。
 * 之所以不整表重生成——整表重生成会毁掉用户已经满意的镜头，也白白多花一次完整生成。
 * 产出由 DiversityPatchSchema 校验、由 applyDiversityPatch 落回分镜表与镜头合同。
 */
export function buildDiversityRepairPrompt(input: { rows: StoryboardRow[]; shotContracts?: ShotContract[]; failedItems: QualityCheckItem[] }): string {
    const contractByShotId = new Map((input.shotContracts ?? []).map((contract) => [contract.shotId, contract]));
    // 可改范围严格取自不达标项的 shotIds——检查器已经定位到镜头，这里不再自行推断。
    const editableShotIds = [...new Set(input.failedItems.flatMap((item) => item.shotIds))];
    const failures = input.failedItems.map((item) => {
        const scope = item.segmentId ? `段 ${item.segmentId}` : item.segmentIds?.length ? `段 ${item.segmentIds.join("、")}` : "全片";
        return `- ${item.label}（kind=${item.kind}｜${scope}）：实际 ${item.actualValue}；要求 ${item.expectedValue}；${item.reason}涉及镜头：${item.shotIds.join("、") || "（无）"}`;
    });
    const segments = [...groupRowsBySegment(input.rows)].map(([segmentId, rows]) => {
        const lines = rows.map((row) => {
            const contract = contractByShotId.get(row.shotId);
            const movement = contract ? contract.movement || "（镜头合同未填运镜）" : "（该镜没有镜头合同）";
            return `- ${row.shotId}（shotNo ${row.shotNo}）景别=${row.scale}｜角度=${row.angle}｜运镜=${movement}｜动作=${row.action}`;
        });
        return `段 ${segmentId}\n${lines.join("\n")}`;
    });

    return withLibraries(
        `你是 AI 短剧的分镜质检修复员。下面这份分镜表已经生成完毕、用户基本满意，只有几项镜头语言多样性没达标。请只对点名的那几镜出定点修补丁——这是定点修，不是重做：没被点名的镜头、以及被点名镜头的其它字段，一个字都不许动。

【不达标项（逐条都要修掉）】
${failures.join("\n") || "（无）"}

【只许修改这些 shotId】
${editableShotIds.join("、") || "（无，直接输出空补丁）"}

【当前分镜表与镜头合同（只读，用于比对，不要回传）】
${segments.join("\n\n") || "（无分镜数据）"}

【定点修铁律】
1. 只许修改上面【只许修改这些 shotId】清单里的镜头。清单外的镜头一个字不许动；清单内镜头也只许改景别、角度、运镜这三个字段，动作、台词、音效、情绪、时长一律保持原样。禁止新增、删除、重排镜头。
2. 每条修改必须写明理由（reason），并在 fixes 里逐字回填它解决的那条不达标项的 kind（段级项一并回填 segmentId）。写不出理由的修改就是多余的修改，删掉。
3. 新值必须从下方封闭词库里逐字选取名称：景别抄景别 L0-L5 的完整名称（如「L4 特写」），运镜抄运镜 8 种的名称。角度没有封闭词库，只许在 平视 / 俯视 / 仰视 / 倾斜荷兰角 四者中选（分镜决策锁定表 B 表的角度类型）。禁止自创名称，禁止“综合考虑”“灵活运用”这类架空措辞。
4. 改完不许引入新的不达标——输出前拿新值逐段重算一遍，确认这三条同时成立：运镜每段 ≥2 种且同种运镜连续 <3 镜；景别每段 ≥3 档且含 L0 或 L5、连续同景别 <3 镜；角度每段 ≥2 种且平视连续 ≤2 镜。为了凑一项多样性而让相邻镜头撞成连续 3 镜同景别/同运镜，等于没修。
5. 改景别或角度时必须成对给两条补丁：一条 target=storyboardRow、一条 target=shotContract，字段同名、新值逐字相同（两处不一致会让分镜表与镜头合同对不上）；该镜没有镜头合同时只给 storyboardRow 那条。运镜只存在于镜头合同，target 一律写 shotContract。
6. oldValue 必须逐字等于上面表里的当前值，写错即视为改错了镜头。

仅输出合法 JSON 对象，不要 Markdown 代码块、前言或解释。格式（键名必须逐字使用英文，含义：targets=本次修复针对的不达标项、kind=检查项标识、patches=定点修改清单、shotId=被改的镜头、target=改在哪份产物（storyboardRow 分镜表行 / shotContract 镜头合同）、field=被改字段（scale 景别 / angle 角度 / movement 运镜，movement 只存在于 shotContract）、oldValue=原值、newValue=新值、reason=改它的理由、fixes=本条解决的不达标项、summary=整体说明）：
{"targets":[{"kind":"","segmentId":""}],"patches":[{"shotId":"","target":"shotContract","field":"movement","oldValue":"","newValue":"","reason":"","fixes":[{"kind":"","segmentId":""}]}],"summary":""}`,
        ["cameraMovement", "shotScale"],
    );
}

/**
 * ST 色板全局锚定句（03-assets.md §6.3，阻断级）。逐字照抄源文件，一个字都不许改。
 * 两句一体，第二句是防泄漏句，谁都不许以「太长」为由删掉它——色板是图表类参考图，
 * 不带这句就会被生图模型当成构图参考、把色卡本身渲进画面。
 * 2026-07-18 A/B 实证（gpt-image-2，4 组同提示词）：B 组 img2img 传色板 + 带完整两句，
 * 4 张零图表泄漏、13 色邻域覆盖 91.0/99.2/99.6/99.8%；A 组纯文生图 2/4 镜色调跑偏。
 * 色板只锁色调，构图归 Module3 blockout，人物外观与装备归视频层角色卡，三者分工不冲突。
 */
export const PALETTE_ANCHOR_SENTENCE =
    "strictly follow the confirmed color palette (13 colors, warm-cool dual tone), no color deviation from palette. The palette reference image is a color grading source only — do NOT render any swatches, charts or labels in the output";

// 色板锚定用于角色、场景与派生资产卡，并在视频层统一收口；Module3 blockout 全图中性灰，追加会与粗模职责冲突。
// 道具卡不在源文件的清单里，故不擅自扩用；色板卡自身更不能带（它的成品就是色卡，带防泄漏句等于自相矛盾）。
function withPaletteAnchor(prompt: string) {
    return `${prompt}\n${PALETTE_ANCHOR_SENTENCE}`;
}

// 资产锚点卡与派生资产，方法论源 manga-drama asset-card / ai-short-drama S4；色板卡源 plus 03-assets.md §六。
export function buildAssetCardPrompt(
    card: { cardType: "character" | "scene" | "prop" | "action" | "expression" | "outfit" | "form" | "audio" | "palette" | "styleSwatch"; name: string; anchor: string },
    parent?: { name: string; anchor: string },
    keyState?: { name: string; description: string },
): string {
    const subject = card.name.trim() || "未命名主体";
    // 色板卡是全片色彩锚点（ST## 风格锚定图），P2 资产阶段开头先出、经用户确认才 approved，
    // 之后所有角色板/场景板/故事板都拿它当 img2img 调色参考。
    if (card.cardType === "palette") {
        return `生成一张全片色板图：film color palette, 13 color swatches, warm-cool dual tone system。13 个色块按冷暖双调分区排列——暖调一组、冷调一组，分区边界清晰；每个色块内或紧邻处标注该色的 HEX 色号与一句中文色彩描述。整体调性必须逐字遵守：${card.anchor}\n色块为纯色平涂，无渐变、无材质、无光影、无投影。画面里只有色块与其 HEX 与中文标注，不画任何人物、场景、道具、示意图形、装饰边框、水印或 logo。单图输出。`;
    }
    if (card.cardType === "styleSwatch") {
        const materials = card.anchor.trim()
            ? `六格取材全部替换为以下具体材质描述，并按描述拆分填满六格：${card.anchor}`
            : "六格依次取材：第一格为主服装织物，清楚表现织纹与斜纹走向、浮毛、缝线针脚、边缘发白、附着沙尘；第二格为织带与金属扣具接合处，经纬清晰、边缘起球、金属带细密刮痕与轻微氧化；第三格为旧皮革，表现粒面纹理、折痕、边角磨出浅色底层、细微油光；第四格为橡胶鞋底齿纹，齿缝嵌泥沙、哑光并带细小划伤；第五格为干燥土石，颗粒疏松堆叠、带细小裂纹与浮尘；第六格为粗织帆布褶皱，布纹粗粝、带陈旧污渍与磨损起毛，并且不透光";
        return `生成一张 16:9 横版的 2×3 六格质感样板，六格全部是在漫射光下拍摄的材质微距，每格只由该材质本身填满，不带环境，不带空间纵深。${materials}。不得出现人物、人脸、人手、人体、剪影人形、动物、武器、贵金属、宝石、二维码、文字、数字、标签、水印；也不得出现天空、地平线、远景、光束、太阳或任何环境空镜。全部六格统一使用中性柔和漫射光，无强方向性、无逆光、无明显投影、无光晕、无体积光；明暗只用来交代材质起伏，不表达任何光位。`;
    }
    if (card.cardType === "character") {
        const keyStateName = keyState?.name.trim() || "代表性动态姿态";
        const keyStateDescription = keyState?.description.trim() || "角色的代表性动态姿态，动作清晰，体现人物性格与识别特征";
        // cano 全能参考模式允许并需要中文标注，帮助模型识别每格用途；文字禁令只适用于会逐像素复刻的 libtv 真首帧。
        return withPaletteAnchor(
            `生成一张 16:9 横版人物设定页，白色纸面版式、细线分格，所有格子都是“${subject}”这同一个人物。外貌与服装锚点必须逐字遵守：${card.anchor}\n顶部标题栏：居中显示中文标题“人物设定——${subject}”。\n上区占画面高度约 60%，横向四格：第一格标注“正面”，正面全身自然站姿；第二格标注“侧面”，正侧面全身，展示身体与装备侧面轮廓；第三格标注“背面”，背面全身，展示服装与装备背部结构；第四格标注“面部特写”，头肩入画的大图，角色的识别特征需在此格可见。\n下区占约 40%，横向两块：左块为关键状态，左上角标注“${keyStateName}”，内容为${keyStateDescription}，按成片质感渲染，带环境光影与虚化背景；右块标注“装备细节”，横向排开 4-6 个服装或装备局部特写，每格下方带一行准确的中文说明。\n页面底部一行中文总述，概括角色身份、肤色、识别特征与主装备。除关键状态格外，其余各格统一中性白底与柔和三点光，光位、色温、曝光一致，无地面投影。全页人物身份与装备位置、款式逐格一致，不得增删。有参考图时风格跟随参考图。中文标题、格名、装备说明与底部总述必须清晰可读，禁止乱码；画面禁止 logo 或水印。单图输出。`,
        );
    }
    if (card.cardType === "prop") {
        return `生成一张道具锚点卡，只画“${subject}”这一个主体。白底单道具居中，无手持、无人物，形态与细节清晰，构图简洁。外形锚点必须逐字遵守：${card.anchor}\n有参考图时风格跟随参考图。画面禁止任何文字、logo或水印。单图输出。`;
    }
    // 动作/表情/服装/形态四类衍生卡都是角色板的变体，同样吃 §6.3 的色板锚定。
    if (card.cardType === "action") {
        return withPaletteAnchor(
            parent
                ? `以参考图中的角色为唯一主体，让“${parent.name}”执行该动作：${card.anchor}。全身入画、动作姿态清晰、干净纯色浅底；外貌与服装必须与参考图和以下锚点完全一致，逐字遵守：${parent.anchor}；只改动作，不改外观，禁止改变发型、服装、体型；画面禁止任何文字、logo或水印；单图输出。`
                : `生成一张衍生动作锚点卡，只画“${subject}”这一个主体。动作描述：${card.anchor}。全身入画、动作姿态清晰、干净纯色浅底；外观与参考图一致，只改动作，不改外观，禁止改变发型、服装、体型；画面禁止任何文字、logo或水印；单图输出。`,
        );
    }
    if (card.cardType === "expression") {
        return withPaletteAnchor(
            parent
                ? `以参考图中的角色为唯一主体，“${parent.name}”的表情特写（胸像以上）：${card.anchor}。外貌锚点逐字遵守：${parent.anchor}；只改表情不改外观；干净浅底；画面禁止任何文字或水印；单图输出。`
                : `生成一张衍生表情锚点卡，只画“${subject}”这一个主体。表情特写（胸像以上）：${card.anchor}。外观与参考图一致，只改表情不改外观；干净浅底；画面禁止任何文字或水印；单图输出。`,
        );
    }
    if (card.cardType === "outfit") {
        return withPaletteAnchor(
            parent
                ? `以参考图中的角色为唯一主体，为"${parent.name}"更换服装：${card.anchor}。全身入画、服装细节清晰、干净纯色浅底；脸型、发型、体型必须与参考图和以下锚点完全一致，逐字遵守：${parent.anchor}；只换服装，不改容貌；画面禁止任何文字、logo或水印；单图输出。`
                : `生成一张衍生服装锚点卡，只画"${subject}"这一个主体。服装描述：${card.anchor}。全身入画、服装细节清晰、干净纯色浅底；外观与参考图一致，只换服装，不改容貌，禁止改变脸型、发型、体型；画面禁止任何文字、logo或水印；单图输出。`,
        );
    }
    // 形态卡刻意不继承角色外观锚点——变身形态有独立参考或不露脸，注入原形态特征会造成反向漂移（创始人裁决 2026-07-12）。
    if (card.cardType === "form") {
        return withPaletteAnchor(
            `生成一张形态锚点卡，只画"${subject}"这一个主体。形态描述：${card.anchor}。构图完整、主体清晰、干净纯色浅底；有参考图时以参考图为唯一形象基准；画面禁止任何文字、logo或水印；单图输出。`,
        );
    }
    return withPaletteAnchor(
        `生成一张场景锚点图，只画“${subject}”这一个场景。空场景、无人物，固定机位单视角，光线与地标清晰，构图简洁。场景锚点必须逐字遵守：${card.anchor}\n有参考图时风格跟随参考图。画面禁止任何文字、logo或水印。单图输出。`,
    );
}

// 画格排列（06-video-prompt.md §1.4）：3-5 镜 → 3+2、6 镜 → 3+3、7-8 镜 → 4+4。
// 源文件只定义了 3-8 镜，2 镜以下与 9 镜以上无规则——那两段不编矩阵，只给顺序排布口径，宁可少说也不自创。
function storyboardPanelLayout(count: number): string {
    if (count <= 2) return `单行 ${count} 格`;
    if (count <= 5) return "3+2 矩阵（上行 3 格、下行 2 格，按 shotNo 顺序填入，多出的位置留空）";
    if (count === 6) return "3+3 矩阵（上下各 3 格）";
    if (count <= 8) return "4+4 矩阵（上下各 4 格）";
    return `每行 4 格，按 shotNo 从左到右、从上到下顺序排布（共 ${count} 格）`;
}

/**
 * Module3 blockout 粗模故事板（06-video-prompt.md §〇）。
 * 故事板只锁镜序与构图，不画角色细节、不承担外观或色彩；直接文生图，避免参考图把错误细节带进成片。
 */
export function buildStoryboardPagePrompt(input: {
    rows: StoryboardRow[];
    shotContracts: ShotContract[];
    actionContracts: ActionContract[];
    spaceRules?: string;
    seams?: SeamContract[];
}): string {
    const shotContractById = new Map(input.shotContracts.map((contract) => [contract.shotId, contract]));
    const actionContractById = new Map(input.actionContracts.map((contract) => [contract.shotId, contract]));
    const rows = [...input.rows].sort((left, right) => left.shotNo - right.shotNo);
    const panels = rows.map((row, index) => {
        const shotContract = shotContractById.get(row.shotId);
        const actionContract = actionContractById.get(row.shotId);
        const isPov = /POV|主观|第一人称|视点/i.test(`${row.angle} ${shotContract?.endpoint || ""}`);
        // 三层空间语法：前景吃本镜唯一的主视觉任务，中景吃主体关系；分镜表没有逐格的背景字段，
        // 背景与 POV 锚点只能按空间合同补足，属已知缺口（上游补字段前不自己编内容）。
        const details = [
            `第${index + 1}格（shotNo ${row.shotNo}）`,
            `景别：${row.scale}（本格只有这一个景别）`,
            `机位角度：${row.angle}`,
            `前景（浅灰亮面，画面最大体块）：${row.action}${actionContract ? `；停在这一瞬间：${actionContract.process}` : ""}`,
            `中景（中灰暗面，体块小于前景）：${shotContract?.subjectRelation?.trim() || "按空间合同补足本镜的中景主体关系，不新增等权重主体"}`,
            "背景（深灰阴影，体块最小）：按空间合同补足该场景的背景暗示，至多 1 处",
            "体块大小与遮挡：前景主体最大，中景关系主体次之，背景暗示最小；前景可遮挡中景边缘，中景可遮挡背景，不得只写层级名称而不给大小关系与遮挡关系",
        ];
        if (isPov) details.push("POV 视点前景锚点：必须点明与本镜动作直接相关的可见锚点物；按空间合同与动作合同补足，没有可靠信息时不得凭空新增道具");
        if (shotContract) {
            details.push(`落点构图：${shotContract.endpoint}`);
            if (shotContract.inOut.include.length) details.push(`必须入画：${shotContract.inOut.include.join("、")}`);
            if (shotContract.inOut.exclude.length) details.push(`必须排除：${shotContract.inOut.exclude.join("、")}`);
        }
        return details.join("\n");
    });
    const spaceRules = input.spaceRules?.trim();
    // 缝合同要落进故事板的首末格（SKILL.md 铁律 11 ①③）：缝在画面上接死，不留给剪辑去救。
    const segmentId = rows[0]?.segmentId;
    const incomingSeam = input.seams?.find((seam) => seam.toSegmentId === segmentId);
    const outgoingSeam = input.seams?.find((seam) => seam.fromSegmentId === segmentId);
    const seamLines = [
        incomingSeam?.nextFirstPanel.trim()
            ? `首格（第 1 格）承接上一段：${incomingSeam.nextFirstPanel}。画的是同一个动作的后半段，禁止重新建立空间——不给新的环境全景，不重新交代人物位置与场景关系。${incomingSeam.scaleOrMotivation.trim() ? `缝两侧的景别与动机：${incomingSeam.scaleOrMotivation}。` : ""}`
            : "",
        outgoingSeam?.prevEndBeat.trim()
            ? `末格（第 ${rows.length} 格）交给下一段：${outgoingSeam.prevEndBeat}。动作画到中间态截止（下摇到一半、收手到一半、欲触未及），禁止画成动作已经完成的收势。${outgoingSeam.scaleOrMotivation.trim() ? `缝两侧的景别与动机：${outgoingSeam.scaleOrMotivation}。` : ""}`
            : "",
    ].filter(Boolean);
    const seamSection = seamLines.length ? `\n\n【缝合同（画进首末格，不是等剪辑去救）】\n${seamLines.join("\n")}` : "";

    return `生成该段 Module3 blockout 粗模故事板。它是三维预演稿、未贴图灰模，不是灰色的成片图，不追求成片质感，也不是草图线稿。
全部人物、道具与场景使用同一种哑光中性灰材质，保持均匀反照率；只使用柔和环境光遮蔽、单一主光和轻微补光来读清体块，不出现任何局部颜色或材质纹理。
blockout 只负责五件事：镜头机位、景别、人物在画面中的站位与体块关系、姿态动作、前中后景的纵深遮挡。除此之外一律不画。
画布 16:9 横版，画格排列 ${storyboardPanelLayout(rows.length)}。共 ${rows.length} 格，一格 = 一镜 = 一个时点 = 一个景别，按 shotNo 顺序排布；不合并格子、不拆格、不新增镜头、不编造机位。

【三层空间语法（构图的唯一合法写法）】
每格以前景、中景、背景三层锚定，各层按灰阶档位分开：前景=浅灰亮面，中景=中灰暗面，背景=深灰阴影。
禁止位置百分比语言——不许按“占画面 1/5”“画面左下区”这类百分比或分区方式落位，一律以前景、中景、背景三层落位。
禁止成品渲染词汇——除规定的哑光中性灰、均匀反照率、环境光遮蔽、单一主光与轻补光外，不写材质、光泽、空气感或表面质感。

【单镜单一视觉任务】
每格只有 1 个前景主体 + 至多 1 个背景暗示；一格承担 3 个及以上等权重视觉任务即不合格，辅助元素一律降为模糊小剪影。
一格只有一个景别值，不许一格囊括两个时间点，也不许一格同时呈现两个景别。一镜到底与长镜头已按起幅、过渡关键帧、落幅拆成独立画格，不得再合回一格。

【单镜物理可行性（景别决定这一格最多装得下多少东西，装不下就少画，不许硬塞）】
L5：最多 1 个主体局部 + 1 个相邻小元素。L4：单主体的一个完整部位。L3：上半身 + 手持物。L2：全身 + 手持物 + 少量环境。

【人物只用体块区分，外观与装备留给视频层】
人物一律做成简化人体粗模：头部是光滑卵形体块，不做五官，不做头发和胡须；身体只用概括体块交代体型差异、肩宽、四肢姿态与朝向。角色之间只靠壮实宽肩、瘦高、蓬松体积持杖这类体块差异区分。
装备只保留最大一级的体积轮廓：头顶戴东西只做一个概括方块或半球，躯干有护具只加一层板状体积，持杖只画一根光滑圆柱。不区分型号，不做零件，不画筒数、扣具、线缆、纹样或标识。装备的型号、零件、数量与人物外观一律由角色卡在视频生成时保真，不在故事板层解决。
道具与场景同样只做粗模：桌子只由板与腿组成，货物只画圆柱和方块堆，帐篷只画斜面与支杆。

【逐格画面】
${panels.join("\n\n")}

【空间与轴线规则】
${spaceRules || "同一角色在所有格中保持同一屏幕侧，摄影机不得跨越 180°轴线。"}${seamSection}

【禁制清单（命中任一条即判不合格）】
速度线、残影与运动模糊、同一角色在同一格里出现两次、漫画式分镜布局（对话框、气泡、台词框）、跨格共享元素、拟声词、天气效果的 emoji 或符号。
五官、头发、胡须、装备零件与重复结构细节（镜筒数、弹匣袋、扣具、线缆）、徽标、印花、迷彩纹样、材质纹理、表面质感、任何颜色；全图只能是同一种中性灰。
成片渲染（高光点、空气透视、环境光反射、雨水反光细节）、本镜指定室内时出现外景建筑全景、雷电成为画面主体、同一格里合并起手与收手两个动作阶段。
本段第 1 格禁止画成外景大远景建立镜头，也禁止场景空镜与角色静态入画。
基准风格只能是 blockout 三维未贴图灰模，禁止成片摄影、漫画、卡通、动画、插画风、手绘风、水墨、Q版——出现即判风格漂移。

调度信息只是内部构思，不许出现在画面上：因果锚点、主视觉任务标签、空间锚点编号、道具状态链一律不画、不写。画面禁止任何文字、台词、字幕、格号、标签、水印和 logo。同一角色跨格保持体块特征、姿态方向与屏幕侧一致。`;
}

/**
 * 首帧（plus 线已退役）。当前流程不生成或消费首帧组。
 * 保留本函数与 keyframes 这个 kind 纯为兼容旧画布：旧项目（如跑刀）打开、回看或重跑历史版本时仍会读到它，删了就打不开。
 * 方法论源 ai-short-drama S4：线稿是构图锁，定点修只改一处。
 */
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

const VIDEO_APPEARANCE_BINDING_SENTENCE =
    "all characters' faces, hairstyles, costumes and gear strictly match the character reference images, the storyboard reference defines only shot order and composition and never overrides appearance";

// 视频工作台：blockout 只定构图，资产卡定外观与颜色；文字显式标明参考图分工，避免 cano 平均权重稀释构图基准。
export function buildVideoWorkbenchPrompt(input: {
    rows: StoryboardRow[];
    shotContracts: ShotContract[];
    actionContracts: ActionContract[];
    anchors: string[];
    spaceRules?: string;
    lighting?: string;
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
        // 逐镜只取本镜自己的方位信息。空间合同是全段共用的长文档(场景布局+动线+轴线+俯视调度表),
        // 且它硬性要求写"主角恒左、反派恒右"必然命中方位正则——放进逐镜取值源会被复制 N 份,
        // 既稀释逐镜指令又把冗余持久化进 shotPrompts。它只在下方【空间与轴线规则】出现一次。
        const sideSources = [shotContract?.subjectRelation, shotContract?.endpoint]
            .map((value) => value?.trim() || "")
            .filter((value) => value && /画面左|画面右|屏幕左|屏幕右|左侧|右侧|左边|右边|恒左|恒右/.test(value));
        parts.push(
            `左右站位：${sideSources.length ? sideSources.join("；") : "按空间合同补足本镜谁在画面左、谁在画面右；没有可靠方位时不得凭空编造角色或左右关系"}`,
        );
        const shotPrompt = parts.join("；");
        shotPrompts[row.shotId] = shotPrompt;
        return `第${index + 1}镜（shotNo ${row.shotNo}）：${shotPrompt}`;
    });
    const anchors = input.anchors.length ? input.anchors.map((anchor) => `- ${anchor}`).join("\n") : "（无资产锚点）";
    const correction = input.note
        ? `\n\n【本次调整】\n只调整以下这一处：${input.note}\n其余镜头与参考保持一致。`
        : "";

    return {
        prompt: `原生多镜头直出该段视频（约 12-15 秒）。共 ${rows.length} 个镜头，与故事板格子逐一 1:1，按 shotNo 顺序衔接；不合并镜头、不新增机位，禁止首尾帧续接或硬拼。

【参考图分工（必须按文字显式执行）】
参考图列表中第 1 张是该段 Module3 blockout 故事板页，只作为构图基准，只定义镜序、机位、景别、人物左右站位与体块关系、姿态动作、前中后景纵深遮挡，永不覆盖外观。第 2 张起的角色、服装、场景、道具与色板资产卡是外观、装备、场景形态和颜色基准；人物长相、发型、服装和装备一律以角色参考图为准。本渠道会平均分配全部参考图权重，因此必须严格按这里点名的分工执行，不能依赖参考图顺序自行猜测用途。质感样板只提供织物/皮革/金属/地面的表面纹理、磨损程度、颗粒感与色调基准，不提供光位、光比与光线方向。

【布光基准（全段共用，逐镜不重复）】
${input.lighting?.trim() ? `分镜决策锁定表的结构化布光主策略：${input.lighting.trim()}。` : "布光一律以本段逐镜脚本与分镜决策锁定表的文字描述为准。"}任何参考图都不得决定光位、光比与光线方向。
${VIDEO_APPEARANCE_BINDING_SENTENCE}
${PALETTE_ANCHOR_SENTENCE}

【逐镜脚本（与格子 1:1）】
${panels.join("\n")}

【外观与资产锚点（逐字遵守）】
${anchors}

【空间与轴线规则（全段共用，逐镜不重复）】
${input.spaceRules?.trim() || "同一角色在所有镜中保持同一屏幕侧，摄影机不得跨越 180°轴线。"}

衔接规则：逐镜按脚本写死谁在画面左、谁在画面右，同一角色保持同一屏幕侧，摄影机不跨越 180°轴线；每镜一个动作并以物理后果改变结束状态。画面禁止字幕、水印和 logo。${correction}`,
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

export const AGENT_METHODOLOGY_BRIEF = "三铁律：分镜决策先锁后执行——锁定表一次锁死全局A表与逐段B表，后续只引用不复判；构图/布光/运镜/景别/表演/调色一律从封闭词库逐字选取，禁自创、禁“综合考虑/灵活运用”等架空措辞；分段以贴满15s打包连续因果画格为目标，真缝只落在场景/时间转换处，相邻段签缝合同（上段末拍收在中间态、本段首格接同一动作后半、景别跳≥2档或正反打、J/L声音桥）。每段四维多样性：运镜≥2种、景别跨度≥3档含极值、角度≥2种、构图≥2种。先定空间合同与180°轴线，主角恒左、反派恒右；每镜一个动作并以物理后果改变结束状态。台词从视频剥离独立成轨——出口对白只该角色做口型，OS旁白全段全员闭口。";

// 按环节的压缩方法论红线,供 Agent 工具结果再入用(非长 prompt;长纪律仍在各 build*Prompt)。
// 单一事实源;canvas-agent/src/config.ts 逐字镜像,agent-brief-sync 测试锁一致。勿改写字符串。
const STAGE_REDLINE_OVERRIDES: Partial<Record<ToonflowNodeKind, string>> = {
    "video-workbench": "视频工作台：参考图列表第1张blockout故事板页只定镜序、机位、景别、左右站位、姿态与纵深遮挡，永不覆盖外观；其余资产卡定人物长相、服装、装备与色彩；质感样板只提供织物/皮革/金属/地面的表面纹理、磨损程度、颗粒感与色调基准，不提供光位、光比与光线方向，布光只认分镜决策锁定表；画风参考禁用照片级真人质感的成片抽帧（实测拦截4/4）；逐镜写死谁在画面左、谁在画面右，追加逐字英文外观绑定句与ST色板锚定句；每镜与格子1:1，原生多镜头直出，禁止首尾帧续接或硬拼，不合并镜头、不新增机位。",
    "storyboard-page":
        "故事板页：出Module3 blockout粗模、三维预演稿、未贴图灰模，全部物体同一种哑光中性灰；只定镜头机位、景别、人物站位与体块关系、姿态动作、前中后景纵深遮挡，除此之外一律不画；16:9横版，画格排列3-5镜3+2、6镜3+3、7-8镜4+4，一格=一镜=一时点=一景别；每格按前景/中景/背景三层空间语法锚定（浅灰亮面/中灰暗面/深灰阴影），写明主体体块大小与遮挡，POV点明前景锚点物；人物用光滑卵形头部与概括体块区分，禁五官毛发，装备仅保留最大一级体积轮廓，禁型号/零件/数量/镜筒数/扣具/线缆/纹样/颜色，人物外观与装备由视频层角色卡承担；缝合同画进首末格——末格动作停在中间态、首格接同一动作后半且禁止重新建立空间；禁速度线/残影/同角色同格两次/漫画分镜布局/跨格共享元素/拟声词，禁成片摄影、漫画、卡通、动画、插画风、手绘风、水墨、Q版；故事板文生图，不传资产卡或色板，不追加ST色板锚定句。",
    keyframes: "首帧：plus线已退役，当前流程不生成、不引用首帧组，本环节默认跳过，仅为兼容旧画布保留。",
    creative: "创意：零铺垫冲突先行，二阶段冲击模型（冲击段前80%情绪7→10、终结段后20%情绪8→10），禁止建立世界观/场景引入/角色出场/过渡集等铺垫标签；有剧本走体检模式，对照七大爽点、四类结尾钩子、三付费卡点、六情绪弧线指出缺口，无剧本走碰撞法冷启动；信息钩已裁掉，出现即不合格。",
    "directing-lock": "分镜决策锁定表：一次性锁死全局A表与逐段B表，不可分步追加，后续环节只引用不复判；视觉风格/调色/布光/运镜/表演/构图/景别全部从封闭词库逐字选取；自检八条与四维多样性全过才算锁成；分段即分缝，相邻段的缝合同五行随表一并签(含音频边界:生成时就别造出跨缝的持续音)。",
    "continuity-table": "跨段状态继承表：全片一张、逐段更新，锁死桌面道具白名单、人物站位姿态、光向与天气、角色装备、遗留物；道具只许被角色的手改变，禁止凭空增减；天气必须反映到角色外观（雨=湿发湿衣或雨具）。",
    "storyboard-table": "分镜表：只读锁定表、只引用不复判；Layer1 决策前件（剧本原文锚定、上下文感知、黄金三秒钩子六字段、导演技法映射、母题出场、相邻段接缝）缺一不生成；分段以贴满15s打包连续因果画格为目标，真缝只落在场景/时间转换处；台词按出口对白/OS标注类型，OS段全员闭口。",
    "space-contract": "空间合同：先定点位＝空间合同，主角恒左、反派恒右，锁死180°轴线；复杂镜与运动镜先出俯视调度图（墙线+门洞+火柴人+虚线箭头的纯简化线稿）与运动方向锁——焰/尾迹方向=运动反方向，朝向改变必须有可见转身过程。",
};

export const STAGE_METHODOLOGY_REDLINES: Record<ToonflowNodeKind, string> = Object.fromEntries(
    TOONFLOW_NODE_KINDS.map((kind) => [kind, STAGE_REDLINE_OVERRIDES[kind] ?? AGENT_METHODOLOGY_BRIEF]),
) as Record<ToonflowNodeKind, string>;
