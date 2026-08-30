# 脱离 Claude Code 依赖 — 自建 Agent Runtime

> 创建时间：2026-04-06
> 最后更新：2026-04-07（Phase 1-7 骨架完成 + ClaudeCodeCompatAdapter 验证通过）
> 调研文档：[agent-loop](../../research/agent-loop-self-built.md) · [cli-tools](../../research/cli-tools-implementation.md) · [mcp](../../research/mcp-system-decoupling.md) · [skills](../../research/skills-system-independent.md) · [permissions](../../research/permission-system-decoupling.md) · [sessions](../../research/session-management-and-context-compaction.md) · [sub-agents](../../research/sub-agent-system.md)

## 目标

**让 CodePilot 在用户没有安装 Claude Code 的情况下，配置 API Key 即可完整使用。**

保留 Agent SDK 作为可选增强路径（用户装了 Claude Code 可继续走 SDK），但默认路径完全自主。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 调研 + 执行计划 + 事实性复核 | ✅ 已完成 | 7 份调研报告 + 7 份复核报告 |
| Phase 1 | Provider 抽象层 + Agent Loop + Runtime 接口 + 会话恢复 | ✅ 已完成 | ai-provider / agent-loop / runtime / message-builder + OpenAI Codex API |
| Phase 2 | 工具系统（8 个工具）+ 权限骨架 | ✅ 已完成 | 权限已接入 agent-loop |
| Phase 3 | MCP 连接管理器 + 工具适配器 | ✅ 已完成 | native-runtime 同步 mcpServers，6/6 builtin-tools 迁移 |
| Phase 4 | 权限规则引擎 + Bash 验证 | ✅ 已完成 | agent-loop 调用 permission-checker |
| Phase 5 | 上下文压缩 | ✅ 已完成 | pruneOldToolResults 已接入 agent-loop |
| Phase 6 | Skills 系统 | ✅ 已完成 | 完整解析/发现/执行 + Skill tool 注册 |
| Phase 7 | 子 Agent | ✅ 已完成 | 权限继承 + SSE 转发 |
| Transport | Provider Transport 层 + ClaudeCodeCompatAdapter | ✅ 已验证 | 智谱/Aiberm 等第三方代理可用 |
## 核心产品原则

**双 Runtime 共存，用户无感切换：**
- 输入框下方有模式切换（代码/计划等）
- 没有安装 Claude Code → 默认 Native Runtime（AI SDK），所有能力自主实现
- 安装了 Claude Code → 可切换到 Claude Code Runtime，获得 CLI 的完整能力
- **关键约束：所有用户可见能力（工具、MCP、权限、Skills）必须在两个 Runtime 下都可用**
- 内置 MCP Server 的 22 个 tools 不能只绑在 SDK 注册方式上
- 正确做法：tool handler 提取为共享层，两个 Runtime 各自注册

---

| **闭环 A** | **权限审批闭环** | ✅ 已完成 | agent-loop 调用 permission-checker → SSE permission_request → 前端审批 → 回调 |
| **闭环 B** | **SDK 遗留路由替换** | ✅ 已完成 | model/mode/interrupt/rewind/structured/permission 全部脱离 SDK |
| **闭环 C** | **MCP 全链路替换** | ✅ 已完成 | native-runtime 同步 mcpServers + 6/6 builtin-tools 迁移 + toggle 即时重连 |
| **闭环 D** | **深度能力补齐** | ✅ 已完成 | CLAUDE.md 注入 + 上下文压缩 + Skills 完整 + 子 Agent 权限 + ChannelBinding providerId |
| Phase 8 | 测试 + 文档同步 + 收尾 | ✅ 已完成 | 测试对齐新实现 + 计划文档同步 |

## 剩余收尾项

| # | 项目 | 优先级 | 状态 |
|---|------|--------|------|
| 1 | 内置 MCP Server 迁移 | P0 | ✅ 6/7 完成 | notification(4)+widget(1)+dashboard(5)+media(2)+memory(3)=15 tools。cli-tools(6) 待后续 |
| 2 | Rewind file checkpointing | P1 | ✅ 完成 | file-checkpoint.ts git-based。Write/Edit 记录修改，rewind route 还原 |
| 3 | Event bus 完整集成 | P1 | ✅ 完成 | 8 事件类型，agent-loop(session:start/end) + agent-tools(tool:pre/post + permission) |
| 4 | settingSources 层次化 | P2 | ✅ 完成 | 4 级优先级 user>project>workspace>parent + git context 注入 |
| 5 | Bridge 适配 | P2 | ✅ 完成 | provider 解析 + 错误处理已修复（2026-04-07） |
| 6 | Sub-Agent 权限继承 | P2 | ✅ 完成 | Agent tool 继承父 permissionContext + 转发 permission_request SSE |

## 未完成项

### ~~1. cli-tools 内置 MCP 迁移（P1）~~ ✅ 2026-04-07 已完成
6 个工具（758 行）从 SDK createSdkMcpServer 迁移到 `builtin-tools/cli-tools.ts`，注册进 index.ts（keyword-gated）。

### ~~2. Structured output 端到端验证（P1）~~ ✅ 已完成
route.ts 使用 `generateText({ output: Output.object() })`。单测已对齐新实现。

### ~~3. MCP toggle route 的 enable 路径（P2）~~ ✅ 2026-04-07 已完成
toggle enable 时从 mcp-loader 读取 config 后调 `connectServer(name, config)` 即时重连。

