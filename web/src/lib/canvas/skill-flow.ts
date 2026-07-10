import { nanoid } from "nanoid";

import type { SkillCard } from "@/pages/skills/skills-data";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { CanvasNodeType, type CanvasNodeMetadata } from "@/types/canvas";
import type { CanvasAgentOp } from "./canvas-agent-ops";

// 把技能卡落成「提示词节点 + 参考图占位节点 + 生成配置节点」连线组
export function buildSkillFlowOps(skill: SkillCard, origin: { x: number; y: number }, configMetadata: CanvasNodeMetadata): CanvasAgentOp[] {
    const flow = skill.flow;
    if (!flow || !skill.prompt) return [];

    const textSize = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
    const textId = `text-${nanoid()}`;
    const configId = `config-${nanoid()}`;

    const ops: CanvasAgentOp[] = [
        {
            type: "add_node",
            id: textId,
            nodeType: CanvasNodeType.Text,
            title: `[技能] ${skill.name}`,
            position: { x: origin.x, y: origin.y },
            metadata: { content: skill.prompt, status: "success", fontSize: 14 },
        },
    ];

    let imageId: string | undefined;
    if (flow.requiresReferenceImage) {
        imageId = `image-${nanoid()}`;
        ops.push({
            type: "add_node",
            id: imageId,
            nodeType: CanvasNodeType.Image,
            title: flow.referencePlaceholderTitle || "参考图(必填)",
            position: { x: origin.x, y: origin.y + textSize.height + 60 },
        });
    }

    const tokens = [`@[node:${textId}]`, ...(imageId ? [`@[node:${imageId}]`] : [])].join("\n");

    ops.push({
        type: "add_node",
        id: configId,
        nodeType: CanvasNodeType.Config,
        title: skill.name,
        position: { x: origin.x + textSize.width + 80, y: origin.y },
        metadata: {
            ...configMetadata,
            generationMode: flow.mode,
            composerContent: tokens,
            prompt: tokens,
            status: "idle",
            requiresReferenceImage: flow.requiresReferenceImage || undefined,
        },
    });

    ops.push({ type: "connect_nodes", fromNodeId: textId, toNodeId: configId });
    if (imageId) ops.push({ type: "connect_nodes", fromNodeId: imageId, toNodeId: configId });
    ops.push({ type: "select_nodes", ids: [configId] });

    return ops;
}
