# Codex Stop Recovery / 终止后恢复发送

> 创建时间：2026-06-06
> 最后更新：2026-06-06
> 状态：🔄 P1+P2+P3 已实现并通过单测（typecheck 干净、全量单测 3261 通过）；真实 Codex Runtime smoke 待跑；P5/P6 用户决定本轮不做
> 协作边界：Codex 负责调研、计划、测试审查；Claude Code 负责产品代码修复。Codex 不直接改 `src/` 产品代码。

## 用户问题

用户反馈：Codex 正在执行任务时，一旦点击“终止 / Stop”，后续无法发送新的指令，像是整个进程挂住了。这个问题与此前 #578 “中断后发送无响应”症状相似，但当前调研显示 #578 的修复只覆盖了前端 `force-abort` 兜底，没有覆盖 Codex Runtime 的真实后端中断链路。

本计划要解决的用户结果：

- 用户点击 Stop 后，当前 turn 应进入明确的 interrupted / stopped 状态。
- 同一会话的输入框应恢复可发送。
- 下一条用户指令应能被同一会话接受，不需要新建会话、重启应用或手动 kill 后台进程。
- 如果 Codex 后端没有成功中断，CodePilot 必须暴露可诊断状态，不能让 UI 看起来已停止但 session lock 仍在续租。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 事实核查与边界确认 | ✅ 已完成 | Codex 本轮只读调研 + 相关单测运行 |
| Phase 1 | Interrupt route fan-out 修复 | ✅ 已实现（单测） | `interrupt/route.ts` 三路 best-effort fan-out（native + `codex_runtime` + SDK），各自独立 try/catch；pin：`interrupt-route-runtime-fanout.test.ts` |
| Phase 2 | Codex Runtime 接住已传入的 abort signal | ✅ 已实现（单测） | `codex/runtime.ts` `stream()` 读 `options.abortController.signal`：预启动 bail + active 中断 + abort-before-turnId race（含 listener 后 re-check 闭合窄窗）；抽共享 helper `issueCodexTurnInterrupt` 与 `interrupt()` 同实现；pin：`codex-interrupt-contract.test.ts` |
| Phase 3 | session lock 必需 watchdog / bounded cleanup | ✅ 已实现（单测） | 新 `session-lock-settle.ts`（幂等 / 按 lockId 释放 / 仅持锁时改状态）+ `chat/route.ts` `!autoTrigger` abort watchdog（grace 8s 后强制 settle `interrupted`）；行为单测 `session-lock-settle.test.ts` |
| Phase 4 | P1-P3 Guardrail 与 smoke | 🔄 单测完成、真实 smoke 待跑 | 3 个单测文件已落（fan-out / abort 契约 / lock settler）；**Codex Runtime 真实 login → long turn → Stop → 同会话下一条** 的 smoke 本环境跑不了，待真实凭据补 |
| Phase 5 | terminal 状态同步审计 | ⏸ 本轮不做（用户决定） | P1-P3 smoke 后若仍见状态分裂再展开 |
| Phase 6 | 长 turn / post-tool / no-output 诊断兜底 | ⏸ 本轮不做（用户决定） | P1-P3 smoke 后若仍见 no-output / post-tool 卡死再展开 |

## Signal → Triage → Fix → Verify → Guardrail

### Signal

- 用户直接反馈：“Codex 进行中的任务一旦点终止，就无法发送新的指令，整个进程会挂掉。”
- 本仓库历史：`docs/exec-plans/active/issue-tracker.md` 里 #578 记录为“中断后发送无响应已修”，修复点是 `stream-session-manager.ts` 先无条件调度 `force-abort`。
- 新调研发现：前端停止兜底和后端 Codex `turn/interrupt` 是两条不同链路。前端能本地退出，不代表 Codex app-server turn 已被取消。
- 外部旁证：OpenAI Codex Desktop 有多条 stuck / Stop 失效 / `markedStreaming=true` 的 issue，但这些 issue 的作者推测不能直接采信，只能作为症状聚类参考。

### Triage

本地代码证据优先级高于外部 issue 推测。当前最强的本地证据：

