# Codex Runtime — CodePilot Tool Bridge

> 产品思考见 [docs/insights/codex-tool-bridge.md](../insights/codex-tool-bridge.md)
> 父契约：[docs/handover/provider-proxy-bridge.md](./provider-proxy-bridge.md)（八个 hook、AI SDK v6 schema、Codex schema 来源）
> 执行计划：[docs/exec-plans/completed/phase-5c-codex-tool-bridge.md](../exec-plans/completed/phase-5c-codex-tool-bridge.md)

## 简介

让 Codex Runtime 在使用 CodePilot 自有 provider（GLM / Kimi / OpenAI-compat / Anthropic-compat / openai-oauth / CodePlan brand 等）时，仍然能调用 CodePilot 自身的内置工具（图片生成 / 媒体导入 / 助理记忆 / Widget 指南 / 通知与定时任务）。

## 触发场景

只在 Codex Runtime + 非 codex_account provider 时生效。三个分支不挂桥：

1. **Codex Runtime + Codex Account**：走 Codex 自己的 auth + 原生工具（Skills、image_gen、shell、apply_patch）。桥拒挂。
2. **CodePilot Runtime / Native Runtime**：原本就有 MCP / `builtin-tools/` 双链路，与本桥无关。
3. **`x-codepilot-session-id` header 缺失**：旧 build / 手动 smoke。桥拒挂，proxy 回退到 chat-only 行为。

## 关键文件

| 文件 | 作用 |
|---|---|
| `src/lib/codex/proxy/builtin-bridge.ts` | 工具桥本体。导出 `createCodePilotBuiltinTools` + `CODEPILOT_BUILTIN_TOOL_NAMES`。 |
| `src/lib/codex/proxy/builtin-event-bus.ts` | 侧通道事件总线（按 sessionId 索引，挂在 globalThis 上跨模块共享）。 |
| `src/lib/codex/proxy/parse-request.ts` | tools[] 分类（function / 已知 non-function / 未知 → 结构化错误）。 |
| `src/lib/codex/proxy/types.ts` | `ResponsesRequestBody.passthroughTools`、`ProxyHandlerInput.sessionId/workspacePath` 新字段。 |
| `src/lib/codex/proxy/translate-stream.ts` | `builtinToolNames` 抑制：内建工具的 tool-call 不向 Codex 发 `function_call output_item`。 |
| `src/lib/codex/proxy/translate-response.ts` | 非流式路径的同等过滤。 |
| `src/lib/codex/proxy/unified-adapter.ts` | 桥挂载点：read headers → 调 `createCodePilotBuiltinTools` → 合并工具集 → 加 `stopWhen: stepCountIs(8)` → 把系统提示拼到 `body.instructions`。 |
| `src/lib/codex/provider-proxy.ts` | `buildCodexProviderProxyInjection` / `buildCodexThreadParams` 新增 `sessionId` / `workspacePath` opts，注入到 http_headers。 |
| `src/lib/codex/runtime.ts` | `subscribeBuiltinEvents(sessionId, ...)` 在 `turn/start` 之前订阅；事件经 `materializeCodexEventMedia` → `canonicalToSseLine` 入 SSE。 |
| `src/app/api/codex/proxy/v1/responses/route.ts` | 读 `x-codepilot-session-id` / `x-codepilot-workspace-path` headers。 |

## 数据流

