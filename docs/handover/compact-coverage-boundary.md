# Compact Coverage Boundary — 技术交接文档

> 上下文管理系统整体见 [context-management.md](./context-management.md)。这份文档只讲一件事：**压缩覆盖边界**的不变量、DB 表示、实现入口。

## 背景

一个 session 的 `chat_sessions.context_summary` 只覆盖曾被喂给 summarizer 的那些 message；summary 之后新增的 message 必须继续作为 context 进入下一轮。需要一个"覆盖边界"字段来区分这两部分，否则会出现三种 bug：

1. **模型输出假工具调用**：压缩后的 fallback history 里把旧 tool_use 渲染成 `(used Read: {...})` 文本，模型当成 few-shot 范例模仿，不再发真正的 `tool_use` block。
2. **每轮都重新自动压缩**：token 估算看不到 boundary，summary + 全量旧历史 vs context window 判定永远 "超阈值"，每轮都重新触发压缩。
3. **silently drop unsummarized user turn**：auto pre-compression 把当前 user message 留到下一轮时，如果 boundary 用 "summary 写入时间"，下一轮 filter 会把这条 user message 误当成 "已覆盖" 丢掉，模型看到无 prompt 的 assistant 回复。

这份文档规约的所有代码都是为了解决这三类 bug。

## 核心不变量（必读）

### 1. Boundary 用 SQLite rowid，不得用时间戳

- ✅ `chat_sessions.context_summary_boundary_rowid` (INTEGER)
- ❌ `chat_sessions.context_summary_updated_at` (TEXT)——**不是**覆盖边界，只是 summary 写入时间戳，仅供 UI/debug
- ❌ `chat_sessions.context_summary_boundary_at` (TEXT)——legacy 字段，保留 schema 兼容，代码不再读写

**理由**：DB 时间戳是 `YYYY-MM-DD HH:MM:SS` 秒级精度。auto pre-compression 的"最后一条被压缩消息" 和 "第一条 messagesToKeep" 完全可能同秒写入，strict-gt 时间戳 filter 会误分类其中一条。rowid 是插入单调递增的，天然消歧。Claude Code 源码对 compact boundary 也是用 uuid 而非时间戳。

### 2. Boundary 只前进不后退

任何写 boundary 的路径必须保证新 boundary ≥ 原 boundary。degraded 路径（拿不到 rowid）必须退回"保留原 boundary"，**绝不能写 0 覆盖一个已建立的 boundary**。否则下一轮 filter 会退化到 passthrough，pre-boundary 的 history 又被重新喂给模型。

Helper `resolveReactiveCompactBoundaryRowid` 在两层做这个 guard：
- 拿不到新 rowid 时 fallback 到 `existingBoundaryRowid`
- 拿到新 rowid 也取 `Math.max(newRowid, existingBoundaryRowid)`——即使 caller 传入未经 filter 的 history 也不会回退

### 3. Slash-command 反馈不入 DB transcript

`/compact` 的两个分支（成功 / no-op 短对话）都**不**调 `addMessage` 持久化。SSE frame 把文字推给 UI 即可。

**理由**：这类消息的 rowid 会 > boundary，被下一轮 filter 保留，模型在未来的 transcript 里看到 "上下文已压缩..." 这种系统语，在多轮 `/compact` 之后甚至可能被下次真压缩吃进 summary。Claude Code 的 `processSlashCommand.tsx:680` 同样处理。

Regression：`context-compressor-handoff.test.ts` 里 `/compact handler — no DB transcript writes` 用 source-scan 锁住这条 invariant。

### 4. 压缩前先按 boundary filter，避免重复总结

手动 `/compact` 和 auto pre-compression 走同一条规则：**只把 boundary 之后的 rows 喂给 compressor**，`existingSummary` 当作上文上下文传入由 summarizer 增量扩写。直接把全量 history 再喂一遍，summarizer 会把已覆盖内容在新 summary 里重复，浪费 token、可能引入语义漂移。

### 5. 压缩后清 `sdk_session_id` + 走 fresh query

