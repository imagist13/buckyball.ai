# Provider Proxy Bridge Contract

> 创建：2026-05-16 · 负责人：CodePilot Runtime
> 背景与计划见 [docs/exec-plans/completed/phase-5-codex-runtime.md](../exec-plans/completed/phase-5-codex-runtime.md)（配对 insights 未产出）。

## 为什么需要这层

`AgentRuntime`（`src/lib/runtime/types.ts:14`）这层抽象解决的是**输出面**：runtime 收一个 prompt，吐 SSE 给现有 chat UI。它故意不抽象 tools / messages / permissions，因为不同 runtime 的内部协议差别太大。

Phase 5b 接入 Codex 后我们引入了一条新链路：

```
Codex app-server → /api/codex/proxy/v1/responses → unified-adapter
  → createModel()（ai-provider.ts）→ AI SDK v6 streamText/generateText
  → Responses SSE → Codex app-server
```

也就是同时桥接三套协议：

| 层 | 协议 |
|---|---|
| 1 | CodePilot Runtime contract（`AgentRuntime` + `RuntimeRunEvent`） |
| 2 | Codex app-server / Responses-API / Codex custom tool protocol |
| 3 | Vercel AI SDK v6（`ModelMessage` + `ToolSet` + `tool()` / `jsonSchema()` 包装） |

第 1 层有契约（`runtime/contract.ts` + Phase 0.5 Slice B 的 RuntimeRunEvent 单测）。第 2、3 层之前没有契约文件，靠 live smoke 一轮一个字段补：`instructions`、`store:false`、`custom` tools、`thread/resume` config、`tool({ inputSchema: jsonSchema(...) })`。这份文档把第 2、3 层正式契约化，后续任何新 Agent 框架接入都必须先过这套契约。

## 接入合约：ProviderProxyBridge

凡是要让一个 Agent 框架（Codex / Cline / Devin 之类）使用 CodePilot 现有 provider，都要实现下面这套接口。每个 hook 都必须配 fixture + 单测。

| Hook | 输入 | 输出 | 必须覆盖的 fixture |
|---|---|---|---|
| `parseInboundRequest` | 框架发来的 HTTP body | 归一化的 request object | no-tools / function-tool / custom-tool / mixed-tool / image-input / multi-turn-with-tool-result |
| `translateInput` | 归一化 request 里的 input items | AI SDK `ModelMessage[]` | system+user / assistant+function_call / function_call_output / image / developer-role |
| `translateTools` | 归一化 request 里的 tools | AI SDK `ToolSet`（必须用 `tool({ inputSchema: jsonSchema(...) })`） | function / 参数缺失 / 非 function 类型 |
| `translateProviderOptions` | 归一化 request 字段（`instructions` / `store` / `reasoning` 等） | AI SDK `providerOptions`（per-SDK 字段） | instructions / store / effort=high / 多字段共存 |
| `translateStream` | AI SDK `fullStream`（异步迭代） | 框架要求的 SSE 事件序列 | text-only / text+tool-call / error / abort / no-tool-input-start |
| `translateResponse` | AI SDK `generateText` 结果 | 框架要求的非流式 JSON | text-only / tool-only / 混合 |
| `translateError` | 任何 throw（HTTP / abort / 翻译错误） | 框架要求的 error envelope（包含 message + code） | 401 / 429 / 5xx / abort / 翻译错误 |
| `resumeThreadParams` | 已存在的 thread 元数据 + 当前 request | 框架的 thread/resume 调用参数 | start ↔ resume 对称、provider 切换、cwd 变化、effort 变化 |

### 不变量

1. **每个 hook 都不能 throw**：用 `translateError` 包装，返回 framework-shaped error envelope。
2. **AI SDK 接触面只能用 helper**：tools 必须 `tool({ inputSchema: jsonSchema(...) })`，不接受 raw JSON Schema cast。reasoning 必须 `providerOptions.<sdk>.<key>`。
3. **resume 和 start 共享同一 params 对象**：禁止 resume 只传 `{ threadId }`。
4. **虚拟 provider 必须出现在 resolver registry**：任何在 `/api/providers/models?runtime=...` 中暴露但不在 DB 的 provider id（`env` / `openai-oauth` / `codex_account` 等）都必须在 `VIRTUAL_PROVIDERS` 中显式登记。
5. **upstream schema fixture > source grep**：补 Codex / 新框架字段时，先把真实 schema 文件复制到 `资料/<framework>/` 或 `tests/fixtures/<framework>/`，再写 adapter，不接受“仅靠 source grep + 推测”。

## Codex Provider Proxy 现状映射