### ~~4. 设置页新增 Agent Runtime 切换 UI（P1）~~ ✅ 2026-04-07 已完成
设置 → Claude CLI 区域顶部，三选一下拉框：自动 / 原生 Runtime / Claude Code SDK。保存到 DB `agent_runtime` setting，即时生效（下次消息使用新 runtime）。Runtime 选择与 CLI 开关解耦，不再互相硬编码。

### ~~5. ChannelBinding 加 providerId（P2）~~ ✅ 2026-04-07 已完成
DB channel_bindings 表新增 provider_id 列 + ALTER TABLE 迁移。createBinding() 写入默认 provider，updateBinding() 支持更新 providerId。conversation-engine 优先读 binding.providerId。

### 6. 专项测试扩充（P2）— 部分完成
structured output 单测已对齐新实现。还需补充：
- bridge provider 解析的 fallback 测试
- file-checkpoint create/restore 测试
- builtin-tools registration 条件（always/workspace/keywords）测试

## 已修复项（2026-04-07）

### Bridge provider 解析 bug（原 P0）
**修复内容：**
1. **provider-resolver.ts**：session/fallback 链中的 inactive provider 自动跳过，fallback 到 default → 任意 active provider。显式 providerId 仍尊重。`resolveForClaudeCode()` 同步修复。
2. **conversation-engine.ts**：新增 protocol/model 不兼容检测（google protocol + sonnet model → 立即报错）
3. **bridge-manager.ts**：`handleMessage()` 新增 catch 块，processMessage 抛异常时将错误发送给用户而非静默吞掉

## 决策日志

- 2026-04-06: 选择 **路线 B（完全自建 Agent Runtime）** 而非渐进式。理由：目标就是"安装即用"，Vercel AI SDK 已在用，OpenCode 证明方案可行。
- 2026-04-06: Agent Loop **不使用 Vercel AI SDK 的 maxSteps**，自建 while 循环。理由：需要在每步之间做权限检查、DB 持久化、context overflow 检测、doom loop 防护。（已验证：OpenCode 采用两层 while 循环，外层 `prompt.ts` 控制步数，内层 `processor.ts` 消费 stream，均不使用 maxSteps。）
- 2026-04-06: 内置 MCP Server **直接转为 Vercel AI SDK tool**，不保留 MCP 协议包装。理由：**22** 个 tools 都是纯函数调用，无需 MCP 的 resources/prompts 高级特性。（复核修正：实际 22 个 tools，非 21 个——notification 有 5 个 tool 含 hatch_buddy。）
- 2026-04-06: 权限系统采用 **三级模式（explore/normal/trust）+ OpenCode 风格规则引擎**。理由：Claude Code 有 7 种模式（5 外部 + 2 内部）过于复杂。（复核修正：Claude Code 实际有 7 种模式而非 6 种——含内部的 `auto` 和 `bubble`。）
- 2026-04-06: Vercel AI SDK 是最优技术选择。对比了直接用 `@anthropic-ai/sdk`（仅单 Provider）、各原生 SDK（需自建统一层，维护极高）、LangChain（过度设计），Vercel AI SDK 在多 Provider、流式、tool use、thinking 支持上最均衡，且 CodePilot 已在 `text-generator.ts` 中使用。
- 2026-04-06（复核后）: **权限核心提前到 Phase 2** 与工具同期。理由：工具的 `execute` 内部调用 `ctx.checkPermission()`，如果权限系统不存在，工具无法工作。
- 2026-04-06（复核后）: **会话恢复基础并入 Phase 1**。理由：Agent Loop 需要从 DB 加载历史消息续聊，`message-builder.ts` 是 Phase 1 的前置依赖。
- 2026-04-06（复核后）: **双路径切换最多保留 2 个版本周期**，之后默认自建路径。切换通过设置项控制（非自动检测 CLI）。
- 2026-04-06（终审）: Vercel AI SDK v6 中 **`maxSteps` 已移除**，替换为 `stopWhen: stepCountIs(N)`。我们自建 while 循环不受影响，但代码中引用 maxSteps 需改用 stopWhen。
- 2026-04-06（终审）: Vercel AI SDK v6 中 `tool()` 的参数字段名为 **`inputSchema`**（非 `parameters`），接受 Zod schema / JSON Schema via `jsonSchema()` / standard schemas。
- 2026-04-06（终审）: `generateObject()` 在 v6 中 **已 deprecated**，结构化输出改用 `generateText({ output: ... })` 或 `streamText({ output: ... })`。Phase 8 structured route 需要用新方式。
- 2026-04-06（终审）: **Rewind（文件回退）子系统在原计划中完全遗漏**。当前依赖 SDK 的 `Query.rewindFiles()`，自建路径需自行实现 file checkpointing + git-based rewind。纳入 Phase 2。
- 2026-04-06（终审）: **Interrupt 路由**（`/api/chat/interrupt`）依赖 SDK `Query.interrupt()`，自建路径改为 `AbortController.abort()`。纳入 Phase 1。
- 2026-04-06（终审）: **DB 消息格式复杂**：tool_use 和 tool_result 被嵌入同一条 assistant 记录的 JSON 数组中（非独立 user/tool 消息），message-builder 需要拆分重组为 assistant/tool 交替结构。
- 2026-04-06（终审）: **Anthropic thinking** 通过 `providerOptions.anthropic.thinking` 传递（支持 adaptive/enabled/disabled），effort 通过 `providerOptions.anthropic.effort` 传递。Beta header 通过 `providerOptions.anthropic.anthropicBeta` 传递。
- 2026-04-06（Runtime 层）: 新增 **AgentRuntime 接口**（4 个方法: stream/interrupt/isAvailable/dispose）。`streamClaude()` 从 500+ 行重构为 ~30 行薄分发层，通过 `resolveRuntime()` 路由到 NativeRuntime 或 SdkRuntime。SDK 路径代码提取为 `streamClaudeSdk()`。未来 Codex/Gemini CLI 只需新增 Runtime 实现 + 注册。
- 2026-04-06（Transport 层 — 测试后确立）: **Provider transport capability 和 Runtime 选择必须分离。** 测试发现大量中国代理（智谱/Kimi/MiniMax 等，catalog 已标记 `sdkProxyOnly: true`）不实现标准 Anthropic Messages API，而是兼容"Claude Code 发请求的行为组合"。`@ai-sdk/anthropic` 的 `createAnthropic()` 无法与这些代理通信（返回空响应或 404）。正确架构是在 Runtime 下新增 **Provider Transport** 层：
  - `standard-messages`: 标准 Anthropic API / OpenRouter → 用 `@ai-sdk/anthropic`
  - `claude-code-compat`: sdkProxyOnly 代理 → 用自建 ClaudeCodeCompatAdapter（模仿 Claude Code 的请求格式）或降级到 SdkRuntime
  - `cloud-managed`: Bedrock / Vertex → 用对应 AI SDK provider
  路由策略：`claude-code-compat` + 有 CLI → SdkRuntime；+ 无 CLI + 有 adapter → NativeRuntime + adapter；+ 都没有 → 明确报错。

