/**
 * TASK-17 失败模式登记表合并前的最小契约。
 *
 * 这里的类型与三条问句都是占位数据，只用于让视觉闸门可独立开发、测试；
 * 不代表正式质检标准。两项任务合并时应由真实登记表提供同形数据。
 */
export type VisualGateQuestion = {
    id: string;
    label: string;
    question: string;
    actionOnYes: "review" | "regenerate";
};

export const PLACEHOLDER_VISUAL_GATE_QUESTIONS: VisualGateQuestion[] = [
    {
        id: "placeholder-character-count",
        label: "占位：角色数量",
        question: "候选格中的主要角色数量是否与参考图明显不一致？",
        actionOnYes: "regenerate",
    },
    {
        id: "placeholder-character-identity",
        label: "占位：角色身份",
        question: "候选格中的主要角色外观是否与参考图明显不是同一角色？",
        actionOnYes: "regenerate",
    },
    {
        id: "placeholder-composition",
        label: "占位：构图偏差",
        question: "候选格的主体位置或镜头方向是否与参考图存在需要人工确认的明显偏差？",
        actionOnYes: "review",
    },
];
