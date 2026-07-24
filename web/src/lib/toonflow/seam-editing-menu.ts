import type { SeamContract } from "./schema";

export type SeamEditingMethod = {
    number: number;
    name: string;
    seamTypes: string[];
    execution: string;
};

export const SEAM_EDITING_METHODS: readonly SeamEditingMethod[] = [
    { number: 1, name: "正反打", seamTypes: ["对话", "对峙"], execution: "对话/对峙缝首选，反打镜天然藏缝，严守 180° 轴线；" },
    { number: 2, name: "切景别/切视角", seamTypes: ["景别跳变", "视角转换"], execution: "缝两侧至少跳 2 档，同景别族硬拼=跳切；" },
    { number: 3, name: "动作中切", seamTypes: ["连续动作", "运动衔接"], execution: "上段收在动作中间态、下段接同一动作后半（match-on-action）；" },
    { number: 4, name: "J/L 声音桥", seamTypes: ["对白跨切", "音效跨切"], execution: "下段台词/音效提前 0.2-0.5s（J）或上段声音拖尾 0.3-0.6s（L），音画切点错位、段内口型不破坏；" },
    { number: 5, name: "静场冻结缓推镜", seamTypes: ["静场", "口型错配", "无镜可用"], execution: "取上段末帧冻结+zoompan 缓推 2-3s，承载画外音台词（解决口型错配/无镜可用的缝）；" },
    { number: 6, name: "内部 J 缝无痕删段", seamTypes: ["段内删改", "画外音跨切"], execution: "段内容要删一截时拆成两段虚拟缝，台词转画外音跨切口连续；" },
    { number: 7, name: "衰减回响叠加轨", seamTypes: ["爆点", "轰鸣余韵"], execution: "爆点/轰鸣的余威用 aecho+长淡出叠进下一段头部；" },
    { number: 8, name: "数字急推", seamTypes: ["同景别救急"], execution: "同景别缝救急：上段末 0.8s crop 放大 1.2x 制造紧→松景别差；" },
    { number: 9, name: "BGM 骤停做节拍", seamTypes: ["高潮切入", "包袱点"], execution: "高潮切入与包袱点让音乐硬停，静默即笑点/燃点；" },
    { number: 10, name: "逐段响度归一 -16 LUFS", seamTypes: ["全部交付缝"], execution: "逐段响度归一 -16 LUFS（volume+alimiter），拼接后整片复测。" },
] as const;

export function recommendedSeamEditingMethodNumbers(contract?: SeamContract): Set<number> {
    const value = contract?.scaleOrMotivation ?? "";
    const numbers = new Set<number>();
    if (/正反打|对话|对峙|轴线/.test(value)) numbers.add(1);
    if (/景别|视角|POV|跳.*档/.test(value)) numbers.add(2);
    if (/动作|运动|跟拍|甩镜|摇移|推进/.test(value)) numbers.add(3);
    if (/急推|推近|同景别/.test(value)) numbers.add(8);
    if (/高潮|爆点|包袱|节拍/.test(value)) numbers.add(9);
    if (!numbers.size) numbers.add(2);
    return numbers;
}
