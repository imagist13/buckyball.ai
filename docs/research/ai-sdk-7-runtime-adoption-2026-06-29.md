# AI SDK 7 Runtime 采用调研

> 日期：2026-06-29
> 触发问题：用户看到 [Vercel AI SDK 7 发布文](https://vercel.com/blog/ai-sdk-7)，询问 CodePilot Runtime 是否可以直接使用，以及哪些新能力值得采纳。

## 结论

**不建议把现有 Runtime 直接替换成 AI SDK 7 的 HarnessAgent 或 WorkflowAgent。** 更稳的路线是：

1. **Native Runtime 先升级到 AI SDK 7 Core/ToolLoopAgent 能力**，保留 CodePilot 自己的 `AgentRuntime`、SSE、权限、DB、Provider resolver、上下文 accounting 外壳。
2. **Codex Runtime 继续保留现有 app-server 路径**。AI SDK 7 的 `@ai-sdk/harness-codex` 是 experimental、依赖 sandbox bridge，且官方 adapter matrix 标注 Codex built-in tool approval 不支持；迁移会倒退现有本地 app-server + approval bridge + MCP 注入路径。
3. **Claude Code SDK Runtime 暂不迁到 `@ai-sdk/harness-claude-code`**。HarnessAgent 的 session/history 语义、sandbox requirement、resume state 都和当前 Claude Agent SDK 路径不同，适合作 POC，不适合作直接替换。
4. **WorkflowAgent 暂不适合桌面主链路**。它绑定 Workflow runtime，价值在云端 durable/resumable agent；CodePilot 本地 Electron + SQLite 的任务/聊天链路更适合先吸收 timeout/approval/context 设计，而不是引入 Vercel Workflow runtime。

换句话说：AI SDK 7 很有价值，但它更像“下一轮 Native Runtime 收敛的工具箱”，不是“把 Runtime 目录删掉换包”的那种直接升级。

## 外部事实

官方发布文把 AI SDK 7 的 Agent 能力分成几组：

- Develop agents：reasoning control、tool/runtime context、provider files/skills、MCP Apps、Terminal UI。
- Run agents：tool approvals、`WorkflowAgent` durability、timeouts、sandbox support。
- Integrate harnesses：experimental harness abstraction + `HarnessAgent`，覆盖 Codex、Claude Code、Deep Agents、OpenCode、Pi。
- Observe agents：telemetry、lifecycle callbacks、per-step performance。

官方文档和 npm 包当前状态：

| 包 | 当前版本 | 关键状态 |
|----|----------|----------|
| `ai` | `7.0.4` | Node `>=22`; `ToolLoopAgent` 在 core 包内 |
| `@ai-sdk/harness` | `1.0.6` | 描述明确为 experimental |
| `@ai-sdk/harness-codex` | `1.0.6` | 基于 `@openai/codex-sdk` 驱动 codex CLI，sandbox bridge |
| `@ai-sdk/workflow` | `1.0.4` | `WorkflowAgent`，Node `>=22` |
| `@ai-sdk/mcp` | `2.0.3` | MCP client，Node `>=22` |
| `@ai-sdk/devtools` | `1.0.0` | local-only devtool，Node `>=22` |

主要官方来源：

- [AI SDK 7 发布文](https://vercel.com/blog/ai-sdk-7)
- [ToolLoopAgent / Building Agents](https://ai-sdk.dev/docs/agents/building-agents)
- [Tool Approvals](https://ai-sdk.dev/docs/agents/tool-approvals)
- [WorkflowAgent](https://ai-sdk.dev/docs/agents/workflow-agent)
- [HarnessAgent](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-agent)
- [Harness Tools](https://ai-sdk.dev/docs/ai-sdk-harnesses/tools)
- [Harness Adapters](https://ai-sdk.dev/docs/ai-sdk-harnesses/harness-adapters)
- [Runtime and Tool Context](https://ai-sdk.dev/docs/ai-sdk-core/runtime-and-tool-context)
- [MCP](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools)
- [Provider & Model Management](https://ai-sdk.dev/docs/ai-sdk-core/provider-management)
- [DevTools](https://ai-sdk.dev/docs/ai-sdk-core/devtools)

## 本仓库事实

当前依赖仍在 AI SDK 6 代：

- `ai: ^6.0.169`
- `@ai-sdk/anthropic: ^3.0.70`
- `@ai-sdk/openai: ^3.0.34`
- `@ai-sdk/google: ^3.0.31`
- `@ai-sdk/amazon-bedrock: ^4.0.77`
- `@ai-sdk/google-vertex: ^4.0.80`

见 `package.json:48-77`。

当前 Native Runtime 已经在用 AI SDK，但刻意采用手写 loop：

- `agent-loop.ts:1-10` 说明它用 `streamText()`，但手动 while-loop，而不是 `maxSteps / stopWhen`。
- `agent-loop.ts:161-200` 在模型调用前同步 MCP、组装工具、注入 permission context。
- `agent-loop.ts:221-272` 创建模型、从 DB 加载历史、发 `status` / `rewind_point`、做 checkpoint。
- `agent-loop.ts:284-491` 每步构造 providerOptions、处理 Opus/Fable thinking/effort 兼容、调用 `streamText()`。
- `agent-loop.ts:498-606` 把 `fullStream` 映射到 CodePilot SSE，并更新下一轮 messages。

这说明“AI SDK 内核”已经存在，真正复杂的是 CodePilot 产品层插桩：权限、DB、SSE、MCP、context accounting、rewind/checkpoint、provider compat。

当前 Runtime 外壳是 CodePilot 自定义合约：

- `runtime/types.ts:11-40` 定义 `AgentRuntime.stream()` 返回 CodePilot SSE `ReadableStream<string>`。
- `runtime/types.ts:47-86` 把 provider、model capabilities、MCP、permissions、runtimeOptions 作为跨 runtime 输入。

当前 Codex Runtime 不是 AI SDK Harness，而是直连 Codex app-server：

- `codex/runtime.ts:1-31` 明确把 CodePilot `AgentRuntime` 接到 Codex app-server JSON-RPC。
- `codex/runtime.ts:100-207` 把 canonical runtime events 映射回 CodePilot SSE。
- `codex/runtime.ts:51-91` 已接入 app-server、effort clamp、event mapper、media import、approval bridge、provider proxy、MCP config、dynamic tool bridge、elicitation。

构建链路还没到 Node 22：

- `package.json:125` 仍是 `@types/node: ^20`。
- `scripts/build-electron.mjs:35-39` Electron production esbuild target 是 `node18`。
- `scripts/build-electron-dev.mjs:33-37` Electron dev esbuild target 是 `node20`。
- `.github/workflows/build.yml:79-82`, `:158-161`, `:220-223` 均使用 Node 20。
- `.github/workflows/preview-build.yml:66-68` 也使用 Node 20。

本机 `node -v` 是 `v22.22.0`，但发布链路未切换前，不能把 AI SDK 7 当作无门槛升级。

## 能直接用吗

### Native Runtime：可以用，但不能直接替换

AI SDK 7 `ToolLoopAgent` 可以覆盖一部分当前手写 loop 的样板：

- `stopWhen` / `isStepCount` 替代部分 `while (step < maxSteps)`。
- `toolApproval` 可表达当前 `checkPermission + permission_request` 的策略。
- `runtimeContext` / `toolsContext` 可替代部分闭包传参，尤其适合 providerId/sessionId/workspacePath/requestId。
- `onStart/onStepStart/onToolExecutionStart/onToolExecutionEnd/onStepEnd/onEnd` 可替代一部分手动 event accounting 和 telemetry。
- timeout 支持 total/step/chunk/tool 多层预算，和当前 idle/liveness guardrail 可以对齐。

但以下 CodePilot 语义仍需要自己保留：

- CodePilot SSE event shape。
- DB message/history loading and persistence。
- `rewind_point` + file checkpoint。
- Permission registry 和 UI round-trip。
- Runtime context accounting snapshot。
- Provider resolver/runtime compatibility matrix。
- Built-in tool media side channel。
- Plan mode active tool gating。
- Third-party proxy thinking/effort 降级提示。

推荐做法：先做 `ToolLoopAgent` POC，目标不是删 `agent-loop.ts`，而是证明它能在 CodePilot 外壳下发出完全等价的 SSE、permission、usage、context accounting。

### Codex Runtime：不建议迁到 `@ai-sdk/harness-codex`

理由：

- 官方 `HarnessAgent` 文档要求 core harness 包、adapter、sandbox provider；Claude Code/Codex 这类 bridge-backed harness 要用 real network sandbox，例如 `@ai-sdk/sandbox-vercel`。
- `HarnessAgent` 的 message/history 语义是 session owns native history；应用要 persist/resume harness session，而不是重放完整历史。这和 CodePilot 目前 session-store + app-server thread/ref 语义不同。
- 官方 Harness Adapters matrix 显示 Codex adapter 支持 custom tools/skills，但 built-in tool approval 不支持。CodePilot 现在已经有 `approval-bridge`、MCP elicitation、dynamic tool bridge 等本地控制面；迁移会有权限倒退风险。
- 现有 app-server 路径已经覆盖 thread start/resume、event mapping、proxy 注入、image/media、MCP 注入、elicitation、interrupt、context accounting，且和 CodePilot UI/SSE tightly integrated。

`@ai-sdk/harness-codex` 值得做独立 POC 的场景是：未来想统一展示“外部 harness 列表 / sandboxed runs / session parking”，或者想借 AI SDK Harness 的 cross-harness abstraction 支持 OpenCode/Pi/Deep Agents。不是当前 Codex Runtime 的替代优先级。

### Claude Code SDK Runtime：可 POC，不应先替换

Claude Code HarnessAgent 支持 built-in tool approval，这比 Codex adapter 好。但它仍然要求 sandbox bridge，并且 session lifecycle/resume semantics 和当前 `@anthropic-ai/claude-agent-sdk` 路径不同。

CodePilot 当前 SDK path 还有大量历史兼容逻辑、provider/env 注入、permission UI、resume error handling。直接迁移风险高，优先级低于 Native Runtime 升级。

### WorkflowAgent：适合未来云端 durable agent，不适合当前桌面主链路

WorkflowAgent 解决的是 process restart/deploy interruption/delayed approvals。它依赖 Workflow runtime，把 tool 作为 workflow step durable retry，并通过 workflow writable stream 输出。

CodePilot 是本地 Electron + SQLite + long-lived process；主链路需要本地文件/权限/GUI 状态，不需要先引入 Vercel Workflow runtime。可借鉴：

- durable approval 的产品语义；
- per-tool step observability；
- resumable stream 的 API 形状；
- `needsApproval` 对工具定义的表达方式。

如果未来做远程云端 agent runner，再重新评估。

## 值得采纳的新能力

### P0：Node 22 / AI SDK 7 upgrade spike

先单独开 spike，验证：

- Next 16 + Electron 40 + packaged app 在 Node 22 toolchain 下构建。
- `.github/workflows/*` Node 22 后 native module rebuild 是否稳定，尤其 better-sqlite3。
- esbuild target 从 node18/node20 升到 node22 后 Electron main/preload 是否正常。
- `npm run test`、`npm run electron:build`、mac/win package smoke。

没有这个基线，后续所有 AI SDK 7 能力都卡住。

### P1：Provider package 升级和 reasoning/effort POC

当前 Native Runtime 对 Opus 4.7+ effort 有显式 guard，因为 `@ai-sdk/anthropic@3.0.70` 会带旧 beta header。升级到 AI SDK 7 对应的 provider 包（例如当前 `@ai-sdk/anthropic@4.0.1`）后需要 POC：

- Anthropic official endpoint 是否不再发送 deprecated beta。
- Third-party Anthropic-compatible proxy 是否仍需降级 effort/adaptive thinking。
- `reasoning` 标准参数是否能替代部分 providerOptions 分支。
- OpenAI Responses reasoning options 是否能统一。

验收：真实请求日志脱敏后确认 headers/body；provider-resolver/runtime-compat 回归；Opus/Fable 语义提示不回归。

### P1：ToolLoopAgent under CodePilot SSE adapter POC

建一个并行实验文件，不改默认 runtime：

- 输入同 `AgentLoopOptions`。
- 使用现有 `createModel()` 和 `assembleTools()`。
- 用 `ToolLoopAgent.stream()` 或 v7 `streamText()` 新事件流映射回现有 SSE。
- 覆盖 permission request、tool result media、usage/context accounting、abort、empty response、plan activeTools。

通过后再评估是否将 `agent-loop.ts` 的手动 step loop 收敛到 `ToolLoopAgent`。

### P1：MCP client/API 差距 POC

AI SDK 7 `@ai-sdk/mcp` 可作为未来替换 `mcp-tool-adapter.ts` 的候选，但不能直接替换 `mcp-connection-manager`。

建议 POC：

- stdio 本地 server conversion 是否覆盖现有 schema。
- HTTP/SSE transport 是否可简化远程 MCP。
- `structuredContent` + outputSchema 是否能提升 widget/dashboard/media tool result 类型安全。
- elicitation handler 是否能对齐现有 Codex MCP elicitation policy。
- 通知、session persistence、resumable stream 的缺口是否仍要保留自建 manager。

### P2：Tool approvals/HMAC 设计借鉴

AI SDK 7 的 HMAC-signed tool approval 很适合参考，但 CodePilot 现有 approval 是 server-side pending registry + DB 状态，不是完全 client-replayed approval。

建议作为安全增强而非迁移前置：

- 对 permission_request 记录加 signature / nonce / expiry。
- approve/deny API fail-closed 校验 toolName/toolInput/toolCallId。
- 覆盖超时、重复提交、改 input 后 replay。

### P2：Provider files / skill uploads

Provider files/skills 可减少大文件和 skill bundle 重复上传。可用场景：

- 大 PDF/image/dataset 的多步任务。
- Anthropic provider-managed skill references。
- 未来长上下文和上下文成本优化。

风险：

- 需要 provider capability detection。
- 上传对象的生命周期/删除/隐私需要 UI 说明。
- 必须遵守“真实 source breadcrumb”，不能把 provider reference 当成本/上下文真实值来伪造展示。

### P2：Telemetry / DevTools

DevTools 仅 local development，官方也提醒不要生产使用。可作为 `CODEPILOT_AI_SDK_DEVTOOLS=1` 的本地诊断开关：

- 自动捕获 AI SDK calls、steps、tool calls、raw provider data。
- 数据落 `.devtools/generations.json`，含 prompt/tool result/API body，必须 gitignore 且默认关闭。

生产 observability 可以后续评估 v7 telemetry integration，但需要先过日志脱敏和隐私边界审查。

### P3：MCP Apps / Realtime / Video

这些对 CodePilot 有产品想象空间，但不是 Runtime 迁移前置：

- MCP Apps 可作为未来 dashboard/widget 交互容器调研。
- Realtime voice 可对接远程控制/IM 方向。
- Video generation 和现有 media gallery 相关，但独立于 Runtime。

## 不建议现在做的事

- 不要把 `codexRuntime` 直接换成 `@ai-sdk/harness-codex`。
- 不要为了 AI SDK Harness 引入 Vercel sandbox 到本地桌面主链路。
- 不要把 `WorkflowAgent` 接进 chat 主路径。
- 不要绕过现有 `AgentRuntime` 和 Runtime Contract，让 UI 直接消费 AI SDK UIMessage。
- 不要在未验证 headers/body 的情况下删除 Opus/Fable effort/thinking guard。
- 不要启用 DevTools/telemetry 到生产包。

## 建议执行清单给 Claude Code

先写明争议：用户的直觉是“AI SDK 7 更新了，也许 Runtime 可以直接用”。调研结论是“Native Runtime 可以逐步吸收，Codex/Claude Harness 不应直接替换”。原因不是 AI SDK 7 不好，而是 CodePilot 的 Runtime 是产品合约层，AI SDK 7 提供的是 agent/model/harness primitives；两者层级不同。

推荐顺序：

1. 建 `docs/exec-plans/active/ai-sdk-7-runtime-adoption.md`，把本调研拆成 P0/P1/P2。
2. P0 只做 Node 22 + AI SDK 7 dependency spike，禁止同时重构 Runtime。
3. P1 做 `@ai-sdk/anthropic` v7 request-shape POC，确认 effort/reasoning/header。
4. P1 做 `ToolLoopAgent` side-by-side native runtime POC，输出 SSE parity test。
5. P1/P2 做 `@ai-sdk/mcp` adapter POC，确认能否替换部分 `mcp-tool-adapter`。
6. 通过上述 POC 后再评估 Runtime 默认实现迁移；未通过前保留当前 `agent-loop.ts`。

## 最小回归测试矩阵

- `npm run test`
- provider resolver/runtime compatibility unit tests
- native runtime event contract tests
- permission allowlist/permission registry tests
- MCP loader/connection tests
- Codex runtime proxy/MCP/approval tests
- 手动或 smoke：Native Runtime 文本、tool call、permission approve/deny、abort、plan mode、media tool result
- 如果改 Node/Electron build：`npm run electron:build` + mac/win packaged native module smoke

## Open Questions

- Electron 40 bundled Node 与 AI SDK 7 Node `>=22` 的实际运行要求是否完全满足，尤其 packaged app 的 standalone server path。
- AI SDK 7 provider packages 对 Anthropic beta headers、OpenAI Responses、third-party OpenAI-compatible providers 的 request shape 是否和当前兼容矩阵一致。
- `ToolLoopAgent` 的 approval request/resume shape 能否无损映射到现有 `permission_request` SSE 和 DB registry。
- `@ai-sdk/mcp` 轻量 client 的 notification 缺口是否影响当前内置 MCP / Codex MCP injection。
- Provider file/skill upload 的引用生命周期如何在本地 DB 表达，是否需要新 schema。
