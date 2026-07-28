import type { StateStorage } from "zustand/middleware";

type PendingPersistWrite = {
    name: string;
    value: string;
};

export function createCanvasStorePersistQueue(storage: Pick<StateStorage, "setItem">, delay = 400) {
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingWrite: PendingPersistWrite | null = null;

    const writePending = () => {
        const write = pendingWrite;
        pendingWrite = null;
        if (!write) return;
        return storage.setItem(write.name, write.value);
    };

    return {
        schedule(name: string, value: string) {
            pendingWrite = { name, value };
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                saveTimer = null;
                void writePending();
            }, delay);
        },
        flush() {
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = null;
            return writePending();
        },
    };
}
