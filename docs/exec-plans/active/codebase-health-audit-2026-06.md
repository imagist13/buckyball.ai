# 代码健康审计与修复计划（2026-06）

> 创建时间：2026-06-11（2026-06-11 Codex 静态审查后修订 v2，7 处事实偏差与执行边界已订正，见决策日志）
> 状态：🔄 Phase A 全部完成（A1–A6 ✅，2026-06-19）；Phase B/C/D 待实施。全部 Phase 完成后再移至 `completed/`。
> 角色边界（per AGENTS.md）：**产品代码 / 运行时代码 / Electron / 样式 / 构建脚本的改动只能由 Claude Code 实施**；Codex 承担审查、用例设计、复现分析、计划与文档，不实施上述代码改动。测试文件不在 AGENTS.md 禁改清单内，Phase C 的纯测试新增可由任一方产出，但 C5 涉及产品代码的 fixture 修复归 Claude Code。
> 来源：6 路并行代码审计（流式核心 / Codex Runtime / DB+API / 前端 / Electron+构建链 / 测试覆盖），关键发现已由主审在源码中逐条核验（见各条目「核验状态」）
> 范围：bug、性能、安全加固、技术债务、测试缺口。**不含**新功能（规划中的功能见 memory / `docs/insights/`）

---

## 用户能看到什么（一句话验收）

- **Phase A（bug/性能）**：长对话流式输出不再随消息数增长而卡顿；权限请求超时后聊天里有明确提示而不是凭空消失；错误提示不再夹带整段代码堆栈。
- **Phase B（Electron 安全加固）**：用户无感（价值形态 C 基础设施）——收紧渲染进程被攻破后的二次伤害面，发版前完成。
- **Phase C（测试补洞）**：用户无感（价值形态 C）——把"改坏了没人知道"的高风险链路（流生命周期、文件写删、interrupt 行为）置于回归保护下，权限规则引擎在已有覆盖上补强。
- **Phase D（低优债务）**：会话数 500+ 时设置页和会话列表依然秒开（价值形态 B，可量化：列表接口 P95 < 200ms）。

**不做什么**：不引入新 UI；不动 DB schema（除非任务明确说明且遵守"迁移不删数据"）；不在本计划内做 API key 加密落盘（tracker #40，需单独立项）、文件搜索索引（#10）、Runtime Capability Adapter（#41）——这三项是审计确认应提级的**构建项**，但工程量大，在「附录 2」给出立项建议，不混进修复批次。

---

## 执行守则（领任务的代理必读）

1. **先核验再动手**：每条任务标注了「核验状态」。标 ⚠️ 待核验 的条目来自子代理审计，动手前先打开 file:line 确认问题仍然存在、理解上下文；确认不成立则在本文档该条目标注「误报 + 理由」后跳过，不要硬修。
2. **验证分层**遵守 CLAUDE.md「验证分层」：每条任务标了 Tier。Tier 2 任务改动前先读 `docs/guardrails/` 对应契约。
3. **提交粒度**：同一 Phase 内的同类小修（如 Phase A1 的 5 处 error.stack）合并为一个 commit；跨 Phase 不混提交。每个 commit 遵守 conventional commits，body 写根因。
4. **完成登记**：任务完成后把该条目状态从 `[ ]` 改 `[x]` 并附 commit hash；整个 Phase 完成后更新文末 Smoke Ledger。全部完成后本文件移至 `completed/` 并更新 `docs/exec-plans/README.md` 索引。
5. **不要重复登记**：本计划已与 `tech-debt-tracker.md`（#1–#41）和 `issue-tracker.md` 去重。执行中发现的**新**问题按 Signal → Triage → Fix → Verify → Guardrail 处理，新债记 tracker。
6. **语义验收**：任何触及用户可见数字/状态的改动（如 A5 的超时提示）过 CLAUDE.md「语义验收与反假数据」一节。

---

## Phase A — Bug 与流式性能（优先做）

**用户能看到什么**：50+ 消息的会话在流式输出时不再一字一卡；权限弹窗超时后有可见的"已自动拒绝"提示；API 错误 toast 只显示人话不显示堆栈。
**怎么验收**：开一个 80+ 消息的会话发起流式回复，React DevTools Profiler 中 MessageList 单帧渲染耗时下降且无整列表 O(n²) 重算；权限请求放到超时，聊天流里出现超时状态；任一 API 故意 throw，响应体无文件路径/堆栈。

### 实现路径（技术细节，用户无需审阅）

- [x] **A1 [P2 bug] 5 个 API 路由把 `error.stack` 返回给前端** — ✅ 已核验 · **完成 2026-06-11**（`src/lib/api-error.ts` helper + 5 处改造；`api-error.test.ts` 断言 body 恰为 message、无 stack/换行）
  - 位置：`src/app/api/chat/sessions/route.ts:31,71`、`src/app/api/claude-sessions/route.ts:8`、`src/app/api/claude-sessions/import/route.ts:88`、`src/app/api/search/route.ts:185`，模式均为 `error.stack || error.message`。
  - 修法：新建 `src/lib/api-error.ts` 导出统一 helper（响应只含 `error.message`，stack 走 `console.error` 落服务端日志）；5 处改用 helper。顺手把 helper 设计成全项目错误响应统一出口（见 D5），但本任务只改这 5 处，不做全量迁移。
  - 验证：grep `error.stack ||` 在 `src/app/api` 归零；单测断言 helper 对 Error/非 Error 输入的输出形状。Tier 1。