1. `src/lib/stream-session-manager.ts` 的 `stopStream()` 会请求 `/api/chat/interrupt`，并在 2 秒后本地 abort 前端 stream。这说明 UI 层已有 #578 兜底。
2. `src/app/api/chat/interrupt/route.ts` 只尝试 `getRuntime('native')` 和 SDK `conversation.interrupt()`，没有调用 `getRuntime('codex_runtime')`。
3. `src/lib/codex/runtime.ts` 已经有 `interrupt(sessionId)`，并会调用 Codex app-server 的 `turn/interrupt`。也就是说，Codex Runtime 有中断能力，但 HTTP interrupt route 没接它。
4. `src/app/api/chat/route.ts` 在 send 入口获取 session lock，并把模型流 `tee()` 成客户端流和后台 `collectStreamResponse`。lock 释放发生在后台收集流结束回调里。如果 Codex 后端 turn 没结束，后台流可能不结束，lock 会继续续租，下一条指令会被阻塞。

当前结论：**根因不是单一缺口，而是三段中断链同时没有闭环：**

1. **Interrupt route 漏接 Codex Runtime**：`/api/chat/interrupt` 没有 fan-out 到 `getRuntime('codex_runtime')?.interrupt(sessionId)`。
2. **force-abort 信号已传到 Codex Runtime 门口但被丢弃**：`chat/route.ts` 把 `request.signal` 转给 `abortController`，并经 `streamClaude()` 传入 `codexRuntime.stream(options)`；但 Codex runtime 当前不读取 `options.abortController?.signal`，所以前端 2 秒 force-abort 同样无法中断 Codex turn。
3. **session lock 不是 TTL 自愈，而是可无限期续租**：`chat/route.ts` 每 60 秒 renew 一次 600 秒 lock，`clearInterval` 只在 `collectStreamResponse` 完成回调里发生。turn 不结束 → collect 不结束 → interval 不清 → lock 永远续租，用户必须重启/kill 才能恢复。

因此 P1+P2+P3 都是用户这次问题的热修闭环。P1 只是最小代码 diff，不是完整修复；真正需要重点审查的是 P3 的精确 lockId cleanup。

### Fix

Claude Code 应按 P1+P2+P3 一起闭环推进：

1. 在 `/api/chat/interrupt` 中把 `codex_runtime` 纳入 interrupt fan-out。
2. 在 Codex Runtime 内接住已经传入的 `options.abortController?.signal`，覆盖 `turn/start` 返回前后的 abort race：如果用户早于 `activeCodexTurns.set()` 点 Stop，拿到 turnId 后仍应立即 `turn/interrupt`。
3. 给 `chat/route.ts` / `collectStreamResponse` 增加精确 lockId 的 bounded cleanup / watchdog，覆盖 `turn/interrupt` 返回但上游没有 terminal event 的最坏情况。
4. 对失败路径写清楚诊断日志：Stop 请求是否到达 route、route 是否调用 Codex Runtime、Codex Runtime 是否找到 active turn、`turn/interrupt` 是否返回、`turn/completed(status=interrupted)` 是否到达。

### Verify

必须至少覆盖：

- 单元测试：`/api/chat/interrupt` 对 `native`、`codex_runtime` 和 SDK conversation 都做 best-effort interrupt。
- 单元测试：Codex Runtime 在 abort signal 早于 `turn/start` 返回时，不会永久丢失 interrupt。
- 回归测试：点击 Stop 后，stream snapshot 离开 active；session runtime status 回到 idle；同一 session 下一次 POST 不返回 `SESSION_BUSY`。
- Smoke：在 Codex Runtime 下启动一个可控长任务，点击 Stop，然后立刻发送第二条消息；第二条要被接受并有可见反馈。

### Guardrail

- `interrupt/route.ts` 需要 source-pin 或 mock 行为测试，防止未来新增 Runtime 后 route fan-out 再漏。
- Codex Runtime interrupt race 需要专门测试：不能只测试“已有 active turn 时能 `turn/interrupt`”。
- session lock cleanup 需要测试“只释放当前 lockId，不误清后续请求的新 lockId”。
- `issue-tracker.md` 中 #578 不应继续被理解为完全关闭；它只修了前端 force-abort，Codex Runtime 路径是新缺口。

