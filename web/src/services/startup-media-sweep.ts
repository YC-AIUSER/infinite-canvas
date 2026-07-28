import { cleanupUnusedAppMedia } from "@/services/app-media-cleanup";
import { getSessionMediaKeys } from "@/services/session-media-keys";

// 孤儿媒体块的启动清扫。既有 GC 只有删素材/删画布/替换媒体三个事件触发点，
// 中断的上传（隐藏页时序、串写防护丢弃）和导入中途失败留下的无引用块会无限期滞留，
// 这里在应用启动、两个 store 都水合完成后补跑一次全量清扫兜底。
// 红线：清扫早于任一 store 水合会把真实媒体当孤儿批量删，必须双水合门 + 延迟。
const STARTUP_SWEEP_DELAY_MS = 8000;

// once 守卫放 globalThis 而非模块变量：Vite HMR 重载模块会重置模块变量，
// 模块级布尔在开发环境会导致每次热更新后再跑一轮清扫
const SCHEDULED_FLAG = "__infiniteCanvasStartupSweepScheduled";

export function scheduleStartupMediaSweep(delayMs = STARTUP_SWEEP_DELAY_MS) {
    // 每会话至多一次：热重载/路由切换重复挂载入口组件不该产生第二次清扫
    const holder = globalThis as Record<string, unknown>;
    if (holder[SCHEDULED_FLAG]) return;
    holder[SCHEDULED_FLAG] = true;
    void (async () => {
        const [{ useAssetStore }, { useCanvasStore }] = await Promise.all([import("@/stores/use-asset-store"), import("@/stores/canvas/use-canvas-store")]);
        const bothHydrated = () => useAssetStore.getState().hydrated && useCanvasStore.getState().hydrated;
        if (!bothHydrated()) {
            await new Promise<void>((resolve) => {
                const check = () => {
                    if (!bothHydrated()) return;
                    unsubAsset();
                    unsubCanvas();
                    resolve();
                };
                const unsubAsset = useAssetStore.subscribe(check);
                const unsubCanvas = useCanvasStore.subscribe(check);
            });
        }
        setTimeout(() => {
            const assets = useAssetStore.getState().assets;
            const projects = useCanvasStore.getState().projects;
            // 熔断：hydrated 只代表水合流程结束，不代表读到了可信数据——
            // localforage 读失败会静默回退（通常得到空状态）且仍置 hydrated。
            // 参照集全空时宁可不清（孤儿等下次启动），绝不拿空引用集删库。
            if (!assets.length && !projects.length) {
                console.debug("[startup-media-sweep] 参照集为空，跳过本轮清扫");
                return;
            }
            cleanupUnusedAppMedia({
                assets,
                projects,
                // 会话内新写的键视同有引用；删除时刻还会在 cleanup 内部实时再查一遍登记表
                extra: Array.from(getSessionMediaKeys(), (storageKey) => ({ storageKey })),
            })
                .then(() => console.debug("[startup-media-sweep] 启动孤儿媒体清扫完成"))
                .catch(() => undefined);
        }, delayMs);
    })().catch(() => {
        // store chunk 动态导入失败时放开守卫，允许后续重试，避免本会话清扫静默失效
        holder[SCHEDULED_FLAG] = false;
    });
}
