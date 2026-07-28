import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const MAX_LOCAL_IMAGE_BYTES = 30 * 1024 * 1024;
const IMAGE_MIME_TYPES: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
};

export async function resolveLocalImageInput(name: string, input: unknown) {
    if (name !== "assets_add" || !input || typeof input !== "object") return input;
    const value = input as Record<string, unknown>;
    if (value.kind !== "image") return input;
    const url = typeof value.imageUrl === "string" ? value.imageUrl.trim() : "";
    if (!url || /^(https?:|data:)/i.test(url)) return input;

    const mimeType = imageMimeFromPath(url);
    try {
        const file = await stat(url);
        assertLocalImageSize(file.size);
        const buffer = await readFile(url);
        return { ...value, imageUrl: `data:${mimeType};base64,${buffer.toString("base64")}` };
    } catch (error) {
        if (error instanceof LocalImageValidationError) throw error;
        return input; // 读不到就原样交给浏览器，让其产出可读错误提示
    }
}

export function imageMimeFromPath(file: string) {
    const ext = path.extname(file).toLowerCase();
    const mimeType = IMAGE_MIME_TYPES[ext];
    if (!mimeType) throw new LocalImageValidationError(`不支持读取 ${ext || "无扩展名"} 文件；本地图片仅支持 .png、.jpg、.jpeg、.webp、.gif、.bmp`);
    return mimeType;
}

export function assertLocalImageSize(size: number) {
    if (size > MAX_LOCAL_IMAGE_BYTES) throw new LocalImageValidationError(`本地图片大小为 ${size} 字节，超过 30 MB 上限`);
}

class LocalImageValidationError extends Error {}