## 本地代码调查记录

### 1. Stop 按钮到 interrupt route

- `MessageInput` / `ChatView` 的 Stop 最终调用 `stopStream(sessionId)`。
- `src/lib/stream-session-manager.ts` 中 `stopStream()` 会：
  - 请求 `POST /api/chat/interrupt`；
  - 同时调度 2 秒后的 `abortController.abort()`；
  - 这项 #578 修复保证 interrupt endpoint 挂住时，前端不再永久卡在 active。

这个修复必要但不充分：它只能保证前端 stream 不被一个挂住的 `/api/chat/interrupt` 绑死，不能保证后端 Codex turn 已被取消。

### 2. `/api/chat/interrupt` 漏掉 Codex Runtime

当前 `src/app/api/chat/interrupt/route.ts` 的注释说 “Tries both runtimes”，但实际只有：

- Native Runtime：`getRuntime('native')?.interrupt(sessionId)`
- Claude SDK：`getConversation(sessionId)?.interrupt()`

缺失：

- `getRuntime('codex_runtime')?.interrupt(sessionId)`

这与 `streamClaude()` 的路由不一致。`src/lib/claude-client.ts` 在 Codex Account 或 `sessionRuntimePin === 'codex_runtime'` 时会路由到 `getRuntime('codex_runtime')`，但停止路径没有对称跟上。

### 3. Codex Runtime 自身已有正确 interrupt 入口

`src/lib/codex/runtime.ts` 里已有：

- `activeCodexTurns = new Map<string, { threadId; turnId }>()`
- `turn/start` 返回后 `activeCodexTurns.set(sessionId, { threadId, turnId })`
- `interrupt(sessionId)` 中调用 `client.request('turn/interrupt', { threadId, turnId })`
- `run_completed` / `run_failed` 时 `activeCodexTurns.delete(sessionId)` 并 `closeStream()`

官方 Codex app-server Turn API 也说明：`turn/interrupt` 需要 `threadId` 和 `turnId`，成功后返回 `{}`，并应发出 `turn/completed` 且状态为 `interrupted`。参考：<https://www.mintlify.com/openai/codex/api/turns>

所以当前最小修复不是重新设计 Codex interrupt，而是把 HTTP route 接到已存在的 Runtime interrupt。

### 4. force-abort 的 abort signal 已经传到 Codex Runtime，但当前被忽略

`src/app/api/chat/route.ts` 已创建 `abortController`，并监听 `request.signal`：

- 客户端断开 / 前端 `force-abort` 会触发 request abort；
- route 把它转成 `abortController.abort()`；
- `streamClaude()` 再把同一个 controller 传给具体 Runtime；
- Codex Runtime 的 `stream(options)` 已收到 `options.abortController`。

缺口在 Codex Runtime 内部：当前 `src/lib/codex/runtime.ts` 的 `stream()` 启动 app-server、watch、subscribe、`turn/start`，但没有读取 `options.abortController?.signal`。因此 #578 的 2 秒 force-abort 对 Native / SDK 前端流有兜底意义，但在 Codex Runtime 下并不会自动触发 `turn/interrupt`。

这意味着 Phase 2 不是“新铺一条 abort 信号链”，而是**接住一条已经传到 runtime options 的信号**。

### 5. session lock 为什么会让下一条指令发不出去，而且不是 TTL 自愈

`src/app/api/chat/route.ts` 的 send 入口会：

- `acquireSessionLock(session_id, lockId, ..., 600)`
- 开始 stream 后每 60 秒 `renewSessionLock(session_id, lockId, 600)`
- `stream.tee()` 后把 `streamForCollect` 交给 `collectStreamResponse`
- 只有 `collectStreamResponse` 完成回调里才 `releaseSessionLock(session_id, lockId)` 和 `setSessionRuntimeStatus(session_id, 'idle')`

