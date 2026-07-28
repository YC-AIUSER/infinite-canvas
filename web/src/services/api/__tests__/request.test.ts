import { describe, expect, it } from "vitest";

import { isRelayRequestUrl, withRelayTokenHeader } from "../request";

describe("edge relay 请求识别", () => {
    it.each(["/relay/https://api.example/v1/images", "https://relay.example/relay/http://127.0.0.1:8000/v1/models"])("识别 relay URL：%s", (url) => {
        expect(isRelayRequestUrl(url)).toBe(true);
        expect(withRelayTokenHeader(url, "secret", { Authorization: "Bearer key" })).toEqual({ Authorization: "Bearer key", "x-relay-token": "secret" });
    });

    it.each(["https://api.example/v1/images", "https://api.example/v1?next=/relay/https://target.example", "/api/relay/status"])("不识别普通 URL：%s", (url) => {
        expect(isRelayRequestUrl(url)).toBe(false);
        expect(withRelayTokenHeader(url, "secret", { Authorization: "Bearer key" })).toEqual({ Authorization: "Bearer key" });
    });
});
