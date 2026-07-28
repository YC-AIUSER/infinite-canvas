import localforage from "localforage";

export type StoredWorkbenchLog = Record<string, unknown> & { id?: string };

export const imageLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "image_generation_logs" });
export const videoLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });
export type WorkbenchLogStore = typeof imageLogStore;

export async function readWorkbenchLogs(store: WorkbenchLogStore) {
    const logs: StoredWorkbenchLog[] = [];
    await store.iterate<StoredWorkbenchLog, void>((value) => {
        if (value && typeof value === "object") logs.push(value);
    });
    return logs;
}
