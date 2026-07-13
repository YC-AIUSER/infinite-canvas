// Vercel Edge Function 入口。放到 Vercel 项目的 `api/relay/[...path].ts`(捕获 /relay/* 全路径),
// 或按你的路由约定挂载;env 在 Vercel 项目 Settings → Environment Variables 配置。部署见 README。
import { handleRelay } from "./relay-core";

export const config = { runtime: "edge" };

export default function handler(request: Request): Promise<Response> {
    // Vercel Edge 通过 process.env 读环境变量。
    return handleRelay(request, {
        RELAY_ACCESS_TOKEN: process.env.RELAY_ACCESS_TOKEN,
        RELAY_ALLOWED_TARGET_HOSTS: process.env.RELAY_ALLOWED_TARGET_HOSTS,
        RELAY_ALLOWED_ORIGINS: process.env.RELAY_ALLOWED_ORIGINS,
    });
}
