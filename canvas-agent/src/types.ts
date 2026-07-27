export type Position = { x: number; y: number };
export type Viewport = { x: number; y: number; k: number };
export type CanvasNodeType = "image" | "text" | "config" | "video" | "audio";
export type CanvasNode = { id: string; type: CanvasNodeType; title?: string; position: Position; width: number; height: number; metadata?: Record<string, unknown> };
export type CanvasConnection = { id: string; fromNodeId: string; toNodeId: string };
export type CanvasSnapshot = {
    projectId?: string;
    title?: string;
    nodes?: CanvasNode[];
    connections?: CanvasConnection[];
    selectedNodeIds?: string[];
    viewport?: Viewport;
    clientId?: string;
    /** Toonflow 封闭词库全文,由网页随状态推送(词库实体在 web 的 closed-libraries.ts,这里不留副本)。 */
    _closedLibraries?: string;
};
export type AgentEmit = (type: string, payload: unknown) => void;
export type AgentAttachment = { name?: string; type?: string; dataUrl?: string };