CodePilot 生成 summary 后，如果 SDK session 还在 resume，SDK 会用**自己**的 pre-compaction transcript，我们的 summary 根本不会到模型。所以任何 CodePilot-side 压缩（手动 /compact 或 auto pre-compression）成功后必须：
- `updateSdkSessionId(session_id, '')`
- 当轮 streamClaude 的 `sdkSessionId` 传 `undefined`
- 当轮 `conversationHistory` 传 `messagesToKeep`（不是全量 historyMsgs）

`planStreamHandoffAfterCompaction` 纯函数 helper 编码这条规则。

### 6. history 的 `_rowid` 必须端到端不丢

`chat/route.ts` 里两处 map 都要保留 `_rowid`：
- `historyMsgs = historyAfterBoundary.map(m => ({ role, content, _rowid: m._rowid }))`
- `messagesToKeep = rowsToKeep.map(m => ({ role, content, _rowid: m._rowid }))`

`messagesToCompress` 只给 summarizer，可以只传 role/content。

**理由**：如果当轮 fresh SDK query 又触发 `CONTEXT_TOO_LONG` reactive compact，claude-client 内部从 `conversationHistory` 取 rowid 写 boundary。丢了 rowid → degraded 路径。

Regression：`chat route rowid propagation` source-scan 测试锁住这两处 map 必须包含 `_rowid`。

## DB Schema

`chat_sessions` 表相关列（见 `src/lib/db.ts` 的 `safeAddColumn` 迁移）：

| 列 | 类型 | 默认 | 语义 |
|----|------|------|------|
| `context_summary` | TEXT | `''` | 压缩后的 session 摘要 |
| `context_summary_updated_at` | TEXT | `''` | summary 写入时间（`YYYY-MM-DD HH:MM:SS`）。**仅 UI/debug 用** |
| `context_summary_boundary_at` | TEXT | `''` | **Deprecated**。曾作为 boundary 的时间戳版本，被 rowid 替代。保留字段不删，代码不读 |
| `context_summary_boundary_rowid` | INTEGER | `0` | **权威**。最后一条被 summary 覆盖的 message 的 `rowid`。0 = "boundary 未知"（legacy / degraded path） |

`messages` 表：`rowid` 是 SQLite 隐式列，`getMessages()` 通过 `SELECT *, rowid as _rowid` 暴露到 `Message._rowid?: number`（`types/index.ts`）。

## 关键入口与调用拓扑

### 辅助函数（`src/lib/context-compressor.ts`）

| 函数 | 用途 |
|------|------|
| `filterHistoryByCompactBoundary({history, summary, summaryBoundaryRowid})` | 丢掉 `_rowid <= boundary` 的 rows。summary 空或 boundaryRowid ≤ 0 时 passthrough。无 `_rowid` 的合成 row 永远保留 |
| `planStreamHandoffAfterCompaction({compressed, originalHistory, messagesToKeep, originalSdkSessionId})` | 压缩后决定 streamClaude 的 `sdkSessionId` / `conversationHistory` 取值 |
| `resolveReactiveCompactBoundaryRowid({history, existingBoundaryRowid})` | reactive compact 写 boundary 时的决策。不回退 |
| `buildContextCompressedStatus({messagesCompressed, tokensSaved})` | SSE `context_compressed` 事件 payload 形状。手动 /compact 和 auto 预压缩共用 |

### DB 读写（`src/lib/db.ts`）

| 函数 | 签名 |
|------|------|
| `getSessionSummary(sessionId)` | `{ summary, updatedAt, boundaryRowid }` |
| `updateSessionSummary(sessionId, summary, boundaryRowid)` | **第三参数必填**，number 类型，0 = 未知 |

### 三条压缩路径

**1. 手动 `/compact`**（`src/app/api/chat/route.ts` L82+）

```
getDbSummary → filter by existing boundary → if (new rows < 4) no-op (不入 DB)
  → compressConversation(filteredRows, existingSummary)
  → updateDbSummary(..., lastFiltered._rowid)
  → updateSdkSessionId(session_id, '')
  → emit SSE: context_compressed + text + done
```

**2. Auto pre-compression**（`src/app/api/chat/route.ts` L350+）

