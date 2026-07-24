import { once } from "node:events";
import { promises as fs } from "node:fs";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerExportRoutes } from "../src/http-server.js";
import { extractVideoFrames, removeJob } from "../src/stitch.js";

const jobs = new Set<string>();

afterEach(async () => {
    await Promise.all([...jobs].map((jobId) => removeJob(jobId)));
    jobs.clear();
});

describe("extractVideoFrames", () => {
    it("用 ffmpeg 分别抽首帧与反转后的实际尾帧", async () => {
        const jobId = `frames-${Date.now()}`;
        jobs.add(jobId);
        const calls: string[][] = [];
        const result = await extractVideoFrames(jobId, Buffer.from("video"), {
            ensureFfmpeg: async () => undefined,
            runCommand: async (_command, args) => {
                calls.push(args);
                await fs.writeFile(args.at(-1)!, Buffer.from(calls.length === 1 ? "first" : "last"));
            },
        });

        expect(calls[0]).toContain("-frames:v");
        expect(calls[1]).toEqual(expect.arrayContaining(["-sseof", "-1", "-vf", "reverse"]));
        expect(result.firstFrame.toString()).toBe("first");
        expect(result.lastFrame.toString()).toBe("last");
    });
});

describe("POST /stitch/frames", () => {
    it("接收单段视频字节并返回首尾 PNG data URL", async () => {
        const app = express();
        const cleanup = vi.fn(async () => undefined);
        registerExportRoutes(app, new Set(), {
            extractVideoFrames: vi.fn(async () => ({ firstFrame: Buffer.from("first-png"), lastFrame: Buffer.from("last-png") })),
            removeJob: cleanup,
        });
        app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: error.message }));
        const server = app.listen(0, "127.0.0.1");
        await once(server, "listening");
        const port = (server.address() as AddressInfo).port;
        try {
            const response = await fetch(`http://127.0.0.1:${port}/stitch/frames?jobId=frame-job`, {
                method: "POST",
                headers: { "content-type": "application/octet-stream" },
                body: new Uint8Array([1, 2, 3]),
            });
            const data = await response.json() as { firstFrame: string; lastFrame: string };
            expect(response.status).toBe(200);
            expect(data.firstFrame).toBe(`data:image/png;base64,${Buffer.from("first-png").toString("base64")}`);
            expect(data.lastFrame).toBe(`data:image/png;base64,${Buffer.from("last-png").toString("base64")}`);
            expect(cleanup).toHaveBeenCalledWith("frame-job");
        } finally {
            server.close();
        }
    });
});
