/**
 * 方法论源：D:\workspaces\ai-manga-workflow\.claude\skills\ai-short-drama-plus\references\05-closed-libraries.md
 * 同步日期：2026-07-21
 * 本文件是「分镜决策九大封闭命名词库」的逐字蒸馏版本；如与源文件冲突，以源文件为准。
 *
 * 保真规则（阻断级，违反视为本文件失效）：
 * 1. 词条名称与原文定义关键词均逐字抄自源文件，禁止改写、精简、意译、补充。
 * 2. 数量必须与源文件一致，不多不少（见 __tests__/closed-libraries.test.ts 的逐库计数断言）。
 * 3. 源文件未收录某词条独立定义时，keywords 留空字符串，并在 note 字段如实标注缺失原因；
 *    绝不允许杜撰关键词填充空白（源：05-closed-libraries.md「选取协议」阻断条件第 5 条）。
 */

/** 九大封闭命名词库的类别标识——用于 isInLibrary / renderLibraries 按类取子集 */
export type ClosedLibraryCategory =
    | "composition"
    | "lighting"
    | "cameraMovement"
    | "shotScale"
    | "performanceIntensity"
    | "colorGrade"
    | "emptyShot"
    | "directorStyle"
    | "hook";

/**
 * 词库词条的统一形状。各库列结构不同，字段含义按库注释说明：
 * - name：词条/档位名称，逐字抄自源文件，是 isInLibrary 校验用的唯一键。
 * - keywords：最接近"定义"的原文关键词/特征描述；源文件未收录独立定义时留空。
 * - english：英文对应术语、Prompt 关键词或公式（如源文件提供）。
 * - usage：适用范围/禁忌/叙事功能/典型使用等原文附注（如源文件提供，多项以"；"分隔）。
 * - note：源文件本身未收录该名称独立定义时的如实标注；不得据此杜撰 keywords。
 * - group：源文件内的子分组（目前仅调色 22 组使用，保留分组避免拉平合并）。
 */
export interface LibraryEntry {
    name: string;
    keywords: string;
    english?: string;
    usage?: string;
    note?: string;
    group?: string;
}

// ============================================================
// 1. 构图（源：05-closed-libraries.md §1）
// ============================================================

/** 构图 8 策略——分镜决策锁定表 B 表用（源：`分镜_99_导演决策协议.md` §0.3 + `情绪与节奏设计.md` 空间层映射表） */
export const COMPOSITION_LIBRARY: LibraryEntry[] = [
    { name: "权力压迫", keywords: "前景空，中景主体压到画框底部/角落，占比≤20%，背景上方大面积留空" },
    { name: "负空间吞噬", keywords: "前景空，中景主体偏居一侧1/3区，背景另一侧大面积留白" },
    { name: "对角线驱动", keywords: "前景可含对角线物体边缘，中景主体沿对角线排布，倾斜25-30°" },
    { name: "前景切割", keywords: "前景物占1/3-1/2画面（虚焦），中景主体被部分遮挡" },
    { name: "边缘出画", keywords: "前景可含主体局部出画边缘，中景主体大部分在画框外" },
    { name: "倾斜失衡", keywords: "中景主体随地平线倾斜5-15°偏置，背景线随之倾斜" },
    { name: "尺度反差", keywords: "前景小物体居中近距，中景极端大小对比的另一方" },
    { name: "纵深分层", keywords: "前景物→中景主体→背景环境三层清晰，主体被前后夹击" },
];
// 多样性阻断规则（源：`pipeline.md` §0.3）：全段同构图→阻断 / 同构图连续≥3段→阻断 / 居中对称≥50%→阻断。

/** 八大构图公式——英文 Prompt 公式库（源：`分镜_22_构图.md`），与上面的构图 8 策略是两个不同的封闭集，禁止混用 */
export const COMPOSITION_FORMULA_LIBRARY: LibraryEntry[] = [
    {
        name: "三分法 Rule of Thirds",
        keywords: "主体放三分线交叉点，画面温和不压抑，视线流动自然",
        english: "[主体], rule of thirds composition, subject on third intersection, balanced negative space, natural framing, cinematic breathing room",
        usage: "适用：自然/平衡/开阔，人物行走/旅途/抒情叙事；禁忌：信息过载时主体淹没",
    },
    {
        name: "对称构图 Symmetrical",
        keywords: "中轴对称，极度稳定或庄重压迫",
        english: "[主体], symmetrical composition, centered on vertical axis, balanced elements on both sides, formal, ritualistic, imposing",
        usage: "适用：秩序/仪式感/权力感，宫殿/对峙/正式场合；禁忌：过度使用=呆板",
    },
    {
        name: "引导线 Leading Lines",
        keywords: "道路/走廊/栏杆等线条将视线引向主体",
        english: "[主体], leading lines composition, strong converging lines drawing eye to subject, deep perspective, road or hallway vanishing point",
        usage: "适用：探索/命运/抉择，隧道/走廊/公路/楼梯；禁忌：线条无终点=失焦",
    },
    {
        name: "框架构图 Frame Within a Frame",
        keywords: "门框/窗框/拱门作为天然画框套住主体，聚焦视线",
        english: "[主体], frame within a frame, doorway framing subject, layered depth, voyeuristic observation, intimate focus",
        usage: "适用：偷窥感/聚焦/封闭，门缝/车窗/镜中/拱门；禁忌：框架过大=削弱聚焦",
    },
    {
        name: "对角线构图 Diagonal",
        keywords: "主体或动作沿对角线排布，制造张力与动感",
        english: "[主体], diagonal composition, subject on dynamic diagonal axis, tilted horizon 5-15°, unbalanced tension, kinetic energy",
        usage: "适用：不安/动感/冲突，追逐/打斗/倾斜世界；禁忌：连续使用=视觉疲劳",
    },
    {
        name: "三角形构图 Triangular",
        keywords: "主体形成稳定三角结构，古典绘画构图",
        english: "[主体], triangular composition, subjects forming pyramid structure, stable balanced arrangement, classical painting composition",
        usage: "适用：稳定/权威/古典，三人对话/家庭/权力层级；禁忌：不适合双人戏",
    },
    {
        name: "留白构图 Negative Space",
        keywords: "主体偏居一侧，大面积留白，孤独或期待感",
        english: "[主体], negative space composition, subject small in vast empty space, isolated, minimalist, contemplative loneliness",
        usage: "适用：孤独/渺小/期待，沙漠/雪原/空旷建筑/望向远方；禁忌：留白无意义=空洞",
    },
    {
        name: "中心构图 Center",
        keywords: "主体正中，强势直接，无歧义",
        english: "[主体], center composition, subject dead center, direct confrontation, unavoidable presence, stark simplicity",
        usage: "适用：直面/宣誓/对抗，角色独白/终极对峙/身份宣告；禁忌：连续使用=单调",
    },
];
// 三层构图模型（源：`分镜_22_构图.md`）：① 构图类型：选定策略 ② 主体位置：在画框中的精确位置和占比 ③ 空间层次：前中后景层次关系。