```
用户在 ChatView 发消息
   │
   ▼
CodexRuntime.stream()
   │ 1. subscribeBuiltinEvents(sessionId, listener)
   │ 2. buildCodexThreadParams({sessionId, workingDirectory, ...})
   │ 3. thread/start (or thread/resume) with config.model_providers.codepilot_proxy
   │    + http_headers x-codepilot-target-provider / -session-id / -workspace-path
   │ 4. turn/start
   │
   ▼
Codex app-server (子进程)
   │ 在 model_provider="codepilot_proxy" 下发起 HTTP request
   │
   ▼ POST /api/codex/proxy/v1/responses
proxy route
   │ headers → ProxyHandlerInput { sessionId, workspacePath, targetProviderId, ... }
   │
   ▼
unified-adapter
   │ 1. createModel(targetProviderId, model)
   │ 2. translateResponsesInput → ModelMessage[]
   │ 3. translateResponsesTools(body.tools) → Codex function tools
   │ 4. createCodePilotBuiltinTools({sessionId, workspacePath, targetProviderId})
   │    → bridge tools (image/media/memory/widget/notify/tasks)
   │ 5. merge tools (bridge wins on name collision)
   │ 6. prepend bridge.systemPrompt to body.instructions
   │ 7. streamText({ ..., stopWhen: stepCountIs(8) })
   │
   ▼
streamText loop
   │ - model 输出 text-delta
   │ - model 输出 tool-call(codepilot_generate_image)
   │   → ai-sdk 调用 bridge tool 的 execute()
   │     ┌─────────────────────────────────────────────┐
   │     │ runWithEvents()                              │
   │     │   1. emit tool_started(toolId, name, input) │
   │     │   2. await generateSingleImage(...)         │
   │     │   3. build MediaBlock[]                     │
   │     │   4. materializeCodexEventMedia (import to .codepilot-media) │
   │     │   5. emit tool_completed(toolId, output, media) │
   │     │   6. return text result                     │
   │     └─────────────────────────────────────────────┘
   │   ai-sdk 把 tool result 回填到 model 的下一步
   │ - model 继续输出 text-delta（基于工具结果）
   │ - 直到 finish 或 stepCount=8
   │
   ▼ ai-sdk fullStream events
translateStream
   │ - text-delta → response.output_text.delta（Codex 看见）
   │ - tool-call(codepilot_*) → 静默吞掉（不发 Codex）
   │ - tool-result → 静默吞掉
   │ - 其它 tool-call（Codex 自己的 shell 等）→ 正常发 response.output_item.done
   │
   ▼ SSE → Codex app-server → JSON-RPC notifications → CodexRuntime
   │
   │ 同时，侧通道事件已经在 streamText execute() 内部 emit 给了 listener:
   │
   ▼ subscribeBuiltinEvents listener (in runtime.ts)
   │ event → materializeCodexEventMedia → canonicalToSseLine → tryEnqueue
   │
   ▼ SSE 出口（与 Codex JSON-RPC 通知合并）
useSSEStream → SSECallbacks → stream-session-manager → MessageList / MediaPreview
```

侧通道与 Codex JSON-RPC 通道**并行**输出到同一个 SSE 流。这是为什么 MediaPreview 直接拿到 `tool_result.media` 不需要改动客户端代码。

## 工具清单

| 工具 | gate | 副作用 |
|---|---|---|
| `codepilot_generate_image` | 默认挂 | 调 `generateSingleImage` → `.codepilot-media` → MediaBlock |
| `codepilot_import_media` | 默认挂 | 调 `importFileToLibrary` → `.codepilot-media` → MediaBlock；`type` 字段由 mimeType 前缀决定（`video/*` → video, `audio/*` → audio, 其余 → image），与 `media-saver.mimeToMediaType` 同源 |
| `codepilot_memory_recent` | workspace 必须有 | 读 `memory.md` + `memory/daily/*.md` |
| `codepilot_memory_search` | workspace 必须有 | 调 `searchWorkspace`；`file_type` (`daily` / `longterm` / `notes`) 按路径过滤；`tags` 通过 `workspace-indexer.loadManifest()` 过滤（manifest 不可用时静默退化） |
| `codepilot_memory_get` | workspace 必须有 | path-safe + symlink-escape 校验后读文件 |
| `codepilot_load_widget_guidelines` | 默认挂 | 调 `getGuidelines(modules)` 返回文本 |
| `codepilot_notify` | 默认挂 | 调 `sendNotification` |
| `codepilot_schedule_task` | 默认挂 | `durable === false` → 调 `addSessionTask`（in-memory）；否则 POST `/api/tasks/schedule`；两条路径都注入 origin_session_id / working_directory |
| `codepilot_list_tasks` | 默认挂 | GET `/api/tasks/list` 拿 durable 列表，再合并 `getSessionTasks()`；status 过滤同时作用于两者 |
| `codepilot_cancel_task` | 默认挂 | 先尝试 `removeSessionTask`，命中即返；否则 DELETE `/api/tasks/:id` |

未支持（Phase 5c 范围外，将来再加）：

- Dashboard 工具族 (`codepilot_dashboard_*`)
- CLI tools 管理 (`codepilot_cli_tools_*`)
- `codepilot_hatch_buddy`

如果模型尝试调用这些名字，ai-sdk 会以"工具不存在"返回。下游 catalog drift 测试只锁本桥**实际挂载**的名字，不强制 Dashboard / CLI 立即接入。

## 关键设计决策

### 1. 为什么 proxy 内执行，而不是把 function_call 发给 CodexRuntime 走 turn 续接

Codex Responses API 没有 server-side tool execute 槽。如果 proxy 真发 `function_call` 给 Codex，Codex 会把它当作"客户端需要执行的工具"，而 CodePilot CodexRuntime 端原本没有这套 round-trip 机制。要让 turn 续接走 CodePilot 的话需要：
- 新增 `turn/continue` 或第二次 `turn/start` 的中转
- 把 CodePilot 工具执行结果反馈给 Codex 的 thread state
- 重新编排 streamText 状态

成本太高。而 ai-sdk v6 的 `streamText({ tools, stopWhen })` 天然支持 server-side execute + 多步续聊，正好契合"工具在 proxy 内完成、模型继续输出"的语义。把 function_call 在出口处吞掉（不发给 Codex）就够了。

