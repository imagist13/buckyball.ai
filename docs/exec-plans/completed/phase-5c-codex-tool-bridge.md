# Phase 5c — CodePilot Tool Bridge for Codex Runtime（执行子计划）

> 创建：2026-05-16 · 最后更新：2026-05-19
> 状态：✅ 已完成并归档；后续能力边界统一由 [phase-5e-runtime-harness-architecture.md](./phase-5e-runtime-harness-architecture.md) 的 HarnessBundle / capability matrix / Settings 能力清单承接。
> 父计划：[phase-5-codex-runtime.md](./phase-5-codex-runtime.md) `Phase 5c — CodePilot Tool Bridge for Codex Runtime`
> 产品/能力矩阵已经在父计划里定义；本文件记录实现路径、组件契约、提交切片和验收口径。

## 上下文（必读）

父计划已经把"为什么需要这层 / 能力矩阵 / 被否方案 / 完成口径"全写过。本文件 ≠ 重新论证，是 **HOW**：怎么落地不掉链子。

实测信号：

- ✅ Codex Account + GPT-Image：原生路径正常。
- ❌ GLM-5 Turbo / Kimi（CodePilot provider）+ Codex Runtime + GPT-Image 请求：模型读到 `imagegen` Skill 文本但找不到可调用工具，开始 CLI fallback → `OPENAI_API_KEY` lookup → 试图读 `~/.codex/auth.json` → 尝试 `npm install openai` → generation stopped。
- 根因不是 GPT-Image 单点：`parse-request.ts` 把所有 non-function tools 静默丢弃；`translate-tools.ts` 显式写"built-in tools NOT supported yet"。这两层让模型只看到 Skill 文本却拿不到真实工具。

## 架构判断

**采用：proxy 内执行 + 侧通道事件总线**

- CodePilot built-in tools 通过 `streamText({ tools, stopWhen })` 在 proxy 内执行（ai-sdk v6 的 `execute()` 路径）。
- 工具结果（含 `MediaBlock`）经一条**侧通道 EventEmitter**（按 sessionId 索引）直送 `CodexRuntime`，再由现有 `canonicalToSseLine` 写入 SSE 流。
- 对 Codex 来说这些工具调用是隐形的：不发 `function_call` output_item，模型在 ai-sdk loop 内拿到结果继续输出 assistant 文本，Codex 只看到最终文本。
- Codex 自己的 function tools（shell / apply_patch）保持原行为：proxy 转发 function_call，Codex CLI 执行。

**为什么不是其它方案**：

- ❌ 让 Codex CLI 反向调用 CodePilot tool：Codex 没有这种 hook。
- ❌ 让 proxy 把 function_call 发回 Codex 由 CodePilot 端再绕一圈：要么 Codex 把它当成 native tool 失败，要么需要发明新的 turn 续接 RPC。
- ❌ 把 MCP server 转 AI SDK tool 通用桥（`builtin-mcp-bridge.ts:getBuiltinMcpTools`）：现存代码已经是空 stub，且 Native Runtime 还是直接复用 `builtin-tools/*`。无收益。
- ✅ proxy 内执行是 ai-sdk 原生模式，且 ai-sdk multi-step 已经支持 tool-call → execute → 继续生成；只需补一条 CodePilot UI 可见性侧通道。

## 组件契约

### 1. 侧通道事件总线 `src/lib/codex/proxy/builtin-event-bus.ts`

```ts
subscribeBuiltinEvents(sessionId: string, listener: (event: RuntimeRunEvent) => void): () => void
emitBuiltinEvent(sessionId: string, event: RuntimeRunEvent): void
```

- 实现：`globalThis` 上的 `Map<sessionId, Set<listener>>`，避免多模块加载产生独立实例。
- emit 在无订阅者时**丢弃**（不缓冲）；订阅必须在 turn/start 前完成。
- 用 `process` 级 unhandled errors 安全：每个 listener 调用包裹 try/catch。

### 2. 工具桥 `src/lib/codex/proxy/builtin-bridge.ts`

```ts
createCodePilotBuiltinTools(opts: {
  sessionId: string;
  workspacePath?: string;
  targetProviderId: string;
}): {
  tools: ToolSet;
  toolNames: ReadonlySet<string>;
  systemPrompt: string;
}
```

第一切片实现的工具（与父计划能力矩阵对齐）：

| 工具 | 来源 handler | side-channel 行为 |
|---|---|---|
| `codepilot_generate_image` | `@/lib/image-generator.generateSingleImage` | tool_started → tool_completed(media: MediaBlock[]) |
| `codepilot_import_media` | `@/lib/media-saver.importFileToLibrary` | tool_started → tool_completed(media: MediaBlock[]) |
| `codepilot_memory_recent` / `codepilot_memory_search` / `codepilot_memory_get` | `@/lib/memory-search-mcp` 同源 handler，workspace-gated | tool_started → tool_completed(text) |
| `codepilot_load_widget_guidelines` | `@/lib/widget-guidelines` | tool_started → tool_completed(text) |
| `codepilot_schedule_task` / `codepilot_list_tasks` / `codepilot_cancel_task` / `codepilot_notify` | `@/lib/notification-mcp` 同源 handler | tool_started → tool_completed(text) |

延后到 5c.2 切片：

