import { describe, expect, it } from "vitest";

import { mergeWithTombstones, pruneSyncTombstones, type SyncTombstone } from "../sync-tombstones";

const now = Date.parse("2026-07-28T12:00:00.000Z");

describe("WebDAV 同步墓碑", () => {
    it("本地删除后不会被远端旧条目复活", () => {
        const merged = mergeWithTombstones([], [{ id: "canvas-1", updatedAt: "2026-07-27T12:00:00.000Z" }], [{ id: "canvas-1", deletedAt: "2026-07-28T10:00:00.000Z" }], [], "updatedAt", now);

        expect(merged.items).toEqual([]);
        expect(merged.deletions).toEqual([{ id: "canvas-1", deletedAt: "2026-07-28T10:00:00.000Z" }]);
    });

    it("删除时间之后更新的远端条目胜出并使墓碑失效", () => {
        const remote = { id: "asset-1", updatedAt: "2026-07-28T11:00:00.000Z" };
        const merged = mergeWithTombstones([], [remote], [{ id: "asset-1", deletedAt: "2026-07-28T10:00:00.000Z" }], [], "updatedAt", now);

        expect(merged.items).toEqual([remote]);
        expect(merged.deletions).toEqual([]);
    });

    it("远端旧清单没有 deletions 字段时仍可正常合并", () => {
        const remote = { id: "log-1", createdAt: now - 1000 };
        const merged = mergeWithTombstones([], [remote], [], undefined, "createdAt", now);

        expect(merged.items).toEqual([remote]);
        expect(merged.deletions).toEqual([]);
    });

    it("只按 180 天龄期裁剪，不按数量截断——批量删除的墓碑一条不丢", () => {
        const recent: SyncTombstone[] = Array.from({ length: 1005 }, (_, index) => ({ id: `recent-${index}`, deletedAt: new Date(now - index * 1000).toISOString() }));
        const old = { id: "old", deletedAt: new Date(now - 181 * 24 * 60 * 60 * 1000).toISOString() };
        const pruned = pruneSyncTombstones([...recent, old], now);

        expect(pruned).toHaveLength(1005);
        expect(pruned[0].id).toBe("recent-0");
        expect(pruned.some((item) => item.id === "recent-1004")).toBe(true);
        expect(pruned.some((item) => item.id === "old")).toBe(false);
    });
});
