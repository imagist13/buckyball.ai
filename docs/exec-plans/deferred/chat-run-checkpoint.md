> **Archive note（2026-06-05，document-system-governance）**：本计划已移出 `active/`，归入 `deferred/`——用户明确暂缓，未来可能重启。**不是当前任务入口**；当前工作入口见 [exec-plans README](../README.md)，重启方式见 [deferred/README.md](README.md)。

# Chat Run Checkpoint — 轻量运行前信任层

> ⏸ **本轮重构暂缓**（见 [refactor-closeout.md](../completed/refactor-closeout.md) "暂缓清单"）— Round 1+2 已完成；Round 3（PermissionPrompt 视觉收编）不主动推进，等收口完成后再评估。

## 状态: 🟡 Round 1 + Round 2 完成（2026-04-30）— Round 3 暂缓（2026-04-30 用户决定）

> 上一阶段（Context chips Phase 1）见 [../completed/context-chips-phase-1.md](../completed/context-chips-phase-1.md)
> 设计原则见 [insights/chat-composer-redesign.md](../../insights/chat-composer-redesign.md) 的 "Chat 页设计原则" 节
> Round 1 实现见 [handover/chat-run-checkpoint.md](../../handover/chat-run-checkpoint.md) + [insights/chat-run-checkpoint.md](../../insights/chat-run-checkpoint.md)

## Round 3 暂缓决定（2026-04-30）

**用户决定暂缓 Round 3，PermissionPrompt 保持现状不动。**

**暂缓原因**：
1. 当前用户习惯：除删除文件等明显危险操作外，大多数权限请求都直接同意——视觉收编对当前主流程没有实际收益
2. 没有用户反馈说权限确认信息不够清晰或不够安全
3. PermissionPrompt 属于执行中权限链路，改动风险高，容易造成 agent pending、确认失效或 allow_session 行为回归
4. Round 1 / Round 2 已经解决了更高频、更影响理解的"发送前状态"问题（pinned-invalid / runtime-fallback / context-cost / permission-elevation），这是更高 ROI 的工作

**保持现状的明确边界**：
- ❌ 不改 `PermissionPrompt` 代码
- ❌ 不收编 generic permission prompt 视觉
- ❌ 不引入新的"危险工具"判断逻辑
- ❌ 不改变 `allow_session` / `full_access` / `NEVER_AUTO_APPROVE` 行为

**重新启动条件**（命中任一即重新评估 Round 3）：
- 用户反馈"看不懂权限请求"或要求"更清楚的工具说明"
- 删除 / 覆盖 / 批量修改类操作造成误操作或用户投诉
- 企业客户要求更明确的审计 / 确认说明
- 我们以后做"工具风险分级"或"多 Agent 协作权限模型"——这两个是结构性引入，会自然带出权限 UI 重设

**已写的 Round 3 前置设计保留在文档第 §Round 3 前置设计 节作为参考**，未来重启时不必重新调研入口盘点 / 工具语言设计 / 视觉规范——直接以那一节为基线讨论新增/修订即可。

## Round 2 交付（2026-04-30）

**核心改动**
- `src/lib/run-checkpoint.ts`：
  - `CheckpointReasonId` 新增 `'context-cost-change' | 'permission-elevation'`
  - `CheckpointAction.actionId` 新增 `'confirm-context-cost' | 'confirm-permission-elevation'`
  - `CheckpointReason.requiresConfirm?: boolean` 标记阻断型 reason
  - `BuildCheckpointsOpts` 新增 `pendingContextTokens / usedContextTokens / permissionElevationPending`
  - `shouldTriggerContextCost(pending, used)` 公开纯函数 + `CONTEXT_COST_PENDING_HARD = 10_000`、`CONTEXT_COST_PENDING_RATIO = 0.3` 常量
- `src/components/chat/RunCheckpoint.tsx`：新增 `onAction(actionId)` prop；当 reason.action.actionId 存在且 onAction 提供时优先调用，否则回退到 href 导航
- `src/components/chat/MessageInput.tsx`：
  - 新增 `blockingReasonIds?: ReadonlyArray<string>` prop
  - `handleSubmit` 顶部读 `bypassBlockingRef`，未 bypass + 有 blocking reasons 时直接返回；否则消费 bypass 标志继续
  - 监听 `'run-checkpoint-confirm-send'` 窗口事件：set bypass + 程序化点击 `button[data-message-input-submit]`（locale-agnostic data attribute；找不到/disabled 时清回 bypass，避免标志泄漏）