// ============================================================
// 2. 布光（源：05-closed-libraries.md §2）
// ============================================================

/**
 * 布光 10 方案——分镜决策锁定表 B 表用（源：`分镜_99_导演决策协议.md` §0.3）。
 * 查库说明（逐字保真，源文件明确写明）：这 10 个名称本身未在任何源文件中附带独立的原文定义关键词。
 * 前 5 项在 §2.2 有"语义最接近"的布光公式可供选取时类比参照（非同一封闭集，不得直接混用）；
 * 后 5 项连语义最接近的公式都未收录，仅存名称。
 */
export const LIGHTING_LIBRARY: LibraryEntry[] = [
    { name: "逆光剪影", keywords: "", note: "源文件无独立定义关键词；选取时可类比 §2.2「03 逆光/轮廓光 Backlighting」，非同一封闭集，不得直接混用" },
    { name: "顶光硬影", keywords: "", note: "源文件无独立定义关键词；选取时可类比 §2.2「05 顶光 Top Lighting」，非同一封闭集，不得直接混用" },
    { name: "侧光写实", keywords: "", note: "源文件无独立定义关键词；选取时可类比 §2.2「04 侧光 Side Lighting」，非同一封闭集，不得直接混用" },
    { name: "柔光漫射", keywords: "", note: "源文件无独立定义关键词；选取时可类比 §2.2「07 柔光 Soft Light」，非同一封闭集，不得直接混用" },
    { name: "底光威胁", keywords: "", note: "源文件无独立定义关键词；选取时可类比 §2.2「06 底光 Bottom Lighting」，非同一封闭集，不得直接混用" },
    { name: "窗光自然", keywords: "", note: "源库未收录同名公式，无原文定义关键词可抄，仅存名称" },
    { name: "烛光跳动", keywords: "", note: "源库未收录同名公式，无原文定义关键词可抄，仅存名称" },
    { name: "荧光管冷", keywords: "", note: "源库未收录同名公式，无原文定义关键词可抄，仅存名称" },
    { name: "闪电间歇", keywords: "", note: "源库未收录同名公式，无原文定义关键词可抄，仅存名称" },
    { name: "手电搜索", keywords: "", note: "源库未收录同名公式，无原文定义关键词可抄，仅存名称" },
];

