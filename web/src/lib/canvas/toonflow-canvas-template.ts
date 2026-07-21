import type { NodeStatus } from "../toonflow/schema";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type ToonflowNodeKind, type ViewportTransform } from "../../types/canvas";

type ToonflowTemplateNode = {
    kind: ToonflowNodeKind;
    type: CanvasNodeType;
    title: string;
    stage: string;
    summary: string;
    checks: string[];
    outputs?: string[];
    accent: string;
    width?: number;
    height?: number;
    /** 选修环节的初始态。缺省 empty(待生成);填 skipped 则一键跑全链时不会被执行掉。 */
    defaultStatus?: NodeStatus;
};

const NODE_GAP_X = 380;
const NODE_GAP_Y = 300;
const NODE_LEFT = 0;
const NODE_TOP = 40;
// 三排分界:前期文本决策(project..directing-lock) / 分镜与图像 / 生成与交付。
const ROW_BREAKS = [7, 12];

const templateNodes: ToonflowTemplateNode[] = [
    {
        kind: "project",
        type: CanvasNodeType.Text,
        title: "项目 / 剧集",
        stage: "入口",
        summary: "锁定当前项目、剧集、目标平台和整条生产线状态。",
        checks: ["项目已选", "剧集已选", "比例/平台明确"],
        outputs: ["本集生产上下文"],
        accent: "#2563eb",
    },
    {
        kind: "creative",
        type: CanvasNodeType.Text,
        title: "创意（选修）",
        stage: "P0 创意",
        summary: "选修环节，可整节跳过。有剧本走体检模式对照爽点与钩子，无剧本走冷启动碰撞法。",
        checks: ["爽点覆盖", "结尾钩子", "付费卡点"],
        outputs: ["创意体检报告/冷启动方向"],
        accent: "#c026d3",
        defaultStatus: "skipped",
    },
    {
        kind: "script",
        type: CanvasNodeType.Text,
        title: "剧本",
        stage: "内容源",
        summary: "承载原文、改编策略、结构化剧情和本集节奏。",
        checks: ["原文完整", "改编目标明确", "冲突/转折标记"],
        outputs: ["结构化剧本摘要"],
        accent: "#7c3aed",
    },
    {
        kind: "assets",
        type: CanvasNodeType.Image,
        title: "资产库",
        stage: "参考资产",
        summary: "集中管理角色、场景、道具、服装和参考图。",
        checks: ["角色锚点", "场景锚点", "道具锚点"],
        outputs: ["可引用资产清单"],
        accent: "#0891b2",
    },
    {
        kind: "space-contract",
        type: CanvasNodeType.Text,
        title: "空间合同",
        stage: "空间约束",
        summary: "先固定空间、动线、轴线和角色点位，减少越轴和漂移。",
        checks: ["空间方位", "角色站位", "镜头轴线"],
        outputs: ["点位图/空间规则"],
        accent: "#0f766e",
    },
    {
        kind: "continuity-table",
        type: CanvasNodeType.Text,
        title: "跨段继承表",
        stage: "跨段连续性",
        summary: "全片一张，逐段更新桌面道具白名单、人物站位姿态、光向天气、角色装备和遗留物。",
        checks: ["道具白名单", "站位姿态", "光向天气"],
        outputs: ["跨段状态继承表"],
        accent: "#059669",
    },
    {
        kind: "directing-lock",
        type: CanvasNodeType.Text,
        title: "分镜决策锁定表",
        stage: "决策锁定",
        summary: "A 表锁全局风格、调色、布光、运镜基调和表演档位，B 表逐段锁构图景别，并签相邻段缝合同。一次锁死，后续只引用。",
        checks: ["A 表已锁", "B 表逐段齐", "缝合同四行"],
        outputs: ["分镜决策锁定表", "缝合同"],
        accent: "#b45309",
    },
    {
        kind: "storyboard-table",
        type: CanvasNodeType.Text,
        title: "分镜表",
        stage: "镜头规划",
        summary: "结构化镜头编号、景别、运镜、台词、时长和素材引用。",
        checks: ["镜头编号", "台词/动作", "素材槽位"],
        outputs: ["镜头清单"],
        accent: "#ca8a04",
    },
    {
        kind: "shot-contract",
        type: CanvasNodeType.Text,
        title: "镜头合同",
        stage: "镜头约束",
        summary: "逐镜确认景别、角度、运动速度、主体关系和落点。",
        checks: ["景别角度", "运动速度", "落点状态"],
        outputs: ["每镜拍法约束"],
        accent: "#ea580c",
    },
    {
        kind: "action-contract",
        type: CanvasNodeType.Text,
        title: "动作合同",
        stage: "动作约束",
        summary: "给每镜动作补齐原因、过程、反应和结束状态，避免假静止。",
        checks: ["动作原因", "过程变化", "情绪落点"],
        outputs: ["动作链说明"],
        accent: "#dc2626",
    },
    {
        kind: "storyboard-page",
        type: CanvasNodeType.Image,
        title: "故事板页",
        stage: "黑白预演",
        summary: "故事板格子与视频镜头一一对应，不合并、不编造镜头。",
        checks: ["格子=镜头", "顺序一致", "空间连续"],
        outputs: ["黑白故事板页"],
        accent: "#4f46e5",
    },
    {
        kind: "keyframes",
        type: CanvasNodeType.Image,
        title: "分镜图 / 首帧",
        stage: "视觉首帧",
        summary: "生成彩色首帧/关键帧，承接资产和故事板页。",
        checks: ["角色一致", "服装一致", "构图可拍"],
        outputs: ["首帧图组"],
        accent: "#db2777",
    },
    {
        kind: "compliance",
        type: CanvasNodeType.Text,
        title: "过审",
        stage: "生成前检查",
        summary: "检查 Seedance/LibTV 避词、文字、logo、水印和风险元素。",
        checks: ["禁词清理", "无文字水印", "参考图干净"],
        outputs: ["可生成提示词"],
        accent: "#be123c",
    },
    {
        kind: "video-workbench",
        type: CanvasNodeType.Video,
        title: "视频工作台",
        stage: "视频生成",
        summary: "管理参考图、视频 prompt、生成状态、单镜重跑和验收。",
        checks: ["参考图就绪", "一镜一动作", "单镜可重跑"],
        outputs: ["视频片段"],
        accent: "#16a34a",
    },
    {
        kind: "seam-check",
        type: CanvasNodeType.Text,
        title: "接缝检查",
        stage: "连续性验收",
        summary: "检查镜头接续、角色方向、动作尾首和视觉跳变。",
        checks: ["动作尾首", "方向连续", "画面不跳"],
        outputs: ["接缝问题清单"],
        accent: "#65a30d",
    },
    {
        kind: "audio-mix",
        type: CanvasNodeType.Audio,
        title: "音频混音",
        stage: "声音层",
        summary: "整理配音、BGM、SFX 和视频原生声音的混合策略。",
        checks: ["配音", "BGM", "SFX"],
        outputs: ["音频轨道"],
        accent: "#9333ea",
    },
    {
        kind: "export",
        type: CanvasNodeType.Video,
        title: "成片 / 导出",
        stage: "交付",
        summary: "汇总已通过的段视频，顺序预览、逐段下载、打包 ZIP（本期不拼接）。",
        checks: ["段已就绪", "顺序可预览", "可下载/打包"],
        outputs: ["分段成片包"],
        accent: "#334155",
    },
];

