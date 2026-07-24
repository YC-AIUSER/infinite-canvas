# Toonflow plus 重构 · 第三块（视频与交付层）— 设计文档

- 日期：2026-07-24
- 状态：设计定稿（随实施修正）
- 上位文档：`2026-07-21-toonflow-plus-refactor-design.md`（八条已批准决策，本块继承 D3 走 cano、D7 缝贯穿、D8 台词剥离）
- 方法论源：`ai-short-drama-plus` 的 `06-video-prompt.md`（Module4 权威）、`07-generate-libtv.md`（§八 cano 平台差异）、`09-qc-repair.md`（P7 七项质检）、`SKILL.md`（铁律 10/11、P8 交付十条剪辑手法）

## 1. 范围与现状差距

第三块 = Module4 六段式 → P6 生成 → P7 七项质检 → P8 交付；`audio-mix` 激活；`seam-check` 改核对上游缝合同；剪辑手法十条。

| 现状 | 差距 |
|:---|:---|
| `buildVideoWorkbenchPrompt` 为「逐镜 1:1 脚本」体系（九宫格残留），确定性拼接直接喂视频模型 | Module4 权威要求六段式骨架 + 故事线七类目**合段叙事**，严禁逐镜列表/Shot 编号/景别构图复写 |
| cano 适配层已实战打磨（参考图分工、布光基准、色板锚定、站位写死、外观绑定句） | **保留**，映射进六段式对应段落，不推倒重来 |
| 缝合同五行已存 `directing-lock.seams[]`（第一块签好） | 视频层未消费：两侧段的生成 prompt 未注入缝约束（末拍中间态/首格接后半/音频边界） |
| `seam-check` = 边界人工勾选，无内容 | 改为逐边界展示对应缝合同五行 + 上段尾帧/本段首帧抽帧对照 + 剪辑手法建议 |
| `audio-mix` 只在 schema/cascade 挂名，无运行时 | 激活：分镜表 line（已带 出口对白-/OS- 前缀与 type）→ 逐句 TTS 配音轨 |
| `export` 已有 ffmpeg 无损拼接 | 增配音轨混入 + 响度归一 -16 LUFS（可选，走重编码路径） |
| 质检无结构化流程 | P7 七项检查单 + P0/P1/P2 分级，未清 P0 不得 approve |

## 2. 本块决策

| # | 决策 | 理由 |
|:---|:---|:---|
| B1 | Module4 六段式为新权威骨架，cano 适配层整合进对应段落（分工/布光/色板句 → 5 风格与 6 画面要求；站位逐句写死 → 2 故事线） | 06 §2.1 阻断级 + 07 §八「cano 权重摊平，要靠文字争权重」，两者不冲突 |
| B2 | 视频工作台生成改**两步**：① 文本模型按七类目合成 Module4 六段文本（产物可审，status=review）→ ② 用该文本调 cano 出视频。中间加**确定性校验器**拦禁则，违规自动带反馈重试 1 次 | 故事线是创作文本必须走 LLM；禁则（时间码/Shot 编号/比喻词/「固定机位」/逐镜列表/景别复写）可正则化，机器拦比人眼稳 |
| B3 | 人声抑制走 prompt 硬编码英文句（视频只出环境音效，禁生成人声/对白音频；dialogue 型台词写明文本仅控口型，OS 型全段全员闭口）| cano 无 `generate_audio` 开关（上位文档风险表）；**有效性须实测**，进 pending-test |
| B4 | 缝合同注入：段有入缝 → 故事线首句前件受「本段首格=同一动作后半，禁止重新建立空间」约束；段有出缝 → 末句收在动作中间态 + 音频边界行（段尾 0.5s 不起新持续音）写进画面要求段 | D7 缝贯穿；babb9a2 已定性「音频边界=生成时约束」 |
| B5 | P7 七项质检 = video-workbench 段实例上的人工检查单（身份/资产/摄影/动作/叙事节奏/声音字幕/技术质量），每项勾「已查」，问题记 P0/P1/P2 短备注；**存在未清 P0 → approve 按钮禁用**。返修复用现有重生成+`note` 定点修链路，返修提示词按 09 §四「只解决当前问题、锁定原角色场景光线」 | 09 全文；不新做局部画面修复（最小返修顺序里 1/2/3 属剪辑层，本块不实现） |
| B6 | seam-check 升级：边界卡按 fromSegment/toSegment 匹配 `directing-lock.seams[]` 展示五行合同 + 尾帧/首帧抽帧对照图 + 十条剪辑手法建议（按合同「景别/动机」行高亮推荐项）；勾选通过逻辑沿用 isSeamChecked | 铁律 11 ④ 抽帧过闸门；抽帧基建=canvas-agent 已有 ffmpeg |
| B7 | canvas-agent 新增抽帧端点：给定 segment videoKey（浏览器上传字节，同 stitch 模式）返回首帧+尾帧 PNG | 复用 stitch.ts 的临时目录/任务模式，不引新依赖 |
| B8 | audio-mix 激活：输入=本段分镜表 rows + 节点上的角色→音色映射配置；动作=逐句 TTS（复用 requestAudioGeneration，voice 按映射，OS 用旁白音色）；每句计划偏移=段内前序镜头 durationSec 累计；输出=配音轨清单（audioKeys + offsets + 类型）。**不做**手动时间轴对齐 UI（偏移仅为计划值，剪辑层微调留人工/后续） | D8 台词剥离；对齐精度受模型实际时长影响，v1 不追求帧级 |
| B9 | export 拼接弹窗加两个可选项：「混入配音轨」（canvas-agent ffmpeg adelay+amix，audio-mix 全段 approved 才可用）、「响度归一 -16 LUFS」（loudnorm）；任一勾选走重编码路径，都不勾保持现有无损 concat | SKILL P8 ⑩；无损优先原则不破坏 |
| B10 | 剪辑手法十条做成常量模块（编号+名称+适用缝型+一句执行要点），seam-check 建议区与 export 弹窗提示复用；不进画布节点 | 静态资源不节点化（同封闭词库先例） |

