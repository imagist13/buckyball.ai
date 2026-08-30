# Runtime auto 简化 + 错误归一 + 入口拦截

> 创建时间：2026-04-15
> 最后更新：2026-04-15
> 关联 Issue：#490 #493 #478 #476 #461；Sentry NEXT-2Z、NEXT-PA
> 问题跟踪主档：[issue-tracker.md](../active/issue-tracker.md)

---

## 背景

v0.50.2 发布后 2.5 小时内，Sentry 线上监测发现两件事：
1. `NEXT-2Z` `Error: No provider credentials available` 仍在发生——v0.50.2 带的 cc-switch 凭据桥接修复（`claude-home-shadow.ts` shadow HOME 机制）只救了一部分用户，仍有残留路径
2. `NEXT-PA` `ReferenceError: defaultExpanded is not defined` 是 0.50.2 新引入的 FileTree 组件渲染崩溃

用户反馈"v0.46 能用、v0.50.2 不能用"的原因定位到了 **v0.48.0 引入的 Native Agent Runtime + auto 模式决策逻辑**。当前方案是简化 auto 语义、入口拦截未配置用户、错误消息归一翻译。

---

## 三层事实

按 research doc 三层纪律（外部事实 / 仓库事实 file:line / 推断）分开，方便事实核查。

### § 一、外部事实（Sentry / GitHub / cc-switch 源码，时间戳固定）

**Sentry 数据（2026-04-15 20:57 +0800，v0.50.2 发布后 ~2.5h 快照）**

| bucket | 24h 总量 | v0.50.2 | 最后时间 (UTC) | 抛错位置 |
|---|---:|---:|---|---|
| NEXT-2Z `No provider credentials available` | 1742x | 9x | 12:58 | `src_lib_12qve44._.js:91 Object.start` → `agent-loop._0c.i5hl._.js:50` |
| NEXT-PA `defaultExpanded is not defined` | 1x | 1x（仅出现在 0.50.2）| 12:55 | `CodePilot_08eujv0._.js:405 FileTree` |

v0.50.2 release 已知活跃 issue 快照：2Z=9, 2X=2, 2Y=2, PA=1。2X/2Y 是 Native runtime 的 AI_NoOutputGeneratedError / Codex timeout，与本次方案间接相关。

**GitHub Issue 快照**
- `#493`（2026-04-15 11:22 UTC，发版后 50 分钟）：Doctor JSON 自相矛盾——同时报 `auth.no-credentials` 和 `auth.resolved-ok`；Live probe 报 `PROCESS_CRASH`；用户 provider 数 = 0，纯 env 模式
- `#490`（2026-04-15 10:36 UTC）：Windows 11 + cc-switch。UI 已识别 `ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN`，但对话报 `Not logged in · Please run /login`
- `#478 / #476 / #461`：上游同类症状（cc-switch + 第三方 provider 报错）

**cc-switch 源码（`/tmp/cc-switch-src`，commit 2025-12-05 之后）**
- `src-tauri/src/services/proxy.rs:22` `const PROXY_TOKEN_PLACEHOLDER: &str = "PROXY_MANAGED"`
- `src-tauri/src/services/proxy.rs:103` 代理模式写入 `"ANTHROPIC_BASE_URL": json!(proxy_url)`（proxy_url 形如 `http://localhost:<port>`）
- `src-tauri/src/services/proxy.rs:117-128` token 字段被替换为字符串 `"PROXY_MANAGED"`
- 代理功能引入 commit：`Feat/proxy server (#355)`，日期 2025-12-05 11:26:41 +0800

**CodePilot 版本时间线**
- v0.46.0 tag：2026-04-04（commit `89d3e97 feat: Ollama local model support...`）
- v0.47.0 tag：2026-04-05（commit `ce9c1a3 chore: release v0.47.0 — provider governance`）
- v0.48.0 tag：2026-04-09（commit `15ba536 chore: release v0.48.0 — Native Agent Runtime + OpenAI support`）
- v0.50.2 tag：2026-04-15（commit `dc5a6c5 chore: release v0.50.2 — stability & credential isolation`）

### § 二、仓库事实（file:line，当前 HEAD）

**Runtime 选择机制（v0.48.0 引入）**
- `src/lib/runtime/registry.ts:51-94` `hasCredentialsForRequest(providerId?)` 做凭据判定，综合 `process.env.ANTHROPIC_*` / `getSetting('anthropic_auth_token')` / DB provider / `hasClaudeSettingsCredentials()`
- `src/lib/runtime/registry.ts:105-145` `resolveRuntime()`——第 128-135 行是 auto 分支：`if (sdk?.isAvailable() && hasCredentialsForRequest(providerId)) return sdk` 否则回落 native
- `src/lib/runtime/registry.ts:155-176` `predictNativeRuntime()` 同样逻辑
- `src/lib/claude-settings.ts:35-68` `readClaudeSettingsCredentials()` 读 `~/.claude/settings.json` env 块，`pick()` 判定"非空字符串即有效"
- `src/lib/claude-settings.ts:77-80` `hasClaudeSettingsCredentials()` = `!!(creds?.apiKey || creds?.authToken)`
- `src/lib/claude-home-shadow.ts:234-319` `createShadowClaudeHome({ stripAuth })`——DB provider 模式剥离 ANTHROPIC_* env keys
- `src/lib/sdk-subprocess-env.ts:50-81` `prepareSdkSubprocessEnv(resolved)`——`createShadowClaudeHome({ stripAuth: !!resolved.provider })`（env 模式 passthrough）
- `src/lib/ai-provider.ts:57-117` `createModel(opts)`——Native runtime 入口
- `src/lib/ai-provider.ts:65-78` 抛 `No provider credentials available`（NEXT-2Z 源头）；第 70-73 行优先抛 cc-switch-specific 提示

