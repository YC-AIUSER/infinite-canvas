// 记录 zustand 持久化状态在本会话是否发生过降级读取（IndexedDB 读失败回退 localStorage）。
// hydrated 标志不区分"读到可信数据"与"读失败静默回退"——启动清扫这类破坏性操作
// 必须以这里为准：任一 store 降级读取过，引用集就不可信，本会话不许清扫。
const degradedReads = new Set<string>();

export function markStorageReadFallback(name: string) {
    degradedReads.add(name);
}

export function hasStorageReadFallback() {
    return degradedReads.size > 0;
}

export function hasStorageReadFallbackFor(name: string) {
    return degradedReads.has(name);
}

// 水合"定型"（成功或失败均算）之后才允许该 store 持久化写入。
// 只挡降级是不够的：降级标要等水合结束才打上，水合进行中发起的写入
// （含 canvas 400ms 防抖队列里排队的）会带着空初始态穿过守卫覆盖原始数据。
const settledHydrations = new Set<string>();

export function markHydrationSettled(name: string) {
    settledHydrations.add(name);
}

export function canPersist(name: string) {
    return settledHydrations.has(name) && !degradedReads.has(name);
}
