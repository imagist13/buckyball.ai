# 自动会话命名

> 创建时间：2026-07-17
> 最后更新：2026-07-19
> 状态：✅ Phase 0 + Phase 1 + Phase 2 Code complete / Tests pass；same-provider P1 已关闭；Kimi for Coding always-thinking 兼容已修复并通过真实凭据 wire smoke（4.043s）；新会话 UI smoke 待用户复验。Codex 当前只支持 fallback，app-server 有 `thread/name/set` 写入原语但没有自动生成标题 API；Phase 3 待开始。
> 事实基线：[基础体验更新事实基线](../../research/foundation-experience-refresh-2026-07-17.md)

## 用户问题与取舍

用户希望聊天会话自动获得简洁、有语义的名称。当前并非完全没有自动命名，而是两条不一致的“首消息截 50 字”逻辑；标题更新也不能可靠同步到顶部和侧栏。

本计划先修标题事实源与竞态，再加模型生成。语义生成不能阻塞主回答，不能跨 provider 发送内容，不能覆盖手动/系统/导入标题。

## 状态

| Phase | 内容 | 状态 | 用户能看到什么 |
|---|---|---|---|
| Phase 0 | fallback 与 UI 同步统一 | ✅ 已完成（复审轮 #2 修复：附件 manifest 隐私、重命名后 UI 标题分叉） | 首次发送后顶部/侧栏立即出现一致标题 |
| Phase 1 | title provenance 与原子更新 | ✅ 已完成（复审轮 #2 修复：半迁移回填不可恢复） | 手动改名永远不会被后台生成覆盖 |
| Phase 2 | 同 Provider 语义生成 | ✅ Code complete / Tests pass；Kimi 真实 wire smoke passed（2026-07-19） | 首轮完成后标题自动变成简洁摘要（Claude Code / Native；Codex 保留 fallback） |
| Phase 3 | Runtime 镜像、设置与观测 | 📋 待开始 | 可控、可诊断，不影响聊天主链路 |

## Phase 0：统一确定性 fallback

### 不做什么

- 不在创建 session 时和 chat route 各保留一套截断规则。
- 不用 expanded skill prompt、附件路径或隐藏元数据做标题。
- 不改 Bridge、task、heartbeat、worktree 的显式标题；import 标题可复用统一截断纯函数（其现有截断逻辑是第三条链路），但 origin 记为 `import`，不参与语义重命名。

### 执行清单

- [x] 抽纯函数 `conversation-title`：输入用户可见文本，做 trim、单行化、Unicode/grapheme 安全截断和统一省略号；三条现有截断链路（`src/app/chat/page.tsx:864`、`src/app/api/chat/route.ts:355-359`、`src/app/api/claude-sessions/import/route.ts:50-56`）全部收编。→ `src/lib/conversation-title.ts`；省略号统一为单字符 `…`（原两处是 `...`、一处无省略号）；截断用 `Intl.Segmenter` 按 grapheme，控制字符用 `\p{Cc}` 转空格（**不**剥 `\p{Cf}`，否则 ZWJ 被删会把家庭 emoji 拆散）。**额外收编第四处**：`api/chat/route.ts:306` 的 Telegram `sessionTitle` 也是裸 slice，同源修复以免通知与侧栏不一致。
- [x] 所有普通用户新会话先以 placeholder 创建，首条真实、非 autoTrigger 消息持久化后写 fallback。→ `chat/page.tsx` 建会话不再传 title；route 侧改为 CAS on `placeholder`（比原 `title === 'New Chat'` 门更严：用户手动改回 "New Chat" 也不会被覆盖）。
- [x] 优先使用 `displayOverride || content`；剥离附件 metadata，不读取文件内容或路径。→ 两处主链路均改为 `deriveConversationTitle(displayOverride || content)`；纯函数另做纵深防御，剥 `<!--files:-->` 清单与 `\n\n[Referenced Directories]\n` / `[Mention Limits]` 段（锚定 `buildMentionAppend` 的确切形状，普通行文提到这些词不受影响）。**复审轮 #2 修复（commit `60ca8f1`）**：剥离必须在 4096 字长度截断**之前**跑——带 base64 的 manifest 闭合标记会落在 cap 之外，先截断会切掉 `-->` 让正则失配，附件路径与载荷直接成为标题；另对有 opener 无 closer 的残缺 manifest 改 fail-closed（从 `<!--files:` 起全丢）。
- [x] PATCH 重命名统一 trim、空值、长度与控制字符校验。→ `sanitizeManualTitle`；非字符串/空/纯空白/纯控制字符 → 400，超长**钳到** 50 而非拒绝（见决策日志的取舍说明）。`POST /api/chat/sessions` 显式传 title 时同样校验并记 `manual`。
- [x] 增加 `session_title` SSE/event 或完成后定向 re-fetch；顶部、侧栏、split view 同步，不依赖 5 秒轮询。→ 选**定向 re-fetch**（`src/lib/session-title-events.ts`），复用既有 `session-updated` 事件。理由见决策日志。`chat/[id]/page.tsx` 与 `SplitColumn.tsx` 此前只在挂载读一次标题，现补订阅。**复审轮 #2 修复（commit `60ca8f1`）**：手动重命名两处（`UnifiedTopBar` / `ChatListPanel`）此前各自 PATCH 后广播自己发出的原文，而 PATCH 会 canonicalize（50 grapheme 钳位 + 单行化），导致顶部/split 停在原文、侧栏 re-fetch 成服务端标题——同一会话两个标题。现两处统一走 `renameSession()`，只消费 `response.session.title` 并广播同一值；行为测试见 `session-title-canonical-sync.test.ts`。

