# 上下文管理体系优化

> 参考 Claude Code 源码的上下文管理体系，与 CodePilot 对比分析，提炼可借鉴和优化的方向。
> 技术实现跟踪见 [docs/exec-plans/superseded/context-storage-migration.md](../exec-plans/superseded/context-storage-migration.md)
> 最后更新：2026-04-02（实施完成）

## 架构对比总览（实施后）

| 维度 | Claude Code | CodePilot (已实现) |
|------|-------------|-------------------|
| 上下文窗口管理 | 精细的多级 token 预算系统 | `estimateContextTokens` 粗估 + 80% 阈值自动压缩 + token 预算截断 |
| 压缩策略 | 4 级：Micro → Session Memory → Auto Compact → Context Collapse | 3 级：Microcompaction → Auto Compact (80%) → Reactive Compact (PTL) |
| System Prompt | 模块化 section 系统 + 静态/动态分离 + cache_control 精细标记 | 静态前缀 + 动态后缀分离（widget→session→identity→volatile） |
| 消息归一化 | normalizeMessagesForAPI + 工具字段剥离 + 媒体限制 + 孤立修复 | `normalizeMessageContent` + `microCompactMessage` + 媒体限制 (100) |
| 记忆系统 | CLAUDE.md 4 级层级 + session memory 自动提取 | Workspace 文件 + 每 3 轮自动提取 + MCP 搜索 + session summary |
| Token 计数 | 精确 API 计数 + Haiku fallback + 粗估 (4B/tok) | `roughTokenEstimate` 粗估 (4B/tok, JSON 2B/tok) + API usage 记录 |
| 缓存策略 | Prompt cache 精细控制（静态/动态边界 + 1h TTL） | 静态/动态分离提高缓存命中率（无显式 cache_control） |
| 工具上下文 | Microcompact 去重 + token 预算裁剪 + tool deferral | keyword-gated MCP + microcompaction (年龄分级 5K/1K) |
| 上下文可视化 | Warning/Error/Blocking 三级阈值 + percentLeft | 双指标（实际 + 下一轮预估）+ warning/critical 状态 |
| 熔断与恢复 | 连续 3 次失败停止 + PTL 回退裁剪 + reactive compact | 熔断器 (3 次) + PTL reactive compact + 预算自动重算 |
| Fallback 质量 | compact boundary + 摘要 + 文件恢复 | token 预算截断 + 工具摘要保留 + session summary 骨架 |

---

## 原始分析记录

> **注意**：以下 P0-P11 章节是实施前的原始分析，描述的是当时的缺口。实施后的最终状态见文末「实施状态（最终版）」章节。保留原始分析是为了记录"为什么要做这些"的决策依据。

## 第一轮分析：核心能力缺口（P0-P5）

### P0: 主动上下文压缩（当前完全缺失）

**Claude Code 做法：** 四级压缩体系

1. **Microcompaction** — 每轮自动执行，无需额外 API 调用
   - 按工具类型针对性压缩：Read/Bash/Grep/Glob/WebSearch/WebFetch/Edit/Write
   - 单文件 5K token 上限，技能 25K 总预算
   - 自动剥离图片 block（替换为 `[image]` 标记）
   - Time-based clearing：超过时间窗口的旧工具结果清空为 `[Old tool result content cleared]`
   - **Cached microcompact**（高级）：用 cache_edits block 做增量截断，避免缓存失效

2. **Session Memory Compaction** — 用 session memory 替代完整对话做摘要
   - 在 auto compact 之前先尝试 session memory compaction
   - 保留最近窗口的消息，摘要存入 `.claude/MEMORY.md`

3. **Auto Compaction** — 超过阈值时触发完整压缩
   - 阈值 = 有效窗口 - 13K buffer（`AUTOCOMPACT_BUFFER_TOKENS`）
   - Warning 阈值 = -20K buffer
   - Blocking 阈值 = -3K buffer（手动 compact 才能解除）
   - 熔断器：连续 3 次失败后停止自动压缩
   - PTL 回退：compact 本身触发 prompt-too-long 时，按 API-round 分组裁剪头部
   - 压缩后恢复：最多 5 个文件、50K token 预算、5K/文件、25K/技能

