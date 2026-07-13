import { describe, expect, it } from "vitest";

import {
    buildActionContractPrompt,
    buildNodeContext,
    buildScriptPrompt,
    buildShotContractPrompt,
    buildSpaceContractPrompt,
    buildStoryboardTablePrompt,
    washPrompt,
} from "../prompts";

describe("washPrompt", () => {
    it("单词命中时替换并记录 hits", () => {
        const result = washPrompt("镜头里出现 iPhone");
        expect(result.washed).toBe("镜头里出现 智能手机");
        expect(result.hits).toEqual([{ term: "iPhone", replacement: "智能手机" }]);
    });

    it("多词命中时全部替换", () => {
        const result = washPrompt("角色在 KTV 使用 iPhone");
        expect(result.washed).toBe("角色在 娱乐房间 使用 智能手机");
        expect(result.hits.map((hit) => hit.term)).toEqual(expect.arrayContaining(["KTV", "iPhone"]));
        expect(result.hits).toHaveLength(2);
    });

    it("零命中时返回原文", () => {
        const text = "角色在公园里慢慢散步";
        expect(washPrompt(text)).toEqual({ washed: text, hits: [] });
    });

    it("长词优先并将长短词分别整体替换", () => {
        const result = washPrompt("先踹飞撞墙星爆，再踹飞");
        expect(result.washed).toBe("先轻轻扫倒，柔和碰撞，眩晕旋涡眼与小星星，再失衡后滑开");
        expect(result.hits.map((hit) => hit.term)).toEqual(["踹飞撞墙星爆", "踹飞"]);
    });

    it("英文匹配不区分大小写", () => {
        const result = washPrompt("JAZZ PIANO starts now");
        expect(result.washed).toBe("gentle instrumental music starts now");
        expect(result.hits).toEqual([{ term: "Jazz Piano", replacement: "gentle instrumental music" }]);
    });
});

describe("buildNodeContext", () => {
    it("按节点优先级排序输入", () => {
        const context = buildNodeContext("storyboard-table", {
            project: "项目",
            assets: "资产",
            "space-contract": "空间合同",
            script: "剧本",
            "existing-ids": "已有 ID",
        });
        const headings = ["existing-ids", "script", "space-contract", "assets", "project"];
        headings.slice(1).forEach((heading, index) => {
            expect(context.indexOf(`【${headings[index]}】`)).toBeLessThan(context.indexOf(`【${heading}】`));
        });
    });

    it("超过 8000 字符时从最低优先级尾部裁剪且总长恰为 8000", () => {
        const fixedPrefix = "【source】\n高优先级\n\n【project】\n中优先级\n\n【assets】\n";
        const context = buildNodeContext("script", {
            source: "高优先级",
            project: "中优先级",
            assets: "低".repeat(9000),
        });
        expect(context).toHaveLength(8000);
        expect(context).toBe(fixedPrefix + "低".repeat(8000 - fixedPrefix.length));
    });

    it("未知键排在已知优先级键之后", () => {
        const context = buildNodeContext("script", { extra: "额外", source: "来源" });
        expect(context.indexOf("【source】")).toBeLessThan(context.indexOf("【extra】"));
    });
});

describe("提示词模板", () => {
    it.each([
        ["剧本", buildScriptPrompt],
        ["空间合同", buildSpaceContractPrompt],
        ["分镜表", buildStoryboardTablePrompt],
        ["镜头合同", buildShotContractPrompt],
        ["动作合同", buildActionContractPrompt],
    ])("%s 模板包含输入上下文区", (_name, builder) => {
        expect(builder("测试上下文")).toContain("【输入上下文】");
    });

    it("分镜表模板包含 1:1 与 durationSec", () => {
        const prompt = buildStoryboardTablePrompt("上下文");
        expect(prompt).toContain("1:1");
        expect(prompt).toContain("durationSec");
    });

    it("镜头合同模板包含落点", () => {
        expect(buildShotContractPrompt("上下文")).toContain("落点");
    });
});
