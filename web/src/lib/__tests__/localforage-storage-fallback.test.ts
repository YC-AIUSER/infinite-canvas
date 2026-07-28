import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 验证降级读取会被打标：IndexedDB 读失败回退 localStorage 时，
// storage-read-health 必须记录该事实，供启动清扫等破坏性操作熔断。
describe("localforage 存储降级读取打标", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.stubGlobal("window", { localStorage: { getItem: vi.fn(() => '{"state":{"projects":[]}}') } });
    });

    afterEach(() => {
        vi.doUnmock("localforage");
        vi.unstubAllGlobals();
    });

    it("getItem 读失败回退 localStorage 并记录降级", async () => {
        vi.doMock("localforage", () => ({ default: { config: vi.fn(), getItem: vi.fn(() => Promise.reject(new Error("indexeddb broken"))), setItem: vi.fn(), removeItem: vi.fn() } }));
        const { localForageStorage } = await import("../localforage-storage");
        const { hasStorageReadFallback } = await import("../storage-read-health");

        expect(hasStorageReadFallback()).toBe(false);
        const value = await localForageStorage.getItem("infinite-canvas:canvas_store");

        expect(value).toBe('{"state":{"projects":[]}}');
        expect(hasStorageReadFallback()).toBe(true);
    });

    it("getItem 正常读取不打降级标", async () => {
        vi.doMock("localforage", () => ({ default: { config: vi.fn(), getItem: vi.fn(() => Promise.resolve('{"state":{}}')), setItem: vi.fn(), removeItem: vi.fn() } }));
        const { localForageStorage } = await import("../localforage-storage");
        const { hasStorageReadFallback } = await import("../storage-read-health");

        const value = await localForageStorage.getItem("infinite-canvas:asset_store");

        expect(value).toBe('{"state":{}}');
        expect(hasStorageReadFallback()).toBe(false);
    });
});
