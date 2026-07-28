import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { canPersist, markHydrationSettled, markStorageReadFallback } from "@/lib/storage-read-health";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import { buildToonflowCanvasTemplate, TOONFLOW_CANVAS_TITLE } from "@/lib/canvas/toonflow-canvas-template";
import { recordSyncDeletions } from "@/services/sync-tombstones";
import { createCanvasStorePersistQueue } from "@/stores/canvas/canvas-store-persist";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, CanvasProjectKind, ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string;
    kind?: CanvasProjectKind;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    createProject: (title?: string) => string;
    createToonflowProject: () => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects">;
let queuedPersistState: PersistedCanvasState | null = null;
const canvasPersistQueue = createCanvasStorePersistQueue(localForageStorage);

export const flushCanvasStorePersist = () => canvasPersistQueue.flush();

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        // 水合定型且未降级才允许回写，理由见 use-asset-store 同位置注释；
        // 对 canvas 尤其关键：防抖队列会把水合窗口内排队的写入延迟到降级标打上之后才落盘
        if (!canPersist(name)) return;
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects) return;
        queuedPersistState = nextState;
        canvasPersistQueue.schedule(name, JSON.stringify(value));
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            createProject: (title = "未命名画布") => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    kind: "standard",
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            createToonflowProject: () => {
                const now = new Date().toISOString();
                const id = nanoid();
                const template = buildToonflowCanvasTemplate();
                const project: CanvasProject = {
                    id,
                    kind: "toonflow",
                    title: TOONFLOW_CANVAS_TITLE,
                    createdAt: now,
                    updatedAt: now,
                    nodes: template.nodes,
                    connections: template.connections,
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: template.viewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    kind: source.kind || "standard",
                    title: source.title || "导入画布",
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const projects = state.projects.filter((project) => !ids.includes(project.id));
                    void recordSyncDeletions("canvas", ids).catch(() => undefined);
                    return { projects };
                }),
            replaceProjects: (projects) => set({ projects }),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => (_state, error) => {
                // 水合失败打降级标，理由见 use-asset-store 同位置注释
                if (error) markStorageReadFallback(CANVAS_STORE_KEY);
                markHydrationSettled(CANVAS_STORE_KEY);
                // 承重 setState：置 hydrated + 定型瞬间补落盘窗口期写入，见 use-asset-store 注释
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);
