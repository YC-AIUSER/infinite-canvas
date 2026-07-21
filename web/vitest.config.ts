import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
    // 源码里组件一律用 @ 别名导入,vitest 不继承 vite.config 的 resolve,必须在此单独补一份,
    // 否则任何 import 了组件的测试文件都会整个加载失败(报 Cannot find package '@/...')。
    resolve: {
        alias: {
            "@": resolve(dirname(fileURLToPath(import.meta.url)), "src"),
        },
    },
    test: {
        include: ["src/**/__tests__/**/*.test.ts"],
        environment: "node",
    },
});
