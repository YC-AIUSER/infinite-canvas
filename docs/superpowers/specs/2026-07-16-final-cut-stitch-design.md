# 成片拼接导出(本地路线)设计

日期:2026-07-16 · 状态:已获用户批准(方案 1,两个入口都要) · 关联:TODOS.md「成片拼接导出」

## 目标

把 Toonflow 导出节点收集到的「已通过」段视频(自带原生音频),在**本地**用 ffmpeg 无损拼接为单一成片 mp4。复用 video-use skill 的核心配方(逐段无损 `-c copy` concat),不引入 ffmpeg.wasm、不做后端。

**成功标准**:真实画布 ≥2 段已通过视频,点「拼接成片」或对 Agent 说一声,本地生成一个可播放、画质无损、音频连续、段序正确的 mp4,并能一键打开所在文件夹。

## 非目标

- 浏览器内拼接(ffmpeg.wasm/OpenCut 路线)——将来部署给外部创作者时的升级路径,本期不做。
- 转场、字幕、配乐混轨、repair-tail 段尾修复(repair-tail 共用本期的 ffmpeg 基建,单独立项)。
- 打包 ffmpeg 二进制(ffmpeg-static)——本期检测系统 ffmpeg,缺失时报错并给安装指引(`winget install ffmpeg`)。

## 架构

核心拼接逻辑在 **canvas-agent**(本地伴侣进程,express + 17371 端口)写一份;两个薄入口:

1. **导出弹窗按钮**:`toonflow-export-modal.tsx` 新增「拼接成片」按钮,仅当本地 Agent 健康检查通过时可用。点击后浏览器把段 blob 逐个上传给 Agent,再触发拼接。
2. **Agent MCP 工具**:`export_stitch` 工具经 schemas.ts 声明、mcp-server.ts 自动注册;执行链路 = MCP 进程 → `POST /api/tools` → canvas-session → 浏览器端工具 handler(与按钮共用同一浏览器函数)→ 上传+拼接 → 结果文本回传。

```
浏览器(blob 在 IndexedDB media_files)
  ├─ 按钮入口 ──┐
  └─ 工具入口 ──┴→ stitchFinalCut(segments)   ← web 侧共用函数
                    │ POST /export/segments ×N (raw binary)
                    │ POST /export/stitch (JSON)
                    ▼
canvas-agent stitch 模块(新文件 src/stitch.ts)
  temp 落盘 → ffprobe 逐段校验 → 一致: concat -c copy(无损)
                               → 不一致: 重编码兜底(统一分辨率/fps/补静音轨)
  → 输出 ~/Videos/Toonflow/<标题>-<时间戳>.mp4 → 清理 temp
```

## HTTP 契约(canvas-agent,挂在既有 token 中间件之后)

- `POST /export/segments?jobId=<id>&index=<n>` — body 为段视频原始二进制(`express.raw`,`application/octet-stream`,limit 200mb)。写入 `<os.tmpdir>/canvas-stitch/<jobId>/<index>.mp4`。响应 `{ok:true}`。jobId 必须匹配 `/^[A-Za-z0-9_-]{1,64}$/`(防路径穿越),index 为非负整数。
- `POST /export/stitch` — JSON `{jobId, count, title?}`。校验 temp 目录内 0..count-1 全部存在 → ffprobe 校验 → 拼接 → 响应 `{ok:true, outputPath, mode:"copy"|"reencode", bytes, durationSec}`。无论成败,结束时删除该 jobId temp 目录。
- `POST /export/reveal` — JSON `{path}`。仅接受本次进程内 stitch 产出过的路径(内存白名单,防任意路径打开),在资源管理器中定位文件(win32 `explorer /select,`,darwin `open -R`,其余 `xdg-open` 所在目录)。

现有 `express.json({limit:"30mb"})` 全局中间件不动;raw 中间件只挂在 `/export/segments` 路由上。

## stitch 模块(canvas-agent/src/stitch.ts)