---

## 事实性复核摘要（Phase 0.5）

7 个方向的复核结果汇总。所有断言已交叉验证，以下是需要修正的问题：

### 已修正的错误

| 原始断言 | 复核结果 | 修正 |
|---------|---------|------|
| 内置 MCP 共 21 个 tools | 实际 **22** 个（notification 有 5 个 tool 含 `hatch_buddy`） | 已修正 |
| Claude Code 有 6 种权限模式 | 实际 **7** 种（5 外部 + `auto` + `bubble`） | 已修正 |
| "7 处 keyword-gating" | 实际只有 **4 处**用 keyword regex，memory 用 workspace 条件，notify 无条件 | 已修正 |
| Edit 用"8 层 Replacer" | OpenCode 实际 **9 层**（含 MultiOccurrenceReplacer） | 已修正 |
| 工具估算 ~1,500 行 | OpenCode 8 个核心工具合计 **1,909 行**（不含基础设施） | 已修正为 2,500-3,000 |
| 总代码量 4,000-5,000 行 | 低估 40-60%，实际约 **6,500-8,000 行** | 已修正 |
| Vercel AI SDK `tool()` 用 `parameters` | 新版 AI SDK 字段名为 **`inputSchema`**（需确认项目版本） | 需验证 |
| `agent-sdk-agents.ts` "已有 agent 定义" | 实际是**空的注册表框架**，无实际定义 | 已修正 |
| OpenCode 有 5 种内置 Agent | 实际 **7 种**（含隐藏的 title 和 summary） | 已记录 |

### 新发现的隐性工作量

| 问题 | 影响 | 对策 |
|------|------|------|
| **SSE 适配层**：fullStream 事件需映射为 CodePilot 的 17 种自定义 SSE 事件，其中 `permission_request`、`tool_timeout`、`mode_changed`、`task_update`、`rewind_point`、`keep_alive`、`status`（初始化元数据）在 Vercel AI SDK 中无直接对应 | agent-loop.ts 需要额外的事件合成逻辑 | 纳入 Phase 1 |
| **遗漏的 SDK 依赖点**：`provider-doctor.ts`（健康检查）、`structured/route.ts`（结构化输出）、`mode/route.ts`（模式切换）、`agent-sdk-capabilities.ts`（能力缓存）均依赖 SDK | 这些文件需要改写或提供自建替代 | 纳入 Phase 8 |
| **DB 已存储完整 content blocks**（JSON 字符串），但 `buildFallbackContext` 展平为纯文本丢失结构 | message-builder.ts 需从 JSON 字符串还原 `{role, content}[]` 结构，而非复用 buildFallbackContext | 纳入 Phase 1 |
| **Skill frontmatter 解析不完整**：CodePilot 当前只解析 name + description，不读 allowed-tools/context/when_to_use | skill-parser.ts 需要完整解析所有 frontmatter 字段 | 纳入 Phase 6 |

### 终审发现（开工前最终验证）

#### Vercel AI SDK v6 API 变更（直接影响编码）

| 项目 | 计划中的假设 | 实际（v6.0.73） |
|------|------------|----------------|
| `tool()` 参数 | `parameters: z.object(...)` | **`inputSchema: z.object(...)`** |
| 多步循环 | `maxSteps: N` | **`stopWhen: stepCountIs(N)`**（我们不用，自建 while 循环） |
| 结构化输出 | `generateObject()` | **deprecated**，改用 `generateText({ output: ... })` |
| Thinking | 通过 SDK Options | `providerOptions: { anthropic: { thinking: { type: 'adaptive' \| 'enabled' \| 'disabled' } } }` |
| Effort | 通过 SDK Options | `providerOptions: { anthropic: { effort: 'low' \| 'medium' \| 'high' \| 'max' } }` |
| Beta headers | SDK 自动处理 | `providerOptions: { anthropic: { anthropicBeta: ['context-1m-2025-08-07'] } }` |
| Context mgmt | SDK 内部 | `providerOptions: { anthropic: { contextManagement: { edits: [...] } } }`（SDK 级压缩） |

