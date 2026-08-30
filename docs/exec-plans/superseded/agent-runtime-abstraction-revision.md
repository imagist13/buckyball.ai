> **Archive note（2026-06-05，document-system-governance）**：本计划已移出 `active/`，归入 `superseded/`——被 refactor-closeout 接管，仅作历史参考。**不是当前任务入口**；当前工作入口见 [exec-plans README](../README.md)，重启方式见 [superseded/README.md](README.md)。

# Agent Runtime 抽象层 — 执行计划修订建议

> ⚠️ **Superseded by [refactor-closeout.md](../completed/refactor-closeout.md)** — 不再单独推进，保留作历史参考。Runtime 可插拔思路并入 refactor-closeout 的 **Phase 2（Runtime 与会话执行）**。

> 创建时间：2026-04-06
> 基于：`decouple-claude-code.md` 原始计划 + 用户新方向（Runtime 可插拔）
> 关联：[原始执行计划](../completed/decouple-claude-code.md)

## 背景与新方向

原计划目标：脱离 Claude Code CLI 依赖，自建 Agent Runtime。
新增要求：
1. **Runtime 可插拔**：前端统一，后端可切换 Native / Claude Code SDK / 未来的 Codex、Gemini CLI、ACP 等
2. **Claude Code 可内置**：打包进安装包，用户无需自行安装 CLI
3. **速度优先**：抽象层要薄，不做过度工程

---

## 1. AgentRuntime 接口设计

### 1.1 核心接口

```typescript
// src/lib/runtime/types.ts

/**
 * AgentRuntime — 所有 Runtime 实现的唯一契约。
 *
 * 设计原则：
 * - 输入是一个 options bag，输出是 ReadableStream<string>（SSE 格式）
 * - 前端完全不感知 Runtime 差异，消费的 SSE 事件类型不变
 * - 接口尽可能薄：只定义"什么进、什么出"，不定义内部实现
 */
export interface AgentRuntime {
  /** Runtime 标识符，用于日志和设置 UI */
  readonly id: string;
  /** 人类可读名称 */
  readonly displayName: string;

  /**
   * 核心方法：启动一次 agent 交互，返回 SSE ReadableStream。
   * 这是 Runtime 的唯一入口。
   */
  stream(options: RuntimeStreamOptions): ReadableStream<string>;

  /**
   * 中断当前正在进行的交互。
   * Native Runtime 用 AbortController；SDK Runtime 用 conversation.interrupt()。
   */
  interrupt(sessionId: string): void;

  /**
   * 检查此 Runtime 是否可用（CLI 已安装、credentials 已配置等）。
   * 用于 UI 上显示 Runtime 可用状态和自动选择。
   */
  isAvailable(): boolean;

  /**
   * 释放资源（断开 MCP 连接、清理子进程等）。
   * 应用退出时调用。
   */
  dispose(): void;
}

/**
 * 通用的 stream 输入。从 ClaudeStreamOptions 提炼出所有 Runtime 都需要的字段。
 * Runtime 特有的字段通过 runtimeOptions 透传。
 */
export interface RuntimeStreamOptions {
  // ── 所有 Runtime 通用 ──
  prompt: string;
  sessionId: string;
  model?: string;
  systemPrompt?: string;
  workingDirectory?: string;
  abortController?: AbortController;
  autoTrigger?: boolean;

  // ── Provider 相关（通用，所有 Runtime 都需要知道用哪个 Provider） ──
  providerId?: string;
  sessionProviderId?: string;

  // ── 模型能力相关（通用概念，各 Runtime 自行映射到具体实现） ──
  thinking?: { type: 'adaptive' } | { type: 'enabled'; budgetTokens?: number } | { type: 'disabled' };
  effort?: 'low' | 'medium' | 'high' | 'max';
  context1m?: boolean;

  // ── MCP（通用，所有 Runtime 都应支持 MCP） ──
  mcpServers?: Record<string, import('@/types').MCPServerConfig>;

  // ── 权限（通用概念） ──
  permissionMode?: string;
  bypassPermissions?: boolean;

  // ── 回调 ──
  onRuntimeStatusChange?: (status: string) => void;

  // ── Runtime 特有选项的透传口 ──
  // SDK Runtime 需要的：sdkSessionId, files, conversationHistory, agents, agent, etc.
  // Native Runtime 需要的：maxSteps, etc.
  // 类型安全靠各 Runtime 实现内部自行 cast。
  runtimeOptions?: Record<string, unknown>;
}
```

