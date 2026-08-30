# 上下文管理系统 — 技术交接文档

> 产品思考见 [docs/insights/context-management.md](../insights/context-management.md)
>
> 压缩覆盖边界（boundary rowid、不变量、三条压缩路径的一致写法）见
> [compact-coverage-boundary.md](./compact-coverage-boundary.md)

## 概述

上下文管理系统解决长对话的上下文窗口溢出问题。实现于 commits acfe4b7..21635dc，引入三个新模块 + 对已有 claude-client.ts、route.ts、context-assembler.ts 的集成改动。

核心能力：
- **上下文预估** — 发送前估算 token 用量，决定是否触发压缩
- **自动压缩** — 超过 80% 窗口时用 LLM 生成对话摘要
- **消息归一化** — 剥离元数据、摘要化工具调用、按年龄截断
- **PTL 被动压缩** — API 返回 prompt_too_long 时自动压缩重试
- **前端可视化** — 双指标（实际用量 + 下一轮预估）+ 压缩状态

## 目录结构

```
src/lib/
├── context-estimator.ts      # Token 粗估 + 预算计算 + 状态判断
├── context-compressor.ts     # LLM 压缩引擎 + 熔断器
├── context-assembler.ts      # System prompt 静态/动态分离（已有，本次改造）
├── message-normalizer.ts     # 消息清理 + Microcompaction
├── claude-client.ts          # buildFallbackContext 集成 + PTL reactive compact
└── model-context.ts          # context_1m 感知（已有，本次修复）

src/app/api/chat/
└── route.ts                  # 压缩编排：预估 → 阈值检查 → 压缩 → 预算重算

src/hooks/
└── useContextUsage.ts        # 双指标计算（实际 + 预估）

src/components/chat/
└── ContextUsageIndicator.tsx  # 环形进度 + HoverCard 详情 + hasSummary 标记

src/lib/
└── stream-session-manager.ts # context_compressed / context_compressing_retry 事件分发
```

## 三个新模块

### context-estimator.ts

纯计算模块，无副作用，无网络调用。

- `roughTokenEstimate(text, isJson?)` — 4 bytes/token（JSON 2 bytes/token），基于 `Buffer.byteLength`
- `estimateMessageTokens(content)` — 自动检测 JSON 内容
- `estimateContextTokens(params)` — 聚合 system + history + userMessage + summary 的总估算
- `calculateContextPercentage(tokens, window)` — 返回 percentage + state (normal/warning/critical)

阈值：warning >= 80%, critical >= 95%。

### context-compressor.ts

LLM 压缩引擎。

- `needsCompression(tokens, window, sessionId)` — 阈值 80% + 熔断器检查
- `compressConversation(params)` — 主压缩函数：
  1. 通过 `resolveProvider({ useCase: 'small' })` 解析压缩用模型
  2. 用 `normalizeMessageContent` 清理消息后截断到 800 字符
  3. 调用 `generateTextViaSdk` 生成摘要
  4. 返回 `{ summary, messagesCompressed, estimatedTokensSaved }`
- 熔断器：per-session，连续 3 次失败后停止压缩（`MAX_CONSECUTIVE_FAILURES`）

### message-normalizer.ts

两层处理管线：

1. **normalizeMessageContent(role, raw)** — 始终应用：
   - 剥离 `<!--files:...-->` 内部元数据
   - assistant JSON 消息：提取 text block + tool_use 摘要（`(used tool_name: truncated_input)`）
   - tool_result block 被跳过（intent 已由 tool_use 摘要覆盖）

2. **microCompactMessage(role, content, ageFromEnd)** — fallback 路径应用：
   - 近 30 条消息：5000 字符上限
   - 超过 30 条的旧消息：1000 字符上限
   - Head+Tail 截断策略（70% 头部 + 30% 尾部 + `[...truncated...]` 标记）

## 数据流

### 正常路径（route.ts 编排）

```
用户消息到达 POST /api/chat
│
├── 1. 解析模型 → getContextWindow(model, { context1m })
│
├── 2. 归一化预估（与 buildFallbackContext 一致）
│   ├── normalizeMessageContent() 每条消息
│   ├── microCompactMessage() 按年龄截断
│   └── estimateContextTokens() 聚合
│
├── 3. 计算 fallback token 预算
│   budget = window * 0.7 - system - summary - userMessage
│
├── 4. needsCompression(estimate.total, window, sessionId)?
│   │
│   ├── YES → 确定 keep/compress 分界线（保留最近 50% 窗口）
│   │   ├── compressConversation(older messages)
│   │   ├── updateSessionSummary(sessionId, summary)
│   │   ├── 重算预算（用新 summary 大小）
│   │   └── compressionOccurred = true
│   │
│   └── NO → 跳过
│
├── 5. streamClaude({ sessionSummary, fallbackTokenBudget, ... })
│   └── SDK 调用 → resume 成功则忽略 fallback
│       └── resume 失败 → buildFallbackContext(prompt, history, summary, budget)
│
└── 6. SSE 事件流
    └── compressionOccurred → emit context_compressed 事件
```