## 3. 模块设计

### 3.1 Module4 六段式（prompts.ts 重写 buildVideoWorkbenchPrompt）

输出六段结构（06 §2.1 骨架 + cano 适配整合）：

```
1. 参考图索引     @图片N=…（角色→物品→场景→色板→故事板构图恒最后）；@音频 本段暂不用（配音轨走 audio-mix）
2. 故事线         固定开头「按故事板镜头顺序自然推进」；七类目合段（动作/运镜方向/布光方向/音效/台词/表演/衔接词）；
                  逐句写死谁在画面左谁在画面右；首句正面覆盖 Shot 1 钩子；入缝段首句接上段动作后半
3. Tone           段情绪基调（源：分镜表 mood 汇总 + 锁定表 A 表）
4. BGM衔接        ≤200 字，源：剧本 F4 音频要素标签的 BGM 行 + 段情绪
5. 风格           锁定表 A 表全段统一风格串 + 色板锚定句（现 PALETTE_ANCHOR_SENTENCE）
6. 画面要求       固定硬编码：外观绑定句 + 参考图分工段（cano 争权重）+ 布光基准段 + 人声抑制句 + 出缝段音频边界句 + 禁字幕水印
```

- 故事线由文本模型合成：新增 `buildModule4ComposePrompt(...)`（输入：本段 rows、shot/action contracts、锁定表、缝合同、空间规则），产出仅六段文本。
- **确定性校验器** `validateModule4(text)`（新文件 `module4-check.ts`）：拦 `[N-N秒]` 时间码、Shot/Tn 编号、`固定|锁机|静态机位|定格`、比喻词（像/仿佛/犹如/好似/宛如/如同）、逐镜列表（行首 `-` 或「第N镜」）、六段齐全性、故事线开头句。违规 → 违规项拼进反馈重试 1 次，仍违规 → 状态 failed 并显示违规清单。
- 台词消费：dialogue 型 → 故事线写「{角色}说：'{台词}'」并要求该角色口型；OS 型 → 台词**不进**故事线口播，画面要求段加全员闭口句，文本进 audio-mix 配音轨。
- 视频调用沿用现 cano 链路（幂等键/CONTENT_BLOCKED 重试）。

### 3.2 P7 质检单（schema + node-runtime + UI）

- schema：video-workbench output.payload 增 `qualityReview?: { items: Array<{ key: 七项之一; checked: boolean; severity?: "P0"|"P1"|"P2"; note?: string }> }`（optional，旧画布兼容）。
- 纯函数 `canApproveSegment(review)`：七项全 checked 且无未清 P0。approve 入口接此判定。
- UI：video-workbench 节点产物区加检查单折叠面板。