如果前端被 `force-abort` 关闭，但后台 collect reader 仍在等 Codex app-server 的 turn 结束，则 lock 不释放。更严重的是：这个 lock 会被每 60 秒续租一次 600 秒，续租 interval 也只在 collect 完成回调里清掉。换句话说，turn 不结束时它不是“等 10 分钟自动恢复”，而是**无限期阻塞**。这解释了用户说的“整个进程挂住”，也对上外部 issue 中必须 restart / force-kill 才恢复的症状族。

### 6. Phase 3 为什么是必需项，而不是 P1/P2 后的可选兜底

P1+P2 的 load-bearing 假设是：

1. Stop 发出 `turn/interrupt`；
2. Codex app-server 返回 `{}`；
3. 上游随后发 `turn/completed status=interrupted`；
4. `event-mapper.ts` 转成 `run_completed`；
5. `codex/runtime.ts` 在 `run_completed | run_failed` 分支 `closeStream()`；
6. `collectStreamResponse` 读到 `done` 后释放 lock。

但用户这次反馈和外部 #14251 / #24467 的共同风险，恰恰是“中断/完成后没有可靠 terminal event 或 UI 状态没收口”。所以 P3 必须覆盖 `turn/interrupt` 发出但 stream 不 close 的情况。设计重点：

- watchdog / bounded cleanup 必须绑定当前 `lockId`；
- 只能释放当前请求持有的 lock，不能清掉后续窗口或后续发送的新 lock；
- `stream.tee()` 后取消一个分支不等于源流结束，必须审查 collect 侧的 reader；
- cleanup 状态应标为 `idle` / `interrupted` / diagnostic error，不能伪装成正常 completed。

## 外部 Issues 核实：存在性与本地适用性

这些 issue 已逐个打开核对。结论分三层：

1. **Issue 本身真实存在**：GitHub 页面、标题、状态、日期、环境和用户描述都能核到。
2. **用户描述的现象可采信为“有人报告过”**：例如 stuck Thinking、Stop 无效、completed/interrupted 后 UI 仍 active。
3. **作者推测的根因不能直接采信**：是否是 app-server、trace stream、WSL、image latency、goal、v0.55 regression，都不能无验证地套到 CodePilot。

本地适用性判断：

- **已确认映射到本仓库代码缺口**：Stop 后无法恢复发送。证据是 `/api/chat/interrupt` 漏掉 `codex_runtime` fan-out，而 Codex Runtime 已有 `turn/interrupt`。
- **存在相似风险，需审计/补 guardrail**：terminal 状态同步、completed/interrupted 后 UI / lock / runtime status 是否一致。
- **上游 core 或环境问题，CodePilot 只能做诊断/兜底**：Codex core 长 turn 不产出、post-tool continuation 不恢复、Windows v0.55 silent no output。