/** 十大布光公式——英文 Prompt 公式库（源：`分镜_20_电影布光.md`） */
export const LIGHTING_FORMULA_LIBRARY: LibraryEntry[] = [
    {
        name: "伦勃朗光 Rembrandt Lighting",
        keywords: "光源：侧前方 45°、视平线以上。特征：暗侧眼下倒三角光斑，戏剧化明暗反差",
        english: "[主体], Rembrandt lighting, single key light from 45° upper side, distinctive triangle of light under the far eye, deep shadows, chiaroscuro, cinematic portrait",
        usage: "适用：深沉/力量感/古典肖像。禁忌：补光过强=三角光斑消失",
    },
    {
        name: "蝴蝶光 Butterfly Lighting",
        keywords: "光源：相机正前方、高角度俯打。特征：鼻下蝶形阴影，对称精致",
        english: "[主体], butterfly lighting (Paramount), frontal key light high above camera, butterfly-shaped shadow under nose, soft glamour, polished skin",
        usage: "适用：优雅/精致/女性肖像。禁忌：深眼窝需增加补光",
    },
    {
        name: "逆光/轮廓光 Backlighting",
        keywords: "光源：主体正后方。特征：边缘发光/发丝金边/体积光/剪影",
        english: "[主体], backlit, strong rim light, hazy atmosphere, golden hour edge glow, cinematic volumetric light",
        usage: "适用：浪漫/空灵/怀旧/回忆。搭配：正面适当补光防全黑",
    },
    {
        name: "侧光 Side Lighting",
        keywords: "光源：正侧方 90°。特征：半脸明亮半脸暗沉，强质感",
        english: "[主体], side lighting at 90°, half face illuminated half in deep shadow, hard single source, sharp shadow edges, dramatic contrast",
        usage: "适用：冲突/冷峻/强对抗。禁忌：放大面部瑕疵",
    },
    {
        name: "顶光 Top Lighting",
        keywords: "光源：正上方。特征：眼窝深陷阴影，神圣或压迫（看场景）",
        english: "[主体], top-down harsh lighting, deep eye socket shadows, single bare bulb from directly above, ominous interrogation lighting",
        usage: "适用：神殿神圣/审讯压迫。必须搭配场景定义",
    },
    {
        name: "底光 Bottom Lighting",
        keywords: "光源：正下方。特征：倒置反常阴影，诡异/恐怖",
        english: "[主体], uplighting from below, distorted facial shadows, eerie single low source, horror movie lighting",
        usage: "仅适配惊悚/恐怖/荒诞风格",
    },
    {
        name: "柔光 Soft Light",
        keywords: "光源：大面积漫射。特征：无锐利阴影，温柔治愈",
        english: "[主体], soft diffused lighting, large softbox, wraparound light, no harsh shadows, gentle healing atmosphere",
        usage: "适用：治愈/清新/唯美。禁忌：画面戏剧张力不足",
    },
    {
        name: "硬光 Hard Light",
        keywords: "光源：小型点光源。特征：阴影锐利如刀，硬朗纪实感",
        english: "[主体], harsh hard lighting, bare single bulb, razor-sharp shadow edges, gritty realistic texture",
        usage: "适用：硬朗/野性/纪实。禁忌：不适合唯美人像",
    },
    {
        name: "环形光 Loop Lighting",
        keywords: "光源：前侧 30-40° 上方。特征：鼻侧小型环形阴影，自然亲和",
        english: "[主体], loop lighting, key light 30-40° to side and above, small loop shadow beside nose, balanced contrast, natural look",
        usage: "万能通用款，几乎无禁忌",
    },
    {
        name: "分裂光 Split Lighting",
        keywords: "光源：正侧方 90°。特征：鼻梁中线严格左右对半，矛盾/分裂",
        english: "[主体], split lighting at 90°, face bisected light and dark, no fill light, stark chiaroscuro contrast, geometric composition",
        usage: "适用：矛盾人格/双重身份。禁忌：鼻梁扁平者分割效果弱",
    },
];
// 三层光影模型（源：`分镜_20_电影布光.md`）：① 主光意图：布光类型+角度+强度 ② 光质修饰：柔光/硬光+光源面积+补光 ③ 环境情境光：窗光/台灯/夕阳/霓虹等辅助光源。
// 布光×题材联动：东方仙侠→逆光/顶光 · 都市情感→柔光环形光/蝴蝶光 · 悬疑探案→侧光硬光/顶光 · 霸道总裁→伦勃朗/蝴蝶光 · 古装宫廷→伦勃朗逆光/顶光 · 惊悚恐怖→底光硬光/侧光 · 热血动作→硬光侧光/逆光。

// ============================================================
// 3. 运镜（源：05-closed-libraries.md §3）
// ============================================================

/**
 * 运镜 8 种——分镜决策锁定表 B 表用（源：`分镜_99_导演决策协议.md` §0.3 + `情绪与节奏设计.md` §4.1）。
 * 「滑轨侧跟」「固定位微动」源库无独立定义关键词，仅存名称，选取时按名称直译执行，不得自创扩展定义。
 */
export const CAMERA_MOVEMENT_LIBRARY: LibraryEntry[] = [
    { name: "急推/急拉", keywords: "快速景别变化，用于情绪爆发点" },
    { name: "手持跟拍", keywords: "轻微晃动，用于紧张/逃跑/对峙" },
    { name: "升降镜头", keywords: "上下空间转换，用于权力关系表达", note: "原文名「升降」" },
    { name: "甩镜/快摇", keywords: "快速空间切换，用于惊吓/发现" },
    { name: "环绕镜头", keywords: "围绕主体旋转，用于孤立感/被包围", note: "原文名「环绕」" },
    { name: "低角度推进", keywords: "自下而上压迫感" },
    {
        name: "滑轨侧跟",
        keywords: "",
        note: "源库未收录该名称的独立定义关键词，仅在《分镜_99》§0.3 封闭清单中列名，选取时按名称直译（滑轨横向平行跟随）执行，不得自创扩展定义",
    },
    {
        name: "固定位微动",
        keywords: "",
        note: "源库未收录该名称的独立定义关键词，仅存名称，选取时按名称直译（机位固定、画面内极小幅度呼吸感位移）执行，不得自创扩展定义",
    },
];

/** 基础运镜库（源：`分镜_21_运镜.md`）；keywords 对应源表"叙事功能"列 */
export const CAMERA_MOVEMENT_BASIC_LIBRARY: LibraryEntry[] = [
    { name: "推镜 (Dolly In)", english: "slow dolly in, camera pushing forward toward subject", keywords: "逼近/聚焦/情绪升温" },
    { name: "拉镜 (Dolly Out)", english: "slow dolly out, camera pulling back from subject", keywords: "疏离/揭示环境/孤独" },
    { name: "摇镜 (Pan)", english: "smooth pan left/right, camera rotating on tripod", keywords: "扫描空间/跟随视线" },
    { name: "俯仰 (Tilt)", english: "slow tilt up/down, camera tilting vertically", keywords: "揭示高度/权力展示" },
    { name: "跟镜 (Tracking)", english: "tracking shot following subject, side parallel movement", keywords: "陪伴/跟随/旅程感" },
    { name: "升镜 (Crane Up)", english: "crane shot rising, camera elevating smoothly", keywords: "超越/升华/俯瞰全局" },
    { name: "降镜 (Crane Down)", english: "crane shot descending, camera lowering", keywords: "降临/落地/进入场景" },
    { name: "手持 (Handheld)", english: "slight handheld camera, subtle natural shake", keywords: "纪实/紧张/真实感" },
    { name: "稳定器 (Steadicam)", english: "steadicam shot, smooth floating movement", keywords: "流畅跟随/沉浸感" },
    { name: "轨道环绕 (Orbit)", english: "orbital camera movement, circling around subject", keywords: "审视/全方位展示" },
];