**v0.46.0 历史状态（`git show v0.46.0`）**
- `src/lib/claude-client.ts` 1560 行（当前 1844 行）
- 仓库**不存在** `src/lib/runtime/` 目录（`git show v0.46.0 --name-only -- src/lib/runtime/` 返回空）
- `src/lib/provider-resolver.ts:247-253`（v0.46）`case 'api_key'` 同时设置 `ANTHROPIC_AUTH_TOKEN` 和 `ANTHROPIC_API_KEY`；当前（HEAD）`src/lib/provider-resolver.ts:247-253` 只设 `ANTHROPIC_API_KEY`

**错误分类系统**
- `src/lib/error-classifier.ts:57-90` 22 种 `ClaudeErrorCategory` 定义
- `src/lib/error-classifier.ts:176-181` `NO_CREDENTIALS` patterns: `['no api key', 'missing api key', 'ANTHROPIC_API_KEY is not set', 'api key required', 'missing credentials']`
- `src/lib/error-classifier.ts:185-190` `AUTH_REJECTED` patterns: `['401', 'Unauthorized', 'invalid_api_key', ...]`
- `src/lib/error-classifier.ts:417-423` `buildRecoveryActions()` 对 `NO_CREDENTIALS / AUTH_REJECTED / AUTH_FORBIDDEN / AUTH_STYLE_MISMATCH` 自动 push `{ label: 'Open Settings', action: 'open_settings' }`

**SetupCenter / WelcomeCard（已存在，无需新建）**
- `src/components/setup/SetupCenter.tsx:17` `SetupCenter({ onClose, initialCard })`, `initialCard?: 'claude' | 'provider' | 'project'`
- `src/components/setup/WelcomeCard.tsx:5-16` 完整的 `WelcomeCard`
- `src/components/setup/SetupCenter.tsx:109-120` 渲染 `WelcomeCard` + `ClaudeCodeCard` + `ProviderCard`（`+ ProjectDirCard`）
- `src/app/api/setup/route.ts:5-60` `GET /api/setup` 返回 `{ claude, provider, project, completed, defaultProject }`，provider 判定：DB 有记录 / env vars / legacy setting / CLI 存在均记为 `completed`
- `src/components/layout/AppShell.tsx:77-78` `setupOpen` / `setupInitialCard` state
- `src/components/layout/AppShell.tsx:83-93` 首次 mount `fetch('/api/setup')` → `!data.completed` 自动弹出
- `src/components/layout/AppShell.tsx:95-103` 监听 `window` 事件 `open-setup-center`，`detail.initialCard` 可控目标卡片
- `src/components/layout/AppShell.tsx:466-471` `{setupOpen && <SetupCenter ... />}`

**Chat 入口**
- `src/app/api/chat/route.ts:24-48` POST 入口——当前**没有** provider 存在性 pre-check，直接走 session 检查 → lock → streamClaude

**错误渲染（前端 SSE 消费端）**
- `src/hooks/useSSEStream.ts:249-263` 把 SSE error 中 `recoveryActions` 数组渲染为 markdown 链接
- `src/hooks/useSSEStream.ts:254-255` `action: 'open_settings'` 当前渲染为 `[label](/settings#providers)` 超链接（**未**触发 SetupCenter 弹窗事件）

**FileTree 回归（NEXT-PA）**
- `src/components/ai-elements/file-tree.tsx:53-64` 组件签名：`defaultExpanded = new Set()`（第 55 行，解构默认值 + 构造函数调用）
- `src/components/ai-elements/file-tree.tsx:64` `useState(defaultExpanded)` 是 `defaultExpanded` 唯一消费点
- `src/components/layout/AppShell.tsx:57` `const EMPTY_SET = new Set<string>();`——同仓"正确写法"范例
- 全仓唯一的"解构默认值里 `new Set(...)`"模式：仅此一处（`grep "=\s*new\s+Set" src/components/**/*.{ts,tsx}` 全扫确认）
- `package.json` Next.js 16.2.1 + React 19.2.3（Turbopack 启用，`npm run dev` / `npm run build` 默认）

### § 三、推断（明确标注，区分于前两类）

> 以下为基于 § 一、§ 二 的推断，非直接观测。

**推断 1：Native runtime 是 NEXT-2Z 主路径（置信度高）**
- 证据：抛错文件 `ai-provider.ts:76`（§ 二仓库事实），该文件只在 Native 路径被 import（SDK 路径用 `@anthropic-ai/claude-agent-sdk` 的 `query()`，不经过 createModel）
- 推断：auto 模式在 cc-switch 用户 / 全新用户场景下**错选 Native**，Native 没有读 `~/.claude/settings.json` 的能力，遇到"DB 无 provider + env 无 ANTHROPIC_* + 用户未登录 CodePilot 但已装 cc-switch"时抛错

**推断 2：PROXY_MANAGED 占位符被当真凭据（置信度高）**
- 证据：`claude-settings.ts:50-57` `pick()` 只要非空字符串即返回；`hasClaudeSettingsCredentials()` 仅判 `!!(apiKey || authToken)`——二者串起来意味着字面字符串 `"PROXY_MANAGED"` 会通过
- 推断：cc-switch 代理模式用户 → `hasClaudeSettingsCredentials() = true` → auto 选 SDK runtime → CLI subprocess 收到 `ANTHROPIC_BASE_URL=http://localhost:<port>` → 如果 cc-switch 代理未运行 / 端口不匹配 → CLI 自己抛 `Not logged in · Please run /login`，即 #490 观测到的现象
- 未直接验证：**没有**在 #490 用户环境重现；没有问过用户 "cc-switch 代理是否开启、对应端口是什么"

