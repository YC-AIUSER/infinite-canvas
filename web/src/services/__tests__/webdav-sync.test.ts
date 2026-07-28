import { describe, expect, it } from "vitest";

import { isPrivateHost, testWebdavConnection } from "../webdav-sync";

describe("WebDAV 地址安全校验", () => {
    it.each([
        "localhost",
        "studio.localhost",
        "nas.local",
        "127.0.0.1",
        "127.255.255.255",
        "10.0.0.1",
        "192.168.1.1",
        "172.16.0.1",
        "172.31.255.255",
        "169.254.1.1",
        "::1",
        "[::1]",
    ])("识别私网或回环主机 %s", (hostname) => {
        expect(isPrivateHost(hostname)).toBe(true);
    });

    it.each(["example.com", "localhost.example.com", "11.0.0.1", "192.167.1.1", "172.15.0.1", "172.32.0.1", "169.255.1.1", "256.1.1.1"])("拒绝把公网或非法主机 %s 视为私网", (hostname) => {
        expect(isPrivateHost(hostname)).toBe(false);
    });

    it("公网 HTTP 地址在发起请求前提示明文风险", async () => {
        await expect(testWebdavConnection({ url: "http://dav.example.com", username: "user", password: "pass", directory: "infinite-canvas", lastSyncedAt: "" })).rejects.toThrow("公网 WebDAV 使用 HTTP 会明文传输账号凭据和同步内容，请改用 HTTPS");
    });
});
