import { readFile } from "node:fs/promises";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { AGENT_PROMPT, loadConfig, type CanvasAgentConfig, VERSION } from "./config.js";
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
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    });
}

async function postCanvasAgentTool(config: CanvasAgentConfig, name: ToolName, input: unknown) {
    const resolved = await resolveLocalImageInput(name, input);
    const res = await fetch(`${config.url}/api/tools`, { method: "POST", headers: { "content-type": "application/json", "x-canvas-agent-token": config.token }, body: JSON.stringify({ name, input: resolved }) });
    const body = (await res.json()) as CanvasAgentToolResponse;
    if (!body.ok) throw new Error(body.error || "tool call failed");
    return body.result;
}

// canvas-agent 跑在用户本机、有文件读写权限；浏览器无法直接 fetch 本地路径。
// 当 assets_add 传的是本地文件绝对路径时，在这里读文件转 dataURL 再交给浏览器存储，
// 使「让 Agent 上传本地素材」真正可用（http(s)/data URL 原样透传，交给浏览器处理）。
async function resolveLocalImageInput(name: ToolName, input: unknown) {
    if (name !== "assets_add" || !input || typeof input !== "object") return input;
    const value = input as Record<string, unknown>;
    if (value.kind !== "image") return input;
    const url = typeof value.imageUrl === "string" ? value.imageUrl.trim() : "";
    if (!url || /^(https?:|data:)/i.test(url)) return input;
    try {
        const buffer = await readFile(url);
        return { ...value, imageUrl: `data:${imageMimeFromPath(url)};base64,${buffer.toString("base64")}` };
    } catch {
        return input; // 读不到就原样交给浏览器，让其产出可读错误提示
    }
}

function imageMimeFromPath(file: string) {
    const ext = path.extname(file).toLowerCase();
    if (ext === ".png") return "image/png";
    if (ext === ".webp") return "image/webp";
    if (ext === ".gif") return "image/gif";
    if (ext === ".bmp") return "image/bmp";
    return "image/jpeg";
}
