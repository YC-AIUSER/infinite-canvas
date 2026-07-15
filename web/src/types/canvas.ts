import type { NodeOutput, NodeStatus } from "@/lib/toonflow/schema";

export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Config = "config",
    Video = "video",
    Audio = "audio",
    Group = "group",
}

export type CanvasProjectKind = "standard" | "toonflow";
export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasImageGenerationType = "generation" | "edit";
export type ToonflowNodeKind =
    | "project"
    | "script"
    | "assets"
    | "space-contract"
    | "storyboard-table"
    | "shot-contract"
    | "action-contract"
    | "storyboard-page"
    | "keyframes"
    | "compliance"
    | "video-workbench"
    | "seam-check"
    | "audio-mix"
    | "export";
export type ToonflowNodeStageStatus = NodeStatus;

export type ToonflowNodeMetadata = {
    kind: ToonflowNodeKind;
    stage: string;
    status: ToonflowNodeStageStatus;
    summary: string;
    checks: string[];
    segmentId?: string;
    segmentIndex?: number;
    archived?: boolean;
    outputs?: string[];
    accent?: string;
    output?: NodeOutput;
    history?: NodeOutput[];
    pendingVideoTask?: {
        taskId: string;
        provider: "openai" | "seedance" | "cano";
        model: string;
        upstreamSnapshot: Record<string, number>;
        // 建任务时的逐格 shotPrompts 与洗词记录一并持久化:刷新恢复时直接落库,不重算(避免期间分镜表变动导致重算漂移或抛错丢弃已计费视频)。
        shotPrompts: Record<string, string>;
        washHits: Array<{ term: string; replacement: string }>;
        startedAt: string;
    };
    washReport?: {
        hits: Array<{ term: string; replacement: string }>;
        at: string;
    };
};

export type CanvasNodeMetadata = {
    content?: string;
    composerContent?: string;
    prompt?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    size?: string;
    quality?: string;
    count?: number;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    isBatchRoot?: boolean;
    batchRootId?: string;
    batchChildIds?: string[];
    batchUsesReferenceImages?: boolean;
    primaryImageId?: string;
    imageBatchExpanded?: boolean;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    groupId?: string;
    /** 投影标记:本节点是某 Toonflow 环节(如资产库)的投影组容器。 */
    projectionOf?: { stageNodeId: string; kind: ToonflowNodeKind };
    /** 投影标记:本节点是某环节某张资产卡的投影子节点,回指真相源。 */
    cardProjection?: { stageNodeId: string; cardId: string };
    toonflow?: ToonflowNodeMetadata;
    requiresReferenceImage?: boolean; // 技能生产红线：生图时参考图为空禁止生成
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeType;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeType;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
