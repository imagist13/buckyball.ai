# 深度调研：会话管理与上下文压缩 — 脱离 SDK 独立实现

> 关联任务：decouple-claude-code worktree
> 日期：2026-04-06

---

## 1. CodePilot 当前会话存储结构

### 1.1 DB Schema（chat_sessions + messages）

**chat_sessions 表核心字段：**

| 字段 | 类型 | 用途 |
|------|------|------|
| `id` | TEXT PK | 会话 UUID |
| `title` | TEXT | 会话标题 |
| `model` | TEXT | 使用的模型 |
| `sdk_session_id` | TEXT | SDK 会话 ID（用于 resume） |
| `working_directory` | TEXT | 工作目录 |
| `context_summary` | TEXT | 上下文压缩摘要 |
| `context_summary_updated_at` | TEXT | 摘要更新时间 |
| `provider_id` | TEXT | API 提供商 ID |
| `sdk_cwd` | TEXT | SDK 的实际工作目录 |
| `runtime_status` | TEXT | 运行时状态 |
| `mode` | TEXT | 模式 (code/plan/ask) |
| `permission_profile` | TEXT | 权限配置 |

**messages 表：**

| 字段 | 类型 | 用途 |
|------|------|------|
| `id` | TEXT PK | 消息 UUID |
| `session_id` | TEXT FK | 所属会话 |
| `role` | TEXT | user / assistant |
| `content` | TEXT | 消息内容（纯文本或 JSON content blocks） |
| `created_at` | TEXT | 创建时间 |
| `token_usage` | TEXT | token 用量 JSON |
| `is_heartbeat_ack` | INTEGER | 心跳确认标记 |

### 1.2 消息内容格式

消息的 `content` 字段有两种格式：

1. **纯文本** — 简单的用户消息或纯文本助手回复
2. **JSON content blocks** — 包含 thinking、tool_use、tool_result 的复合消息：

```json
[
  { "type": "thinking", "thinking": "..." },
  { "type": "text", "text": "..." },
  { "type": "tool_use", "id": "...", "name": "Read", "input": {...} },
  { "type": "tool_result", "tool_use_id": "...", "content": "..." }
]
```

消息在 `stream-session-manager.ts` 的 `runStream()` 完成时序列化为 `finalMessageContent`，然后由 chat API route 的 `addMessage()` 持久化到 DB。

### 1.3 SDK Session 关系

当前的会话恢复完全依赖 SDK：

1. **首次消息** → SDK 创建新的 conversation，生成 `sdk_session_id`（对应 `~/.claude/projects/` 下的 JSONL 文件）
2. **后续消息** → `claude-client.ts` 检查 `sdkSessionId`，设置 `queryOptions.resume = sdkSessionId`
3. **Resume 失败处理** → 自动 fallback 到 `buildFallbackContext()`，从 DB 历史构建上下文
4. **Crash/超时** → 清除 `sdk_session_id`，下次消息从 DB 历史重建

**关键发现：CodePilot 已经有一个完整的 DB-based fallback 路径（`buildFallbackContext`），SDK resume 只是一个优化而非必需。**

### 1.4 Fallback Context 构建流程

`buildFallbackContext()` 在 `claude-client.ts` 中：

1. 从 DB 取最近 200 条消息（`getMessages(session_id, { limit: 200 })`）
2. 对每条消息做 `normalizeMessageContent()` — 清理 metadata、提取工具摘要
3. 对旧消息做 `microCompactMessage()` — 截断超长内容
4. 按 token budget 反向选择消息（从最新开始，直到 budget 耗尽）
5. 如果有 `sessionSummary`，在消息列表前方添加 `<session-summary>` 块
6. 组装为 `"<session-summary>...\n\nUser: ...\nAssistant: ...\n\n{当前prompt}"` 格式

### 1.5 conversation-registry.ts

这是一个简单的 `Map<string, Query>`，用 `globalThis` 存活于 HMR。存储 SDK 的 `Query` 对象引用，用于 interrupt 等操作。脱离 SDK 后这个文件将不再需要（或者改为存储自建 agent loop 的 AbortController）。

---

## 2. 上下文压缩的三种策略详解

基于 Claude Code 源码（`/资料/src/services/compact/`）分析，压缩分为三个层级：

### 2.1 Microcompact（工具结果清理）

**位置**：`microCompact.ts`

**触发条件**：每次 API 请求前自动运行

**三个子模式**：