export const TOONFLOW_CANVAS_TITLE = "Toonflow 生产画布";

function toonflowNodePosition(index: number) {
    const row = index < ROW_BREAKS[0] ? 0 : index < ROW_BREAKS[1] ? 1 : 2;
    const rowStart = row === 0 ? 0 : ROW_BREAKS[row - 1];
    return {
        x: NODE_LEFT + (index - rowStart) * NODE_GAP_X,
        y: NODE_TOP + row * NODE_GAP_Y,
    };
}

export function buildToonflowCanvasTemplate() {
    const nodes: CanvasNodeData[] = templateNodes.map((item, index) => {
        const width = item.width || 320;
        const height = item.height || 190;
        return {
            id: `toonflow-${item.kind}`,
            type: item.type,
            title: item.title,
            position: toonflowNodePosition(index),
            width,
            height,
            metadata: {
                content: `${item.title}\n${item.summary}`,
                status: "idle",
                fontSize: 14,
                toonflow: {
                    kind: item.kind,
                    stage: item.stage,
                    status: item.defaultStatus ?? "empty",
                    summary: item.summary,
                    checks: item.checks,
                    outputs: item.outputs,
                    accent: item.accent,
                },
            },
        };
    });

    const connections: CanvasConnection[] = nodes.slice(0, -1).map((node, index) => ({
        id: `toonflow-conn-${index + 1}`,
        fromNodeId: node.id,
        toNodeId: nodes[index + 1].id,
    }));

    const viewport: ViewportTransform = { x: 120, y: 120, k: 0.72 };
    return { nodes, connections, viewport };
}