## Phase 1：provenance 与 CAS

推荐增加 `title_origin`：`placeholder | fallback | generated | manual | system | import`，以及必要的 generation claim/attempt 字段或等价原子状态。

- [x] 手动 PATCH 与系统/导入创建原子写入 origin。→ `createSession` 增加第 9 个可选参数 `titleOrigin`；未传 title → `placeholder`，传了 title → `manual`。bridge(`channel-router.ts`)/task+heartbeat(`agent-task-runner.ts` 两处)/worktree(`git/worktrees/derive/route.ts`) 显式传 `system`，import 传 `import`。
- [x] 生成结果只允许 `fallback -> generated`；manual/system/import 不可被覆盖。→ `updateSessionTitle(id, title, origin, { expectOrigin })` 单条 SQL 完成 CAS（`WHERE id = ? AND title_origin IN (...)`），返回 `changes > 0`。
- [x] per-session single-flight；session 删除、第二个结果、过期 claim 都 no-op。→ `src/lib/title-generation-claim.ts`。三条独立 no-op 路径：并发 claim 被拒；非当前 token 无法 commit；DB CAS 兜底（manual 中途落地则生成必败、第二个结果撞到 `generated`、删除的 session 匹配 0 行）。**注意**：Phase 2 生成本体未实现，本模块目前只有测试在用——这是刻意的，先让写入路径在接入任何异步生成之前就是可证明安全的。
- [x] migration、类型、API、import/export、worktree derive 统一回归。→ `title_origin` 列 + 回填 + 幂等测试；`ChatSession.title_origin` 类型；六种 origin 的 DB round-trip 测试。

**存量回填规则（t07）**：`ALTER TABLE ... DEFAULT ''`，回填以 `WHERE title_origin = ''` 每次启动无条件跑（**复审轮 #2 修复，commit `60ca8f1`**：原先回填包在 `if (!colNames.includes('title_origin'))` 内，ADD COLUMN 与 UPDATE 是两条语句，进程若在两者间中断，下次启动看到列已存在就永久跳过回填，存量行卡在 `''` 且落在所有 CAS 规则之外。因无任何 insert 路径写 `''`，空 origin 只可能是「未分类」，故该 UPDATE 天然可重入、回填完即 no-op）：
- `title = 'New Chat'` 或 `''` → `placeholder`：从未有过真实标题，下一条真实消息补 fallback。
- 其余所有存量行 → `manual`：**存量行无法区分「用户手动改的名」与「旧的自动截断」**，两者在 DB 里都只是一段普通文本。猜 `fallback` 会让 Phase 2 悄悄重命名用户特意命名的会话，直接违反本功能唯一的硬承诺。`manual` 是安全的错法：最坏结果只是老会话保留它现在这个（用户已经看见、已经接受的）标题，永远不会拿到语义标题。若日后要救回这批，应走 Phase 3 的手动「重新生成」按钮，而不是放宽回填。

schema 变更已被接受，因此不需要 expected-title CAS 降级方案。

## Phase 2：同 Provider 语义生成

### 生成合同

- 触发：首轮 assistant 正常结束后后台执行，不阻塞首 token/完成事件。
- 输入：仅首条可见用户文本；不含附件内容/路径、system、thinking、tool result、memory 或完整历史。
- Provider：只能当前 session provider；无可用安全通道就保留 fallback。禁止使用会扫描其他 provider 的 auxiliary fallback。
- 调用：每 session 最多一次；禁 tools/MCP/history。默认 profile 为 16 output tokens / 8 秒 / 禁 reasoning；经官方能力与真实调用确认的 always-thinking endpoint 使用 provider-managed reasoning + 2048 output tokens / 30 秒后台 timeout；全局并发 1–2，用户可见标题仍硬钳到 50 grapheme。
- 输出：纯函数清洗引号、Markdown、换行、控制字符和超长文本；空/异常输出丢弃。
- 失败：静默保留 fallback，不弹 toast，不无限重试。

### Runtime 策略

- Claude Code：可复用无 session/tools/history 的轻量 SDK 调用，但必须固定同 provider。
- Native：使用同 provider text generator 的无工具路径。
- Codex Account：首版不额外开启 agent turn；先保留 fallback。未来有专用安全生成通道再启用。

### 执行清单