#### a) Time-based Microcompact
- **触发条件**：距上次 assistant 消息的时间间隔超过阈值（由 GrowthBook 配置 `gapThresholdMinutes`）
- **行为**：清除除最近 N 个（`keepRecent`）外的所有可压缩工具的 tool_result 内容，替换为 `[Old tool result content cleared]`
- **原理**：长时间不活动 → 服务器缓存已过期 → 反正要重新计算全部前缀，不如先清理

#### b) Cached Microcompact（cache editing）
- **触发条件**：仅在 Anthropic 内部构建、支持 cache_editing 的模型上启用
- **行为**：通过 API 的 `cache_edits` 机制删除旧 tool_result，不修改本地消息内容
- **优势**：保持 prompt cache 有效，只编辑缓存中的特定工具结果
- **关键**：不改本地 messages，通过 `cache_reference` + `cache_edits` 在 API 层删除

#### c) 可压缩工具列表
仅处理以下工具的结果：`FileRead`, `Shell/Bash`, `Grep`, `Glob`, `WebSearch`, `WebFetch`, `FileEdit`, `FileWrite`

**CodePilot 参考价值**：CodePilot 已有 `microCompactMessage()` 函数（在 `buildFallbackContext` 中使用），但仅做简单截断。可以增强为基于工具名的选择性清理。

### 2.2 Auto-Compact（自动全文压缩）

**位置**：`autoCompact.ts` + `compact.ts`

**触发条件**：
```
tokenCount >= effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS(13K)
```
其中 `effectiveContextWindow = contextWindow - min(maxOutputTokens, 20K)`

**熔断机制**：连续 3 次失败后停止重试（`MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`）

**压缩流程**（`compact.ts: compactConversation()`）：

1. **Pre-compact hooks** — 运行用户自定义钩子
2. **创建压缩请求** — 使用 `getCompactPrompt()` 构建总结指令
3. **调用 forked agent** — 用同一个模型生成摘要（利用 prompt cache sharing）
4. **PTL 重试** — 如果压缩请求本身超出 prompt-too-long，逐步删除最旧的 API-round 组重试（最多 3 次）
5. **Post-compact 处理**：
   - 清除 `readFileState` 缓存
   - 重新注入最近读取的 5 个文件（≤5K tokens/file）
   - 重新注入 plan、skill、MCP 指令等 attachment
   - 运行 SessionStart hooks
6. **替换消息** — 创建 `compactBoundary` 标记 + 摘要 user 消息，替换所有旧消息

**压缩 Prompt 结构**（`prompt.ts`）：

系统指令要求生成 9 个章节的详细摘要：
1. Primary Request and Intent
2. Key Technical Concepts
3. Files and Code Sections（含完整代码片段）
4. Errors and fixes
5. Problem Solving
6. All user messages（逐条列出）
7. Pending Tasks
8. Current Work
9. Optional Next Step

使用 `<analysis>` + `<summary>` 两阶段输出：analysis 是 scratchpad（事后剥离），summary 是最终摘要。

**Post-compact 摘要消息格式**：
```
This session is being continued from a previous conversation that ran out of context.
The summary below covers the earlier portion of the conversation.

Summary:
1. Primary Request and Intent: ...
...
```

### 2.3 Reactive Compact（413 错误触发的被动压缩）

**位置**：CodePilot 的 `claude-client.ts` 已有实现

**触发条件**：API 返回 `CONTEXT_TOO_LONG` 错误

**CodePilot 当前实现**：
1. 检测到 `CONTEXT_TOO_LONG`
2. 调用 `compressConversation()`（在 `context-compressor.ts`）
3. 将摘要写入 `context_summary` 字段
4. 清除 `sdk_session_id`
5. 用压缩后的上下文重新发送请求

**Claude Code 的实现更复杂**：有专门的 reactive compact 路径，会用 partial compact（仅压缩尾部最近消息）并保留前缀缓存。

---

## 3. 自管理会话恢复方案

### 3.1 核心思路：DB 历史 → messages 数组 → 直接送入 streamText

脱离 SDK 后，不再有 `resume` 机制。每次 API 调用需要自己构建完整的 messages 数组：

```
system prompt + [message history from DB] + [current user message]
```

### 3.2 消息重建流程