/** 特殊运镜库（源：`分镜_21_运镜.md`）；keywords 对应源表"叙事功能"列 */
export const CAMERA_MOVEMENT_SPECIAL_LIBRARY: LibraryEntry[] = [
    { name: "快速变焦 (Crash Zoom)", english: "crash zoom, rapid zoom in on subject", keywords: "冲击/震惊/喜剧" },
    { name: "甩镜 (Whip Pan)", english: "whip pan, fast blurred camera swing", keywords: "能量转换/场景切换" },
    { name: "变焦推拉 (Dolly Zoom)", english: "dolly zoom, vertigo effect, background compresses while subject stays", keywords: "心理崩塌/认知颠覆" },
    { name: "焦点转移 (Rack Focus)", english: "rack focus, focus shifts from foreground to background", keywords: "揭示/注意力转移" },
    { name: "慢动作 (Slow Motion)", english: "slow motion, time decelerates to emphasize moment", keywords: "情绪高潮/关键瞬间" },
    { name: "延时 (Time-lapse)", english: "time-lapse, accelerated passage of time", keywords: "时间流逝/场景过渡" },
];
// 运镜转写规则（源：`分镜_21_运镜.md`）：每个运动镜头必须写明起点方向 → 速度（缓/常/急）→ 停点。
// 例：✓「摄影机从门口方向缓推进至收银台，停在她的背影后」 ✗「运镜」「动态镜头」「高级运镜」

// ============================================================
// 4. 景别（源：05-closed-libraries.md §4，`分镜_02_导演逻辑.md` §四）
// ============================================================

/** 景别 L0-L5 六档；name 为"档位 中文术语"组合，english 为英文术语，keywords 为适用画面，usage 汇总叙事功能/典型使用/时长 */
export const SHOT_SCALE_LIBRARY: LibraryEntry[] = [
    {
        name: "L0 大远景/建立",
        english: "Extreme Wide / Establishing",
        keywords: "看不到人只见天地",
        usage: "叙事功能：建立时空/气势/渺小感；典型使用：段首/章首/转场；典型单镜时长（无台词）：4-6s",
    },
    {
        name: "L1 远景/全景",
        english: "Wide / Long Shot",
        keywords: "人在环境中完整可见",
        usage: "叙事功能：空间关系/人环境比例；典型使用：段首后第一镜/进入新空间；典型单镜时长（无台词）：3-5s",
    },
    {
        name: "L2 中景/中全景",
        english: "Medium Wide / Medium Shot",
        keywords: "膝盖以上",
        usage: "叙事功能：动作主线/人际关系；典型使用：段内动作推进（禁止作为唯一景别堆积）；典型单镜时长（无台词）：3-4s",
    },
    {
        name: "L3 近景/中近景",
        english: "Medium Close-Up",
        keywords: "胸部以上",
        usage: "叙事功能：对白主轴/反应/情绪过渡；典型使用：对白段/微表情；典型单镜时长（无台词）：2-3s",
    },
    {
        name: "L4 特写",
        english: "Close-Up",
        keywords: "面部/局部",
        usage: "叙事功能：情绪放大/关键时刻/信息揭示；典型使用：情绪高潮/决定性瞬间/关键接触；典型单镜时长（无台词）：1-2s",
    },
    {
        name: "L5 极特写/微距",
        english: "Extreme Close-Up / Macro",
        keywords: "局部细节",
        usage: "叙事功能：视觉证据/符号显形/隐喻落点；典型使用：关键道具/隐喻/信息爆点；典型单镜时长（无台词）：0.5-1s",
    },
];
// 台词优先：有台词的镜头时长由 `分镜_99_导演决策协议.md` D2.5 决定，不适用上表时长参考值。
// 强制规则（源：`分镜_02_导演逻辑.md` §四）：
// - 镜数 ≥ 4：L4 特写 ≥ 1（情绪段 ≥ 2）；L0/L1 远景系 ≥ 1
// - 镜数 ≥ 6：L2 中景不得连续超 2 镜；连续 3 镜 L2 必须插入 L4 或空镜打断
// - 长镜头（15s 内）内含 ≥ 1 次景别变化（推近到 L3-L4 或拉远到 L0-L1）
// - 关键动作接触（握手/接物/触碰/推门/签字/按下）必须 L4-L5 特写

// ============================================================
// 5. 表演（源：05-closed-libraries.md §5，`分镜_31_表演表情.md`）
// ============================================================
// 核心铁律：抽象情绪词 = 0；可观测物理细节 = 100%。