### 2. 为什么用侧通道事件总线，而不是塞到 Responses 输出里

Responses-API 的 output_item 只有 `message` 和 `function_call` 两种。`tool_completed` 携带的 MediaBlock 在这两个 shape 里都没合适的槽。Codex app-server 也不会把陌生 output 转成 JSON-RPC 通知。所以唯一的选择是绕过 Codex，直接把事件入到 CodexRuntime 的 SSE 流。事件总线是按 sessionId 索引的进程内 EventEmitter，挂在 `globalThis` 上让 proxy module 和 runtime module 共享（Next 热更/双 module-graph 也安全）。

### 3. 为什么 emit-before-subscribe 必须丢弃

不缓冲。会导致跨 turn 状态泄漏：上一轮的图片如果没被消费，下轮订阅时会突然冒出来。每次 turn 开始 runtime 先订阅再 `turn/start`，这是约定的执行顺序。

### 4. 为什么 stopWhen: stepCountIs(8)

仅在桥挂载时启用多步。8 是经验值：足够让模型先读 memory → 生成 image → 写 notify → 文末解释，又不至于让出错的模型在工具调用里无限循环。Phase 5b chat-only 的 smoke 不挂桥，保持单步行为，不改变现有契约。

### 5. 为什么不读 `~/.codex/auth.json` / `scripts/image_gen.py` / `npm install openai`

这些是**模型自己幻觉出来的恢复路径**。pre-5c 模型看到 `imagegen` skill 文本但工具不可调用时，按"试着拼一拼能用的环境"思路自己写了这堆 fallback。`codex-builtin-no-anti-patterns.test.ts` 用 source grep 把这四个字符串列为禁用项；任何 proxy 文件出现都会让 CI 红。

## 安全边界

- **media serve**：所有图片 / 媒体路径必须落到 `<dataDir>/.codepilot-media`。`materializeCodexEventMedia` 在事件离开 bridge 之前完成导入；`/api/media/serve` 拒绝非此目录的请求，这是已经存在的 boundary。
- **workspace path traversal**：`codepilot_memory_get` 复用 `memory-search-mcp.ts` 的路径校验逻辑（`path.relative` startsWith '..' 检查 + `realpath` 链跟随后再校验，防 symlink escape）。
- **task hidden context**：`codepilot_schedule_task` 的 `origin_session_id` / `working_directory` 从 bridge closure 写入 POST body；模型即使在 input 里塞同名字段也无效（POST body 后写覆盖）。

## 测试矩阵

| 测试文件 | 测试什么 |
|---|---|
| `codex-proxy-builtin-event-bus.test.ts` | 总线：subscribe/emit/unsubscribe、多订阅者广播、session 隔离、drop-before-subscribe、listener 异常隔离 |
| `codex-proxy-parse-classification.test.ts` | parse-request 分类：function / 已知 non-function / 未知类型结构化错误 |
| `codex-proxy-headers.test.ts` | 新 headers：默认不发、有值时发、空串不发、codex_account 不注入 |
| `codex-builtin-bridge.test.ts` | 桥本体：挂载 / 跳过、工具集完整性、execute() 事件形状、跨 session 隔离、错误路径不含反模式 |
| `codex-builtin-stream-suppression.test.ts` | translate-stream：内建工具不发 function_call、外部工具正常发、index 序列无空缺 |
| `codex-builtin-codex-account-guardrail.test.ts` | codex_account 不挂桥（bridge 层 + thread params 层） |
| `codex-builtin-no-anti-patterns.test.ts` | source-grep：auth.json / image_gen.py / npm install / OPENAI_API_KEY |

## Smoke 矩阵（用户必须跑）

| Smoke | Prompt / 操作 | 通过标准 |
|---|---|---|
| Codex Account + GPT-Image | "用 GPT-Image-2.0 画一张小猫" | 走原生路径，图片正常显示，本桥未介入（log 里看不到 bridge events） |
| GLM-5 Turbo + Codex Runtime + 图片 | 同上 | 工具调用记录里出现 `codepilot_generate_image`；MediaPreview 立刻显示；无 CLI fallback；reload 仍可见 |
| Kimi + Codex Runtime + 图片 | 同上 | 同上 |
| GLM/Kimi + widget | "生成一个 widget 展示销售数据，必要时先加载 guidelines" | 调用 `codepilot_load_widget_guidelines`，最终生成 show-widget fence |
| GLM/Kimi + memory | "用 codepilot_memory_recent 看看最近记忆" | 命中 `codepilot_memory_recent`；不是 Bash 读文件 |
| GLM/Kimi + tasks | "用 codepilot_list_tasks 列出现有任务" | 命中 `codepilot_list_tasks`；从 DB / API 读到结果 |

