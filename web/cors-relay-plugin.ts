import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

// 通用 CORS 转发器:浏览器请求 /relay/<完整目标地址>,由 dev server 代为转发。
// 用途:渠道 Base URL 填 `/relay/https://某中转站/api/v1`,绕开目标服务端未配置 CORS 的限制。
// 仅本机 dev server 生效;静态部署(vite build)不包含此中间件。
const RELAY_PREFIX = "/relay/";
// 只放行 AI 网关常用头,避免把浏览器侧的 cookie 等敏感头转发出去
const FORWARD_HEADERS = ["authorization", "content-type", "accept", "x-api-key", "anthropic-version", "openai-organization"];

export function corsRelayPlugin(): Plugin {
    return {
        name: "cors-relay",
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (!req.url || !req.url.startsWith(RELAY_PREFIX)) return next();
                void relay(req, res);
            });
        },
    };
}

async function relay(req: IncomingMessage, res: ServerResponse) {
    const rawTarget = decodeURIComponent(req.url!.slice(RELAY_PREFIX.length));
    let target: URL;
    try {
        target = new URL(rawTarget);
        if (target.protocol !== "https:" && target.protocol !== "http:") throw new Error("bad protocol");
    } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: { message: `无效的转发目标:${rawTarget}` } }));
        return;
    }
    const headers: Record<string, string> = {};
    for (const name of FORWARD_HEADERS) {
        const value = req.headers[name];
        if (typeof value === "string") headers[name] = value;
    }
    try {
        const hasBody = req.method !== "GET" && req.method !== "HEAD";
        const response = await fetch(target, {
            method: req.method,
            headers,
            body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
            // @ts-expect-error node fetch 需要 duplex 才能流式转发请求体
            duplex: hasBody ? "half" : undefined,
        });
        res.statusCode = response.status;
        response.headers.forEach((value, name) => {
            // 跳过按跳传输相关头,由本地连接自行协商
            if (["content-encoding", "transfer-encoding", "content-length", "connection"].includes(name)) return;
            res.setHeader(name, value);
        });
        if (response.body) Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(res);
        else res.end();
    } catch (error) {
        res.statusCode = 502;
        res.end(JSON.stringify({ error: { message: `转发失败:${error instanceof Error ? error.message : String(error)}` } }));
    }
}
