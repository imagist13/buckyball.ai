> 产品思考见 [docs/insights/decouple-native-runtime.md](../insights/decouple-native-runtime.md)

# 脱离 Claude Code — Native Agent Runtime 技术交接

## 概述

CodePilot 原来完全依赖 `@anthropic-ai/claude-agent-sdk`（Claude Code CLI 子进程）驱动 AI 对话。本次重构引入 **Native Runtime**（基于 Vercel AI SDK），使 CodePilot 无需安装 Claude Code CLI 即可完整运行，同时保留 SDK Runtime 作为可选增强路径。

## 架构

```
用户输入
  → /api/chat (route.ts)
    → streamClaude() (claude-client.ts)
      → resolveRuntime() 选择 runtime
        ├─ NativeRuntime (ai-provider + agent-loop + builtin-tools + MCP)
        └─ SdkRuntime (claude-agent-sdk Query subprocess)
      → runtime.stream(options) → ReadableStream<SSE>
    → 前端 useSSEStream 消费
```

### Runtime 选择逻辑

`resolveRuntime()` in `runtime/registry.ts`:

| 优先级 | 条件 | 结果 |
|--------|------|------|
| 0 | `cli_enabled=false` | 强制 Native |
| 1 | `agent_runtime=native` | Native |
| 1 | `agent_runtime=claude-code-sdk` | SDK（如可用） |
| 2 | `auto` + SDK 可用 | SDK |
| 2 | `auto` + SDK 不可用 | Native |

特殊：OpenAI OAuth provider → 强制 Native（`claude-client.ts` 里拦截）

`predictNativeRuntime()` 是同步版本，供 MCP loading 预判使用（chat route + bridge 共用）。

### Native Runtime 核心模块

| 模块 | 文件 | 职责 |
|------|------|------|
| AI Provider | `ai-provider.ts` | 从 ResolvedProvider 创建 Vercel AI SDK LanguageModel + middleware 管线 |
| Agent Loop | `agent-loop.ts` | 手动 while 循环 streamText()，权限检查、SSE 发射、doom loop 检测 |
| Agent Tools | `agent-tools.ts` | 工具组装：8 核心工具 + builtin-tools + MCP 工具 + 权限包装 |
| System Prompt | `agent-system-prompt.ts` | 多模块拼装：身份、任务哲学、工具指引、环境信息、CLAUDE.md |
| Message Builder | `message-builder.ts` | DB → CoreMessage[]，处理附件重建、tool_use/result 拆分、轮替保证 |
| File Checkpoint | `file-checkpoint.ts` | 文件快照（修改前捕获内容），rewind 时恢复 |
| Context Pruner | `context-pruner.ts` | 剪裁旧 tool_result 内容，降低 token 消耗 |
| MCP Manager | `mcp-connection-manager.ts` | 外部 MCP server 连接生命周期管理 |
| MCP Adapter | `mcp-tool-adapter.ts` | MCP tool → AI SDK dynamicTool 转换 |
| Permission | `permission-checker.ts` | 规则引擎：explore/normal/trust 三级模式 |
| Builtin Tools | `builtin-tools/*.ts` | 6 组内置工具（notification/memory/dashboard/media/widget/cli-tools） |

### OpenAI Codex API 集成

| 组件 | 文件 | 说明 |
|------|------|------|
| OAuth 流程 | `openai-oauth.ts` + `openai-oauth-manager.ts` | PKCE OAuth + token 管理 + 本地 callback server |
| Provider 解析 | `provider-resolver.ts` | `openai-oauth` 虚拟 provider，返回 Codex base URL |
| 模型创建 | `ai-provider.ts` | custom fetch 拦截器重写 URL + 注入 OAuth Bearer |
| Agent Loop | `agent-loop.ts` | 通过 `providerOptions.openai` 传 instructions/reasoningEffort/textVerbosity |

Codex API endpoint: `https://chatgpt.com/backend-api/codex/responses`（从 Codex CLI 源码确认）

### AI SDK 特性接入

| 特性 | 状态 | 用途 |
|------|------|------|
| `activeTools` | ✅ | plan 模式限制只读工具 |
| `toolChoice` | ✅ | auto/none 自动切换 |
| `onStepFinish` | ✅ | token 统计 + SSE 步骤进度 |
| `onAbort` | ✅ | 中断清理 |
| `repairToolCall` | ✅ | 无效 tool call 自动修复 |
| `defaultSettingsMiddleware` | ✅ | 跨 provider 默认设置 |
| `extractReasoningMiddleware` | ✅ | DeepSeek R1 thinking 提取 |
| `wrapLanguageModel` | ✅ | middleware 管线 |
| `dynamicTool` | ✅ | MCP 工具运行时注册 |

### DB 变更

| 表 | 变更 | 说明 |
|----|------|------|
| `channel_bindings` | 新增 `provider_id` 列 | per-binding provider override |
| `settings` | `agent_runtime` 键 | auto / native / claude-code-sdk |

### 关键设计决策

