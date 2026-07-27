import { describe, expect, it } from "vitest";

import { toolDescriptions, toolInputSchemas } from "../src/schemas.js";

describe("canvas_get_state schema", () => {
    it("支持按 nodeIds 请求完整节点", () => {
        expect(toolInputSchemas.canvas_get_state.parse({ nodeIds: ["node-1", "node-2"] })).toEqual({ nodeIds: ["node-1", "node-2"] });
    });

    it("描述说明默认精简与按需取回方式", () => {
        expect(toolDescriptions.canvas_get_state).toContain("默认返回精简快照");
        expect(toolDescriptions.canvas_get_state).toContain("长文本已截断");
        expect(toolDescriptions.canvas_get_state).toContain("nodeIds");
    });
});