- `src/app/chat/page.tsx` + `src/components/chat/ChatView.tsx`：
  - 新增 `permissionElevationConfirmedFor: 'full_access' | null` state + reset effect（profile 离开 full_access → 清回 null）
  - chat/page.tsx 用 `usedContextTokens = 0`（新会话还没 assistant turn）
  - ChatView 用 `useContextUsage(messages, currentModel).used` 跟 RunCockpit 同源
  - `buildCheckpoints` 多传四个新参数；`blockingReasonIds = checkpointReasons.filter(r => r.requiresConfirm).map(r => r.id)` 派给 MessageInput
  - `handleCheckpointAction(actionId)`：permission-elevation 时 setState；两个 confirm 都 dispatch 事件
  - 传 `onAction={handleCheckpointAction}` 给 RunCheckpoint
- `src/i18n/{en,zh}.ts`：新增 6 个 key（`runCheckpoint.contextCost.{title,description,action}` + `runCheckpoint.permissionElevation.{title,description,action}`）

**测试**
- `unit/run-checkpoint.test.ts`：从 10 用例扩展到 23（新增 13）
- `unit/run-checkpoint-blocking.test.ts`：9 新用例覆盖 bypass 状态机 + permission session 重置 + context-cost 自然清空
- `npm run test`：1354 / 1354 通过

## 决策日志

- 2026-04-30 Round 2 设计：**Banner 不持久化"已确认"**（除了 permission-elevation 的本-session 标志）。context-cost 通过 pending→0 的自然 state 转换让 banner 自己消失；不需要 sessionStorage 或 confirmedFlag。permission-elevation 必须持久化是因为它的触发条件（profile === full_access）即使用户发送也不会变。
- 2026-04-30 Round 2 设计：**Bypass 走 ref + 程序化 click，不走 prop**。直接给 MessageInput 一个 `bypass` prop 会让父组件难以保证"只 bypass 一次"，而 ref 是 MessageInput 内部状态，自然 single-shot 消费。Click 走原 PromptInput 提交链路，避免重新实现一遍 file/mentions/attachments 序列化。
- 2026-04-30 Round 2 设计：**两个入口同样接入**。chat/page.tsx 与 ChatView.tsx 各自维护自己的 `permissionElevationConfirmedFor`——这是 session 级 state，不应通过全局 store 共享。usedContextTokens 也分别计算（新会话恒为 0；已有会话从 `useContextUsage` 拿）。
- 2026-04-30 Round 2 决定：**MessageInput 内部用 `document.querySelector('button[data-message-input-submit]')`**（locale-agnostic data attribute，由 `MessageInputParts.tsx` 的 `FileAwareSubmitButton` 设置）。Codex P2 review 期间发现原来用 `button[aria-label="Submit"]` 在 zh locale 下匹配不到（aria-label 已 i18n 成"发送消息"）；改成 data attribute 后跟 e2e `run-checkpoint-confirm.spec.ts` 一起锁定契约。如果将来同页有多个 composer（split-chat 已经是这样但我们今天不支持），需要换成 ref-forwarded approach。

## Round 1 交付（2026-04-29）

- `src/lib/run-checkpoint.ts` — `CheckpointReason` union + `buildCheckpoints()` 推导（pure，可单测）
- `src/components/chat/RunCheckpoint.tsx` — inline banner 组件，`tone: error/warning/info` × `bg-status-*-muted` token，与 RateLimitBanner / TerminalReasonChip 共享视觉语言（**注意：PermissionPrompt 不在此列**——它仍是 border-t + bg-background 独立面板，留给 Round 3 收编）
- 接入 `src/app/chat/page.tsx`：替换原 `<ErrorBanner>` for `invalidDefault`，统一进 RunCheckpoint
- 接入 `src/components/chat/ChatView.tsx`：新增同样的 RunCheckpoint，挂在 RateLimitBanner 后、MessageInput 前
- i18n 9 条键（`runCheckpoint.{noProvider,pinnedInvalid,runtimeFallback}.{title,description,action}`）en + zh 同步
- 单测 `src/__tests__/unit/run-checkpoint.test.ts` 10 用例：precedence、stacking、Round 1 reason id 锁定、单一 action 强约束
- CDP 验证：三类 banner 同时渲染时视觉一致（截图 docs/exec-plans/screenshots/run-checkpoint-round1-banner-preview.png）

### Codex review 修复（2026-04-29）