- [x] 触发点：首轮 assistant **正常**结束后后台执行，不阻塞首 token / 完成事件 / 下一条消息。→ 落在 `chat-collect-stream-response.ts` 的 `finally`（该函数本身已被 route fire-and-forget，不在流式 Response 链路上），三重前置：`opts.titleGeneration` 存在（= 首轮）、`!hasError`、`lastSavedAssistantMsgId !== null`。调用**不 await**、自带 `.catch`。abort / error / 被 owner gate 丢弃的 turn 均不触发（`title-generation-trigger.test.ts` 五条行为用例逐条覆盖）。
- [x] 「首轮」的判定复用 fallback CAS 的返回值而不是数消息。→ `route.ts` 把 `updateSessionTitle(..., expectOrigin: ['placeholder'])` 的返回值存成 `landed`，为真时才把 `titleGenerationInput` 交给 collect。`placeholder → fallback` 每个 session 只可能成功一次，所以「哪条消息命名了这个会话」和「哪条消息触发生成」在定义上就是同一条，不会分叉。
- [x] 输入只含首条真实可见用户文本，复用 Run 3 的输入清洗。→ `generateSessionTitle` 内 `deriveConversationTitle(input.userText)`，附件 manifest / `[Referenced Directories]` / 控制字符在进 prompt 前已剥离；route 传的是 `displayOverride || content`（与 fallback 同一个字符串）。
- [x] 同 provider：只用当前 session 的 provider/model/runtime，禁用跨 provider auxiliary resolver。→ `route.ts` 传 `effectiveSessionRuntime` + `persistProviderId || effectiveProviderId`；`title-generation.ts` 不出现 `resolveAuxiliaryModel` / `routeAuxiliaryModel` / `getAllProviders`，providerId 为空直接 `no-input`。**最终修复（commit `92f3ebc`）**：`generateSessionTitle` 不再把 `resolveExactProvider` 降格成布尔 precheck，而是捕获一次 exact `ResolvedProvider`，把同一对象交给 `generateTextViaSdk` 与 `generateTextFromProvider`；Claude 的 `prepareGenerateTextViaSdkCall` 和 Native 的 `createModel` 在收到 snapshot 时都跳过宽松 resolver。`title-generation-provider-race.test.ts` 对两条真实构造边界执行「捕获 A → 删除 A → 默认 B 存在」反例，逐条断言对象身份、endpoint 与 credential 仍属于 A，B 为零出现。
- [x] 调用约束：每 session 最多一次、禁 tools/MCP/history、全局并发 ≤2。→ 默认 `TITLE_MAX_OUTPUT_TOKENS=16` / `TITLE_TIMEOUT_MS=8000` / 禁 thinking；Kimi Code 托管 `/coding/` endpoint 因模型 always-thinking，使用精确 endpoint profile：provider-managed thinking、`2048` output tokens、`30000ms` 后台 timeout。例外只按 `api.kimi.com/coding/` 的 host + path 判定，不按用户可编辑 provider 名称猜测；同时删除 subprocess 继承的 `MAX_THINKING_TOKENS`，避免父进程残值再次编码成 `thinking: disabled`。输出仍由 `sanitizeGeneratedTitle` 硬钳到 50 grapheme；`TITLE_MAX_CONCURRENT=2`，超并发**丢弃不排队**。**复审轮 #1 修复（commit `c13002f`）**：single-flight 只挡并发，不等于「每 session 最多一次」——先到先走的第二次 sequential 调用（重复完成事件、失败后重入）仍会真实打到 provider，只被 CAS 挡住写入，那时钱已经花了、用户原文已经二次外发。新增 `markTitleGenerationAttempt`（title-generation-claim.ts）在首次 provider 调用前原子记账且永不释放；测试断言第二次 sequential 调用 `calls` 仍为 **1**、outcome 为 `already-attempted`，失败路径同样只算一次。
- [x] 输出清洗纯函数 + 空输出丢弃。→ `sanitizeGeneratedTitle`：代码围栏、Markdown 链接（连 URL 一起丢）、标题/列表/引用前缀、`Title:` / `标题：` 标签、行内强调符、中英日式引号（最多解三层嵌套）、句末标点，最后统一过 `deriveConversationTitle` 拿到与 fallback **完全相同**的 canonical 形态。多行输出取第一条有效行而不是拼接。
- [x] 失败静默：超时/离线/限流/空输出/异常一律保留 fallback，不弹 toast、不重试、不留悬挂 claim。→ `generateSessionTitle` 永不 throw，只返回 outcome；每条失败路径都 `releaseTitleGeneration`，测试直接反证 claim 被释放（失败后 `claimTitleGeneration` 仍能取到锁）——**不再**用「失败后重试仍能成功」来反证，因为加了 attempt 记账后重试本就不该发生，那个断言会同时证伪 g04。
- [x] 写回走 Phase 1 的 CAS，不新造路径。→ 唯一写入口仍是 `commitGeneratedTitle`（本模块零 SQL）。`manual/system/import/generated/placeholder` 全部拒绝；生成中手动改名 / 删除 session 的并发用例已覆盖。
- [x] Runtime 三路径：Claude Code 轻量 SDK 调用、Native 无工具 text generator、**Codex 首版不生成**。→ Codex 诚实降级；Claude `tools: []` / `settingSources: []` / `mcpServers: {}` / thinking off；Native 16-token 限制；两条生成 wire 均消费编排层捕获的 exact provider snapshot，不再二次宽松解析。
- [x] telemetry 只记 outcome / runtime / latency，不记 prompt、用户原文或标题。→ Phase 3 的约束提前应用（文本就在这个模块里，此处不落地等于没落地）；测试劫持 `console.log` 反证敏感串不出现。
- [x] i18n：**本轮无新增用户可见文案**。生成失败静默、成功只是标题变化，UI 复用既有 `session-title-events` 同步链路，故 `en.ts` / `zh.ts` 无需改动。

