import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 端到端验证：存储层读取成功、但 store 上层水合抛错（JSON 损坏等）时，
// persist 的 error 通道必须打降级标——启动清扫靠它熔断，否则会拿空引用集删真实媒体。
describe("store 上层水合异常打降级标", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.doUnmock("@/lib/localforage-storage");
    });

    it("asset store 持久化内容损坏：hydrated 仍置位、状态回退空、降级已标记", async () => {
        vi.doMock("@/lib/localforage-storage", () => ({
            localForageStorage: { getItem: async () => "corrupted{{{", setItem: async () => undefined, removeItem: async () => undefined },
        }));
        const { hasStorageReadFallback } = await import("@/lib/storage-read-health");
        const { useAssetStore } = await import("@/stores/use-asset-store");

        await vi.waitFor(() => {
            expect(useAssetStore.getState().hydrated).toBe(true);
        });
        expect(useAssetStore.getState().assets).toEqual([]);
        expect(hasStorageReadFallback()).toBe(true);
    });

    it("canvas store 持久化内容损坏：hydrated 仍置位、状态回退空、降级已标记", async () => {
        vi.doMock("@/lib/localforage-storage", () => ({
            localForageStorage: { getItem: async () => "corrupted{{{", setItem: async () => undefined, removeItem: async () => undefined },
        }));
        const { hasStorageReadFallback } = await import("@/lib/storage-read-health");
        const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");

        await vi.waitFor(() => {
            expect(useCanvasStore.getState().hydrated).toBe(true);
        });
        expect(useCanvasStore.getState().projects).toEqual([]);
        expect(hasStorageReadFallback()).toBe(true);
    });

    it("降级会话禁止回写：水合失败后 asset store 的任何持久化写入被拦截", async () => {
        const setItemMock = vi.fn(async () => undefined);
        vi.doMock("@/lib/localforage-storage", () => ({
            localForageStorage: { getItem: async () => "corrupted{{{", setItem: setItemMock, removeItem: async () => undefined },
        }));
        const { useAssetStore } = await import("@/stores/use-asset-store");
        await vi.waitFor(() => {
            expect(useAssetStore.getState().hydrated).toBe(true);
        });
        // 水合失败回调的 setState 与后续业务写入都不许把空状态回写存储
        useAssetStore.getState().addAsset({ kind: "text", title: "t", coverUrl: "", tags: [], data: { content: "x" } });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(setItemMock).not.toHaveBeenCalled();
    });

    it("降级会话禁止回写：canvas store 建画布后 flush 也不落盘", async () => {
        const setItemMock = vi.fn(async () => undefined);
        vi.doMock("@/lib/localforage-storage", () => ({
            localForageStorage: { getItem: async () => "corrupted{{{", setItem: setItemMock, removeItem: async () => undefined },
        }));
        const { useCanvasStore, flushCanvasStorePersist } = await import("@/stores/canvas/use-canvas-store");
        await vi.waitFor(() => {
            expect(useCanvasStore.getState().hydrated).toBe(true);
        });
        useCanvasStore.getState().createProject("测试画布");
        await flushCanvasStorePersist();
        expect(setItemMock).not.toHaveBeenCalled();
    });

    it("水合进行中发起的写入也被拦（降级标打上前的时序窗口）", async () => {
        const setItemMock = vi.fn(async () => undefined);
        let resolveRead!: (value: string) => void;
        const pendingRead = new Promise<string>((resolve) => {
            resolveRead = resolve;
        });
        vi.doMock("@/lib/localforage-storage", () => ({
            localForageStorage: { getItem: () => pendingRead, setItem: setItemMock, removeItem: async () => undefined },
        }));
        const { useCanvasStore, flushCanvasStorePersist } = await import("@/stores/canvas/use-canvas-store");

        // 水合仍在进行（读取未返回），此刻发起写入——旧实现会带着空初始态排进防抖队列
        expect(useCanvasStore.getState().hydrated).toBe(false);
        useCanvasStore.getState().createProject("窗口期画布");
        await flushCanvasStorePersist();
        expect(setItemMock).not.toHaveBeenCalled();

        // 读取返回损坏内容 → 水合失败定型 → 此前排队与此后的写入都不许落盘
        resolveRead("corrupted{{{");
        await vi.waitFor(() => {
            expect(useCanvasStore.getState().hydrated).toBe(true);
        });
        useCanvasStore.getState().createProject("降级后画布");
        await flushCanvasStorePersist();
        expect(setItemMock).not.toHaveBeenCalled();
    });

    it("健康慢水合：窗口期写入在水合定型时自动补落盘，不被吞", async () => {
        const setItemMock = vi.fn(async (_name: string, _value: string) => undefined);
        let resolveRead!: (value: string | null) => void;
        const pendingRead = new Promise<string | null>((resolve) => {
            resolveRead = resolve;
        });
        vi.doMock("@/lib/localforage-storage", () => ({
            localForageStorage: { getItem: () => pendingRead, setItem: setItemMock, removeItem: async () => undefined },
        }));
        const { useAssetStore } = await import("@/stores/use-asset-store");

        // 水合仍在进行（asset store 重建资产 URL 可能耗时数秒），用户此刻新增素材
        expect(useAssetStore.getState().hydrated).toBe(false);
        useAssetStore.getState().addAsset({ kind: "text", title: "窗口期素材", coverUrl: "", tags: [], data: { content: "x" } });
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(setItemMock).not.toHaveBeenCalled();

        // 水合定型（无存量数据）：定型时置 hydrated 的 setState 触发一次持久化，
        // 此刻门已放行、写的是包含窗口期素材的最新内存态——写入被推迟而非被吞
        resolveRead(null);
        await vi.waitFor(() => {
            expect(useAssetStore.getState().hydrated).toBe(true);
        });
        await vi.waitFor(() => {
            expect(setItemMock).toHaveBeenCalled();
        });
        const lastPayload = String(setItemMock.mock.calls.at(-1)?.[1] ?? "");
        expect(lastPayload).toContain("窗口期素材");
    });

    it("健康会话回写正常：hydration 无误时业务写入照常落盘", async () => {
        const setItemMock = vi.fn(async () => undefined);
        vi.doMock("@/lib/localforage-storage", () => ({
            localForageStorage: { getItem: async () => JSON.stringify({ state: { assets: [] }, version: 0 }), setItem: setItemMock, removeItem: async () => undefined },
        }));
        const { useAssetStore } = await import("@/stores/use-asset-store");
        await vi.waitFor(() => {
            expect(useAssetStore.getState().hydrated).toBe(true);
        });
        useAssetStore.getState().addAsset({ kind: "text", title: "t", coverUrl: "", tags: [], data: { content: "x" } });
        await vi.waitFor(() => {
            expect(setItemMock).toHaveBeenCalled();
        });
    });

    it("持久化内容正常时不打降级标", async () => {
        vi.doMock("@/lib/localforage-storage", () => ({
            localForageStorage: { getItem: async () => JSON.stringify({ state: { assets: [] }, version: 0 }), setItem: async () => undefined, removeItem: async () => undefined },
        }));
        const { hasStorageReadFallback } = await import("@/lib/storage-read-health");
        const { useAssetStore } = await import("@/stores/use-asset-store");

        await vi.waitFor(() => {
            expect(useAssetStore.getState().hydrated).toBe(true);
        });
        expect(hasStorageReadFallback()).toBe(false);
    });
});