**推断 3：NEXT-PA 是 Turbopack 对"解构默认值 + 构造函数"模式的编译 bug（置信度中）**
- 证据：源码语法正确（§ 二 `file-tree.tsx:53-64`）；错误仅在 0.50.2 生产 bundle 出现；全仓唯一一处该模式；同仓模块顶层常量写法 `AppShell.tsx:57` 从未报错
- 未直接验证：没有反编译 0.50.2 的 `CodePilot_08eujv0._.js:405` bundle，没有定位到 Turbopack 具体版本的已知 bug
- 风险：可能根因其实在 React 19.2.3 的某个 hook 规则变化或 next/standalone 打包流程，修法（改成模块顶层 const）对这三种都有效，因此即使推断不精确修法也成立

**推断 4：v0.47.0 → v0.50.2 的其他改动（如 `toClaudeCodeEnv` 去掉 `ANTHROPIC_AUTH_TOKEN` 的 `api_key` 分支）不是 cc-switch 回归主因（置信度中）**
- 证据：该改动（§ 二 `provider-resolver.ts:247-253` vs v0.46）只在 `resolved.provider && resolved.hasCredentials` 分支生效（DB provider 有凭据时）；cc-switch 纯 env-mode 用户走的是 `!resolved.provider` 分支（`provider-resolver.ts:307-313`），不受影响
- 推断：cc-switch env-mode 用户在 v0.46 能用 / v0.50.2 不能用的回归点**唯一**定位到 v0.48.0 引入 Native runtime + auto 决策

---

## #493 的真实情况（明确声明，避免误导）

#493 不是单一问题，是**两个独立问题**碰巧出现在同一份 Doctor 报告里。方案 A-D 都**不修**这两个问题——它们被列入"关联 Issue"仅仅是因为这份 Doctor JSON 是触发本次调研的信号之一。

### 问题一：Doctor JSON 自相矛盾（UX / 诊断可信度问题）

**现象**：同一个 `auth` probe 里，用户看到两条互相矛盾的 finding——
- `error` `auth.no-credentials`：No API credentials found
- `ok` `auth.resolved-ok`：Resolved provider has usable credentials

**成因**：`src/lib/provider-doctor.ts` 的 `runAuthProbe()` 函数内，两条 finding 各自使用**不同的判定源**：
- 第一条只看 `process.env.ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` 和 `getSetting('anthropic_auth_token')`——**不看** `~/.claude/settings.json`
- 第二条走 `resolveProvider()` 的 `hasCredentials`，会读 settings.json

两条判定都对各自的源负责，但拼在同一个面板里给用户的是"系统自己跟自己打架"。

**影响面**：所有 cc-switch / 手动编辑 settings.json 的用户打开 Doctor 都会看到这个矛盾。但只有在出问题主动查 Doctor 时才会发现，所以真正的伤害是"用户反馈 bug 时发来的 Doctor JSON 让维护者也看不懂真实凭据状态"。

**方案 A-D 对此的影响**：**零**。Doctor 代码没被 A-D 触及。

### 问题二：CLI spawn 后 PROCESS_CRASH（真实工作故障）

**现象**：Doctor Live probe 跑真实 spawn 时，CLI 子进程 exit code 1，归类为 `PROCESS_CRASH`。用户实际发消息也发不出。

**成因（未在 #493 用户环境重现，以下为推断）**：
- 用户 `~/.claude/settings.json` 有 env 块（cc-switch 写入），CodePilot DB 里 0 个 provider
- auto 模式认为有凭据 → 选 SDK runtime → spawn CLI
- CLI 启动后根据 settings.json 的 env 尝试访问上游。上游连不通的候选：
  1. cc-switch 代理模式但代理未运行（`ANTHROPIC_BASE_URL=http://localhost:<port>` 连拒绝）
  2. cc-switch 代理模式下 token 是字面量 `"PROXY_MANAGED"`，第三方中转 401/403
  3. token 合法但已失效 / 被撤销
  4. 新版 CLI 对 settings.json 某些字段格式更严
- 定位到 1/2/3/4 哪个需要问 #493 用户 "cc-switch 是否开启代理模式 / 代理当前状态如何"——#493 JSON 里无此信息

**触发条件（三者必须同时成立）**：
1. 使用过 cc-switch 或手动写过 `~/.claude/settings.json` 的 env 块
2. **没有**在 CodePilot 里添加任何 DB provider
3. cc-switch 当前状态使 CLI 实际连不通上游

**影响面（无法精确量化）**：
- Sentry bucket `Claude Code process exited with code 1` 长期 6000+ events/24h，但该 bucket 里混杂多种 crash 原因（CLI 版本冲突、网络超时、权限、cc-switch 类、非 cc-switch 类等）。**Sentry 目前未对该细分场景打 tag**（例如 `user.has_cc_switch_settings=true`），因此 #493 同类用户在 bucket 中的占比拆不出来
- GitHub Issue 里近 7 天明确同类症状：#493 / #490 / #478 / #476 / #461，共 5 条
- 推断真实量级：**几百到几千**（GitHub issue 按约 1% 主动反馈率反推），但不是所有 cc-switch 用户都中招，只有"cc-switch 当前状态不可用"子集

**方案 A-D 对此的影响**：
- 方案 A：无改善——用户装了 CLI 就走 SDK，本来就是 SDK 路径崩的
- 方案 B：**会**触发（注意：之前文档旧版写的"不触发"是**错的**，与 Phase B 自己的 `hasCodePilotProvider()` 契约矛盾——Codex 核查结论 2026-04-15 指出并修正）。Phase B 契约明确规定 `hasCodePilotProvider()` **不**读 `~/.claude/settings.json`，只看 DB provider / process.env ANTHROPIC_\* / legacy `anthropic_auth_token` setting。纯 cc-switch 用户这三者都为空 → 会被入口拦截 → 弹 SetupCenter Provider 卡片。
  - 对 cc-switch **正在挂掉**的用户（#493 问题二场景）：拦截引导他们"去 CodePilot 里加个 provider"——从**结果上恰好**绕开了 cc-switch 故障（只要他们按引导加了一个 DB provider，后续走 DB provider 路径就不再碰 cc-switch 代理了）。这是副作用不是有意识别，诊断意义为零但体验结果是正向的
  - 对 cc-switch **正常工作**的用户：也会被拦截一次（这是 by design——符合用户"CLI 登录状态不管，只看 CodePilot provider"的明确约定），需要他们在 CodePilot 里显式加一个 provider。**这是 Phase B 的主要行为变化之一**，发版说明里要**明确告知**现有 cc-switch 用户
