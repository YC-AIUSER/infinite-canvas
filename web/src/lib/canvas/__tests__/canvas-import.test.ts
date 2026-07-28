import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/image-storage", () => ({ uploadImage: vi.fn(), setImageBlob: vi.fn() }));
vi.mock("@/services/file-storage", () => ({ uploadMediaFile: vi.fn(), setMediaBlob: vi.fn() }));

import { uploadMediaFile, setMediaBlob } from "@/services/file-storage";
import { uploadImage, setImageBlob } from "@/services/image-storage";
import type { CanvasExportFile } from "@/types/canvas-export";
import { CanvasNodeType } from "@/types/canvas";

import { importCanvasProjects } from "../canvas-import";

const imageUpload = vi.mocked(uploadImage);
const mediaUpload = vi.mocked(uploadMediaFile);

describe("画布导入", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        imageUpload.mockResolvedValue({ storageKey: "image:new", url: "", width: 1, height: 1, bytes: 1, mimeType: "image/png" });
        mediaUpload.mockResolvedValue({ storageKey: "video:new", url: "", bytes: 1, mimeType: "video/mp4" });
    });

    it("为归档媒体写入新键并重写全部 JSON 引用，不覆盖同名本地键", async () => {
        const data: CanvasExportFile = {
            app: "infinite-canvas",
            version: 3,
            exportedAt: "2026-07-28T00:00:00.000Z",
            projects: [
                {
                    project: {
                        id: "project",
                        title: "导入",
                        createdAt: "2026-07-28T00:00:00.000Z",
                        updatedAt: "2026-07-28T00:00:00.000Z",
                        nodes: [
                            {
                                id: "node",
                                type: CanvasNodeType.Image,
                                title: "图片",
                                position: { x: 0, y: 0 },
                                width: 100,
                                height: 100,
                                metadata: { storageKey: "image:old", toonflow: { kind: "storyboard-page", stage: "s", status: "empty", summary: "", checks: [], output: { nodeId: "node", kind: "storyboard-page", version: 1, status: "empty", payload: { imageKeys: ["image:old"], videoKeys: ["video:old"] }, upstreamVersions: {}, generatedAt: "2026-07-28T00:00:00.000Z" } } },
                            },
                        ],
                        connections: [],
                        chatSessions: [],
                        activeChatId: null,
                        backgroundMode: "lines",
                        showImageInfo: false,
                        viewport: { x: 0, y: 0, k: 1 },
                    },
                    files: [
                        { storageKey: "image:old", path: "image.png", mimeType: "image/png", bytes: 1 },
                        { storageKey: "video:old", path: "video.mp4", mimeType: "video/mp4", bytes: 1 },
                    ],
                },
            ],
        };

        const projects = await importCanvasProjects(data, (path) => new Blob([path], { type: path.endsWith("png") ? "image/png" : "video/mp4" }));

        expect(JSON.stringify(projects)).not.toContain("image:old");
        expect(JSON.stringify(projects)).not.toContain("video:old");
        expect(JSON.stringify(projects)).toContain("image:new");
        expect(JSON.stringify(projects)).toContain("video:new");
        expect(setImageBlob).not.toHaveBeenCalled();
        expect(setMediaBlob).not.toHaveBeenCalled();
    });
});