- **P2.1** — ChatView 不再订阅 `overview.defaultInvalid`：已建会话只关心自己保存的 `(provider, model)` 还能不能跑（用 `noCompatibleProvider`）+ 全局 runtime fallback。全局 pinned-invalid 留给 `/chat` 新会话入口 / Overview / Runtime / Health。修复了"看起来阻断但实际没阻断"的语义错位。
- **P2.2** — 抽 `composeSubmitPayload()` 接管 `handleSubmit` 的 payload 组装；`src/__tests__/unit/context-chips-send-clear.test.ts` 新增 5 条用例覆盖完整 submit 周期；MessageInput 三个 submit 分支（normal / image-agent / badge）全部走 composeSubmitPayload。
- **P2.2 round 2** — `src/__tests__/e2e/context-chips-send-clear.spec.ts` 加 `real form submit clears chips + posts inode/directory in body @smoke`：mock `/api/chat/sessions` + `/api/chat`、dispatch 目录 chip、textarea 填字、按 Enter 真实提交，断言（a）POST body 含 `[Referenced Directories]` + `inode/directory` 文件项；（b）chip 从 DOM 消失（验证 `setDirectoryRefs([])` 真的跑了）；（c）textarea 清空（验证 `setInputValue('')` 真的跑了）；（d）user bubble 渲染纯文本，**不**含 `[Referenced Directories]`。playwright.config.ts 加 `PLAYWRIGHT_BASE_URL` env 支持 worktree 端口。

## Round 分阶段（重要：不要一次做满 5 类）

按用户 2026-04-29 反馈，本计划的 5 类触发不一次性接入。先做最小闭环，**证明"同一个等待确认形态"成立**，再按风险扩展。

### Round 1（首轮，本计划开工时只做这部分）— ✅ 已完成 2026-04-29

**目标：建立统一 trust layer + 验证 inline banner 形态**

- ✅ 抽象 `RunCheckpoint` 组件（`src/components/chat/RunCheckpoint.tsx`）
- ✅ 接入 **Pinned default 不可执行**（chat/page.tsx 替代原 ErrorBanner；ChatView 新增）
- ✅ 接入 **Runtime 降级 / 无兼容模型**（runtimeFallback 本地推导 + `state.noCompatibleProvider`）
- ⚠️ 视觉统一**部分**完成：`RateLimitBanner` / `TerminalReasonChip` / 新 `RunCheckpoint` 已对齐到 `bg-status-*-muted` 同族 token；**`PermissionPrompt` 仍是 border-t + bg-background 的独立面板形态**——它跟工具执行链耦合，留给 **Round 3 危险工具调用收编**时一并处理（不在 Round 1 范围）
- ✅ 单测覆盖（10 用例）：覆盖 precedence、stacking、Round 1 scope guard

**不在 Round 1 内**：上下文成本变化、权限提升首次发送、危险工具调用拦截。

### Round 2 — ✅ 已完成 2026-04-30

**目标：上下文成本提醒 + 权限提升首次发送提醒，复用 Round 1 组件，引入"阻断 + 确认并发送" 流**

- ✅ 接入 **上下文成本明显变化**（`shouldTriggerContextCost`：pending ≥ 10K **或** used > 0 且 pending/used ≥ 30%）
- ✅ 接入 **权限提升首次发送**（permission profile 是 `full_access` 且本会话未确认过 → 触发；用户确认后本会话不再提示；切回 default 自动重置）
- ✅ 两类 checkpoint 均设置 `requiresConfirm: true`，MessageInput.handleSubmit 在 `blockingReasonIds.length > 0` 且未 bypass 时静默 early-return
- ✅ Banner 的"确认并发送"action：page-level handler 设置确认状态 → dispatch `run-checkpoint-confirm-send` 窗口事件 → MessageInput 监听后 `bypassBlockingRef.current = true` 并程序化点击 `button[aria-label="Submit"]`，让 PromptInput 完整 submit pipeline（text + 附件 + mentions）走原通道
- ✅ 两个入口（`chat/page.tsx` 新会话、`ChatView.tsx` 已有会话）一致接入
- ✅ 新增 13 个 i18n key（`runCheckpoint.{contextCost,permissionElevation}.{title,description,action}`）en + zh 同步
- ✅ Round 2 单测：
  - `unit/run-checkpoint.test.ts` +13 用例：`shouldTriggerContextCost` 阈值（hard cap / 30% 比例 / 边界）、context-cost reason 形状（tone=info、`requiresConfirm`、descriptionValues 格式化）、permission-elevation reason 形状、Round 1+2 stacking、no-provider precedence 仍生效
  - `unit/run-checkpoint-blocking.test.ts` 9 用例：阻断/bypass 状态机模型（user submit 被阻、confirm-and-send 即使 blockingIds 还在也通过、bypass 一次后自动清、permission 确认状态在 toggle 离开 full_access 时重置、context-cost 在 pending→0 后自动清）
- ✅ Round 1 scope guard 替换为 Round 1+2 scope guard，覆盖全部 5 个 reason id
- ⏸ Codex 已用内置浏览器人工验证；CDP 自动化验证留待 Round 3 一并补

### Round 3 — 前置设计（2026-04-30，已暂缓）

> **状态**：用户 2026-04-30 决定暂缓——见文档顶部 "Round 3 暂缓决定"。下面这份前置设计保留为未来重启时的基线参考，**不要按此立即开工**。

**前提：Round 2 稳定 ✅**（用户已确认 Round 2 收住）