- 方案 C：即便 Phase B 没拦住（例如用户已加 DB provider 但那个 provider 走 cc-switch 代理），SDK spawn 后仍会 `PROCESS_CRASH`。方案 C 能把此 crash 归一为"去设置 → 服务商"——但**这个引导对 cc-switch 代理挂掉的用户仍是错的答案**：他在 CodePilot 里有 provider，他缺的是"cc-switch 代理没跑"或"token 失效"这类信息

### 方案之外：根治 #493 需要额外工作（未纳入 0.50.3）

若要真正修问题二，最小工作量：
1. `claude-settings.ts` 读到 `ANTHROPIC_BASE_URL` 指向 `localhost`/`127.0.0.1` **或** token 字面量等于 `PROXY_MANAGED` 时，打 tag 到错误上下文
2. `error-classifier.ts` 新增分类 `CC_SWITCH_PROXY_UNREACHABLE`，pattern 识别 CLI `code 1` + 上述 tag，文案改成"检测到 cc-switch 代理模式，请确认 cc-switch App 正在运行且代理端口与 settings.json 匹配"——**不**引导去 CodePilot 设置

若要修问题一，最小工作量：
- `provider-doctor.ts:runAuthProbe()` 内两条 finding 改为**同一条路径判定**，并把 `~/.claude/settings.json` 合并进 `auth.no-credentials` 的判定源。约 20 行

**以上两条均未纳入本计划**。0.50.3 先把 A-D 做完，观察 Sentry 和 issue 反馈，再决定是否开 0.50.4 单独处理 #493。

---

## 方案

四块并列。每块独立可发，但建议 A + B + C 打包成 0.50.3，D 已经就绪不需要额外动（仅需确认路由）。

### A. Runtime auto 简化（改判定语义）

**现状**：`src/lib/runtime/registry.ts:128-135` / `:155-176` 的 auto 分支根据"有没有任何凭据"决策。

**目标**：改成"装了 CLI 就走 CLI，没装就走 Native"的 binary check。彻底移除 `hasCredentialsForRequest()` 对凭据的依赖。

**改动点**：

1. `src/lib/runtime/registry.ts:128-135`（`resolveRuntime` 的 auto 分支）
   ```ts
   // 改成
   const sdk = getRuntime('claude-code-sdk');
   if (sdk?.isAvailable()) return sdk;
   const native = getRuntime('native');
   if (native?.isAvailable()) return native;
   if (native) return native; // last-resort 语义保留
   ```

2. `src/lib/runtime/registry.ts:155-176`（`predictNativeRuntime`）同步简化：auto 分支只看 `sdk.isAvailable()`。

3. `src/lib/runtime/registry.ts:51-94` `hasCredentialsForRequest()` 不再被 auto 路径调用。
   - **[Codex 核查结论 2026-04-15]**：该函数在运行时代码里的唯一引用点就是 `registry.ts` 模块自己（第 51 行定义、第 135 / 173 行被 auto 分支调用），其他全部是测试文件。不存在 `provider-doctor.ts` / `claude-client.ts` / `sdk-subprocess-env.ts` 的外部依赖——方案 A 从 auto 分支摘掉它就是**死代码**，可以直接删掉或保留给未来用（倾向删，减少维护面）。

4. `src/lib/claude-settings.ts` 不再被 runtime 决策依赖；但保留给 Doctor 做诊断提示用。

**回归风险**：
- "装了 CLI 但用户从未在 CLI 里登录过"的用户：新 auto 会选 SDK → CLI 自己抛"未登录"。此错误消息会被方案 C 拦截并翻译为"请去配置服务商"（用户心智对齐）
- 显式设置了 `agent_runtime=native` / `=claude-code-sdk` 的用户：完全不受影响（auto 之外的分支不变）
- `openai-oauth` provider：`predictNativeRuntime:157` 硬编码强制 native，不受影响

**验证**：
- 单测：`src/__tests__/unit/provider-resolver.test.ts` + 新增 `runtime-auto.test.ts` 覆盖"装了 CLI 无凭据"/"装了 CLI 有 cc-switch"/"没装 CLI"三场景
- 手动：本地 `findClaudeBinary=null` 时发消息应走 Native；`findClaudeBinary=/path` 时走 SDK

### B. Chat 入口拦截（用户未配置 provider 时不让请求下行）

**现状**：`src/app/api/chat/route.ts:24-48` 直接进入 session/lock 流程，缺失凭据错误要等到 streamClaude 内部才冒出来。

**用户约定的判定口径**（2026-04-15 对话定案）：
- **只看"CodePilot 是否有可用服务商"**，不看 CLI 登录状态
- 判定条件：DB 有 provider 记录 OR `process.env.ANTHROPIC_API_KEY` OR `process.env.ANTHROPIC_AUTH_TOKEN` OR `getSetting('anthropic_auth_token')`——**任一**成立即通过

**改动点**：

1. 新增 `src/lib/provider-presence.ts`（或加在 `claude-settings.ts`）：
   ```ts
   export function hasCodePilotProvider(): boolean {
     // DB provider 任一记录 ≥ 1
     // OR env vars
     // OR legacy setting
   }
   ```
   注意：**不包含** `hasClaudeSettingsCredentials()`——cc-switch 的 settings.json 不视作"CodePilot 的服务商"。

2. `src/app/api/chat/route.ts:24-48` 在 `getSession` 之后、`acquireSessionLock` 之前插入：
   ```ts
   if (!hasCodePilotProvider()) {
     return new Response(JSON.stringify({
       error: 'No provider configured',
       code: 'NEEDS_PROVIDER_SETUP',
       actionHint: 'open_setup_center',
       initialCard: 'provider',
     }), { status: 412, headers: {...} });
   }
   ```
   用 HTTP 412 Precondition Failed 语义贴近"前置条件未满足"。

