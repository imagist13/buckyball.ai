# Refactor Phase 2 — Runtime 与会话执行（已完成归档）

> 历史归档。本文件由 [active/refactor-closeout.md](refactor-closeout.md) 在 2026-05-09 拆出，对应 Phase 2（Runtime 与会话执行）的全部计划文本与决策日志。
> 完成时间：2026-05-07（Step 1-4c 全部 ✅，含 4c review fix round 1-6）
> 当前总控板：[active/refactor-closeout.md](refactor-closeout.md)

## Phase 2 用户结果（最终交付）

- 中文 UI 统一叫"执行引擎"；composer 工具栏 `[模式] [对话引擎] [权限]` 三联，用户可在每个会话里显式切换。
- 旧会话不再被全局 agent_runtime / default_model 漂移：`chat_sessions.runtime_pin` 落地 + lazy migration（首次发送时固化），用户没主动切就不会写。
- 用户切到 CodePilot Runtime 后红色"执行引擎已降级"/"固定不可用"横幅不再误报——RunCheckpoint / RunCockpit 都以会话级 override 为准，全局信号在会话级覆盖时短路。
- 会话指向已删除 provider 时，发送被 409 INVALID_SESSION_PROVIDER 阻断，inline 横幅引导用户切 picker 修复，不再静默 fallback 到 env。
- transcript 中 runtime 切换有可见 marker（"已切换执行引擎：X → Y"），刷新页面后仍在。

## 计划文本

## Phase 2：Runtime 与会话执行

### 用户会看到什么

- 每个会话都能看到“本次由谁运行”：Claude Code、CodePilot Runtime、未来 Codex / OpenClaw 等。
- 用户可以在会话开始前选择 Runtime，也可以在会话中切换；切换只影响下一条消息。
- 如果当前模型不适合目标 Runtime，界面会解释原因，并引导用户换模型或换 Runtime。
- 已有会话不会被全局默认设置突然改变运行方式，除非用户主动切换。

### Phase 2 细化方案（待审核）

> 用户语言：代码里仍可叫 `runtime`，但中文 UI 统一叫“执行引擎”。不要在主路径里继续裸露 Runtime / AI SDK / CodePlan Runtime 这类混乱名词；需要技术细节时放到 tooltip 或高级说明。

#### 1. 用户结果

本阶段做完后，用户应该能明确理解三件事：

- **这个会话现在谁在跑**：底部 Run 面板不是解释“全局默认”，而是解释“本会话下一条消息会用哪个执行引擎、哪个服务商、哪个模型”。
- **切换不会吓人**：用户在会话里切执行引擎，只影响下一条消息；已经在生成的回复不被中途换轨。
- **旧会话不漂移**：全局默认模型或执行引擎改了以后，旧会话不会突然变成另一个执行方式，除非用户在这个会话里点了切换。
- **不可用有原因**：如果某个模型不能在当前执行引擎下使用，界面说清楚“为什么不能用”和“下一步该换模型还是换执行引擎”，不再只贴一个“不可用”标签。

#### 2. 当前问题清单

| 优先级 | 问题 | 用户看到的坏结果 | 处理方向 |
|--------|------|------------------|----------|
| P0 | 已有会话仍可能受全局默认影响 | 用户以为旧会话保持原引擎，但下一条消息可能按新全局设置跑 | 建立 session-level execution state，发送链路优先读会话状态 |
| P0 | Run 面板解释对象不稳定 | 面板像状态卡，但有时解释全局默认、有时解释本次消息 | Run 面板统一解释“本会话下一条消息” |
| P1 | 切换执行引擎缺少事件轨迹 | 出问题后无法回答“为什么这次走了 Claude Code / CodePilot Runtime” | 写入 `runtime.selected` / `runtime.resolved` 类 session event |
| P1 | 中文名词混乱 | 用户看见 Runtime / AI SDK / CodePlan Runtime，不知道区别 | UI 统一“执行引擎”；技术名只作为次级说明 |
| P1 | 模型兼容原因分散 | Models、Runtime、Chat 三处解释可能不一致 | 复用 Phase 1 的 provider/model resolver 结果，只展示一套原因 |
| P2 | Codex / 其它 Agent 适配被提前卷入 | 还没把会话执行状态打稳，就开始接多 Agent | Phase 2 只预留 adapter 契约；Codex 深度适配放 Phase 4 |

#### 3. 本阶段具体做什么

##### 2.1 现状审计与契约冻结

- 只读梳理当前发送链路：Chat 新会话、已有会话、RuntimePanel、RunCockpit、backend runtime resolver。
- 列出所有读取全局 runtime / provider / model 的位置，标记哪些应该改成 session-level。
- 写最小回归测试，先锁住”已有会话不应该因为全局默认变化而改变下一条消息”的目标契约。

**用户验收**：这一小步没有 UI 变化，但交付报告必须能用普通话说清楚”现在为什么会漂移、接下来哪条链路会被改”。

###### Step 1 完成报告（2026-05-06）

**用户层面解决了什么不确定性**

- 旧会话的发送链路被分成了三类：(A) **会话状态正常优先**——session.model / session.provider_id 已经能在 resolver 层面战胜全局；(B) **不该读全局却仍然读着**——agent_runtime（执行引擎）读的是全局设置，每条消息都重新读，这是用户最担心的”我刚改了全局，旧会话下一条就走了新引擎”；(C) **静默 fallback**——session 持有的 provider 被 runtime 过滤后，前端会偷偷换一个并 PATCH 回 DB。三类都已经用测试钉住，Step 2 对每个 RED 项必须给出迁移方案。
- “新会话能正常 seed、旧会话不被全局默认改写、provider 删除应该明确报错而不是滑到 env” 这三个目标契约被写成 12 条单元测试；任何后续 PR 把这些假设破坏都会立刻失败。
- 数据库 schema gap 也被钉住：`chat_sessions` 表今天没有 runtime 列，所以即便用户切了执行引擎，存的地方都没有。Step 2 必须先加列再谈切换。

**根因（漂移风险来自哪里）**

| 编号 | 位置 | 现在做了什么 | 用户能看到的坏结果 |
|------|------|--------------|--------------------|
| #1 | `src/lib/claude-client.ts:473` `streamClaude()` | 每次 send 时 `getSetting('agent_runtime')` | 用户在 Settings 切了执行引擎，所有打开的旧会话下一条消息都按新引擎跑 |
| #2 | `src/lib/chat-runtime.ts:53` `getActiveChatRuntime()` | 走 `resolveRuntime()`（全局） | `/api/chat` 对 resolver 的 runtime gate 永远是当前全局值；session 没办法 pin “本会话用 Claude Code” |
| #3 | `src/lib/runtime/registry.ts:48` `resolveRuntime()` | 同上的最底层入口 | 是 #1/#2 的根，自身保留全局默认即可，但 Step 2 需要在调用方加 session-aware wrapper |
| #4 | `src/hooks/useProviderModels.ts:111` 默认 `runtime='auto'` | 让 server 用全局 runtime 过滤模型列表 | 用户改全局执行引擎后，所有打开的会话的模型列表都被重过滤；可能把会话当前 provider 整组过滤掉 |
| #5 | `src/app/api/chat/route.ts:246` `effectiveModel` | `model || session.model || getSetting('default_model')` | 旧会话 `session.model=''` 且请求 body 没带 model（autoTrigger / retry 路径）→ 全局 default_model 漏入 |
| #6 | `src/components/chat/ChatView.tsx:179-191` `providerWasFilteredOut` 分支 | 静默替换 provider/model 并 PATCH 回 DB | 用户改全局 runtime 后回到旧会话，看到 provider 被偷偷换了，并且 DB 也被改了 |

**已经做对的部分（GREEN，写测试钉住）**

- `resolveProvider({ providerId, sessionModel })` 已经让 sessionModel 战胜 `global_default_model` / `default_model`。
- `resolveProvider({ providerId, sessionModel, model })` 让本次 message 的 explicit model 战胜 sessionModel + global。
- 跨 provider 的全局 pin（global pin 指向 provider X，session 在 provider Y）不会污染 session Y 的解析。

**改动**

| 路径 | 类型 | 内容 |
|------|------|------|
| `src/__tests__/unit/session-runtime-immunity.test.ts` | 新增 | 11 条契约测试，分 GREEN / YELLOW(`{todo:true}`) / RED(`{todo:true}`) 三档。GREEN（4 条）直接 assert 当前正确行为，必须永远 pass。YELLOW（2 条 todo）= resolver invalid 出参 + chat_sessions runtime 列的 target-state，今天 fail-as-todo。RED（5 条 todo）针对每个漂移点写**精确 hazardous-pattern grep**（不只是泛符号匹配），target = hazard 不存在；今天 fail-as-todo，Step 2 删 hazard 后 pass，PR 顺手摘 `{todo:true}` 即转正。原本"`assert.ok(r.lines > 0)`"反向通过的写法（伪绿色安全网）已替换。 |
| `docs/exec-plans/completed/refactor-closeout.md` | 更新 | 顶部状态行加上 Phase 2 Step 1 ✅；本节追加 Step 1 完成报告 + 决策日志条目 |

**验证**

- `npm run test` → 1529 pass / **7 todo** / 0 fail（Step 1 之前 1525；新增 11 条 contract test，其中 7 条目前 fail-as-todo —— 漂移点可见、不破 CI、不会被误读成"已修"）
- typecheck clean
- 没有 UI 改动；没有改 Codex / 多 Agent / 权限系统；resolver / runtime registry 没有改任何函数行为，只在测试层面记录了它们今天的语义。

**下一步：Step 2 需要改的模块**

按从最深到最浅排（每个对应一条 todo 测试，hazard 删掉即 pass）：

1. **DB schema**（`src/lib/db.ts`）：给 `chat_sessions` 加 `runtime_pin TEXT NOT NULL DEFAULT ''` 列 + 安全 ALTER 迁移；同步 `getSession` / `updateSessionRuntime` 等访问器。→ 转正 YELLOW#2（schema gap）。
2. **Resolver 层**（`src/lib/provider-resolver.ts` + `src/lib/runtime/registry.ts`）：保留现有 global resolver，但新增 `resolveProviderForSession({ session })` / `resolveRuntimeForSession({ session })` wrapper，session 带 pin 时用 pin、否则才走全局。明确 invalid-session 出参契约（`invalidReason / status` 字段）。→ 转正 YELLOW#1（invalid signal）。
3. **Send route**（`src/app/api/chat/route.ts`）：`effectiveModel` fallback 链删掉 `session.model || getSetting('default_model')` 段；改读 `session.model` 严格非空（懒迁移：第一次发现 `session.model===''` 时立刻 seed 并写入，之后不再回查 global）。runtime gate 从 `getActiveChatRuntime()` 改成 `getActiveChatRuntime(session)` 或 `getActiveSessionRuntime(session)`。→ 转正 RED#2（getActiveChatRuntime no-arg）+ RED#5（global default_model fallback）。
4. **streamClaude**（`src/lib/claude-client.ts`）：把 `resolveRuntime(getSetting('agent_runtime'), …)` 替换成 session-aware wrapper。→ 转正 RED#1。
5. **Frontend hook**（`src/hooks/useProviderModels.ts`）：默认参数从 `'auto'` 改成 `null` 或要求显式传入；ChatView 传入 session 自己的 runtime（懒迁移）。→ 转正 RED#4。
6. **ChatView 静默 PATCH**（`src/components/chat/ChatView.tsx`）：`providerWasFilteredOut` 触发的 `fetch /api/chat/sessions/${sessionId} { method: 'PATCH' }` effect 拆掉；改成 RunCheckpoint 风格的 inline 不可发提示，必须用户主动切换才写 session DB（变量本身可保留供 banner 读）。→ 转正 RED#6。