```
needsCompression? →
  先在 DB rows (historyAfterBoundary) 上切 rowsToKeep / rowsToCompress
  → compressConversation(rowsToCompress.map(role/content), existingSummary)
  → updateSessionSummary(..., rowsToCompress.last._rowid)
  → updateSdkSessionId('')
  → planStreamHandoffAfterCompaction 切换 streamSdkSessionId=undefined / streamConversationHistory=messagesToKeep
  → SSE: context_compressed 由 chat route 包装器在流头部注入
```

**3. Reactive compact on `CONTEXT_TOO_LONG`**（`src/lib/claude-client.ts` L1590+）

```
SDK 抛 CONTEXT_TOO_LONG →
  compressConversation(conversationHistory, options.sessionSummary)
  → reRead DB boundary = Math.max(getSessionSummary().boundaryRowid, options.sessionSummaryBoundaryRowid ?? 0)
  → resolveReactiveCompactBoundaryRowid({history, existingBoundaryRowid: reRead})
    — history 有 rowid: max(lastKnownRowid, existing)
    — history 无 rowid: existing (degraded, never regress)
  → updateSummary(..., reactiveBoundaryRowid)
  → 用重建的 retryPrompt 重启 query()
  → forward retry stream: system init (session_id) → assistant → user → stream_event → result (session_id)
```

## SSE 事件契约

压缩成功后必须发 `context_compressed` 状态帧，payload 形状（`buildContextCompressedStatus` 唯一真源）：

```json
{
  "notification": true,
  "subtype": "context_compressed",
  "message": "Context compressed: 7 older messages summarized, ~2,906 tokens saved",
  "stats": { "messagesCompressed": 7, "tokensSaved": 2906 }
}
```

`useSSEStream.ts:204` 的 `subtype === 'context_compressed'` 分支 dispatch `onContextCompressed`，stream-session-manager 上抛 `window.dispatchEvent('context-compressed')`，前端 `hasSummary` 翻转。

**三个发送点必须形态一致**：
- `/api/chat/route.ts` 的预压缩包装器（auto 预压缩）
- `/api/chat/route.ts` 的 `/compact` handler
- `claude-client.ts` 的 reactive compact retry loop

任何派生 / 缩减形态（比如旧版本的 `{ notification: true, message: 'context_compressed' }`）会被 `useSSEStream` 的 subtype 分派忽略，`hasSummary` 不翻转。

## 测试与 Regression

集中在 `src/__tests__/unit/context-compressor-handoff.test.ts`：

- `filterHistoryByCompactBoundary` — boundary 过滤行为（8 用例）
- `resolveReactiveCompactBoundaryRowid` — 不回退 / Math.max / rowid=0 当 unknown（8 用例）
- `planStreamHandoffAfterCompaction` — 压缩后 SDK session / history 切换（6 用例）
- `buildContextCompressedStatus` — SSE 形态 + 与 `useSSEStream` 消费契约（2 用例）
- `/compact handler — no DB transcript writes` — source-scan regression
- `chat route rowid propagation` — source-scan regression

## 已知 degraded 路径

**Reactive compact 在 bridge / 非 chat-route 入口触发时**：调用方不传 `_rowid`（synthetic `{role, content}` 对），`resolveReactiveCompactBoundaryRowid` 会走 fallback。此时如果 DB 已有 boundary，新 summary 的 boundary 保持原值不变；如果 DB 没 boundary，新 boundary = 0。不会误删消息，但那轮 reactive compact 的覆盖范围不写进 DB（下一次 boundary-based filter 依然以 DB 里残留的老值为准）。

彻底解决方案是把 reactive compact 从 `claude-client.ts` 上移到 route 层（Method B）——改动面大（重写 streaming retry 状态机 / SSE 续接 / lock renewal / duplicate done-error 抑制），未纳入本轮修复。独立 exec-plan 候选。

## Commit 锚点

完整修复历史在两个 commit 里（压缩自 10 个 iteration）：

- 止血 commit：移除 `(used X: {...})` 伪工具调用（XML 标记 + retry loop session_id 持久化 + `context_compressed` 事件形态统一）
- 覆盖边界实施 commit：DB rowid 列 + filter helper + handoff helper + reactive boundary helper + /compact 和 auto 两路改造 + Method A rowid 穿透

`git log --oneline --follow src/lib/context-compressor.ts` 可查演进脉络。
