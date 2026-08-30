> 背景与计划见 [docs/exec-plans/completed/hermes-inspired-runtime-upgrade.md](../exec-plans/completed/hermes-inspired-runtime-upgrade.md)（配对 insights 未产出）

# Hermes-Inspired Runtime Upgrade — 技术交接文档

本文档覆盖 `feat/hermes-inspired-runtime-upgrade` 分支引入的所有运行时能力模块，源自对 Hermes Agent (`run_agent.py`) 架构的分析移植。每个模块独立描述文件位置、导出接口、核心算法、集成状态和关键设计决策。

---

## 1. parallel-safety.ts — 并行工具执行安全判断

**文件:** `src/lib/parallel-safety.ts`

**状态:** 模块就绪，未接入 agent-tools.ts（见下方"未接入原因"）

### 导出集合

| 名称 | 内容 | 用途 |
|------|------|------|
| `PARALLEL_SAFE_TOOLS` | `Read`, `Glob`, `Grep`, `WebFetch`, `codepilot_memory_search/get/recent` | 只读工具白名单，始终可并行 |
| `PATH_SCOPED_TOOLS` | `Read`, `Write`, `Edit` | 路径范围工具，路径不重叠时可并行 |
| `NEVER_PARALLEL_TOOLS` | （空集） | 强制串行工具（Hermes 中含 `clarify`，CodePilot 暂无对应） |

`Read` 同时出现在 `PARALLEL_SAFE_TOOLS` 和 `PATH_SCOPED_TOOLS` 中——与 Hermes 的 `read_file` 一致：两次读同一路径仍串行（保守策略）。

### 导出函数

| 函数 | 签名 | 说明 |
|------|------|------|
| `shouldParallelizeToolBatch` | `(calls: ToolCallDescriptor[], opts?) => boolean` | 4 层判断入口 |
| `pathsOverlap` | `(left: string, right: string) => boolean` | 前缀比较两路径是否重叠 |
| `isDestructiveCommand` | `(cmd: string) => boolean` | 启发式判断 shell 命令是否具有破坏性 |
| `extractScopePath` | `(toolName, args, cwd?) => string \| null` | 从工具参数提取规范化绝对路径 |

### 4 层判断算法

1. **Layer 1 — 批次大小:** `calls.length <= 1` 直接返回 `false`（无并行意义）
2. **Layer 2 — 黑名单:** 批次中任一工具在 `NEVER_PARALLEL_TOOLS`（或 `extraNeverParallelTools`）中即串行
3. **Layer 3 — 路径范围:** `PATH_SCOPED_TOOLS` 中的工具提取路径后，与已保留路径逐一比较。路径重叠则串行；路径无法提取（返回 null）亦串行（保守）
4. **Layer 4 — 白名单兜底:** 既不在黑名单也不在路径范围工具中的调用，必须在 `PARALLEL_SAFE_TOOLS` 白名单中才允许并行。未知工具默认串行

### 未接入原因

AI SDK 的 `streamText` 将模型返回的 tool-call 批次直接分发到各 `tool({ execute })` 独立执行，没有 pre-batch 钩子。接入需要：(a) 每个 session 共享互斥锁用于非安全工具，或 (b) 在 `fullStream` 的 tool-call 事件层拦截并自行调度 `tool.execute`。两种方案都需要侵入 `agent-tools.ts` 的工具注册机制。

### 关键设计决策

- **白名单优先而非黑名单优先** — 未知工具默认串行，避免新工具上线时意外并行导致冲突
- **不调用 `fs.realpath`** — Write 工具的目标文件可能尚不存在，用路径组件前缀比较替代
- `isDestructiveCommand` 独立导出但不在 `shouldParallelizeToolBatch` 内调用 — Bash 不在任何并行白名单中，已被 Layer 4 兜底为串行

---

## 2. resolveAuxiliaryModel — 辅助模型 5 级解析链

**文件:** `src/lib/provider-resolver.ts`（约第 820-1063 行）

**状态:** 已接入 `context-compressor.ts`

### 类型定义