/** 表演强度 L1-L5 五档；keywords 对应源表"面部幅度"列，usage 汇总"身体联动"与"适合类型" */
export const PERFORMANCE_INTENSITY_LIBRARY: LibraryEntry[] = [
    { name: "L1 微表情", keywords: "仅单肌群微动", usage: "身体联动：几乎无；适合类型：悬疑、心理战" },
    { name: "L2 克制", keywords: "多肌群≤60%", usage: "身体联动：手部微动；适合类型：都市情感、职场" },
    { name: "L3 自然", keywords: "正常幅度", usage: "身体联动：中度联动；适合类型：青春校园、甜宠" },
    { name: "L4 戏剧化", keywords: "略大于日常", usage: "身体联动：大幅联动；适合类型：热血动作、仙侠" },
    { name: "L5 爆发", keywords: "接近生理最大", usage: "身体联动：全身+环境反馈；适合类型：虐心高潮、生死时刻" },
];
// arc_intensity → 强度映射：0-20→L1 / 20-40→L2 / 40-60→L3 / 60-80→L4 / 80-100→L5。
// 单镜头约束（3-5秒）：≤3个动作 = 1主体动作 + 1微动作陪衬 + 1身体联动。

/** 五部位动作编码（源：§5.2）；keywords 为编码维度，usage 为源文件示例 */
export const PERFORMANCE_BODY_PART_CODING: LibraryEntry[] = [
    { name: "①头部", keywords: "角度+幅度+速度", usage: "示例：头偏向一侧约10度" },
    { name: "②肩背", keywords: "紧张度+位移", usage: "示例：肩膀微僵——比自然状态上提约2cm" },
    { name: "③手部", keywords: "对象+力度+频率", usage: "示例：手指无意识揉搓袖口，指节微泛白" },
    { name: "④身形", keywords: "方向+幅度+距离", usage: "示例：上半身前倾15度——停在半步距离" },
    { name: "⑤身段", keywords: "整体气质", usage: "示例：古典闺秀/京剧老生/现代舞者/松弛市井" },
];

/** 12 种高频情绪模板（源：§5.3）；keywords 为模板全文逐字抄录（微表情层+肢体动作层+生理细节+光影参数） */
export const PERFORMANCE_EMOTION_TEMPLATES: LibraryEntry[] = [
    {
        name: "悲伤（隐忍）",
        keywords: "眉头内端微抬，下眼睑从内向外渐泛红，泪膜在睫毛根部聚积强忍不落；下巴微收，喉结缓慢滚动，指尖掐进手掌至发白；呼吸从平稳渐变急促又被迫压回。冷调侧光。",
    },
    {
        name: "喜悦（内敛）",
        keywords: "眼角先于嘴角：外眼角挤出极细纹路，下眼睑微推上；嘴角从外端被眼角\"带动\"上扬；肩膀从微绷变放松下沉，头部轻偏5-10度。暖调柔光。",
    },
    {
        name: "愤怒（压制）",
        keywords: "下颌咬紧咬肌隆起，颈侧颈动脉搏动；鼻孔微张，呼吸粗重；垂侧拳头渐握至指节发白——面部保持克制，仅眉间极浅竖纹。低角度仰拍，单侧伦勃朗光。",
    },
    {
        name: "恐惧（渐进）",
        keywords: "0-1秒脖颈微僵转头减速；1-2秒上半身不自觉后倾，喉结快滚，舌尖无意识舔下唇；2-4秒呼吸变浅变快。冷调暗光，深景浅焦。",
    },
    {
        name: "惊讶（冲击）",
        keywords: "眉毛瞬间抬高、嘴微张停在齿间、瞳孔先骤缩后缓慢放大；上半身微后退再前倾。瞬间冷白HDR光。",
    },
    {
        name: "厌恶（社交克制）",
        keywords: "鼻孔轻微收缩，上唇微提露出上排齿根；头部轻后仰2-3cm，躯干微后倾；恢复时面部不对称复位。中性漫反射光。",
    },
    {
        name: "思念/怅然",
        keywords: "目光失焦看向中景，头微偏15度；瞳孔微放大，眨眼频率减半；手指无意识摩挲旧物；胸腔起伏变深变慢。暖调逆光勾剪影，背景虚化。",
    },
    {
        name: "紧张/撒谎",
        keywords: "眨眼频率加快至1.5-2倍，瞳孔微放大；喉结滚动增加，唇干致舌尖舔下唇；手指无意识揉搓袖口。浅景深。",
    },
    {
        name: "心动（暗恋）",
        keywords: "瞳孔微放大+眼睫颤动两下+眼尾泛红，视线弹开0.8秒后偷瞄回来；指尖掐衣角，身体前倾又后撤——反复两次停半步距离。柔光暖调。",
    },
    {
        name: "震惊（信息冲击）",
        keywords: "瞳孔骤缩如针尖保持0.3秒后缓慢放大，视线锁定信源；眉毛抬高+额肌+皱眉肌各50%力度；嘴微张未发声。冷调高对比。",
    },
    {
        name: "崩溃（防线击穿）",
        keywords: "0-1秒表情清零→1-3秒咬唇+眼眶渐红→3-6秒强行眨眼→6-7秒嘴唇防线松脱下唇颤抖→7-10秒单手抬到半空→10-15秒第一滴泪滑落。冷调自然光。",
    },
    {
        name: "强颜欢笑",
        keywords: "嘴角上扬但只到平时一半——眼轮匝肌未同步收缩造成假笑；瞳孔轻度放大暴露真实情绪。中性光。",
    },
];
// 铁律与避坑（源：§5.4）：
// - 抽象情绪词 = 0：禁止"冷静地看着""愤怒"等形容词，必须用 {身体部位}+{具体动作}+{力度/速度/方向}+{与物品/空间关系}。
// - 三层结构体系：微表情层（器官+运动）/ 肢体动作层（部位+幅度+力度）/ 情绪气质层（一个词定调，只在首尾各声明一次不展开）。
// - 时间轴纪律：禁止跳变；眼部永远先于嘴部（提前0.3-0.5秒）；身体滞后面部0.5-1秒；每秒≤2个肌肉变化。
// - 边界限制（提示词末尾必须包含）：尺度：表演在真人范畴内，不卡通化。一致性：角色五官锁定为资产卡设定，全片段不漂移不换脸。
//   稳定性：人物面部稳定，无明显畸变。节奏：情绪递进经过完整"铺垫→转折→爆发"，不跳变。排除：无表情包化、无五官扭曲、无卡通变形、无画面闪烁。