4. **Context Collapse**（最新实验性功能）
   - 90% 时开始 commit 上下文、95% 时阻塞新 spawn
   - 替代 auto compact 的更精细方案

**CodePilot 现状：** 依赖 SDK session resume，resume 失败时 fallback 到最近 50 条消息文本拼接。没有任何主动压缩，长对话会丢失早期上下文。

**建议：**
- Phase 1：实现 Microcompaction — 对历史消息中的工具结果按类型裁剪（最低成本最高收益）
- Phase 2：实现 Auto Compaction — 设定 token 阈值触发压缩，利用现有 memory-extractor 产出的 daily memory 作为骨架
- Phase 3：实现 blocking limit + 手动 `/compact` 命令

---

### P1: Token 预算与窗口感知（当前完全缺失）

**Claude Code 做法：**
- 每个模型有明确的 context window / output token 配置
- `tokenCountWithEstimation()` 不调用 API 就能估算当前 token 用量
- `roughTokenCountEstimation()` — 4 bytes/token（JSON/JSONL 密集内容 2 bytes/token）
- `contextAnalysis.ts` 追踪每类内容（工具请求/结果/人类/助手）的 token 占比
- 重复文件读取检测 + 浪费 token 统计
- 预算倒计时：跟踪 continuation 次数，检测收益递减（500 token 阈值）
- `calculateTokenWarningState()` 返回 percentLeft + 4 级布尔状态

**CodePilot 现状：** 只记录 API 返回的 `input_tokens` / `output_tokens`，不做预估，不做预算管理。

**建议：**
- 添加 `roughTokenEstimate(text: string)` — 4 chars ≈ 1 token 的粗估
- 在 stream-session-manager 中维护累积 token 计数（input_tokens 从 API usage 获取）
- 前端展示 context 使用率进度条
- 检测重复文件读取并警告

---

### P2: Prompt Cache 精细控制

**Claude Code 做法：**
- System prompt 分为 **cached sections**（`systemPromptSection()`，跨请求缓存）和 **volatile sections**（`DANGEROUS_uncachedSystemPromptSection()`，每次变化）
- 静态段在 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 标记之前
- 每个 API 请求恰好一个 `cache_control` 标记
- **Sticky-on beta header latches**：AFK mode / fast mode / cache editing / thinking clear — 在 `/clear` 和 `/compact` 时才重置
- Cache-breaking instrumentation 追踪缓存命中率
- **1-hour TTL prompt cache**：付费用户和内部用户可用（vs 默认 5 min）

**CodePilot 现状：** 6 层 context-assembler 拼接后整体作为 `systemPrompt.append` 传入。每次请求可能因微小变化（dashboard summary、memory hint 日期）导致整个 prompt 缓存失效。

**建议：**
- 将 system prompt 分为稳定部分（人格 soul.md、基础指令）和易变部分（dashboard summary、memory hint）
- 稳定部分放在 append 的前部，易变部分放后部
- 避免在 system prompt 中注入时间戳等高频变化内容
- 预估：优化后可节省 30-50% 的 input token 费用

---

### P3: 记忆搜索的时间衰减 ✅ 已有

**CodePilot 现状更正：** memory-search-mcp 已实现 30 天半衰期的指数时间衰减。此项在上次分析时有误，实际已完成。

---

### P4: 工具上下文的 Microcompaction

**Claude Code 做法：** 针对不同工具类型有专门的压缩策略
- **COMPACTABLE_TOOLS** 白名单：Read, Shell (Bash), Grep, Glob, WebSearch, WebFetch, Edit, Write
- 按时间去重旧的工具结果
- 图片 block 上限 2000 token
- 旧工具结果替换为 `[Old tool result content cleared]`