## Phase 3：镜像、设置与观测

- [x] 本地 DB title 始终 canonical；首轮成功与手动改名后，已有 Codex thread best-effort `thread/name/set`，失败不回滚、不阻塞消息或改名。
- [x] 不把 Codex 的 `thread/name/set` 描述成“内置自动命名”：它只接受调用方给出的 `name`，当前 schema 没有 generate-title/auto-name 方法。Codex 首版继续使用本地 fallback，再镜像同一个标题。
- [ ] 评估“自动生成标题”设置与手动“重新生成”；默认值由用户决定后再实现。
- [ ] telemetry 只记 outcome、provider/model、source、latency，不记 prompt/title 原文。
- [ ] 观察生成延迟、失败率、手动覆盖率和 provider 限流影响，再决定是否支持重试或更多 Runtime。

## 验证矩阵

- [x] 纯函数：中英/CJK/emoji grapheme、Markdown、多行、空白、超长、控制字符、引号、prompt injection 文本。→ `src/__tests__/unit/conversation-title.test.ts`。
- [x] 路由：仅首条真实用户消息触发；autoTrigger/heartbeat/task/import/bridge/worktree 不触发；`displayOverride` 优先。→ `session-title-wiring.test.ts`（源码钉）+ `session-title-provenance.test.ts`（origin 行为）。
- [x] 隐私：附件 metadata/路径、hidden expansion 不进入标题输入。→ `conversation-title.test.ts` 隐私分组。（system/thinking/tool result 与 provider 选择属 Phase 2 生成输入，本轮不适用。）
- [x] DB race：manual rename in-flight 必胜；两个结果只写一个；timeout/删除 session 保留 fallback/no-op。→ `session-title-provenance.test.ts`。
- [ ] UI/E2E：首发后顶部与侧栏立即 fallback，随后 generated 更新；刷新后一致；生成中改名不被覆盖。→ **部分**：已做源码钉（订阅存在、accept 后 re-fetch、autoTrigger 跳过），**未跑真实 dev server / E2E 走查**；generated 部分依赖 Phase 2。
- [x] 成本/并发：每 session <= 1 次；全局有界；主回答不等待命名。→ `title-generation.test.ts` 的 g04 分组：per-session 一次（**第二次 sequential 调用 `calls` 仍为 1**，被 attempt 记账挡在 provider 之外，而不是打过去再被 CAS 挡写）、并发 single-flight（一个 session 只发一次调用）、全局 `TITLE_MAX_CONCURRENT` 溢出即丢、8s timeout abort。「主回答不等待」由 `title-generation-trigger.test.ts` 的结构钉（调用点无 `await`、带 `.catch`）+ 行为用例（assistant 消息在生成可达之前就已落库）共同保证。
- [x] 生成隐私反例：附件路径/base64、hidden expansion、system prompt、thinking、tool result、memory 均不入 prompt。→ `title-generation.test.ts` 的 g02/g09 分组（行为断言 prompt 精确等于清洗后的用户文本 + 结构钉禁止 `getMessages`/`contentBlocks`/`thinkingText`/`toolResult`/`loadMemor`/`systemPrompt` 出现在模块里）。
- [x] 完整单测门禁（Phase 2 复审轮 #2）：`permission-profile-chain.test.ts` 中 4 个真实 waiter 改为 `try/finally` finalize，并在 `clearTimeout` 后让出一轮事件循环，消除测试自身遗留的 300s registry timer（commit `c892f48`）。`npx tsc --noEmit` exit 0；权限 targeted **36/36 pass**；仓库既定的可复现完整门禁（干净 HOME + `CODEX_DISABLED=1` + `--test-concurrency=1 --test-force-exit`）**4355 tests / 1068 suites / 4355 pass / 0 fail / 82183.193875ms，exit 0**。原始 `npm run test` 的无 force-exit worker 悬挂属于仓库已记录的 node:test 退出问题，不再把 targeted 绿冒充完整 footer。
- [x] same-provider P1 回归门禁（commit `92f3ebc`）：`npx tsc --noEmit` exit 0；标题/provider targeted **59/59 pass**；干净 HOME + `CODEX_DISABLED=1` + 串行 force-exit 完整 footer **4357 tests / 1069 suites / 4357 pass / 0 fail / 0 cancelled / 73568.401708ms，exit 0**。`npm run build` 在沙箱内外各跑一次，均只因无法连接 `fonts.googleapis.com` 下载 Geist / Geist Mono 失败；未出现本次 TypeScript 或模块构建错误，因此构建状态记为外部网络阻塞，不记 Tests pass 之外的 Build passed / Smoke passed。
- [x] Kimi always-thinking 回归门禁（2026-07-19）：定向标题/隔离/触发/provider-race **68/68 pass**；真实 `Kimi for Coding` exact-provider wire 以 synthetic prompt 在 **4043ms** 生成可用标题，profile 为 `provider-managed / 2048 / 30000ms`；不输出凭据。Tier 2 串行 force-exit 全量 footer：**4388 tests / 1080 suites / 4388 pass / 0 fail / 0 cancelled / 67868.87125ms，exit 0**。全量首轮曾暴露 trigger 测试用固定 20 个 zero-delay tick 等 detached dynamic import 的隔离缺陷，修为 1s 有界条件等待后重跑全绿；这是测试时序修复，不是产品触发条件变更。
- [x] `npm run test`（Phase 0/1 轮）；涉及 schema 时按 Tier 2 补 migration/rollback/导入导出测试。→ 当时 **4019 pass / 0 fail**（复审轮 #2 修复后，commit `60ca8f1`；4002 仅为上一轮基线，见决策日志）；migration 幂等 + 回填 + origin round-trip 已覆盖。