#### P0 遗漏（不解决 = 核心功能不可用）

| 遗漏 | 说明 | 纳入 Phase | 估计工作量 |
|------|------|-----------|-----------|
| **Rewind 子系统** | 完全未提及。SDK `Query.rewindFiles()` 实现 file checkpointing + git-based 回退。自建需：写文件前 snapshot → rewind 时 git checkout + DB 截断 | Phase 2 | 300-500 行 |
| **Interrupt 路由** | `/api/chat/interrupt` 依赖 `conversation.interrupt()`。自建改为 AbortController | Phase 1 | ~30 行 |
| **MCP toggle/reconnect 路由** | 依赖 SDK Query 的 `toggleMcpServer()` / `reconnectMcpServer()` | Phase 3 | ~60 行 |
| **Permission 路由 SDK 类型** | `permission/route.ts` + `permission-registry.ts` 导入 SDK 类型 | Phase 8 | ~50 行 |

#### P1 遗漏（不解决 = 重要功能缺失）

| 遗漏 | 说明 | 纳入 Phase |
|------|------|-----------|
| **settingSources / CLAUDE.md 加载** | SDK 自动加载 `~/.claude/settings.json` 等配置。自建需自行解析 | Phase 1 |
| **6+ 个 MCP 系统提示常量** | 每个内置 MCP Server 的 SYSTEM_PROMPT 需要迁移到 agent-system-prompt.ts | Phase 1+3 |
| **context1m beta header** | 需通过 `providerOptions.anthropic.anthropicBeta` 传递 | Phase 1 |
| **Model 切换路由** | `/api/chat/model` 依赖 `conversation.setModel()` | Phase 8 |
| **Bridge conversation-engine 适配** | IM 桥接路径依赖 SDK 能力 | Phase 8 |

#### P2 遗漏（不解决 = 体验下降）

| 遗漏 | 说明 |
|------|------|
| Auto-approve 规则（12 个内置 MCP 工具）未迁移到权限系统 |
| Bash 工具 stderr/stdout 流式输出到 SSE `tool_output` 未详细设计 |
| autoTrigger 标志（影响 rewind_point / DB 持久化 / 通知）未提及 |
| keyword-gating 逻辑从 claude-client.ts 迁移到 agent-tools.ts 未明确 |

#### DB 消息格式关键发现

```
messages 表 schema:
  id TEXT PK, session_id TEXT FK, role TEXT ('user'|'assistant'),
  content TEXT, created_at TEXT, token_usage TEXT, is_heartbeat_ack INTEGER

content 列存储格式:
  - 纯文本: 直接字符串
  - 结构化: JSON.stringify([{type:'text',...}, {type:'tool_use',...}, {type:'tool_result',...}])
  - 关键: tool_use 和 tool_result 混在同一条 assistant 记录的 JSON 数组中
  - parseMessageContent() 辅助函数已存在（src/types/index.ts:161）

message-builder 需要的拆分逻辑:
  DB: assistant → [{text}, {tool_use:A}, {tool_use:B}, {tool_result:A}, {tool_result:B}, {text}]
  目标: assistant[{text},{tool_use:A},{tool_use:B}] → tool[result:A] → tool[result:B] → assistant[{text}]
```

#### 完整 SSE 事件契约（17 种）

已单独验证前端 `useSSEStream.ts` 消费的完整事件列表：`text`, `thinking`, `tool_use`, `tool_result`, `tool_output`, `status`(3 变体), `result`, `error`, `permission_request`, `tool_timeout`, `mode_changed`, `task_update`, `rewind_point`, `keep_alive`, `done`。其中 7 种在 Vercel AI SDK fullStream 中无直接对应，需要 agent-loop.ts 合成。

#### SDK 导入点完整清单

17 个文件导入了 `@anthropic-ai/claude-agent-sdk`。15 个已被执行计划覆盖，2 个需补充（`permission/route.ts`、`mode/route.ts`）。另有 ~10 个文件包含 CLI 安装/升级的字符串引用（非代码依赖，收尾时适配）。

---

## Phase 1：Provider 抽象层 + Agent Loop 核心 + 会话恢复基础

**目标：** 建立一条不依赖 claude-agent-sdk 的完整聊天链路，能通过 Vercel AI SDK 调 Anthropic API、流式返回文本、支持续聊。

### 1.1 统一 Provider 创建（从 text-generator.ts 提取）

**当前状态：**
- `text-generator.ts` 已有 5 个 provider backend（anthropic/openai/google/bedrock/vertex）
- `provider-resolver.ts` 有 `toClaudeCodeEnv()` 为 SDK 子进程构建环境变量
- 两套 provider 逻辑并存

