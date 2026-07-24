import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createCodexRolloutBytesLookup } from "../src/agents.js";

const temporaryDirectories = new Set<string>();

afterEach(async () => {
    await Promise.all([...temporaryDirectories].map((directory) => fs.rm(directory, { recursive: true, force: true })));
    temporaryDirectories.clear();
});

async function createSessionsDirectory() {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-agent-rollout-"));
    temporaryDirectories.add(directory);
    return directory;
}

async function writeRollout(sessionsDir: string, threadId: string, content: string) {
    const directory = path.join(sessionsDir, "2026", "07", "24");
    await fs.mkdir(directory, { recursive: true });
    const filePath = path.join(directory, `rollout-2026-07-24T12-00-00-${threadId}.jsonl`);
    await fs.writeFile(filePath, content);
    return filePath;
}

describe("createCodexRolloutBytesLookup", () => {
    it("递归命中 rollout 文件并返回真实字节数", async () => {
        const sessionsDir = await createSessionsDirectory();
        const threadId = "thread-hit";
        await writeRollout(sessionsDir, threadId, "一段记录");

        const sizes = await createCodexRolloutBytesLookup({ sessionsDir })([threadId]);

        expect(sizes.get(threadId)).toBe(Buffer.byteLength("一段记录"));
    });

    it("无匹配或目录读取失败时缺省且不报错", async () => {
        const sessionsDir = await createSessionsDirectory();
        const lookup = createCodexRolloutBytesLookup({ sessionsDir });

        expect((await lookup(["missing-thread"])).has("missing-thread")).toBe(false);
        expect((await createCodexRolloutBytesLookup({ sessionsDir: path.join(sessionsDir, "missing") })(["missing-thread"])).has("missing-thread")).toBe(false);
    });

    it("命中后复用缓存路径并通过 stat 刷新大小", async () => {
        const sessionsDir = await createSessionsDirectory();
        const threadId = "thread-cached";
        const filePath = await writeRollout(sessionsDir, threadId, "old");
        const readDir = vi.fn((directory: string) => fs.readdir(directory, { withFileTypes: true }));
        const stat = vi.fn((target: string) => fs.stat(target));
        const lookup = createCodexRolloutBytesLookup({ sessionsDir, readDir, stat });

        expect((await lookup([threadId])).get(threadId)).toBe(3);
        readDir.mockClear();
        stat.mockClear();
        await fs.appendFile(filePath, "-new");

        expect((await lookup([threadId])).get(threadId)).toBe(7);
        expect(readDir).not.toHaveBeenCalled();
        expect(stat).toHaveBeenCalledOnce();
    });
});
