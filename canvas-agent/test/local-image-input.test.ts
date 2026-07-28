import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { assertLocalImageSize, imageMimeFromPath, resolveLocalImageInput } from "../src/local-image-input.js";

const tempDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("assets_add 本地图片读取", () => {
    it.each(["secret.env", "notes.txt"])("拒绝非图片扩展名 %s", (file) => {
        expect(() => imageMimeFromPath(file)).toThrow("本地图片仅支持");
    });

    it("拒绝超过 30MB 的文件", async () => {
        const directory = await createTempDirectory();
        const file = path.join(directory, "large.png");
        await writeFile(file, "");
        await truncate(file, 30 * 1024 * 1024 + 1);

        await expect(resolveLocalImageInput("assets_add", { kind: "image", imageUrl: file })).rejects.toThrow("31457281 字节");
        expect(() => assertLocalImageSize(30 * 1024 * 1024)).not.toThrow();
    });

    it("将白名单内的本地图片转成 data URL", async () => {
        const directory = await createTempDirectory();
        const file = path.join(directory, "sample.PNG");
        await writeFile(file, Buffer.from([1, 2, 3]));

        await expect(resolveLocalImageInput("assets_add", { kind: "image", imageUrl: file, name: "sample" })).resolves.toEqual({
            kind: "image",
            imageUrl: "data:image/png;base64,AQID",
            name: "sample",
        });
    });
});

async function createTempDirectory() {
    const directory = await mkdtemp(path.join(os.tmpdir(), "canvas-agent-image-"));
    tempDirectories.push(directory);
    return directory;
}
