export type CanvasMediaKind = "image" | "video" | "audio";

export interface MediaFileLike {
    type: string;
    name: string;
}

export function classifyMediaFile(file: MediaFileLike): CanvasMediaKind | null {
    if (file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name)) return "audio";
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("image/")) return "image";
    return null;
}

export function pickMediaFiles<T extends MediaFileLike>(files: Iterable<T>): T[] {
    return Array.from(files).filter((file) => classifyMediaFile(file) !== null);
}

export const BATCH_UPLOAD_OFFSET = 48;

export function cascadePosition(base: { x: number; y: number }, index: number, step: number = BATCH_UPLOAD_OFFSET) {
    return { x: base.x + index * step, y: base.y + index * step };
}