**CodePilot 现状：** 工具结果用 `tool_use_id` 做 last-wins 去重，但没有跨轮次的清理和裁剪。

**建议：**
- 在构建 history fallback 时，对旧轮次的工具结果做摘要化
- 对 Read 工具结果设定单文件 token 上限

---

### P5: Context Window 使用率的前端可视化

**Claude Code 做法：**
- 三级状态：Warning（-20K buffer）→ Error（-20K buffer）→ Blocking（-3K buffer）
- `percentLeft` 百分比计算
- 用户可手动触发 `/compact` 命令

**CodePilot 现状：** 用户对 context 使用情况完全无感知。

---

## 第二轮分析：深度调研新发现

### P6: 消息归一化管线（当前几乎空白）

**Claude Code 做法：** `normalizeMessagesForAPI()` 在发送前执行完整的消息处理管线

1. **工具字段剥离**
   - `stripCallerFieldFromAssistantMessage()` — 移除 tool_use block 的 `caller` 字段
   - `stripToolReferenceBlocksFromUserMessage()` — 移除 tool_reference block
   - 这些字段是 tool-search beta 专有的，发送给不支持的模型会报错

2. **媒体限制**
   - `stripExcessMediaItems()` — 最多 100 个媒体项（API 硬限制）
   - 从最旧的开始移除，保留最近的

3. **孤立工具修复**
   - `ensureToolResultPairing()` — 修复 tool_use 没有对应 tool_result（或反之）的情况
   - compact/snip 后容易出现这种断裂

4. **图片剥离**
   - 压缩前专门调用 `stripImagesFromMessages()` — 图片对摘要没用
   - 替换为 `[image]` / `[document]` 文本标记

5. **重注入附件剥离**
   - `stripReinjectedAttachments()` — 移除 compact 后会重新注入的 skill_discovery/skill_listing 附件

**CodePilot 现状：** `route.ts` 中只做了简单的 `role + content` 映射，无任何归一化。当 SDK resume 失败时，fallback 的 50 条消息只提取文本 block（跳过 tool_use/tool_result），这算是一种粗糙的归一化。

**建议：**
- 实现基本的消息归一化函数
- 关键：处理孤立的 tool_use/tool_result 对
- 对历史消息中过多的图片做裁剪

---

### P7: Token 估算的精细化

**Claude Code 做法：** 三级估算体系

1. **精确计数** — `countMessagesTokensWithAPI()` 调用 API 的 countTokens 端点
2. **模型 fallback** — `countTokensViaHaikuFallback()` 用 Haiku 做 fallback（thinking block 用 Sonnet）
3. **粗估** — `roughTokenCountEstimation()`:
   - 默认 4 bytes/token
   - JSON/JSONL/JSONC 内容 2 bytes/token（密度更高）
   - `roughTokenCountEstimationForMessages()` 对消息数组求和

**CodePilot 可以先实现第 3 级粗估**，成本几乎为零：
```typescript
function roughTokenEstimate(text: string, isJson = false): number {
  const bytesPerToken = isJson ? 2 : 4;
  return Math.ceil(Buffer.byteLength(text, 'utf-8') / bytesPerToken);
}
```

---

### P8: Compact 后的上下文恢复（完全缺失）

**Claude Code 做法：** compact 不是简单的"摘要替换"，而是有完整的恢复流程

1. **文件恢复** — 最多恢复 5 个最近读取的文件（每个 5K token 上限，总 50K token 预算）
2. **技能恢复** — 重新注入已调用的 skills（每个 5K token 上限，总 25K 预算）
3. **附件恢复** — MCP instructions、deferred tools delta、agent listing delta 重新注入
4. **Plan 恢复** — 如果存在活跃 plan，重新读取并注入
5. **Task 恢复** — 如果有 local agent task state，重新注入
6. **Session 元数据恢复** — `reAppendSessionMetadata()` 重新注入 session 上下文

**启发：** CodePilot 未来实现 compact 时，需要考虑 compact 后重新注入关键上下文（dashboard config、最近的 MCP 工具状态等）。

