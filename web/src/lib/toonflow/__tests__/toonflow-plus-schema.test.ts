import { describe, expect, it } from "vitest";

import { buildToonflowCanvasTemplate } from "../../canvas/toonflow-canvas-template";
import type { ToonflowNodeKind } from "../../../types/canvas";
import {
    AudioLineSchema,
    ContinuityTableSchema,
    DirectingLockSchema,
    NodeOutputSchema,
    ShotContractSchema,
    TOONFLOW_NODE_KINDS,
} from "../schema";

// 编译期双向锁:TOONFLOW_NODE_KINDS 的 satisfies 保证数组 ⊆ 联合类型,这里补上联合类型 ⊆ 数组。
// 少列一个 kind 会让下面这行类型报错(tsc 红),防两处漂移。
type MissingKind = Exclude<ToonflowNodeKind, (typeof TOONFLOW_NODE_KINDS)[number]>;
const _noMissingKind: MissingKind extends never ? true : never = true;
void _noMissingKind;

describe("TOONFLOW_NODE_KINDS", () => {
    it("按流程顺序列出 17 个节点", () => {
        expect(TOONFLOW_NODE_KINDS).toEqual([
            "project",
            "creative",
            "script",
            "assets",
            "space-contract",
            "continuity-table",
            "directing-lock",
            "storyboard-table",
            "shot-contract",
            "action-contract",
            "storyboard-page",
            "keyframes",
            "compliance",
            "video-workbench",
            "seam-check",
            "audio-mix",
            "export",
        ]);
    });
});

describe("画布模板初始状态", () => {
    const toonflowMetaOf = (node: ReturnType<typeof buildToonflowCanvasTemplate>["nodes"][number]) => {
        const meta = node.metadata?.toonflow;
        if (!meta) throw new Error(`模板节点 ${node.id} 缺少 toonflow 元数据`);
        return meta;
    };

    it("creative 是选修节点,初始态 skipped", () => {
        const { nodes } = buildToonflowCanvasTemplate();
        const creative = nodes.find((node) => toonflowMetaOf(node).kind === "creative");
        expect(creative).toBeDefined();
        expect(toonflowMetaOf(creative!).status).toBe("skipped");
    });

    // keyframes 在 plus 线已退役(Module3 故事板本身就是首帧),但 kind 不能删——旧画布存着这个节点。
    it("keyframes 已退役,初始态 skipped", () => {
        const { nodes } = buildToonflowCanvasTemplate();
        const keyframes = nodes.find((node) => toonflowMetaOf(node).kind === "keyframes");
        expect(keyframes).toBeDefined();
        expect(toonflowMetaOf(keyframes!).status).toBe("skipped");
    });

    // skipped 不在 state-machine 的 GENERATABLE_STATUSES 里,这是"一键跑全链不白花钱"的唯一防线;
    // 若哪天 creative / keyframes 退回 empty,选修与退役节点会被当成待生成节点执行掉。
    it("只有 creative 与 keyframes 非 empty,其余 15 个都待生成", () => {
        const { nodes } = buildToonflowCanvasTemplate();
        const nonEmpty = nodes.filter((node) => toonflowMetaOf(node).status !== "empty").map((node) => toonflowMetaOf(node).kind);
        expect(nonEmpty).toEqual(["creative", "keyframes"]);
        expect(nodes).toHaveLength(17);
    });
});

describe("旧画布兼容(设计文档 4.8)", () => {
    it("不带任何新增字段的旧 NodeOutput 仍能通过校验", () => {
        const legacyOutput = {
            nodeId: "toonflow-storyboard-table",
            kind: "storyboard-table",
            version: 3,
            status: "approved",
            payload: {
                table: [
                    {
                        segmentId: "seg-1",
                        shotId: "S1-01",
                        shotNo: 1,
                        scale: "中景",
                        angle: "平视",
                        action: "推门进屋",
                        line: "久等了",
                        sfx: "门轴吱呀",
                        mood: "紧张",
                        durationSec: 3,
                    },
                ],
                audioLines: [{ lineId: "L1", role: "男主", text: "久等了", shotId: "S1-01", order: 1 }],
            },
            upstreamVersions: { "toonflow-space-contract": 2 },
            generatedAt: "2026-07-12T12:00:00.000Z",
        };

        expect(NodeOutputSchema.safeParse(legacyOutput).success).toBe(true);
    });

    it("旧 AudioLine 无 type、旧 ShotContract 无 lipSync 都能通过", () => {
        expect(AudioLineSchema.safeParse({ lineId: "L1", role: "男主", text: "久等了", shotId: "S1-01", order: 1 }).success).toBe(
            true,
        );
        expect(
            ShotContractSchema.safeParse({
                shotId: "S1-01",
                scale: "中景",
                angle: "平视",
                movement: "固定",
                speed: "慢",
                subjectRelation: "主角居左",
                endpoint: "手扶门框",
                inOut: { include: ["门"], exclude: ["路人"] },
            }).success,
        ).toBe(true);
    });
});