**改动：**

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/lib/ai-provider.ts` | **新建** | 统一 provider 工厂：`createAiModel(providerConfig) → LanguageModel`。从 text-generator.ts 提取 + 扩展 |
| `src/lib/provider-resolver.ts` | **修改** | 新增 `toAiSdkConfig()` 路径（返回 { provider, model, apiKey, baseUrl } 而非环境变量）；保留 `toClaudeCodeEnv()` 供 SDK 路径使用 |
| `src/lib/text-generator.ts` | **修改** | 改用 `ai-provider.ts` 创建模型实例 |

### 1.2 会话恢复（message-builder）

**关键发现（复核确认）：** DB 的 `messages.content` 列已存储完整 content blocks（含 tool_use/tool_result/thinking 的 JSON 数组字符串）。但当前 `buildFallbackContext` 将其展平为纯文本，丢失结构。

**改动：**

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/lib/message-builder.ts` | **新建** | 从 DB 加载 messages → 解析 JSON content → 重建 Vercel AI SDK `CoreMessage[]`（保留 role 交替、tool_use/tool_result 配对） |
| `src/lib/conversation-registry.ts` | **重写** | 不再跟踪 SDK Query 对象，改为跟踪活跃的 AbortController |

### 1.3 自建 Agent Loop

**核心设计（参考 OpenCode 两层循环）：**

```
agentLoop(input: AgentLoopInput): AsyncGenerator<AgentEvent>
  │
  ├─ 构建 system prompt + messages（通过 message-builder 从 DB 还原）
  │
  └─ while (step < maxSteps) {
       │
       ├─ streamText({ model, system, messages, tools, abortSignal })
       │   └─ tools = builtinTools ∪ mcpTools ∪ builtinMcpTools (条件注册)
       │
       ├─ for await (event of fullStream) {
       │     yield → SSE events (text/thinking/tool_use/tool_result/...)
       │     │
       │     case 'tool-call':
       │       → 权限检查（可能 yield permission_request）
       │       → tool.execute() 在 Vercel AI SDK 内自动调用
       │     case 'tool-result':
       │       → 持久化到 DB
       │     case 'finish-step':
       │       → 累计 usage
       │       → doom loop 检测（同一 tool 连续 3 次）
       │       → context overflow 检测
       │   }
       │
       │   // SSE 适配：合成 Vercel AI SDK 无直接对应的事件
       │   → permission_request（从权限检查逻辑合成）
       │   → status（初始化时合成 session_id/tools/plugins 元数据）
       │   → keep_alive（定时器）
       │   → rewind_point（从 prompt-level user message 合成）
       │
       ├─ if (no tool calls) break
       ├─ if (context overflow) → compact → continue
       └─ step++
     }
```

**改动：**

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/lib/agent-loop.ts` | **新建** | 核心 Agent Loop — async generator，yield SSE 格式事件（含适配层） |
| `src/lib/agent-tools.ts` | **新建** | 工具组装层 — 根据 session 模式 + 条件注册选择 tools |
| `src/lib/agent-system-prompt.ts` | **新建** | 系统提示拼装 — 替代 SDK 的 `preset: 'claude_code'` |
| `src/lib/claude-client.ts` | **修改** | `streamClaude()` 增加分支：有 Claude Code CLI → 走 SDK；无 CLI → 走 agent-loop.ts |
| `src/app/api/chat/route.ts` | **微调** | 传入 provider config 而非 env vars |

### 1.4 SSE 事件格式保持兼容

**关键（复核确认）：** 前端不需要改动，但后端 Agent Loop 需要构建完整的事件适配层。

**映射关系：**

| Agent Loop (fullStream event) | CodePilot SSE type | 说明 |
|------|------|------|
| `text-delta` | `text` | 直接映射 |
| `reasoning-delta` | `thinking` | Anthropic provider 特有 |
| `tool-call` | `tool_use` | 包含 toolName + input |
| `tool-result` | `tool_result` | 包含 result |
| tool execute 内部事件 | `tool_output` | 需自建 EventEmitter 机制 |
| `finish` | `result` | 包含 usage 统计 |
| error | `error` | 直接映射 |
| — | `permission_request` | 从权限检查逻辑合成 |
| — | `status` | 初始化时合成（session_id, tools, plugins 元数据） |
| — | `keep_alive` | 定时器发送 |
| — | `rewind_point` | 从 prompt-level user message 合成 |
| — | `mode_changed` | 从模式切换 API 合成 |
| — | `task_update` | 从任务管理系统合成 |
| — | `tool_timeout` | 从 tool execute 超时逻辑合成 |

---

## Phase 2：工具系统（8 个核心工具）+ 权限核心

**目标：** 自建编码工具 + 权限判定引擎（两者同步推进，因为工具 execute 内部依赖权限检查）。

### 工具清单与复杂度（复核修正）

| 工具 | 复杂度 | 关键依赖 | 估计代码量 |
|------|--------|---------|-----------|
| **Read** | 中 | `fs` + 行号格式化 | ~300 行 |
| **Write** | 低 | `fs` + 目录自动创建 | ~100 行 |
| **Edit** | 高 | 9 层 Replacer 级联回退（非 8 层） | ~650 行 |
| **Bash** | 高 | `child_process.spawn` + 超时 + 输出截断 + streaming | ~500 行 |
| **Glob** | 低 | `glob` (npm) 或 ripgrep `--files` | ~80 行 |
| **Grep** | 中 | ripgrep 子进程 | ~160 行 |
| **WebFetch** | 中低 | `fetch` + `turndown` HTML→MD | ~200 行 |
| **WebSearch** | 低 | Tavily/Exa API 或 provider tool | ~80 行 |
| **合计** | | | **~2,070 行** |

加上工具基础设施（registry, types, context）约 300 行 + 权限核心约 200 行 = **Phase 2 总计 ~2,570 行**。

### 工具改动

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/lib/tools/read.ts` | **新建** | 文件读取：行号、范围、图片 base64 |
| `src/lib/tools/write.ts` | **新建** | 文件写入：mkdir -p、冲突检测 |
| `src/lib/tools/edit.ts` | **新建** | 字符串替换：唯一性检查 + **9 层** fuzzy 回退 |
| `src/lib/tools/bash.ts` | **新建** | Shell 执行：超时、输出截断（1MB）、streaming output |
| `src/lib/tools/glob.ts` | **新建** | 文件模式匹配 |
| `src/lib/tools/grep.ts` | **新建** | 内容搜索：ripgrep 子进程 + 结果格式化 |
| `src/lib/tools/web-fetch.ts` | **新建** | 网页抓取：fetch + turndown |
| `src/lib/tools/web-search.ts` | **新建** | 网页搜索：Tavily/Exa API |
| `src/lib/tools/index.ts` | **新建** | 工具注册表 + ToolContext 类型定义 |
| `src/lib/permission-checker.ts` | **新建** | 权限判定核心：checkPermission(toolName, input, mode) → allow/deny/ask |