- [x] **A2 [P2 perf] 聊天热路径 O(n²) 渲染重算** — ✅ 已核验 · **完成 2026-06-11**（MessageList `userMessages` useMemo；StreamingMessage `toolResultsById` Map 索引；顺手 on-touch 修掉 StreamingMessage `ElapsedTimer` 的 #35 set-state-in-effect，用 `key={startedAt}` remount 替代 reset effect — 见 #35 更新）
  - 位置 1：`src/components/chat/MessageList.tsx:362-363`——`messages.map` 回调内对每条 user 消息重新 `messages.filter(m => m.role === 'user')`，流式期间每帧整列表重算。修法：列表外 `useMemo` 一次性算出 `userMessages` 数组 +（可选）`Map<messageId, userIndex>`。**注意**：这段代码是 rewind 位置映射（tracker #39 的脆弱契约所在），重构时不要改变映射语义，只消除重复计算；可顺手加 #39 要求的不变量断言（`可见 user 消息数 === rewindPoints.length` 不满足时 console.warn），但 UUID 显式匹配仍归 #39 单独做。
  - 位置 2：`src/components/chat/StreamingMessage.tsx:299-301`（`runningTools` 的 filter×some）与 `:327-328`（`toolUses.map` 内 `toolResults.find`）。修法：`useMemo` 建 `toolResultsById` 索引，两处共用。
  - 验证：Tier 0/1——改后 `npm run test`；CDP/浏览器开 80+ 消息会话流式回复，Profiler 确认 MessageList/StreamingMessage 渲染耗时下降、行为无变化（工具运行态徽章、rewind 入口位置不变）。注意 #35 已知这些文件有 React Compiler bailout，本任务不负责清 bailout，只要不加重即可。

- [x] **A3 [P3 bug] `agent-loop.ts` 错误路径丢失 context accounting** — ✅ 已核验 · **完成 2026-06-11**（纯函数 `agent-loop-error-event.ts` + 单测反例；成功/错误路径共用 `buildNativeAccountingSnapshot` helper；Codex P2：错误路径 `records.length>0` 才 collect，空 turn 不付 CLAUDE.md fs 读）
  - 位置：`src/lib/agent-loop.ts:146`（accumulator 创建）、`:659`（仅成功路径 `drain()`）；catch 块不 drain，错误结束的 turn 缺 `context_accounting` 快照。
  - 修法：catch/finally 中也 drain 并随 error 事件带出（或显式丢弃并注释原因——二选一，推荐带出，与 Phase 7 Context Accounting 语义一致：错误 turn 的工具调用也真实消耗了上下文）。
  - 验证：单测注入工具调用后抛错，断言 error 事件含 accounting 快照。Tier 1。

- [x] **A4 [P3 bug] Codex runtime `activeCodexTurns` 异常路径残留** — ✅ 已核验残留属实 · **完成 2026-06-19**（`activeCodexTurns.delete` 原仅在终态分支 `:879`；`closeStream()`——catch 错误路径 `:941`、abort 路径——**不清理** → turn 登记后、终态前抛异常会残留 stale turnId。修法：`delete` 移入 `closeStream()` 顶部（在 `active` guard 之前，覆盖 consumer-abort 后迟到终态事件触发的冗余 close），移除 `:879` inline delete → 三条 close 路径**单一清理出口**，正是 codex-stop-recovery Phase 2 注释（`runtime.ts:240`）要求的"明确 close 路径清理"）
  - **核验记录**：① `fsWatchEntries` 不泄漏结论维持。② `activeCodexTurns` 残留**属实**，按上修复。③ 与 `codex-stop-recovery.md` settle 无冲突——lock settle 在 chat/route 层、stream entry 清理在 runtime 层，两层独立。
  - **验证**：`activeCodexTurns` 是模块私有 Map 且 `stream()` 需 live app-server（`CODEX_DISABLED=1` 下无法行为驱动），沿用 `codex-interrupt-contract.test.ts` 既有 source-pin 模式并精确化：pin① closeStream 在 guard 前 delete；pin② 终态分支**无** inline delete（改走 closeStream）；pin③ catch 路径走 `closeStream({error})`。三 pin 合证"任何 close 路径无残留"（含 A4 要堵的 catch 残留场景）。**已知有界残留**（仅登记不修）：consumer abort 且**永无**终态事件、closeStream 也从不被调用的极端路径，entry 会留到下一轮 turn 的 `:933 set` 覆盖（按 session key）——其用户面归 stop-recovery Phase 3 lock-watchdog，stream entry 残留无害且有界。Tier 2（已读 guardrail）。