## 验收标准

- 首条消息后不再长期显示 `New Chat`，所有入口使用同一 fallback 规则。
- 语义标题失败不影响消息发送、流式输出和 session 创建。
- 手动、系统、导入标题永不被异步生成覆盖。
- 不发生跨 provider 内容发送，且标题 prompt 不包含隐藏/敏感上下文。
- 标题更新即时同步到所有可见入口。

## Smoke Ledger

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|---|---|---|---|---|---|---|---|
| _待跑_ | claude_code | same-session provider | small/current | key/login | 新会话 UI：first turn → fallback → generated | 📋 | wire 已通过，仍需 UI 新会话复验即时同步 |
| _待跑_ | codepilot_runtime | same-session provider | small/current | key | timeout/failure → fallback | 📋 | |
| _待跑_ | any | any | any | any | generation in-flight → manual rename | 📋 | |
| _待跑_ | codex_runtime | codex_account | - | login | first turn → 只有 fallback，无生成、无报错 | 📋 | 诚实降级的反例走查 |
| 2026-07-19 | codex schema probe | codex_account | - | 本机 0.145.0-alpha.18 | 核对是否有内置自动生成标题 API | ✅ 边界确认；非产品 smoke | 有 `thread/name/set` / `thread/name/updated`，无 generate-title/auto-name method；CodePilot 首版 fallback 决策仍成立 |
| 2026-07-19 | codex_runtime | isolated unit | - | 注入式 RPC seam | 本地 canonical title → `thread/name/set`；无 thread/拒绝时降级 | ✅ 3/3 | 不启动/修改真实用户 Codex history；真实登录 thread smoke 待跑 |
| 2026-07-19 | claude_code | GLM | claude-sonnet-5 | 现有 key | 用户首轮自动命名对照组 | ✅ generated | session `14d51d6cf7ae9ad27083bb50ef74d683`：`你好` → `问候`，证明触发链路总体有效 |
| 2026-07-19 | claude_code | Kimi for Coding | kimi-for-coding | 现有 key | 用户首轮自动命名（修复前） | ❌ fallback only | session `466fb2098cc127c657bb629f654d9253`；普通回复约 10s，但 16-token / 8s 标题调用无最终文本 |
| 2026-07-19 | claude_code | Kimi for Coding | kimi-for-coding | 现有 key | exact-provider isolated title wire（synthetic prompt） | ✅ 4043ms | `provider-managed / 2048 / 30000ms`，生成“合同盖章不清晰的处理方法”；密钥未输出 |

## 决策日志

- 2026-07-19（Kimi 自动命名修复）：用户截图中的会话并非“没有触发自动命名”，而是触发后静默失败。Kimi Code 官方模型能力为 Thinking ON；原实现同时强制 `MAX_THINKING_TOKENS=0`、把 thinking + final 共用输出压到 16 tokens，并用 8s 截断，而同会话正常回答本身约 10s。修复没有按品牌名给所有 Kimi/Moonshot provider 放宽，而只给官方托管 `/coding/` endpoint 分配 provider-managed profile，并主动移除父进程继承的 thinking override。定向 68/68 与真实 4.043s wire smoke 通过。既有失败 session 因“每 session 最多尝试一次”合同不会自动重试；用户需新建会话复验。
- 2026-07-19（Codex 能力边界）：app-server 提供 thread name 的写入与更新通知，不提供轻量自动生成标题 API。Codex Desktop 的自动命名不能直接当作 app-server 合同；CodePilot 可 best-effort 镜像本地标题，但不为“复用 Codex 内置生成”作虚假承诺。
- 2026-07-17：调研确认当前已有两套 50 字截断逻辑；Phase 0 先统一事实源和 UI 同步，语义生成后置。
- 2026-07-17：本地 DB title 定为 canonical；Codex thread name 仅 best-effort 镜像。
- 2026-07-17：禁止复用跨 provider auxiliary fallback；隐私和手动改名优先于标题生成成功率。
- 2026-07-17（审查裁决）：确认截断链路实为三条（含 claude-sessions import），统一纯函数一并收编；import 标题 origin 记 `import`、不参与语义重命名。现状标题基于 `content` 而非 `displayOverride`，列为隐私修复点。
- 2026-07-17（Phase 0 + Phase 1 实施完成，commit `eaa7766`）：验证 `npx tsc --noEmit` 通过 + 全量单测 **4002 pass / 0 fail**（上轮基线 3932，新增 70 条：`conversation-title.test.ts` / `session-title-provenance.test.ts` / `session-title-wiring.test.ts`）。以下为本轮做出的取舍与被推翻的假设，供复审：
  - **截断链路是四条不是三条**。计划锚定的三处之外，`api/chat/route.ts:306` 的 Telegram 通知 `sessionTitle` 也是裸 `content.slice(0, 50)`。一并收编——否则通知里的标题和侧栏的标题会不一样，且它同样吃 `content` 全文（同一个隐私瑕疵）。
  - **fallback 的门从 `title === 'New Chat'` 换成 CAS on `placeholder`**。原门有个洞：用户手动把标题改回 "New Chat" 后，下一条消息会把它当成未命名会话再次覆盖。origin 让「是否被命名过」成为事实而不是靠标题字符串反推。
  - **UI 同步选定向 re-fetch，不加 SSE 帧**。理由：fallback 是在 route handler 里 `addMessage` 之后、streaming Response 返回**之前**同步写入的，所以 `fetch('/api/chat')` 一 resolve 该行就已是终态，单次 GET 无竞态。而 SSE 帧文法有两个解析器（`stream-session-manager.ts` 和 `chat/page.tsx` 各一份内联 parser），加帧要改两处，属 StreamSession guardrail 高风险区，收益为零。
  - **超长手动改名钳到 50 而不是 400 拒绝**。"长度上限"可以理解成拒绝，但当前 `UnifiedTopBar.handleRename` 对失败是静默吞掉的，拒绝 = 用户点了没反应。钳位让所有入口共用同一条规则（验收标准第一条）。若 Codex 认为必须硬拒，则同时要补 rename 对话框的错误反馈，否则是回归。
  - **`title-generation-claim.ts` 目前无产品调用方**，只有测试在用。这是 t06 要求的 single-flight，刻意先于 Phase 2 落地：写入路径要在任何异步生成接进来之前就被证明安全。若复审认为「无调用方 = 死代码」，替代方案是并入 Phase 2 一起交付。
  - **存量回填选 `manual` 而非 `fallback`**（详见 Phase 1 章节）。这是本轮最保守的一个决定，代价明确：存量会话永远拿不到语义标题。
  - **未跑真实 smoke**：本轮只有 typecheck + 单测 + 源码钉，没有起 dev server 做首发→标题即时同步的人工走查。Phase 2 接入生成前应补一次（Smoke Ledger 仍为空）。