- `codepilot_cli_tools_*`（执行类，需要走 permission）
- `codepilot_dashboard_*`（写类，schema 一致性确认后接入）
- `codepilot_hatch_buddy`（先确认 origin session/dispatch 仍正确）

未支持工具：返回结构化 `tool_unavailable` 文本（"This tool is not yet bridged in Codex Runtime; ask the user to switch to Native or SDK Runtime"），不能让模型猜下一步。

### 3. parse-request 分类

`parse-request.ts` 不再静默丢弃 non-function tools；分成 `tools: ResponsesFunctionTool[]` + `passthroughTools: ClassifiedNonFunctionTool[]`。后者只用于日志/未来扩展。未知 type 字段直接 `unsupported_tool_kind` 失败（用户要求）。

### 4. proxy header 扩展

`buildCodexProviderProxyInjection` 加 `x-codepilot-session-id` 和 `x-codepilot-workspace-path` 两个 http_headers。route 读这两个值，进入 `ProxyHandlerInput`。Codex Account 路径根本不会触发（virtual provider routingBug 守卫已经在）。

### 5. unified-adapter 接入

- 读 `input.sessionId` / `input.workspacePath`，调 `createCodePilotBuiltinTools`，把 `tools` 与 `translateResponsesTools(body.tools)` 的结果合并。
- `streamText({ tools, stopWhen: stepCountIs(8), ... })`。8 步是经验值（image + 后续文本足够；过大可能在大模型出错时反复重试）。
- `translateStream` 接 `builtinToolNames: Set<string>`：在该集合里的 tool-call / tool-input-start / tool-input-delta 不发 Responses 事件（Codex 不需要知道）。tool-result 一律不发（Codex 端没有对应的入口）。

### 6. CodexRuntime 订阅

`runtime.ts` stream() 在 `turn/start` 之前 `subscribeBuiltinEvents(sessionId, event => tryEnqueue(canonicalToSseLine(materializeCodexEventMedia(event, ctx) ?? event)))`，订阅函数加入 `unsubscribers`，closeStream 自动清理。

## 提交切片

| 切片 | 内容 | 单测 |
|---|---|---|
| 5c-step-1 | 计划 + 事件总线 + parse-request 分类 + types 扩展 | `codex-proxy-builtin-event-bus.test.ts`、`codex-proxy-parse-classification.test.ts` |
| 5c-step-2 | proxy headers + 路由读取 + provider-proxy 注入 + runtime 透传 + ProxyHandlerInput 类型 | `codex-proxy-headers.test.ts` |
| 5c-step-3 | 工具桥模块（image / media / memory / widget / tasks）+ 侧通道事件 | `codex-builtin-bridge.test.ts` |
| 5c-step-4 | unified-adapter 合并工具 + stopWhen + translate-stream 抑制内建工具事件 | `codex-builtin-adapter-integration.test.ts`、`codex-builtin-stream-suppression.test.ts` |
| 5c-step-5 | CodexRuntime 订阅事件总线 | `codex-runtime-builtin-bus.test.ts` |
| 5c-step-6 | 防回归 + Codex Account 守卫 + 反模式 source-grep | `codex-builtin-codex-account-guardrail.test.ts`、`codex-builtin-no-anti-patterns.test.ts` |
| 5c-step-7 | 交接 / 产品 doc + closeout 状态更新 | （无） |

每个切片单独 commit，pre-commit hook 跑 `npm run test`。

## 安全边界（用户硬性要求）

- 任何 bridge 实现都不得读 `~/.codex/auth.json`、不得 `npm install`、不得跑 `scripts/image_gen.py`、不得绕过 `/api/media/serve` 的 `.codepilot-media` 边界。
- 反模式 source-grep 测试：把上述四条 substring 列出，断言 `src/lib/codex/proxy/**/*.ts` 没有任意一处包含。

## 完成口径

- 父计划已经写过；不再复制一遍。但**此 PR 不能把 Phase 5c 标 ✅**。
- 最终归档状态：实现 + 单测 + Harness 收口已完成；真实 smoke 中暴露的 namespace tool、widget wire format、media rendering、工具结果持久化等问题已在后续 slice / Phase 5e 中闭环。
- closeout 状态更新为：`Phase 5c ✅ 实现 + 单测 + Harness 收口完成`。Codex 不支持能力不再假装可执行，统一通过 Settings 能力清单和聊天工具提示说明替代路径。

## 用户必须跑的 smoke

1. Codex Account + GPT-Image：原生路径仍正常。
2. GLM-5 Turbo + Codex Runtime + "调用 GPT-Image-2.0 画小猫"：实时图片卡；无 CLI fallback；reload 仍可见。
3. Kimi + Codex Runtime + 同上。
4. GLM/Kimi + widget：能加载 guidelines 并生成 widget。
5. GLM/Kimi + memory：能命中 `codepilot_memory_recent` 工具调用。
6. GLM/Kimi + tasks：能 `codepilot_list_tasks` 或 `codepilot_schedule_task`。

每条 smoke 须确认：
- 工具调用真实出现在转录里（不是 Bash 假冒）。
- 副作用可观察（media 卡 / DB 行 / 通知）。
- 失败路径有结构化错误，不出现 "trying CLI" / "checking auth.json" 文案。