Phase 5c 已经通过 Phase 5e Harness 收口归档；后续若要把 Dashboard / CLI 等 deferred 能力变为可执行能力，按 Harness Capability Contract 新开 slice，而不是回到本 bridge 文档里补丁式扩展。

## Codex `tools[]` 允许列表（与 ToolSpec enum 同源）

`parse-request.ts KNOWN_NON_FUNCTION_TYPES` 必须与 `资料/codex/codex-rs/tools/src/tool_spec.rs` 的 `ToolSpec` enum（带 `#[serde(tag = "type")]`）保持同源。除 `function`（走主路径）外，其它六个值都进 `passthroughTools`：

| `type` | 来源 | 处理 |
|---|---|---|
| `namespace` | MCP / Skill bundle，含嵌套 `tools[]` | passthrough，原 payload 保留；嵌套 function tools 暂未 flatten（后续 slice） |
| `tool_search` | Codex tool-discovery 表面 | passthrough |
| `local_shell` | Codex shell tool | passthrough |
| `image_generation` | OpenAI Responses 内建 | passthrough |
| `web_search` | OpenAI Responses 内建 | passthrough |
| `custom` | Codex freeform（apply_patch 等） | passthrough |

不在此列的 `type` 直接 `unsupported_tool_kind`。新增 Codex enum variant 时必须同步本表 + `KNOWN_NON_FUNCTION_TYPES`，由 `codex-proxy-namespace-tool.test.ts` 锁住。

## Proxy preflight 错误可见性

代理在 `parseResponsesRequest` / `handleProxyRequest` 阶段返回 4xx JSON 时，Codex app-server 把 HTTP 错误翻译成 JSON-RPC error notification → CodexRuntime `translateCodexNotification` → `run_failed` canonical event → SSE `data: {"type":"error", "data":"<msg>"}`。

但 chat route (`src/app/api/chat/route.ts`) 持久化条件是 `contentBlocks.length > 0`：preflight 错误**只**有 error event，没文本/思考/工具结果，contentBlocks 永远是空。结果：实时 SSE 显示了错误，refresh 后转录里只剩用户气泡。

Phase 5c slice 5 fix: chat route 在主路径 + catch 路径都加一条 fallback——若 `hasError && contentBlocks.length === 0`，push `**Error:** <message>` 文本块再走持久化分支。文案与 `stream-session-manager.ts:864` 客户端 snapshot 同源，refresh 前后转录一致。

## Widget 格式契约

S4 smoke 显示模型在 widget 任务里会：（1）误读 Chart.js / SVG 示例，把 raw HTML 当成 `show-widget` 内容；（2）多余调用 `codepilot_generate_image`。Phase 5c slice 6 加四道防线：

1. **单一 wire format 来源** — `WIDGET_WIRE_FORMAT_SPEC`（在 `widget-guidelines.ts`）。系统提示 + on-demand `getGuidelines()` 输出都嵌入这段，禁止 drift。
2. **on-demand guidelines 前置 reminder** — `getGuidelines()` 输出第一段就是 wire format spec 与 “HTML/SVG examples 是 INSIDE widget_code，不是 wire format”。设计模块章节继续保留 raw HTML 示例，但出现位置在 spec 之后。
3. **image-gen 工具禁用** — 系统提示 + bridge `WIDGET_PROMPT` 都明示 widget 任务期间不许调 `codepilot_generate_image`，除非用户独立要求生成图片。
4. **渲染层错误可见** — `MessageItem.parseAllShowWidgets` 不再静默丢弃格式不对的 `show-widget` fence。三类失败（raw HTML 体 / JSON 缺 `widget_code` / JSON 解析错）都返回 `malformed_widget` segment，由 `MalformedWidgetNotice` 在聊天里渲染成可见的警告卡，附原始 fence body 折叠详情。

由 `codex-widget-format-contract.test.ts` 12 个 pin 锁定（spec → 系统提示 → 桥提示 → 渲染层的端到端契约）。

## 已知遗留

- Dashboard / CLI tools 工具族 deferred 到下一轮。
- Codex passthrough tools (`custom` / `namespace` / `local_shell` / `tool_search` / `web_search` / `image_generation`) 现在仅记录到 `passthroughTools` 字段，没有真实执行能力；模型如果尝试调用 Codex 原生 shell / apply_patch（通过 proxy 路径而非 Codex Account 路径），ai-sdk 会以"工具不存在"返回。`namespace` 的嵌套 function tools 也未被 flatten 进 ai-sdk ToolSet — 用户如果需要这层（让 GLM/Kimi 也能用 Codex 自身的 MCP 插件），单独立项。
- `stopWhen: stepCountIs(8)` 是经验值；如果遇到模型工具链超过 8 步（极少见），需要按场景调整。