- 2026-07-17（复审轮 #2 fix，commit `60ca8f1`）：Codex 提的 3 条 finding（2×P1 + 1×P2）全部接受并修复，无反驳。验证 `npm run test` 通过（= `tsc --noEmit` + 全量单测），**4019 pass / 0 fail**（上轮 4002，新增 17 条）。三条修复及其结论：
  - **P1 隐私（接受）**：`deriveConversationTitle` 的 `slice(0, 4096)` 排在剥离 manifest 之前，超长/带 base64 的 manifest 被切掉闭合标记后整段成为标题。改为「先剥离、再截断」，并对残缺 manifest fail-closed。**这里推翻了上一轮的一个隐含假设**：把 cap 当成「与内容无关的性能护栏」，实际上它改变了后续正则的语义——任何「先截断再解析」的顺序都是把解析器喂给一个被人为破坏的输入。反例测试补了敏感路径 + base64 载荷 + 多 manifest。
  - **P1 migration（接受）**：回填移出 ADD COLUMN 的 guard，改为每次启动可重入。补「列已存在但回填未完成」的恢复测试，同时断言已分类行（如 `fallback`）不被重新 stamp。
  - **P2 UI 分叉（接受）**：修法上做了一个超出 finding 的选择——不是在两处各自改成读 `response.session.title`，而是把整个重命名往返抽成 `renameSession()` 放进 `session-title-events.ts`，两处调用点各自的 PATCH 一并删除。理由：这条 bug 的成因就是「同一个往返被复制了两份，各自决定广播什么」，只改数据来源不改结构，第三个调用点出现时会再犯一次。副作用是测试可以真实驱动该路径（`session-title-canonical-sync.test.ts` 以假 window + 假路由驱动 `renameSession`，顶部/侧栏/split 三个订阅者按组件的真实订阅方式挂载），把 t04 从源码正则钉升级成行为测试；`session-title-wiring.test.ts` 里只保留「两处不得绕过 `renameSession` 自己 PATCH」的结构钉。
  - **literal NUL（接受）**：`sessions/[id]/route.ts` 注释里的裸 NUL 字符已移除（改为文字描述），该文件不再被 Git 当作 binary。
  - **计划状态失真（接受）**：上一轮在有未修 finding 的情况下把 Phase 0/1 标为「已完成」。本轮状态表明确标注「复审轮 #2 修复」，未跑真实 smoke 的缺口继续如实保留在上一条。
