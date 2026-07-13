// Cloudflare Workers 入口。部署见 README。
// env 里配置 RELAY_ACCESS_TOKEN / RELAY_ALLOWED_TARGET_HOSTS / RELAY_ALLOWED_ORIGINS(用 wrangler secret 或 vars)。
import { handleRelay, type RelayEnv } from "./relay-core";

export default {
    fetch(request: Request, env: RelayEnv): Promise<Response> {
        return handleRelay(request, env);
    },
};