1. **ffmpeg/ffprobe 探测**:`ffmpeg -version` 失败 → 返回明确错误「未检测到 ffmpeg,请安装(Windows: winget install ffmpeg)后重试」。
2. **ffprobe 逐段**:读 codec_name、width、height、r_frame_rate、音频流有无。全部一致且都有音轨 → 走无损;任何不一致(含音轨缺失)→ 走重编码兜底。
3. **无损路径**:生成 concat list 文件(路径写入时按 concat demuxer 规则转义单引号),`ffmpeg -f concat -safe 0 -i list.txt -c copy output.mp4`。
4. **重编码兜底**:以第一段的分辨率为基准,`-filter_complex` 逐段 `scale+setsar+fps` 统一、缺音轨段补 `anullsrc` 静音,`concat=n=N:v=1:a=1`,libx264(crf 18)+aac 输出。响应 `mode:"reencode"` 让 UI 提示「段参数不一致,已自动转码拼接」。
5. **单段**:count=1 时直接 remux(`-c copy`)成输出文件,流程与响应不变。
6. **输出**:`~/Videos/Toonflow/` (`os.homedir()` + `Videos/Toonflow`,不存在则创建);文件名 = sanitize(title || "toonflow-成片") + `-YYYYMMDD-HHmmss.mp4`(去除 Windows 非法字符 `\/:*?"<>|`)。
7. **子进程**:`execFile`(非 shell,参数数组传递,杜绝注入),超时 10 分钟,stderr 采集进错误信息。

## web 侧

- **共用函数** `stitchFinalCut(segments, title)`(新文件 `web/src/lib/toonflow/final-cut.ts`):复用现有 `collectExportSegments` 的产物与 `getMediaBlob`;生成 jobId(`crypto.randomUUID()`),顺序上传各段(任一段 blob 缺失即中止并报出缺失段序号,与现有逐段下载的报错口径一致),再调 `/export/stitch`,返回 `{outputPath, mode}`。Agent 的 baseUrl 与 token 复用 web 现有 Agent 连接配置(与 Agent 面板同源,不新增配置项)。
- **导出弹窗**:「拼接成片」按钮置于「打包下载」旁;Agent `/health` 不通时禁用并提示「需本地 Agent 运行」。状态流:上传中 i/N → 拼接中 → 完成(展示输出路径 + 「打开文件夹」按钮,调 `/export/reveal`)。失败时在弹窗内展示错误信息,可重试。
- **浏览器端工具 handler**:在现有 agent 工具执行处新增 `export_stitch` 分支:收集当前画布已通过段 → 调 `stitchFinalCut` → 返回文本结果(成功:输出路径+段数;失败:错误原因)。无已通过段时返回明确提示而非报错。

## MCP 工具声明(canvas-agent/src/schemas.ts)

- 名称 `export_stitch`;输入 `{title?: string}`;描述注明:拼接当前画布 Toonflow 导出节点收集到的全部「已通过」段视频为单一成片,需本地 ffmpeg,产物落在本机 Videos/Toonflow 目录。

## 错误处理清单

| 场景 | 行为 |
|---|---|
| ffmpeg 未安装 | stitch 前置检测,报错含安装指引 |
| 无已通过段 | web 侧拦截,提示先通过至少一段 |
| 某段 blob 丢失 | 上传前逐段校验,报缺失段序号,不发起拼接 |
| 段参数不一致 | 自动降级重编码,UI 提示 mode |
| ffmpeg 执行失败/超时 | 返回 stderr 摘要,temp 清理,弹窗可重试 |
| jobId 非法/段缺漏 | 400,拒绝拼接 |
| reveal 路径不在白名单 | 403 |
| Agent 不在线 | 按钮禁用;MCP 工具本身即依赖 Agent,天然不可达 |

## 测试

- **canvas-agent vitest**(纯函数,不 mock ffmpeg 行为本身):ffprobe 输出解析与"无损/重编码"判定;concat list 转义;文件名 sanitize;jobId 校验;reveal 白名单。
- **canvas-agent 集成测试**(检测到系统 ffmpeg 才跑,否则 skip):用 ffmpeg 现场生成 2 个 1 秒测试小片(lavfi color+sine),走完整 stitch 流程,断言输出存在、时长≈2s、mode=copy;再造一个分辨率不一致的组合断言 mode=reencode。
- **web vitest**:`stitchFinalCut` mock fetch——顺序上传、blob 缺失中止、stitch 响应透传、错误传播。
- **人工 E2E**:真实画布 ≥2 段已通过 → 按钮拼接 → 播放器验证成片连续可播;Agent 对话说「拼成片」→ 工具链路同样出片。

## 验收(完成定义)

1. `canvas-agent` `npx vitest run` 与 `npx tsc -p tsconfig.json` 通过;`web` `npx vitest run` 与 `npx tsc --noEmit` 通过。
2. 新文件存在且非空:`canvas-agent/src/stitch.ts`、`web/src/lib/toonflow/final-cut.ts`、双方测试文件。
3. 集成测试在本机(有 ffmpeg)真实跑绿:copy 与 reencode 两条路径都有输出断言。
4. 导出弹窗按钮、MCP 工具、`/export/*` 三个入口齐全,浏览器 E2E 出真实成片。