**新增依赖：** `glob`（文件搜索）、`turndown`（HTML→MD）、`diff`（Edit 回退用）

### 工具定义格式

需要确认项目当前 Vercel AI SDK 版本的 `tool()` 字段名（`parameters` vs `inputSchema`），两者在不同版本有变化。

---

## Phase 3：MCP 独立化

**目标：** MCP 客户端和内置 MCP Server 全部脱离 SDK。

### 3.1 外部 MCP 连接管理器

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/lib/mcp-connection-manager.ts` | **新建** | 连接池：connect/disconnect/sync/getTools/callTool/status |
| `src/lib/mcp-tool-adapter.ts` | **新建** | MCP Tool → Vercel AI SDK `dynamicTool()` + `jsonSchema()` 转换 |
| `src/lib/mcp-loader.ts` | **修改** | 改为向 ConnectionManager 提供配置 |
| `src/app/api/plugins/mcp/status/route.ts` | **修改** | 改为查询 ConnectionManager |

**外部 MCP Server 传输层映射：**

| 配置 type | SDK Transport | 备注 |
|-----------|--------------|------|
| `stdio` | `StdioClientTransport` | 本地进程 |
| `sse` | `SSEClientTransport` | 远程兼容 |
| `http` | `StreamableHTTPClientTransport` | 远程推荐 |
| `ws` | `WebSocketClientTransport` | SDK 也支持（复核发现） |

**Tool 命名约定：** `mcp__{serverName}__{toolName}`

### 3.2 内置 MCP Server 迁移

7 个 MCP Server（**22** 个 tools）全部转为 Vercel AI SDK tool 定义：

| 文件 | tools 数量 | 注册条件 |
|------|-----------|---------|
| `memory-search-mcp.ts` | 3 | workspace 路径条件（非 keyword） |
| `notification-mcp.ts` | **5**（含 hatch_buddy） | 无条件（always-on） |
| `cli-tools-mcp.ts` | 6 | keyword-gated |
| `dashboard-mcp.ts` | 5 | keyword-gated |
| `media-import-mcp.ts` | 1 | keyword-gated |
| `image-gen-mcp.ts` | 1 | keyword-gated |
| `widget-guidelines.ts` | 1 | keyword-gated |

---

## Phase 4：权限增强（Bash 验证 + 规则引擎）

**目标：** 在 Phase 2 的权限核心基础上，增加 Bash 安全验证和细粒度规则。

### 4.1 权限模式

| 模式 | 说明 | Read/Glob/Grep | Edit/Write | Bash |
|------|------|----------------|------------|------|
| `explore` | 只读探索（类似 Claude Code `plan` 模式，但不改变模型行为） | 自动允许 | 拒绝 | 只读命令允许 |
| `normal` | 标准模式 | 自动允许 | 自动允许 | 需确认 |
| `trust` | 全信任（需用户在设置中主动开启 + 确认对话框） | 自动允许 | 自动允许 | 自动允许 |

### 4.2 规则引擎（OpenCode 风格，已验证）

```typescript
type PermissionRule = {
  permission: string;   // 'bash' | 'edit' | 'read' | '*'
  pattern: string;      // glob pattern
  action: 'allow' | 'deny' | 'ask';
};
// 评估：findLast 语义（已验证 OpenCode 确实用 Array.findLast）
```

### 4.3 Bash 安全验证（已验证 Craft 实现）

移植 Craft Agents 的 `bash-validator.ts`（已确认使用 `bash-parser` AST）：
- 递归遍历 AST 节点（Script/Command/Pipeline/Subshell）
- 拦截管道到不安全命令、重定向、命令替换 `$()`、后台执行 `&`
- 对照编译后的 regex 白名单检查命令

### 4.4 改动

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/lib/bash-validator.ts` | **新建** | Bash 命令安全分类（AST 解析） |
| `src/lib/permission-checker.ts` | **修改** | 增加规则引擎 + 集成 bash-validator |
| `src/lib/bridge/permission-broker.ts` | **修改** | 替换 SDK 类型导入为自建类型 |

