import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { AGENT_PROMPT, loadConfig, type CanvasAgentConfig, VERSION } from "./config.js";
import { resolveLocalImageInput } from "./local-image-input.js";
import { toolDescriptions, toolInputSchemas, toolNames, type ToolName } from "./schemas.js";

type CanvasAgentToolResponse = { ok?: boolean; result?: unknown; error?: string };

export async function startMcpServer() {
    const config = loadConfig(true);
    const server = new McpServer({ name: "canvas-agent", version: VERSION }, { instructions: AGENT_PROMPT });
    toolNames.forEach((name) => registerCanvasTool(server, config, name));
    await server.connect(new StdioServerTransport());
}

function registerCanvasTool(server: McpServer, config: CanvasAgentConfig, name: ToolName) {
    const schema = toolInputSchemas[name];
    server.registerTool(name, { description: toolDescriptions[name], inputSchema: schema.shape }, async (input: unknown) => {
        const result = await postCanvasAgentTool(config, name, schema.parse(input));
        // 紧凑序列化:缩进只服务人眼,而这里的读者是模型。实测画布快照 29700 字符里
        // 有 26% 是缩进空白,工具结果又占 rollout 的一半,去掉直接省下整体约 14%。
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    });
}

async function postCanvasAgentTool(config: CanvasAgentConfig, name: ToolName, input: unknown) {
    const resolved = await resolveLocalImageInput(name, input);
    const res = await fetch(`${config.url}/api/tools`, { method: "POST", headers: { "content-type": "application/json", "x-canvas-agent-token": config.token }, body: JSON.stringify({ name, input: resolved }) });
    const body = (await res.json()) as CanvasAgentToolResponse;
    if (!body.ok) throw new Error(body.error || "tool call failed");
    return body.result;
}