- [x] **A5 [P2 debt] 权限超时静默拒绝 + cleanup 逻辑三处重复** — ✅ **完成 2026-06-19**（Step 1+2 均落地）
  - **Step 1（纯重构）✅**：抽 `finalizePermission(id, result, dbStatus, dbExtra)` 单一出口，allow/deny/timeout/abort **四**路径共用（原三路径各自重复 `clearTimeout+resolve+map.delete+dbResolve`，且 DB 写序已漂移——resolvePendingPermission 写在 resolve 前、另两路径写在后）。统一为 DB 写在 resolve 前（保留原注释语义）。验证：`permission-registry-finalize.test.ts` 5 测断言四路径都持久化对应 DB status（allow/deny/timeout/aborted）+ idempotent 双 resolve（第二次返回 false 不 clobber）；timeout 用 `node:test` `mock.timers` 跳过 5 分钟真等。
  - **Step 2（超时可见性，契约优先）✅**：**事件契约**——新 SSE 事件 `permission_resolved {permissionRequestId, status:'timeout'}`，registry 新增可选 `onTimeout` 回调（**仅**超时触发，非 abort、非用户 resolve），4 个注册点（`claude-client` / `agent-tools` / codex `approval-bridge` + `mcp-elicitation`）各用自身 emit 通道发此事件，共享 `buildPermissionResolvedEvent` 防字段漂移 → **跨 Runtime 一致**（语义验收 #5）。**前端**：`permissionResolved` 联合加 `'timeout'`；**双入口都接**——`/chat` inline switch（registry 仅对未决请求发，单 prompt 流可不 id-guard）+ `/chat/[id]` stream-session-manager `onPermissionResolved`（有 snapshot 可变访问，id-guard）；`PermissionPrompt` 加 timeout 渲染态（generic / ExitPlanMode / AskUserQuestion 三处，getApproval 把 timeout 视为 not-approved）；i18n `streaming.permissionTimedOut` = "已超时自动拒绝" / "Auto-denied — request timed out"。**语义验收**：文案明确"已超时自动拒绝"，区别于用户主动 deny（不显示裸"已拒绝"）。
  - **验证**：`permission-registry-finalize.test.ts` 9 测（Step1 5 + Step2 onTimeout 4：仅超时触发 / 用户 resolve 不触发 / abort 不触发 / 回调抛错不阻断 deny）；`tsc --noEmit` exit 0（11 文件类型接线一致）；全量单测 3360/3360；dev server 编译 `/chat` + `/chat/[id]` 双入口干净（HTTP 200，无编译错误）。**remaining gap（仅登记）**：真实凭据下"发起权限请求 → 等超时 → 双入口 UI 出现超时态"的 live smoke 未跑（需 provider + 临调 TIMEOUT_MS）；契约已 unit-pin，前端 render 路径已 typecheck + 双入口编译验证。Tier 2（权限链路 + Stream）。
  - **A5 Step 2 follow-up（P3，Codex review 两轮，2026-06-19 当日修）**：超时态新增后，侧栏"需要批准"徽章可能残留——徽章 = `pendingApprovalSessionIds.has(id)`（AppShell Set，源自 `pendingPermission && !permissionResolved`，超时时已正确转 false）**OR** 全局单值 `pendingApprovalSessionId`（超时路径不清）→ OR 进去徽章不灭。
    - **第一轮（`f99edbb`）**：入口1（`/chat` inline，无 stream-session-manager window event）`permission_resolved` case 补 `setPendingApprovalSessionId('')`；入口2（`/chat/[id]`）在 `useStreamSubscription` 清全局。
    - **第二轮订正**：reviewer 指出 `useStreamSubscription` 的清理**依赖 ChatView 挂载**——用户切走会话后该 hook 退订，后续 timeout 的 `snapshot-updated` 不再触发。改为放到 **AppShell 全局 `stream-session-event` handler**：用 `event.detail.sessionId` + 函数式守卫 `prev === sid && !approvals.has(sid)` 清单值。这不依赖 ChatView 挂载（覆盖"切走后超时"），且比无条件清更精确（不误清 peer / inline 新会话）。同时**移除** `useStreamSubscription` 里第一轮那条无条件清理（已被 AppShell 完整且更安全地取代）。入口1 inline 因不走 window event，保留自身 case 清理。
    - 验证：typecheck + 全量单测；React 状态接线无 hook-test harness，靠 typecheck + AppShell Set 源独立保护 + 代码审查。

- [x] **A6 [P3 bug] `ChatEmptyState.tsx` localStorage 裸调用** — ✅ 已核验 · **完成 2026-06-11**（getItem/setItem 各包 try-catch + 安全默认）
  - 位置：`src/components/chat/ChatEmptyState.tsx:145,151`。Electron 环境 localStorage 基本可用，风险低，但项目内其他位置均有 try-catch 包裹（抽查确认后照惯例修齐）。修法：try-catch + 安全默认值。验证：代码审查即可。Tier 0，与其他 Tier 0 改动攒一个 commit。