```
┌──────────────────────────────────────────────┐
│  1. 从 DB 加载消息                            │
│     getMessages(sessionId, { limit: 200 })    │
├──────────────────────────────────────────────┤
│  2. 检查是否有 context_summary                │
│     → 有：以摘要作为前置上下文                  │
│     → 无：使用完整历史                         │
├──────────────────────────────────────────────┤
│  3. Content block 解析                        │
│     对每条 DB 消息的 content：                  │
│     - 尝试 JSON.parse → content blocks 数组    │
│     - 失败 → 当作纯文本                        │
├──────────────────────────────────────────────┤
│  4. 构建 API messages 数组                     │
│     - content_summary → system prompt 追加     │
│       或首条 user 消息                         │
│     - 历史消息 → role + content blocks          │
│     - 当前用户消息 → 最后一条                   │
├──────────────────────────────────────────────┤
│  5. Token 预算控制                             │
│     反向选择消息直到 budget 耗尽                │
│     保证至少保留最近 N 轮对话                   │
├──────────────────────────────────────────────┤
│  6. 送入 streamText / Vercel AI SDK            │
└──────────────────────────────────────────────┘
```

### 3.3 Content Block 转换

DB 中的 content blocks 需要转换为 API 兼容格式：

| DB 格式 | Anthropic API 格式 | 备注 |
|---------|-------------------|------|
| `{ type: "text", text: "..." }` | `{ type: "text", text: "..." }` | 直接透传 |
| `{ type: "thinking", thinking: "..." }` | 不发送 | thinking 只用于 UI 展示 |
| `{ type: "tool_use", id, name, input }` | `{ type: "tool_use", id, name, input }` | 透传 |
| `{ type: "tool_result", tool_use_id, content }` | `{ type: "tool_result", tool_use_id, content }` | 透传 |

**注意**：thinking blocks 在发送给 API 时应剥离（API 不接受历史 thinking blocks 作为输入，除非使用 extended thinking 的 streaming 续传，但那需要 thinking signature）。

### 3.4 与 SDK resume 的对比

| 维度 | SDK resume | 自建 DB 恢复 |
|------|-----------|-------------|
| 上下文完整性 | SDK 保存完整对话（含内部状态） | 只有 DB 中的 user/assistant 消息 |
| Prompt cache | 完美命中（相同前缀） | 每次新请求可能 miss（但 Anthropic API 会自动缓存） |
| 工具结果保存 | SDK 内部保留完整 tool_result | 需要决定是否在 DB 中保存 tool_result |
| 恢复延迟 | ~200ms（读 JSONL） | ~50ms（SQLite 查询）+ 构建时间 |
| 可靠性 | 依赖 JSONL 文件完整性 | SQLite WAL 模式，更可靠 |
| 灵活性 | 无法自定义压缩策略 | 完全可控 |

### 3.5 需要新增的 DB 字段

当前 `messages` 表的 content 是纯文本/JSON，但缺少一些自管理需要的信息：

```sql
-- messages 表新增字段
ALTER TABLE messages ADD COLUMN message_type TEXT DEFAULT 'normal';
  -- 'normal' | 'summary' | 'compact_boundary'
ALTER TABLE messages ADD COLUMN token_count INTEGER;
  -- 预估 token 数，用于快速 budget 计算
ALTER TABLE messages ADD COLUMN metadata TEXT DEFAULT '{}';
  -- 可扩展元数据（工具名、压缩信息等）
```

---

## 4. 自建上下文压缩方案

### 4.1 三层压缩策略（参考 Claude Code + OpenCode + Codex）

#### 层级 1：Tool Result Pruning（每次请求前）

参考 OpenCode 的 `prune()` 和 Claude Code 的 `microcompact`：

```
触发：每次构建 messages 数组时
策略：
  1. 从最新消息向前遍历
  2. 最近 2 轮对话的 tool_result 保持完整
  3. 更早的 tool_result：
     - 如果 >500 tokens，截断为 "[Tool result truncated: {toolName} - {first 200 chars}...]"
     - 特定工具（Read/Grep/Glob/Bash）的结果优先截断
  4. 记录节省的 token 数用于统计
```

OpenCode 的 prune 实现特别值得参考：
- 从后往前遍历，保护最近 40K tokens 的工具结果
- 超出保护区的工具结果标记 `time.compacted = Date.now()`
- 只有累计超过 20K tokens 才执行清理（避免过度清理）

#### 层级 2：Auto Summary（token 阈值触发）

参考 Claude Code 的 auto-compact：

