# Issue #635 — SDK stream idle-timeout / liveness 设计稿

> 关联执行计划：[docs/exec-plans/active/v0.56.x-stability-trust.md](../exec-plans/active/v0.56.x-stability-trust.md) Phase 2 Session/Stream cluster（#635）
> 看板：[docs/exec-plans/active/issue-tracker.md](../exec-plans/active/issue-tracker.md) `#635`
> 状态：**核心实现落地（2026-06-26 / apiRetry 显示修复 2026-06-27，全量 3425/3425）。代码层完成（Codex 复审通过）。** `stream-session-manager` 两级 idle 预算（首字节前 600s / 后 330s，按 `sawUpstreamModelOutput`；首字节 = `text`/`thinking`/`tool_use`）+ `claude-client` api_retry → status SSE（→ markActive；前端两入口显示「Retrying upstream」人话、不泄漏 raw JSON）+ keep_alive 死分支标注；guardrail `issue-635-idle-tier.test.ts`（7 例 source-pin，含 P2「恰好 3 处翻标志、result/status/tool_result 不翻」负向 pin + apiRetry 不显示 raw JSON 两入口 pin）。**待（follow-up，不阻塞）**：真实慢 proxy smoke（首 token 前排队 6–9min 不被误 abort）；完整 UI 文案 i18n + 首条 `/chat` 一致等待文案。Tier 2 stream 核心。
> 三层（research 纪律）：A 外部事实（SDK 行为，file:line + 快照）/ B repo facts（file:line）/ C 设计提案。纯设计，无代码改动。

## 一句话结论

#635 = SDK（ClaudeCode）Runtime 下，慢/排队的第三方 proxy 静默超过 5.5 分钟被客户端 idle 计时器**硬 abort**（"Stream idle timeout — no response for 330s"），用户体感"频繁自动中断"。**根因：SDK 排队期 app 层完全静默** —— SDK 自己的 keep_alive 被传输层过滤、`api_retry` 仅在请求失败后才发且被 claude-client 丢弃、首 token 前无 `stream_event`，于是客户端 `lastEventTime` 330s 不更新即 abort。**推荐方向 C（分级超时：首字节前长引信 / 首字节后短 idle）+ B（api_retry 接线），显式拒绝盲 keepalive A（会像 Native 那样掩盖真卡死）。**

---

## 快照固定

| 对象 | 版本 / 日期 | 来源 |
|------|------------|------|
| `@anthropic-ai/claude-agent-sdk` | 0.2.111 | `node_modules/.../sdk.mjs` + `sdk.d.ts`（仓库现装） |
| 产品源 HEAD | `8d7a993`（#629 闭环后）| 本仓库 |
| 记录日期 | 2026-06-26 | 本调研（subagent 全面核验 + 主审 spot-check 2 处核心 claim） |

---

## A. 外部事实 —— SDK 在排队期不给 app 任何 liveness 信号（已核验）

- **keep_alive 被 SDK 传输层过滤、永不到达 app 迭代器。** `sdk.mjs` 的 `Query.readMessages()`：`else if($.type==="keep_alive")continue;`（与 `control_cancel_request` / `transcript_mirror` 并列 continue）。**spot-check 确证**：grep `sdk.mjs` keep_alive，确在 readMessages 内被 `continue` 吞掉，其余消息才 `inputStream.enqueue($)`。
  → **`src/lib/claude-client.ts:2002` 的 `mType === 'keep_alive'` 分支是死代码**（公开 `query()` 迭代器永不 yield keep_alive）。佐证：`src/lib/runtime/event-adapter.ts:188` `keep_alive: null` 注释 "ignored at canonical level (transport)"。
- **CLI 的 keep_alive 是纯本地定时心跳**（非上游字节门控）→ 即便不被过滤也是假 liveness（和 Native 同样的掩盖问题）。
- **`api_retry`（`SDKAPIRetryMessage`, `sdk.d.ts:2022`，`type:'system'/subtype:'api_retry'`）会进迭代器**，但 (a) 仅在 API 请求**失败并将重试**后才发（慢但未失败的排队期保持静默）；(b) claude-client 的 `case 'system'` 只处理 `init`/`status`/`task_notification` 三个 subtype，`api_retry` 被丢弃、无 SSE、无 markActive。
- `SDKKeepAliveMessage`（`sdk.d.ts:2544`）是 `declare type` 未 export、不在 `SDKMessage` union（`:2598`）、只属 `StdoutMessage` 传输通道。
- query() Options **无流式 idle / stream 响应超时项**，唯一 liveness 控制是 `abortController`/`signal`；`includePartialMessages` 开 `stream_event`，但那只在上游开始吐 token **之后**。
- → **慢 proxy 排队期，SDK 公开 `query()` 异步迭代器在 app 层完全静默**（纯挂起、不 yield）。

