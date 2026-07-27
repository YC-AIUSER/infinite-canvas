/**
 * Agent 侧的方法论红线只有"从封闭词库逐字选取"这条命令，词库实体在 web 的 closed-libraries.ts，
 * canvas-agent 的工具一个都读不到它。2026-07-27 实测 Agent 因此卡在分镜决策锁定表，
 * 明说"画布没有提供构图、布光、运镜、景别、表演、调色的封闭词库，因此没有擅自生成分镜"。
 */
import { describe, expect, it } from "vitest";

import { withClosedLibraries } from "@/lib/agent/agent-closed-libraries";
import { CLOSED_LIBRARY_CATEGORIES } from "@/lib/toonflow/closed-libraries";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function node(withToonflow: boolean): CanvasNodeData {
    return {
        id: "n1",
        type: CanvasNodeType.Text,
        title: "节点",
        position: { x: 0, y: 0 },
        width: 320,
        height: 190,
        metadata: withToonflow ? { toonflow: { kind: "directing-lock", stage: "决策锁定", status: "empty", summary: "锁定表", checks: [] } } : { content: "普通文本" },
    };
}

describe("withClosedLibraries", () => {
    it("Toonflow 画布的状态返回带上词库全文，Agent 无需再向用户索要", () => {
        const result = withClosedLibraries({ nodes: [] }, { nodes: [node(true)] }) as { _closedLibraries?: string };

        expect(result._closedLibraries).toBeTruthy();
        // 抽查三类词库的真实词条，确认是现取的全文而不是一句说明
        expect(result._closedLibraries).toContain("权力压迫");
        expect(result._closedLibraries).toContain("布光 10 方案");
        expect(result._closedLibraries).toContain("调色 22 组");
    });

    it("覆盖全部 11 类词库，漏一类下游选词就会被迫自创", () => {
        const result = withClosedLibraries({ nodes: [] }, { nodes: [node(true)] }) as unknown as { _closedLibraries: string };
        const labels = ["构图 8 策略", "布光 10 方案", "运镜 8 种", "景别 L0-L5", "表演强度 L1-L5", "调色 22 组", "空镜 A-E", "导演风格 9 种", "开场钩子 4 类", "P7 导演技法映射", "顿帧两式"];

        expect(CLOSED_LIBRARY_CATEGORIES).toHaveLength(labels.length);
        for (const label of labels) expect(result._closedLibraries).toContain(label);
    });

    it("普通画布不附加词库，不给非 Toonflow 场景平白塞 3k 字符", () => {
        const result = withClosedLibraries({ nodes: [] }, { nodes: [node(false)] }) as { _closedLibraries?: string };

        expect(result._closedLibraries).toBeUndefined();
    });

    it("非对象结果原样返回，不被套成对象", () => {
        expect(withClosedLibraries("文本", { nodes: [node(true)] })).toBe("文本");
        expect(withClosedLibraries(null, { nodes: [node(true)] })).toBeNull();
        expect(withClosedLibraries([1, 2], { nodes: [node(true)] })).toEqual([1, 2]);
    });
});
