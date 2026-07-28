import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import type { CanvasExportFile } from "@/types/canvas-export";

import { isCanvasStorageKey, replaceCanvasStorageKeys } from "./canvas-storage-keys";

export async function importCanvasProjects(data: CanvasExportFile, getFile: (path: string) => Blob | undefined) {
    const keyMap = new Map<string, string>();
    for (const item of data.projects.flatMap((project) => project.files)) {
        if (keyMap.has(item.storageKey) || !isCanvasStorageKey(item.storageKey)) continue;
        const blob = getFile(item.path);
        if (!blob) continue;
        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
        const stored = item.storageKey.startsWith("image:")
            ? await uploadImage(typedBlob)
            : await uploadMediaFile(typedBlob, item.storageKey.slice(0, item.storageKey.indexOf(":")));
        keyMap.set(item.storageKey, stored.storageKey);
    }
    return data.projects.map((item) => replaceCanvasStorageKeys(item.project, keyMap));
}