```ts
type AuxiliaryTask = 'compact' | 'vision' | 'summarize' | 'web_extract';

type AuxiliaryResolutionSource =
  | 'env_override'     // Tier 1
  | 'main_small'       // Tier 2
  | 'main_haiku'       // Tier 3
  | 'fallback_provider_small'  // Tier 4a
  | 'fallback_provider_haiku'  // Tier 4b
  | 'main_floor';      // Tier 5

interface AuxiliaryModelResolution {
  providerId: string;
  modelId: string;
  source: AuxiliaryResolutionSource;
}
```

### 5 级解析链

| Tier | 来源 | 条件 |
|------|------|------|
| 1 | 环境变量覆盖 | `AUXILIARY_{TASK}_PROVIDER` + `AUXILIARY_{TASK}_MODEL` 同时设置 |
| 2 | 主 provider 的 `roleModels.small` | 主 provider 非 `sdkProxyOnly` |
| 3 | 主 provider 的 `roleModels.haiku` | 主 provider 非 `sdkProxyOnly` |
| 4 | 其他已配置 provider 的 `small` / `haiku` 槽 | 遍历 `getAllProviders()`，跳过 `sdkProxyOnly` 的 |
| 5 | 主 provider + 主模型（兜底） | **永不返回 null** — 辅助任务在主模型上执行 |

### 纯函数 vs 包装器

- **`routeAuxiliaryModel(task, ctx)`** — 纯函数，所有依赖通过 `AuxiliaryRoutingContext` 注入，便于单元测试
- **`resolveAuxiliaryModel(task, opts?)`** — 实际入口，负责调用 `resolveProvider`、枚举 `getAllProviders`、读取环境变量，然后委托给 `routeAuxiliaryModel`
- **`computeEffectiveRoleModels(provider, preset, protocol)`** — 合并 provider 持久化的 `role_models_json` 与 catalog preset 的 `defaultRoleModels`，确保 Tier 4 扫描能看到预设级别的 small/haiku 槽

### AuxiliaryRoutingContext 接口

```ts
interface AuxiliaryRoutingContext {
  main: ResolvedProvider;
  isMainSdkProxyOnly: boolean;
  others: ReadonlyArray<{ id: string; roleModels: RoleModels; isSdkProxyOnly: boolean }>;
  envOverride?: { providerId?: string; modelId?: string };
}
```

### 关键设计决策

- **Session 上下文传递** — 调用者必须传 `providerId` / `sessionProviderId` / `sessionModel`，否则 "main" 解析到全局默认 provider 而非会话的实际 provider，导致辅助任务使用错误的凭据
- **`main_floor` 警告** — `context-compressor.ts` 在 source 为 `main_floor` 时输出 `console.warn`，提示用户配置廉价辅助模型以节省成本
- **`sdkProxyOnly` 跳过** — Zhipu、Kimi 等代理 provider 只支持 SDK 子进程格式，不支持直接 Anthropic Messages API 调用，因此不能作为辅助模型来源

---

## 3. subdirectory-hint-tracker.ts — 子目录提示文件惰性发现

**文件:** `src/lib/subdirectory-hint-tracker.ts`

**状态:** 模块就绪，未接入 agent-tools.ts

### SubdirectoryHintTracker 类

构造函数接收 `workingDir`（默认 `process.cwd()`），并将其预标记为已加载（启动阶段的 `agent-system-prompt.ts` 已处理根目录）。

### 核心方法: `checkToolCall(toolName, toolArgs)`

返回 `string | null` — 发现新的提示文件时返回格式化文本（供追加到 tool result），否则返回 null。

内部流程：
1. 从 `toolArgs` 中按 `PATH_ARG_KEYS` (`path`, `file_path`, `workdir`, `cwd`) 提取路径候选
2. 如果 `toolName` 在 `COMMAND_TOOLS` (`Bash`) 中，调用 `tokenizeShellCommand` 从 command 字符串中提取路径状 token
3. 对每个路径候选调用 `addPathCandidate` — 解析为绝对路径，判断文件/目录，然后向上遍历最多 `MAX_ANCESTOR_WALK` (5) 层祖先目录
4. 对每个未加载的目录调用 `loadHintsForDirectory` — 按优先级尝试 `HINT_FILENAMES`，第一个匹配即返回

### 常量