### PTL Reactive Compact（claude-client.ts 内部）

```
SDK 返回 CONTEXT_TOO_LONG 错误
│
├── ptlRetryAttempted? → YES → 跳过，走正常错误处理
│
├── NO →
│   ├── emit status: context_compressing_retry
│   ├── compressConversation(全部历史)
│   ├── updateSessionSummary
│   ├── 重算预算（保守 50% 窗口）
│   ├── 清空 sdkSessionId（确保 retry 走 fallback）
│   ├── buildFallbackContext(prompt, history, summary, retryBudget)
│   ├── 重新 query() → 转发 stream 事件
│   └── emit context_compressed
│
└── retry 失败 → fall through 到正常错误显示
```

### buildFallbackContext（claude-client.ts）

```
输入：prompt, history, sessionSummary, tokenBudget
│
├── 无历史 → 直接返回 prompt
│
├── normalize + microCompact 每条消息（年龄分级）
│
├── token 预算截断（从最新往回累加，budget 下限 10K）
│
├── 组装输出：
│   ├── <conversation_summary> (如有 summary)
│   ├── <conversation_history>
│   │   └── Human/Assistant 交替
│   └── Human: {当前 prompt}
│
└── 返回完整 prompt 字符串
```

## DB Schema

`chat_sessions` 表新增两列：

| 列 | 类型 | 默认值 | 说明 |
|----|------|--------|------|
| context_summary | TEXT | '' | LLM 生成的对话摘要 |
| context_summary_updated_at | TEXT | '' | 摘要最后更新时间 |

迁移方式：`safeAddColumn`（ADD COLUMN IF NOT EXISTS），无数据丢失风险。

相关函数：
- `getSessionSummary(sessionId)` → `{ summary, updatedAt }`
- `updateSessionSummary(sessionId, summary)` — 同时写入时间戳

## 关键设计决策

### 1. SDK subprocess 做压缩 LLM 调用

压缩模块最初尝试用 `@ai-sdk/anthropic` 的 `generateText` 做 LLM 调用。问题：第三方 provider（如 GLM、Kimi）通过代理 URL 连接，`@ai-sdk/anthropic` 不走代理。

解决方案：改用 `generateTextViaSdk`，即通过 Claude Code SDK subprocess 发起调用。SDK 继承用户配置的 provider transport（包括代理 URL），确保所有 provider 的压缩都能正常工作。

相关 commit: `8f8b0d9`

### 2. Provider-aware 模型解析

压缩器需要用小模型（Haiku 级别）来生成摘要。解析链：

1. `resolveProvider({ useCase: 'small', providerId, sessionModel })`
2. 优先使用 provider 的 `roleModels.small` 配置
3. fallback 到 catalog 中的 `upstreamModelId`
4. 最终 fallback 到 session model 或 `'haiku'`

这确保第三方 provider 用自己的小模型做压缩（如 GLM 用 GLM-4-Flash），而非强制调用 Anthropic Haiku。

相关 commit: `a2f29ea`, `9eb3d52`

### 3. 静态/动态 Prompt 分离

context-assembler.ts 将 system prompt 分为两部分：

**静态前缀**（跨请求稳定，利于 prompt cache）：
1. WIDGET_SYSTEM_PROMPT — 编译时常量
2. session.system_prompt — 创建时设置
3. Workspace identity files — 文件修改时才变

**动态后缀**（每轮可能变化）：
4. Memory hint — 每日变化
5. Assistant instructions — 取决于 onboarding/heartbeat 状态
6. Dashboard summary — 随 widget 操作变化
7. systemPromptAppend — 每请求（技能注入等）

稳定内容在前，Anthropic API 的 prompt cache 从头部开始匹配，最大化缓存命中。

相关 commit: `3f90039`

### 4. Microcompaction 年龄阈值

两级截断策略：
- 最近 30 条消息：每条最多 5000 字符（`RECENT_CONTENT_LIMIT`）
- 更老的消息：每条最多 1000 字符（`OLD_CONTENT_LIMIT`）

