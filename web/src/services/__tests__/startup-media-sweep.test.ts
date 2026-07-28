import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = () => void;

function createMockStore<T extends Record<string, unknown>>(initial: T) {
    let state = initial;
    const listeners = new Set<Listener>();
    return {
        getState: () => state,
        setState: (patch: Partial<T>) => {
            state = { ...state, ...patch };
            listeners.forEach((listener) => listener());
        },
        subscribe: (listener: Listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

const cleanupMock = vi.fn(() => Promise.resolve());
let assetStore: ReturnType<typeof createMockStore<{ hydrated: boolean; assets: unknown[] }>>;
let canvasStore: ReturnType<typeof createMockStore<{ hydrated: boolean; projects: unknown[] }>>;

async function importSweep() {
    return import("../startup-media-sweep");
}

describe("启动孤儿媒体清扫", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        cleanupMock.mockClear();
        assetStore = createMockStore<{ hydrated: boolean; assets: unknown[] }>({ hydrated: false, assets: [{ id: "asset-1" }] });
        canvasStore = createMockStore<{ hydrated: boolean; projects: unknown[] }>({ hydrated: false, projects: [{ id: "project-1" }] });
        vi.doMock("@/services/app-media-cleanup", () => ({ cleanupUnusedAppMedia: cleanupMock }));
        vi.doMock("@/stores/use-asset-store", () => ({ useAssetStore: assetStore }));
        vi.doMock("@/stores/canvas/use-canvas-store", () => ({ useCanvasStore: canvasStore }));
    });

    afterEach(() => {
        vi.doUnmock("@/services/app-media-cleanup");
        vi.doUnmock("@/stores/use-asset-store");
        vi.doUnmock("@/stores/canvas/use-canvas-store");
        vi.useRealTimers();
    });

    it("任一 store 未水合时绝不清扫", async () => {
        const { scheduleStartupMediaSweep } = await importSweep();
        scheduleStartupMediaSweep();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(cleanupMock).not.toHaveBeenCalled();

        // 只有一个 store 水合仍不许跑
        assetStore.setState({ hydrated: true });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(cleanupMock).not.toHaveBeenCalled();
    });

    it("双水合后延迟触发恰好一次，重复调度不产生第二次", async () => {
        const { scheduleStartupMediaSweep } = await importSweep();
        scheduleStartupMediaSweep();
        scheduleStartupMediaSweep();
        assetStore.setState({ hydrated: true });
        canvasStore.setState({ hydrated: true });
        await vi.advanceTimersByTimeAsync(7_999);
        expect(cleanupMock).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(cleanupMock).toHaveBeenCalledTimes(1);

        // 热重载/二次挂载再调度 + 时间推进，仍只有一次
        scheduleStartupMediaSweep();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(cleanupMock).toHaveBeenCalledTimes(1);
    });

    it("水合先于调度完成时同样只触发一次", async () => {
        assetStore.setState({ hydrated: true });
        canvasStore.setState({ hydrated: true });
        const { scheduleStartupMediaSweep } = await importSweep();
        scheduleStartupMediaSweep();
        await vi.advanceTimersByTimeAsync(8_000);
        expect(cleanupMock).toHaveBeenCalledTimes(1);
    });

    it("清扫读取两个 store 的当前状态，并把会话内新写键作为在途引用豁免", async () => {
        const { registerSessionMediaKey } = await import("../session-media-keys");
        registerSessionMediaKey("image:fresh-upload");
        registerSessionMediaKey("video:fresh-upload");

        const { scheduleStartupMediaSweep } = await importSweep();
        scheduleStartupMediaSweep();
        assetStore.setState({ hydrated: true });
        canvasStore.setState({ hydrated: true });
        // 清扫时读的是运行时最新状态，而非调度时的快照
        canvasStore.setState({ projects: [{ id: "project-1" }, { id: "project-2" }] });
        await vi.advanceTimersByTimeAsync(8_000);

        expect(cleanupMock).toHaveBeenCalledTimes(1);
        expect(cleanupMock).toHaveBeenCalledWith({
            assets: [{ id: "asset-1" }],
            projects: [{ id: "project-1" }, { id: "project-2" }],
            extra: expect.arrayContaining([{ storageKey: "image:fresh-upload" }, { storageKey: "video:fresh-upload" }]),
        });
    });

    it("extra 的 {storageKey} 形状能被真实引用收集器识别（防误删闭环）", async () => {
        const { collectAppMediaStorageKeys } = await vi.importActual<typeof import("../app-media-cleanup")>("../app-media-cleanup");
        const keys = collectAppMediaStorageKeys({
            assets: [],
            projects: [],
            imageLogs: [],
            videoLogs: [],
            extra: [{ storageKey: "image:fresh-upload" }, { storageKey: "video:fresh-upload" }],
        });
        expect(keys.imageKeys.has("image:fresh-upload")).toBe(true);
        expect(keys.mediaKeys.has("video:fresh-upload")).toBe(true);
        expect(keys.mediaKeys.has("image:fresh-upload")).toBe(true);
    });
});