#### 0. 现有确认入口盘点

把 chat 页所有"等用户确认 / 让用户感知"的入口分成两类：发送前 vs 执行中。Round 3 只动**执行中**的"工具调用确认"那一条，其它入口边界保持不动。

| 入口 | 何时出现 | 触发 | 视觉 / 状态 | Round 3 是否动 |
|---|---|---|---|---|
| **RunCheckpoint** banner | **发送前** | 配置异常 / 上下文超阈值 / 权限提升首次发送 | inline banner 在 composer 上方；`bg-status-*-muted`；`requiresConfirm` 阻断 send | ❌ 不动 |
| **RateLimitBanner** | **执行中**（SDK 抛 rate-limit 事件后） | `streamSnapshot.rateLimitInfo.status !== 'allowed'` | `bg-status-error-muted` / `bg-status-warning-muted` 同族 banner | ❌ 不动（已视觉对齐） |
| **TerminalReasonChip** | **执行后**（end-of-turn） | `streamSnapshot.terminalReason` ∈ `prompt_too_long` 等 | 同族 token chip + 操作按钮 | ❌ 不动（已视觉对齐） |
| **PermissionPrompt — 工具调用分支**（generic toolName ≠ AskUserQuestion / ExitPlanMode） | **执行中**，SDK 在 stream 里发 `permission_request` 事件 | `pendingPermission.toolName` 非 AskUserQuestion / ExitPlanMode | `border-t border-border bg-background max-h-[50vh]` 独立面板；展示 toolName + decisionReason + ToolInputDisplay（折叠 JSON）+ Deny / Allow Once / Allow For Session 三按钮 | ✅ **本期收编** |
| **PermissionPrompt — ExitPlanMode 分支** | **执行中** | `toolName === 'ExitPlanMode'` | "Plan complete — ready to execute" 大卡片 + View Plan / Approve / Reject + free-form feedback 输入；交互重 | ❌ 不动（独立产品语义，跟"危险确认"不是一回事） |
| **PermissionPrompt — AskUserQuestion 分支** | **执行中** | `toolName === 'AskUserQuestion'` | 多问题选择表单；本质是用户访谈，不是权限确认 | ❌ 不动 |
| **MessageInput.disabled gate** | **发送前** | `noCompatibleProvider` 等 | 隐式 disable 按钮 | ❌ 不动（Round 1 已说明） |

**关键观察**：用户口中的"危险工具调用"对应到代码里**只有** `PermissionPrompt` 的 generic 分支（line 475-524 `pendingPermission.toolName !== 'AskUserQuestion' && !== 'ExitPlanMode'`）。其它两个分支看起来在同一个组件里，但功能完全不同——一个是 Plan 模式收尾的产品步骤，一个是结构化用户问答；都不该被混到"危险确认"的视觉收编里。

#### 1. Round 3 最小范围

**只做**：generic 分支的**视觉收编 + 信息结构改写**，**不动** state machine。

具体收编动作：
- 把外层 chrome 从 `border-t border-border bg-background` 改成跟 `RunCheckpoint` / `RateLimitBanner` / `TerminalReasonChip` 同族 `bg-status-*-muted` + `rounded-lg border` 卡片
- 把内容结构改成"操作 + 影响 + 路径 + 决策按钮"四段式（详见下面 §2）
- 把按钮文案 / 图标 / 间距 / icon 跟 RunCheckpoint banner 对齐
- **权限响应相关 props 不变**（`pendingPermission`, `permissionResolved`, `onPermissionResponse`, `toolUses`, `permissionProfile` 全保留）
- **新增 `workingDirectory: string` prop**（项目路径行的稳定来源，由 ChatView/chat page 显式传入；详见 §2 项目路径行说明）
- 保留所有现有行为：`auto-approve` in `full_access`、`NEVER_AUTO_APPROVE` set、resolved 状态自动清除、三个决策值 (allow / allow_session / deny + denyMessage)

**不做（明确边界）**：
- ❌ 不改 `respondToPermission` 后端契约
- ❌ 不改 `permission_request` 事件格式
- ❌ 不改 `full_access` 自动批准的判定逻辑（NEVER_AUTO_APPROVE 集合 / autoApprovedRef 去重）
- ❌ 不改 `allow_session` 的 suggestions 应用规则
- ❌ 不改 `respondToPermission` 调用方式 + stream-session-manager
- ❌ 不动 ExitPlanMode 分支（独立产品概念，不在"危险确认"语义内）
- ❌ 不动 AskUserQuestion 分支（本质是用户访谈而非权限确认）
- ❌ 不引入新的"危险度评分"或"工具白名单/黑名单"——危险与否由 SDK 的 `permission_request` 事件决定，前端只负责 surface 信息
- ❌ 不做"用户记住的危险偏好"持久化（已经有 `allow_session` 覆盖此场景）
- ❌ 不做发送前的危险预判 banner（那需要 LLM 输出解析，超出 Round 3 视觉收编范围）