**新增依赖：** `bash-parser`

---

## Phase 5：上下文压缩（三层）

**目标：** 自建上下文管理，防止 token 溢出。

### 5.1 三层压缩策略

| 层级 | 触发条件 | 策略 |
|------|---------|------|
| **Microcompact** | 每次 streamText 调用前 | 清理旧 tool_result（>5 步前替换为摘要） |
| **Auto-compact** | 估算 token > 80% context window | LLM 生成结构化摘要替换旧消息 |
| **Reactive compact** | API 返回 context_length_exceeded | 激进压缩 + 重试（CodePilot 已有基础实现） |

**已验证（复核确认）：** Claude Code 实际有 5 种压缩（auto/micro/apiMicro/reactive/sessionMemory），报告的三层是合理的核心简化。

### 5.2 改动

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/lib/context-pruner.ts` | **新建** | Microcompact：tool_result 修剪 |
| `src/lib/context-compressor.ts` | **修改** | 已有 reactive compact（在 claude-client.ts:1366 触发），增加 auto-compact（LLM 摘要） |
| `src/lib/db.ts` | **验证** | 复核确认 content blocks 已完整存储，无需改 schema |

---

## Phase 6：Skills 系统

**目标：** 自建 Skill 解析、发现、执行系统。

### 6.1 Skill 格式

保持与 Claude Code 兼容的 SKILL.md 格式（已验证 frontmatter 字段）：

```markdown
---
name: skill-name
description: What this skill does
allowed-tools: [Read, Write, Edit, Bash]
when_to_use: When the user asks about X
context: fork           # 'inline' | 'fork'
arguments:
  - name: arg1
    description: First argument
model: claude-sonnet-4-20250514
effort: high
---

# Instructions

Skill prompt content here...
```

**关键发现（复核确认）：** CodePilot 当前 `parseSkillFrontMatter()` 只提取 `name` 和 `description`。需要完整解析所有执行语义字段。

### 6.2 改动

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/lib/skill-parser.ts` | **新建** | 完整解析 SKILL.md 所有 frontmatter 字段 |
| `src/lib/skill-discovery.ts` | **新建** | 扫描 .claude/skills/、~/.claude/skills/、~/.agents/skills/ |
| `src/lib/skill-executor.ts` | **新建** | Inline：注入 prompt + 按 allowed-tools 过滤；Fork：启动子 Agent（依赖 Phase 7） |
| `src/lib/tools/skill.ts` | **新建** | SkillTool — 让模型选择和执行 skill |
| 现有 Skill UI 组件 | **修改** | 从 `getCachedCommands` 改为查询 skill-discovery |

---

## Phase 7：子 Agent 系统

**目标：** 支持父 Agent 启动独立上下文的子 Agent。

### 7.1 设计

子 Agent = 注册为 Vercel AI SDK tool 的函数，execute 中运行独立的 `agentLoop()`（复用 Phase 1 代码）。

**注意（复核修正）：** `agent-sdk-agents.ts` 当前是空的注册表框架（无实际 Agent 定义），需要从头填充。

### 7.2 内置 Agent 定义

| Agent | 模式 | 工具限制 | 用途 |
|-------|------|---------|------|
| `explore` | subagent | Read, Glob, Grep, WebFetch, WebSearch | 快速代码探索 |
| `general` | subagent | 除 Agent 外所有工具 | 通用子任务 |

