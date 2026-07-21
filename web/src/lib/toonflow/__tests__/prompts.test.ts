import { describe, expect, it } from "vitest";

import { renderLibraries } from "../closed-libraries";
import {
    buildActionContractPrompt,
    buildContinuityTablePrompt,
    buildCreativePrompt,
    buildDirectingLockPrompt,
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
        ["创意", buildCreativePrompt],
        ["剧本", buildScriptPrompt],
        ["空间合同", buildSpaceContractPrompt],
        ["跨段状态继承表", buildContinuityTablePrompt],
        ["分镜决策锁定表", buildDirectingLockPrompt],
        ["分镜表", buildStoryboardTablePrompt],
        ["镜头合同", buildShotContractPrompt],
        ["动作合同", buildActionContractPrompt],
    ])("%s 模板包含输入上下文区", (_name, builder) => {
        expect(builder("测试上下文")).toContain("【输入上下文】");
    });

    // plus 弃用九宫格 1:1，改为「画格数=因果步骤数、覆盖率 100%」，故断言从 1:1 换成覆盖率口径。
    it("分镜表模板包含画格覆盖率 100% 与 durationSec", () => {
        const prompt = buildStoryboardTablePrompt("上下文");
        expect(prompt).toContain("画格数 = 因果步骤数");
        expect(prompt).toContain("覆盖率必须是 100%");
        expect(prompt).toContain("durationSec");
        expect(prompt).not.toContain("九宫格");
    });

    it("镜头合同模板包含落点", () => {
        expect(buildShotContractPrompt("上下文")).toContain("落点");
    });
});