**触发条件不变**：banner 出现的时机仍然是"SDK 在 stream 里发 `permission_request` 事件"，跟现在一样。Round 3 不引入新的客户端预判触发。

#### 2. 用户语言（强约束）

**禁止使用的措辞**："危险工具"、"危险操作"、"高风险命令"、"敏感操作"。这类词把客户端往"风险评估"角色推，但客户端没有评估能力——评估在 SDK 端。

**统一标题**："需要你确认这次操作"（en: "Confirm this operation")。中性、事实性，不预判风险等级。

**信息结构（四段式）**：

```
┌─────────────────────────────────────────────┐
│ [icon] 需要你确认这次操作                       │
│                                             │
│ 操作: 运行命令 `rm -rf node_modules`         │  ← per-tool 渲染
│ 影响: 会删除当前目录下 node_modules           │  ← decisionReason / blockedPath
│ 项目: ~/Documents/my-project                │  ← workingDirectory basename + parent
│                                             │
│   [拒绝]  [仅允许这次]  [本会话允许]            │
└─────────────────────────────────────────────┘
```

按 toolName 渲染"操作"行：

| toolName | 操作行 | 影响行 |
|---|---|---|
| `Bash` | `运行命令 \`{command}\`` | `cwd: {cwd or 'project root'}` 加 `decisionReason` 如有 |
| `Edit` / `Write` | `修改文件 {basename(file_path)}` | `{file_path 相对项目的相对路径}` |
| `Read` (受限) | `读取文件 {basename(file_path)}` | 同上 |
| `WebFetch` | `访问 {hostname}` | `{decisionReason}` |
| 其它 | `调用工具 {toolName}` | `{decisionReason || '无更多信息'}` |

每行都"点名"——不是抽象概念。`pendingPermission.blockedPath`、`description`、`decisionReason` 都用上。

**项目路径行**：永远显示，从新增 prop `workingDirectory` 取，渲染成 `~/.../{lastTwoSegments}` 风格（防绝对路径泄漏过深的目录结构）。**注意**：当前 PermissionPrompt props 没有 workingDirectory，Step A 必须新增此 prop 并由两个调用点（`ChatView.tsx` 从 session.working_directory / `chat/page.tsx` 从当前 panel context）显式传入。从 `toolInput` 里临时猜路径不可接受——Bash cwd 可能为空、Edit/Write 的 file_path 可能是绝对路径，都不能稳定推出"项目根"。

**按钮文案**：
- "拒绝" / Deny
- "仅允许这次" / Allow Once
- "本会话允许" / Allow For Session（仅当 `pendingPermission.suggestions` 非空时显示，跟现状一致）

#### 3. 拆分 + 验收

**Step A：纯视觉壳替换**（首次提交）
- 拷贝 `PermissionPrompt` 的 generic 分支 JSX 到新的 inner component（暂叫 `ToolConfirmCard`）
- 外壳 className 换成 `mx-auto w-full max-w-3xl px-4 ...` + 内层 `rounded-lg border border-status-warning-muted bg-status-warning-muted text-status-warning-foreground p-4`
- 标题/描述/按钮区按四段式重排
- **权限响应相关 props 不变**（`pendingPermission`、`permissionResolved`、`onPermissionResponse`、`toolUses`、`permissionProfile` 全保留，行为零变化）
- **新增** `workingDirectory: string` prop（必填，由 ChatView/chat page 两个调用点显式传入），项目路径行依赖此值；不可从 toolInput 反推

**Step B：信息结构 per-tool 渲染**
- 加 `formatToolAction(toolName, toolInput)` 纯函数
- 加 `formatToolImpact(pendingPermission, workingDirectory)` 纯函数
- 加 `formatProjectPath(workingDirectory)` 纯函数
- ToolInputDisplay 的折叠 JSON 降级为"展开看完整参数"次级 reveal（默认收起，避免吓人）
- 单测覆盖 `formatToolAction` / `formatToolImpact` / `formatProjectPath` 各 toolName 分支

**Step C：i18n 切换**
- en/zh 各加 `permissionPrompt.toolConfirm.{title, action.{bash,edit,write,read,webfetch,generic}, impact.{withReason, noReason}, projectLabel, allowOnce, allowSession, deny, expandInput}` 大概 14 条 key
- 不删旧 i18n key（避免破坏 ExitPlanMode / AskUserQuestion 分支）