### 1.2 为什么这样设计

**薄接口**：只有 4 个方法（stream / interrupt / isAvailable / dispose），核心就是 stream。不抽象工具、不抽象消息格式、不抽象权限判定——这些是各 Runtime 内部的事。

**SSE 作为统一输出协议**：前端已经定义了 17 种 SSE 事件类型（`SSEEventType`），这就是 Runtime 的输出契约。不需要额外定义中间表示。

**runtimeOptions 透传**：与其为每个 Runtime 的特有字段定义 union type（过度工程），不如用一个 `Record<string, unknown>` 透传。SDK Runtime 从中取 `sdkSessionId`、`files`、`agents`；Native Runtime 从中取 `maxSteps`。类型安全在 Runtime 实现内部处理。

**不抽象工具层**：工具是 Runtime 内部实现细节。Native Runtime 用 Vercel AI SDK tools，SDK Runtime 通过 Claude Code CLI 获取工具能力，未来 Codex Runtime 有自己的工具系统。强行统一工具接口是过度设计。

### 1.3 Runtime 注册表

```typescript
// src/lib/runtime/registry.ts

import type { AgentRuntime } from './types';

const runtimes = new Map<string, AgentRuntime>();

export function registerRuntime(runtime: AgentRuntime): void {
  runtimes.set(runtime.id, runtime);
}

export function getRuntime(id: string): AgentRuntime | undefined {
  return runtimes.get(id);
}

export function getAllRuntimes(): AgentRuntime[] {
  return Array.from(runtimes.values());
}

export function getAvailableRuntimes(): AgentRuntime[] {
  return getAllRuntimes().filter(r => r.isAvailable());
}

/**
 * 选择当前应该使用的 Runtime。
 * 优先级：用户设置 > 自动检测（有 Claude Code CLI 则用 SDK，否则 Native）
 */
export function resolveRuntime(settingOverride?: string): AgentRuntime {
  if (settingOverride) {
    const r = getRuntime(settingOverride);
    if (r?.isAvailable()) return r;
  }

  // 默认优先级：native（最轻量，无外部依赖）
  const native = getRuntime('native');
  if (native?.isAvailable()) return native;

  // fallback to SDK
  const sdk = getRuntime('claude-code-sdk');
  if (sdk?.isAvailable()) return sdk;

  throw new Error('No available runtime. Please configure a provider or install Claude Code CLI.');
}
```

---

## 2. 通用层 vs Runtime 特有层的划分

### 通用层（所有 Runtime 共享，位于 Runtime 之上）

| 模块 | 位置 | 说明 |
|------|------|------|
| **Provider 解析** | `provider-resolver.ts` + `ai-provider.ts` | 解析 credentials，Native Runtime 直接用，SDK Runtime 转换为 env vars |
| **SSE 事件类型** | `types/index.ts` | `SSEEventType`、`SSEEvent` — Runtime 的输出契约 |
| **前端 SSE 消费** | `useSSEStream.ts` | 完全不变，不感知 Runtime |
| **chat API 路由** | `api/chat/route.ts` | 调用 `resolveRuntime().stream()`，不再直接调用 `streamClaude()` |
| **会话管理** | `db.ts` | session/message CRUD — 所有 Runtime 共享 |
| **权限 UI 流** | `permission-registry.ts` → frontend → `/api/chat/permission` | 权限请求的注册和前端回调是通用的 |
| **MCP 配置加载** | `mcp-loader.ts` | 加载 MCP server 配置 — 通用 |
| **Telegram 通知** | `telegram-bot.ts` | 通用 |
| **错误分类** | `error-classifier.ts` | 通用 |

### Runtime 特有层