### Phase A 误报记录（审计已排除，后续代理不要再报）

- ~~`agent-loop.ts` pendingMediaByCallId 内存泄漏~~：该 Map 在 `start(controller)` 闭包内 per-turn 创建（`agent-loop.ts:138`），turn 结束随闭包回收，未删除的 entry 生命周期以单轮为界，非泄漏。
- ~~stream-session-manager throttledTextEmit 丢失最终更新~~：error/abort 路径已有 `flushTextThrottle()` 保护（:759），实现健壮，仅建议补单测（并入 C2）。

---

## Phase B — Electron 安全加固

**用户能看到什么**：无感（价值形态 C）。这一批全部是"渲染进程万一被 XSS，攻击者能拿到什么"的二次伤害面收紧。
**不做什么**：不改任何用户交互；不启用 auto-updater（产品决策维持手动下载）。
**怎么验收**：每条的对抗性输入测试通过（见各条验证）；`npm run test` 绿；打包冒烟一次确认导出 PNG/长图、打开文件夹、终端功能无回归。

### 实现路径

- [x] **B1a [P1 security] `shell:open-path` 参数不校验** — 完成 2026-08-01。通用 IPC 已删除；目录只允许 session/home scoped `revealPath` 并在主进程二次 realpath/stat、拒绝 bundle，文件只有 workspace HTML 可走专用 `openHtmlFile`。Next fallback 同步删除 `exec(open \"${path}\")`，改固定 argv + `shell:false`。行为/源码门禁覆盖相对路径、symlink escape、`.app/.workflow`、`.command` 与命令元字符。
- [ ] **B1b [P2 security] `dialog:open-folder` defaultPath 参数不校验** — 待单独核验；仅接受存在的绝对目录，否则置 undefined。验证传 `../../etc`、不存在路径、symlink 与 UNC（win32）。Tier 2（Electron IPC）。

- [ ] **B2 [P2 security] `terminal:write` 无输入大小限制** — ⚠️ 待核验（`electron/main.ts` 约 :2243 + `terminal-manager.ts` 直写 stdin）
  - 修法：单次写入上限（如 1MB）超限丢弃并 warn；evaluate 是否需要速率限制（终端正常使用不会触发，定低噪音上限即可）。
  - 验证：单测/手测灌大字符串不 OOM、正常输入不受影响。Tier 2。

- [ ] **B3 [P2 security] widget/artifact 导出窗口渲染任意 HTML** — ⚠️ 待核验（`electron/main.ts` 约 :2030-2078、:2092-2223；v2：**禁止 blanket 剥 `<script>`**，拆两条策略）
  - 现状：导出窗口已有 sandbox + 隔离 partition + 导航拦截，但 HTML 来自渲染进程、经 `data:` URL 执行，XSS payload 可在导出窗口跑 JS。
  - **关键约束（Codex 审查指出）**：导出链路**明确依赖脚本执行**——widget 导出靠 `__scriptsReady__` console 信号判定渲染完成（`main.ts:2058`、`widget-sanitizer.ts:154`），长图导出同样 race `__scriptsReady__`（`main.ts:2141`），dashboard-export 注释明言"Includes: script execution, scriptsReady signal"。blanket sanitize 剥 `<script>` 会直接破坏导出功能。
  - 修法（拆两条策略，先核验再定）：
    - **widget 导出**：脚本是功能必需，不 sanitize。收紧能力面：核对导出窗口 webPreferences 显式 `devTools: false` + `webSecurity: true`，确认窗口无 preload / 无 IPC 面（审计称已隔离，逐项核实并在本条目记录核实结果），评估 CSP 注入是否能限制脚本来源为 inline-only。
    - **artifact/长图导出**：先核验其 HTML 是否真的需要任意脚本（若只依赖固定的 ready 信号脚本，可改为模板侧注入该脚本 + 对用户内容部分 sanitize）；不可行则与 widget 同策略。
  - 验证：构造 `<img onerror>` / 外联脚本 payload 走两条导出链路，确认能力面收紧后导出产物像素无回归（`__scriptsReady__` 信号仍工作、对照导出 PNG/长图）。Tier 2。

- [ ] **B4 [P3 security] `log-sanitize.ts` 漏掉全大写型 token（AWS AKIA 等）** — ⚠️ 待核验（`electron/log-sanitize.ts:61-76`，`looksLikeToken` 要求同时含大小写）
  - 修法：补 `AKIA/ASIA` 前缀模式 + 20+ 位全大写数字混合启发式；用现有测试风格补对抗样例（AWS key、全大写 token 被掩码；commit hash、纯数字不被误杀）。
  - 验证：单测。Tier 1。

- [ ] **B5 [P3 security] Sentry 上报未过 sanitize** — ⚠️ 待核验（`electron/main.ts:16-18` 初始化无 `beforeSend`）
  - 修法：`beforeSend` 中对 message/breadcrumb 应用 `sanitizeLogLine`。
  - 验证：本地触发含假 key 的错误，断言（mock transport 或 beforeSend 单测）输出已掩码。Tier 1。