```
触发条件：estimatedTokens >= contextWindow * 0.85
执行流程：
  1. 用独立 LLM 调用（small/haiku 模型）生成摘要
  2. 摘要存入 chat_sessions.context_summary
  3. 后续请求使用 summary + 最近 N 条消息
  
Prompt 设计（综合三家方案）：
  - Claude Code 的 9 章节结构化模板（最详细）
  - OpenCode 的 Goal/Instructions/Discoveries/Accomplished 模板（最简洁）
  - Codex 的 "handoff summary for another LLM" 定位（最清晰）
```

**推荐 Prompt（综合优化版）**：

```
You are creating a context checkpoint. Summarize the conversation so another AI can seamlessly continue the work.

Include these sections:
1. **Goal**: What the user is trying to accomplish
2. **Key Decisions**: Important technical decisions and user preferences
3. **Files Modified**: List of files read/edited/created with brief descriptions
4. **Current State**: What was being worked on immediately before this summary
5. **Errors & Fixes**: Problems encountered and how they were resolved
6. **Pending Tasks**: What remains to be done
7. **Next Step**: The immediate next action to take

Be precise with file paths, function names, and code references. Preserve the user's exact instructions and constraints.
```

#### 层级 3：Reactive Compress（API 413 触发）

CodePilot 已有此实现（`context-compressor.ts` + `claude-client.ts` 的 CONTEXT_TOO_LONG 处理）。脱离 SDK 后保持不变，但需要：
- 改为直接调用 Anthropic API（而非 `generateTextViaSdk`）
- 压缩后直接重建 messages 数组重试

### 4.2 与 CodePilot 现有机制的关系

CodePilot 已经有：
- `context-compressor.ts` — 基础压缩（层级 3）
- `context-estimator.ts` — token 估算
- `buildFallbackContext()` — 含 microCompact 的上下文构建
- `context_summary` DB 字段 — 摘要存储

**需要增强的部分**：

1. **从被动变主动** — 当前只在 413 错误时压缩，需要增加层级 2 的主动压缩
2. **增强 microcompact** — 当前只做简单截断，需要按工具类型选择性清理
3. **摘要 Prompt 升级** — 当前的摘要 prompt 过于简单（500 字限制），需要用更详细的结构化模板
4. **增量更新** — 支持 partial compact（只压缩旧消息，保留最近几轮）

### 4.3 OpenCode 方案的亮点

OpenCode 的 compaction 有几个值得借鉴的设计：

1. **Compaction as a message** — 压缩结果作为特殊类型的 assistant 消息（`mode: "compaction"`, `summary: true`）存入 DB，而非单独字段
2. **Plugin hooks** — `Plugin.trigger("experimental.session.compacting")` 允许插件注入上下文或替换压缩 prompt
3. **Overflow handling** — 如果连压缩请求本身都超出上下文限制，会截断更早的消息并追加说明
4. **Replay 机制** — 压缩后自动重放最近的用户消息，让模型无缝继续

### 4.4 Codex 方案的亮点

1. **User messages 保留** — 压缩后的历史中保留（截断的）用户消息原文，确保模型知道用户说过什么
2. **Initial context 重注入** — 压缩后重新注入 system instructions、permissions 等，防止丢失
3. **Remote compact 支持** — 对 OpenAI 提供商使用服务端压缩 API（`Compaction` response item）
4. **Ghost snapshots 保留** — 文件快照在压缩后保留，确保 undo 可用

---

## 5. 需要的改动点清单

### 5.1 DB Schema 改动

| 改动 | 文件 | 说明 |
|------|------|------|
| messages 表加 `message_type` | `db.ts` | 区分 normal/summary/compact_boundary |
| messages 表加 `token_count` | `db.ts` | 预估 token 数，加速 budget 计算 |
| 保留 `context_summary` 字段 | `db.ts` | 已有，继续使用 |

### 5.2 消息恢复模块（新建）

| 模块 | 说明 |
|------|------|
| `context-builder.ts` | 从 DB 重建 messages 数组，替代 SDK resume |
| 增强 `context-compressor.ts` | 升级压缩 prompt，支持结构化摘要 |
| 增强 `buildFallbackContext()` | 改为主流程（不再是 fallback） |

### 5.3 Tool Result 管理

| 改动 | 说明 |
|------|------|
| 消息保存时记录 tool blocks | 确保 tool_use/tool_result 完整持久化 |
| `tool-result-pruner.ts`（新建） | 按工具类型和年龄选择性清理 tool_result |

