import { describe, expect, it } from "vitest";

import { collectAppMediaStorageKeys } from "../app-media-cleanup";

describe("应用媒体垃圾回收引用收集", () => {
    it("保留生图与视频工作台历史引用的媒体", () => {
        const keys = collectAppMediaStorageKeys({
            assets: [],
            projects: [],
            imageLogs: [{ id: "image-log", images: [{ storageKey: "image:workbench-result" }], references: [{ storageKey: "image:workbench-reference" }] }],
            videoLogs: [{ id: "video-log", video: { storageKey: "video:workbench-result" }, audioReferences: [{ storageKey: "audio-reference:workbench" }] }],
        });

        expect(keys.imageKeys).toEqual(new Set(["image:workbench-result", "image:workbench-reference"]));
        expect(keys.mediaKeys).toEqual(new Set(["image:workbench-result", "image:workbench-reference", "video:workbench-result", "audio-reference:workbench"]));
        expect(keys.mediaKeys.has("video:workbench-result")).toBe(true);
        expect(keys.mediaKeys.has("audio-reference:workbench")).toBe(true);
    });
});