---

### P9: System Prompt 的 Section 缓存机制

**Claude Code 做法：**
```typescript
// 缓存的 section — 计算一次，直到 /clear 或 /compact 才重算
function systemPromptSection(content: string): string

// 危险的非缓存 section — 每轮重算，可能导致缓存失效
function DANGEROUS_uncachedSystemPromptSection(content: string): string
```

- 所有 section 存在 `getSystemPromptSectionCache()` 中
- `/clear` 和 `/compact` 时通过 `clearBetaHeaderLatches()` 清理
- 这让 Claude Code 能精确控制哪些部分可以跨请求缓存

**CodePilot 对比：** context-assembler 每次都完整重算所有 6 层。虽然大部分内容（soul.md、claude.md）在文件没变时是一样的，但拼接方式意味着 API 层面很难命中 prompt cache。

**建议：**
- 分离 context-assembler 为 `getCachedLayers()` 和 `getVolatileLayers()`
- 缓存稳定内容（身份文件、基础指令），只重算易变内容（dashboard、memory hint、heartbeat hint）

---

### P10: PTL (Prompt Too Long) 的优雅降级

**Claude Code 做法：** 多层防线

1. **预防** — autoCompactThreshold（有效窗口 - 13K）触发自动压缩
2. **Warning** — 有效窗口 - 20K 时提醒用户
3. **Blocking** — 有效窗口 - 3K 时阻止新消息
4. **Reactive compact** — API 返回 prompt_too_long 时自动触发压缩重试
5. **PTL 回退裁剪** — compact 本身 PTL 时，按 API-round 分组从头部裁剪
6. **熔断** — 连续 3 次失败后停止自动压缩，避免无限循环

**CodePilot 现状：** 完全没有 PTL 处理。如果上下文超出窗口，API 直接报错，用户无法操作。

---

### P11: CLAUDE.md 的层级发现与优先级

**Claude Code 做法：** 6 级 CLAUDE.md 层级（从低到高优先级）

1. **Managed** — `/etc/claude-code/CLAUDE.md` — 全局策略（IT 管理员设置）
2. **User** — `~/.claude/CLAUDE.md` — 用户私人全局指令
3. **Project** — `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/*.md` — 项目代码库指令
4. **Local** — `CLAUDE.local.md` — 本地私人项目指令（不入 git）
5. **AutoMem** — 用户自动记忆（跨会话持久化）
6. **TeamMem** — 团队共享记忆（组织级同步）

支持 `@include` 指令（带循环引用检测）。

**CodePilot 对比：** 使用 `claude.md` + `soul.md` + `user.md` 三文件体系，更结构化但只在 assistant workspace 内生效。普通项目会话只有 session 级别的 system_prompt，没有项目级 CLAUDE.md 发现机制。

**启发：** 对于非 assistant-workspace 的普通项目会话，可以考虑支持从 `working_directory` 中自动发现 CLAUDE.md。

---

## CodePilot 已有的优势（无需改动）

| 能力 | 说明 |
|------|------|
| **Keyword-gated MCP** | 按关键词动态注册 MCP，避免不需要的工具描述污染 context — Claude Code 的工具始终注册，靠 tool deferral 做延迟加载 |
| **Workspace 人格体系** | soul.md / user.md / claude.md 三文件分离身份、用户画像、行为规则 — 比 Claude Code 的单一 CLAUDE.md 更结构化 |
| **Head+Tail 截断** | 大文件保留头部结构 + 尾部最新内容 — Claude Code 的 memory 文件只做行截断 |
| **Memory 自动提取** | 每 3 轮用 Haiku 自动提取记忆 — 与 Claude Code 的 session memory 思路一致 |
| **Workspace 增量索引** | 基于 mtime 的增量索引 + hotset 机制 — Claude Code 没有等效的文件索引系统 |
| **Memory MCP 按需加载** | 记忆通过 MCP 工具按需搜索，不在 system prompt 中全量注入 — Claude Code 的 CLAUDE.md 是全量注入 |
| **时间衰减搜索** | 30 天半衰期的指数衰减 — 搜索结果自动按时效排序 |