测试在每个动作落地后立即由 fail-as-todo 翻成 pass-as-todo；Step 2 收尾 PR 把所有 `{ todo: true }` 摘掉即可正式转入 GREEN 防线。

##### 2.2 会话级执行状态

- 为每个会话持久化“下一条消息使用的执行组合”：执行引擎、provider、model、选择来源（自动解析 / 用户手动切换 / 兼容 fallback）。
- 新会话创建时，从当前全局默认解析一次并写入会话；之后这个会话优先使用自己的状态。
- 旧会话做懒迁移：没有会话状态时，首次打开 / 首次发送按当前 resolver 解析并写入，之后不再跟随全局漂移。
- 全局默认仍然存在，但只影响“新会话的初始值”，不直接改旧会话。

**用户验收**：

- A 会话固定 GLM，B 会话切 OpenRouter；改全局默认后，A/B 下次发送仍保持各自选择。
- 新建 C 会话时才使用新的全局默认。

###### Step 2 完成报告（2026-05-06）

**用户层面**：旧会话现在有了一个"自己的执行引擎"槽位（`chat_sessions.runtime_pin`），并且 resolver 已经能根据这个槽位返回正确的 runtime；当会话指向一个被删除的服务商时，resolver 会主动报"provider-missing"，不再静默换走。但**这是数据层 + 解析层的准备工作**，发送链路、UI 切换面板还没接入 —— 用户还看不到"我的会话不再漂移"的最终效果，那是 Step 3+ 的事情。Step 2 的价值是：Step 3 之后的 PR 一旦把 `streamClaude` / chat route / picker hook 切到新 wrapper，会话就立刻获得防漂移能力，且 PR diff 可以做到极小。

**改动**

| 路径 | 改动 |
|------|------|
| `src/lib/db.ts` | `chat_sessions` 表加 `runtime_pin TEXT NOT NULL DEFAULT ''` 列（安全 ALTER 迁移）；新增 `updateSessionRuntime(id, pin)` 写入器。空字符串 = "follow global"，`'claude_code'` / `'codepilot_runtime'` = 会话级 pin。 |
| `src/types/index.ts` | `ChatSession.runtime_pin: string` 字段，附完整 docstring。 |
| `src/lib/provider-resolver.ts` | `ResolvedProvider.invalidReason?: 'provider-missing' \| 'model-missing' \| 'runtime-incompatible'` 可选字段（仅 session-aware 出口设置）。新增 `resolveProviderForSession(intent, extras)` wrapper：检测会话指向已删除 provider 时返回 `invalidReason: 'provider-missing'`；其它情况透传到现有 `resolveProvider`，priority chain 不变。`'env'` / `'openai-oauth'` 虚拟 ID 不触发 invalid 检查；per-message `requestProviderId` override 也不触发（用户刚选的不可能不存在）。 |
| `src/lib/chat-runtime.ts` | 新增 `resolveRuntimeForSession(session)` wrapper：会话有合法 pin（`'claude_code'` / `'codepilot_runtime'`）→ 用 pin；空 / 未知值 / undefined → 透传到 `getActiveChatRuntime()`（全局）。这是 Step 3 把 `getSetting('agent_runtime')` 替换掉时要调用的入口。 |
| `src/__tests__/unit/session-runtime-immunity.test.ts` | YELLOW todos（resolver invalid 信号 + schema gap）从 `{ todo: true }` 转正为 GREEN：触发删除 provider → assert `invalidReason === 'provider-missing'`；schema grep → assert `runtime_pin` 列已落地。新增 `resolveProviderForSession` 5 条 GREEN（healthy session、deleted provider、per-message override 三个分支）+ `resolveRuntimeForSession` 5 条 GREEN（empty pin / claude_code pin / codepilot_runtime pin / unknown legacy 值 / undefined 防御）。RED 5 条仍 todo，留给 Step 3。 |
| `src/__tests__/unit/context-assembler.test.ts` | 测试 fixture 加 `runtime_pin: ''` 字段，跟新的 ChatSession 类型对齐。 |

**验证**

- `npm run test` → **1538 pass / 5 todo / 0 fail**（Step 1 时是 1529 pass / 7 todo；新增 9 条 GREEN，2 条 YELLOW 转正）
- typecheck clean
- 没有改 UI；`streamClaude` / `getActiveChatRuntime()` no-arg / `useProviderModels` default / chat route effectiveModel 链 / `ChatView.providerWasFilteredOut` 静默 PATCH —— 这 5 条 RED 还在 todo，Step 3 才动它们。
- 旧会话的 runtime_pin 自动是空串（迁移 DEFAULT）→ 一律走全局，零行为变化。

**Step 2 还没做的事（明确不在范围）**

- 没有把 `streamClaude` 或 chat route 改成调用 `resolveRuntimeForSession`。它们还是直接读全局，Step 3 才动。
- 没有动 `ChatView` 的静默 PATCH effect。RED#6 仍是 todo。
- 没有加 UI 切换面板。Step 3 / Run 面板要做。
- 没有 lazy migration（旧会话首次发送时把全局值固化到 runtime_pin）—— 这种"懒迁移"需要 send route 配合，Step 3 一起做。

**下一步：Step 3**

按计划 doc 第 5 步表格，Step 3 = "Chat 里的切换入口"。但这一步在工程上分成两半：(a) **后端先把 send route 切到新 wrapper**（让 wrapper 真的开始有作用），(b) **前端再加 Run 面板的切换 UI**。建议下一轮先做 (a)：

1. `src/app/api/chat/route.ts` `effectiveModel` 链删 `session.model || getSetting('default_model')` 段，懒迁移 session.model；runtime gate 从 `getActiveChatRuntime()` 改成 `getActiveChatRuntime(session)` 或 `resolveRuntimeForSession(session)`；Provider 解析改成 `resolveProviderForSession({ provider_id: session.provider_id, model: session.model, requestProviderId: provider_id, requestModel: model })`，并把返回的 `invalidReason` 翻译成 4xx 响应 + 前端可消费的错误 code。→ 转正 RED#2 + RED#5。
2. `src/lib/claude-client.ts` `streamClaude` 接受可选 `session` 入参，把 `resolveRuntime(getSetting('agent_runtime'), …)` 替换成 `resolveRuntimeForSession(session)` 路径。→ 转正 RED#1。

UI 切换面板 / `useProviderModels` runtime 参数化 / `ChatView` 静默 PATCH 改 inline 提示 都留到 Step 3 后半段。

##### 2.3 Chat 里的切换入口

- Run 面板增加“切换执行引擎 / 模型”入口，但仍保持状态卡风格，不变成第二个 Settings 页。
- 切换面板只显示当前可用组合：先选执行引擎，再看兼容 provider/model；不可用组合不堆进主列表。
- 中文 UI 使用：
  - “执行引擎”：Claude Code / CodePilot Runtime / 未来 Codex。
  - “本会话”：本会话使用 / 本会话已切换。
  - “跟随默认”：只用于新会话初始值，不用于旧会话主状态。
- 如果用户切到不兼容组合，显示 RunCheckpoint 风格的 inline 提示，而不是 toast 后消失。

**用户验收**：

- Chat 页面能看见“本会话使用 Claude Code / GLM · glm-5-turbo”。
- 点击切换，用户能把下一条消息改到另一个兼容组合。
- 切换后 Run 面板立刻更新，并说明“下一条消息生效”。

##### 2.4 发送链路使用会话状态

- 后端发送前读取 session execution state，而不是重新读全局默认。
- 发送开始时写入本次 resolved runtime/provider/model/reason，便于日志和 UI 解释。
- 正在流式生成中的回复不被切换动作中断；切换只影响下一次 submit。
- 如果会话状态失效（provider 删除、模型隐藏、runtime 不可用），阻断发送并显示可修复原因。

**用户验收**：

- 切换执行引擎后发送一条消息，Run 面板和后端实际使用一致。
- 删除当前会话使用的 provider 后再发送，会看到明确修复入口，而不是 composer 静默 disabled。

##### 2.5 事件、日志与测试

- 最小事件：
  - `runtime.selected`：用户选择了什么。
  - `runtime.resolved`：发送时实际解析到什么。
  - `runtime.fallback`：如果发生 fallback，原因是什么。
- 单元测试覆盖：
  - 新会话 seed。
  - 旧会话懒迁移。
  - 全局默认变化不影响已有会话。
  - 切换只影响下一条消息。
  - provider/model 删除后的 invalid 状态。
- Browser smoke 由 Codex 跑：
  - 新建会话 → 看初始执行组合。
  - 切换会话执行组合 → Run 面板更新。
  - 改 Settings 全局默认 → 回到旧会话确认不漂移。

#### 4. 本阶段明确不做

- 不做自动多 Agent 派单。
- 不把 Codex 适配做到 Claude Code 同级；Phase 2 只预留 adapter 契约，深度适配放 Phase 4。
- 不重做 PermissionPrompt / 权限系统。
- 不做 Run Checkpoint Round 3。
- 不把所有 runtime 能力一次性拉齐；第一版只要求“能解释、能切换、能稳定发送”。

#### 5. 交付顺序

| Step | 内容 | 用户收益 | 是否可独立验收 |
|------|------|----------|----------------|
| 1 | 现状审计 + 契约测试 | 知道漂移从哪里来 | 是 |
| 2 | 会话级 execution state | 旧会话不再被全局默认影响 | 是 |
| 3 | Chat Run 面板切换入口 | 用户能在会话里切下一条消息的执行方式 | 是 |
| 4 | 后端发送链路改读 session state | UI 与实际执行一致 | 是 |
| 5 | runtime events + Browser smoke | 出问题能解释，后续不回归 | 是 |

#### 6. 批准后给 ClaudeCode 的执行口径