/**
 * 微表演六层次（源：§5.5，外部增补 2026-07-18，来源「我的电影Skill」，非社区①源）。
 * 与 L1-L5 力度分档正交：L1-L5 管力度，本节管微观颗粒度；与 §5.4 时间轴纪律兼容（眼先于嘴 0.3-0.5s 不变）。
 * 静止时保留呼吸微动态；prompt 禁止用 stiff / static 描述人物姿态。
 */
export const PERFORMANCE_MICRO_LAYERS: LibraryEntry[] = [
    { name: "眼神先动", keywords: "情绪变化从眼睛开始——收缩/聚焦/游离，先于身体动作出现" },
    { name: "无意识小动作", keywords: "喉结轻微吞咽、手指微动、下颌轻收等无意识身体细节" },
    { name: "呼吸带动肩膀起伏", keywords: "激动时起伏明显，平静/克制时起伏细微" },
    { name: "决定/开口前眼神短暂游离", keywords: "内观感，视线短暂离开目标再锁回" },
    { name: "说话前轻微吞咽", keywords: "开口台词前有一次 barely-visible swallow" },
    {
        name: "不对称表情",
        keywords: "左右不完全对称（如 `slightly asymmetrical expression — left eye more tense than right`），避免程式化僵硬",
    },
];

// ============================================================
// 6. 调色 22 组（源：05-closed-libraries.md §6，`分镜_07_调色.md`）
// ============================================================
// 所有调色指令末尾追加 `but avoid over-color grading`。

/** 调色 22 组，含 group 字段保留源文件的四个子分组（基础6/影视工业6/情绪类型片6/质感风格化4），不拉平合并 */
export const COLOR_GRADE_LIBRARY: LibraryEntry[] = [
    // 基础 6 款
    { group: "基础6款", name: "暖金调", english: "Warm Golden Color Grade", keywords: "金黄/橙黄/琥珀，光线温润", usage: "适用：温情/怀旧/黄昏/史诗" },
    { group: "基础6款", name: "冷蓝调", english: "Cool Blue Color Grade", keywords: "青蓝/冷灰蓝，清冷", usage: "适用：孤独/理性/悬疑/雪景" },
    { group: "基础6款", name: "去饱和", english: "Desaturated Color Grade", keywords: "色彩克制暗沉", usage: "适用：纪实/犯罪/都市现实" },
    { group: "基础6款", name: "高对比", english: "High Contrast Color Grade", keywords: "明暗反差极强", usage: "适用：夜景/动作/戏剧冲突" },
    { group: "基础6款", name: "低对比", english: "Low Contrast Color Grade", keywords: "柔和自然无死黑", usage: "适用：文艺片/日常/温情" },
    { group: "基础6款", name: "单色统调", english: "Monochromatic Color Grade", keywords: "单一主色调支配", usage: "适用：情绪强化/概念视觉" },
    // 影视工业 6 款
    { group: "影视工业6款", name: "青橙调", english: "Teal and Orange Color Grade", keywords: "青蓝暗部+橙黄亮部，经典好莱坞", usage: "适用：科幻/动作/都市" },
    { group: "影视工业6款", name: "赛博朋克", english: "Cyberpunk Color Grade, neon blue and magenta", keywords: "霓虹蓝紫+暗部青黑", usage: "适用：科幻/未来/夜市" },
    { group: "影视工业6款", name: "暗黑色调", english: "Noir Color Grade, deep blacks with silver highlights", keywords: "深黑+银白高光", usage: "适用：黑色电影/悬疑/犯罪" },
    { group: "影视工业6款", name: "复古胶片", english: "Vintage Film Color Grade, faded warm tones", keywords: "褪色暖调+胶片颗粒", usage: "适用：怀旧/年代戏/回忆" },
    { group: "影视工业6款", name: "冷峻科技", english: "Sterile Cool Color Grade, clinical whites", keywords: "干净白+蓝灰冷调", usage: "适用：科幻/实验室/医疗" },
    { group: "影视工业6款", name: "自然纪实", english: "Natural Documentary Color Grade", keywords: "真实色彩无风格化", usage: "适用：纪实/生活流" },
    // 情绪类型片 6 款
    { group: "情绪类型片6款", name: "恐怖冰冷", english: "Horror Cold Color Grade, desaturated blue-green", keywords: "去饱和蓝绿+冷暗", usage: "适用：恐怖/惊悚" },
    { group: "情绪类型片6款", name: "浪漫柔焦", english: "Romantic Soft Color Grade, warm blush tones", keywords: "暖粉柔+柔焦高光", usage: "适用：爱情/甜宠" },
    { group: "情绪类型片6款", name: "悲怆暗调", english: "Melancholic Color Grade, muted earth tones", keywords: "土色暗沉+低压", usage: "适用：悲剧/沉重剧情" },
    { group: "情绪类型片6款", name: "青春明亮", english: "Bright Youth Color Grade, vibrant pastel", keywords: "明亮粉色+高饱和", usage: "适用：校园/青春/喜剧" },
    { group: "情绪类型片6款", name: "史诗宏大", english: "Epic Color Grade, rich golden and deep shadows", keywords: "金色+深影+宏大", usage: "适用：古装/战争/史诗" },
    { group: "情绪类型片6款", name: "沙漠暖荒", english: "Desert Warm Color Grade, sun-bleached tones", keywords: "日晒褪色+沙尘暖", usage: "适用：废土/西部/荒漠" },
    // 质感风格化 4 款
    { group: "质感风格化4款", name: "东方水墨", english: "Ink Wash Color Grade, muted blacks with subtle cyan", keywords: "淡墨黑+微青，留白气韵", usage: "适用：仙侠/古风/东方美学" },
    { group: "质感风格化4款", name: "高饱和波普", english: "Pop Art Color Grade, saturated primary colors", keywords: "高饱和原色+波普", usage: "适用：喜剧/广告/风格化" },
    { group: "质感风格化4款", name: "黑白电影", english: "Black and White Film Grade, rich grayscale", keywords: "纯黑白+丰富灰阶", usage: "适用：艺术/闪回/纪念" },
    { group: "质感风格化4款", name: "日系清新", english: "Japanese Fresh Color Grade, slight overexposure", keywords: "微过曝+淡蓝绿+清新", usage: "适用：日系/治愈/日常" },
];