1. **手动 while 循环而非 AI SDK maxSteps/stopWhen** — 需要在每步之间做权限检查、DB 持久化、doom loop 检测
2. **文件快照用内存而非 git stash** — git checkout HEAD 会丢失会话前的未提交修改
3. **消息去重用 role 检查而非内容匹配** — chat route 总是先存 DB 再调 runtime，最后一条 user 消息就是当前 prompt
4. **autoTrigger 总是追加** — autoTrigger 不存 DB，必须由 agent-loop 自行追加
5. **所有 builtin tools 全量注册** — 29 个工具在模型承载范围内，不做 keyword gating
6. **codepilot_* 工具跳过权限检查** — 内置可信工具，只有 Write/Edit/Bash/Agent 和外部 MCP 需要授权

### 路由 SDK 依赖清理

| 路由 | 原依赖 | 现状 |
|------|--------|------|
| interrupt | `conversation.interrupt()` | 双路径：native AbortController + SDK conversation |
| rewind | `conversation.rewindFiles()` | 双路径：有 SDK conversation 走 SDK，否则 native checkpoint |
| model | `conversation.setModel()` | 纯 DB 驱动 |
| mode | `conversation.setPermissionMode()` | 纯 DB 驱动 |
| structured | SDK `query()` | Vercel AI SDK `generateText + Output.object()` |
| permission | SDK types | 纯 `permission-registry.ts` |
| toggle/reconnect | `conversation.toggleMcpServer()` | `mcp-connection-manager` 直接操作 |

### 前端变更

| 组件 | 变更 |
|------|------|
| `CliSettingsSection` | 三选一 Agent 内核选择器（自动/AI SDK/Claude Code），去掉独立 CLI 开关 |
| `RuntimeBadge` | 输入框下方显示当前 Agent 内核，hover 解释，点击跳转设置 |
| `ProviderManager` | OpenAI OAuth 登录/登出 + 错误反馈 |
| `FeatureAnnouncementDialog` | 首次更新通知，解释新功能 |

## 验证边界

### 已验证（单测覆盖，738 tests passing）

| 模块 | 覆盖方式 | 说明 |
|------|---------|------|
| file-checkpoint | 真实导入测试 | create/record/restore/clear 全路径 |
| message-builder | 真实导入测试 | buildCoreMessages 含附件重建、轮替合并 |
| structured-output | 真实导入测试 | AI SDK Output.object 提取 + 回退 |
| provider-resolver | 真实导入测试 | 多 provider 场景解析（原有 test） |
| runtime-selection | 镜像逻辑测试 | predictNativeRuntime + resolveRuntime 决策树 |
| message-dedup | 镜像逻辑测试 | autoTrigger / 空历史 / multipart 边界 |
| OAuth status | 镜像逻辑测试 | 过期/刷新/buffer 边界（真实 getOAuthStatus 依赖宿主 DB 状态，不可作为稳定单测） |

### 未验证（需 smoke/e2e/CDP 补齐）

| 场景 | 风险等级 | 说明 |
|------|---------|------|
| Runtime 切换后立即生效 | P1 | 设置页切换 → 下条消息用正确 runtime |
| OpenAI OAuth 完整流程 | P1 | 登录 → 选模型 → 对话 → 工具调用 |
| MCP enable/disable 即时重连 | P1 | toggle 路由 → 下条消息有/没有 MCP 工具 |
| 带附件消息多轮 native | P1 | 上传图片 → 追问 → 历史回放含附件 |
| SDK ↔ Native 切换后 rewind | P2 | 切换 runtime 后 rewind 走对路径 |
| SDK 会话 interrupt | P2 | Claude Code 运行中 → 点停止 → CLI 进程实际停 |
| Bridge + native + MCP | P2 | Telegram 通道 → native runtime → 完整 MCP 工具 |
| 设置页 UI 交互 | P2 | CliSettingsSection / ProviderManager / RuntimeBadge 渲染 |

## 剩余风险

| 风险 | 说明 | 缓解 |
|------|------|------|
| **镜像测试失真** | agent-loop 去重、runtime 选择的测试是镜像逻辑，非真实导入 | 标注了 "mirrors X — update if source changes"，后续应补集成测试 |
| **Codex API reasoning** | 当前传 `reasoningEffort: 'medium'` + `textVerbosity: 'medium'`，未传 `reasoningSummary`，thinking 展示未调通 | 需确认 Codex endpoint 的 reasoning summary 返回格式，或改用 Codex CLI 的 endpoint 路径 |
| **Plugin 系统未对齐** | Native 路径没有 Claude Code 的 plugin loader | builtin-tools + MCP 覆盖了已知 plugin 能力，但未显式验证 |
| **连续两个 user turn** | enforceAlternation 合并逻辑已修复 multipart，但极端场景（3+ 连续 user）未专项测试 | 实际场景不太可能出现 |
| **SDK 路由双路径** | interrupt/rewind 有双路径，SDK path 依赖 conversation-registry | SDK 路径是原有逻辑未改动，回归风险低 |