> 进入 refactor-closeout Phase 2 Step 1：Runtime 与会话执行的现状审计 + 契约测试。只做审计和测试，不改 UI，不接 Codex adapter，不做多 Agent。交付必须用用户语言说明：当前旧会话为什么会被全局默认影响、哪些代码路径会改成 session-level、哪些行为先用测试锁住。完成 Step 1 后停下汇报，不要直接进入 Step 2。

### 工程要做什么

- 建立 session-level runtime pin：会话自己的 runtime、provider、model 选择要可持久化。
- Run 状态面板从“解释当前默认”升级为“解释当前会话”。
- Adapter registry 只定义最小能力：detect / launch / observe / cancel / limitations。
- Codex adapter 先做到连接和基本调用，不强行复刻所有 Claude Code 能力。

### 不做什么

- 不做自动多 Agent 编排。
- 不要求每个 Runtime 一开始都支持同样的工具、权限、MCP、文件系统能力。
- 不在同一阶段重做全部权限系统。

### 验收路径

- Chat 新会话：能选择 Runtime。
- Chat 已有会话：切 Runtime 后下一条消息生效，当前生成中的回复不被打断。
- Settings → Runtime：能解释这个会话为什么用当前 Runtime。

## 决策日志

按时间倒序，最新在前。条目从 active/refactor-closeout.md 整段迁移，不增不删。

