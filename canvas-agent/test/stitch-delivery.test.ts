import { once } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it, vi } from "vitest";

import { registerExportRoutes } from "../src/http-server.js";
import { buildReencodeArgs, type VideoProbe } from "../src/stitch.js";

const probes: VideoProbe[] = [
    { videoCodec: "h264", audioCodec: "aac", width: 1080, height: 1920, frameRate: "30/1", hasAudio: true, durationSec: 4 },
    { videoCodec: "h264", audioCodec: "aac", width: 1080, height: 1920, frameRate: "30/1", hasAudio: true, durationSec: 5 },
];

describe("stitch 配音与响度滤镜", () => {
    it("按前序段时长 + 段内 offset 生成 adelay，并接 amix 与 -16 LUFS loudnorm", () => {
        const args = buildReencodeArgs(["0.mp4", "1.mp4"], probes, "out.mp4", [{ file: "voice.mp3", segmentIndex: 1, offsetSec: 0.5 }], true);
        const filters = args[args.indexOf("-filter_complex") + 1];

        expect(filters).toContain("adelay=4500|4500");
        expect(filters).toContain("amix=inputs=2");
        expect(filters).toContain("loudnorm=I=-16");
        expect(args).toContain("-shortest");
        expect(args.at(-1)).toBe("out.mp4");
    });

    it("HTTP stitch 请求把 base64 配音字节、offset 与 loudnorm 传入运行时", async () => {
        const app = express();
        app.use(express.json({ limit: "30mb" }));
        const stitch = vi.fn(async () => ({ outputPath: "C:/Videos/out.mp4", mode: "reencode" as const, bytes: 10, durationSec: 9 }));
        registerExportRoutes(app, new Set(), {
            hasAllSegments: vi.fn(async () => true),
            removeJob: vi.fn(async () => undefined),
            stitchSegments: stitch,
        });
        app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: error.message }));
        const server = app.listen(0, "127.0.0.1");
        await once(server, "listening");
        const port = (server.address() as AddressInfo).port;
        try {
            const response = await fetch(`http://127.0.0.1:${port}/export/stitch`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    jobId: "mix-job",
                    count: 2,
                    loudnorm: true,
                    dubbing: [{ segmentIndex: 1, offsetSec: 0.5, bytes: Buffer.from("voice").toString("base64"), mimeType: "audio/mpeg" }],
                }),
            });
            expect(response.status).toBe(200);
            const input = stitch.mock.calls[0][0];
            expect(input.loudnorm).toBe(true);
            expect(input.dubbing[0]).toMatchObject({ segmentIndex: 1, offsetSec: 0.5, mimeType: "audio/mpeg" });
            expect(input.dubbing[0].bytes.toString()).toBe("voice");
        } finally {
            server.close();
        }
    });
});