// ============================================================
// 7. 空镜 A-E（源：05-closed-libraries.md §7，`分镜_02_导演逻辑.md` §五）
// ============================================================

/** 空镜 A-E 五类；usage 汇总"典型画面"与"强制位置" */
export const EMPTY_SHOT_LIBRARY: LibraryEntry[] = [
    { name: "A. 环境空镜", english: "Establishing Insert", keywords: "交代时空/空间全貌", usage: "典型画面：远景/天空/街道/窗外天气；强制位置：段首/场景转换" },
    { name: "B. 道具空镜", english: "Prop Insert", keywords: "替代表演/交代物证", usage: "典型画面：信/凉茶/落灰物件/钟表；强制位置：重要对白/情绪高潮后" },
    { name: "C. 情绪空镜", english: "Mood Insert", keywords: "渲染情绪/替人物说不可说", usage: "典型画面：烛火/雨滴/晃窗帘/烟；强制位置：段中情绪节点/段尾收束" },
    { name: "D. 细节空镜", english: "Detail Insert", keywords: "释放隐藏信息/视觉证据", usage: "典型画面：泪/指纹/手部微动作/标识；强制位置：关键信息揭示/隐喻显形" },
    { name: "E. 转场空镜", english: "Transition Insert", keywords: "完成场景/段落转换", usage: "典型画面：与下场景共享元素；强制位置：场景/段落转换处" },
];
// 空镜五要素（缺一不成立）：① 环境（空间/天气/时间段） ② 主体即"物"（具体道具/物件/自然元素） ③ 状态（摇晃/静止/破碎/完整/亮/灭）
// ④ 关联（与本场戏剧情/角色情绪的具体关联，必须可解释） ⑤ 声音（如适用，环境音/拟音：雨声/滴答/风/钟摆）。
// 空镜红线：1-2 秒为宜，超过 2 秒视为打断剧情；内容必须与剧情有关，禁止"漂亮但无关"。

// ============================================================
// 8. 导演风格 9 种（源：05-closed-libraries.md §8，`分镜_24_导演风格词库.md`）
// ============================================================

/** 导演风格 9 种；源表仅"风格名 + 英文关键词"两列，keywords 留空、内容在 english 字段 */
export const DIRECTOR_STYLE_LIBRARY: LibraryEntry[] = [
    { name: "电影感写实", keywords: "", english: "cinematic realism, live action photography, natural lighting, volumetric light, atmospheric haze, large format film, 65mm film grain" },
    { name: "唯美梦幻", keywords: "", english: "emotional color aesthetic, Christopher Doyle style, dreamy bokeh, neon noir, slow shutter motion blur, romantic chiaroscuro" },
    { name: "赛博朋克", keywords: "", english: "cyberpunk aesthetic, futuristic dystopian, neon drenched, holographic lighting, rain-soaked streets" },
    { name: "复古胶片", keywords: "", english: "vintage film aesthetic, Kodak Vision3, warm tungsten lighting, film grain texture, anamorphic lens flare" },
    { name: "极简现代", keywords: "", english: "minimalist modern, natural immersive lighting, continuous natural light, long take aesthetic, clean geometry" },
    { name: "暗黑哥特", keywords: "", english: "dark gothic, Tim Burton aesthetic, high contrast chiaroscuro, candlelit warmth, Baroque shadows" },
    { name: "清新日系", keywords: "", english: "Japanese minimalism, Kore-eda style, soft natural daylight, pastel color palette, tranquil contemplative" },
    { name: "华丽宫廷", keywords: "", english: "lavish palace, symmetrical composition, jewel tones, ornate Baroque, theatrical staging" },
    { name: "纪实风格", keywords: "", english: "documentary realism, Dardenne brothers style, handheld intimacy, available light, social realism" },
];

/** 拍摄手法附加库（同源文件 §8，可与主风格叠加） */
export const DIRECTOR_STYLE_FILMING_TECHNIQUES: LibraryEntry[] = [
    { name: "上帝视角移轴", keywords: "", english: "tilt-shift photography, top-down angle, miniature effect, diorama aesthetic" },
    { name: "手持跟拍纪实", keywords: "", english: "handheld camera, documentary style, shaky cam, cinéma vérité, immersive subjective POV" },
    { name: "稳定器流畅", keywords: "", english: "steadicam smooth movement, fluid camera motion, continuous long take, seamless transition" },
    { name: "固定镜头长拍", keywords: "", english: "static camera, Ozu style, tatami shot perspective, contemplative framing, poetic stillness" },
    { name: "斯坦尼康环绕", keywords: "", english: "Steadicam orbital, Kubrick symmetry, 360-degree reveal, elegant circling, spatial choreography" },
];