| 名称 | 值 | 说明 |
|------|-----|------|
| `HINT_FILENAMES` | `AGENTS.md`, `agents.md`, `CLAUDE.md`, `claude.md`, `.cursorrules` | 按优先级查找 |
| `MAX_HINT_CHARS` | 8,000 | 单文件内容上限，超出截断并追加 `[...truncated]` 注释 |
| `PATH_ARG_KEYS` | `path`, `file_path`, `workdir`, `cwd` | 工具参数中的路径键 |
| `MAX_ANCESTOR_WALK` | 5 | 祖先遍历上限 |

### tokenizeShellCommand(cmd)

导出的简易 shell 分词器，支持单/双引号，不支持转义序列、变量替换、命令替换、here-doc。仅用于路径提取，误判 token 会被后续 URL 过滤和 `isFile`/`isValidSubdir` 检查剔除。

### 关键设计决策

- **惰性加载，不修改 system prompt** — 提示内容追加到 tool result 而非注入 system prompt，保护 prompt cache
- **先标记后读取** — `loadedDirs.add(directory)` 在 `readFileSync` 之前执行，读取失败不会导致重复尝试
- **首匹配胜出** — 每个目录只返回第一个找到的提示文件（按 `HINT_FILENAMES` 优先级），避免信息重复

---

## 4. codepilot_session_search — 历史会话搜索工具

**文件:**
- 工具定义: `src/lib/builtin-tools/session-search.ts`
- 数据层: `src/lib/db.ts` (`searchMessages` 函数，约第 1223 行)
- 注册: `src/lib/builtin-tools/index.ts`（`createSessionSearchTools()`，condition: `'always'`）

**状态:** 已接入，可在所有会话中使用

### 工具 Schema

```ts
inputSchema: z.object({
  query: z.string().min(1),           // 必填：搜索关键词
  sessionId: z.string().optional(),    // 可选：限定到某个 session
  limit: z.number().int().min(1).max(50).optional(),  // 默认 5，上限 50
})
```

### SQL 查询策略

- **使用 `LIKE`，不使用 FTS5** — 保持 schema 要求最低，未来 FTS5 作为性能优化备选
- 通配符 `%` 和 `_` 在用户输入中被转义为字面值（`ESCAPE '\\'`）
- JOIN `chat_sessions` 获取 session 标题
- 按 `m.created_at DESC` 排序
- 自动检测 `is_heartbeat_ack` 列存在性（兼容新旧 schema），若存在则排除心跳确认消息

### Snippet 提取

`buildSnippet(content, lowerQuery)` 函数：
- 在 content 中定位查询词的首次出现位置（大小写不敏感）
- 向前取 80 字符、向后取 120 字符（含查询词），生成约 200 字符的上下文片段
- 找不到匹配时退回到 content 前 200 字符（处理 JSON blob 等内部匹配情况）
- 前后截断处加 `…` 省略号

### 关键设计决策

- **动态 import `@/lib/db`** — 工具注册轻量化，避免在每次工具组装时拉入 DB 模块
- **system prompt 注入** — `SESSION_SEARCH_SYSTEM_PROMPT` 告诉模型何时使用此工具（用户提到之前讨论过的内容时）

---

## 5. context-pruner.ts 增强

**文件:** `src/lib/context-pruner.ts`

**状态:** `pruneOldToolResults`（原有）已接入 agent-loop；`pruneOldToolResultsByBudget`（新增）模块就绪未接入

### 新增函数: pruneOldToolResultsByBudget

```ts
function pruneOldToolResultsByBudget(
  messages: ModelMessage[],
  options?: PruneByBudgetOptions
): ModelMessage[]
```

参数：
- `tokenBudget` — 目标 token 预算（默认 100,000）
- `protectFirstN` — 保护头部消息数（默认 3，匹配 Hermes 的 `protect_first_n`）
- `protectLastN` — 保护尾部消息数（默认 6，与旧版 pruner 对齐）
- `keepToolCallSummary` — 截断时保留工具调用 ID 摘要而非通用标记（默认 true）

算法：先估算总 token 数，未超预算直接返回；超出时将受保护首/尾之间的 tool-result content 替换为标记字符串。

### @deprecated: shouldAutoCompact