### 5.4 自动压缩集成

| 改动 | 文件 | 说明 |
|------|------|------|
| 请求前 token 检查 | `chat/route.ts` | 估算 tokens，触发主动压缩 |
| 压缩 agent 调用 | `context-compressor.ts` | 独立 LLM 调用生成摘要 |
| 压缩状态通知 | `stream-session-manager.ts` | 通知前端正在压缩 |

### 5.5 现有文件改动

| 文件 | 改动 |
|------|------|
| `claude-client.ts` | 移除 SDK resume 逻辑，`buildFallbackContext` 改名为 `buildContext` 变为主路径 |
| `conversation-registry.ts` | 移除 SDK Query 存储，改为存储 AbortController |
| `stream-session-manager.ts` | 移除 `sdk_session_id` 清除逻辑 |
| `chat/route.ts` | 移除 `sdk_session_id` 传递，增加主动压缩检查 |
| `chat/sessions/[id]/route.ts` | 移除 `sdk_session_id` 更新 |

### 5.6 实现优先级

1. **P0 — 基础会话恢复**：将 `buildFallbackContext` 提升为主路径，确保不依赖 SDK resume 也能正常对话
2. **P0 — Content block 完整保存**：确保 tool_use/tool_result 在 DB 中完整保存并正确还原
3. **P1 — Tool result pruning**：构建 messages 时自动清理旧工具结果
4. **P1 — 主动压缩**：基于 token 阈值触发自动摘要
5. **P2 — 结构化摘要 Prompt**：升级为 Claude Code 级别的详细摘要模板
6. **P2 — Partial compact**：支持只压缩前半部分，保留最近对话

---

## 附录 A：各项目压缩方案对比

| 维度 | Claude Code | OpenCode | Codex | CodePilot（当前） |
|------|------------|---------|-------|-----------------|
| 触发方式 | token 阈值自动 | token 阈值自动 | token 阈值自动 | 仅 413 被动 |
| 压缩执行者 | forked agent（同模型） | 独立 agent 调用 | inline/remote compact | 小模型（haiku） |
| 摘要保存 | 替换 messages 数组 | 特殊 assistant 消息 | 替换 history | session 字段 |
| Microcompact | 3 种子模式 | prune（工具结果清理） | 无 | 简单截断 |
| Post-compact | 文件重注入 + hooks | 自动 continue 消息 | initial context 重注入 | 无 |
| Partial compact | 支持（from/up_to） | 不支持 | 不支持 | 不支持 |
| 用户消息保留 | 摘要中列出 | 隐含在摘要中 | 显式保留原文 | 隐含在摘要中 |
| 熔断机制 | 3 次失败停止 | 无 | 重试 + 截断 | 3 次失败停止 |

## 附录 B：关键代码位置索引

**CodePilot：**
- DB schema + messages 操作：`src/lib/db.ts`
- 流式会话管理：`src/lib/stream-session-manager.ts`
- SDK 会话注册：`src/lib/conversation-registry.ts`
- 上下文构建：`src/lib/claude-client.ts: buildFallbackContext()`
- 上下文压缩：`src/lib/context-compressor.ts`
- Token 估算：`src/lib/context-estimator.ts`
- Chat API 路由：`src/app/api/chat/route.ts`

**Claude Code：**
- 核心压缩：`/资料/src/services/compact/compact.ts`
- 自动压缩触发：`/资料/src/services/compact/autoCompact.ts`
- Microcompact：`/资料/src/services/compact/microCompact.ts`
- 压缩 Prompt：`/资料/src/services/compact/prompt.ts`

**OpenCode：**
- 会话管理：`/资料/opencode-dev/packages/opencode/src/session/index.ts`
- 压缩逻辑：`/资料/opencode-dev/packages/opencode/src/session/compaction.ts`
- DB Schema：`/资料/opencode-dev/packages/opencode/src/session/session.sql.ts`
- 消息模型：`/资料/opencode-dev/packages/opencode/src/session/message-v2.ts`

**Codex：**
- Compact 核心：`/资料/codex-main/codex-rs/core/src/compact.rs`
- Remote compact：`/资料/codex-main/codex-rs/core/src/compact_remote.rs`
- Compact prompt：`/资料/codex-main/codex-rs/core/templates/compact/prompt.md`
- Summary prefix：`/资料/codex-main/codex-rs/core/templates/compact/summary_prefix.md`
