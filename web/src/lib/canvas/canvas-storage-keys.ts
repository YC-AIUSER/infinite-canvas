const storageKeyPattern = /^(image|video|audio|file|video-reference|audio-reference):/;

export function isCanvasStorageKey(value: unknown): value is string {
    return typeof value === "string" && storageKeyPattern.test(value);
}

export function collectCanvasStorageKeys(value: unknown, keys = new Set<string>()) {
    if (isCanvasStorageKey(value)) {
        keys.add(value);
        return [...keys];
    }
    if (!value || typeof value !== "object") return [...keys];
    Object.values(value).forEach((item) => collectCanvasStorageKeys(item, keys));
    return [...keys];
}

export function replaceCanvasStorageKeys<T>(value: T, keyMap: ReadonlyMap<string, string>): T {
    if (typeof value === "string") return (keyMap.get(value) || value) as T;
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((item) => replaceCanvasStorageKeys(item, keyMap)) as T;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceCanvasStorageKeys(item, keyMap)])) as T;
}
