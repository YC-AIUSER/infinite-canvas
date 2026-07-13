# Toonflow 生产版转发（edge-relay）

`web/cors-relay-plugin.ts` 只在本地 dev server 生效；静态部署（GitHub Pages / nginx / Vercel 静态）里浏览器直连 AI 网关会撞 CORS。本目录是**生产版转发函数**，把 dev 的 `/relay/` 能力搬到 serverless/edge，并按设计文档「工程审查决议 18」做了安全加固。

## 文件

| 文件 | 用途 |
|---|---|
| `relay-core.ts` | 可移植转发核心（纯 Web 标准 fetch/Request/Response），所有安全逻辑在此 |
| `cloudflare-worker.ts` | Cloudflare Workers 入口 |
| `vercel-edge.ts` | Vercel Edge Function 入口 |

## 安全模型（决议 18，三者均 fail-closed）

- **访问 token 门**：请求必须带 header `x-relay-token`，与 env `RELAY_ACCESS_TOKEN` 匹配；未配置直接拒绝。给每个内测用户发一枚 token。
- **上游白名单**：env `RELAY_ALLOWED_TARGET_HOSTS`（逗号分隔）只允许转发到指定 AI 网关主机，**防开放代理 / SSRF**；未配置直接拒绝。
- **来源校验**：env `RELAY_ALLOWED_ORIGINS`（逗号分隔）限制浏览器 Origin；生产必配为你的内测站点域名。

## 前端接法

渠道 Base URL 从 dev 的 `/relay/https://上游/api/v1` 改为指向部署后的转发域名：
`https://<你的转发域名>/relay/https://cano.gewuzhihui.com/api/v1`，并让前端在请求头带上 `x-relay-token`。

## 部署（先手动跑通，再考虑 CI）

### Cloudflare Workers
```
npm i -g wrangler
# wrangler.toml: main = "cloudflare-worker.ts"
wrangler secret put RELAY_ACCESS_TOKEN
wrangler deploy
# vars: RELAY_ALLOWED_TARGET_HOSTS / RELAY_ALLOWED_ORIGINS 在 wrangler.toml [vars] 或 dashboard 配
```

### Vercel Edge
把 `vercel-edge.ts` 放到 Vercel 项目的 `api/relay/[...path].ts`，在 Settings → Environment Variables 配三个 env，`vercel deploy`。

## ⚠️ 两个待你拍板的决策（决定最终形态）

1. **部署到哪**：Cloudflare Workers / Vercel / 自有服务器。三者转发核心通用，只是入口与 env 配法不同。
2. **key 模型**：
   - **用户自带 key**（当前核心已支持）：转发用户自己的 key，你零成本、零滥用风险，但用户体验略差（要各自配 key）。
   - **创始人代理计费**：注入你的服务商 key + 按用户限额 + 审计。**涉及你的 key 与账单，且需平台状态存储（Cloudflare KV / Vercel KV / Redis）**，属增量工作。`relay-core.ts` 末尾的 `PROXY-BILLING` 注释已列出改造点；选这条我再接着做。

> 未决策前，本转发核心即可支撑「用户自带 key」的内测；选定后按上表落地即可上线。