---

## 遗留问题追踪

### 已知遗留问题（来自 context-storage-migration 计划）

| 问题 | 状态 | 位置 |
|------|------|------|
| `projects` 表未创建，session 无项目隔离 | 📋 待开始 | Phase 0 剩余 |
| `canUpdateSdkCwd` 逻辑缺失 | 📋 待开始 | Phase 0 剩余 |
| `message_parts` 结构化消息未实现 | 📋 待开始 | Phase 1 |
| Runtime state 强依赖内存 Map | 📋 待开始 | Phase 2 |
| 50 条固定窗口 fallback | 📋 待开始 | Phase 3 |
| SDK resume 失败后无压缩摘要恢复 | 📋 待开始 | Phase 3 |

### 新发现的遗留问题（第二轮调研）

| 问题 | 严重度 | 说明 |
|------|--------|------|
| 无 PTL 处理 | 高 | API 返回 prompt_too_long 时直接报错，用户无法操作 |
| 消息无归一化 | 中 | 孤立 tool_use/tool_result 可能导致 API 错误 |
| 媒体项无上限 | 中 | 多图对话可能超过 API 的媒体限制 |
| system prompt 无缓存控制 | 中 | 每次微小变化都导致整个 prompt 缓存失效 |
| 普通项目无 CLAUDE.md 发现 | 低 | 非 assistant-workspace 的项目会话无法自动加载项目指令 |

### Codex 交叉审计发现的问题（第三轮调研）

| 问题 | 严重度 | 位置 | 说明 |
|------|--------|------|------|
| **Fallback history 元数据泄漏** | 高 | `claude-client.ts` `buildPromptWithHistory()` | `<!--files:...-->` 附件内部标记会被原样塞入 `<conversation_history>`，模型会看到这些非用户内容 |
| **Fallback history 信息降质** | 高 | 同上 | assistant 消息只保留 text block，tool_use/tool_result 全部丢弃变成 `(assistant used tools)`；既有噪音又有信息损失 |
| **ContextUsageIndicator 指标失真** | 中 | `src/components/chat/` | 读的是最近一条 assistant message 的 `token_usage`，本质是"上一轮 API 消耗"，不是"下一轮会送多少上下文"。两个概念完全不同 |
| **model-context.ts 不感知 1M** | 中 | `src/lib/model-context.ts` | `MODEL_CONTEXT_WINDOWS` 写死 200K，`context_1m` 开关打开后 UI 进度条仍按 200K 算，数据失真 |
| **needsWidgetMcp 返回值无消费者** | 低→中 | `context-assembler.ts` → `route.ts` | assembler 算了 `needsWidgetMcp`，但 `claude-client.ts` 又独立重算一遍再挂 MCP。返回值已是死代码，两套判断未来容易漂移 |
| **loadWorkspaceFiles 残留 V2 死读取** | 低 | `assistant-workspace.ts` | 还在读 daily memories、root docs、HEARTBEAT.md，但 `assembleWorkspacePrompt()` 只用 identity files。V3 迁移后这些读盘路径白白增加启动延迟 |
| **Claude session import 不完整** | 低 | session import 流程 | 导入只写 `sdk_session_id` + transcript，不带入 token usage、compact boundary、system prompt 结构。是"接管句柄"而非保真恢复 |
| **core-system-guardrails.md 文档漂移** | 低 | `docs/future/core-system-guardrails.md` | 仍描述旧架构（memory/daily/retrieval 全在 system prompt 里），与 V3.1 MCP 按需检索的实际实现不一致 |

---

## 实施状态（最终版 2026-04-02）

> 所有计划项均已完成评估。✅ 已实现 / 🔧 SDK 处理 / ⏭ 不做（含原因）