3. **前端接线点**（**[Codex 核查结论 2026-04-15]**：最初写的是"`useSSEStream` 识别 code 后派发事件"，但这条路径**走不通**——`src/lib/stream-session-manager.ts:307-310` 在 SSE reader 开始之前就检查了 `response.ok`，失败时只提取 `err.error` 字段抛 `new Error(...)`，structured 字段 `code / initialCard / actionHint` 全部丢失，`useSSEStream` 根本看不到 412 payload）：
   - **真正要改的位置**：`src/lib/stream-session-manager.ts:307-310` 的 `!response.ok` 分支
     ```ts
     if (!response.ok) {
       const err = await response.json();
       if (err.code === 'NEEDS_PROVIDER_SETUP') {
         window.dispatchEvent(new CustomEvent('open-setup-center', {
           detail: { initialCard: err.initialCard ?? 'provider' }
         }));
         throw new Error(err.error || 'No provider configured');
       }
       throw new Error(err.error || 'Failed to send message');
     }
     ```
   - 另一个备选：把 precheck 失败改成 **SSE-shaped error**（在 `/api/chat` 里 pipe 一个 200 SSE stream，单条 `event: error` 带 structured payload）。这样 `useSSEStream` 天然能消费。但代价是放弃 HTTP 412 语义的"干净"拒绝。**不推荐**，增加复杂度无收益。
   - **第二接线点（必改）**：`src/app/chat/page.tsx` 的首条消息路径**不走** `stream-session-manager`，它自己 `fetch('/api/chat')` → 检查 `response.ok` → `throw new Error(err.error)`，与 session-manager 的丢失模式一样（**[Codex 核查结论 2026-04-15]**）。Phase 3 必须**同时**修两处：`stream-session-manager.ts:307-310` 和 `src/app/chat/page.tsx` 里对应的 `!response.ok` 分支。只修一处会让新建会话（empty state）发第一条消息时 structured error 仍然丢失，SetupCenter 不会弹。
   - 可选的小重构（长期）：把 `!response.ok` + structured error 识别抽成一个 `handleChatFetchError()` helper 供两处共用，避免下次再漏同步。Phase 3 先两处各自接线，helper 抽取可以放进后续迭代。

**回归风险**：
- **现有 cc-switch 用户升级后首次发消息一定会被拦截**（by design，但需要发版说明明确告知）。用户画像：只靠 `~/.claude/settings.json` 管 auth、从未在 CodePilot 里添加 provider。按 Phase B 契约 `hasCodePilotProvider()` 不读 settings.json，这部分用户会被拦去 SetupCenter Provider 卡片。缓解：0.50.3 发版说明加一段"如果你用 cc-switch 管 Claude Code 凭据，升级后 CodePilot 会要求你在 设置→服务商 里显式添加一个 provider——这是为了让 CodePilot 能正确处理第三方 provider 的隔离。你仍可以通过 cc-switch 管理 Claude Code CLI 本身的凭据"。
- 极少数用户只装了 CLI、在 CLI 里登录了、**从未在 CodePilot 添加任何 provider**：按新判定会被拦截。
  - 缓解：`/api/setup/route.ts` 当前判定把"装了 CLI"也算 provider `completed`——新拦截逻辑与此**有意不一致**（入口拦截要求 CodePilot 里有真正 provider）。两条口径要各自注释为什么。
  - 决策建议：**入口拦截不把 CLI 装存在视作可用 provider**（符合用户约定"CLI 登录状态不管"）。这会导致这部分用户升级后第一次发消息被拦。
  - **[Codex 核查结论 2026-04-15]**：`src/components/setup/ProviderCard.tsx` 当前**不支持"一键选 Claude Code 内建 env 组"**——env-detected 按钮只调 `onStatusChange('completed')` 更新卡片状态，**不**持久化 provider 选择、**不**写入 session/global provider、**不**跳到服务商设置页。所以本条原先设想的"被拦后去 Provider 卡片一键完成"是个 **gap**，不是既有能力。Phase 3 启动前要么扩 ProviderCard 新增真正写入 DB 的按钮，要么把这部分用户显式引导到完整服务商对话框（`/settings` 的 Providers 分段，让用户手动添加一个 provider）。
- DB 挂了或 read 异常：拦截应 `try/catch` 失败时放行（fail-open），避免把所有用户拦死。

**验证**：
- 单测：三场景（DB empty + no env / DB 有记录 / env 有 key）
- 手动：清空 DB + 清空 env → 发消息 → 应弹出 SetupCenter 的 Provider 卡片

### C. 错误消息归一翻译（CLI / Native 两路错误收敛到同一个用户引导）

**现状**：
- Native runtime 抛 `No provider credentials available`（`ai-provider.ts:76`）
- Claude Code CLI 抛 `Not logged in · Please run /login`（CLI 侧文案，CodePilot 原样透传）
- `error-classifier.ts` 已经对第一条匹配 `NO_CREDENTIALS`，但第二条目前不在 pattern 列表里

**改动点**：

1. `src/lib/error-classifier.ts:177` `NO_CREDENTIALS` patterns 数组追加两条：
   ```ts
   patterns: [
     'no api key', 'missing api key', 'ANTHROPIC_API_KEY is not set',
     'api key required', 'missing credentials',
     'not logged in',        // ← 新增，覆盖 CLI /login 文案
     'please run /login',    // ← 新增，双重保险
   ],
   ```