此函数是占位代码，从未有调用者。实际的自动压缩检查位于 `context-compressor.ts` 的 `needsCompression(estimatedTokens, contextWindow, sessionId)`，已接入 chat API route 入口点。保留仅为向后兼容。

### 两层压缩架构说明

| 层级 | 模块 | 时机 | 方式 |
|------|------|------|------|
| Micro（每步） | `context-pruner.ts` | agent loop 每次 `streamText()` 前 | 固定标记替换，无 LLM 调用 |
| Macro（每轮） | `context-compressor.ts` | chat API route 入口，token 超 80% 时 | LLM 驱动摘要，存入 `chat_sessions.context_summary` |

### 关键设计决策

- **`pruneOldToolResultsByBudget` 故意不接入** — 与 macro 层的 `needsCompression` + `compressConversation` 冲突：两者都在做"历史过长"的处理，同时启用会导致双重截断。此函数作为未来 LLM 压缩被禁用时的替代方案保留
- **token 估算** — 粗粒度启发式（~3.5 chars/token），不需要 tokenizer 依赖

---

## 6. context-compressor.ts 升级 — resolveAuxiliaryModel('compact')

**文件:** `src/lib/context-compressor.ts`

**状态:** 已接入，每次聊天请求在 `src/app/api/chat/route.ts` 中触发检查

### 升级内容

原实现使用 `resolveProvider({ useCase: 'small' })`，仅实现 Tier 2（主 provider 的 small 槽），且对 `sdkProxyOnly` 的主 provider 没有跨 provider 回退。

升级后调用 `resolveAuxiliaryModel('compact', { providerId, sessionProviderId, sessionModel })`，获得完整的 5 级解析链。

### main_floor 警告

当 `auxiliary.source === 'main_floor'` 时，`compressConversation` 输出：

```
[context-compressor] No cheap auxiliary model configured —
falling back to main provider/model (...). Set AUXILIARY_COMPACT_PROVIDER +
AUXILIARY_COMPACT_MODEL or configure roleModels.small on a non-sdkProxyOnly
provider to save cost.
```

此警告告知用户压缩将以主模型成本运行，并给出配置建议。

### 关键设计决策

- **Session 上下文传递** — `compressConversation` 将 `providerId` 和 `sessionModel` 透传到 `resolveAuxiliaryModel`，确保辅助模型解析基于当前会话的 provider，而非全局默认
- **电路断路器不变** — `MAX_CONSECUTIVE_FAILURES = 3`，连续 3 次压缩失败后跳过该 session 的压缩请求

---

## 7. skill-nudge.ts + UI — 技能保存提示

**文件:**
- 核心逻辑: `src/lib/skill-nudge.ts`
- 发送端: `src/lib/agent-loop.ts`（约第 442-458 行）
- SSE 解析: `src/hooks/useSSEStream.ts`（约第 126 行）
- 事件转发: `src/lib/stream-session-manager.ts`（约第 374-405 行）
- UI 渲染: `src/components/chat/ChatView.tsx`（约第 156-643 行）
- i18n: `src/i18n/zh.ts`（第 70-72 行）、`src/i18n/en.ts`（第 73-75 行）

**状态:** 已接入，端到端可用

### 阈值常量

| 常量 | 值 | 含义 |
|------|-----|------|
| `SKILL_NUDGE_STEP_THRESHOLD` | 8 | agent loop 迭代步数下限 |
| `SKILL_NUDGE_DISTINCT_TOOL_THRESHOLD` | 3 | 使用的不同工具数下限 |

两个条件同时满足才触发提示。

### SSE 事件形状

`buildSkillNudgeStatusEvent(stats)` 返回：

```ts
{
  notification: true,        // 让 SSE parser 走 status/notification 分支
  message: string,           // 人类可读的提示文本
  subtype: 'skill_nudge',   // 区分其他 status 事件
  payload: {
    type: 'skill_nudge',
    message: string,
    reason: { step: number, distinctToolCount: number, toolNames: string[] }
  }
}
```

### 数据流