| 模块 | Native Runtime | SDK Runtime | 未来 Codex Runtime |
|------|---------------|-------------|-------------------|
| **Agent Loop** | `agent-loop.ts` (Vercel AI SDK streamText) | SDK `query()` 迭代 | Codex CLI subprocess |
| **工具系统** | `tools/*.ts` (Vercel AI SDK tool) | SDK 内置（不需要传） | Codex 内置 |
| **MCP 连接** | `mcp-connection-manager.ts` (自建) | SDK 内置（通过 Options.mcpServers 传入） | 取决于 Codex |
| **权限判定** | `permission-checker.ts` (自建) | SDK 内置 (`permissionMode`) | Codex 内置 |
| **系统提示** | `agent-system-prompt.ts` | SDK 内置 (`preset: 'claude_code'`) | Codex 内置 |
| **消息格式** | `message-builder.ts` (DB → CoreMessage[]) | SDK 内部管理 | Codex 内部管理 |
| **上下文压缩** | `context-pruner.ts` + `context-compressor.ts` | SDK 内部 | Codex 内部 |
| **中断** | `AbortController.abort()` | `conversation.interrupt()` | Codex CLI SIGINT |

### 关键设计决策：MCP

MCP 连接管理器应该是**双模式**的：
- **Native Runtime**：自己管理 MCP 连接（`mcp-connection-manager.ts`），将 MCP tools 转换为 Vercel AI SDK tools
- **SDK Runtime**：通过 `Options.mcpServers` 传给 SDK，让 SDK 管理连接

不需要强行统一。MCP 配置加载（`mcp-loader.ts`）是通用的，但连接管理是 Runtime 内部的事。

### 关键设计决策：权限

权限系统是**两层**的：
- **权限 UI 流**（通用）：`permission_request` SSE 事件 → 前端弹窗 → `/api/chat/permission` 回调。这对所有 Runtime 一样。
- **权限判定逻辑**（Runtime 特有）：Native Runtime 用自建的 `permission-checker.ts`，SDK Runtime 通过 `permissionMode` 配置。

---

## 3. 对 Phase 1 已有代码的改动建议

### 3.1 保留什么

| 文件 | 状态 | 说明 |
|------|------|------|
| `ai-provider.ts` | **保留原样** | 已经很好。Native Runtime 直接用。SDK Runtime 不用（走 env vars）。放在通用层。 |
| `message-builder.ts` | **保留原样** | Native Runtime 专用。不需要泛化。 |
| `agent-system-prompt.ts` | **保留原样** | Native Runtime 专用。 |
| `agent-tools.ts` | **保留原样** | Native Runtime 专用。 |

### 3.2 需要重构的

| 文件 | 改动 | 工作量 |
|------|------|--------|
| `agent-loop.ts` | 不变逻辑，但从顶层函数变为 `NativeRuntime.stream()` 的内部实现。`runAgentLoop()` 函数可以保留，NativeRuntime 的 `stream()` 直接调用它。 | ~30 行包装代码 |
| `claude-client.ts` | **重构核心**。`streamClaude()` 的职责变为：解析 `ClaudeStreamOptions` → 转换为 `RuntimeStreamOptions` → 调用 `resolveRuntime().stream()`。SDK 路径的巨量代码移入 `SdkRuntime` 类。 | ~200 行重组（代码量不变，只是搬家） |

### 3.3 新增的

| 文件 | 说明 | 工作量 |
|------|------|--------|
| `src/lib/runtime/types.ts` | `AgentRuntime` + `RuntimeStreamOptions` 接口定义 | ~80 行 |
| `src/lib/runtime/registry.ts` | Runtime 注册表 + `resolveRuntime()` | ~50 行 |
| `src/lib/runtime/native-runtime.ts` | 实现 `AgentRuntime`，内部调用 `runAgentLoop()` | ~80 行 |
| `src/lib/runtime/sdk-runtime.ts` | 实现 `AgentRuntime`，从 `claude-client.ts` 的 SDK 路径提取 | ~400 行（搬家，不是新写） |
| `src/lib/runtime/index.ts` | 注册所有 Runtime + re-export | ~20 行 |

### 3.4 对 `claude-client.ts` 的改动策略

当前 `streamClaude()` 约 500+ 行，内含 native 分支 + SDK 分支。改动策略：

