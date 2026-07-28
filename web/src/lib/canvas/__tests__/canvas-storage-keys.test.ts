import { describe, expect, it } from "vitest";

import { collectCanvasStorageKeys, isCanvasStorageKey } from "../canvas-storage-keys";

describe("画布媒体键", () => {
    it("识别字符串数组及对象字段中的媒体键", () => {
        const keys = collectCanvasStorageKeys({ imageKeys: ["image:one", "video:two"], output: "image:three", ignored: "not-a-storage-key" });

        expect(keys).toEqual(expect.arrayContaining(["image:one", "video:two", "image:three"]));
        expect(keys).toHaveLength(3);
    });

    it("只接受存储服务实际使用的前缀", () => {
        expect(isCanvasStorageKey("audio-reference:one")).toBe(true);
        expect(isCanvasStorageKey("prompt:with-colon")).toBe(false);
    });
});