- 2026-07-18（Phase 2 实施完成，commit `33a5dfc`）：新增 `src/lib/title-generation.ts`（编排 + 纯函数清洗）、`title-generation.test.ts`（40 条）、`title-generation-trigger.test.ts`（9 条），改动 `chat-collect-stream-response.ts`（触发点）、`route.ts`（首轮判定与上下文移交）、`claude-client.ts`（`generateTextViaSdk` 四个可选隔离参数）。以下为本轮取舍与被推翻的假设，供复审：
  - **「首轮」不数消息，直接复用 fallback CAS 的返回值**。原本可以在 collect 里查 `getMessages(sessionId)` 判断是不是第一轮，但那样「命名会话的那条消息」和「触发生成的那条消息」是两次独立推断，边界（首轮并发发送、autoTrigger 夹在中间、导入后补发）随时会分叉。`placeholder → fallback` 的 CAS 每个 session 只可能成功一次，把它的 boolean 直接当作触发信号，两者在定义上就是同一条消息。副作用是 collect 拿不到「历史长度」这类信息——这正是想要的，见下一条。
  - **触发上下文由 route 推给 collect，collect 不自己查 session**。collect 里一行 `getSession()` 就能拿到 provider/runtime，但那读的是**当前** DB 状态，而生成必须用**回答这条消息时**用的 provider（中途切 provider 的会话会错配）。推送式移交让「谁回答的谁命名」成为结构事实；`title-generation.ts` 的隐私结构钉顺带禁掉了 `getSession`，防止以后有人figure「顺手查一下」。
  - **超并发丢弃而不是排队**。排队看起来更「不浪费」，但一个排到 30 秒后才落地的标题，用户早已读过 fallback 并继续对话了——此时改名是打扰而不是帮助。丢弃让最坏延迟等于一次调用的延迟。
  - **`generateTextViaSdk` 的隔离参数做成可选而非默认**。默认开 `allowedTools: []` 语义更干净，但该函数还有别的调用方（工具描述生成等），把它们的工具面一起关掉属于顺手改别人语义。四个参数全部 opt-in，老调用方 diff 上是零行为变化。若 Codex 认为「辅助调用本就不该有工具」，可以另开一轮把默认收紧，但那应该是一次显式的、带回归验证的改动。
  - **Claude Code 路径的「无上下文」靠的是 `systemPrompt` 传字符串**：SDK 在 `systemPrompt` 为 string 时**替换**而不是追加 preset，因此 CLAUDE.md / skills / memory 都不会进入该 subprocess。这条是 SDK 语义假设，已写进 `claude-client.ts` 注释——**如果哪天 SDK 改成 append，这里会静默变成上下文泄漏**，是本轮最需要复审确认的一点，也是最该配真实 smoke 的一点。
  - **Codex 首版不生成，写死在 `isTitleGenerationSupported`**。不是 TODO、不是 try/catch 兜底，是一个有测试断言「一次调用都不发生」的显式 false。理由：Codex 没有轻量单发通道，命名一次聊天要开一个带工具和 workspace 权限的真实 agent turn——为了一行标题付这个代价，且违反「不阻塞、不越权」。诚实的空白优于假装支持。
  - **未跑真实凭据 smoke**：本轮只有 typecheck + 单测。三条 provider 首轮生成的 smoke（含 Codex 降级反例）仍在 Smoke Ledger 待跑，移交用户，因为它们需要真实 key/登录态。
  - **全量单测在 headless 环境下未能跑完**：canonical 的 `CODEX_DISABLED=1 ...` 因 env-prefix 限制被允许清单拒绝；改用 `npx tsx --test`（无 env 前缀）直跑全量 glob 时，进程在跑到约 679 个 suite（0 失败）后被环境终止，未产出 TAP footer。故本轮**不回填全量计数**，请 operator 代跑一次 `npm run test` 并回填。已跑完并绿的是：`npx tsc --noEmit` exit 0；标题功能相关七个套件合跑 **141 pass / 0 fail**（`conversation-title` + `session-title-provenance` + `session-title-wiring` + `session-title-canonical-sync` + `collect-owner-gate` + 本轮两个新套件），覆盖 Phase 0/1 回归 + Phase 2 新增。全量 glob 停在 `permission-registry` 的 300s 超时用例（本轮改动无关，此前 679 个 suite 全绿、0 失败），未走到 `title-*` 文件。