```
之前：
  streamClaude() {
    if (useNativeLoop) → runAgentLoop(...)
    else → new ReadableStream({ SDK query() ... })
  }

之后：
  streamClaude() {
    const runtime = resolveRuntime(getSetting('agent_runtime'));
    const runtimeOpts = convertToRuntimeOptions(options);
    return runtime.stream(runtimeOpts);
  }

  NativeRuntime.stream() → 调用 runAgentLoop()（代码不变）
  SdkRuntime.stream() → 原 SDK 路径代码搬过来
```

`streamClaude()` 变成一个 20 行的薄分发层。保留这个函数名是为了不改 `chat/route.ts` 等调用方（或者直接改调用方调 `resolveRuntime().stream()`，都行，改动量差不多）。

---

## 4. 对 Phase 2-8 的调整建议

### Phase 2（工具系统 + 权限）— 无重大变化

原计划完全适用。工具和权限是 Native Runtime 的内部实现，不需要因为 Runtime 抽象层而改变。

唯一微调：工具的 `execute` 中发送 `permission_request` SSE 事件的方式，确保通过 Runtime 的 stream controller 发送（当前 `agent-loop.ts` 的 `controller.enqueue(formatSSE(...))` 模式已经正确）。

### Phase 3（MCP）— 微调

MCP 连接管理器是 Native Runtime 专用的。但 MCP 配置加载是通用的。

调整点：
- `mcp-connection-manager.ts` 放在 `src/lib/runtime/native/` 而非 `src/lib/`
- 或者放在 `src/lib/`（因为未来 Codex Runtime 如果不自带 MCP，也可能复用）

**建议：先放 `src/lib/`，不过早移动目录。**

### Phase 4（权限增强）— 无变化

权限判定是 Native Runtime 内部的事。

### Phase 5（上下文压缩）— 无变化

上下文管理是 Native Runtime 内部的事。

### Phase 6（Skills）— 微调

Skills 发现（扫描 SKILL.md 文件）是通用的——所有 Runtime 都可以把 Skill 列表告诉模型。

但 Skill 执行是 Runtime 特有的：
- Native Runtime：inline 模式注入 prompt + 过滤 tools；fork 模式启动子 agent-loop
- SDK Runtime：通过 `agents` option 传给 SDK

调整点：`skill-discovery.ts` 放通用层，`skill-executor.ts` 放各 Runtime 内部（或者只在 Native Runtime 中实现，SDK Runtime 靠 SDK 自己的 skill 支持）。

### Phase 7（子 Agent）— 无变化

子 Agent 是 Native Runtime 内部的事。SDK Runtime 通过 `agents` option 传给 SDK。

### Phase 8（集成）— **重大调整**

原计划的 Phase 8 是"双路径切换"。现在变成"多 Runtime 调度"。

调整点：

| 原计划 | 调整后 |
|--------|--------|
| `claude-client.ts` 的 if/else 双分支 | `resolveRuntime()` 多 Runtime 选择 |
| 设置项 `agent.runtime = 'native'` / 不设 | 设置项 `agent.runtime = 'native' | 'claude-code-sdk' | 'auto'` |
| 退出策略：2 个版本后默认 native | 保留。SDK Runtime 作为可选项长期存在 |
| — | 新增：Runtime 状态 UI（显示哪些 Runtime 可用） |
| — | 新增：每个 session 可以选择 Runtime（设置中设默认值，新建 chat 时可选） |

### 新增 Phase：Claude Code 内置（可选，穿插在任意阶段）

见下方第 5 节。

---

## 5. Claude Code CLI 内置方案

### 5.1 技术可行性

`@anthropic-ai/claude-agent-sdk` 的 `query()` 函数实际上是 spawn 一个 Claude Code CLI 子进程。SDK 包本身很小，它通过 `pathToClaudeCodeExecutable` option 找到 CLI binary。

要内置 Claude Code，有两条路：

**方案 A：内置 `@anthropic-ai/claude-code` npm 包**
- 把 `@anthropic-ai/claude-code` 加为 `dependencies`（非 devDependencies）
- Electron 打包时会把 node_modules 打进去
- `findClaudeBinary()` 增加一个候选路径：`app.getAppPath() + '/node_modules/.bin/claude'`
- 优点：简单、与现有代码完全兼容
- 缺点：包体积增大（claude-code 包约 50-100MB），license 问题