| Hook | 实现位置 | 状态 |
|---|---|---|
| `parseInboundRequest` | `src/lib/codex/proxy/parse-request.ts` | ✅（含 `store` + 非 function tool 静默丢弃） |
| `translateInput` | `src/lib/codex/proxy/translate-input.ts` | ✅（system / developer / user / assistant+function_call / function_call_output / image） |
| `translateTools` | `src/lib/codex/proxy/translate-tools.ts` | ✅（2026-05-16 改为 `tool({ inputSchema: jsonSchema(...) })`） |
| `translateProviderOptions` | `src/lib/codex/proxy/unified-adapter.ts` `buildProviderOptions` | ✅（`instructions`、`store`、`reasoning.effort` → Anthropic thinking / OpenAI reasoningEffort） |
| `translateStream` | `src/lib/codex/proxy/translate-stream.ts` | ✅ |
| `translateResponse` | `src/lib/codex/proxy/translate-response.ts` | ✅ |
| `translateError` | `src/lib/codex/proxy/errors.ts` `classifyUpstreamError` + `event-mapper.ts` `error` 分支 | ✅（mapper 现在按真实 `TurnError` schema 读 `error.message + additionalDetails + codexErrorInfo`） |
| `resumeThreadParams` | `src/lib/codex/provider-proxy.ts` `buildCodexThreadParams` + `runtime.ts` 共用 | ✅（包含 `model`、`modelProvider`、`config`、`cwd`） |

## AI SDK v6 接触面要点

ai-sdk v6 把 `Tool` 的 inputSchema 改成 `FlexibleSchema<T>`：必须是用 `jsonSchema(...)` / `zodSchema(...)` / `tool(...)` 包装出来的对象，因为 ai-sdk 内部用 `asSchema()` 调 `.validate(...)`。

- **错的做法**：`{ description, inputSchema } as unknown as Tool` — TS 通过，运行时 `streamText` 在准备工具时炸 "schema is not a function"。
- **对的做法**：

  ```ts
  import { tool, jsonSchema } from 'ai';

  out[name] = tool({
    description,
    inputSchema: jsonSchema({
      type: 'object',
      properties: { /* ... */ },
    }),
  });
  ```

- **没有 outputSchema 时**：ai-sdk 把返回类型推成 `Tool<unknown, never>`。collection 类型用 `Record<string, Tool<unknown, never>>`。
- **没有 execute**：是合法的"definition-only tool"，ai-sdk 发出 `tool-call` 事件后停下，等下一轮带 `function_call_output` 进来再继续。

## Codex schema 来源

| 文件 | 用途 |
|---|---|
| `资料/codex/sdk/typescript/tests/responsesProxy.ts` | **Responses SSE 事件的金标契约**：`assistantMessage()` / `shell_call()` / `responseCompleted()` / `responseFailed()` 是 SDK 公开测试 fixture，proxy 输出必须能被它直接消费。任何 SSE 字段争议以这份文件为准。 |
| `资料/codex/codex-rs/core/tests/common/responses.rs` | Codex Rust 端的事件构造工具（`ev_assistant_message` / `ev_function_call` / `ev_completed` / `ev_output_text_delta`），与 SDK fixture 互相印证 |
| `资料/codex/codex-rs/core/src/stream_events_utils.rs` `handle_output_item_done` | 解释了为什么 `output_item.done` 是必须事件 —— 它是 Codex 把 item 写入 turn items[] 的唯一路径 |
| `资料/codex/codex-rs/app-server-protocol/schema/typescript/v2/ThreadStartParams.ts` | 验证 `model` + `modelProvider` + `config` 字段 |
| `资料/codex/codex-rs/app-server-protocol/schema/typescript/v2/ThreadResumeParams.ts` | resume 也接受同一组 override 字段 |
| `资料/codex/codex-rs/app-server-protocol/schema/typescript/v2/ErrorNotification.ts` | `{ error: TurnError, willRetry, threadId, turnId }` |
| `资料/codex/codex-rs/app-server-protocol/schema/typescript/v2/TurnError.ts` | `{ message, codexErrorInfo, additionalDetails }` |
| `资料/codex/codex-rs/app-server-protocol/schema/typescript/v2/CodexErrorInfo.ts` | string variant + `{ httpConnectionFailed: { httpStatusCode } }` 类型 union |
| Codex `/responses` API 上游约束 | `instructions` 必填 + `store: false` 必传 |

接入新 Agent 框架前必须先 snapshot 它的同等协议文件到 `资料/<framework>/` 或 `tests/fixtures/<framework>/`，再写 adapter。

## Codex Responses SSE 契约（来自 SDK fixture）

每个 SSE 帧必须按以下格式发送，**`event:` 行不能省略**：

```
event: <type>
data: <json-encoded ResponsesEvent>

```

最少 viable 的一轮聊天事件序列（与 SDK `responsesProxy.ts:assistantMessage()` 对齐）：

```
event: response.created
data: {"type":"response.created","response":{"id":"resp_x"}}

event: response.output_item.added            ← 可选；用于增量 UI
data: {"type":"response.output_item.added","output_index":0,"item":{"id":"msg_1","type":"message","role":"assistant","content":[]}}

event: response.output_text.delta             ← 可重复；增量文本
data: {"type":"response.output_text.delta","output_index":0,"item_id":"msg_1","delta":"hi"}

event: response.output_item.done              ← 必须；Codex 据此写入 items[]
data: {"type":"response.output_item.done","output_index":0,"item":{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"output_text","text":"hi"}]}}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_x","usage":{"input_tokens":1,"input_tokens_details":null,"output_tokens":1,"output_tokens_details":null,"total_tokens":2}}}

data: [DONE]

```