2. `src/lib/error-classifier.ts:178-179` `userMessage` / `actionHint` 在 i18n 层面改成明确"CodePilot 语境"：
   - `userMessage`: `No provider configured in CodePilot.`
   - `actionHint`: `Open Settings → Providers and add a service, or run the setup wizard.`
   - 中文文案同步 `src/i18n/zh.ts`
   - **注意**：`error-classifier.ts` 目前是硬编码英文字符串，要么通过 error 消息 key 让前端 i18n 替换、要么把 message 改成 i18n key。与现有 pattern 保持一致选更小改动。

3. `src/hooks/useSSEStream.ts:254-255` 把"跳超链接"升级为"派发 SetupCenter 事件"。
   - **[Codex 核查结论 2026-04-15]**：当前 `/settings#providers` **不会**自动派发 `open-setup-center`，只会在 `SettingsLayout` 里切到 Providers tab；`AppShell` 只监听 `open-setup-center` 自定义事件，不监听 hash。即原先写的"前端零改动、靠路由处理器帮忙"方案**不成立**，需要真的接线。
   - **实际需要做的最小改动**（二选一）：
     - **方案 C-1**：`useSSEStream.ts:254` 里把 `action: 'open_settings'` 的渲染从 markdown 链接换成显式事件触发（例如渲染 `<a href="#" onClick={() => dispatchEvent('open-setup-center')}>`）。需要把错误 payload 的消费者从"注入 markdown 字符串"改成"结构化 action 让 React 组件渲染按钮"——牵涉 `MessageList` / `MessageItem` 的错误渲染链。
     - **方案 C-2（更小）**：在 `AppShell` 里新增一个 `useEffect` 监听 `window.location.hash === '#providers'`，自动派发 `open-setup-center({ initialCard: 'provider' })`。这样 `useSSEStream` 的 markdown 链接保持不变，点击后浏览器设置 hash → AppShell 捕获 → 弹 SetupCenter。
   - 推荐 C-2——改动面最小，和现有 SSE markdown 渲染链兼容。风险：hash 回跳逻辑要防重复触发（同 hash 多次 nav 应无副作用），以及 deep-link 直接访问 `/settings#providers` 的语义要明确（跳设置页还是弹 SetupCenter——两者都合理，选一个）。

**回归风险**：
- pattern 匹配是子串匹配（见 `error-classifier.ts:349-410` `classifyError`），新加的 `'not logged in'` 可能误触发其他无关错误（例如第三方 provider 返回的"not logged in to XYZ"等）。**缓解**：patterns 加边界提示，或放到 `classifyError` 末尾的 fallback（优先级最低）
- i18n 文案如果改成 "CodePilot-specific" 后，一些用英文 UI 的开发用户可能觉得文案不够技术化——需要平衡

**验证**：
- 单测：`classifyError({ error: new Error('Not logged in · Please run /login') }).category === 'NO_CREDENTIALS'`
- 手动：CLI 未登录场景下发消息 → 消息体渲染带 "Open Settings" 链接，点击弹 SetupCenter

### D. 复用 SetupCenter（**不需新建，仅需接线**）

**现状**（§ 二仓库事实）：
- `SetupCenter` / `WelcomeCard` / `ClaudeCodeCard` / `ProviderCard` / `ProjectDirCard` 齐备
- `AppShell.tsx:83-93` 首次打开 `!data.completed` 自动弹出
- `AppShell.tsx:95-103` 监听 `window` 事件 `open-setup-center`
- `/api/setup/route.ts` 综合判定 `provider: completed` 的逻辑：DB / env / legacy setting / CLI 任一即为 completed

**改动点**：**无**新组件。方案 B / C 中的"派发 open-setup-center 事件"直接复用。

**需核实 / 可能的微调**：
- 当前 `/api/setup/route.ts` 把"CLI 存在"也算 provider `completed`（第 40-46 行），这条口径与方案 B 入口拦截的判定**不一致**（B 不把 CLI 存在算作 "CodePilot provider"）
- **建议**：保持 `/api/setup` 现状不变（它控制 SetupCenter 的三个卡片状态，CLI 算 `completed` 是合理的），但新增一个 `/api/setup/provider-ready` 或在 `hasCodePilotProvider()` 函数里用更严格口径。两条判定口径要各自注释清楚为什么不同。

---

## 方案之外：百炼渠道 catalog 更新（独立 0.50.3 hotfix，关联 #483）

