import localforage from "localforage";

export type SyncTombstoneDomain = "canvas" | "assets" | "image-workbench" | "video-workbench";
export type SyncTombstone = { id: string; deletedAt: string };

const TOMBSTONE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const TOMBSTONE_LIMIT = 1000;
const tombstoneStore = localforage.createInstance({ name: "infinite-canvas", storeName: "sync_tombstones" });
const pendingWrites = new Map<SyncTombstoneDomain, Promise<void>>();

export function mergeWithTombstones<T extends { id?: string }>(
    local: T[],
    remote: T[],
    localDeletions: SyncTombstone[] | undefined,
    remoteDeletions: SyncTombstone[] | undefined,
    timeKey: string,
    now = Date.now(),
) {
    const items = new Map<string, T>();
    remote.forEach((item) => {
        if (item.id) items.set(item.id, item);
    });
    local.forEach((item) => {
        if (!item.id) return;
        const current = items.get(item.id);
        if (!current || getItemTime(item, timeKey) >= getItemTime(current, timeKey)) items.set(item.id, item);
    });

    const tombstones = new Map<string, SyncTombstone>();
    [...(remoteDeletions || []), ...(localDeletions || [])].forEach((deletion) => {
        const deletedAt = getTombstoneTime(deletion);
        if (!deletion?.id || !deletedAt) return;
        const current = tombstones.get(deletion.id);
        if (!current || deletedAt >= getTombstoneTime(current)) tombstones.set(deletion.id, deletion);
    });

    const mergedItems = Array.from(items.values()).filter((item) => {
        const deletion = item.id ? tombstones.get(item.id) : undefined;
        if (!deletion) return Boolean(item.id);
        if (getItemTime(item, timeKey) > getTombstoneTime(deletion)) {
            tombstones.delete(item.id || "");
            return true;
        }
        return false;
    });

    return {
        items: mergedItems.sort((a, b) => getItemTime(b, timeKey) - getItemTime(a, timeKey)),
        deletions: pruneSyncTombstones(Array.from(tombstones.values()), now),
    };
}

export function pruneSyncTombstones(deletions: SyncTombstone[], now = Date.now()) {
    const cutoff = now - TOMBSTONE_RETENTION_MS;
    const latest = new Map<string, SyncTombstone>();
    deletions.forEach((deletion) => {
        const deletedAt = getTombstoneTime(deletion);
        if (!deletion?.id || deletedAt < cutoff) return;
        const current = latest.get(deletion.id);
        if (!current || deletedAt >= getTombstoneTime(current)) latest.set(deletion.id, deletion);
    });
    return Array.from(latest.values())
        .sort((a, b) => getTombstoneTime(b) - getTombstoneTime(a))
        .slice(0, TOMBSTONE_LIMIT);
}

export async function readSyncTombstones(domain: SyncTombstoneDomain) {
    await pendingWrites.get(domain);
    return pruneSyncTombstones((await tombstoneStore.getItem<SyncTombstone[]>(domain)) || []);
}

export function writeSyncTombstones(domain: SyncTombstoneDomain, deletions: SyncTombstone[]) {
    return queueWrite(domain, () => tombstoneStore.setItem(domain, pruneSyncTombstones(deletions)).then(() => undefined));
}

export function recordSyncDeletions(domain: SyncTombstoneDomain, ids: Iterable<string>, deletedAt = new Date().toISOString()) {
    const nextIds = Array.from(new Set(ids)).filter(Boolean);
    if (!nextIds.length) return Promise.resolve();
    return queueWrite(domain, async () => {
        const current = (await tombstoneStore.getItem<SyncTombstone[]>(domain)) || [];
        const next = pruneSyncTombstones([...current, ...nextIds.map((id) => ({ id, deletedAt }))]);
        await tombstoneStore.setItem(domain, next);
    });
}

function queueWrite(domain: SyncTombstoneDomain, write: () => Promise<void>) {
    const next = (pendingWrites.get(domain) || Promise.resolve()).catch(() => undefined).then(write);
    pendingWrites.set(domain, next);
    void next.then(
        () => {
            if (pendingWrites.get(domain) === next) pendingWrites.delete(domain);
        },
        () => {
            if (pendingWrites.get(domain) === next) pendingWrites.delete(domain);
        },
    );
    return next;
}

function getItemTime(item: object, key: string) {
    const value = (item as Record<string, unknown>)[key];
    if (typeof value === "number") return value;
    if (typeof value === "string") return Date.parse(value) || 0;
    return 0;
}

function getTombstoneTime(deletion: SyncTombstone) {
    return typeof deletion?.deletedAt === "string" ? Date.parse(deletion.deletedAt) || 0 : 0;
}