工具调用沿用 `output_item.done(function_call)`，不发 `function_call.delta/done` 事件：

```
event: response.output_item.done
data: {"type":"response.output_item.done","output_index":0,"item":{"id":"call_1","type":"function_call","call_id":"call_1","name":"shell","arguments":"{\"command\":[\"bash\"]}"}}
```

错误事件用 **`response.failed`**（Codex app-server SSE 解析器 `process_responses_event` 实际匹配的 type）：

```
event: response.failed
data: {"type":"response.failed","response":{"id":"resp_x","error":{"code":"upstream_unauthorized","message":"..."}}}

data: [DONE]
```

> **重要的不对称：** SDK fixture 里 `responseFailed()` 返回的是 `{type: "error", error}` 形式 —— 那是 SDK 自己 reader 路径的口径。但 Codex 的 app-server SSE 解析器（`codex-rs/codex-api/src/sse/responses.rs` 的 `process_responses_event`）**只匹配 `response.failed`**，不识别 `error`。Phase 5b smoke 第 5 轮 (2026-05-15) 曾按 SDK fixture 改成 `error`，第 6 轮 (2026-05-16) 复盘后撤回：今天 proxy 的实际消费者是 app-server 路径，必须用 `response.failed`，否则失败时 Codex parser 走到 "unhandled event" 分支 → `[DONE]` 不转 completed → 用户看到 "stream closed before response.completed" 静默失败。
>
> Codex parser 会读 `response.error.code` 做分类（`context_length_exceeded` → ContextWindowExceeded / `insufficient_quota` → QuotaExceeded / `server_overloaded` → ServerOverloaded / `cyber_policy` → CyberPolicy / 其它 → Retryable 带 retry-after），`response.error.message` 是用户看到的原文。
>
> 当 `@openai/codex-sdk` execution POC 落地后，SDK reader 路径需要发 `{type: "error"}`；那时这层需要按 consumer 类型分叉。

`response.completed.response.usage` 字段必须按这个 shape：

```ts
{
  input_tokens: number;
  input_tokens_details: { cached_tokens: number } | null;
  output_tokens: number;
  output_tokens_details: { reasoning_tokens: number } | null;
  total_tokens: number;
}
```

**单测金标 fixture**：`src/__tests__/unit/codex-proxy-sdk-fixture.test.ts` 把上面这套契约固定下来，比对的就是 `资料/codex/sdk/typescript/tests/responsesProxy.ts` 的 `assistantMessage()` / `shell_call()` / `responseCompleted()` / `responseFailed()` reference event 形状。后续任何 stream / sse 改动跑这个文件先。

## Smoke 矩阵（Phase 5b 收口标准）

四类 provider × 至少两轮聊天，且 turn2 必须复用同一个 `codex_thread_id`：

| Family | 推荐 Provider | 模型 | 状态 |
|---|---|---|---|
| Codex Account 原生 | `codex_account` | gpt-5.5 | ✅ 已通 |
| openai-oauth | `openai-oauth` | gpt-5.4 | 🔄 schema fix 之后待复测 |
| Anthropic-compatible / ClaudeCode-compatible | Aibrm | anthropic/claude-haiku-4.5 | 🔄 schema fix 之后待复测 |
| CodePlan / 套餐型 | Kimi | kimi-for-coding | 🔄 schema fix 之后待复测 |

每条 smoke 通过的判定：

1. POST `/api/chat` 不返回 `data: {"type":"error", ...}`。
2. 第二轮 `getSession().codex_thread_id` 等于第一轮拿到的 thread id。
3. 第二轮 `thread/resume` 请求 body 里仍有 `modelProvider: codepilot_proxy` + `config.model_providers.codepilot_proxy`。
4. proxy route 端真实看到 `x-codepilot-target-provider` header 与会话的 provider id 一致。

## 后续 Agent 框架接入流程（建议）

1. 把目标框架的协议 schema 文件 snapshot 到本地（`资料/<framework>/`）。
2. 在 `tests/fixtures/<framework>/` 写 6+ 条 golden fixture：无 tools / 函数 tool / 非函数 tool / 工具结果 / 错误 / usage / resume。
3. 实现 `ProviderProxyBridge` 接口（八个 hook），每个 hook 用 fixture 写单测。
4. 用 `MockLanguageModelV3` 跑端到端 contract test：fixture 进入 → bridge → streamText 不 throw → 输出 framework SSE。
5. 用真实 credential 跑 smoke 矩阵（每家族两轮）。
6. 全过后才能在 picker 里把这条 runtime 标为可用。

不要再走"先放出去再 live smoke 抓 bug"的路。