## B. repo facts（file:line，当前 HEAD）

- **idle timeout**：`stream-session-manager.ts:113` `STREAM_IDLE_TIMEOUT_MS=330_000`；`:386-392` 每 10s 轮询、`Date.now()-lastEventTime>=330s` → `abortController.abort()`。`markActive`（`:383`）被**所有** onXxx 回调调用（onText/onTool*/onStatus/onResult/onKeepAlive `:725`/…），唯一不刷新的是 `onSkillNudge`（`:582-591`，次要、非 blocker）。
- **keep_alive SSE 确实 reset idle**：`useSSEStream.ts:372` `case 'keep_alive' → onKeepAlive` → `markActive`。（但见 A：SDK 路径根本收不到上游 keep_alive。）
- **Native 已掩盖真卡死**：`agent-loop.ts:80` `KEEPALIVE_INTERVAL_MS=15_000`；`:123` `setInterval(keep_alive)` 在 **try（`:161`）之外**，`clearInterval` 在 **finally（`:699`）**。**spot-check 确证**：setInterval 独立于主执行流；主逻辑（streamText / tool / subagent）真卡死、永不返回 → finally 不执行 → 每 15s 仍发 keep_alive → 客户端 idle 安全网在 Native 路径实质被禁用。
- **Native 工具超时只覆盖一部分**：`bash.ts:11` 120s、`grep` 15s、`glob` 10s 有自超时；`read/write/edit`、MCP per-call、subagent、**以及 streamText 模型调用本身（正是 #635 的慢 proxy 卡死点）无超时**，只有 abortSignal。→ 模型层 hang 不被任何工具超时发现。
- **SDK 路径无服务端心跳**：`route.ts` 唯一 setInterval（`:703`）是 DB 发送锁续期、不发 SSE。

## C. 设计提案

### 方向评估

| 方向 | 能否解 #635 | 是否掩盖真卡死 | 可行性 |
|------|------------|---------------|--------|
| **A 盲 keepalive**（SDK 路径加服务端 15s keep_alive SSE，镜像 Native） | ✅ 立刻 | ❌ **会**（继承 Native 缺陷：真卡死的 proxy 永不超时） | 低成本但用户显式反对 |
| **B liveness-aware**（仅在上游真有活动时 reset） | ❌ 对静默排队**不可实现** | ✅ 不掩盖 | 排队期零信号 → 无法区分"活着排队"vs"卡死"；唯一真信号 api_retry 仅失败后、与静默排队正交 |
| **C 分级超时**（首字节前长引信 / 首字节后短 idle） | ✅ | ✅ 不掩盖（仍有真实上界，只是更长、分阶段） | 现有 SSE 回调扇出即可低成本判"是否已有字节" |

### 推荐：C 为主 + 折入 B 的 api_retry 接线 + 显式拒绝 A

**C — 分级 idle 预算（核心）：**

- 在 idle checker 维护一个 `sawUpstreamModelOutput` 标志：收到**首个表示模型已开始输出的 SSE 事件**时翻为 true。**必须落到前端实际消费的 SSE 事件名（Codex P2 修正）**：
  - **算"首字节"** = `text` / `thinking` / `tool_use`（模型开始吐内容 / 调工具）。
  - **不算** = `status` / init（请求上游前就发，不证明上游在响应）；`tool_result` / `tool_output`（工具回传，非模型输出）；**`result`**（turn 终态——若拿 result 翻"首字节"，tool-call-only 首响 / terminal result 会让两级超时语义变歪，故排除）。
  - 注意：前端**无直接 `assistant` SSE**——SDK 的 assistant message 在 claude-client 转成 `tool_use`（含 TodoWrite 的 `task_update`）、stream_event 转成 `text`/`thinking`。所以判定按 **SSE 事件名**落地，不是 SDK message type（设计稿早前的 `stream_event`/`assistant`/`result` 是 SDK 层措辞，已按此订正）。
- 两级预算：
  - **首字节前**（`!sawUpstreamModelOutput`）：用更长、可配的预算 `PRE_FIRST_TOKEN_IDLE_MS`（建议默认 ~600s / 10min，env 可调）——慢第三方 proxy 合法排队数分钟才出首 token。
  - **首字节后**（流中静默）：维持较短 `POST_FIRST_TOKEN_IDLE_MS`（建议保留 330s 或更短，如 180s）——开了流又静默更可能真卡。
- 不掩盖：永久卡死的 proxy 首字节前仍会在 `PRE_FIRST_TOKEN_IDLE_MS` 后 abort —— **这是正确行为，只是更长的引信**，不是无限 keepalive。

**B — api_retry 接线（补充，零成本真信号）：**

- claude-client `case 'system'` 增加 `subtype === 'api_retry'` 分支 → 发一个 `status` SSE（→ `markActive`）+ 可选 UI 文案"上游重试中（第 N 次）"。这覆盖"活跃重试风暴"期（真在重试、不该 abort），与静默排队正交。