```
agent-loop.ts (shouldSuggestSkill → buildSkillNudgeStatusEvent → formatSSE → controller.enqueue)
    ↓ SSE stream
useSSEStream.ts (statusData.subtype === 'skill_nudge' → callbacks.onSkillNudge)
    ↓ callback
stream-session-manager.ts (onSkillNudge → window.dispatchEvent('skill-nudge', { detail }))
    ↓ window event
ChatView.tsx (addEventListener('skill-nudge') → setSkillNudge state → 渲染 banner)
```

### UI 行为

- Banner 在流式传输完成后显示，新消息开始时自动清除（`isStreaming` 变为 true 时 `setSkillNudge(null)`）
- "Save as Skill" 按钮点击后：清除 banner + 发送 `t('skillNudge.savePrompt')` 消息让模型执行保存
- 右侧 X 按钮仅关闭 banner，不触发任何操作

### i18n 键

| 键 | 中文 | 英文 |
|----|------|------|
| `skillNudge.message` | 本次工作流使用了 {step} 个步骤和 {toolCount} 种工具，可以保存为 Skill 以便一键复用。 | This workflow involved {step} steps across {toolCount} distinct tools. Save as a Skill for one-click replay. |
| `skillNudge.saveButton` | 保存为 Skill | Save as Skill |
| `skillNudge.savePrompt` | 请帮我把这次对话中的工作流程保存为一个可复用的 Skill。 | Please help me save the workflow from this conversation as a reusable Skill. |

### 关键设计决策

- **window event 而非 snapshot** — nudge 需要在流完成后持续显示，而 snapshot 在流完成后会被清除
- **纯函数判断** — `shouldSuggestSkill` 不依赖 IO，可独立测试

---

## 8. AskUserQuestion — 结构化用户提问工具

**文件:**
- 工具定义: `src/lib/builtin-tools/ask-user-question.ts`
- 权限检查: `src/lib/permission-checker.ts`（`ALWAYS_ASK_TOOLS` 集合）
- UI 渲染: `src/components/chat/PermissionPrompt.tsx`（`AskUserQuestionUI` 组件 + `NEVER_AUTO_APPROVE` 集合）
- Bridge 限制: `src/lib/bridge/permission-broker.ts`（`isBridgeUnsupportedInteractiveTool`）
- 注册: `src/lib/builtin-tools/index.ts`（`createAskUserQuestionTools()`，condition: `'always'`）

**状态:** 已接入，浏览器端完整可用；IM/bridge 端降级为拒绝

### 完整数据流

1. **模型调用** — 模型发出 `AskUserQuestion({ questions: [...] })`，每个 question 含 `question`、`options[]`、可选 `header`、`multiSelect`
2. **权限拦截** — `permission-checker.ts` 的 `ALWAYS_ASK_TOOLS` 包含 `'AskUserQuestion'`，即使 trust mode 也强制显示 UI（因为工具的目的就是获取用户输入）
3. **前端渲染** — `PermissionPrompt.tsx` 检测 `pendingPermission.toolName === 'AskUserQuestion'` 时渲染 `AskUserQuestionUI`。`NEVER_AUTO_APPROVE` 集合确保 full_access 模式也不自动批准
4. **用户交互** — 用户选择选项（支持 multiSelect）和/或输入自定义文本
5. **答案校验** — `hasAnswer` 使用 `.every()` 确保所有问题都有回答（而非 `.some()`），避免部分提交
6. **权限响应** — 前端将 `updatedInput`（含 `questions` + `answers: Record<string, string>`）传回权限系统
7. **execute 执行** — 工具的 `execute` 从 `input` 中提取 `answers`（通过 runtime cast，因为 Zod schema 只覆盖模型输入的 `questions`），格式化为 `Q: ...\nA: ...` 返回给模型

### Bridge 行为

`permission-broker.ts` 中 `isBridgeUnsupportedInteractiveTool('AskUserQuestion')` 返回 true，bridge session 中该工具被自动拒绝，并返回消息 `"AskUserQuestion is not supported in IM/bridge sessions because the chat interface cannot render interactive option selection."` 让模型改用纯文本提问。

### 关键设计决策

