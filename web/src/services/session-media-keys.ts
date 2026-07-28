// 本会话内写入过存储的媒体键登记表。启动清扫把这些键视同有引用：
// 节点/资产状态要经 400ms 防抖才落库，blob 却是先写的——不豁免会话内新键，
// 清扫恰好跑在这个窗口里就会把刚上传的文件当孤儿误删。
// 只登记不注销：代价只是"本会话新产生的真孤儿要等下次启动才回收"，换绝不误删。
const sessionMediaKeys = new Set<string>();

export function registerSessionMediaKey(storageKey: string) {
    sessionMediaKeys.add(storageKey);
}

export function getSessionMediaKeys(): ReadonlySet<string> {
    return sessionMediaKeys;
}