**拒绝 A 的理由**：用户已显式点名"盲加 keepalive 会掩盖真卡死"。Native 在做不是扩散理由，那更像 Native 的潜在缺陷（可另记一条"Native 后续向 C 收敛 / 给模型调用加超时兜底"）。

### 用户能看到什么（反假数据 / CLAUDE.md）

C 让 UI 说真话，而非把"慢但正常"和"已死"混成一句笼统 idle timeout：

- 首字节前长引信期：**"等待服务商响应（已 Ns）"**（明确是在等慢上游，不是卡死）。
- 流中停顿：**"流已停滞"**。
- api_retry 期：**"上游重试中（第 N 次）"**。
- 最终 abort（真超时）：原因码用 `network_error` / `provider_timeout`，对齐 Phase 2「stream 终态原因码」待办，不再是泛化 idle。

### 聊天入口边界 + 本期范围（Codex P3 修正）

#635 的 330s idle abort **只在 `stream-session-manager.ts:386`**——即**已有会话**（`/chat/[id]` ChatView）的流。**首条新聊天**（`/chat` page.tsx 约 `:886`）直接 `fetch` + 自读 SSE，**不走该 idle checker** → 首条本就不被 #635 误杀（也无此 idle 保护 / 兜底）。这是双聊天入口的既有结构（见 memory「Dual Chat Entry Points」）。

**本期实现范围（防误杀核心）**：
- `stream-session-manager.ts` 分级超时（首字节前长 / 首字节后短）。
- `claude-client.ts` api_retry → `status` SSE（→ `markActive`，覆盖重试风暴期不误 abort）。
→ 覆盖 #635 的实际误杀面（已有会话后续消息）。

**本期不做 / 记 follow-up**：
- 完整 UI 等待文案（"等待服务商响应" / "流已停滞" / "上游重试中"）是前端增强；本期先把核心 idle 逻辑修对、消除误杀，文案分阶段。
- **首条 `/chat` 路径的一致等待文案 + 兜底超时**——首条不走 stream-session-manager，需单独改 page.tsx 的 SSE 读取；若验收要求首条也有一致等待 UI，再把它纳入同一 slice（待用户定）。

> 下方「用户能看到什么」「验收」默认按**已有会话**路径理解；UI 文案条目属增强阶段，首条入口未纳入本期。

### 实现点（待 review 后做，Tier 2）

1. `stream-session-manager.ts`：idle checker 改两级预算 + `sawUpstreamModelOutput` 标志（首个 model-output 事件翻）；新增两个常量（env 可配）。
2. `claude-client.ts`：`case 'system'` 加 `api_retry` → status SSE（顺带删 `:2002` 死 keep_alive 分支或留注释标死）。
3. 终态原因码：abort 时区分 pre/post-first-token，发对应原因码（依赖 Phase 2 原因码待办）。
4. UI：idle 等待态文案（首字节前/流中/重试中）。
5. Guardrail：idle 分级逻辑的行为测试（两级预算 + 首字节翻标志）；stream-session-manager 可单元驱动部分用真测，SDK 转发部分 source-pin。

### 验收

- 慢第三方 proxy 首 token 前排队 6–9min（< PRE 预算）→ 不再被误 abort；UI 显示"等待服务商响应"。
- 真卡死的上游（永不出字节）→ 首字节前在 PRE 预算后 abort（有真实上界，不无限挂）。
- 流中途上游断 → 在较短 POST 预算后 abort。
- transient is_error / api_retry 风暴期 → 不误判为 idle。

### 明确不做

- 不加无条件 keepalive（不把 Native 的掩盖扩散到 SDK）。
- 不改 Native 的现有 keepalive（另记 tech-debt：Native 模型调用缺超时兜底 + keepalive 掩盖）。
- 不下沉到 SDK 公开 API 之下 patch readMessages（CLI keep_alive 是假信号，无收益）。

---

## spot-check 记录（主审，2026-06-26）

| claim | 验证 | 结果 |
|-------|------|------|
| SDK readMessages 过滤 keep_alive → app 静默 + `claude-client:2002` 死代码 | grep `sdk.mjs` keep_alive | ✅ `else if($.type==="keep_alive")continue;` 确在 readMessages 内 |
| agent-loop setInterval 在 try 外 → Native 掩盖卡死 | `agent-loop.ts:123`(setInterval) vs `:161`(try) vs `:699`(finally clearInterval) | ✅ setInterval 在 try 前、clearInterval 在 finally，独立于主流 |

> 调研 subagent 对所有 absence-claim 自述已核验；主审额外 spot-check 上述 2 处设计核心依据，均确证。其余 file:line 未逐条复核，实现前按需再验。