### 3.3 seam-check 核对缝合同

- 纯函数 `matchSeamContract(boundary, lock)`：按段序匹配 seams[]；匹配不到显示「未签合同」并给出去 directing-lock 补签的提示。
- canvas-agent `/stitch/frames`（复用现 stitch 上传段字节的模式）：ffmpeg 抽首帧+尾帧 PNG 返回。边界卡展示 上段尾帧 | 本段首帧 并排 + 合同五行 + 手法建议。
- 抽帧失败（无 ffmpeg / agent 未连）降级：只显示合同文本，勾选流程不受阻。

### 3.4 audio-mix（schema + runtime + UI）

- 节点 metadata 增 `voiceMap?: Record<角色名, 音色>`；UI 提供角色列表（从分镜表 line 前缀提取）与音色下拉（现有 audioVoiceOptions）。
- 纯函数 `buildDubbingPlan(rows)`：提取 dialogue/OS 行 → `[{ shotId, type, speaker, text, plannedOffsetSec }]`（offset=段内前序镜 durationSec 累计）。
- 生成：逐句 requestAudioGeneration（旁白音色兜底），产物存媒体库，output.payload 记 `dubbing: [{ …, audioKey }]`；全部成功 → review，人工听后 approve。
- 级联：分镜表新版本 → 本段 audio-mix 标 stale（沿用现有 cascade 规则接入）。

### 3.5 export 混音与响度

- stitch.ts 扩展：请求体可带 `dubbing?: [{ offsetSec, bytes }]` 与 `loudnorm?: boolean`；有任一 → 转码路径（amix 配音轨 adelay 偏移；loudnorm=I=-16）。
- 弹窗选项默认关，勾选条件：混音需全段 audio-mix approved。

### 3.6 剪辑手法十条 + 双侧同步

- 新常量 `seam-editing-menu.ts`：十条（正反打/切景别/动作中切/J-L 声音桥/静场冻结缓推/内部 J 缝删段/衰减回响/数字急推/BGM 骤停/响度归一）。
- `STAGE_METHODOLOGY_REDLINES` 的 video-workbench/seam-check/audio-mix/export 四项按本块行为更新，`AGENT_METHODOLOGY_BRIEF` 若动则**逐字同步** `canvas-agent/src/config.ts`（agent-brief-sync 测试锁）。

## 4. 分批实施

- **批A（核心生成链）**：3.1 全部 + 缝合同注入 + 双侧红线同步。验收：新增 Module4 校验器/合成模板单测；既有测试全绿；浏览器实测一段真实 Module4 文本合成并通过校验。
- **批B（质检与交付）**：3.2-3.6。验收：buildDubbingPlan/matchSeamContract/canApproveSegment 单测；canvas-agent 抽帧端点测试；浏览器实测检查单与边界卡 UI。
- 真实视频端到端（人声抑制有效性、口型对齐、缝无跳切、混音效果）→ `pending-test.mdx` 列实测项。

## 5. 不做（YAGNI）

- 不做手动时间轴对齐 UI、字幕/花字、人声分离返修、局部画面修复（inpaint）
- 不接 libtv 渠道、不做 FPV 专项模板（需要时按 06 §四现填）
- 不做质检报告自动生成（七项为人工单；模型辅助质检留后续）
- 不动第一/二块已定型的文本与图像层节点

## 6. 风险

| 风险 | 处置 |
|:---|:---|
| prompt 关不掉 cano 人声 | pending-test 实测；无效则成片以配音轨压过 + 记录，或回退 enableSound 语义再议 |
| LLM 合成故事线漏画格（覆盖率<100%） | 合成提示词强制「每格主视觉任务都被句子覆盖」；校验器只拦形式禁则，内容覆盖靠 review 状态人工把关（v1 不做逐格比对） |
| TTS 时长与镜头 durationSec 偏差大 | 计划偏移仅供混音起点，pending-test 记录偏差幅度，超限再立对齐工具项 |
| 抽帧端点引入大文件传输 | 沿用 stitch 已验证的分段上传模式，帧图回传为 PNG 单帧，体量可控 |