- 2026-07-18（Phase 2 复审轮 #1 修复，commit `c13002f`）：Codex 提了 4 条（2×P1 + 2×P2），全部接受，无一条反驳。共同的教训是**「调用点写了意图」不等于「wire 上真的做到了」**——三条 P1/P2 都是在调用点看起来对、在真实边界上是假的：
  - **P1 provider 边界（接受）**：透传 `providerId` 只解决了「我们想调谁」，没解决「解析器会调谁」。`generateTextViaSdk` 和 `createModel` 都会再进 `resolveProvider`，而它在 provider 被删除时按 default → active 回退（provider-resolver.ts:227-258）。修法是新增 fail-closed 的 `resolveExactProvider`：解析结果的身份不等于请求 id 就返回 `null`，虚拟 provider（`env` / `openai-oauth` / `codex_account`）按各自 marker 匹配。`generateSessionTitle` 在任何调用前先过闸，失败即 `provider-unavailable`。反例测试 `provider-resolver-exact.test.ts` 特意**先断言宽松 resolver 确实交出另一家 provider**，再断言 exact 返回 null——把两者的差异本身钉住，而不只是钉住新函数的好行为。另加保险：`is_active=0` 的 provider 仍解析为自己（它是 UI 单选标记不是删除），避免过度收紧把非当前选中 provider 的生成全部误杀。
  - **P1 Claude Code 隔离（接受，且原实现确实是假隔离）**：`allowedTools: []` 是权限白名单不是可用性过滤，SDK 0.2.111 只有 `tools: []` 会真正关掉内置工具；`mcpServers: {}` 也拦不住 `settingSources: ['user']` 把用户的 MCP / plugins / skills / hooks / CLAUDE.md 加载进来。改为单一 `isolate: true`，在 wire 上同时给出 `tools: []` + `settingSources: []` + `mcpServers: {}` + 字符串 `systemPrompt` + `MAX_THINKING_TOKENS=0` + `maxTurns: 1`，并**撤掉** `bypassPermissions` / `allowDangerouslySkipPermissions`（零工具时它不是便利，是一句不真实的声明）。为了让这些能被验证而不是被相信，把 Options 组装抽成导出的 `buildGenerateTextQueryOptions`，测试断言的是**产出的 Options 本体**；同时逐字段断言不传 `isolate` 的老三个调用方（dashboard / cli-tools / context-compressor）行为不变。**12–20 token 硬上限在 claude_code 上做不到**：SDK 无每请求 `max_tokens`，只能靠 `CLAUDE_CODE_MAX_OUTPUT_TOKENS` 尽力而为，硬边界仍是 `sanitizeGeneratedTitle` 的 50 grapheme 钳位。选择**如实降级并写明**，不冒充 wire 级 token 上限（Native 路径的 `maxOutputTokens: 16` 是真的）。
  - **P2 每 session 一次（接受，原用例是自证其罪的）**：旧用例断言 `calls === 2` 还自称「at most once」——它精确地记录了 bug。single-flight 只挡并发；重复完成事件或失败后重入是 sequential 的，会真的打到 provider，只被 CAS 挡住写入，而那时钱已经花了、用户原文已经二次外发。新增 `markTitleGenerationAttempt` 在首次 provider 调用前原子记账且**永不释放**，第二次 sequential 调用 `calls` 仍为 1、outcome `already-attempted`。记账点选在 provider 校验**之后**：一次从没调用过任何人的拒绝，不应该消耗这个 session 唯一的机会。顺带修了同一次重构引入的并发 bug——并发槽必须和 claim 一起在首个 `await` 之前同步占用，否则同一 tick 起跑的两个生成都读到 `activeGenerations === 0`、结伴越过上限；计数器另加 `Math.max(0, …)` 钳位，因为一个变负的 in-flight 计数会**悄悄放宽**上限，这是并发限制唯一不能有的失效方式。
  - **P2 全量门禁（接受，但本轮仍未能给出 exit 0）**：`npm run test` 在本机连续跑 **62 分钟仍未结束、无 TAP footer**（最终由本轮主动终止），与 Codex 复审时观察到的现象一致（`permission-registry` 的 300s 超时用例，`perm-Bash` / `perm-codepilot_generate_image`）。该文件与本轮改动无关。**故 g10 本轮如实记为未达成**，不编造 footer，请 operator 在可跑完的环境代跑 `npm run test` 并按「并行观测 vs `--test-concurrency=1` 完整注册量」双语义回填。本轮跑完并绿的是：`npx tsc --noEmit` exit 0；`title-generation` + `title-generation-trigger` + `provider-resolver-exact` + `generate-text-isolation` 四套件合跑 **66 tests / 66 pass / 0 fail**（连跑 3 次稳定，duration ≈ 8.3s）。
- 2026-07-18（Phase 2 复审轮 #2 + 恢复收口，测试 commit `c892f48`）：复审结论仍为修复中，不再沿用顶部“Phase 2 已完成”的失真状态。
  - **P1 / same-provider TOCTOU（未修）**：`resolveExactProvider` 只保护 precheck，不保护真实 wire；两条 runtime 都会随后二次宽松解析。裁决不变：必须传同一个 exact `ResolvedProvider` 到 `generateTextViaSdk` 与 Native model factory，不能以第二次检查代替不可变身份边界。由于本轮外部模型与代码托管域名均无法完成 DNS 解析，实施代理不能启动；Codex 按角色边界不修改产品 Runtime 文件，因此本条明确保留为 blocker，不用文档或测试绿假装关闭。
  - **P2 / full gate（已修）**：三条 300s 日志精确对应 profile-switch 套件故意保持 pending 的三类断言；连同正常自动批准路径，所有 armed waiter 现统一在 `finally` 中走真实 registry finalize，并等待 timer destroy。`npx tsc --noEmit` exit 0；权限 targeted **36/36 pass**；串行可复现完整 footer **4355 tests / 1068 suites / 4355 pass / 0 fail / 82183.193875ms，exit 0**。真实凭据/UI smoke 仍留 Smoke Ledger，不把单测状态表述成 Smoke passed。
- 2026-07-18（same-provider P1 直接修复，commit `92f3ebc`）：用户在 Claude 通道不可用时临时授权 Codex 仅处理该 blocker，完成后权限例外已删除。根因不是 exact resolver 本身，而是它的返回值被丢弃成 boolean，真实 wire 只收到裸 `providerId` 并重新进入宽松 resolver。修复把 exact resolution 变成一次性 provider-owned snapshot，并为 Claude / Native 工厂增加可选 pre-resolved 入口；旧调用方不传 snapshot 时保持原解析行为。删除竞态反例在两条真实构造边界上均证明只出现 A endpoint / credential、从不出现默认 B。typecheck、59 条 targeted、4357 条完整单测均通过；真实凭据/UI smoke 仍待跑，生产 build 受 Google Fonts DNS 阻塞，未把它们写成已通过。
