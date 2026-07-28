import { cleanupUnusedMediaByKeys, collectMediaStorageKeys } from "@/services/file-storage";
import { cleanupUnusedImagesByKeys, collectImageStorageKeys } from "@/services/image-storage";
import { imageLogStore, readWorkbenchLogs, videoLogStore } from "@/services/workbench-log-storage";

export type AppMediaUsage = {
    assets: unknown;
    projects: unknown;
    imageLogs: unknown;
    videoLogs: unknown;
    extra?: unknown;
};

export function collectAppMediaStorageKeys(usage: AppMediaUsage) {
    return {
        imageKeys: collectImageStorageKeys(usage),
        mediaKeys: collectMediaStorageKeys(usage),
    };
}

export async function cleanupUnusedAppMedia(input: Pick<AppMediaUsage, "assets" | "projects" | "extra">) {
    const [imageLogs, videoLogs] = await Promise.all([readWorkbenchLogs(imageLogStore), readWorkbenchLogs(videoLogStore)]);
    const { imageKeys, mediaKeys } = collectAppMediaStorageKeys({ ...input, imageLogs, videoLogs });
    await Promise.all([cleanupUnusedImagesByKeys(imageKeys), cleanupUnusedMediaByKeys(mediaKeys)]);
}