**Issue**：[#483](https://github.com/op7418/CodePilot/issues/483) 阿里云 codingplan 没有 `qwen3.6-plus` 模型。仓库作者 2026-04-15 12:54 UTC 评论"这个还没加，我加一下"。

**事实（file:line）**：
- 当前定义：`src/lib/provider-catalog.ts:510` `{ modelId: 'qwen3.5-plus', displayName: 'Qwen 3.5 Plus', role: 'default' }`
- 同文件 line 511-516 还有 `qwen3-coder-next` / `qwen3-coder-plus` / `kimi-k2.5` / `glm-5` / `glm-4.7` / `MiniMax-M2.5`，不改动
- 全仓 `grep 'qwen3\.5-plus' src/**/*.{ts,tsx}` 只命中 `provider-catalog.ts:510` 一处

**改动**：
```ts
// src/lib/provider-catalog.ts:510
// 改前
{ modelId: 'qwen3.5-plus', displayName: 'Qwen 3.5 Plus', role: 'default' },
// 改后
{ modelId: 'qwen3.6-plus', displayName: 'Qwen 3.6 Plus', role: 'default' },
```

**老用户数据风险（需用户决策）**：

当前用户如果已经在 session.model / role_models_json 里**显式选择过** `qwen3.5-plus`，替换后这些记录里的 `qwen3.5-plus` 字符串不会自动改成 `qwen3.6-plus`。影响：
- `src/lib/provider-resolver.ts` 的 `resolveModelFromCatalog` 查 `availableModels` 找不到 `qwen3.5-plus` → 回退逻辑视情况而定（可能 pass-through 给上游，上游返回 model-not-found）
- Sentry 里近期 `HTTP 404 model not found` bucket（B-009，Sentry NEXT-M** 系列）近 24h 已有增长，此替换可能**短期内小幅放大**该 bucket 直到老用户重新选一次模型

**处理策略：硬替换（已决策 2026-04-15）**

只改 catalog。接受少数老用户下次发消息看到 "model not found"，他们会在 UI 模型选择器里看到新列表（因为 `qwen3.5-plus` 已不在），选 `qwen3.6-plus` 后恢复正常。改动最小，没有隐式数据迁移风险。

不保留 legacy alias。百炼 Coding Plan 模型更新节奏快、每次升级都是平滑替换，保留 legacy 让用户看到两个相似模型反而困惑，且若上游已下线 `qwen3.5-plus` 会让用户撞 model-not-found。

**验证**：
- `npm run test` 确认 `provider-preset.test.ts` / `provider-resolver.test.ts` 不依赖 `qwen3.5-plus` 字面量（**[Codex 核查结论 2026-04-15]**：已核，`qwen3.5-plus` 在仓库里唯一命中点就是 `src/lib/provider-catalog.ts:510`，两个测试文件都无字面量依赖）
- 手动：在开发环境把 provider 切到 "Aliyun Bailian"，模型选择器应显示 Qwen 3.6 Plus 且能发消息成功

**非目标**：本条不处理 #491（第三方 1M 上下文模型映射缺失），用户已明确"先管 bug，不管功能请求"。

---

## 方案之外：FileTree ReferenceError（独立 0.50.3 hotfix）

- 改动：`src/components/ai-elements/file-tree.tsx:53-64`
  - 文件顶部加 `const EMPTY_EXPANDED: Set<string> = new Set();`
  - 第 55 行 `defaultExpanded = new Set()` → `defaultExpanded = EMPTY_EXPANDED`
- 不依赖本文档任何其他方案，可独立发
- 风险：`useState(defaultExpanded)` 首次 render 时传入的 Set 引用变化——不影响语义，因为 `useState` 只在初始 mount 读取该值，后续用 `internalExpanded` 驱动；共享不可变空 Set 是惯例（参见 `AppShell.tsx:57`）

---

## 阶段与状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 事实核查与定案（本文档） | ✅ 已完成 | Codex 两轮核查全部合并（见 §"Codex 事实核查结论"）|
| Phase 1 | FileTree ReferenceError hotfix | ✅ 已完成 | commit `bc308e9` |
| Phase 1b | 百炼 catalog 替换（#483） | ✅ 已完成 | commit `2d06f50` |
| Phase 2 | 方案 A：Runtime auto 简化 | ✅ 已完成 | commit `d1fac18`，净删 139 行（移除 `hasCredentialsForRequest`）|
| Phase 3 | 方案 B：Chat 入口拦截 | ✅ 已完成 | commit `3e03919`，新增 `provider-presence.ts` + 两处 fetch 接线 + 7 个单测 |
| Phase 4 | 方案 C：错误归一翻译 + hash 监听 | ✅ 已完成 | commit `a32837e`，`not logged in` 归入 `NO_CREDENTIALS` + AppShell hash bridge |
| Phase 5 | 回归测试 + 0.50.3 发版 | 🔄 待用户确认 | 1034/1034 unit test 过；UI 回归 + Sentry 72h 观察留给发版后 |

---

## 决策日志

- **2026-04-15**：方案确定
  - 用户否决"保留 auto 模式 + 打补丁"方向，采纳"二元判定"——auto = 看 CLI binary 是否存在
  - 用户明确"CLI 登录状态不管"——入口拦截仅看 CodePilot provider 存在性
  - 放弃新建引导卡（已有 SetupCenter，之前误判为缺失）
  - 1M 上下文映射（#491）从本计划剥离——用户明确"先管 bug，不管功能请求"
  - 方案 D 合并进 B/C（不独立开发）
  - 百炼 `qwen3.5-plus` → `qwen3.6-plus` 替换纳入 Phase 1b（关联 #483，作者已承诺）
  - 百炼替换采用**硬替换**：不保留 `qwen3.5-plus` legacy alias。接受极少数老 session 短期 model-not-found 的代价换更干净的 catalog

---

## 回归监测

**Sentry 关键指标（发版后 24h / 72h 对比 pre-release）**
- NEXT-2Z `No provider credentials` 24h 量：基线 1742x（2026-04-15 快照）；目标 ≤ 200x
- NEXT-PA `defaultExpanded is not defined`：目标 0
- `Claude Code process exited with code 1`（B-001 相关 bucket）：基线 6640x；目标看趋势（和方案正相关但非本计划主控目标）

**GitHub Issue 回关**
- #493 / #490 / #478 / #476 / #461：发版后请用户重跑 Doctor 并粘贴新 JSON 验证

---

## 事实核查清单（供 Codex）

> 每条陈述对应证据源；如发现与 HEAD 不符请在条后加 **[FAIL]**。

1. `src/lib/runtime/registry.ts:128-135` `resolveRuntime` 的 auto 分支当前确实综合 `sdk.isAvailable() && hasCredentialsForRequest(providerId)` 判定
2. `src/lib/ai-provider.ts:76` 确实抛 `'No provider credentials available. Please configure a provider in Settings or set ANTHROPIC_API_KEY.'` 字面量
3. `src/lib/claude-settings.ts:50-57` `pick()` 函数确实只以"非空字符串"为有效条件，不做语义校验（因此 `"PROXY_MANAGED"` 会通过）
4. `src/lib/error-classifier.ts:176-181` `NO_CREDENTIALS` patterns 当前**不包含** `'not logged in'` / `'please run /login'`
5. `src/lib/error-classifier.ts:417-423` `buildRecoveryActions` 确实对 `NO_CREDENTIALS` 等自动 push `{ label: 'Open Settings', action: 'open_settings' }`
6. `src/hooks/useSSEStream.ts:254-255` 当前把 `action: 'open_settings'` 渲染为 markdown 链接 `[label](/settings#providers)`
7. `src/components/layout/AppShell.tsx:95-103` 确实监听 `open-setup-center` window 事件并 `setSetupOpen(true)`
8. `src/components/setup/SetupCenter.tsx:17` 签名 `SetupCenter({ onClose, initialCard?: 'claude' | 'provider' | 'project' })`
9. `src/components/ai-elements/file-tree.tsx:55` 当前形态为 `defaultExpanded = new Set(),` 解构默认值语法
10. `src/components/layout/AppShell.tsx:57` 当前形态为 `const EMPTY_SET = new Set<string>();` 模块顶层常量
11. `git show v0.46.0:src/lib/runtime/registry.ts` 返回失败（文件不存在于 v0.46.0）
12. `git show v0.46.0:src/lib/claude-client.ts | wc -l` 返回约 1560 行（与 HEAD 的 1844 行相比）
13. cc-switch 源码 `src-tauri/src/services/proxy.rs:22` 确实有 `PROXY_TOKEN_PLACEHOLDER = "PROXY_MANAGED"` 常量（需 clone `https://github.com/farion1231/cc-switch.git` 验证）
14. cc-switch commit `Feat/proxy server (#355)` 日期确实为 2025-12-05 11:26:41 +0800
15. Sentry API（需 `.env.local` 中 `SENTRY_AUTH_TOKEN`）`GET /api/0/organizations/codepilot-rg/issues/?query=issue:JAVASCRIPT-NEXTJS-2Z&statsPeriod=24h` 在 2026-04-15 20:57 +0800 返回的 count 和最后时间戳
16. Sentry NEXT-PA `ReferenceError: defaultExpanded is not defined` 第一次出现时间 `firstSeen=2026-04-15T12:55:47Z`，仅在 `release: codepilot@0.50.2` 出现
17. 推断 1-4（§ 三）的证据路径是否自洽；有无更简解释

---

## Codex 事实核查结论（2026-04-15）

> 用户手动运行 Codex 核查后把关键结论回传。下面三条是明确的"文档需要修正"项，已就地合并到方案 A / B / C 的文本里。其余 14 条清单项 Codex 未明确回传差异，按"无异议"处理，但任何使用本文档作为 Phase 1-5 实施基线的读者仍应**随机抽查** 5-6 条核心 file:line 引用避免 HEAD 漂移。

| 清单项 | 状态 | 实际情况 | 对方案的影响 |
|---|---|---|---|
| 待核查 · ProviderCard 一键选 env 组 | **FAIL** | 当前 env-detected 按钮只调 `onStatusChange('completed')`，不持久化 provider / 不写 DB / 不跳设置 | 方案 B 的"被拦后一键完成"是 gap。Phase 3 要么扩 ProviderCard 真正写 DB，要么显式跳完整服务商对话框 |
| 待核查 · `/settings#providers` 自动弹 SetupCenter | **FAIL** | 当前只切到 SettingsLayout 的 Providers tab，`AppShell` 只监听 `open-setup-center` 事件，无 hash 桥接 | 方案 C "前端零改动"假设不成立。按新方案 C-2（在 AppShell 加 hash 监听）处理 |
| 待核查 · `hasCredentialsForRequest` 运行时引用点 | **PASS（无其他依赖）** | 运行时代码仅 `registry.ts:51` 自引用 + 测试文件引用 | 方案 A 可以直接把该函数从 auto 分支移除甚至整体删除（无跨模块回归） |
| 方案 B 前端接线 · 412 payload 是否能被 `useSSEStream` 观察到 | **FAIL** | `stream-session-manager.ts:307-310` 在 SSE reader 启动前就 `!response.ok` 判定 + `throw new Error(err.error)`, structured 字段 `code/initialCard/actionHint` 全部丢失 | 原方案 B 第 3 步"前端在 `useSSEStream` 识别 code"路径**走不通**。必须改在 `stream-session-manager.ts:307-310` 的 `!response.ok` 分支里派发 `open-setup-center` 事件（见方案 B 第 3 步已更新） |
| 方案 B 前端接线 · 首次消息路径 | **FAIL**（二次核查 2026-04-15） | `src/app/chat/page.tsx` 的首条消息 fetch 不走 `stream-session-manager`，自己检查 `response.ok` + `throw new Error(err.error)`，同样丢失 structured 字段 | Phase 3 必须**同时**改两处：`stream-session-manager.ts:307-310` 和 `src/app/chat/page.tsx` 的对应分支（方案 B 第 3 步已升级为明确第二接线点） |
| #493 问题二 · Phase B 是否触发 | **FAIL**（文档自相矛盾） | Phase B 契约明确 `hasCodePilotProvider()` 不读 settings.json，纯 cc-switch 用户**会**被拦截；但 #493 小节旧版写的是"不触发" | 已修正 §"方案之外：#493 真实情况 · 问题二 · Phase B"段落，同步更新 Phase B 回归风险（明确告知现有 cc-switch 用户升级后会被拦一次）|

（核查记录：见 `AppShell.tsx:75-103` 的 SetupCenter 触发逻辑只认 `open-setup-center` 事件，不认 hash；`ProviderCard.tsx` 的 env-detected 路径只 `onStatusChange('completed')`；全仓 grep `hasCredentialsForRequest` 只命中 `src/lib/runtime/registry.ts` 和 `src/__tests__/` 下的测试。）

---

## 参考

- [issue-tracker.md](../active/issue-tracker.md) — 问题跟踪主档（本计划的 B-001 / B-008 / B-009 相关）
- [cc-switch-credential-bridge.md](./cc-switch-credential-bridge.md) — v0.50.2 shadow HOME 方案背景（仍有效，本计划是其补充修复）
- [electron-port-stability.md](./electron-port-stability.md) — v0.50.2 端口稳定化（已发布）
- cc-switch 仓库：https://github.com/farion1231/cc-switch（commit 2025-12-05 `Feat/proxy server (#355)` 引入代理模式）