- [ ] **B6 [P3 debt] `install:start` 的 `curl | bash` 继承完整用户 shell env** — ⚠️ 待核验（`electron/main.ts` 约 :1785-1848）
  - 修法：URL 硬编码可接受，但 spawn 改用最小 env（PATH/HOME/SHELL），不透传 userShellEnv 全量。注意别破坏代理用户场景（保留 HTTP(S)_PROXY 透传）。
  - 验证：手测 CLI 安装流程在干净/代理两种环境可用。Tier 2。

- [ ] **B7 [P3 build] 打包产物源码映射核查** — 一次性检查任务
  - 解包最近一次 release 的 DMG/NSIS，搜 `.js.map`；若存在，`next.config.ts` 的 `outputFileTracingExcludes` 加 `**/*.map` 或 build 脚本加清理步。验证：复打包后产物无 .map。Tier 2（发版链路）。
  - 同场顺手核查 `after-pack.js`：双重 rebuild 失败时无缓存兜底（审计 P2）——**仅登记不修**，构建机失败属罕见且 fail-closed 是对的；如未来 CI 出现过 rebuild 失败再提级。

---

## Phase C — 测试补洞

**用户能看到什么**：无感（价值形态 C）。目标是三件事：高风险缺测链路有行为测试（已有覆盖的盘点后只补缺口）、被 skip 的核心 E2E 流程复活、"只对源码做正则"的测试在保留 pin 的同时补上行为断言。
**不做什么**：不追求覆盖率数字；不给纯 UI 辅助模块补测；**不删除 source-pin 测试**——source-pin 是本项目刻意的 guardrail 模式（防止反模式回潮），问题只在于"某些链路 pin 是唯一覆盖"，解法是**加**行为测试，不是删 pin。
**怎么验收**：下表每条有对应测试文件落地（或盘点后记录"已覆盖、关闭"结论）且 `npm run test` 绿；E2E 全量 32 处 skip 完成分类盘点，composer/chat 相关 skip 清零或逐条注明保留原因（见 C5）。

### 实现路径

按 ROI 排序（每条先核验"实际缺口"——审计用文件名/import 粗匹配可能漏掉间接覆盖，对已有覆盖的模块盘点后只补缺口）：

- [ ] **C1 权限规则引擎测试补强（非零覆盖，v2 订正）**：`src/lib/permission-checker.ts` 并非零覆盖——`native-runtime.test.ts:11` 起已覆盖三档模式 allow/deny、危险命令始终 ask、findLast 用户规则语义。本任务改为：先盘点 native-runtime.test.ts 的已覆盖矩阵，只补缺失分支（候选：规则通配符/路径匹配边界、未知工具名默认行为、规则与危险命令叠加时的优先级、各 profile 默认规则全集快照），并评估是否值得把 permission-checker 断言拆出独立文件（拆的话保留原文件内与 native-runtime 集成相关的断言，避免单纯搬家）。
- [ ] **C2 stream-session-manager 生命周期测试**：会话切换旧流释放、abort 后 phase 翻终态（直击 CLAUDE.md 标注的 stop/abort 高发区）、throttle flush 不丢尾包、rewindPoints 数组随 stream 完成清理。新建 `src/__tests__/unit/stream-session-manager-lifecycle.test.ts`。注意已有 `clear-snapshot-preserves-state.test.ts` 钉住的契约，不要冲突。
- [ ] **C3 破坏性文件路由测试**：`/api/files/write|delete|rename|mkdir` 零覆盖（仅 files-security 一份）。补集成测试：写入冲突、删除生效、路径安全复用现有 files-security 模式。
- [ ] **C4 interrupt 行为测试升级**：`codex-interrupt-contract.test.ts` / `interrupt-route-runtime-fanout.test.ts` 目前只做源码正则。保留 pin，**另加**行为测试：调用真实 `issueCodexTurnInterrupt`（无 active turn 返回 false 等）+ interrupt 路由 fan-out 的可执行断言（mock runtime registry 记录调用）。与 `codex-stop-recovery.md` 协同：**该计划标注"待修"，但审计发现 `interrupt/route.ts:46-51` 似乎已含 codex fan-out——接手者先核对代码现状与计划状态是否脱节，脱节则先更新那份计划**。
- [ ] **C5 E2E skip 清理（v2 重定口径）**：全量实测 `src/__tests__/e2e/` 共 **32 处 skip、分布 12 个文件**（原"17+"系子代理低估）。执行分三步：(1) 先全量盘点 32 处，分类为 ①composer/chat fixture 根因可解（`chat.spec.ts` / `context-chips-send-clear.spec.ts` / `mention-ui.spec.ts` / `run-checkpoint-confirm.spec.ts` 等"测试环境拿不到 composer"一族）②旧布局待重写（归 tracker #9，不在本任务）③环境限制合理保留；(2) 修 composer fixture 根因（**涉及产品代码则归 Claude Code**），解 ① 类 skip；(3) 目标改为：**composer/chat 相关 skip 清零或逐条注明保留原因**，不设全局 ≤N 数字指标。盘点结果记入本条目。
- [ ] **C6 反例 smoke 盘点后补齐（v2 订正）**：原审计称 context-breakdown 缺 over-budget clamp / cache 反例**不成立**——`context-breakdown.test.ts:272` 已有 over-budget clamp（ratio=1 / remaining=0）、`:287` 起已有 cache accounting describe 块。本任务改为：先通读该文件列出已覆盖反例清单，再判断是否还有缺口（候选方向：Native/Codex provider-proxy 的 input_tokens=0 兜底提升路径与普通路径的差异断言——与 tracker #24 的双计语义相关；popover 各 kind 在 source 缺失时隐藏/降级的断言）；确认无缺口则记录结论关闭。`structured-output.test.ts` 改为 import 真实模块而非本地复制实现这半条仍然有效，照做。
- [ ] **C7 db.ts migration lock 并发测试**：`withMigrationLock` 获取/释放/stale lock 清理。新建测试，必须用 `db-isolation.setup.ts` 隔离环境（教训见 tracker #25/#30）。
- [ ] **C8 oauth 模块单测**：`src/lib/openai-oauth.ts` PKCE 生成/校验、token 交换（全 mock，不打真实端点）。

