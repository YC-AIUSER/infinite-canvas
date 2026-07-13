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

## ✅ 已选定方案：Cloudflare Workers + 用户自带 key

创始人把选择权交给 Claude，基于「非技术创始人 + 避免动创始人 key/账单 + 零滥用风险」选定：

- **平台 = Cloudflare Workers**：免费额度大、边缘快、单文件部署，独立于前端静态托管（可配现有 GitHub Pages 站点）。配置见本目录 `wrangler.toml`。
- **key 模型 = 用户自带 key**：转发只做代理，不注入创始人 key。转发核心已直接支持，无需额外代码。

### 上线三步（需要你的 Cloudflare 账号，免费）
```
npm i -g wrangler
cd edge-relay
# 1) 编辑 wrangler.toml：把 RELAY_ALLOWED_ORIGINS 填成你的内测站点域名，RELAY_ALLOWED_TARGET_HOSTS 填你用的上游网关
# 2) 设访问 token（发给内测用户，前端请求带 header x-relay-token）
wrangler secret put RELAY_ACCESS_TOKEN
# 3) 部署
wrangler deploy
```
部署后拿到 `https://toonflow-relay.<你的子域>.workers.dev`，前端渠道 Base URL 用 `https://toonflow-relay.<...>.workers.dev/relay/https://上游/api/v1`。

> 实际部署与设 secret 需要你的 Cloudflare 登录，这步只能你来跑（`wrangler login` + 上面三步）。

### 若日后改「创始人代理计费」
注入你的 key + 用户级限额 + 审计，需 Cloudflare KV/Durable Objects + 你确认额度策略（涉及你的 key 与账单）。`relay-core.ts` 末尾 `PROXY-BILLING` 注释已列改造点，届时告诉我即可。
