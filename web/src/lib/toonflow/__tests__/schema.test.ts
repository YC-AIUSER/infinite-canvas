import { describe, expect, it } from "vitest";
import { z } from "zod";

import { MediaKeySchema, NodeOutputSchema, migrateToonflowStatus, parseModelJson } from "../schema";

describe("migrateToonflowStatus", () => {
    it.each([
        ["未开始", "empty"],
        ["待生成", "empty"],
        ["生成中", "generating"],
        ["生成失败", "failed"],
        ["待验收", "review"],
        ["已通过", "approved"],
        ["已跳过", "skipped"],
    ] as const)("将中文旧值 %s 映射为 %s", (oldStatus, expected) => {
        expect(migrateToonflowStatus(oldStatus)).toBe(expected);
    });

    it("未知值回退为 empty", () => {
        expect(migrateToonflowStatus("不存在的状态")).toBe("empty");
    });

    it("映射前会去除首尾空格", () => {
        expect(migrateToonflowStatus("  已通过  ")).toBe("approved");
    });
});

describe("parseModelJson", () => {
    const itemSchema = z.object({ id: z.string(), text: z.string() });
    const arraySchema = z.array(itemSchema);

    it("解析合法数组", () => {
        expect(parseModelJson(arraySchema, '[{"id":"1","text":"正文"}]')).toEqual({
            ok: true,
            data: [{ id: "1", text: "正文" }],
        });
    });

    it("解析带 json 围栏的内容", () => {
        expect(parseModelJson(arraySchema, '```json\n[{"id":"1","text":"正文"}]\n```')).toEqual({
            ok: true,
            data: [{ id: "1", text: "正文" }],
        });
    });

    it("从前后杂文中提取 JSON", () => {
        const result = parseModelJson(arraySchema, '以下是结果：\n[{"id":"1","text":"正文"}]\n请查收。');
        expect(result).toEqual({ ok: true, data: [{ id: "1", text: "正文" }] });
    });

    it("字符串中的转义引号与括号不会提前截断 JSON", () => {
        const result = parseModelJson(
            arraySchema,
            String.raw`前言 [{"id":"1","text":"他说：\"看这里 [不是结尾] {也不是}\""}] 后记`,
        );
        expect(result).toEqual({
            ok: true,
            data: [{ id: "1", text: '他说："看这里 [不是结尾] {也不是}"' }],
        });
    });

    it("缺少字段时返回失败且错误包含字段路径", () => {
        const result = parseModelJson(arraySchema, '[{"id":"1"}]');
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain("0.text");
    });

    it("非 JSON 内容返回失败", () => {
        const result = parseModelJson(arraySchema, "这不是 JSON");
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error).toContain("JSON 解析失败");
    });
});

describe("MediaKeySchema", () => {
    it("普通媒体键可以通过", () => {
        expect(MediaKeySchema.safeParse("media/images/example.webp").success).toBe(true);
    });

    it("拒绝 data: 开头的内容", () => {
        expect(MediaKeySchema.safeParse("data:image/png;base64,AAAA").success).toBe(false);
    });
});

describe("NodeOutputSchema", () => {
    const validOutput = {
        nodeId: "node-script",
        kind: "script",
        version: 1,
        status: "approved",
        payload: { text: "剧本正文", imageKeys: ["media/image-1"] },
        upstreamVersions: { project: 2 },
        generatedAt: "2026-07-12T12:00:00.000Z",
    };

    it("合法样例可以通过", () => {
        expect(NodeOutputSchema.safeParse(validOutput).success).toBe(true);
    });

    it("version 非数字时拒绝", () => {
        expect(NodeOutputSchema.safeParse({ ...validOutput, version: "1" }).success).toBe(false);
    });
});