- **`.every()` 而非 `.some()`** — 修复了原始的 `hasAnswer` 逻辑：`.some()` 允许部分提交导致模型收到空答案
- **answers 不在 Zod schema 中** — 保持工具 schema 只描述模型输入，`answers` 由权限流运行时注入，通过 `as unknown as Record<string, unknown>` 访问
- **Bridge 降级为拒绝而非静默忽略** — 拒绝消息明确告知模型原因和替代方案（改用纯文本），而非返回空答案

---

## 9. Compression Notification — 上下文压缩通知

**文件:**
- 发送端: `src/app/api/chat/route.ts`（约第 263-438 行）
- SSE 解析: `src/hooks/useSSEStream.ts`（约第 135-148 行）
- 事件转发: `src/lib/stream-session-manager.ts`（约第 384-405 行）
- UI 状态: `src/components/chat/ChatView.tsx`（`hasSummary` state + `context-compressed` 事件监听）

**状态:** 已接入，端到端可用

### SSE 事件形状

压缩发生后，chat route 在实际流之前 prepend 一个 status 事件：

```ts
{
  type: 'status',
  data: JSON.stringify({
    notification: true,
    subtype: 'context_compressed',
    message: 'Context compressed: N older messages summarized, ~X tokens saved',
    stats: { messagesCompressed: number, tokensSaved: number }
  })
}
```

### onContextCompressed 回调链

```
chat/route.ts (compressionOccurred flag → prepend SSE event to response stream)
    ↓ SSE stream
useSSEStream.ts (statusData.subtype === 'context_compressed' → callbacks.onContextCompressed)
    ↓ callback
stream-session-manager.ts (onContextCompressed → window.dispatchEvent('context-compressed') + status bar text)
    ↓ window event
ChatView.tsx (addEventListener('context-compressed') → setHasSummary(true))
```

### 5 秒状态栏显示

`stream-session-manager.ts` 在 `onContextCompressed` 中：
- 将 `data.message` 写入 `stream.snapshot.statusText`
- 启动 5 秒定时器（`streamTimeout(stream, ..., 5000)`），到期后清除 statusText（仅当未被其他消息覆盖时）

### 关键设计决策

- **prepend 而非 inline** — 压缩事件在 agent loop 流之前发送，确保用户在收到新回复前就看到通知
- **ChatView 双来源检测** — `hasSummary` 由两种途径触发：(1) window event `context-compressed`（自动压缩），(2) 消息内容包含 `'上下文已压缩'`（手动 /compact 命令）

---

## Runtime 归属总结

| 模块 | Native Runtime | SDK Runtime | 说明 |
|------|:-:|:-:|------|
| parallel-safety | 仅 Native（设计） | -- | AI SDK 的 tool dispatch 无 batch hook |
| resolveAuxiliaryModel | 适用 | -- | SDK Runtime 有内置辅助模型路由 |
| subdirectory-hint-tracker | 仅 Native（设计） | -- | SDK Runtime 有内置子目录提示 |
| codepilot_session_search | 适用 | -- | builtin tool 注册在 Native Runtime 工具链中 |
| context-pruner (budget) | 仅 Native（设计） | -- | agent-loop 级别的步间裁剪 |
| context-compressor upgrade | 适用 | -- | chat route 入口的 token 检查，两个 runtime 都经过此路径 |
| skill-nudge | 仅 Native | -- | agent-loop 中 step 计数，SDK Runtime 无等效 |
| AskUserQuestion | 仅 Native | -- | SDK Runtime 已有内置 AskUser |
| compression notification | 适用 | -- | chat route 入口层，两个 runtime 都使用此响应 |

---

## Follow-up: 3 个未接入模块

1. **parallel-safety.ts** — 需要 AI SDK batch-level 拦截机制或 per-session mutex 设计。核心算法已验证，接入点在 `agent-tools.ts` 的工具执行调度层
2. **subdirectory-hint-tracker.ts** — 需要在 `agent-tools.ts` 的每个 `tool({ execute })` 包装器中，于 execute 返回后调用 `tracker.checkToolCall` 并追加返回值到 tool result。侵入性较大，需逐工具改造
3. **pruneOldToolResultsByBudget** — 与现有 macro 层 LLM 压缩存在冲突，适合在 LLM 压缩被禁用的场景下启用。接入点在 `agent-loop.ts` 的 `pruneOldToolResults` 调用处
