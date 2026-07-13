// Toonflow 生产版 CORS 转发核心(替代仅 dev 生效的 web/cors-relay-plugin.ts)。
// 纯 Web 标准 fetch/Request/Response,可跑在 Cloudflare Workers / Vercel Edge / Deno Deploy / 自有 serverless。
// 安全模型对齐设计文档「工程审查决议 18」:访问 token 门 + 来源校验 + 上游白名单(防开放代理/SSRF),
// 三者未配置一律 fail-closed 拒绝——无认证的公开代理不允许上线。
//
// key 模型:本核心走「用户自带 key」——原样转发浏览器带来的 Authorization/x-api-key。
// 若最终选「创始人代理计费」,在 forwardHeaders 前注入 env 里的服务商 key,并接入平台 KV 做「用户级用量限额」
// (见文件尾 PROXY-BILLING 注释),那是需创始人决策 + 平台状态存储的增量,不在本核心内。

export type RelayEnv = {
    /** 访问 token(必填):请求需带 header `x-relay-token` 与之匹配,否则拒绝。 */
    RELAY_ACCESS_TOKEN?: string;
    /** 上游 host 白名单,逗号分隔(必填):只允许转发到这些主机,防开放代理。例:"cano.gewuzhihui.com,api.openai.com"。 */
    RELAY_ALLOWED_TARGET_HOSTS?: string;
    /** 浏览器 Origin 白名单,逗号分隔(来源校验)。留空=不校验(仅本地/调试用);"*"=放开(不建议生产)。 */
    RELAY_ALLOWED_ORIGINS?: string;
};

const RELAY_PREFIX = "/relay/";
// 只放行 AI 网关常用头,绝不转发浏览器侧 cookie 等敏感头。
const FORWARD_HEADERS = ["authorization", "content-type", "accept", "x-api-key", "anthropic-version", "openai-organization"];
const HOP_BY_HOP = ["content-encoding", "transfer-encoding", "content-length", "connection"];

function splitList(value?: string): string[] {
    return (value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function corsHeaders(origin: string | null, allowedOrigins: string[]): Record<string, string> {
    const headers: Record<string, string> = {
        "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
        "access-control-allow-headers": [...FORWARD_HEADERS, "x-relay-token"].join(","),
        "access-control-max-age": "86400",
    };
    const allowOrigin = allowedOrigins.includes("*") ? (origin ?? "*") : origin && allowedOrigins.includes(origin) ? origin : "";
    if (allowOrigin) {
        headers["access-control-allow-origin"] = allowOrigin;
        headers.vary = "Origin";
    }
    return headers;
}

function errorResponse(status: number, message: string, cors: Record<string, string>): Response {
    return new Response(JSON.stringify({ error: { message } }), { status, headers: { ...cors, "content-type": "application/json" } });
}

export async function handleRelay(request: Request, env: RelayEnv): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const allowedOrigins = splitList(env.RELAY_ALLOWED_ORIGINS);
    const cors = corsHeaders(origin, allowedOrigins);

    // CORS 预检
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    // 来源校验(决议 18):配了白名单(且非 *)则强制,缺失或不在名单一律拒绝。
    if (allowedOrigins.length && !allowedOrigins.includes("*")) {
        if (!origin || !allowedOrigins.includes(origin)) return errorResponse(403, "来源不被允许", cors);
    }

    // 访问 token 门(决议 18):必须配置且匹配,否则 fail-closed。
    if (!env.RELAY_ACCESS_TOKEN) return errorResponse(503, "转发未配置访问 token（RELAY_ACCESS_TOKEN），已拒绝以避免开放代理", cors);
    if (request.headers.get("x-relay-token") !== env.RELAY_ACCESS_TOKEN) return errorResponse(401, "访问 token 无效", cors);

    // 路径:/relay/<完整目标地址>
    if (!url.pathname.startsWith(RELAY_PREFIX)) return errorResponse(404, "非转发路径（应为 /relay/<目标地址>）", cors);
    const rawTarget = decodeURIComponent(url.pathname.slice(RELAY_PREFIX.length)) + url.search;
    let target: URL;
    try {
        target = new URL(rawTarget);
        // 生产强制 https,避免明文外发与被降级。
        if (target.protocol !== "https:") throw new Error("bad protocol");
    } catch {
        return errorResponse(400, `无效的转发目标（需 https 绝对地址）：${rawTarget}`, cors);
    }

    // 上游 host 白名单(决议 18,防开放代理/SSRF):必须配置且命中。
    const allowedHosts = splitList(env.RELAY_ALLOWED_TARGET_HOSTS);
    if (!allowedHosts.length) return errorResponse(503, "转发未配置上游白名单（RELAY_ALLOWED_TARGET_HOSTS），已拒绝以避免开放代理", cors);
    if (!allowedHosts.includes(target.host)) return errorResponse(403, `上游主机 ${target.host} 不在白名单内`, cors);

    // 头白名单 + 流式转发
    const forwardHeaders = new Headers();
    for (const name of FORWARD_HEADERS) {
        const value = request.headers.get(name);
        if (value) forwardHeaders.set(name, value);
    }
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    let upstream: Response;
    try {
        upstream = await fetch(target.toString(), {
            method: request.method,
            headers: forwardHeaders,
            body: hasBody ? request.body : undefined,
            // 流式转发请求体需要 duplex(部分运行时要求),用 as 规避类型缺失。
            ...(hasBody ? ({ duplex: "half" } as Record<string, unknown>) : {}),
        });
    } catch (error) {
        return errorResponse(502, `转发失败：${error instanceof Error ? error.message : String(error)}`, cors);
    }

    const responseHeaders = new Headers(cors);
    upstream.headers.forEach((value, name) => {
        if (!HOP_BY_HOP.includes(name.toLowerCase())) responseHeaders.set(name, value);
    });
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

// ── PROXY-BILLING（若 Open Q1 选「创始人代理计费」而非「用户自带 key」）───────────────────────────
// 增量(需创始人决策后再做,涉及创始人 key 与账单,故不在本核心):
//   1) 转发前把 forwardHeaders 的 authorization 改成注入 env.PROVIDER_API_KEY（创始人的服务商 key）。
//   2) 用户级用量限额:以 x-relay-token（每个内测用户一枚)为键,接平台 KV/Durable Object 记账并按额度拦截。
//      Cloudflare→Workers KV/Durable Objects;Vercel→Vercel KV;自有→Redis。
//   3) 审计:记录 用户 token / 上游 / 耗时 / 状态 便于排查滥用与成本核算（设计文档 Risks「代理计费 key 滥用」）。