**方案 B：内置 Agent SDK + 提供 CLI 一键安装**
- 只内置 `@anthropic-ai/claude-agent-sdk`（已经是 dependency）
- 应用内提供"一键安装 Claude Code CLI"按钮（`npm install -g @anthropic-ai/claude-code`）
- 优点：包体积不增加，无 license 风险
- 缺点：还是需要用户点一下安装

**方案 C（推荐）：内置 Agent SDK + Bundled CLI**
- `@anthropic-ai/claude-agent-sdk` 实际上就是 `@anthropic-ai/claude-code` 的子集——它从 claude-code 包 fork 出来的
- 查看 SDK 的 `query()` 实现，它 spawn 的是 `claude` CLI
- 如果 SDK 支持 `pathToClaudeCodeExecutable`，我们可以把 claude-code 的 JS 入口打包进来
- 在 Electron 的 `extraResources` 中包含 claude-code 的核心 JS 文件
- `findClaudeBinary()` 优先检查 extraResources 路径

### 5.2 License 风险评估

`@anthropic-ai/claude-code` 和 `@anthropic-ai/claude-agent-sdk` 的 license 都是 "SEE LICENSE IN README.md"。README 指向 Anthropic 的 Commercial Terms of Service。

**风险**：
- 没有明确的 Apache/MIT 等开源 license
- 将 CLI 二进制内置到第三方 app 分发，可能需要 Anthropic 的明确授权
- 建议在实施前联系 Anthropic 确认

### 5.3 推荐策略

**短期（现在）**：不内置。用户自行安装 CLI。CodePilot 提供一键安装按钮 + 安装引导。Native Runtime 作为无 CLI 时的 fallback，功能逐步追赶。

**中期（Native Runtime 功能完备后）**：Native Runtime 成为默认。SDK Runtime 降级为可选增强。用户不安装 CLI 也能完整使用所有功能。

**长期**：如果 Anthropic 开放了 license 或提供了 embed-friendly 的包，再考虑内置。

### 5.4 对 `platform.ts` 的改动

无论是否内置，`findClaudeBinary()` 都应该增加一个候选路径：

```typescript
// platform.ts — 新增 Electron bundled path 候选
function getClaudeCandidatePaths(): string[] {
  const paths = [...existingPaths];

  // Check if claude-code is bundled in the app (extraResources)
  if (process.type === 'renderer' || process.type === 'browser') {
    const { app } = require('electron');
    const bundledPath = path.join(app.getAppPath(), 'resources', 'claude-code', 'cli.js');
    if (fs.existsSync(bundledPath)) {
      paths.unshift(bundledPath); // highest priority
    }
  }

  return paths;
}
```

---

## 6. 修订后的文件清单和代码量估算

### 新增文件（Runtime 抽象层）

| 文件 | Phase | 估计行数 | 说明 |
|------|-------|---------|------|
| `src/lib/runtime/types.ts` | 1 | ~80 | AgentRuntime 接口 + RuntimeStreamOptions |
| `src/lib/runtime/registry.ts` | 1 | ~50 | Runtime 注册表 + resolveRuntime() |
| `src/lib/runtime/native-runtime.ts` | 1 | ~80 | NativeRuntime 实现（包装 runAgentLoop） |
| `src/lib/runtime/sdk-runtime.ts` | 1 | ~400 | SdkRuntime 实现（从 claude-client.ts SDK 路径提取） |
| `src/lib/runtime/index.ts` | 1 | ~20 | 初始化注册 + re-export |
| **Runtime 层小计** | | **~630** | |

### 修改文件（Phase 1 调整）

| 文件 | 改动量 | 说明 |
|------|--------|------|
| `claude-client.ts` | -400 / +30 | SDK 路径代码移走，streamClaude 变薄分发层 |
| `api/chat/route.ts` | ~5 行 | 可选：直接调用 resolveRuntime().stream() |
| `types/index.ts` | ~10 行 | 新增 `sessionModel` 到 ClaudeStreamOptions（如果还保留这个类型）|

