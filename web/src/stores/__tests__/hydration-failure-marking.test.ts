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