---

## Phase D — 低优性能与债务（攒批做，不阻塞发版）

**用户能看到什么**：会话攒到几百个之后列表/搜索仍流畅（价值形态 B：会话列表接口在 500 会话样本下 P95 < 200ms）。
**怎么验收**：造 500+ 会话的测试 DB，量列表接口耗时与响应体积。

### 实现路径

- [ ] **D1 [P2 perf] 会话/Provider 列表无分页**：`/api/chat/sessions`（`getAllSessions` 全量 `.all()`，db.ts 约 :1152）、`/api/providers` 全量返回。修法：sessions GET 加 `limit/offset`（默认 limit 100，前端列表本就分段渲染则同步接上）；providers 数量级小可不动，核实后注明。验证：500 会话样本量耗时。
- [ ] **D2 [P3 perf] 聊天热路径同步 IO**：`src/lib/context-assembler.ts:142` `readdirSync` 数 memory 文件，每次 /api/chat POST 都跑。修法：TTL 缓存（memory 文件变更不频繁）或挪出热路径。
- [ ] **D3 [P3 debt] token 估算固定 4 bytes/token 对 CJK 严重低估**：`src/lib/context-estimator.ts:22-26`。中文用户（本项目主力用户群）上下文压缩触发时机会偏晚。修法：按 CJK 字符占比动态调整系数（CJK ≈ 1.5-2 字符/token），不引入 tiktoken 重依赖；对照真实 usage 回传校准。**语义验收**：上下文用量 UI 显示的是估算值，确认文案没把它当实测卖。
- [ ] **D4 [P3 debt] Codex `app-server-client` 请求 id 无回绕** + **fire-and-forget IIFE 的 catch 自身可抛**（`src/lib/codex/runtime.ts:240,338`）：两条理论性问题，碰到该文件时 on-touch 顺手修，不单开 commit。
- [ ] **D5 [P3 debt] API 错误响应结构不统一**：`{error}` / `{error,code,meta}` / 裸 stack 三种并存。A1 落了统一 helper 后，新路由一律用 helper；存量不强迁，碰到改哪个迁哪个（on-touch）。
- [ ] **D6 [P3 debt] terminal 用 spawn 而非 PTY**：vim/htop 等全屏程序不可用，代码内已注明 KNOWN LIMITATION。升级 node-pty 是带原生依赖的工程决策（影响打包链 after-pack），**仅登记**；若用户提出终端体验需求再立项。
- [ ] **D7 [P3 perf] `smoke-test.ts` 旧版已弃用未删**：确认无引用后删除，指向 `e2e/smoke.spec.ts`。

---

## 附录 1 — 各子系统健康度结论（审计原始结论摘要）

| 子系统 | 结论 |
|--------|------|
| 流式/会话核心 | 中上。架构合理，问题集中在错误路径资源收口与重复 cleanup 逻辑 |
| Codex Runtime | 良好。stop-recovery / log-bloat 两个活跃计划覆盖了主要风险；本计划仅补 Map 清理与理论性小项 |
| DB + API | DB 层良好（参数化查询无注入、迁移保守、WAL 配置正确、文件路由路径安全做得扎实）；API 层可接受（错误泄漏 + 无分页是主要债） |
| 前端 | B+。i18n en/zh 零漂移；事件监听/objectURL 清理纪律好；双入口状态解析一致；债集中在流式热路径 O(n²) |
| Electron + 构建 | 7.5/10。安全基线（contextIsolation/nodeIntegration/导航拦截/单实例）正确；债在 IPC 参数校验与导出窗口 HTML 面 |
| 测试 | 单测量大（245 文件 3000+ 断言）但分布失衡：流生命周期/破坏性文件操作缺行为测试（权限引擎经 v2 核验已有覆盖，仅需补强）；E2E 实测 32 处 skip / 12 文件，composer/chat 核心流程在内；部分链路只有 source-pin 没有行为断言 |