### 7.3 改动

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/lib/agent-registry.ts` | **新建** | Agent 定义注册（内置 + 自定义） |
| `src/lib/tools/agent.ts` | **新建** | AgentTool（内部复用 agent-loop.ts，不需要独立的 agent-runner.ts） |
| `src/lib/agent-sdk-agents.ts` | **重写** | 从空框架改为实际注册 explore/general Agent |

---

## Phase 8：遗漏的 SDK 依赖点 + 集成测试 + 双路径切换

**目标：** 补全所有 SDK 依赖点，两条路径可切换。

### 8.1 遗漏的 SDK 依赖点（复核发现）

| 文件 | SDK 用法 | 改写方案 |
|------|---------|---------|
| `src/lib/provider-doctor.ts` | 用 `query()` 做 Provider 健康检查 | 改用 `generateText()` 做简单 ping |
| `src/app/api/chat/structured/route.ts` | 用 `query()` + `SDKResultSuccess.structured_output` | 改用 Vercel AI SDK 的 `generateObject()` |
| `src/app/api/chat/mode/route.ts` | 用 `getConversation()` 获取 SDK Query 对象切换模式 | 改为更新自建 session 的权限模式 |
| `src/lib/agent-sdk-capabilities.ts` | 用 SDK Query 对象获取 models/commands/account | 改为自建能力发现（models 从 Provider 获取，commands 从 skill-discovery 获取） |
| `src/lib/types/agent-types.ts` | **新建** | 替代从 SDK 导入的 `PermissionResult`、`PermissionMode`、`Options` 等类型 |

### 8.2 双路径切换

```typescript
// claude-client.ts — 通过设置项控制，非自动检测 CLI
const useNativeLoop = getSetting('agent.runtime') === 'native' || !hasClaudeCodeCLI();
if (!useNativeLoop) {
  return streamViaSDK(options);
} else {
  return streamViaNativeLoop(options);
}
```

**退出策略：** 双路径最多保留 2 个版本周期，之后默认 native，SDK 路径标记 deprecated。

### 8.3 改动

| 文件 | 动作 | 说明 |
|------|------|------|
| `src/lib/claude-client.ts` | **最终整合** | 双路径分支 + 统一 SSE 输出 |
| `src/lib/provider-doctor.ts` | **重写** | 改用 generateText() |
| `src/app/api/chat/structured/route.ts` | **重写** | 改用 generateObject() |
| `src/app/api/chat/mode/route.ts` | **修改** | 对接自建权限系统 |
| `src/lib/agent-sdk-capabilities.ts` | **重写** | 自建能力发现 |
| `src/lib/types/agent-types.ts` | **新建** | 自建类型定义 |
| `src/app/api/claude-status/route.ts` | **修改** | 增加 `nativeMode` 状态 |
| `src/components/setup/ClaudeCodeCard.tsx` | **修改** | 不再强制要求安装 Claude Code |
| `package.json` | **修改** | SDK 改为 optionalDependencies |

---

## 依赖变化汇总

### 新增
| 包 | 用途 |
|----|------|
| `glob` | Glob 工具（而非 fast-glob，与 OpenCode 一致） |
| `turndown` | WebFetch HTML→MD |
| `diff` | Edit 多层回退 |
| `bash-parser` | Bash 命令安全分类 |

### 保留
| 包 | 用途 |
|----|------|
| `ai` (Vercel AI SDK) | Agent Loop 核心 |
| `@ai-sdk/anthropic` 等 | Provider |
| `@modelcontextprotocol/sdk` | 外部 MCP 连接 |
| `zod` | Tool schema |

### 降级为 optional
| 包 | 用途 |
|----|------|
| `@anthropic-ai/claude-agent-sdk` | 可选的 SDK 路径 |

---

## 新建文件清单（复核修正后）

| 文件 | Phase | 说明 |
|------|-------|------|
| `src/lib/ai-provider.ts` | 1 | 统一 provider 工厂 |
| `src/lib/message-builder.ts` | 1 | DB messages → CoreMessage[] 结构化还原 |
| `src/lib/agent-loop.ts` | 1 | 核心 Agent Loop + SSE 适配层 |
| `src/lib/agent-tools.ts` | 1 | 工具组装层 |
| `src/lib/agent-system-prompt.ts` | 1 | 系统提示拼装 |
| `src/lib/tools/read.ts` | 2 | 文件读取工具 |
| `src/lib/tools/write.ts` | 2 | 文件写入工具 |
| `src/lib/tools/edit.ts` | 2 | 文件编辑工具（9 层回退） |
| `src/lib/tools/bash.ts` | 2 | Shell 执行工具 |
| `src/lib/tools/glob.ts` | 2 | 文件搜索工具 |
| `src/lib/tools/grep.ts` | 2 | 内容搜索工具 |
| `src/lib/tools/web-fetch.ts` | 2 | 网页抓取工具 |
| `src/lib/tools/web-search.ts` | 2 | 网页搜索工具 |
| `src/lib/tools/index.ts` | 2 | 工具注册表 + ToolContext 类型 |
| `src/lib/permission-checker.ts` | 2 | 权限判定核心 |
| `src/lib/mcp-connection-manager.ts` | 3 | MCP 连接池 |
| `src/lib/mcp-tool-adapter.ts` | 3 | MCP→AI SDK 转换 |
| `src/lib/bash-validator.ts` | 4 | Bash 安全验证 |
| `src/lib/context-pruner.ts` | 5 | Microcompact |
| `src/lib/skill-parser.ts` | 6 | Skill 完整解析 |
| `src/lib/skill-discovery.ts` | 6 | Skill 发现 |
| `src/lib/skill-executor.ts` | 6 | Skill 执行 |
| `src/lib/tools/skill.ts` | 6 | SkillTool |
| `src/lib/agent-registry.ts` | 7 | Agent 定义注册 |
| `src/lib/tools/agent.ts` | 7 | AgentTool（复用 agent-loop） |
| `src/lib/types/agent-types.ts` | 8 | 自建类型定义（替代 SDK 类型） |

**总计 26 个新文件（优化后：合并 agent-runner 到 agent-loop），估计总代码量 ~6,500-8,000 行。**

---

## 风险与对策（复核修正后）

| 风险 | 对策 |
|------|------|
| 自建工具质量不及 Claude Code | 优先参考 OpenCode 实现（已验证），Edit 用 **9 层**回退策略 |
| 系统提示缺失导致模型行为差异 | 从 Claude Code 源码提取关键指令段落，逐步调优 |
| 上下文压缩丢失关键信息 | 结构化摘要模板，partial compact 保留最近消息 |
| Bash 安全漏洞 | bash-parser AST 分析（已验证 Craft 实现）+ 权限拦截 |
| MCP 连接稳定性 | 超时重试 + 状态监控 + 优雅降级 |
| 双路径维护成本 | 最多保留 2 个版本周期，之后默认 native |
| SSE 适配层隐性复杂度 | 17 种自定义事件中 7 种需自行合成，纳入 Phase 1 重点关注 |
| Vercel AI SDK 版本 breaking changes | 锁定主版本号，关注 `tool()` 字段名变化 |
| DB 消息结构还原不完整 | message-builder 需处理 JSON 解析 + role 交替 + tool_use/tool_result 配对校验 |