describe("plus 方法论保真", () => {
    it("剧本模板含 F1-F7 格式铁律、万能敷衍词黑名单与零铺垫三段式", () => {
        const prompt = buildScriptPrompt("上下文");
        for (const rule of ["F1", "F2", "F3", "F4", "F5", "F6", "F7"]) expect(prompt).toContain(rule);
        expect(prompt).toContain("万能敷衍词黑名单");
        expect(prompt).toContain("微微一笑");
        expect(prompt).toContain("0-3s 冲突切入 / 3-12s 冲突推进 / 12-15s 钩子收尾");
        // 下游资产环节依赖，重写后必须保留。
        expect(prompt).toContain("角色实体清单");
        expect(prompt).toContain("道具实体清单");
    });

    it("空间合同模板含俯视调度图画法与运动方向锁四条", () => {
        const prompt = buildSpaceContractPrompt("上下文");
        expect(prompt).toContain("墙线 + 门洞 + 火柴人 + 虚线箭头");
        expect(prompt).toContain("禁止画成俯视插图");
        expect(prompt).toContain("焰与尾迹的方向 = 运动的反方向");
        expect(prompt).toContain("朝向连续性锁");
        // 旧线保留项。
        expect(prompt).toContain("主角恒左、反派恒右");
    });

    it("分镜表模板含 Layer1 前件与黄金三秒钩子六字段", () => {
        const prompt = buildStoryboardTablePrompt("上下文");
        for (const field of ["开场类型=", "钩子类型=", "钩子画面=", "情绪强度=", "人物关系呈现=", "情绪冲突锚点="]) {
            expect(prompt).toContain(field);
        }
        for (const gate of ["P1 剧本锚定", "P2 上下文感知", "P6 黄金三秒钩子锚定", "P7 导演技法映射", "P3 母题出场", "P5 相邻段接缝"]) {
            expect(prompt).toContain(gate);
        }
    });

    it("分镜表模板含铁律 11 ⓪ 分段三原则并标注台词类型", () => {
        const prompt = buildStoryboardTablePrompt("上下文");
        expect(prompt).toContain("打包贴满");
        expect(prompt).toContain("缝位选择");
        expect(prompt).toContain("连续动作不拆段");
        expect(prompt).toContain("以贴满 15 秒为目标");
        expect(prompt).toContain("出口对白-{角色名}");
        expect(prompt).toContain("OS-{角色名}");
    });

    it("镜头合同模板含口型要求与 lipSync 字段", () => {
        const prompt = buildShotContractPrompt("上下文");
        expect(prompt).toContain("lipSync");
        expect(prompt).toContain("严禁任何人对旁白或内心内容做口型");
        expect(prompt).toContain("画面方位 + 服饰或发型特征");
    });

    it("动作合同模板含因果锚点三问与相邻镜因果四模式", () => {
        const prompt = buildActionContractPrompt("上下文");
        expect(prompt).toContain("A 动作 → 反应 / B 建立 → 推进 / C 原因 → 结果 / D 收紧聚焦");
        expect(prompt).toContain("因果覆盖率必须是 100%");
        expect(prompt).toContain("禁止用“自然过渡”作答");
    });

    it("创意模板双模式齐全并覆盖体检四张表", () => {
        const prompt = buildCreativePrompt("上下文");
        expect(prompt).toContain("【体检模式】");
        expect(prompt).toContain("【冷启动模式】");
        expect(prompt).toContain("碰撞法三步");
        expect(prompt).toContain("31 种主流题材表");
        expect(prompt).toContain("二阶段冲击模型");
        expect(prompt).toContain("七大爽点");
        expect(prompt).toContain("四类结尾钩子");
        expect(prompt).toContain("三大付费卡点");
        expect(prompt).toContain("ARC-SUSPENSE 悬疑螺旋波");
    });

    it("分镜决策锁定表模板含 A/B 表、自检八条、缝合同四行与 JSON 键名", () => {
        const prompt = buildDirectingLockPrompt("上下文");
        expect(prompt).toContain("A 表 · 全局视觉策略");
        expect(prompt).toContain("B 表 · 逐段锁定");
        expect(prompt).toContain("锁定表自检八条");
        for (const line of ["上段末拍 =", "本段首格 =", "景别/动机 =", "声音桥 ="]) expect(prompt).toContain(line);
        for (const key of ["unifiedStyleString", "compositionPrimary", "openingType", "soundBridge"]) expect(prompt).toContain(key);
        expect(prompt).toContain("只引用不复判");
    });

    it("跨段状态继承表模板含五类锁定项与 JSON 键名", () => {
        const prompt = buildContinuityTablePrompt("上下文");
        expect(prompt).toContain("道具只许被角色的手改变");
        for (const key of ["propWhitelist", "blocking", "lightingWeather", "characterGear", "leftovers"]) {
            expect(prompt).toContain(key);
        }
    });
});

// 铁律 3：词条只能来自 closed-libraries.ts，prompt 里不许手抄——用 renderLibraries 的原样输出比对。
describe("封闭词库注入", () => {
    it.each([
        ["创意", buildCreativePrompt, ["hook"] as const],
        ["跨段状态继承表", buildContinuityTablePrompt, ["lighting"] as const],
        [
            "分镜决策锁定表",
            buildDirectingLockPrompt,
            ["directorStyle", "colorGrade", "lighting", "cameraMovement", "performanceIntensity", "composition", "shotScale"] as const,
        ],
        ["分镜表", buildStoryboardTablePrompt, ["hook", "shotScale"] as const],
        ["镜头合同", buildShotContractPrompt, ["shotScale", "composition", "lighting", "cameraMovement"] as const],
    ])("%s 模板逐字注入 renderLibraries 的产物", (_name, builder, categories) => {
        const prompt = builder("上下文");
        expect(prompt).toContain("【封闭词库 · 逐字选取");
        expect(prompt).toContain(renderLibraries([...categories]));
    });

    it("未注入词库的环节不带词库区块", () => {
        expect(buildScriptPrompt("上下文")).not.toContain("【封闭词库 · 逐字选取");
        expect(buildActionContractPrompt("上下文")).not.toContain("【封闭词库 · 逐字选取");
    });
});