Head+Tail 截断保留头部结构 + 尾部最新内容。阈值 30 条是经验值——大多数用户在 30 轮内完成一个任务上下文，更早的消息通常只需保留概要。

### 5. 压缩后预算重算

压缩生成的 summary 可能比原始消息小很多，也可能仍然较大。压缩后必须重新计算 fallback token budget：

```
newBudget = window * 0.7 - systemTokens - newSummaryTokens - userMsgTokens
```

不重算会导致 budget 基于旧 summary 大小（通常为 0），给历史消息分配过多空间，挤占 output 预算。

相关 commit: `6d50b98`

### 6. PTL Reactive Compact + 熔断器

PTL（Prompt Too Long）是 API 层面的硬限制。处理策略：
- 单次请求最多 retry 一次（`ptlRetryAttempted` flag）
- retry 用保守的 50% 窗口预算
- 清空 `sdkSessionId` 确保 retry 走 fallback 路径
- 熔断器：per-session 连续 3 次压缩失败后停止（避免无限循环）
- `resetCompressionState(sessionId)` 用于手动 `/compact` 时重置熔断器

相关 commit: `03d8f00`, `3f90039`

### 7. 媒体项数量限制

API 硬限制 100 个媒体项。实现策略：
- 计数超过 100 时，`slice(-MAX_MEDIA_ITEMS)` 保留最新的
- 被丢弃的旧图片在 content blocks 中添加文本说明
- 文本引用（file path reference）只为实际包含的图片生成

保留最新（而非最旧）与"近期上下文更重要"的整体策略一致。

相关 commit: `21635dc`, `670ba71`

## 前端

### ContextUsageIndicator

环形 SVG 进度圈 + HoverCard 浮层，显示：
- 模型名 + 上下文窗口大小
- 实际用量（from last API response token_usage）
- 百分比
- 下一轮预估（current input + this output + 200 overhead）
- Cache 明细（read / creation / output）
- hasSummary 标记（绿色 "Active" 标签）
- Warning/Critical 提示文字

**双指标设计**：warning state 取实际 ratio 和预估 ratio 中较高者。这解决了"当前轮还没到 80%，但下一轮必然超"的场景。

### hasSummary 检测

前端通过两个途径感知 summary 状态：
1. **初始加载** — `ChatView` 从 DB 读取 `getSessionSummary(sessionId).summary`
2. **实时更新** — `stream-session-manager` 监听 SSE `context_compressed` 事件，dispatch `CustomEvent('context-compressed')`

`ChatView` 在两个事件源上维护 `hasSummary` state，传入 `ContextUsageIndicator`。

### context_compressing_retry 状态

PTL reactive compact 期间，`stream-session-manager` 收到 `context_compressing_retry` 事件后更新 snapshot 的 `statusText` 为 `'Compressing context...'`，让用户知道系统在自动处理。

## 已知局限

1. **Token 估算是粗估** — 4B/tok 对非英文内容偏差较大（中文可能 2-3B/tok），但精确计数需要 API 调用，增加延迟
2. **无 prompt cache 精细控制** — SDK preset append 模式不暴露 `cache_control` API，静态/动态分离只能提高命中概率，无法保证
3. **压缩不可逆** — 一旦 summary 覆盖了旧 summary，原始对话细节永久丢失（DB 中原始消息仍保留，但不参与后续 context）
4. **Compact 后无上下文恢复** — Claude Code 在 compact 后会恢复最近读取的文件、活跃的 plan 等。CodePilot 只有 summary + 最近消息
5. **单模型压缩** — 压缩和主对话用同一个 provider 通道，如果 provider 限流可能影响压缩质量
6. **无 blocking 阈值** — 没有阻止用户继续发送的硬限制，极端情况下可能连续触发 PTL

## 关键文件索引

| 用途 | 文件 |
|------|------|
| Token 估算 | `src/lib/context-estimator.ts` |
| LLM 压缩引擎 | `src/lib/context-compressor.ts` |
| 消息归一化 | `src/lib/message-normalizer.ts` |
| System prompt 分离 | `src/lib/context-assembler.ts` |
| Fallback + PTL retry | `src/lib/claude-client.ts` |
| 压缩编排 | `src/app/api/chat/route.ts` |
| 前端指标计算 | `src/hooks/useContextUsage.ts` |
| 前端 UI | `src/components/chat/ContextUsageIndicator.tsx` |
| SSE 事件分发 | `src/lib/stream-session-manager.ts` |
| DB schema + 读写 | `src/lib/db.ts` |
| 单元测试 | `src/__tests__/unit/message-normalizer.test.ts` |
| 原始分析文档 | `docs/future/context-management-optimization.md` |
