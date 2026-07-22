import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_PORT = 17371;
export const CONFIG_DIR = path.join(os.homedir(), ".infinite-canvas");
export const CONFIG_FILE = path.join(CONFIG_DIR, "canvas-agent.json");
export const VERSION = readPackageVersion();

// Toonflow 短剧方法论注入(决议 8B)。单一事实源 = web/src/lib/toonflow/prompts.ts 的 AGENT_METHODOLOGY_BRIEF,
// 禁止在此改写;改动务必同步两处——web 的 agent-brief-sync 测试会逐字锁定一致,漂移即测试失败。
// 目的:Agent 规划/生成短剧视频与分镜时守 ai-short-drama-plus 方法论——先锁后执行、封闭词库逐字选取、缝在装配层消灭。
export const TOONFLOW_METHODOLOGY_BRIEF =
    "三铁律：分镜决策先锁后执行——锁定表一次锁死全局A表与逐段B表，后续只引用不复判；构图/布光/运镜/景别/表演/调色一律从封闭词库逐字选取，禁自创、禁“综合考虑/灵活运用”等架空措辞；分段以贴满15s打包连续因果画格为目标，真缝只落在场景/时间转换处，相邻段签缝合同（上段末拍收在中间态、本段首格接同一动作后半、景别跳≥2档或正反打、J/L声音桥）。每段四维多样性：运镜≥2种、景别跨度≥3档含极值、角度≥2种、构图≥2种。先定空间合同与180°轴线，主角恒左、反派恒右；每镜一个动作并以物理后果改变结束状态。台词从视频剥离独立成轨——出口对白只该角色做口型，OS旁白全段全员闭口。";

export const AGENT_PROMPT = "你正在帮助用户操作 Infinite Canvas 网站。切换网站页面用 site_navigate，可跳 / (首页)、/canvas (我的画布)、/canvas/:id (指定画布)、/image、/video、/prompts、/assets、/config。需要改动画布时优先使用已配置的 infinite-canvas MCP 工具：先 canvas_get_state 读取当前画布，再根据任务使用 canvas_create_text_node、canvas_generate_text、canvas_generate_image、canvas_generate_video、canvas_generate_audio、canvas_create_generation_flow、canvas_create_config_node、canvas_run_generation、canvas_update_node、canvas_connect_nodes 等通用工具；复杂批量改动再用 canvas_apply_ops，删除连线可用 delete_connections。若当前不在画布页，画布工具会报错，需先用 site_navigate 打开画布。想了解或打开用户已有画布，用 canvas_list_projects 获取画布清单和 id，再用 site_navigate 跳 /canvas/:id 打开。生图工作台可用 workbench_image_get_config 看可选项、workbench_image_generate 填提示词并生成；视频创作台对应 workbench_video_get_config 与 workbench_video_generate；用 prompts_search 分页搜索提示词库；用 assets_list 查看「我的素材」、assets_add 新增文本或图片素材。需要生成内容时直接调用对应生成工具，不要绑定特定业务场景。不要模拟鼠标点击，不要要求用户手动复制 JSON。 生成或规划短剧视频、分镜时遵守 Toonflow 方法论——" + TOONFLOW_METHODOLOGY_BRIEF;

// 按环节压缩红线,单一事实源 = web/src/lib/toonflow/prompts.ts 的 STAGE_METHODOLOGY_REDLINES;
// 逐字镜像,web 的 agent-brief-sync 测试逐条锁定,禁止在此改写。只列有专属红线的环节,其余回落 brief。
export const STAGE_METHODOLOGY_REDLINES: Record<string, string> = {
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

export function redlineForKind(kind?: string): string {
    return (kind && STAGE_METHODOLOGY_REDLINES[kind]) || TOONFLOW_METHODOLOGY_BRIEF;
}

export type SiteWorkspaceConfig = { workspacePath: string; activeThreadId?: string; pinnedThreadIds?: string[] };
export type CanvasAgentConfig = { url: string; token: string; origins?: string[]; workspace?: SiteWorkspaceConfig };

export function loadConfig(create = false): CanvasAgentConfig {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) as CanvasAgentConfig;
    } catch {
        const config = { url: `http://127.0.0.1:${Number(process.env.PORT) || DEFAULT_PORT}`, token: crypto.randomBytes(18).toString("hex") };
        if (create) saveConfig(config);
        return config;
    }
}

export function saveConfig(config: CanvasAgentConfig) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function ensureSiteWorkspace(config: CanvasAgentConfig) {
    const current = config.workspace;
    if (current?.workspacePath) {
        const workspacePath = resolveWorkspacePath(current.workspacePath);
        fs.mkdirSync(workspacePath, { recursive: true });
        return { ...current, workspacePath };
    }
    const workspacePath = path.join(CONFIG_DIR, "codex-workspaces", "site");
    config.workspace = { workspacePath };
    fs.mkdirSync(workspacePath, { recursive: true });
    saveConfig(config);
    return { workspacePath };
}

export function updateSiteWorkspace(config: CanvasAgentConfig, patch: Partial<SiteWorkspaceConfig>) {
    const current = ensureSiteWorkspace(config);
    const workspacePath = patch.workspacePath ? resolveWorkspacePath(patch.workspacePath) : current.workspacePath;
    const next = { ...current, ...patch, workspacePath };
    config.workspace = { workspacePath: next.workspacePath, activeThreadId: next.activeThreadId, pinnedThreadIds: next.pinnedThreadIds };
    fs.mkdirSync(workspacePath, { recursive: true });
    saveConfig(config);
    return config.workspace;
}

function resolveWorkspacePath(value: string) {
    if (value === "~") return os.homedir();
    if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
    return path.resolve(value);
}

function readPackageVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string };
        return pkg.version || "0.0.0";
    } catch {
        return "0.0.0";
    }
}