### 原计划文件（不变）

原计划的 26 个新文件全部保留，无需改动。它们都是 Native Runtime 的内部实现。

### 总代码量估算修订

| 类别 | 原计划 | 修订后 | 变化 |
|------|--------|--------|------|
| Runtime 抽象层 | 0 | ~630 行 | +630（净新增 ~230，其余从 claude-client.ts 搬家） |
| Phase 1 其他 | 不变 | 不变 | agent-loop / message-builder / ai-provider 不变 |
| Phase 2-7 | ~6,500-8,000 行 | 不变 | 工具/权限/MCP/skills 不受影响 |
| Phase 8 | 双路径 | 多 Runtime 调度 | 改动范围微增（~100 行 UI 调整） |
| **总计** | ~6,500-8,000 | **~7,000-8,500** | +500-700 净增 |

---

## 7. 实施节奏建议

### Phase 1 拆分为两步

**Phase 1a（现在立即做，~1 天）：Runtime 抽象层**
1. 创建 `src/lib/runtime/types.ts` — 接口定义
2. 创建 `src/lib/runtime/registry.ts` — 注册表
3. 创建 `src/lib/runtime/native-runtime.ts` — 包装已有的 `runAgentLoop()`
4. 创建 `src/lib/runtime/sdk-runtime.ts` — 从 `claude-client.ts` 提取 SDK 路径
5. 重构 `claude-client.ts` — `streamClaude()` 变为薄分发层
6. 测试：确保两条路径都正常工作

**Phase 1b（继续 Phase 2 之前做，~0.5 天）：**
1. DB `sessions` 表新增 `runtime` 字段（默认 'auto'）
2. 设置 UI 新增 Runtime 选择器
3. 新建 chat 时可选 Runtime

### Phase 2-7 按原计划执行，无需等待

### Phase 8 改名为"Runtime 集成 + 收尾"
- 补全 SDK 依赖点（provider-doctor, structured output 等）
- 多 Runtime 状态 UI
- Runtime 选择器集成到新建 chat 流程

---

## 8. 面向未来的 Runtime 扩展示例

展示接口如何支持未来 Runtime，证明设计不需要修改：

```typescript
// 未来：src/lib/runtime/codex-runtime.ts（仅示意）
class CodexRuntime implements AgentRuntime {
  readonly id = 'codex';
  readonly displayName = 'OpenAI Codex CLI';

  stream(options: RuntimeStreamOptions): ReadableStream<string> {
    // spawn `codex` CLI subprocess
    // parse its output → emit SSE events
    return new ReadableStream({ ... });
  }

  interrupt(sessionId: string): void {
    // send SIGINT to codex subprocess
  }

  isAvailable(): boolean {
    // check if `codex` binary exists in PATH
    return !!findBinary('codex');
  }

  dispose(): void { /* cleanup */ }
}
```

```typescript
// 未来：src/lib/runtime/gemini-cli-runtime.ts（仅示意）
class GeminiCliRuntime implements AgentRuntime {
  readonly id = 'gemini-cli';
  readonly displayName = 'Gemini CLI';
  // ... 同样的模式
}
```

接口不变，只需新增实现 + 在 `runtime/index.ts` 中注册。

---

## 9. 风险与决策摘要

| 决策 | 理由 |
|------|------|
| 接口只有 4 个方法 | 薄抽象。stream 是核心，其他 3 个是必要的生命周期管理 |
| 不抽象工具层 | 工具是 Runtime 内部实现细节。强行统一 = 过度工程 |
| 不抽象消息格式 | 每个 Runtime 的消息格式不同。统一层是 SSE 输出 |
| runtimeOptions 用 Record<string, unknown> | 避免为每个 Runtime 维护 union type。类型安全在 Runtime 内部保证 |
| MCP 不在通用层管理连接 | SDK Runtime 让 SDK 管理 MCP；Native Runtime 自建。配置加载是通用的 |
| 不立即内置 Claude Code CLI | license 不明确 + Native Runtime 功能追赶后不需要内置 |
| Phase 1 先做抽象层再继续 Phase 2 | 后续所有 Phase 的代码都在 Native Runtime 内部，先确立结构避免返工 |