```
Phase 0 (前置清理 + 止血) — ✅ 全部完成
├── ✅ 修复 fallback history 元数据泄漏（strip <!--files:...-->）
├── ✅ 修复 model-context.ts 对 context_1m 的感知
├── ✅ 清理 needsWidgetMcp 双份判断（统一到一处）
├── ✅ 清理 loadWorkspaceFiles 的 V2 残留死读取
└── ✅ 更新 core-system-guardrails.md 使其反映 V3.1 实际架构

Phase 1 (上下文测量) — ✅ 全部完成
├── ✅ estimateContextTokens()（粗估 4B/tok，JSON 2B/tok）
├── ✅ ContextUsageIndicator 双指标（上一轮 usage + 下一轮预估）
├── ✅ PTL reactive compact（后端自动压缩 + 重试）
└── ✅ 媒体项数量限制（max 100）

Phase 2 (Fallback 质量提升) — ✅ 全部完成
├── ✅ Fallback 改为 token 预算截断（200 条 + 动态 budget）
├── ✅ 工具摘要保留（normalizeMessageContent）
├── ✅ 孤立 tool_use 已被 normalizer 消解（变为文本摘要）
└── ✅ Microcompaction 裁剪旧工具结果

Phase 3 (Microcompaction + Prompt 优化) — ✅ 全部完成
├── ✅ Microcompaction 引擎（年龄分级 5K/1K）
├── ✅ System prompt 静态/动态分离
└── 🔧 普通项目 CLAUDE.md — SDK settingSources: ['project'] 已自动发现

Phase 4 (完整压缩体系) — ✅ 核心全部完成
├── ✅ Auto compaction 80% 阈值 + 熔断器
├── ⏭ Compact 后恢复 — fallback 已有 summary 骨架，SDK resume 有完整上下文
├── ✅ /compact 手动命令
├── ✅ Reactive compact（PTL 自动压缩重试）
└── ⏭ Session memory compaction — memory-extractor 已有每 3 轮自动提取

Phase 5 (高级优化) — ⏭ 暂不实施
├── ⏭ Prompt cache 精细控制 — SDK preset append 模式不暴露 cache_control API
├── ⏭ Token 精确计数 — 粗估已满足需求，精确计数增加延迟+费用
├── ⏭ Context 使用分析 — 开发者调试工具，不影响用户体验
├── ⏭ Cached microcompact — 需要 SDK cache_edits API 支持
└── ⏭ Claude session import — 独立功能，不属于上下文管理
```

---

## 总结

CodePilot 在**记忆持久化**和**人格体系**上做得比 Claude Code 更精细，在**MCP 按需加载**上有独特优势。但在**上下文窗口管理**这个核心问题上几乎是空白。

**Claude Code 最值得学习的 5 件事：**

1. **四级压缩体系** — 从零成本的 microcompact 到重量级的 auto compact，梯度清晰
2. **Token 预算意识** — 始终知道离上限有多远，提前触发压缩
3. **PTL 多层防线** — 预防 → 警告 → 阻塞 → 被动压缩 → 裁剪回退 → 熔断
4. **消息归一化** — 在发送前确保消息格式正确，避免 API 级错误
5. **Compact 后恢复** — 压缩不是丢弃，关键上下文会被精确恢复

**Codex 审计的核心观点（第三轮新增）：**

> 第一优先级不是做 fancy 的压缩，而是先把"上下文测量"补起来。不知道上下文有多满，做压缩也是盲打。

具体来说：
- `estimateContextTokens()` 要算"下一轮将发送的真实上下文"，不是上一轮 API 返回的 usage
- ContextUsageIndicator 要改成"双指标"（上一轮 usage + 下一轮预估），不要混在一起
- Fallback 从"最近 50 条消息"改成"摘要 + 最近 token 窗口"是最值钱的一步
- 在测量能力建好之后，再吸收 Claude Code 的 micro-summary / compact boundary / auto compact 才会顺

**建议执行顺序：** Phase 0 止血 → Phase 1 测量 → Phase 2 fallback 质量 → Phase 3+ 压缩体系。每个 phase 独立可交付。