| 来源 | 可采信的事实 | 不直接采信的部分 | 对本计划的作用 |
|------|--------------|------------------|----------------|
| [openai/codex#24467](https://github.com/openai/codex/issues/24467) | macOS Desktop 线程可长期 spinner；日志出现 `latestTurnStatus=interrupted` 但 `markedStreaming=true`；用户提到 interrupted / completed 后 UI 状态未清 | issue 作者关于具体 Desktop lifecycle 的推测 | 作为“terminal turn 后 UI 状态可能不一致”的旁证；本仓库仍以 session lock + route fan-out 代码证据为主 |
| [openai/codex#24287](https://github.com/openai/codex/issues/24287) | Prompt accepted 后 UI stuck Thinking；Stop 失败；后端可能仍在工作；重启后状态可见性不一致 | 多窗口、goal、trace-stream 的归因推测 | 说明“UI 显示停止/无进度”和“后端仍活跃”可能分离；提醒修复时不要只看 composer |
| [openai/codex#12852](https://github.com/openai/codex/issues/12852) | Stop 无效；同线程继续发 prompt 仍无限 Thinking；新线程正常；kill 后台进程后输入恢复 | “必须 kill 进程”的处理不等于根因 | 与用户反馈高度相似，支持增加“同线程下一条指令可发送”的 smoke |
| [openai/codex#21360](https://github.com/openai/codex/issues/21360) | 长会话、tool-heavy、compaction 后可能留下未完成 core turn；manual abort / interrupt 出现在日志中 | hooks、analytics、image latency 等推测不能套用 CodePilot | 提醒验证非图像长任务和工具返回后的 continuation，不要只做 happy path |
| [openai/codex#6279](https://github.com/openai/codex/issues/6279) | v0.55.0 有用户报告 prompt 后无输出 / 静默失败 | 版本回退即根因的推断不足 | 作为 0.55 附近泛化稳定性信号，不作为本计划根因 |
| [openai/codex#20754](https://github.com/openai/codex/issues/20754) | Windows Desktop 可在底层任务已完成后仍显示 thinking/running；重启后能看到已完成结果 | WSL/git-root 解析错误是否为根因未证实 | 加入 Phase 5：terminal 状态同步审计，验证 CodePilot completed 后 UI / runtime status / lock 三者一致 |
| [openai/codex#14251](https://github.com/openai/codex/issues/14251) | interrupted/disconnected turn 后 thread 可永久 generating；composer disabled；手工补 terminal 事件可恢复 | 手工改 session log 是 workaround，不是修复方案 | 加入 Phase 5：Stop / disconnect 后必须有 terminal 状态或 bounded recovery |
| [openai/codex#19980](https://github.com/openai/codex/issues/19980) | Windows 有“thinking but no output”报告，但 issue 内容只有 session id，细节不足 | 缺少复现步骤和日志，不能据此定根因 | 不进入直接修复；仅作为 Phase 6 no-output diagnostics 的弱信号 |

### 本地逐项判断

| 问题族 | 是否在 CodePilot 中已确认存在 | 本地依据 | 处理 |
|--------|-------------------------------|----------|------|
| Stop 后同会话无法继续发送 | ✅ 已确认有代码缺口 | `/api/chat/interrupt` 没调用 `codex_runtime`；session lock 释放依赖后台 collect 结束 | Phase 1-3 直接修 |
| completed/interrupted 后 UI 仍 active / composer disabled | ⚠️ 未复现，但有同构风险 | CodePilot 有 stream snapshot、runtime status、session lock 三套状态；若 terminal SSE 丢失会不同步 | Phase 5 审计 + guardrail |
| 后端继续跑但前端 trace/progress 消失 | ⚠️ 未复现，但 Stop 问题可导致类似分离 | 前端 force-abort 可先关闭 UI；Codex turn 未 interrupt 时后端仍可能活跃 | Phase 1-3 修主要路径；Phase 6 补诊断 |
| tool outputs 返回后 assistant continuation 不恢复 | ❌ 未确认是 CodePilot bug | 这是上游 Codex core / app-server 报告；CodePilot mapper 对 tool_started/tool_completed 已有映射 | Phase 6 只做 bounded recovery / 日志，不承诺修 core |
| v0.55.0 Windows silent no output | ❌ 未确认是 CodePilot bug | 外部 issue 是旧 Windows Codex 版本报告；缺少本仓库可验证链路 | 不列直接修复；作为版本/平台 smoke 观察项 |

## 修复方案

### Phase 1 — Interrupt route fan-out

用户可见变化：点 Stop 后，Codex Runtime 下也会真正请求 Codex app-server 中断当前 turn。

不做什么：不改变 Stop 按钮 UI，不改变 Native / SDK Runtime 的既有中断语义，不新增队列功能。

实现路径：

- 修改 `src/app/api/chat/interrupt/route.ts`：
  - 保留 native best-effort；
  - 增加 `getRuntime('codex_runtime')?.interrupt(sessionId)`；
  - 保留 SDK `conversation.interrupt()`；
  - 所有分支继续 best-effort，单个 Runtime 报错不能阻止其他 Runtime 尝试。
- 建议日志：
  - `sessionId`
  - attempted runtimes
  - `codex_runtime` 是否可用
  - conversation 是否存在
  - 不记录 prompt / 文件路径 / credential。

验收：

- `POST /api/chat/interrupt` 源码或 mock test 能证明 `codex_runtime` 被调用。
- 注意：`codexRuntime.interrupt()` 是 fire-and-forget，route 返回 `{ interrupted: true }` 只能证明“发出了中断尝试”，不能证明 Codex turn 已经进入 interrupted terminal 状态。真正的状态收口要靠 Phase 2/3/4 验证。
- Native / SDK 既有测试不回归。

### Phase 2 — Codex Runtime 接住已传入的 abort signal

用户可见变化：前端 2 秒 force-abort 不只关闭 UI，也会被 Codex Runtime 读到并转成 `turn/interrupt`；用户在任务刚开始、Codex app-server 还没返回 turnId 时点 Stop，也不会留下一个后端继续跑的 turn。

不做什么：不把 Codex app-server 协议封装重写，不引入新 SDK。

实现路径：

- 在 `src/lib/codex/runtime.ts` 中监听已经传入的 `options.abortController?.signal`。
- 如果 signal 已经 aborted：
  - 在 `turn/start` 前能退出就退出；
  - 如果 `turn/start` 已发出但还没拿到 turnId，则拿到 turnId 后立即 `turn/interrupt`。
- 如果 signal 在 active turn 期间 aborted：
  - 调用同一条 `interrupt(sessionId)` 或内部 helper；
  - 避免重复 interrupt 造成噪音。
- 需要保证 `activeCodexTurns.delete(sessionId)` 仍只在 terminal 事件或明确 close 路径清理，不留下 stale turnId。

验收：

- 单测模拟 abort before `turn/start` resolves。
- 单测模拟 abort after `activeCodexTurns.set()`。
- 两种情况下都不应出现 stream 永久 open。

### Phase 3 — session lock 必需 watchdog / bounded cleanup

用户可见变化：Stop 后输入框恢复，下一条 prompt 能直接发，不需要重启或新建线程。

不做什么：不在本阶段实现“streaming 中追加消息排队”；那属于 B-022 队列行为，和本计划“Stop 后恢复”分开验收。

实现路径：

- 核查 `collectStreamResponse` 的 reader 在客户端 abort 后是否仍可能永久等待。
- 必须在 request abort / explicit stop 路径上增加 bounded cleanup / watchdog，覆盖 `turn/interrupt` 成功发出但上游不发 terminal event 的情况：
  - 只释放当前 lockId；
  - 不覆盖其他窗口/后续请求的新 lock；
  - 清理时写 runtime status `idle` 或 `interrupted`，不要误报 `completed`。
- 重点审查 `stream.tee()`：客户端分支被 abort 不保证 collect 分支结束；watchdog 应围绕 collect 分支和当前 lockId 设计。
- 如果 release lock 提前于后台 persistence，需确认不会丢 assistant content；Stop 场景可以接受不保存完整 assistant 内容，但不能破坏 DB。

验收：

- Stop 后立即发第二条，chat API 不返回 `SESSION_BUSY`。
- `setSessionRuntimeStatus` 从 running 回到 idle/interrupted。
- 如果 Codex app-server 没有发 `turn/completed`，watchdog 仍能释放当前 lockId。
- 如果 Stop 后用户已经发起新请求，watchdog 不能释放新请求的 lockId。
- 中断的 assistant message 若有部分内容，保存策略符合现有 stopped 行为；无内容时不写假消息。

### Phase 4 — P1-P3 Guardrail 与 smoke

用户可见变化：这类“Stop 后 UI 恢复但后端没停”的问题以后更难静默回归。

不做什么：不依赖公开 GitHub issue 的复现步骤作为唯一验证。

测试建议：

- `src/__tests__/unit/interrupt-route-runtime-fanout.test.ts`
  - mock `getRuntime('native')`
  - mock `getRuntime('codex_runtime')`
  - mock `getConversation`
  - 调 `POST()`，断言三条 best-effort 都尝试。
- 扩 `src/__tests__/unit/codex-interrupt-contract.test.ts`
  - 保留已有 `turn/interrupt` contract；
  - 增加 abort race source-pin / behavior pin。
- 增加 chat route lock recovery 测试或 smoke：
  - Codex Runtime 长任务 active；
  - Stop；
  - 等待 interrupted / stopped；
  - 立即发送第二条；
  - 断言没有 `SESSION_BUSY`，UI 能收到第二条状态。
- 增加 lockId 精确性测试：
  - old lockId 被 watchdog 清理；
  - new lockId 已存在时不被 old watchdog 清理。

Smoke Ledger 初始要求：

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _待跑_ | codex_runtime | codex_account 或可用 CodePilot provider | 当前默认 Codex 模型 | real login/API key | long turn → Stop → same-session next prompt | 📋 | dev server log + session id + screenshot |
| _待跑_ | native | 任意可用 provider | 快速模型 | API key | long turn → Stop → same-session next prompt | 📋 | 确认 fan-out 未回归 native |
| _待跑_ | claude_code | Claude Code SDK | 当前默认 Claude 模型 | CLI 登录/env | long turn → Stop → same-session next prompt | 📋 | 确认 SDK conversation interrupt 未回归 |

### Phase 5 — terminal 状态同步审计

用户可见变化：即使 Codex turn 是 completed / interrupted / failed，CodePilot 也不会留下“UI 还在跑、输入框不能发、DB lock 还被占”的分裂状态。

触发条件：P1-P3 落地并通过 smoke 后，如果仍出现 completed/interrupted 后 UI、runtime status、lock 不一致，再展开本阶段。不要让 Phase 5 阻塞 P1-P3 hotfix。

不做什么：不照搬 Codex Desktop 的 `markedStreaming` / local session log 机制；CodePilot 没有同名字段，不能把外部修法机械搬过来。

实现路径：

- 审计并测试三套状态是否一致：
  - frontend stream snapshot：`phase` 应离开 active；
  - DB/runtime status：`setSessionRuntimeStatus(..., 'idle' | 'interrupted' | error)`；
  - session lock：当前 lockId 必须释放，不能影响后续请求。
- 核查 `turn/completed status=interrupted`：
  - `event-mapper.ts` 已把非 failed 的 status 作为 `run_completed.finishReason` 传下去；
  - `codex/runtime.ts` 在 `run_completed | run_failed` 上关闭 stream；
  - 需要补测试覆盖 interrupted status 的端到端状态收口，而不只 source-pin mapper。
- 如果终端 SSE 丢失，增加 bounded recovery：
  - 可基于 frontend AbortError / Stop 请求 / route interrupt 结果设置一个短时 watchdog；
  - watchdog 只能释放当前 lockId，不能抢后续新请求。

验收：

- completed 后不会残留 running / active。
- interrupted 后不会残留 running / active。
- failed 后不会残留 running / active。
- disconnect / stop 后同会话下一条能发送。

### Phase 6 — 长 turn / post-tool / no-output 诊断兜底

用户可见变化：如果 Codex core 长时间没有 assistant 输出、tool 后不继续、或没有 terminal 事件，CodePilot 应给出可诊断状态和恢复路径，而不是无限 Thinking。

触发条件：P1-P3 落地并通过 smoke 后，如果仍见 no-output / post-tool continuation 卡死，再展开本阶段。不要把上游 core 风险拖成当前 Stop hotfix 的前置条件。

不做什么：不承诺修复上游 Codex core 的 post-tool continuation 或 Windows v0.55 silent no-output；这些需要上游修。CodePilot 只负责不让本应用永久无反馈、无恢复。

实现路径：

- 利用现有 `STREAM_IDLE_TIMEOUT_MS` 和 Codex retry event，补 Codex Runtime 特有诊断：
  - 最近一次 Codex event type；
  - 是否已发 `turn/interrupt`；
  - 是否收到 `turn/completed`；
  - 是否有 tool_completed 后长时间没有 assistant_delta / run_completed。
- 对 no-output path 做可见 error / status：
  - 不把空响应保存成正常 assistant message；
  - 明确提示“Codex turn timed out / no terminal event”，并允许下一条继续。
- 如需新增 watchdog，必须加测试证明：
  - 正常长工具不会被误杀；
  - willRetry=true 不会被当 terminal；
  - terminal event 到达后 watchdog 清理。

验收：

- 模拟 tool_completed 后无后续 terminal，最终有 bounded diagnostic，不无限 active。
- 模拟 no-output idle timeout，最终可继续发送。
- `willRetry=true` 路径仍等待真实 terminal，不被提前关闭。

## 与其它问题的边界

- Run Checkpoint 截图保留：此前 Codex 已改 `MessageInput` blocked path 为 reject，避免 `PromptInput` 清空附件；Claude Code review 指出还应补 `prompt-input.tsx` reject 分支 source-pin。这是测试防线缺口，建议另行补测试，不属于本计划的产品代码主线。
- B-022 streaming 期间排队：本计划只保证 Stop 后能恢复发送；“不中断当前任务而排队下一条”是另一个交互能力，不能混在本计划里验收。
- 上游 Codex Desktop stuck issues：可以参考症状和日志字段，但不能把上游 issue 作者的原因推测直接写进 CodePilot 修复方案。CodePilot 先修本地已确认的 route / lock / abort 链路。

## 决策日志

- 2026-06-06: Codex 调研确认 `/api/chat/interrupt` 漏掉 `codex_runtime`，而 Codex Runtime 自身已有 `turn/interrupt` 实现。将其列为 Phase 1 最小修复。
- 2026-06-06: 不把 OpenAI Codex GitHub Issues 的原因推测直接采信；只把 #24467 / #24287 / #12852 / #21360 / #6279 作为症状聚类和 smoke 设计参考。
- 2026-06-06: #578 历史修复不视为完全覆盖本问题；它解决前端 force-abort 不被 hung interrupt endpoint 绑死，未验证 Codex app-server turn 真正 interrupted。
- 2026-06-06: 明确区分 Stop 后恢复发送和 streaming 期间排队。前者是本计划 P1，后者留在 B-022。
- 2026-06-06: 二次核实外部 issue 后新增 #20754 / #14251 / #19980 到同一文档。结论：外部问题真实存在，但只有 Stop 后无法继续发送已在 CodePilot 中确认有代码缺口；completed/interrupted 状态分裂和 no-output 属于需审计/兜底的风险项，不直接宣称已复现。
- 2026-06-06: Claude Code 复核指出根因应收紧为三段：interrupt route 漏 Codex；abort signal 已传到 Codex Runtime 但被忽略；session lock 由 60s interval 无限续租，非 600s TTL 自愈。接受该审查，调整计划权重：P1+P2+P3 必须共同交付，P5/P6 后置为 smoke 后仍有状态分裂时再展开。
- 2026-06-06: Claude Code 实现 P1+P2+P3（产品代码）。**P1** `interrupt/route.ts` 加 `codex_runtime` 分支并改掉误导性 "Tries both runtimes" 注释。**P2** `codex/runtime.ts` `stream()` 监听已传入的 `options.abortController.signal`，并抽 `issueCodexTurnInterrupt` 共享 helper 让 `interrupt()`（route 路径）与 abort handler 同实现（复用 contract，不重写）；覆盖预启动 bail / active 中断 / abort-before-turnId race（含 addEventListener 后 re-check 闭合窄窗）。**P3** 新增 DI 纯函数 `session-lock-settle.ts`（参照 `stopStreamWith` 可测试模式），`chat/route.ts` 把 collect 回调与 `!autoTrigger` abort watchdog 都走同一个幂等 settler；释放按 lockId、仅在仍持锁时写 runtime status（避免覆盖新请求的 `running`）。验证：typecheck 干净，全量单测 3261 通过（首跑 4 个已知 SQLite flaky，复跑两次稳定全绿），新增/改写 3 个测试文件。**未做**：真实 Codex Runtime 凭据 smoke（本环境无 live app-server）。

## Smoke Ledger（真实凭据 / UI / E2E 验证记录）

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _待跑_ | codex_runtime | codex_account 或可用 CodePilot provider | 当前默认 Codex 模型 | real login/API key | long turn → Stop → same-session next prompt | 📋 | |