## 附录 2 — 审计确认应提级立项的构建项（不在本计划内执行）

1. **API key 加密落盘**（tracker #40，建议提级为下一个 Tier 2 立项）：Electron `safeStorage` + 存量明文透明迁移。审计确认这是当前最大的单点数据安全面。
2. **文件搜索索引**（tracker #10）：SQLite FTS / trie 持久化索引替代每次键入递归扫盘。会话/workspace 数增长后该债的体感会越来越差，与 D1 同属"规模化"主题。
3. **Runtime Capability Adapter**（tracker #41 + memory 四抽象方向）：effort/thinking 档位 per-runtime 维度，替代点状 toast。下一个 Runtime 能力类需求出现时必须走这个抽象，不再加补丁。
4. **Electron E2E 框架**（tracker #6）：`_electron.launch()` 框架是 Phase B 各条"手测"步骤的自动化前提，B 做完后 ROI 明显上升。

## Smoke Ledger

| 日期 | Phase | 验证内容 | 结果 | 证据 |
|------|-------|----------|------|------|
| 2026-06-11 | A1 | helper 只回 message、不漏 stack（反例：body 恰等于 message、无换行、不含完整 stack） | ✅ | `api-error.test.ts` 4 测；`grep error.stack\|\| src/app/api` 归零 |
| 2026-06-11 | A3 | error 事件普通路径（无 snapshot→旧形状）vs 触发路径（有 snapshot→带 context_accounting）反例 | ✅ | `agent-loop-error-event.test.ts` 4 测 |
| 2026-06-11 | A1–A6 | typecheck + 全量 unit + 改动文件 lint | ✅ | `tsc --noEmit` exit 0；`npm run test` 3349/3349；改动文件 0 eslint error |
| 2026-06-11 | A2 | ElapsedTimer `key={startedAt}` remount 首帧真实值 — **逻辑论证（React 官方 key-reset 模式 + 惰性初值 mount-time 真实）**，动态流式计时器 CDP **未做** | ⚠️ 待视觉确认（见 2026-06-19 行收口） | 见决策日志；若需起 dev server 切轮看计时器跳变 |
| 2026-06-19 | A4 | closeStream 单一清理出口：turn 登记后终态前抛异常 → catch closeStream → 无残留（source-pin 三条：guard 前 delete / 终态分支无 inline delete / catch 走 closeStream） | ✅ | `codex-interrupt-contract.test.ts` 11 测（含改写的 3 条 A4 pin） |
| 2026-06-19 | A5 Step1 | allow/deny/timeout/abort 四路径都持久化对应 DB status（反例：每路径断言**不同** status；idempotent 双 resolve 第二次返回 false 不 clobber） | ✅ | `permission-registry-finalize.test.ts` 5 测（timeout 用 `mock.timers` 免 5 分钟真等） |
| 2026-06-19 | A5 Step2 | `onTimeout` **仅**超时触发（反例：用户 resolve / abort 各断言 0 次调用）；回调抛错不阻断 deny；双入口路由编译干净 | ✅ 单测+编译 / ⚠️ live UI 待跑 | `permission-registry-finalize.test.ts` 9 测；`tsc` exit 0；dev `/chat`+`/chat/[id]` HTTP 200 无编译错误 |
| 2026-06-19 | A2 | ElapsedTimer 首帧 stale 系 **sub-frame 瞬态**（~16ms）：keyed remount（`key={startedAt}` + lazy init 从 startedAt 算）构造性消除，且**修与不修首帧之后均正确** → 截图不可判别该瞬态（非判别性，做了也是 theater）。代码级 pattern 确认 + dev server StreamingMessage 编译/渲染干净 | ✅ 代码级确认 + 编译干净；瞬态不可截图判别 | `StreamingMessage.tsx:217-219,271`；dev server `/chat` HTTP 200 |
| 2026-06-19 | A4–A5 | typecheck + 全量 unit 无回归 | ✅ | `tsc --noEmit` exit 0；`npm run test` 3360/3360 |
| 2026-06-19 | A5 follow-up | 超时后侧栏"需要批准"徽章不残留：入口1 清全局 + 入口2 snapshot-resolved 清全局（AppShell Set 独立保护 peer） | ✅ 代码级 + typecheck | `page.tsx` permission_resolved case + `useStreamSubscription.ts` resolved-snapshot 清理；无 hook-test harness |

## 决策日志