**Step D：a11y + e2e**
- 新外壳是 `role="alert"` + `aria-live="assertive"`（inline card，**不是** modal；不抢焦点、不强制弹窗语义）。**为什么不用 `alertdialog`**：alertdialog 隐含 modal 对话框语义，要求焦点转移 + aria-modal + 焦点陷阱；本期不引入任何这些行为，所以 alert + aria-live 才是诚实的语义匹配。
- 三个按钮加明确 aria-label（含 toolName，比如 `aria-label="拒绝运行命令 rm"`）
- 标题 + 操作行使用 `<strong>` 或 `aria-describedby` 链接，确保读屏播报顺序合理
- e2e fixture A（无 suggestions）：mock `permission_request` 事件且 `suggestions: []` → 断言 banner 渲染 + toolName 出现在标题 + 拒绝/仅允许这次两按钮可点击 + 本会话允许按钮**不渲染** + 点击 deny 触发 `onPermissionResponse({ behavior: 'deny', ... })`
- e2e fixture B（有 suggestions）：mock `permission_request` 事件且 `suggestions: [{...}]` → 断言三按钮全部渲染 + 点击"本会话允许"触发 `onPermissionResponse({ behavior: 'allow_session', updatedInput: ..., updatedPermissions: [...] })`

**验收标准**：
- generic 分支视觉跟 RunCheckpoint / RateLimitBanner 一族
- ExitPlanMode 分支与 AskUserQuestion 分支视觉**不变**（本期不动）
- 文案不出现"危险"/"敏感"等评判词
- 文案点名: 操作 + 影响 + 项目路径都可见
- `permissionProfile === 'full_access'` 下行为完全不变（auto-approve、NEVER_AUTO_APPROVE 仍生效）
- `npm run test` 通过；新增 `formatTool*` 单测覆盖至少 5 类 toolName
- e2e 覆盖两个 fixture：（A）无 suggestions → deny + allow-once 两按钮各触发一次；（B）有 suggestions → 三按钮全渲染 + allow-session 触发一次。**不要**为了凑齐"三按钮各触发一次"在无 suggestions fixture 里强行注入 suggestion——那会污染契约

#### 4. 风险 + 回滚

**最大风险**：改动跟工具执行链耦合的组件，万一改坏导致"按钮看着点了但 onPermissionResponse 没真触发"，agent 会卡在 pending 状态。

**缓解**：
- Step A 是视觉壳 + 新增 `workingDirectory` 必填 prop；除此之外权限响应相关 props 与行为零变化。两个调用点（ChatView / chat page）的 prop 接入跟 Step A 同 PR，避免半成品状态
- Step B-D 逐步加纯函数 + i18n + e2e，每一步可独立回滚
- e2e 双 fixture 都必须真实断言对应 callback fire（fixture A 断 deny + allow-once；fixture B 断 allow-session），不能只看 UI 渲染

**回滚路径**：每个 Step 都是单独 commit；如果 Step C 文案改坏可单独 revert，UI 壳不动；Step A 改坏可整个分支 revert，PermissionPrompt 完全恢复 Round 2 状态。

#### 5. 不在 Round 3 范围（明确推迟）

- 把 PermissionPrompt 的 ExitPlanMode 分支也视觉对齐（独立任务，独立产品语义）
- AskUserQuestion 分支的视觉重设（独立任务，跟"权限确认"无关）
- 客户端解析 LLM 输出做"危险预判 banner"（超出本计划范围；如果做也不该叫 Run Checkpoint）
- 把 `allow_session` 升级成跨 session 持久化（产品决策，超出范围）
- 给用户加"全局自动允许"开关（明确禁止——违背设计原则 §B "保护用户的硬性规则不能被关掉"）

### 为什么这样切

Round 1 选 Pinned invalid 和 Runtime 降级有三个理由：
1. 数据信号已存在（不需要新逻辑），代码风险低
2. 用户场景频度高（每次刷新切到不可用模型都会触发），覆盖面广
3. 已经有零散的 UI 提示，能直接对比"统一前 vs 统一后"的效果

危险工具调用放最后是因为它**触及工具执行链的状态机**——一旦做错可能让 Agent 行为不一致（确认通过了但仍被拦/确认失败但仍执行）。等前两轮证明了组件抽象 + state gate 模型稳定，再动这块。

## 概述

Chat 页现在能解释「这次会用什么 Runtime / Model / 权限 / 上下文」（Run 状态面板 + Context chips），但**还没解决"用户发送瞬间到 Agent 实际开始执行之间的信任空隙"**。

具体的信任问题：

- 用户加了一堆文件后突然发送 → Agent 默默多花 100K tokens，用户不知道
- 用户切到「完全访问」权限 → Agent 可以无确认动文件，用户没看到提醒
- 用户发了一个会触发外部命令的 prompt → Agent 跑了 `rm` 才反应过来
- 系统 Runtime 自动降级 → 用户以为还在 Claude Code 跑

这些都是**该提示但没提示**的瞬间。Run Checkpoint 是 **inline 出现在输入框和发送之间的轻量信任层**，只在以下场景出现，否则**完全不打扰**。