describe("AudioLineSchema.type", () => {
    it.each(["dialogue", "os", "sfx"] as const)("接受台词类型 %s", (type) => {
        expect(AudioLineSchema.safeParse({ lineId: "L1", role: "旁白", text: "三年后", shotId: "S1-01", order: 1, type }).success).toBe(
            true,
        );
    });

    it("拒绝未定义的台词类型", () => {
        expect(
            AudioLineSchema.safeParse({ lineId: "L1", role: "旁白", text: "三年后", shotId: "S1-01", order: 1, type: "bgm" }).success,
        ).toBe(false);
    });
});

describe("ShotContractSchema.lipSync", () => {
    it("记录本镜谁张嘴、谁闭口", () => {
        const result = ShotContractSchema.safeParse({
            shotId: "S1-02",
            scale: "近景",
            angle: "平视",
            movement: "固定",
            speed: "慢",
            subjectRelation: "主角居左",
            endpoint: "抬头对视",
            inOut: { include: ["茶杯"], exclude: ["手机"] },
            lipSync: { speaking: ["男主"], silent: ["女主", "老板"] },
        });
        expect(result.success).toBe(true);
    });
});

describe("DirectingLockSchema", () => {
    const globalLock = {
        visualStyle: "写实电影感",
        colorGrading: "冷调青橙",
        lighting: "侧逆光为主",
        cameraTone: "克制稳镜",
        performanceLevel: "L3",
        unifiedStyleString: "cinematic realistic, cool teal-orange grade, soft key light",
        motifs: ["茶杯", "旧怀表"],
    };

    it("只有 A 表(无分段、无缝)也能通过", () => {
        expect(DirectingLockSchema.safeParse({ global: globalLock }).success).toBe(true);
    });

    it("A 表 + B 表 + 缝合同完整样例通过", () => {
        const result = DirectingLockSchema.safeParse({
            global: globalLock,
            segments: [
                {
                    segmentId: "seg-1",
                    compositionPrimary: "三分法",
                    compositionSecondary: "前景遮挡",
                    compositionDiversity: "3 种",
                    cameraType: "缓推",
                    scaleRange: "L1-L4",
                    angleType: "平视为主",
                    openingType: "动作中段切入",
                },
            ],
            seams: [
                {
                    fromSegmentId: "seg-1",
                    toSegmentId: "seg-2",
                    prevEndBeat: "手推到门开一半",
                    nextFirstPanel: "门继续被推开,人踏进门内",
                    scaleOrMotivation: "景别跳 2 档,中景→特写",
                    soundBridge: "J-cut:下段台词提前 0.3s",
                },
            ],
        });
        expect(result.success).toBe(true);
    });

    it("缺 A 表字段时拒绝", () => {
        const { motifs: _motifs, ...incomplete } = globalLock;
        expect(DirectingLockSchema.safeParse({ global: incomplete }).success).toBe(false);
    });
});

describe("ContinuityTableSchema", () => {
    it("类目可整项缺省", () => {
        expect(ContinuityTableSchema.safeParse({}).success).toBe(true);
    });

    it("五类跨段状态都能落项", () => {
        const result = ContinuityTableSchema.safeParse({
            propWhitelist: [{ name: "茶杯", lockedValue: "始终在桌右侧,只许被男主的手移动" }],
            blocking: [{ name: "男主", lockedValue: "恒左,坐姿前倾" }],
            lightingWeather: [{ name: "光向", lockedValue: "窗光自左后方,阴天" }],
            characterGear: [{ name: "女主", lockedValue: "始终戴银色细链" }],
            leftovers: [{ name: "碎瓷片", lockedValue: "第 3 段后一直留在地面" }],
        });
        expect(result.success).toBe(true);
    });

    it("条目缺锁定值时拒绝", () => {
        expect(ContinuityTableSchema.safeParse({ propWhitelist: [{ name: "茶杯" }] }).success).toBe(false);
    });
});

describe("NodeOutputSchema 承载新产物", () => {
    it("payload 可携带 directingLock 与 continuityTable", () => {
        const result = NodeOutputSchema.safeParse({
            nodeId: "toonflow-directing-lock",
            kind: "directing-lock",
            version: 1,
            status: "review",
            payload: {
                directingLock: {
                    global: {
                        visualStyle: "写实电影感",
                        colorGrading: "冷调青橙",
                        lighting: "侧逆光为主",
                        cameraTone: "克制稳镜",
                        performanceLevel: "L3",
                        unifiedStyleString: "cinematic realistic",
                        motifs: ["茶杯"],
                    },
                },
                continuityTable: { propWhitelist: [{ name: "茶杯", lockedValue: "桌右侧" }] },
            },
            upstreamVersions: { "toonflow-space-contract": 1 },
            generatedAt: "2026-07-21T09:00:00.000Z",
        });
        expect(result.success).toBe(true);
    });
});
