import { beforeEach, describe, expect, it, vi } from "vitest";

// 用 Map 假 localforage 实例验证 P1 修复：清扫删除时刻实时豁免会话登记键，
// 保护"清扫已开始、快照已定，用户此刻新上传"的窗口内写入。
const stores = vi.hoisted(() => new Map<string, Map<string, unknown>>());

vi.mock("localforage", () => ({
    default: {
        config: () => undefined,
        createInstance: ({ storeName }: { storeName: string }) => {
            const data = new Map<string, unknown>();
            stores.set(storeName, data);
            return {
                setItem: async (key: string, value: unknown) => {
                    data.set(key, value);
                    return value;
                },
                getItem: async (key: string) => data.get(key) ?? null,
                removeItem: async (key: string) => {
                    data.delete(key);
                },
                iterate: async (fn: (value: unknown, key: string) => void) => {
                    data.forEach((value, key) => fn(value, key));
                },
            };
        },
    },
}));

describe("清扫删除时刻的会话键实时豁免", () => {
    beforeEach(() => {
        vi.resetModules();
        stores.clear();
        // node 环境没有 URL.createObjectURL/revokeObjectURL，存储层会调用
        vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:fake", revokeObjectURL: () => undefined }));
    });

    it("image_files：无引用但已登记的会话键不被删，未登记孤儿键被删", async () => {
        const { cleanupUnusedImagesByKeys } = await import("../image-storage");
        const { registerSessionMediaKey } = await import("../session-media-keys");
        const data = stores.get("image_files")!;
        data.set("image:orphan-old", "blob-a");
        data.set("image:referenced", "blob-b");
        data.set("image:in-flight", "blob-c");
        registerSessionMediaKey("image:in-flight");

        await cleanupUnusedImagesByKeys(new Set(["image:referenced"]));

        expect([...data.keys()].sort()).toEqual(["image:in-flight", "image:referenced"]);
    });

    it("media_files：同一豁免语义对 video:/audio: 键生效", async () => {
        const { cleanupUnusedMediaByKeys } = await import("../file-storage");
        const { registerSessionMediaKey } = await import("../session-media-keys");
        const data = stores.get("media_files")!;
        data.set("video:orphan-old", "blob-a");
        data.set("audio:in-flight", "blob-b");
        registerSessionMediaKey("audio:in-flight");

        await cleanupUnusedMediaByKeys(new Set());

        expect([...data.keys()]).toEqual(["audio:in-flight"]);
    });

    it("上传函数在写入存储前完成登记（写入即受保护，无裸窗口）", async () => {
        const { uploadMediaFile } = await import("../file-storage");
        const { getSessionMediaKeys } = await import("../session-media-keys");
        const data = stores.get("media_files")!;
        let registeredAtWriteTime = false;
        const origSet = data.set.bind(data);
        data.set = (key: string, value: unknown) => {
            registeredAtWriteTime = getSessionMediaKeys().has(key);
            return origSet(key, value);
        };

        const uploaded = await uploadMediaFile(new Blob(["x"], { type: "application/octet-stream" }), "file");

        expect(registeredAtWriteTime).toBe(true);
        expect(getSessionMediaKeys().has(uploaded.storageKey)).toBe(true);
    });
});