## 设计原则（强约束）

呼应 insights 里 Chat 页的 5 条原则，本 Phase 增加 3 条具体边界：

### A. 默认不打扰

正常发送（普通文本 / 已确认过的 chip / 已稳定的运行环境）→ Run Checkpoint **不渲染任何 UI**。用户体验跟现在没区别。

### B. 不做成步骤流

不要做"发送前必须点 N 次确认"的 wizard / stepper。Checkpoint 是**单点警告 + 单击确认**：要么用户当下知情后继续发送，要么用户取消回到输入框。**永远不引入"下一步"按钮**。

### C. Agent / MCP 不常驻 toggle

Checkpoint 不做"启用 MCP"、"启用 Agent" 之类常驻开关。**只在系统准备调用时才展示**——比如 LLM 在响应中决定要调 MCP 工具，那时候 Checkpoint 才出来问"允许调用 X 工具吗"。这跟现在的 PermissionPrompt 是同一个机制，统一进 Checkpoint 框架。

## 触发场景（5 类）

| 触发 | 信号 | UI 形态 |
|---|---|---|
| 上下文成本明显变化 | pending tokens 占当前已用的 ≥30%，或绝对值 ≥10K | inline banner 在输入框上方，"本次会增加 ~XK 上下文，确认发送？" + 取消 + 发送 |
| 权限提升 | 当前 session 是「完全访问」 | 发送前 inline banner（首次或久未送过）"完全访问已开启，Agent 可无确认动文件" + 关闭 + 发送 |
| 危险命令意图识别 | LLM 响应里 tool_use 包含 `rm` / `sudo` / 写系统目录 / 网络外发 | 复用 PermissionPrompt 的 in-context 卡片通道（Round 3 收编时再视觉对齐） |
| Runtime 降级 | `runtimeFallback === true` 第一次发送时 | inline banner "你设置的 Claude Code SDK 不可用，已降级到 Native，确认这样继续？" + 跳设置 + 发送 |
| Pinned default 不可执行 | `state.defaultInvalid === true` 但用户绕过了 banner 试图发送 | 阻断发送 + chip 形式提示（已有 PermissionPrompt + chat banner） |

**注意（已被 Round 1 实现修订）**：原计划设想"不新建组件，把零散提示视觉收敛"，但实施时发现发送前 inline banner 跟工具执行中的 in-context 确认是两个使用场景，没办法塞进同一个组件。**Round 1 实际做法**：新建统一组件 `RunCheckpoint` 承接发送前 checkpoint（pinned-invalid / runtime-fallback / no-provider），并把 `RateLimitBanner` / `TerminalReasonChip` 视觉对齐到同一族 `bg-status-*-muted` token；`PermissionPrompt`（执行中工具确认）保留原 in-context 卡片形态，留给 **Round 3 危险工具调用**收编时一并处理。用户依然能从视觉一致性（status token 同族）认出"这是 Agent 在等我确认"，只是不强求在同一个 React 组件里。

## 不在范围内（明确不做）

- ❌ 步骤流 / wizard：每条 prompt 都不应该"过 5 步审批"
- ❌ 常驻 toggle：不加任何"启用风险检查 / 跳过 Checkpoint" 的 settings 项（用户改不动它的核心规则）
- ❌ 历史 / 分析 / 报表：Run Checkpoint 是**当下**的信任层，不做日志展示（→ 留给 Run Cockpit 实时态升级）
- ❌ 自动审批 / 批量确认：永远不让用户在 modal 里勾"以后不再问"——危险操作的提示就是设计意图
- ❌ 文案/视觉的过度差异化：5 类 Checkpoint 都用同一个 inline banner 形态，靠图标 + 文字色区分严重度

## 轨道拆分（待开工后细化）

### Track 1: 抽象 trust layer

- 新建 `src/lib/run-checkpoint.ts`：定义 `CheckpointReason` union + `buildCheckpoints(state)` 推导
- 新建 `src/components/chat/RunCheckpoint.tsx`：单一组件，接收 reason[] 数组渲染 inline banners
- 把 `RateLimitBanner` / `TerminalReasonChip` / chat-page invalid-default banner 统一进这个组件 OR 让它们共用同一个 reason → banner 映射

### Track 2: 5 类触发的接入

- 上下文成本变化：MessageInput 在 onSubmit 前检查 `pendingContextTokens / used >= 0.3`，若是触发 Checkpoint 阻断
- 权限提升：每个 session 第一次发送时（或权限切换后第一次）触发；用 `sessionStorage` 记"已确认过"
- Runtime 降级：复用 RunCockpit 的 `runtimeFallback` 信号
- Pinned invalid：复用现有 banner 但视觉统一进 RunCheckpoint
- 危险工具调用：等 PermissionPrompt 触发时复用同视觉