/**
 * 第 10 档·电影胶片堆料——重型预设，外部增补 2026-07-18，用户钦定（电影感/写实项目可选默认风格）。
 * 不计入导演风格 9 种主清单，独立导出，避免污染 9 的计数断言。
 */
export const DIRECTOR_STYLE_FILM_GRAIN_HEAVY_PRESET: LibraryEntry = {
    name: "第10档 · 电影胶片堆料",
    keywords: "",
    english:
        "Shot on 35mm Kodak Vision3 500T film stock, analog film grain, practical light only, Christopher Doyle cinematography, Wong Kar-wai painterly desaturation, photochemical film texture, slight halation on highlights, organic film noise, heavy atmospheric haze, film print look, photorealistic film still aesthetic, Denis Villeneuve cinematic realism, IMAX anamorphic widescreen, 2.39:1 aspect ratio",
    usage:
        "① 照片级写实真人风格——autoCompliance=0 的\"非真人 CG\"过审杠杆可能失效，选用时每条提示词必过 08-audit-compliance.md 避雷检查；" +
        "② 画幅适配——竖版 9:16 项目使用时删去末尾 \"IMAX anamorphic widescreen, 2.39:1 aspect ratio\" 两词、保留胶片质感词，横版电影感项目全串照用；" +
        "③ 胶片颗粒/去饱和/雾气对细节差异有\"遮瑕\"效果，跨镜观感一致性会被动提升，但不替代资产参考图与故事板的硬锚定",
    note: "来源：外部参考「我的电影Skill」，非社区①源",
};

// ============================================================
// 9. 开场钩子 4 类（源：05-closed-libraries.md §9，`分镜_05_开篇卡点.md` §2.3）
// ============================================================

/** 开场钩子 4 类；usage 对应源表"0-3s 典型画面"列 */
export const HOOK_LIBRARY: LibraryEntry[] = [
    { name: "强冲突", keywords: "制造对抗张力——双方物理接触或即将接触", usage: "0-3s典型画面：耳光、摔门、两剑相交、双方距离从 300cm 急缩到 15cm" },
    { name: "强危机", keywords: "制造生存威胁——生命或命运悬于一线", usage: "0-3s典型画面：悬崖边缘、刀架脖颈、倒计时归零、指甲抠进窗沿仅余最后一节" },
    { name: "强福利", keywords: "制造视觉/情感冲击——一个画面包含多重信息", usage: "0-3s典型画面：绝美登场、身份揭露、一个眼神包含爱恨歉疚三重信息" },
    { name: "强反差", keywords: "制造认知颠覆——观众预期与画面发生剧烈冲突", usage: "0-3s典型画面：柔弱女子的致命一击、善良面孔的冷血眼神、日常动作中隐藏的杀招" },
];
// 信息钩已被源库移除：与"信息在冲突进程中自然释放"原则矛盾，改为在冲突对白/动作推进中自然嵌出，不作为独立钩子类型选取。

// ============================================================
// 校验与渲染工具
// ============================================================

/** 九大封闭命名词库——isInLibrary / renderLibraries 按 category 取用的唯一事实源 */
const CANONICAL_LIBRARIES: Record<ClosedLibraryCategory, { label: string; entries: LibraryEntry[] }> = {
    composition: { label: "构图 8 策略", entries: COMPOSITION_LIBRARY },
    lighting: { label: "布光 10 方案", entries: LIGHTING_LIBRARY },
    cameraMovement: { label: "运镜 8 种", entries: CAMERA_MOVEMENT_LIBRARY },
    shotScale: { label: "景别 L0-L5", entries: SHOT_SCALE_LIBRARY },
    performanceIntensity: { label: "表演强度 L1-L5", entries: PERFORMANCE_INTENSITY_LIBRARY },
    colorGrade: { label: "调色 22 组", entries: COLOR_GRADE_LIBRARY },
    emptyShot: { label: "空镜 A-E", entries: EMPTY_SHOT_LIBRARY },
    directorStyle: { label: "导演风格 9 种", entries: DIRECTOR_STYLE_LIBRARY },
    hook: { label: "开场钩子 4 类", entries: HOOK_LIBRARY },
};

/** 校验某个词是否在指定封闭词库内——供检查器判断模型选词是否越出封闭集使用 */
export function isInLibrary(category: ClosedLibraryCategory, term: string): boolean {
    const target = term.trim();
    if (!target) return false;
    return CANONICAL_LIBRARIES[category].entries.some((entry) => entry.name === target);
}

/**
 * 按类取子集，渲染成可直接拼进 prompt 的文本。调用方（如 buildNodeContext）的上下文上限是 8000 字符，
 * 因此只取需要的几类，不做全量输出；具体注入哪几类由各环节的 prompt 构建函数决定。
 */
export function renderLibraries(categories: ClosedLibraryCategory[]): string {
    return categories
        .map((category) => {
            const { label, entries } = CANONICAL_LIBRARIES[category];
            const lines = entries.map((entry) => {
                const definition = entry.keywords || entry.note || "（源无独立定义）";
                return `- ${entry.name}：${definition}`;
            });
            return `【${label}】\n${lines.join("\n")}`;
        })
        .join("\n\n");
}
