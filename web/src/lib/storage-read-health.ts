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