### Track 3: 视觉规范

- 严重度三色对应 design.md `status-pair`：warning（黄）/ error（红）/ info（蓝）
- 每个 banner 只有两个动作：取消（次级）+ 继续发送 / 修复（主操作）
- 图标统一：⚠ Warning / 🔒 Lock / ⚡ Lightning / 💸 Coins (新增) / 🛑 Stop

### Track 4: 文档 + memory 沉淀

- handover/chat-run-checkpoint.md：技术契约（trust layer API、5 类触发的 signal/condition、状态机）
- insights/chat-run-checkpoint.md：为什么是 inline banner 而不是 modal、为什么不做步骤流、跟 Permission v2 的关系
- 新建 memory feedback：trust 不靠 toggle 靠场景

### Track 5: CDP + e2e 验证

- 5 类触发场景各做一组 fixture 测试：构造对应 state → checkpoint 应该出现 → 取消 → 不发送 → 确认 → 发送
- 反向：正常发送（无任何 checkpoint）应该不出现任何 UI

## 数据流要点（实现时关注）

- **Checkpoint 信号是 pull 不是 push**：MessageInput 在 onSubmit 前**主动调用** `buildCheckpoints(state)` 拿到当前应该出现的 reasons。不要做成"事件驱动"否则会跟 streaming 状态打架
- **Checkpoint 是同步阻断**：用户没确认前发送链路不进入 doStartStream。这跟现在的 invalid-default 阻断是同一种 gate，应该共用
- **状态分离**：Checkpoint 自己不持久化"已确认"——危险操作每次都问，权限/Runtime 之类的"已知悉"放 sessionStorage（关闭 chat 就重置）

## 决策日志（写在前面，避免实现时反复问）

### 为什么不做成 Modal？

Modal 打断流。用户输完正想 Enter 发送，结果一个 modal 弹出来要点确认，再点取消还得回到输入框继续编辑——这是糟糕的中断模式。inline banner 在输入框上方，用户可以**继续看着自己的输入**做决定，按 Enter 等于"继续发送"，按 Esc 等于"取消"。

### 为什么不做成"settings 里可关掉的提示"？

这是个原则问题：Checkpoint 是**对用户的保护**，不是"功能"。用户不应该有"关掉它"的入口——否则它就退化成 toggle，违背 Chat 页设计原则 #3（AI 能调度的东西不要常驻按钮化，反过来：保护用户的硬性规则不要被用户关掉）。如果将来真的有用户场景需要绕过，应该提升优化触发条件而不是给个"关闭"按钮。

### 为什么 5 类共用同一套视觉 token，但不强求同一个 React 组件？

视觉一致 = 用户认知一致。如果 Runtime fallback 长一个样、权限提升长另一个样、上下文成本提升长第三个样——用户每次都要重新理解。

但"视觉一致"不等于"同一个 React 组件"。Round 1 落地时把发送前 inline banner 抽成 `RunCheckpoint`（pinned-invalid / runtime-fallback / no-provider），并让 `RateLimitBanner` / `TerminalReasonChip` 对齐到同一族 `bg-status-*-muted` token；执行中的工具确认（`PermissionPrompt`）保留 in-context 卡片形态，留给 Round 3 危险工具调用一起收编。这样：
- 同一族 status token 让用户一眼认出"这是信任层在等我确认一件事"
- 不同的 React 组件分别承接发送前（banner 不打断输入流）和执行中（卡片嵌在消息流里跟工具调用同位）两种使用场景

## 反向引用

- 上一阶段：[../completed/context-chips-phase-1.md](../completed/context-chips-phase-1.md)（Phase 完成后归档）
- 设计原则：[../../insights/chat-composer-redesign.md](../../insights/chat-composer-redesign.md) 的 "Chat 页设计原则" 节
- Trust 层组件现状（Round 1 已落地）：
  - `src/components/chat/RunCheckpoint.tsx` — Round 1 新建的发送前 inline banner（pinned-invalid / runtime-fallback / no-provider）
  - `src/components/chat/RateLimitBanner.tsx` — 视觉已对齐 `bg-status-*-muted` token，独立组件保留（订阅 SDK rate-limit 事件，跟 RunCheckpoint 不同生命周期）
  - `src/components/chat/TerminalReasonChip.tsx` — 视觉已对齐，独立组件保留（end-of-turn 状态，依赖 streamSnapshot.terminalReason）
  - `src/components/chat/PermissionPrompt.tsx` — **未对齐**，仍是 border-t + bg-background 独立面板；执行中工具确认场景，留给 Round 3 危险工具调用收编
- 相关 memory：`feedback_pinned_default_hard_promise.md` (Pinned invalid 必须阻断)、`feedback_no_silent_auto_irreversible.md` (无 silent auto 操作)