- 2026-05-06：**Phase 2 详细方案写入，待用户审核**。新增“Runtime 与会话执行”细化方案，按用户视角拆成 5 步：现状审计 + 契约测试、会话级 execution state、Chat Run 面板切换入口、发送链路改读 session state、runtime events + Browser smoke。原则：中文 UI 统一叫“执行引擎”；Phase 2 只解决“会话能解释、能切换、旧会话不漂移、下一条消息生效”，不做自动多 Agent、不做 Codex 深度适配、不重做权限系统。
- 2026-05-07：**Phase 2 Step 4c review fix round 6 (P2: R5 RunCockpit 改造过头 + 漏做 transcript Checkpoint 标记)**。R5 把 RunCockpit 重构为基于 ai-elements Context 时犯了三个错：(a) 触发器从 click-to-open 的 Popover 退化成 hover-only 的 HoverCard——用户原话"点击后的浮层"被破坏；(b) 触发器 chip 上原本的"上下文百分比 chip"段被退成纯文字，没用 Context 同款 ring icon；(c) popover 浮层里把 Model / DefaultMode 行误删了（用户的指令只是"不重复展示 Runtime"，不是删别的）；同时 R5 把 transcript Checkpoint 标记说成"留下次"，但用户在反馈里明确点过这个，应在同轮收。**修复 (a)+(b) chip + popover**：把 RunCockpit 的 trigger/content 改回 Popover（click-to-open，PopoverTrigger asChild + PopoverContent），然后用 `<Context usedTokens=… maxTokens=… usage=… modelId=…>` 包住整个 Popover，使 ContextContentHeader / ContextContentBody{Input/Output/Cache} / ContextContentFooter 这些 helpers 在 PopoverContent 里能从 ContextContext 取到值（Context 内部的 HoverCard 没 Trigger 子节点所以静默不会 fire，相当于纯 Provider）。chip 触发器加一个新内联 `<RingIcon percent={ratio} />` 组件——SVG 与 ai-elements/context.tsx#ContextIcon 完全一致（双圆环，背景 25% 透明 + 进度 70% 透明，stroke-dasharray 控制用量），所以视觉上和"用 Context 组件"承诺一致。chip 文字：`{warning?} {ringIcon} {pct%}{+pendingTokens?} {· pinnedChip?}`——pinned chip 跟 R5 之前删掉那段一样的逻辑回来，仅在 `!sessionRuntimeOverride && modeIsPinned` 时显示"已固定/固定不可用"。**修复 popover panel**：`auxRows` 恢复成三行——Model（read-only + Switch 链接到 #models）/ DefaultMode（pinned vs auto，session override 时直接显示 modeAuto）/ Permission（read-only），加上 ContextContentHeader（大 % + 进度条）+ ContextContentBody 的 Input/Output/Cache 分解 + 自定义 issuesBlock + ContextContentFooter（Total cost）——比 R5 之前的 panel 更完整，比原始 RunStatusPanel 少一行 Runtime（用户要求的去重）。**Capacity-unknown / pre-first-response 走 fallback 分支**：不包 `<Context>`（Context helpers 没 maxTokens 会渲染 0% 误导），普通 Popover + 同款 auxRows + issuesBlock。**新增 transcript Checkpoint 标记**：(d) `src/components/chat/RuntimeSwitchMarker.tsx`——纯组件 + `parseRuntimeSwitchMarker(content)` 纯函数 + `buildRuntimeSwitchMarker(payload)` builder + `RUNTIME_SWITCH_MARKER_PREFIX` 常量；marker 内容用 `[__RUNTIME_SWITCH__ from=X to=Y]` 这种 sentinel 字符串，跟项目已有的 `[__IMAGE_GEN_NOTICE__ ...]` 风格一致；视觉上是水平分隔线 + 中间一个圆形小 chip（`Brain` 图标 + 文案），完全 inline、不跟用户/助理消息抢视觉。(e) `MessageList.tsx` 在 `messages.map` 入口加一段：`role === 'user'` 时先尝试 `parseRuntimeSwitchMarker(content)`，命中就渲染 `<RuntimeSwitchMarker payload={...} />` 替代 MessageItem，外面用同 key 的 `<div id="msg-…">` wrapper。(f) `ChatView.tsx#handleRuntimePinChange` 改造：先记录 `previousPin = runtimePin`（拿到原值才能写 from=X），原有 PATCH 逻辑保持；末尾加判断 `messages.some(m => m.role === 'user' && !m.id.startsWith('temp-'))`——只有真正有过用户消息（不只是 optimistic 占位）才追加 marker，避免新会话首次切换时多一条多余的"已切换"卡。命中条件下，构造 marker 字符串、push 一条 `temp-` id 的乐观消息，并 POST `/api/chat/messages` 持久化（沿用 image-gen-notice 同款的 messages API），失败 swallow（marker 不影响主流程）。dep array 新增 `runtimePin / messages / cappedSetMessages`。(g) i18n 中英两份新增三条 key：`runtimeSwitchMarker.changedFromTo`（"已切换执行引擎：{from} → {to}"）、`runtimeSwitchMarker.switchedTo`（"已切换到 {to}"，empty `from` 时用）、`runtimeSwitchMarker.followGlobal`（理论上 marker 不会出现这条，因为 to 一定是具体 runtime，but defensive label）。验证：`npx tsc --noEmit` clean、`npm run test` 1560 pass / 0 fail / 0 todo（不变；marker 是纯渲染逻辑，没有契约 test 必要）、`npx next build` 完成无 error；浏览器实测 dev server `/chat` 返回 200，rendered HTML 不再含 `runtimeDisplayLabel is not defined` 字样（R5 写到一半的中间态让 Turbopack HMR 短暂报错，最终 file 一致后 HMR 自愈）。**修复后用户路径**：(1) 输入框右下角 chip：⚠️ icon（issues）+ 圆环图标（按 % 填充）+ "16%" + 可选"· 已固定"chip——`点击` 打开 popover；(2) popover 浮层：标题"本次运行" + Model 行（"Aibrm · gpt-5.4"，右侧"切换"链接）+ DefaultMode 行（"自动"/"已固定"，右侧"修改"链接）+ Permission 行（"默认"/"完全访问"，无链接）+ Context 大 % + 进度条 + Input/Output/Cache 分解 + 自定义 issues 列表（如有）+ Total cost——明显比 R5 信息密度高，把 R5 误删的回来了；(3) 在 /chat/{id} 已经发过几轮消息后切 RuntimeSelector → transcript 中切换位置出现一条 ⎯⎯⎯ 已切换执行引擎：Claude Code → CodePilot Runtime ⎯⎯⎯ 的 inline 分隔卡，刷新页面后仍在（持久化到 messages 表）。
- 2026-05-07：**Phase 2 Step 4c review fix round 5 (P2: 既有会话 ChatView 仍漏一处 runtime-fallback + UX 收尾：badge 删除 + RunCockpit 改用 elements Context)**。round-3 在 `app/chat/page.tsx` 把 runtime-fallback 横幅 suppress 了，round-4 把 RunCockpit 的全局信号也接入 session override，但用户在 `/chat/{id}`（既有会话）切到 CodePilot Runtime 时仍看到上方"执行引擎已降级"——根因是 ChatView 自己的 `checkpointReasons` 完全是 round-3 之前的旧实现，按 `overview.agentRuntime + CLI 状态` 算 `runtimeFallback`，没有像新会话页那样在 `runtimePin` 非空时短路。同一会话路径上既有 / 新建两条入口的 checkpoint 实现长得几乎一样但是被独立维护，round-3 漏改了 ChatView 那份。**修 (A)**：`src/components/chat/ChatView.tsx` 的 `checkpointReasons` useMemo 加 `const overrideGlobalRuntimeFallback = !!runtimePin;`，`buildCheckpoints({ runtimeFallback: overrideGlobalRuntimeFallback ? false : runtimeFallback, ... })`，dep array 加 `runtimePin`——和 `app/chat/page.tsx` 里 round-3 的形状完全对齐。**契约测试同步加固**：把原本只扫 `app/chat/page.tsx` 的 round-2 contract test 末尾加一段，对 `components/chat/ChatView.tsx` 跑同样的"runtimeFallback 必须被 runtimePin-derived flag 守住 + checkpointReasons memo 必须引用 runtimePin"两条断言——以后任何一条新加的 checkpoint 入口（无论新会话还是既有会话）都得遵守这个 invariant，不会再因为"两份实现独立维护"漏掉一边。**用户附加 UX 反馈两条**：(B) RuntimeSelector 触发器的 "本会话已切换" 小徽属于冗余信息——用户自己刚点完，知道自己切了什么；如果是会话过程中切换，用 elements 库的 Checkpoint 组件在聊天里标记"切换位置"才是更合适的反馈面（这个独立 slice 留着）。round-5 把 RuntimeSelector 里的 isExplicitlyPinned 分支 + JSX 删掉、保留 `runtimeSelector.pinnedBadge` i18n key（暂时不删，未来 Checkpoint slice 可能复用一段相近文案）。(C) RunCockpit 重构：右下角原来是 "Runtime · Pinned · Context%" 三段 chip + Popover/RunStatusPanel 五行（runtime/model/defaultMode/permission/context）。RuntimeSelector 已经在 composer 左侧显式展示了 runtime；右下角再展示一次属于重复，且原本上下文段被压成 `19%` 一段 chip 也信息密度不够。round-5 把 RunCockpit 的主表面换成 elements 库的 `Context` 组件——`Context + ContextTrigger` 替代原 chip（默认显示 `19%` + 圆形进度环），`ContextContent` 里串 `ContextContentHeader`（大字百分比 + 进度条 + 已用 / 总量数字）、`ContextContentBody { ContextInputUsage / ContextOutputUsage / ContextCacheUsage }`（Input / Output / Cache 各自的 token 数 + 单价 + 成本）、自定义子节点（permission 行 + issues 列表，复用既有 i18n 与 navTo 行为）、`ContextContentFooter`（自动算 Total cost）。Capacity-unknown / pre-first-response 时 fall back 到普通 chip + Popover 同款 hover content；既保留以前那套"providers 没配 / no compatible / Claude CLI warnings"的 issues 入口（这些不在 RunCheckpoint 的 trigger 范围内），又把 runtime / model / defaultMode 三行删掉（前两条 RuntimeSelector + ModelSelectorDropdown 已经显式展示，第三条新会话切换后实际走 'auto'，没必要维持二选一展示）。`runtimeFallback` / `showGlobalDefaultInvalid` 两个变量保留，但只用于 `severity` 计算决定 chip 的颜色（warn / error），文字告警全部移交给 RunCheckpoint。**改的文件**：`src/components/chat/ChatView.tsx`（A）、`src/components/chat/RuntimeSelector.tsx`（B）、`src/components/chat/RunCockpit.tsx`（C，主体重写 chip + popover content；rowSegments / RunStatusPanel 调用全部移除；imports 增加 ai-elements/context）、`src/__tests__/unit/session-runtime-immunity.test.ts`（contract test 扩到 ChatView.tsx）。`RunStatusPanel.tsx` 暂时保留（仅 RunCockpit 引用，本轮已不再 import；可在下一轮清理），方便未来其它"per-chat 状态卡"surface 复用。验证：`npx tsc --noEmit` clean、`npm run test` 1560 pass / 0 fail / 0 todo（既有 round-2/3/4 contract 加新断言，count 不变）、`npx next build` 完成无 error。**修复后用户路径**：(1) /chat/{id} 切 CodePilot Runtime → A 修复让上方"执行引擎已降级"消失，跟 RunCockpit 一致；(2) RuntimeSelector trigger 不再挂"本会话已切换"小徽，只显示当前 runtime 名字；(3) 右下角不再重复 runtime 标签，改为 elements `Context` 组件——hover 出来的卡片有完整的 input / output / cache token 分解 + 总成本，既补足了用户说的"原来除了引擎还有其他信息现在被丢了"，也用一个 industry-standard 的视觉语言展示上下文。**未做（后续 slice）**：用 elements `Checkpoint` 组件标记会话过程中"runtime 切换"位置——这是 B 反馈里用户自己提的方向，需要单独探讨"哪些会话事件应该落进 Checkpoint 组件"，留下次。
- 2026-05-07：**Phase 2 Step 4c review fix round 4 (P2: RunCockpit 仍用全局默认状态显示『固定不可用』)**。round-3 把上方的 RunCheckpoint runtimeFallback 横幅 suppress 了，但用户实测 `checkpointReasons=[]` + 输入框已解锁 + 上方横幅干净的情况下，**右下角的 RunCockpit chip 仍显示红色「Claude Code · 固定不可用」**。两块面板共用一条交互反馈，半修一半就给用户"上面说能发、下面说不行"的相互矛盾信号；用户明确指出这条不应推迟，应同轮收。**根因**：`RunCockpit.tsx` 自己 `const state = useOverviewData()`，再用 `state.agentRuntime / state.defaultInvalid / state.defaultMode / state.defaultProviderName / state.defaultModelLabel` 装配状态行 + 严重度 + issues 列表 + 面板 row tone，**不知道父级 ChatView / chat/page 已经 PATCH 了 runtime_pin、不知道 picker 的 resolved pair、不知道父级的 override 决定**。`runtimeFallback` 在组件里也是从全局重算的副本，跟父级 round-3 那个 suppress 没关系。**修**：(a) `RunCockpit` 加 prop `sessionRuntimePin?: string`；(b) 内部 derive `sessionRuntimeOverride = !!sessionRuntimePin` 一次，下面所有信号都过这道闸；(c) `effectiveRuntime` 计算除既有的 `isNonAnthropicProvider → native` 之外，加 `sessionPinnedAgentRuntime` 一档：`'claude_code' → 'claude-code-sdk'`、`'codepilot_runtime' → 'native'`，让 chip 上的 runtime label 真实反映用户切到的 runtime（而不是全局 setting）；(d) `runtimeFallback = !sessionRuntimeOverride && state.agentRuntime === 'claude-code-sdk' && effectiveRuntime !== 'claude-code-sdk'`——override 下短路；(e) 新增本地变量 `showGlobalDefaultInvalid = !sessionRuntimeOverride && state.defaultInvalid`，把所有 `state.defaultInvalid` 的读点（severity / row segments / issues / panel row tone / 面板 modelRow tone / defaultModeRow value / defaultModeRow tone）一并改用这个 gated 值；(f) 状态行 `rowSegments` 那个 `else if (modeIsPinned)` 分支也加 `&& !sessionRuntimeOverride`——session override 下不显示「固定/固定不可用」chip 文字（chip 由 RuntimeSelector 那边的"本会话已切换"小徽 take over）；(g) `defaultModeRow.value` 在 override 下直接显示 `runStatus.modeAuto`，匹配 round-2 在 `chat/page.tsx` 把 resolver mode 改成 'auto' 的语义，不再让用户看「固定/固定不可用」二选一；(h) 两处 `<RunCockpit>` 调用站点（`ChatView.tsx`、`app/chat/page.tsx`）都加 `sessionRuntimePin={runtimePin}`——declared 但 not 传 = 静默回归，所以契约 test 必须钉两处都传。**新增 1 条契约测试**：(i) `RunCockpit.tsx` 必须声明 `sessionRuntimePin?: string` prop；(ii) 必须有 `sessionRuntimeOverride = !!sessionRuntimePin` derive；(iii) `runtimeFallback` 计算必须 short-circuit 在 `!sessionRuntimeOverride` 上；(iv) 两个调用站点都必须 `sessionRuntimePin={runtimePin}`——任何一处缺失立刻红。验证：`npx tsc --noEmit` clean、`npm run test` 1560 pass / 0 fail / 0 todo（前 1559 / +1 新 case）、`npx next build` 完成无 error。**修复后用户路径**（round-1/2/3/4 全链路）：/chat 全局 pinned + 不可用 → 上方 RunCheckpoint 红 + 下方 RunCockpit 红 + 输入框 disabled → 用户切 RuntimeSelector 到 CodePilot Runtime → round-1 让 fetch URL 用新 runtime → round-2 让 resolver 走 'auto' 不强制全局 pin + 让 checkpoint 不再 OR overview.defaultInvalid → round-3 让 checkpoint 不再 OR runtimeFallback → round-4 让 RunCockpit 整个组件以 session override 为准，**全局 defaultInvalid + runtimeFallback 全部短路** → 上方横幅消失 + 下方 chip 变成 "CodePilot Runtime" 干净状态 + 输入框解锁 → 一条没有矛盾信号的交互路径。
- 2026-05-07：**Phase 2 Step 4c review fix round 3 (P2: 显式切到 CodePilot 后仍显示全局执行引擎降级 horizontal banner)**。Codex 浏览器三跑：round-2 把 pinned-invalid 闸门关了，但页面又冒出来一条新的 RunCheckpoint —— "执行引擎已降级 / 当前选择的执行引擎不可用"。runtime chip 是"CodePilot Runtime · 本会话已切换"、模型是 GPT-5.4、textarea 已经解锁，但中间这条横幅还在。**根因**：`runtimeFallback` 同 `overview.defaultInvalid` 一样属于"纯全局信号"——它读 `overview.agentRuntime === 'claude-code-sdk' && effectiveRuntime !== 'claude-code-sdk'`，意思是"全局选了 Claude Code SDK 但 CLI 不在 → 全局降级到 native"。对**整个应用**来说这条提示是对的，但用户已经显式选了 CodePilot Runtime——他对 Claude Code SDK 的全局降级根本不关心，本会话已经走 native，不存在"我以为在 SDK 但其实回退了"的混淆。继续展示这条横幅就是把全局健康信号当成会话异常来吓人。**修**：跟 round-2 完全同形——`buildCheckpoints` 调用里的 `runtimeFallback` 也用 `overrideGlobalPinnedGate ? false : runtimeFallback` 三元包一层，显式 runtime pin 下整体 suppress。`overrideGlobalPinnedGate` 既有变量复用，rename 不必要。**契约测试同步加固**：在 round-2 contract 末尾加一条匹配 `<flag> ? false : runtimeFallback`（或对称 `&& !flag` 形式）的正则，把这条 suppression 也钉在静态防线里——以后任何全局信号要进 buildCheckpoints 都得走同款 override gate，否则立刻红。验证：`npx tsc --noEmit` clean、`npm run test` 1559 pass / 0 fail / 0 todo（同条 case 加断言，count 不变）、`npx next build` 完成无 error。**修复后用户路径**（与 round-2 接续）：用户切到 CodePilot Runtime → round-2 让 pinned-invalid 横幅消失 → round-3 让 runtime-fallback 横幅也消失 → 页面回到干净状态，仅 picker 上方的"本会话已切换"小徽提示用户已经显式选择，不再有任何全局信号被误读成会话异常。**P2 deferred** 在 round-4 已经收掉（用户原本标 `忽略` 但复盘后明确"应该这轮一起收"，见 round-4 entry）。
- 2026-05-07：**Phase 2 Step 4c review fix round 2 (P1: 显式切到 CodePilot 后仍被全局 pinned default 阻断)**。Codex 浏览器二次复跑：round-1 把 fetch URL 改成 `?runtime=${sessionRuntimeParam}` 之后，picker 模型按钮和"本会话已切换"小徽都正确响应了，但 RunCheckpoint 红条没消、textarea/发送按钮仍 disabled。**根因**比 round-1 深一层：`resolveNewChatDefault` 的 `mode` 参数仍然按全局 `default_mode === 'pinned'` 决定，意味着即便 fetch 用了新 runtime 过滤、resolver 仍然要"全局 pinned 模型必须在结果集里"——而那个全局 pin 在新 runtime 下根本不可达，于是固定返回 `'invalid-default'`、`setInvalidDefault` 一触发，红 RunCheckpoint 就回来了；同时 `checkpointReasons.defaultInvalid: !!invalidDefault || overview.defaultInvalid` 还把 `useOverviewData()` 算的"全局 pinned 不可用" OR 进来——这个 overview 信号是绝对全局的，跟 session runtime 无关，所以哪怕本地 `invalidDefault` 清了它仍把红条拉回来。两条路一起锁死，让用户必须去修全局默认才能发——可用户的真实意图是"我已经显式选了别的 runtime，picker 已经为我自动挑好了能用的 provider/model，让我发"。**修**两件：(1) `app/chat/page.tsx` 两处 `resolveNewChatDefault({...})` 都加一段 `effectiveMode = runtimePin ? 'auto' : (opts?.default_mode === 'pinned' ? 'pinned' : 'auto')`——显式 runtime 切换 → resolver 走 'auto' 分支（saved → apiDefault → first，picker 已经 resolved 的 pair 直接命中），没有显式切换 → 保持原 'pinned' 严格语义（不破坏 feedback_pinned_default_hard_promise 内存里的"pinned 是硬承诺"规则，只在用户主动覆盖时让步）；(2) `checkpointReasons` memo 加 `const overrideGlobalPinnedGate = !!runtimePin;` + `defaultInvalid: !!invalidDefault || (!overrideGlobalPinnedGate && overview.defaultInvalid)`——显式 runtime 下 overview.defaultInvalid 不再 OR，这是合理的因为那是个全局 pinned 状态、跟用户已经手动覆盖的 session runtime 无关；同步把 `runtimePin` 加进 memo 的 deps array。同时把 `runtimePin` state 和 `sessionRuntimeParam` derive **上移**到 `checkpointReasons` 之前（之前是后定义，hoisting 后 TDZ 在 useMemo body 里炸 typecheck），上移后所有 consumer 都能看见。**新增 1 条契约测试**钉死这条修复：(i) 必须有 ≥2 处 `effectiveMode...runtimePin` 模式（initial-load + provider-changed 两条 effect 都得有）；(ii) `overview.defaultInvalid` 必须被一个 runtimePin-derived flag 用 `&&` 守住，不能裸 OR；(iii) `checkpointReasons` useMemo body 必须引用 `runtimePin`，强制 override flag 跟用户选择保持联系——任意一项被未来 refactor 抹掉立刻红。验证：`npx tsc --noEmit` clean、`npm run test` 1559 pass / 0 fail / 0 todo（前 1558 / +1 新 case）、`npx next build` 完成无 error。**修复后用户路径**（与 round-1 描述对比，只在 round-1 未走通的边界上补强）：/chat 全局是"pinned + 不可用" → 红 RunCheckpoint + 输入禁用 → 用户选 CodePilot Runtime → 两条 effect 触发：(a) fetch 用新 runtime 过滤 + (b) resolver 走 'auto' 分支 + (c) checkpoint memo 在 runtimePin 非空时不再 OR overview.defaultInvalid → resolved pair 来自新 runtime 下的 saved/apiDefault/first，invalidDefault 清空，defaultInvalid checkpoint 不再触发 → 红条消失 + 输入解锁 → 用户直接发消息，**不需要去 Settings 修全局默认**。
- 2026-05-07：**Phase 2 Step 4c review fix round 1 (P1: 新会话 RuntimeSelector 切换后 RunCheckpoint 仍用旧 runtime 判定)**。Codex 浏览器复现：打开 /chat 时由于全局 pinned 默认模型不可用、出现红色 "固定默认模型不可用" RunCheckpoint + 输入框 disabled；切 RuntimeSelector 到 CodePilot Runtime 后 MessageInput 的模型按钮如预期跟着切到 GPT-5.4，但 RunCheckpoint 不消、输入框仍然被锁。**根因**：`src/app/chat/page.tsx` 的两处默认模型校验 effect（初始 mount 校验 line 231-312；`provider-changed` 事件监听 line 390-485）都把 fetch URL 硬写成 `/api/providers/models?runtime=auto`、deps 也都是 `[]`，意味着 runtime 一旦切换：(a) URL 不变 → 服务端仍按 mount 时的 runtime 过滤；(b) deps 空 → effect 不会重跑。结果就是 picker hook（`useProviderModels`）走自己的 runtime 参数化路径正确响应了，但页面级的 `invalidDefault` / `noCompatibleProvider` / `checkpointReasons` 全部停留在切换前的判定，RunCheckpoint 和 MessageInput 的 `disabled` 都基于这些 stale state。Step 4c round 1 自身只把 picker 接到了新 runtime，没把"页面级阻断信号"也跟着重算——这是漏的那一公里。**修**：(a) 在 `runtimePin` state 之后立即 derive `const sessionRuntimeParam = chatRuntimeParamForSession(runtimePin)` 一次，下面所有 fetch 复用；(b) 两处 `fetch('/api/providers/models?runtime=auto')` 改成 `fetch(\`/api/providers/models?runtime=${sessionRuntimeParam}\`)`；(c) 两处 effect 的 deps 都从 `[]` 改成 `[sessionRuntimeParam]`，让用户切 runtime 立刻触发 re-validate；(d) 初始 mount effect 在 fetch 开始前加 `setModelReady(false)`，这样 re-run 期间 consumer 看到的是"仍在解析"而不是上一轮的过期结论；(e) `MessageInput` 的 `runtime` prop 也改成 `sessionRuntimeParam`，用同一个变量取代之前那次 inline 调用，DRY。**新增 1 条契约测试**钉死这条修复：扫整个 `app/chat/page.tsx` (i) 不允许出现 `runtime=auto` 字面量；(ii) 必须有 `\`/api/providers/models?runtime=${sessionRuntimeParam}\`` 模板；(iii) 每个使用该 URL 的 useEffect 后续 ~6000 字符内必有 `, [...sessionRuntimeParam...]` 的 deps array——任意一处被未来 refactor 改回硬写或 deps 删了立刻红。**端到端 API 真机验证**：dev server 上分别请求 `?runtime={auto,codepilot_runtime,claude_code}` 三个值，返回的 `groups` 各不相同（auto/claude_code 都从 env Anthropic 起，codepilot_runtime 从 openai-oauth 起），证实 URL 模板一旦传过去就实际改变服务端过滤路径。`npx tsc --noEmit` clean、`npm run test` 1558 pass / 0 fail / 0 todo（前 1557 / +1 新 case）、`npx next build` 完成无 error。**修复后用户路径**：/chat 默认 pinned 不可用 → 红 RunCheckpoint + 输入禁用 → 用户在 RuntimeSelector 选 CodePilot Runtime → effect 立即重跑 → 服务端用新 runtime 重新过滤 → 新 runtime 下 pinned 可用 → `invalidDefault` 清空 → RunCheckpoint 消失 + 输入解锁 → 直接发消息。**未做**（review 顺手提到但属下一轮范围）：尚未给 RuntimeSelector 加"恢复跟随全局" (`runtime_pin: ''`) 选项。后端 PATCH 已支持空字符串，但 Run 面板里加这条会涉及"是否在主状态展示跟随默认"的产品决定（plan §2.3 原本只允许在新会话初始态展示），单独提交一轮。
- 2026-05-07：**Phase 2 Step 4c composer 工具栏执行引擎切换完成**。Step 4a/4b 让"会话锁定 runtime + 不再被全局漂移"在底层成立，但用户仍然没有显式切换入口——只能等 lazy-seed 把第一条消息时的全局值固化下来。Step 4c 把切换 UI 直接放进 composer 工具栏：用户指定的位置是 `[模式] [对话引擎] [权限]` 三联，对话引擎插在模式（代码 / 计划）和权限（默认 / 完全访问）中间。**改动**：(a) 新增 `src/components/chat/RuntimeSelector.tsx`——隐形 ghost button trigger + Brain 图标 + 当前 runtime 标签 + 用户已切换时挂"本会话已切换"小徽，DropdownMenu 两条选项（Claude Code / CodePilot Runtime）带描述，已选项右侧勾号；视觉语言完全沿用 ModeIndicator / ChatPermissionSelector 的 invisible-until-hover pattern（feedback_composer_invisible_until_hover），不引入新的视觉重量；(b) `src/app/api/chat/sessions/[id]/route.ts` PATCH 接受 `runtime_pin`，校验枚举 `'' | 'claude_code' | 'codepilot_runtime'`（非法值 400），写入走 `updateSessionRuntime`，**`sdk_session_id` cleanup 条件加上 `runtimePinChanged`**——SDK session 跨 runtime 一定失效（同 model/provider 跨 runtime 失效一致），下条消息走干净的新 SDK session；(c) `src/components/chat/ChatView.tsx`：`runtimePin` 从 prop-only 升级成 local state（`useState` + sync `useEffect`），新增 `handleRuntimePinChange` 调 PATCH + 乐观 `setRuntimePin`，挂在 RuntimeSelector 的 `onRuntimePinChange`；toolbar 里 `[ModeIndicator] [RuntimeSelector] [ChatPermissionSelector]` 三联，streaming 中 `disabled`；(d) `src/app/chat/page.tsx`（新会话路径）也加同款 selector + 本地 `runtimePin` state，并把 MessageInput 的 `runtime` prop 从硬写 `"auto"` 改成 `chatRuntimeParamForSession(runtimePin)`（picker 立刻按用户选择过滤）；新会话第一次发送的流程改成"`POST /api/chat/sessions` 创建 → 若 `runtimePin` 非空，**先 await PATCH 写 runtime_pin，再 POST /api/chat 发消息**"，这样 chat route 的 lazy-seed 看到 `session.runtime_pin` 已经非空就跳过全局兜底，用户的显式选择端到端生效；(e) i18n 中英两份新增 `runtimeSelector.{triggerAria,claudeCode,claudeCodeDesc,codepilotRuntime,codepilotRuntimeDesc,pinnedBadge}` 六条 key，中文用"执行引擎 / 本会话已切换"。**新增 2 条契约测试**：(i) PATCH 路由必须 import `updateSessionRuntime` + 必须有同时引用 `claude_code` / `codepilot_runtime` 的 400 校验块 + `sdk_session_id` cleanup 条件必须扩成 `(modelChanged || providerChanged || runtimePinChanged)`；(ii) ChatView 必须 import 并渲染 `RuntimeSelector`、必须有 `useCallback` 包的 `handleRuntimePinChange` 调 PATCH 写 `runtime_pin`、`runtimePin` 必须是 `useState` 局部状态（防止重退化成 prop-only 后写盘要等父组件 reload）。**端到端 PATCH 真机验证**：dev server 上对真实 session 跑三发 PATCH —— 合法值（`codepilot_runtime`）→ 200 + 返回 session 中 `sdk_session_id` 被清空（cleanup 实际生效，非空文档）；非法值（`bad-value`）→ 400 + 中英 error message；空值（`""`）→ 200，restore "follow global"。验证：`npx tsc --noEmit` clean、`npm run test` 1557 pass / 0 fail / 0 todo（前 1555 / +2 新 case）、`npx next build` 完成无 error。**用户行为路径**：(1) 旧会话进 /chat/[id] → composer 工具栏看到 "代码 · Claude Code · 默认权限" 三联 → 点 Claude Code 切到 CodePilot Runtime → 立刻 PATCH 写盘 + 触发器更新 + 挂"本会话已切换"小徽 → 下一条消息走 native runtime；(2) 新会话进 /chat → 同样三联 → 选 CodePilot Runtime → 输入消息发送 → 后端按"先建 session、再 PATCH runtime_pin、最后 POST 发消息"顺序执行，跳过全局 fallback。**未做**（按 Step 4c 口径）：未把 provider/model 切换器移进 Run 面板（仍走 composer 既有的 `ModelSelectorDropdown`，handler 沿用 `handleProviderModelChange`）；未引入 session events `runtime.selected/runtime.changed` 落库（属 Phase 3.3 的范畴，留下次）；未做 Browser smoke（chrome-devtools MCP 由用户那边运行，本轮只做了 API 真机往返）。
- 2026-05-07：**Phase 2 Step 4b review fix round 5 (P2: doStartStream Guard 4 deps 漏 sessionProviderRuntimeIncompatible)**。Codex 抓到 round-3/4 都没注意到的 stale-closure 风险：`doStartStream = useCallback(...)` 第 876 行读 `sessionProviderRuntimeIncompatible` 做 Guard 4，但第 923 行的 dep array 没把这个 flag 列进去——意味着 React 复用旧闭包时该值会停留在被 capture 时的值。round-4 已经在 sendMessage / dequeue 前置 guard 里把 ghost-message 路径堵住，所以实际可观察的 bug 大概率没有，但 doStartStream 本身仍可能在 runtime / provider 状态切换之后用陈旧的 flag 值——要么"flag 已翻 true 但闭包还是 false"、Guard 4 漏拦后端 wire 仍跑、要么"flag 翻回 false 但闭包还是 true"、Guard 4 误拦本该可以发的消息。修：第 923 行 dep array 末尾加 `sessionProviderRuntimeIncompatible`。**契约测试同步加固**：把 Step 3b review 那条原本只检 (a) early-return + (b) MessageInput.disabled 的 GREEN test 扩成第三条断言——扫整个文件统计 `\[[^\[\]]*sessionProviderRuntimeIncompatible[^\[\]]*\]` 出现次数（dep array 是扁平 identifier 列表、内部不会有嵌套方括号，正则可靠），要求 ≥ 3（doStartStream + sendMessage + dequeue 三处 dep 都要列）。任何一处的 dep 被未来 refactor 删掉、count 立刻掉到 2、test 立刻红。验证：`npx tsc --noEmit` clean、`npm run test` 1555 pass / 0 fail / 0 todo（数量不变，因为只是给原 GREEN test 加了一段断言）、`npx next build` 无 error。**修复后保证**：所有读 `sessionProviderRuntimeIncompatible` 的 callback / effect 都跟它的真实变化同步，没有 capture 漂移空间。
- 2026-05-07：**Phase 2 Step 4b review fix round 4 (P2: 队列出队仍会留下不兼容 provider 的幽灵消息)**。Codex 抓到 round-3 还没堵的同类边界：`sendMessage` 已经在 push optimistic bubble 之前查 `providerFetchState === 'idle'` / `noCompatibleProvider`，但漏了 `sessionProviderRuntimeIncompatible`；dequeue effect 也只查那两条。情景：用户 streaming 时排队了消息 B，A stream 结束前 session pinned runtime 翻成与当前 provider 不兼容（picker 别处改、新数据回来等），dequeue 触发 → push `temp-*` 用户气泡 → `doStartStream` Guard 4 拦掉 → ghost B 留在 transcript（后端没 `addMessage`、本地是 optimistic）。和 round-2/3 是同一形状的"先 append 后 reject"。修：(a) `sendMessage` 在两条已有 guard 之后、queue 检查之前加第三条 `if (sessionProviderRuntimeIncompatible) { console.warn(...); return; }`，并把该 flag 加进 `useCallback` dep array —— 锁住 autoTrigger / widget bridge / pendingRetryAfterCompact 这些绕开 MessageInput.disabled 直接调 sendMessage 的路径；(b) dequeue effect 同位置加同 guard，**HOLD 队列**而非清空（与 `noCompatibleProvider` 的清空策略不同），因为这是用户能在 picker 里自我修复的状态——一旦 flag 翻 false，effect 重新跑、队列照常出，用户不会丢已经排好的消息；同样把 flag 加进 dep array 让重跑实际发生。**新增契约测试**：扫描整个 ChatView.tsx 找 `pendingOptimisticUserIdRef.current = userMessage.id` 全部出现位置（push optimistic bubble 的可靠 anchor），断言每一处的前置 ~4000 字符内必有 `if (sessionProviderRuntimeIncompatible) … return` 早返回；以后任何新加的 optimistic push 路径自动继承这条契约——只要忘记加 guard 就立刻红。验证：`npx tsc --noEmit` clean、`npm run test` 1555 pass / 0 fail / 0 todo（前 1554 / +1 新 case）、`npx next build` 无 error。**修复后用户路径**：用户 streaming 时排队 B → session 变 incompatible → A 完成后 dequeue 不再 append optimistic、console warn "dequeue held"、横幅本来就在画面上 → 用户在 picker 选兼容 provider → flag 翻 false → effect 重跑、B 正常发送 → 没有 ghost message。
- 2026-05-07：**Phase 2 Step 4b review fix round 3 (P2: round-2 清理太宽会误删历史 temp 用户消息)**。Codex 抓到 round-2 的边界缺口：handler 用 `m.role === 'user' && m.id.startsWith('temp-')` 一刀切，所有 `temp-*` 用户消息全删；但 ChatView 正常发送成功后并不会立刻把 optimistic `temp-${Date.now()}` 用户气泡换成 DB 行（temp → 真 id 的 swap 要等下次 reload 或 reconcile），所以连续发几轮后 `messages` 里同时存在多个 `temp-*` 用户气泡。某次 INVALID_SESSION_PROVIDER 触发时，handler 会把本次失败之前的"已经发送成功的"历史 user turns 也从屏幕上抹掉 —— 用户只看到 transcript 突然少了几条，banner 完全无法解释这个副作用。修：(a) `src/components/chat/ChatView.tsx` 加 `pendingOptimisticUserIdRef = useRef<string | null>(null)` 跟踪当前那一条；(b) `sendMessage` 与 dequeue 在 `cappedSetMessages([..., userMessage])` 之前都加 `pendingOptimisticUserIdRef.current = userMessage.id`，把刚 push 进去的 id 抓住；(c) `chat-invalid-session-provider` handler 改成 `const pendingId = pendingOptimisticUserIdRef.current; if (pendingId) { cappedSetMessages((prev) => prev.filter((m) => m.id !== pendingId)); pendingOptimisticUserIdRef.current = null; }` —— 严格按 id 等值比较，只删本次失败的那一条；(d) `handleStreamCompleted` 末尾加 `pendingOptimisticUserIdRef.current = null`，所有 stream 收尾路径（成功 / 普通错误 / abort / idle-timeout）都会把 ref 清空，杜绝下一次 409 命中过期 id 的可能。**契约测试同步收紧**：把 round-2 那条"必须包含 `m.id.startsWith('temp-')`"的断言换成三条新断言：(i) ChatView 必须声明 `pendingOptimisticUserIdRef = useRef<...>`，(ii) 必须把 `userMessage.id` 写进 `pendingOptimisticUserIdRef.current`，(iii) handler 必须读 `pendingOptimisticUserIdRef.current` 并以 `m.id !==` 形式过滤 —— 任何一处被未来 refactor 改宽（比如改回 prefix 匹配），test 立刻红。验证：`npx tsc --noEmit` clean、`npm run test` 1554 pass / 0 fail / 0 todo（数量与 round-2 持平，因为旧的 single-test 被三条更精确的断言替代）、`npx next build` 完成无 error。**修复后用户路径**：连续发 5 条消息成功（`messages` 里有 5 个 `temp-*` 用户气泡）→ 第 6 条触发 INVALID_SESSION_PROVIDER → 红横幅出现 + 只删第 6 条的 ghost 气泡，前 5 条历史 turns 完整保留 → 用户切 picker → 横幅消失 → 重发走新 provider。
- 2026-05-07：**Phase 2 Step 4b review fix round 2 (P2: 409 仍留 ghost 用户消息 + 错误气泡)**。Codex 抓到 round 1 的洞：dispatch 完 `chat-invalid-session-provider` 后 `stream-session-manager` 仍然 `throw new Error(...)`，下面的 catch 把它当普通 stream error 处理，会把 `**Error:** Session points at a provider that no longer exists.` 写进 `finalMessageContent` —— 用户会看到一条带红色 banner 的 assistant 错误气泡；与此同时 `sendMessage` 在 `doStartStream` 之前已经乐观追加了一条 `temp-${Date.now()}` 用户 bubble，后端 409 直接挂掉、temp 消息不会被 stream completion 转成真消息，所以也留在 transcript 里。三个信号叠在一起（红 banner + 错误气泡 + 幽灵用户消息）和 round 1 承诺的"红色横幅是唯一信号、transcript 干净"完全相反。**两段修复**：(a) `src/lib/stream-session-manager.ts:!response.ok` 分支：`const e = new Error(err?.error || 'Failed to send message'); if (err?.code) (e as Error & { code?: string }).code = err.code; throw e;` —— 把后端 code 标记到 Error 对象上；同文件 catch 分支：`const errorCode = (error as Error & { code?: string })?.code; const silentError = errorCode === 'INVALID_SESSION_PROVIDER';`，`stream.snapshot.finalMessageContent` 改成 `silentError ? null : buildFinalContent('**Error:** ${errMsg}')`，这条 code 走 silent 分支，不再生成错误气泡。`error` 字段仍照常写（只是不渲染到 transcript），既有 `onError` 调用方逻辑不破。(b) `src/components/chat/ChatView.tsx` 监听 `chat-invalid-session-provider` 的 useEffect 里，在 `setInvalidSessionProvider({...})` 之后追加 `cappedSetMessages((prev) => prev.filter((m) => !(m.role === 'user' && typeof m.id === 'string' && m.id.startsWith('temp-'))))` —— 后端早期 gate 没有 `addMessage`，所以本地 `temp-*` 用户消息在 DB 是不存在的，直接清掉就和"这次发送从未发生"对齐；filter 用 `temp-*` 前缀（`sendMessage` 自己的 id 约定）+ `role === 'user'` 双闸，避免误删历史消息。**新增 2 条契约测试**钉死这条修复（`session-runtime-immunity.test.ts`）：(i) `stream-session-manager` 必须把 `err.code` 复制到抛出的 Error 上 + catch 分支必须有 `finalMessageContent: <flag> ? null : buildFinalContent(...)` 三元 + 该 flag 必须 gate 在 `=== 'INVALID_SESSION_PROVIDER'` —— 任何一段被未来重构去掉，silent 路径都会回退成"任何错误都生成气泡"或"全部失败都不生成"，两边都立刻红；(ii) `ChatView.tsx` 必须包含 `m.id.startsWith('temp-')` 的过滤模式 —— 重构若把 optimistic 消息 id 协议改了或忘了清理，立刻红。验证：`npx tsc --noEmit` clean、`npm run test` 1554 pass / 0 fail / 0 todo（前 1552 / +2 新 case）、`npx next build` 完成无 error（仅一条无关的 turbopack workspace-root warning）。**修复后用户路径**：旧会话 provider 被删 → 用户按发送 → 后端 409 → 红横幅出现 + transcript 完全干净（没有错误气泡、没有 ghost 用户消息）→ 用户点 picker 选新 provider → 横幅消失 → 再发送走新路径。
- 2026-05-07：**Phase 2 Step 4b 409 INVALID_SESSION_PROVIDER 前端横幅完成**。Step 3a 已经让 chat route 在 session 指向已删除 provider 时返回 `{status: 409, code: 'INVALID_SESSION_PROVIDER', sessionProviderId, reason}`，但前端 `stream-session-manager` 只是抛 generic Error，用户看到 toast 不知道发生了什么、也没指引。修：(a) `stream-session-manager.ts` 的 `!response.ok` 分支加分支判断 `err?.code === 'INVALID_SESSION_PROVIDER'` → `dispatchEvent(new CustomEvent('chat-invalid-session-provider', { detail: { sessionId, sessionProviderId, reason } }))`，generic Error 仍照常抛（既有 onError 路径不破）；(b) `ChatView.tsx` 加 state `invalidSessionProvider` + `useEffect` 监听 `chat-invalid-session-provider` window event，sessionId 匹配才接，避免跨会话串台；同 ChatView 还加一个 `useEffect` 在 `currentProviderId !== invalidSessionProvider.sessionProviderId` 时自动 `setInvalidSessionProvider(null)`，picker 切完 provider 横幅自动消失，无需点 X；(c) banner 渲染：`role="alert"`、错误色 (`bg-status-error-muted`)、文案走 i18n key `chat.invalidSessionProvider.message` 带 `{providerId}` 占位，中英文都加；(d) 新增 2 条契约测试：`stream-session-manager` 必须 dispatch 该 event、ChatView 必须 listen + 必须有 `setInvalidSessionProvider(null)` 清除分支——任何一边重构掉就会立刻红。`npm run test` 1552 pass / 0 fail / 0 todo（前 1550 / +2 新 case），`npx next build` `✓ Compiled successfully in 37.9s`，typecheck clean。**用户行为路径**：旧会话 provider 在另一窗口被删 → 用户在这边按发送 → 后端 409 → 横幅出现"本会话保存的服务商「{id}」已经被删除，请在下方挑选其它服务商" → 用户点 picker 选新 provider → 横幅消失 → 再发送走新路径。
- 2026-05-07：**Phase 2 Step 4a review fix (P2: autoTrigger 悄悄固化 runtime_pin)**。Codex 抓到 4a 的边界缺口：lazy-seed 对所有 `/api/chat` 请求都生效，包括 autoTrigger 的心跳 / 助理后台触发 / `/skill` 展开等 invisible 系统消息——用户没打开 chat、没按发送，仅仅因为后台心跳跑过去就把当时的全局 agent_runtime 写进 `session.runtime_pin`。承诺的"用户首次发送时固化"被破坏。修：lazy-seed 守卫从 `if (!session.runtime_pin)` 收紧到 `if (!session.runtime_pin && !autoTrigger)`，与同文件已有的 `addMessage` / `updateSessionTitle` 的 `!autoTrigger` 守卫保持一致语义。autoTrigger 仍然走 `effectiveSessionRuntime` 解析路由本次消息，只是不持久化决策。同步把契约 test 的正则收紧到 `!session.runtime_pin && !autoTrigger`（顺序无关），任何一边被未来重构去掉就会立刻红。`npm run test` 1550 pass / 0 fail，`npx next build` `✓ Compiled successfully in 29.4s`。
- 2026-05-07：**Phase 2 Step 4a lazy migration 完成**。Step 2-3 把 `runtime_pin` 列、resolver wrapper、send route、streamClaude、UI hook 全打通了，但还有最后一公里：旧会话和 Step 3b 落地前创建的会话都是 `runtime_pin=''`，每次发送都会走"全局 fallback"路径，全局再变还是会漂。修：在 chat route 早期 gate 之后（resolver invalid 检查后），加 lazy-seed —— 当 `!session.runtime_pin` 时，调 `updateSessionRuntime(session_id, resolveRuntimeForSession(session))` 把当前已解析的 runtime label 锁进 DB，并同步 mutate 内存的 `session.runtime_pin` 让本次的 streamClaude 也读到 seeded 值。具体改动：(a) `app/api/chat/route.ts` import `updateSessionRuntime`；(b) 把原本 inline 的 `resolveRuntimeForSession(session)` 提到 `effectiveSessionRuntime` 局部，让 gate 和 lazy-seed 复用；(c) `if (!session.runtime_pin)` 分支调 `updateSessionRuntime` + 内存 mutate；(d) 新增静态 source 测试钉住三件事：导入 `updateSessionRuntime`、`!session.runtime_pin` 守卫调用、内存 mutate（保证本次 streamClaude 也读到新值，不只是下一轮）。语义结果：**用户首次发送的那一刻，session 就被钉死在当前 runtime 上，之后改全局 agent_runtime 不会再回头追这个 session**。`npm run test` 1550 pass / 0 fail / 0 todo，`npx next build` `✓ Compiled successfully in 29.2s`，typecheck clean。**剩两件事**：4b 前端消费 `INVALID_SESSION_PROVIDER` 409（chat route 已经返回正确 code，stream-session-manager 只是抛 generic Error，需要改成识别 code → 显示 inline banner）；4c Run 面板加切换 UI 让用户主动切 runtime / model / provider。
- 2026-05-07：**Phase 2 Step 3b review fix (P1: client bundle 构建失败)**。Codex 浏览器 smoke 抓到 chat 页直接 Build Error：`Module not found: Can't resolve 'async_hooks'`，trace 是 `ChatView.tsx → chat-runtime.ts → runtime/index.ts → sdk-runtime.ts → claude-client.ts → async_hooks`。Step 3b round 1 把 `chatRuntimeParamForSession` 加到 `chat-runtime.ts`，但该文件顶层 `import { resolveRuntime } from './runtime'` 会把 Sentry / OpenTelemetry / child_process / async_hooks 一路带进 client bundle。这是 `npm run test` 看不到的洞——单测在 Node 里跑，async_hooks 本来就在；只有 `next build` / 浏览器 dev 会炸。修复：(a) 新建 `src/lib/chat-runtime-shared.ts`，零外部 import，只放纯类型 (`ChatRuntime`、`ChatRuntimeParam`) + 纯函数 (`isChatRuntimeParam`、`chatRuntimeParamForSession`)；(b) `src/lib/chat-runtime.ts` 用 `export type {...} from './chat-runtime-shared'` + `export { ... } from './chat-runtime-shared'` re-export，server-only 的 `getActiveChatRuntime / resolveChatRuntimeParam / resolveRuntimeForSession`（这三个需要 `./runtime`）继续留这里——既有 server 调用方零改动；(c) `ChatView.tsx` / `MessageInput.tsx` 改成从 `@/lib/chat-runtime-shared` 导入，附 import-comment 解释为啥这两个 client component 一定要走 shared。验证：`npx next build` → `✓ Compiled successfully in 31.4s`，`/chat` 和 `/chat/[id]` 都在 route table 里；`npm run test` 1549 pass / 0 fail / 0 todo（无回归）。**为什么要这条记录**：单纯 `npm run test` 通过不能保证 client bundle 能 build——以后再加 client 端 import 时一定要避开任何 `import './runtime'` 路径，shared 文件是稳定入口。
- 2026-05-07：**Phase 2 Step 3b review fix (P1: 不兼容提示没阻止 send)**。Codex 抓到 Step 3b round 1 的洞：`sessionProviderRuntimeIncompatible` 只渲染 inline warning，但 MessageInput 没被禁用，`doStartStream` 在 `loaded` 状态仍然把 `resolvedProviderId/resolvedModel` (runtime-filtered fallback) 当作 request override 送给后端；Step 3a 的 lazy-seed 路径会把它们持久化到 session —— 静默改写在 wire 层重现。修复：(a) `doStartStream` 加 Guard 4，`sessionProviderRuntimeIncompatible` 时直接 console.warn + return；(b) MessageInput 的 `disabled` prop 加上同一 flag —— textarea + 发送按钮都禁用、但 `ModelSelectorDropdown` (picker) 不受 `disabled` 控制，用户依然能切换 provider；切换后 `providerWasFilteredOut` 翻转、disable 自动解开；(c) `useProviderModels.ts` 注释里"session-write callback persists a consistent pair"和"PATCH-synced back"两段过期描述清掉，改写明 hook 只暴露 runtime-filtered resolved pair 和 filtered-out signal，不持久化、由消费方显式用户动作决定 (P3 修复)；(d) 新增静态 source 测试钉住 ChatView 的两道闸（`if (sessionProviderRuntimeIncompatible) … return` 早返回 + MessageInput `disabled` prop 含该 flag）—— 任意一道被未来重构去掉、test 立刻红。`npm run test` 1549 pass / 0 fail（一次 transient SQLITE_BUSY 重跑通过）。
- 2026-05-07：**Phase 2 Step 3b UI hook + ChatView 静默 PATCH 移除完成**。剩下两条 RED todo 转正：(#4) `useProviderModels` 把 `runtime: ChatRuntimeParam | null = 'auto'` 默认值删掉，签名变成必传——hazard regex 不再命中；(#6) ChatView 删掉 `providerWasFilteredOut` 触发的 fetch + PATCH effect，改成只读取该信号并把它折成 `sessionProviderRuntimeIncompatible` flag，渲染一段 inline 警告条（i18n key `chat.sessionProviderIncompatible.message`）告诉用户"本会话保存的服务商在当前执行引擎下不可用，请在下方挑一个其它服务商"，picker 已经按 session runtime 过滤、用户挑了之后走原有 `onProviderModelChange` 路径写盘。改的文件：(a) `src/lib/chat-runtime.ts` 新增纯函数 `chatRuntimeParamForSession(runtimePin)` —— 合法 pin → 该 pin、空/未知 → `'auto'`；(b) `src/hooks/useProviderModels.ts` 删 `'auto'` 默认；(c) `src/components/chat/MessageInput.tsx` 加必传 `runtime: ChatRuntimeParam` prop 并透传给 hook；(d) `src/components/chat/ChatView.tsx` 加 `runtimePin?: string` prop、用 `chatRuntimeParamForSession` 翻译、把 silent PATCH effect 改成 incompatible flag + 警告条；(e) `src/app/chat/[id]/page.tsx` 加载 `data.session.runtime_pin` 并 thread 到 ChatView；(f) `src/app/chat/page.tsx` 新会话页给 MessageInput 传 `runtime="auto"`；(g) `src/i18n/{zh,en}.ts` 新增 `chat.sessionProviderIncompatible.message`；(h) `src/__tests__/unit/chat-runtime.test.ts` 新增 3 条 GREEN 钉住 `chatRuntimeParamForSession` 三类输入。`npm run test` **1548 pass / 0 todo / 0 fail**——Phase 2 Step 1 钉的 6 条 RED + 1 条 YELLOW (schema gap) + 1 条 YELLOW (invalid signal) 全部转为 GREEN 防线。typecheck clean。**未做**（按 Step 3b 口径）：(a) lazy migration —— 旧会话首次发送时还没把全局 agent_runtime 固化到 `runtime_pin`，得 user 显式切换 UI 才会写；这部分 + Run 面板切换入口留 Step 4；(b) `INVALID_SESSION_PROVIDER` 409 的前端 inline UI 还没接 —— Step 3a 已经返回正确 code，但前端只是抛 generic Error；专门的"会话 provider 已删除"banner 也留 Step 4。
- 2026-05-07：**Phase 2 Step 3a review fixes round 2 (P2 /compact bypass)**。前一轮把 invalid-session gate 移到了 Telegram notify / addMessage 之前，但仍然在 `/compact` 分支**之后**——`/compact` 内部的 `compressConversation({ providerId: provider_id || session.provider_id })` 会调 `resolveAuxiliaryModel`，旧会话 provider 被删时压缩仍可能静默走 env / 别的 provider，绕过 Step 3a 的"会话 provider 缺失 → 失败关闭"承诺。把 gate 整段再上移到 `setSessionRuntimeStatus(running)` 之后、`/compact` 分支**之前**——这样无论用户发普通消息还是 `/compact`，session 指向已删除 provider 的同一份 invalidReason 会立刻 409 INVALID_SESSION_PROVIDER 返回，没有压缩、没有 transcript 写入、没有任何静默绕路。`npm run test` 1543 pass / 2 todo / 0 fail（无回归）。
- 2026-05-07：**Phase 2 Step 3a review fixes**。Codex 抓到两条都是 Step 3a 自身的 setup bug：(P1) `INVALID_SESSION_PROVIDER` 409 返回前已经 `addMessage(session_id, 'user', ...)` + 文件落盘 + 标题更新，导致旧会话 provider 被删时 transcript 留了一条"未发送成功"的用户消息，用户修复后重发会形成重复上下文；(P2) lazy-seed 只写 `session.model` 没写 `session.provider_id`，当请求和 session 都没带 provider_id 时 resolver 选出来的 DB provider 没固化，下条消息又会回到全局 fallback。**修复**：(a) 把 `resolveProviderForSession` + invalidReason 闸门整体上移到 `/compact` 处理之后、Telegram notify / 文件落盘 / `addMessage` / 标题更新**之前**，失败直接释放锁 + 409 出门，不留任何副作用；(b) `persistProviderId = provider_id || session.provider_id || resolved.provider?.id || ''`，把 resolver 的 DB provider 也加进 lazy-seed 链；(c) `streamClaude` 调用的 `providerId` 也换成 `persistProviderId || effectiveProviderId || undefined`，让本次发送本身就用 resolver 选出的 provider，不只是为下条消息打底。`npm run test` 1543 pass / 2 todo / 0 fail（Step 3a 修复无回归）；typecheck clean。
- 2026-05-07：**Phase 2 Step 3a send route + streamClaude 接入 session-aware wrapper 完成**。改了三个文件：(a) `src/types/index.ts` 给 `ClaudeStreamOptions` 加 `sessionRuntimePin?: string` 字段；(b) `src/lib/claude-client.ts:streamClaude` 把最后那个 `resolveRuntime(getSetting('agent_runtime')...)` 改成"先看 sessionRuntimePin（chat-runtime label）→ 翻译成 agent_runtime 形式（claude_code → claude-code-sdk / codepilot_runtime → native）→ 没有就回退 getSetting('agent_runtime')"，console.log 同时打 session pin 和 global setting；(c) `src/app/api/chat/route.ts` 把 `resolveProviderUnified(...)` + `getActiveChatRuntime()` 替换成 `resolveProviderForSession({ provider_id, model, requestProviderId, requestModel }, { runtime: resolveRuntimeForSession(session) })`，检测 `resolved.invalidReason` → 返回 409 + `code: 'INVALID_SESSION_PROVIDER'` + `reason` + `sessionProviderId`（Step 3b 前端可消费），`effectiveModel` 链删掉 `|| getSetting('default_model')` 段，添加 lazy-seed（resolver 选了什么就 persist 到 session.model），streamClaude 调用加 `sessionRuntimePin: session.runtime_pin || undefined`。CLI-disabled env-only 兜底分支保留（不在 Step 3 范围；不同 hazard 形状）。**3 条 RED todos 转正为 pass**：#1 streamClaude no longer reads agent_runtime directly、#2 chat route uses session-aware runtime、#5 effectiveModel chain no longer falls back to global default_model。剩 2 条 RED 仍 todo（#4 useProviderModels default 'auto'、#6 ChatView silent PATCH），都属于 UI 层 Step 3b。`npm run test` **1543 pass / 2 todo / 0 fail**（前 1540 / 5；3 todo 转正、零回归）；typecheck clean。**未做**（按 Step 3a 口径）：UI 切换面板、`useProviderModels` runtime 参数化、`ChatView.providerWasFilteredOut` 静默 PATCH 改 inline 提示 —— 全部留给 Step 3b。
- 2026-05-06：**Phase 2 Step 2 schema + session-aware resolver 完成**。给 `chat_sessions` 加 `runtime_pin TEXT NOT NULL DEFAULT ''` 列（安全 ALTER + 类型同步），加 `updateSessionRuntime` 写入器；`ResolvedProvider` 加 `invalidReason?: 'provider-missing' | 'model-missing' | 'runtime-incompatible'`；新增两个 wrapper：`resolveProviderForSession(intent)`（检测 session 指向已删除 provider 时返回 `invalidReason='provider-missing'`，其它走原 resolver chain）+ `resolveRuntimeForSession(session)`（pin 合法时用 pin，否则走全局）。Step 1 的两条 YELLOW todo 转正：`assert.match(dbSrc, /runtime_pin/)` ✅，`r.invalidReason === 'provider-missing'` ✅。新增 9 条 GREEN（healthy / missing / override / runtime pin 各分支）。RED 5 条仍 todo，留给 Step 3 动 send route + streamClaude + ChatView + useProviderModels 时转正。`npm run test` 1538 pass / 5 todo / 0 fail（Step 1 是 1529 / 7）。**Codex review 抓到一个 P2 setup bug**：原 wrapper 用 `&& !requestProviderId` 做"用户主动覆盖就跳过 session 校验"的短路，但 ChatView 实际 send 每次都把 session.provider_id 放进请求体回传，Step 3 一旦把 body 直接当 override，旧会话 provider 被删后会绕过 `provider-missing`。同会话内修复：改成验证**effective destination** —— 用 `isExplicitOverride = !!requestProviderId && requestProviderId !== sessionProviderId` 判断，effectiveProviderId 取真正会送过去那个 id，对它做 `getProvider()` 查找。这样 (a) body 回传同一 ghost id ≠ 真覆盖、仍命中 invalid，(b) 用户主动选了一个不存在的 ghost 也命中 invalid（顺手把"override 也得是真的"补上）。新增 2 条 GREEN 钉住这俩场景；原 override-trusted GREEN 仍通过。同时修了 `db.ts:updateSessionRuntime` docstring 误把 read side 写成 `lib/runtime/registry.ts`，改成正确的 `lib/chat-runtime.ts`。最终 `npm run test` 1540 pass / 5 todo / 0 fail（一次 transient SQLITE_BUSY，重跑通过）。**未做**（按 Step 2 口径）：没改 UI；没把 send route / streamClaude / picker hook 切到新 wrapper；没加 lazy migration（旧会话首次发送固化 runtime_pin）；没动 ChatView 静默 PATCH 路径 —— 全部留给 Step 3。下一步先做 send route + streamClaude 切 wrapper（转正 RED #1/#2/#5），UI 切换面板和 `providerWasFilteredOut` 改 inline 提示再下一轮。
- 2026-05-06：**Phase 2 Step 1 现状审计 + 契约测试完成**。审计结论：今天的发送链路上有 **6 个**全局读点会让旧会话受全局默认影响（详见 Phase 2 Step 1 完成报告表格）。其中最严重的是 #1 `streamClaude()` 每次 send 重读 `agent_runtime`、#6 `ChatView` 在 runtime filter 不通过时静默 PATCH 替换 provider；这两个直接会让用户看到"我没动过这个会话，怎么换引擎/换 provider 了"。GREEN 部分（resolver 已经让 sessionModel 战胜全局；跨 provider 全局 pin 不会污染 session）也用测试钉住。新增 `src/__tests__/unit/session-runtime-immunity.test.ts`，初版 12 条 case 用 `assert.ok(r.lines > 0)` 反向锁定，**Codex review 抓到这是反向通过 / 伪绿色安全网**（"1537 全绿"会被误读成"会话漂移已修"），同会话内做了一次 reshape：(a) RED 部分改用 `{ todo: true }` + **target-state assertion**，今天 fail-as-todo（运行器报 `# todo N`，CI 不破），Step 2 删 hazard 后 pass，PR 摘掉 `{ todo: true }` 即转正；(b) RED grep 收紧到**精确 hazardous-pattern**（如 `providerWasFilteredOut` + `/api/chat/sessions/${sessionId}` + `method: 'PATCH'` 三件套连续匹配，而不是泛 `providerWasFilteredOut` 引用 —— 后者会让"留变量给 banner 读"误判未修）；(c) 删掉 drift point #3（registry.ts 是链根，Step 2 plan 明确保留 global-only），剩 5 条 RED；(d) YELLOW 也改用 `{ todo: true }` + target-state（resolver invalid signal、chat_sessions runtime 列）。最终 11 条 case：4 GREEN（永远 pass 的防回归）+ 7 todo（5 RED + 2 YELLOW，可见审计）。`npm run test` 1529 pass / 7 todo / 0 fail。**未做**（按 Step 1 口径）：没碰任何实现代码、没改 UI、没接 Codex adapter、没做多 Agent。Step 2 入口在 `chat_sessions` schema 加 `runtime_pin` 列 + `resolveProviderForSession / resolveRuntimeForSession` wrapper。
