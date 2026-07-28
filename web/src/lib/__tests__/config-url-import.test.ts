import { describe, expect, it } from "vitest";

import { clearConfigUrlImport, parseConfigUrlImport } from "../config-url-import";

describe("配置 URL 导入", () => {
    it("优先从 fragment 解析配置并兼容 query", () => {
        expect(parseConfigUrlImport("?apiKey=old&baseUrl=https%3A%2F%2Fold.example", "#apiKey=new&baseUrl=https%3A%2F%2Frelay.example%2Frelay%2Fhttps%3A%2F%2Fapi.example")).toEqual({
            apiKey: "new",
            baseUrl: "https://relay.example/relay/https://api.example",
        });
        expect(parseConfigUrlImport("?apikey=legacy&baseurl=https%3A%2F%2Fapi.example", "")).toEqual({ apiKey: "legacy", baseUrl: "https://api.example" });
    });

    it("清理 query 和 fragment 中的配置键并保留其他参数", () => {
        expect(clearConfigUrlImport({ pathname: "/canvas/1", search: "?tab=image&apiKey=old", hash: "#baseUrl=https%3A%2F%2Fapi.example&panel=config" })).toBe("/canvas/1?tab=image#panel=config");
    });
});
