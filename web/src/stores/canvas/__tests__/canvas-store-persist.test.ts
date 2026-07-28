import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { localForageStorage } from "@/lib/localforage-storage";
import { createCanvasStorePersistQueue } from "../canvas-store-persist";

vi.mock("@/lib/localforage-storage", () => ({
    localForageStorage: {
        setItem: vi.fn(),
    },
}));

const setItem = vi.mocked(localForageStorage.setItem);

describe("画布持久化 flush", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        setItem.mockReset();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("存在待写入内容时 flush 立即写入并清除定时任务", () => {
        const queue = createCanvasStorePersistQueue(localForageStorage);
        queue.schedule("canvas", "pending-value");

        expect(setItem).not.toHaveBeenCalled();
        queue.flush();
        expect(setItem).toHaveBeenCalledTimes(1);
        expect(setItem).toHaveBeenCalledWith("canvas", "pending-value");

        vi.advanceTimersByTime(400);
        expect(setItem).toHaveBeenCalledTimes(1);
    });

    it("没有待写入内容时 flush 不写入", () => {
        const queue = createCanvasStorePersistQueue(localForageStorage);

        queue.flush();

        expect(setItem).not.toHaveBeenCalled();
    });
});