- 2026-06-11 计划创建。6 路并行审计 + 主审现场核验；2 条审计发现判定误报已记录（Phase A 末尾）。Phase 顺序按"用户体感 bug → 发版前安全 → 回归保护 → 规模化"排定。
- 2026-06-11 **Phase A1/A2/A3/A6 实施完成 + Codex 复核修复**。Codex 复核提 1×P1 + 2×P2，全部核验属实并修：
  - **P1（StreamingMessage 首帧回归）**：rAF 方案的注释"惰性初值已绘正确首帧"对 startedAt 变化（新 turn）不成立——惰性初始只 mount 跑一次，同实例 startedAt 变化时首帧会显示上一轮秒数。Codex 给了"渲染期 derived"或"认延迟改注释"两条路；我选**更优的第三条 `key={startedAt}` remount**：startedAt 变即 remount，惰性初始重跑 → 首帧永远真实值（新 turn≈0、恢复 stream 也正确），彻底删掉 reset effect（消除 #35 error），无需 rAF / 无渲染期 Date.now。这是 React 官方 "reset state with key" canonical 模式。
  - **P2（A3 错误路径无条件 fs 读）**：错误路径改 `records.length>0` 才 collect，空 turn 不付 `resolveWorkspaceClaudeMdRules` 的 CLAUDE.md 文件读；成功路径仍总是 collect（要显示 system_prompt/rules）。
  - **P2（api-error 测试 stack 探测弱）**：改为 `body.error === err.message`（最强）+ 不含换行 + 不含完整 stack 三重断言。
  - **遗留**：ElapsedTimer 是时间 UI 组件，单测覆盖不到首帧那一下；key 方案正确性靠逻辑论证，动态流式计时器 CDP 未做（见 Smoke Ledger ⚠️）。
- 2026-06-11 **v2 修订（Codex 静态审查，7 处全部核验属实后订正）**：① 执行主体从"任何代理"改为 Claude Code 实施 + Codex 审查/用例设计（AGENTS.md:12-18 角色边界）；② C1 "permission-checker 零覆盖"订正为补强（native-runtime.test.ts:11 起已覆盖三档/危险命令/findLast）；③ C6 over-budget clamp 与 cache 反例已存在（context-breakdown.test.ts:272/:287），改为盘点后补缺口；④ A4 排除 fsWatchEntries 泄漏（delete 在 closeStream 内 runtime.ts:337，catch 必经 closeStream），收窄为 activeCodexTurns 核验，降 P3；⑤ A5 拆两步，超时可见性需先定义事件契约（前端现仅 permission_request + 二值 permissionResolved）且双入口一致；⑥ B3 禁止 blanket 剥 script（导出依赖 __scriptsReady__，main.ts:2058/:2141），拆 widget / artifact 两条策略；⑦ C5 口径重定：实测 32 处 skip / 12 文件，目标改为 composer/chat 相关 skip 清零或注明原因。教训沉淀：子代理审计的"零覆盖"类结论用文件名粗匹配易误报，主审核验环节对"缺失类"断言也要现场验证，不只验证"存在类"断言。
- 2026-06-19 **A4 + A5 收尾完成（Claude Code 实施）**。Phase A 全部条目（A1–A6）至此 ✅。
  - **A4**：核验确认 `activeCodexTurns` 残留**属实**——`delete` 原仅在终态分支 `:879`，`closeStream()`（catch/abort 路径）不清理。修法：`delete` 移入 `closeStream()` 顶部（在 `active` guard 之前，robust 到 consumer-abort 后迟到终态事件的冗余 close），移除 `:879` inline → 三条 close 路径单一出口。验证用 source-pin（`activeCodexTurns` 私有 + `stream()` 需 live app-server，沿用 `codex-interrupt-contract.test.ts` 既有模式并精确化为三条 pin）。已知有界残留（无终态且 closeStream 永不被调用的极端路径）登记不修，归 stop-recovery Phase 3 lock 面。
  - **A5 Step 1**：`finalizePermission` 单一出口，四路径（allow/deny/timeout/abort）共用 + DB 写序统一为 resolve 前。5 测覆盖四路径持久化 + idempotent 双 resolve。
  - **A5 Step 2**：契约优先——`permission_resolved` SSE 事件 + registry `onTimeout` 回调（仅超时触发），4 注册点共享 `buildPermissionResolvedEvent` 跨 Runtime 一致；前端 `permissionResolved` 加 `'timeout'`，双入口都接（inline switch + stream-session-manager），PermissionPrompt timeout 态，i18n 双语"已超时自动拒绝"。9 测 + typecheck + 全量 3360/3360 + 双入口编译干净。live UI smoke（真实凭据 + 临调 TIMEOUT_MS）列为 remaining gap。
  - **A2 动态视觉收口**：复核确认首帧 stale 系 **sub-frame 瞬态**，keyed-remount 构造性消除，**且修/未修首帧之后均正确** → 任何截图都不可判别该瞬态。故以代码级 pattern 确认（`StreamingMessage.tsx:217-219,271`）+ dev server 编译/渲染干净为验证，**不做非判别性截图**（避免 verification theater）；2026-06-11 的 ⚠️ 待视觉确认据此收口。
  - **提交边界**：本次只提交 A4/A5 + A2 文档收口相关文件；Codex 新增的 `v0.56.x-stability-trust.md` 总计划不混入本修复提交（按用户指示）。
