> **Archive note（2026-06-05，document-system-governance）**：本计划已移出 `active/`，归入 `superseded/`——被 refactor-closeout 接管，仅作历史参考。**不是当前任务入口**；当前工作入口见 [exec-plans README](../README.md)，重启方式见 [superseded/README.md](README.md)。

# Claude Agent SDK 0.2.111 能力采纳

> ⚠️ **Superseded by [refactor-closeout.md](../completed/refactor-closeout.md)** — 不再单独推进，保留作历史参考。SDK 升级已完成；剩余 chip / 限流 UI / WarmQuery / session fork / getContextUsage 等能力按需并入 refactor-closeout 的 **Phase 2（Runtime 与会话执行）** 与 **Phase 5（上下文可视化）**。

> 创建时间：2026-04-17
> 最后更新：2026-04-17
> 关联计划：[opus-4-7-upgrade.md](./opus-4-7-upgrade.md)（本计划依赖其 Phase 0 的 SDK bump）

## 背景

本地 `@anthropic-ai/claude-agent-sdk` 停在 **0.2.62**，线上最新 **0.2.111**（2026-04-16 发布），落后 49 版本约 7 个月。

Typings 从 2189 行扩到 4827 行（+120%），**纯增量、无 breaking 删除**，但 Opus 4.7 升级计划里只要求「升级 SDK + 识别 `xhigh`」，没有采纳新能力——浪费面很大。本计划单独梳理、排期采纳新 SDK 的实质性能力。

**发版节奏**：本计划**不与 Opus 4.7 升级并发发版**，4.7 先独立走 Phase 6 发版后，再按本计划推进。避免把模型切换和运行时能力变更混在同一 release 里踩雷。

## 前置依赖

- ✅ Opus 4.7 Phase 0 完成（SDK 升到 0.2.111）
- ✅ Opus 4.7 Phase 5 回归通过（prompt 字面化已修）
- ✅ Opus 4.7 Phase 6 发版稳定（至少 1 周无回滚）

## UX 原则：用户价值 > UI 存在感（2026-04-17 Codex 复核后修订）

**每个 Phase 必须回答用户价值，但不机械等同于「必须有 UI」**。Codex 校准点：上一版原则让 Phase 3 硬塞 ⚡ 图标暴露内部 WarmQuery 状态，这是**实现噪音**，不是用户价值。

每个 Phase 从以下**三种价值形态中选一种**并明确标注：

| 价值形态 | 适用场景 | 必写字段 |
|---------|---------|---------|
| **A — 显性 UI 价值** | 有用户可操作元素或主动获取的信息 | 痛点 / UI 位置 + 元素 + 文案 / 交互脚本 / 发现路径 |
| **B — 静默体感价值** | 无需用户感知机制、但有**可量化**体验提升 | 痛点 / 预期体感指标（如「首字延迟 p50 -X%」）/ **不加**人为可见指示；指标达不到则砍 Phase |
| **C — 基础设施价值** | 为其他 Phase 服务、本身无用户价值 | 显式标注「无用户价值，是 X 的前置」 / 不得独立发版 |

**反模式（本计划之前犯过）：**
- 为了让每个 Phase 都有「UI」，硬塞暴露内部状态的图标（Phase 3 的 ⚡）
- 让系统替用户做不可逆决定（自动重发、自动打开浏览器、不可关闭浮层）

**不可逆 / 有副作用动作的硬规则：**
- 发消息 / 删除 / 覆盖 / 跨 session 影响 / 自动重试 / 外部导航 / 跨模型切换 / 阻断式浮层
- **必须**：显式确认按钮 + 可取消出口 + 取消后保留 draft + 动作前预览关键信息（domain / 来源 / 用途）

**本计划自检（2026-04-18）：**

| Phase | 价值形态 | 说明 |
|-------|---------|------|
| Phase 0 | C | POC，Layer B 的前置，不独立发版 |
| Phase 1 | A | 结束态 chip（chip 展示层） |
| **Phase 1b** | **A** | **chip 可操作按钮（压缩并重试 / 切 Sonnet / 开启 1M / 继续 / ...），闭环用户动作** |
| Phase 2 | A | 订阅路径限流 UI |
| Phase 2b | C | 类型适配，跟随 Layer A 宿主 Phase |
| Phase 3 | **B** | 纯静默预热，P50 不降 30% 则砍 |
| Phase 4 | A | Fork/Tag/Subagent 可视化 |
| Phase 5 | A | Context 精确展示（不是替 preflight） |
| Phase 6 | A | Hook 驱动的通知/同步 |
| Phase 7a | A | Elicitation 表单/授权卡片 |
| Phase 7b | A | Deferred tool 响应卡片 |

## 推进路线图（按用户价值 × 确定性 × 依赖关系排序）

本计划共 11 个 Phase，不是线性顺序执行——以下是建议的**用户视角推进路径**，每个阶段列出核心能力、依赖、以及何时可以发版给用户感知。

### 🎯 阶段 1 — 立刻能做（不需要 POC，1-2 周可发版）

| 顺序 | Phase | 用户感知 | 依赖 | 工作量 |
|------|-------|----------|------|--------|
| 1.1 | **Phase 1b** chip 按钮化 | Claude 停下时一键「压缩并重试 / 切 Sonnet / 开启 1M」，不再手动找设置 | Phase 1 已完成（chip 骨架在） | 中（2-3 天） |
| 1.2 | **Phase 2** 限流 UI | 订阅版限流时弹倒计时 banner + 一键切小模型 | 无（订阅路径专属） | 小-中（2-3 天） |

**发版时机**：两个都做完一起发一个小版本。用户第一次在 Opus 4.7 长会话里触顶、或遇到限流时立刻感知。

### 🔬 阶段 2 — 跑 POC 拿决策数据（半天）

```bash
CLAUDE_SDK_POC=1 npm run test:sdk-poc
```

三个 POC 产出三个 go/no-go 信号（写到 `docs/research/agent-sdk-0-2-111-capabilities.md.json`）：

| POC | 决定什么 | 如果失败 |
|-----|---------|----------|
| `hooks-poc` | Claude Code SDK 0.2.111 的 hook 通路能否在 CodePilot 真 queryOptions 组合下工作 | Phase 6 降级为流消息反推、Phase 7b 推迟 |
| `warm-query-poc` | WarmQuery 预热能否让首字延迟 p50 下降 ≥30% | Phase 3 整体砍掉 |
| `multi-defer-poc` | SDK 单轮能否产生多个并发 deferred_tool_use | Phase 7b 只做单 defer UI，不做合并 drawer |

### 🌿 阶段 3 — 核心 UX 能力（基于 POC 结果推进，3-5 周）

| 顺序 | Phase | 用户感知 | 依赖 |
|------|-------|----------|------|
| 3.1 | **Phase 6** 新 hooks（PostCompact 优先） | 压缩过程聊天流里可见；cwd 切换 FileTree 自动跟；权限拒绝不刷屏改汇总徽章 | `hooks-poc` 通过 |
| 3.2 | **Phase 4** Session fork | "从这条消息分叉对话" → 保留原会话 + 新开子分支 | DB migration（加 `parent_session_id` 列） |

**发版时机**：Phase 6 优先发（PostCompact 改动小、价值高）。Phase 4 的 fork 单独一版（DB schema 变动要充分回归）。

### ⚡ 阶段 4 — 性能与精度（按需做，各 1-2 周）

| 顺序 | Phase | 用户感知 | 依赖 |
|------|-------|----------|------|
| 4.1 | **Phase 3** WarmQuery 预热 | 打开历史会话发首条消息不再卡顿 | `warm-query-poc` p50 ≥30% 下降 |
| 4.2 | **Phase 5** getContextUsage | Context indicator 精度 <5% 偏差 | 无（已有 fallback） |

两项都是"有了更好、没有也能将就"。不是用户反馈痛点就不急。

### 🔌 阶段 5 — MCP 交互升级（2-3 周）

| 顺序 | Phase | 用户感知 | 依赖 |
|------|-------|----------|------|
| 5.1 | **Phase 7a** Elicitation | MCP 工具中途问你参数（如 Notion 存哪个库），聊天流里弹表单 | `hooks-poc` 通过（共享 SDK 事件机制） |
| 5.2 | **Phase 7b** Deferred tools | AskUserQuestion 类工具响应更连贯 | `multi-defer-poc` + `hooks-poc` 都通过 |

---

### 不在路线图的 Phase 补充说明

- **Phase 0**：是 POC 本身，列为阶段 2 的前置动作，不独立推进。
- **Phase 1 / Phase 2b**：本次 SDK 升级已完成，当前 `✅ 已完成` 状态。
- **Phase 4b（全消息 fork + transcript backfill）**：Path A 上线、用户反馈"想从 assistant 消息分叉"强烈后再启动。
- **Phase 7b-future（多 defer UI）**：仅在 `multi-defer-poc` 显示 SDK 支持并发 defer 时解锁。

### 建议发版节奏

- **v{next+1}** = 本次 SDK 升级基础 + 阶段 1（chip 按钮 + 限流 UI）
- **v{next+2}** = 阶段 3.1（PostCompact + CwdChanged + PermissionDenied）
- **v{next+3}** = 阶段 3.2（Session fork） —— 带 DB migration 要 release note 特别标注
- 后续按用户反馈和团队容量排

每一步都保持独立可发版、可回滚（flag 或单列 Phase），不堆大版本。

## 采纳策略（双层设计）

**Codex 2026-04-17 审核后重构**：原计划把附加信息和重设计能力混在一起，风险不对齐。现分两层：

- **Layer A — 低风险附加层**：只做 _附加增强_，不替换现有主干。SDK 能用时用，不能用时退回现有路径。
- **Layer B — 高风险重设计层**：每个能力必须先写 POC + 真实时序图，才能进入实施。默认不合入发版，做 flag gate。

### Layer A — 低风险附加

| Phase | 能力 | 性质 | 状态 |
|-------|------|------|------|
| Phase 1 | `TerminalReason` 附加到结束态 + Sentry tag | 附加 | ✅ 已完成（随本次 SDK 升级上线） |
| **Phase 1b** | **chip 可操作按钮（压缩并重试 / 切 Sonnet / 开启 1M / 继续 / ...）** | **闭环** | **📋 待开始（路线图阶段 1）** |
| Phase 2 | `SDKRateLimitInfo` 仅用于订阅路径的 UI 增强 | 附加 | 📋 待开始（路线图阶段 1） |
| Phase 2b | 升级后的 SDK 类型适配（`Query` / `Options` / `ModelInfo`） | 兼容 | ✅ 已完成（随本次 SDK 升级上线） |

### Layer B — 高风险重设计（每块先 POC）

| Phase | 能力 | 前置要求 | 状态 |
|-------|------|----------|------|
| Phase 0 | 接入前置 POC（repo 内真 queryOptions 组合验证 hook 通路） | — | 📋 待开始 |
| Phase 3 | `WarmQuery` 的**窄场景**采纳（同 cwd + 同 provider + 同 permission 的 resume） | POC + 时序图 | 📋 待开始 |
| Phase 4 | Session fork / rename / tag（SDK UUID ↔ DB id 映射设计） | 映射文档 + POC | 📋 待开始 |
| Phase 5 | `getContextUsage()` 活跃会话**展示/校准**（不替 preflight 估算） | 时序图 | 📋 待开始 |
| Phase 6 | 新 hooks（依赖 Phase 0 的真实 POC 结论） | Phase 0 放行 | 📋 待开始 |
| Phase 7a | MCP Elicitation（`onElicitation` callback + URL mode 完成通知） | 用户响应 promise 注册表设计 | 📋 待开始 |
| Phase 7b | Deferred tools（PreToolUse defer → `tool_deferred` → resume） | Pending tool 注册表 + resume 权限约束 | 📋 待开始 |

> ⏱ Layer A 1-2 周可发版；Layer B 每 Phase 独立排期，POC 不过不合入。

## 决策日志

- 2026-04-17：建立计划；与 4.7 升级解耦发版，避免风险叠加
- 2026-04-17：**Hooks 在当前代码里是主动关闭的**（`src/lib/claude-client.ts:970-974` 注释：「No queryOptions.hooks — all hook types (Notification, PostToolUse) use the SDK's hook_callback control_request transport, which fails with "CLI output was not valid JSON" when the CLI mixes control frames with normal stdout」）。Phase 6 必须先在 Phase 0 里验证 0.2.111 是否修复了这个 bug，否则 Phase 6 直接作废或转而用流消息反推。
- 2026-04-17：**不采纳**的能力先列出（见末尾「不在范围内」），避免 Phase 分裂
- 2026-04-17（Codex 审核后校准）：原计划 7 条被 Codex 逐条质疑，全部在 `sdk.d.ts` 里核对后成立，现按双层重构：
  - **WarmQuery**（`sdk.d.ts:4796-4801`）：`query(prompt)` 只能调一次，Options 在 `startup()` 时固化。CodePilot `claude-client.ts:395` 每次都动态组装 cwd/model/provider/permission/MCP/resume/canUseTool，不能按通用 provider 池预热。计划 Phase 3 收窄到「**同 cwd + 同 provider + 同 permission 的 resume 场景**」，且不把「Long Idle 空白」bug 的验收挂钩 WarmQuery（证据不足，root cause 更像客户端 snapshot/GC 生命周期）。
  - **forkSession**（`sdk.d.ts:552-562`）：参数是 `_sessionId: string, _options?: { upToMessageId?: string, title?: string }`，sessionId 指 **SDK session UUID**（即 `chat_sessions.sdk_session_id`），不是 `chat_sessions.id`。原计划里的 `fromMessageId` 字段名错了，且把两个 id 混为一谈。Phase 4 新增「ID 映射设计」子任务。
  - **tagSession**（`sdk.d.ts:4627`）：`_tag: string | null` —— **单 tag**，不支持多对多。原计划新建 `session_tags` 多对多表会造成 SDK transcript metadata 与 DB 双源分裂。Phase 4 改为：SDK 作主写 tag，DB 仅做索引缓存（供搜索），或完全放弃多对多设计、遵从 SDK 单 tag 语义。
  - **getContextUsage**（`sdk.d.ts:1827`）：是 **Query 实例方法**，必须在 Query 初始化后才能调。`src/app/api/chat/route.ts` 的 preflight compression 决策在创建 Query 之前，存在时序悖论。Phase 5 收窄为「**活跃会话的展示 / 估算器校准**」，不替换 preflight estimator。
  - **RateLimitInfo**（`sdk.d.ts:2699`）：注释明确「**for claude.ai subscription users**」。CodePilot 还有 API key / Native / OpenAI-compatible / OpenRouter / 三方代理路径，它们不会收到 `rate_limit_event`。Phase 2 收窄为「**Claude Code SDK + OAuth 订阅路径的 UI 增强**」，`error-classifier.ts` 的正则兜底保留为主干。同时删除「`/api/providers/models` 返回 group 级 rate limit hint」——限流是会话事件不是静态元数据。
  - **TerminalReason**（`sdk.d.ts:2750`）：optional on `SDKResultMessage`。CLI spawn 失败、认证失败、网络断开、JSON 异常、provider 配置错误、native runtime 异常 —— 都不会有 result message。Phase 1 改为「**附加层**」：收到 result 且有 `terminal_reason` 时用它增强结束态 + Sentry tag；其余路径继续走 `error-classifier.ts`。
  - **Elicitation / Deferred / AskUserQuestion**（`sdk.d.ts:1163, 470-475, 2450-2454, 2749`）：
    - MCP Elicitation 的真入口是 `Options.onElicitation: OnElicitation`（callback），`ElicitationRequest.mode` 有 `'form' | 'url'` 两种；`SDKElicitationCompleteMessage` **只是 URL mode 完成通知**，不是表单交互请求入口。
    - Deferred tools 是另一套机制：PreToolUse hook 返回 defer → `SDKResultMessage.terminal_reason === 'tool_deferred'` + `deferred_tool_use: SDKDeferredToolUse` → 调用方注册 pending + await 用户响应 promise → 按相同权限模式 resume。
    - AskUserQuestion 是这套机制的一个具体应用，不是独立通道。
    - 三者必须拆三个 Phase 或至少三个独立子任务，不能写成「一条链」。Phase 7 拆成 7a / 7b。
  - **Phase 0 Hook POC 不够真实**：原计划「临时工程最小复现」只能证明 SDK 基础通路，证明不了 CodePilot 原 bug（canUseTool + in-process MCP + stderr capture + resume + capability capture + stream parse 组合）是否修好。Phase 0 增加「repo 内真 queryOptions POC harness」子任务。

---

## 详细设计

### Phase 0 — 接入前置 POC（repo 内真环境验证）

**目标：** 在写任何采纳代码前，用 **CodePilot 实际 queryOptions 组合**（而非最小复现）验证 0.2.111 的关键行为。

**👤 用户今天的痛点：** 无（这是可行性验证 Phase，不面向用户）

**🎨 改动后 UI 长什么样：** 无 UI；产出是 `docs/research/agent-sdk-0-2-111-capabilities.md` + POC integration tests（`hooks-poc.test.ts` / `warm-query-poc.test.ts` / `multi-defer-poc.test.ts`）

**🔁 交互脚本：** 无

**🔎 发现路径：** 纯工程内部 Phase，**承认无 UI 表现**。其结论决定 Phase 6 / 7b 的 go/no-go。

**Codex 校准点：** 原计划的「临时工程最小复现」只能证明 SDK 基础 hook 通路能跑，证明不了 CodePilot 原 bug 条件（canUseTool permission prompt + in-process MCP servers + stderr capture + resume fallback + capability capture + stream 解析组合）下是否修好。

**任务清单：**

1. **Hook 回调 bug 真实场景复核**（阻塞 Phase 6）
   - 在 repo 内新建 `src/__tests__/integration/hooks-poc.test.ts`（遵循 `-poc.test.ts` 命名规范）
   - 复用 `claude-client.ts:395` 组装的 queryOptions 完整组合：`{ hooks: { PreToolUse, PostToolUse, PermissionDenied }, canUseTool, mcpServers: [in-process MCP], stderr: captureHandler, resume, ... }`
   - 跑一次真实消息，观察：
     - 是否还出 `CLI output was not valid JSON` / control frame 污染
     - hook callback 是否被正确调用
     - stderr capture 是否与 hook control frame 互相干扰
   - 结论写入 `docs/research/agent-sdk-0-2-111-capabilities.md`

**运行与隔离策略（Codex 校准点）：**

当前 `npm run test` = `typecheck + unit`（只跑 `src/__tests__/unit/*.test.ts`），integration test 不会被默认跑到；如果塞进默认跑又会依赖本机 Claude 登录 / 网络 / 真实 MCP，不稳定。

- **新增专用脚本**：`package.json` 加 `"test:sdk-poc": "CLAUDE_SDK_POC=1 tsx --test src/__tests__/integration/*-poc.test.ts"`（glob 覆盖所有 POC 文件，Phase 3 的 `warm-query-poc.test.ts` 也包含在内；同时约定命名规范「新 POC 文件必须以 `-poc.test.ts` 结尾」）
- **环境变量 gate**：测试入口用 `if (!process.env.CLAUDE_SDK_POC) { test.skip(); return; }` 守卫，避免被意外 CI 触发
- **fixture MCP server**：创建 `src/__tests__/fixtures/fixture-mcp-server.ts`（仅暴露 `ping` / `ask_user` / `fail_always` 三个工具，进程内启动），**不依赖** cli-tools/memory-search 等生产 MCP
- **skip 条件**：`CLAUDE_CODE_OAUTH_TOKEN` 或 `ANTHROPIC_API_KEY` 未设置时自动 skip，并打印 runbook
- **产出路径约束**：测试产出 JSON 报告写到 `docs/research/agent-sdk-0-2-111-capabilities.md` 旁 `.json` 文件，便于回归对比
- **runbook**：在 `docs/research/agent-sdk-0-2-111-capabilities.md` 写清楚「如何运行」（需要的凭据、运行命令、预期输出）

2. **query() / Options 类型 diff**
   - `diff <(node -e "console.log(Object.keys(require('@anthropic-ai/claude-agent-sdk')))" --old) new`（或直接对比 typings）
   - 确认 `Options` 里 `hooks`、`canUseTool`、`mcpServers`、`stderr`、`resume` 签名是否变化
   - `conversation-registry.ts:1`、`agent-sdk-capabilities.ts:13` 用 `Query` 类型的地方全部走一遍 tsc

3. **MCP tool 构造 API 稳定性**
   - `createSdkMcpServer` / `tool` 在 8 处用（`cli-tools-mcp.ts`、`memory-search-mcp.ts`、`widget-guidelines.ts`、`notification-mcp.ts`、`dashboard-mcp.ts`、`media-import-mcp.ts`、`image-gen-mcp.ts`、`agent-sdk-agents.ts`）
   - 升级后跑 `npm run test`，重点验证 MCP 相关单测

4. **多并发 deferred tool 能力验证**（阻塞 Phase 7b 的多 defer UI 解锁）
   - 新建 `src/__tests__/integration/multi-defer-poc.test.ts`（遵循 `-poc.test.ts` 命名规范）
   - 构造场景让 PreToolUse hook 对同一轮连续两个工具都返回 defer
   - 观察 SDK 行为：
     - 第一个 defer 就 terminal，第二个工具根本没发起？
     - SDK 内部排队，只暴露一个 `deferred_tool_use`？
     - 或 SDK 实际 behavior 允许多并发（typings 未更新）？
   - 结论写入 `docs/research/agent-sdk-0-2-111-capabilities.md`，作为 Phase 7b 多 defer UI 的 go/no-go 依据

5. **输出：** `docs/research/agent-sdk-0-2-111-capabilities.md` — 能力全景 + 本次采纳映射 + bug 复核结论 + 类型 diff 摘要 + 多并发 defer 能力验证结果

**验收标准：**
- Hook bug 在 CodePilot 真实 queryOptions 下的结论明确（修复 / 未修 / 改变形态）
- MCP tool API / Query 类型在升级后无回归
- SDK 多并发 defer 能力有实测结论
- Layer B 的每个 Phase 都能基于此文档判断是否 go/no-go

---

### Phase 1 — `TerminalReason` **附加**到结束态（不替换 error-classifier）

**背景：** SDK 0.2.111 新增 `type TerminalReason = 'blocking_limit' | 'rapid_refill_breaker' | 'prompt_too_long' | 'image_error' | 'model_error' | 'aborted_streaming' | 'aborted_tools' | 'stop_hook_prevented' | 'hook_stopped' | 'tool_deferred' | 'max_turns' | 'completed'`（`sdk.d.ts:4656`），挂在 `SDKResultMessage.terminal_reason`（`sdk.d.ts:2750`，**optional**）。

**👤 用户今天的痛点：** Claude 停止响应时，消息末尾只有一个小小的「done」图标或者生成完就没动静了。用户分不清：
- 是模型正常结束了？
- 是我的上下文满了所以提前停了？
- 是某个工具调用被权限拒绝了？
- 是达到了 max_turns？
- 还是触发了 Hook 的 stop？

结果用户要么盯着屏幕等，要么乱点「继续」，要么去看右下角 DevTools。「为什么停下来」这件事在产品里是隐形的。

**🎨 改动后 UI 长什么样：**

在 `ChatView` 每一轮消息的**末尾 footer 行**（assistant 最后一条消息下方、输入框上方）加一个**结束态 chip**，按 `terminal_reason` 分四色：

| reason | 颜色 | 文案（中文） | 可操作按钮 |
|--------|------|-------------|-----------|
| `completed` | 无（静默） | — | — |
| `max_turns` | 🟡 黄 | 已达到轮数上限 | `继续` |
| `prompt_too_long` | 🔴 红 | 上下文已满 | `压缩并重试` · `开启 1M 并重试` · `仅压缩`（都经二次确认，不自动 replay） |
| `blocking_limit` / `rapid_refill_breaker` | 🟣 紫 | Opus 今日额度用尽 | `切换到 Sonnet` · 倒计时 `X 小时 Y 分恢复` |
| `image_error` | 🔴 红 | 图片识别失败 | `重新上传` |
| `model_error` | 🔴 红 | 模型返回错误 | `重试` |
| `aborted_streaming` / `aborted_tools` | ⚪ 灰 | 已取消 | — |
| `hook_stopped` / `stop_hook_prevented` | ⚪ 灰 | Hook 中断本轮 | `查看 Hook 配置` |
| `tool_deferred` | 🔵 蓝 | 有工具等待响应 | 由 Phase 7b 处理 |

未识别的 `terminal_reason` → 🟡 黄 `本轮已结束` + 上报 Sentry。

**🔁 交互脚本（以 `prompt_too_long` 为例，Codex 校准后修正）：**

上一版写「压缩完成后自动重发」与 UX 硬规则「不可逆 / 自动重试必须显式确认」冲突——上一轮可能已有部分输出或工具副作用，用户也可能想先编辑 prompt。修正为：

1. 用户发了一条长对话的第 50 条消息
2. 模型开始流式返回 → 返回一半戛然而止
3. 消息末尾出现 🔴 `上下文已满` chip + `[压缩并重试]` / `[开启 1M 并重试]` / `[仅压缩]` 三个按钮
4. 用户点 `压缩并重试` → 先弹**确认对话框**：「将压缩历史并重发上一条消息。如果上一轮已有工具副作用，重发可能重复执行。[取消] [确认]」 → 确认后压缩 → 完成后重发
5. 用户点 `仅压缩` → 压缩完成 → 上一条 user message 保存为 draft 留在输入框 → 用户自己决定 `[发送]` / `[编辑]` / `[放弃]`
6. `开启 1M 并重试` 同样走二次确认；也有对应的 `仅开启 1M`（不重试）
7. 用户如果什么都不点，chip 持续显示，上一条消息作为 draft 留在输入框

**🔎 发现路径：** 被动触发（收到 `terminal_reason` 自动显示），**不需要** onboarding nudge，因为它出现在用户视线焦点（刚结束的消息下方）。唯一需要一次性提示的是 `blocking_limit` 第一次出现时，弹一个「额度说明」抽屉（可关闭）。

**Codex 校准点：** 原计划说「替换 `error-classifier.ts` 的字符串推断、12 种 reason 都能 UI 区分、模糊文案消失」，会覆盖不到最常见的错误路径（CLI spawn 失败、认证失败、网络断开、JSON 异常、provider 配置错误、native runtime 异常 —— 这些都**没有** result message，因此也没有 `terminal_reason`）。

**重新界定范围：附加层**

| 场景 | 有 terminal_reason? | 处理 |
|------|---------------------|------|
| SDK 正常 result（模型停、max_turns、压缩、工具延迟等） | ✅ 有 | 用 `terminal_reason` 增强结束气泡 + Sentry tag |
| CLI spawn / 认证 / 网络 / JSON 异常 / provider 配置 | ❌ 无 | 继续走 `error-classifier.ts` 主干 |
| Native runtime 错误 | ❌ 无 | 走 `reportNativeError` 主干 |

**改动：**

1. **消息解析层**（增量）
   - `src/lib/claude-client.ts` stream 消费循环：读到 `SDKResultMessage` 时，如果 `terminal_reason` 存在，挂到 session 结束事件上
   - 不存在时不做特殊处理，保持原流程

2. **i18n 文案（只覆盖 12 种 + `unknown` 兜底 = 13 条中英）**
   - `src/i18n/zh.ts` / `en.ts` 加 `terminal.blocking_limit` … `terminal.completed`，加 `terminal.unknown`
   - 每条给具体指引（如 `prompt_too_long` → 「可触发压缩 / 切长上下文」）
   - 未识别的 terminal_reason 字符串回退到 `terminal.unknown`

3. **UI 展示（附加 icon + 文案）**
   - `src/components/chat/ChatView.tsx` / `MessageItem.tsx` 结束气泡：
     - 有 `terminal_reason` → 显示对应 icon + 具体文案
     - 无 `terminal_reason` + 无 error → 保持现有「done」样式
     - 有 error → 保持现有 `error-classifier` 文案（主干不变）
   - `hook_stopped` / `stop_hook_prevented` 可点击跳 hook 配置

4. **Sentry 增强（而非重构）**
   - `error-classifier.ts` `reportToSentry` 的 extra 里新增 `terminal_reason` 字段
   - `aborted_streaming` / `aborted_tools` 跳过 Sentry（与现有 abort 正则合并，不重复过滤）
   - fingerprint 保持现有结构，`terminal_reason` 仅作为 tag

**验收标准：**
- 12 种 reason 在 UI 上都能区分展示（有 `terminal_reason` 的会话）
- 现有 `error-classifier.ts` 主干文案**不变**，继续处理无 result 的错误
- Sentry 按 `terminal_reason` 标签分组后能看到完成态分布，但事件总数不会显著下降（我们不把 aborted 以外的结束态当 error 上报）
- `prompt_too_long` chip 的所有「重试」按钮都走**二次确认对话框**，上一条 user message 在任何场景下都保留为 draft，不发生自动 replay

**风险：** 低 — 纯附加层

---

### Phase 1b — `TerminalReason` chip **可操作按钮**（闭环 Phase 1）

**前提：** Phase 1 已完成（chip 展示 + i18n + Sentry tag 已上线）。

**👤 用户今天的痛点：** Phase 1 的 chip 只是告诉你"为什么停下来"（如"上下文已满"），但**无法一键解决**。用户看到红 chip 后要：
1. 自己去右上角找"压缩历史"按钮 → 点 → 等压缩 → 手动重发上一条
2. 或者去 Settings 打开 1M context → 回 chat → 重发
3. 或者从模型选择器切到 Sonnet → 重发

链路长、容易中断。正是"看到 chip 也只能将就"的典型。

**🎨 改动后 UI 长什么样：**

按 `terminal_reason` 决定出哪些按钮（按钮挂在 chip 同行右侧）：

| reason | 按钮组 | 副作用 |
|--------|-------|--------|
| `prompt_too_long` | `压缩并重试` · `开启 1M 并重试` · `仅压缩` | 重试动作都经二次确认 |
| `blocking_limit` / `rapid_refill_breaker` | `切换到 Sonnet` · `查看额度详情` | 切模型经二次确认 |
| `max_turns` | `继续` | 直接发送 `continue` prompt，无需确认 |
| `hook_stopped` / `stop_hook_prevented` | `查看 Hook 配置` | 跳转 Settings → Hooks |
| `tool_deferred` | （留给 Phase 7b 的 deferred-tool 响应卡片接管） | — |
| `image_error` | `重新上传` | 清空当前图片 + focus 上传 |
| `model_error` | `重试` | 二次确认后直接重发上一条 |
| 其他 / `unknown` | 无按钮（chip 只展示） | — |

**二次确认对话框模板**（所有"重试"类按钮共用）：
```
┌──────────────────────────────────────────────┐
│ 确认操作                                       │
│                                              │
│ 将{动作描述}并重发上一条消息。                   │
│ 如果上一轮已有工具副作用，重发可能重复执行。       │
│                                              │
│ [取消]              [确认]                    │
└──────────────────────────────────────────────┘
```

用户取消 → 上一条 user message 保存为输入框 **draft**，用户自行决定（发送 / 编辑 / 放弃）。

**🔁 交互脚本（`prompt_too_long` 最复杂路径）：**

1. 长对话第 50 条消息，模型返回一半戛然而止
2. 出现 🔴 `上下文已满` chip + `[压缩并重试]` `[开启 1M 并重试]` `[仅压缩]` 三个按钮
3. 用户点 `压缩并重试`
4. 弹二次确认对话框
5. 用户点 `确认`
6. chip 变为 ⏳ `正在压缩...`，compressor 运行（复用 Phase 6 的 PostCompact 分隔条显示进度）
7. 压缩完成 → 自动重发上一条 user message
8. 新响应开始流式输出

**替代路径：** 用户点 `仅压缩` → 跳过二次确认直接压缩（因为没 replay 风险）→ 上一条消息保留为 draft → 用户自己决定下一步。

**🔎 发现路径：** chip 本身被动触发（Phase 1 已加），按钮天然在用户视线焦点（刚结束的消息下方）。**无需 onboarding**。

**改动清单：**

1. **`TerminalReasonChip.tsx` 扩展**
   - 当前只渲染 label，加 `actions?: ActionButton[]` 字段
   - 每个 reason 在常量表里映射到对应的 action 列表
   - 按钮点击触发 `onActionClick(actionId)` 回调上传到 ChatView

2. **`ChatView.tsx` 挂载 action handler**
   - 新建 `handleTerminalAction(actionId)` 集中分发：
     - `compress_and_retry` → 调 compressor + 二次确认 + draft 保留 + replay
     - `enable_1m_and_retry` → 打开 context1m + 二次确认 + replay
     - `compress_only` → 压缩不重发
     - `switch_to_sonnet` → `setCurrentModel('sonnet')` + 二次确认 + replay
     - `continue_max_turns` → 直接发 "continue" 作为新 prompt
     - `open_hook_settings` → `router.push('/settings#hooks')`
     - `retry_image_upload` → 清空 attachments + focus file picker
     - `retry_simple` → 二次确认 + replay

3. **二次确认组件**
   - 复用现有 `ConfirmDialog`（Phase 2 限流恢复面板也会用）
   - 动态文案按 action 分路

4. **Draft 保留**
   - 用户取消任何重试动作时，把上一条 user message content 写入 `MessageInput` 的 textarea（覆盖或追加？按现有 draft 行为）
   - 如果输入框已有未发送内容，弹小对话框"保留当前草稿 / 替换为上一条"

5. **i18n**
   - 按钮文案、二次确认文案、所有 action 的具体动词（中英各约 20 条）
   - 文件：`src/i18n/zh.ts` + `en.ts`，key 前缀 `terminalAction.*`

6. **单测**
   - TerminalReasonChip render 每种 reason 下的按钮组合
   - handleTerminalAction 对每个 actionId 的分支（用 mock 函数验证子系统被调）

**改动文件预估：**
- `src/components/chat/TerminalReasonChip.tsx` — 扩展 ~50 行
- `src/components/chat/ChatView.tsx` — 新增 handler ~80 行
- `src/components/ui/ConfirmDialog.tsx` — 可能已存在；若无新建 ~30 行
- `src/i18n/zh.ts` + `en.ts` — 各 ~20 条
- `src/__tests__/unit/terminal-reason-chip.test.tsx` — 新建

**验收标准：**
- 7 种有 action 的 terminal_reason 下按钮都能点、都能跑通
- 每个"重试"类按钮都弹二次确认，取消后上一条消息保留为 draft
- `compress_only` / `continue` / `open_hook_settings` 不弹二次确认（非破坏性）
- 输入框里的用户 draft 不被任何 action 无警告覆盖
- 单测覆盖所有 action 分支

**风险：** 中
- 每个按钮都要接一个子系统（compressor / context1m toggle / model switch / router）
- 每个子系统的错误路径（压缩失败、1M 切换失败、切模型失败）要有对应降级
- Draft 保留策略需要与现有 MessageInput 的 autosave 协同
- 中等工作量（预计 2-3 天）

**用户价值形态：** A（显性 UI，高价值）。

---

### Phase 2 — `SDKRateLimitInfo` 订阅路径 UI 增强（不动主干）

**背景：** 0.2.111 新增 `SDKRateLimitInfo`（`sdk.d.ts:2701`）：`status` = `allowed | allowed_warning | rejected`，`rateLimitType` = `five_hour | seven_day | seven_day_opus | seven_day_sonnet | overage`，附带 `resetsAt` / `utilization` / overage 相关字段。通过 `SDKRateLimitEvent` (`sdk.d.ts:2688`) 在 stream 里推送。

**👤 用户今天的痛点：**
- 使用 Claude 订阅版的用户突然看到一个红色报错 `429 Too Many Requests` 或者 `Rate limit exceeded`
- 不知道还剩多少额度、多久恢复
- 不知道 Opus 满了 Sonnet 是不是还能用
- 也不知道这个限制是 5 小时的还是 7 天的

**🎨 改动后 UI 长什么样：**

分三层 UI（仅订阅路径显示，非订阅路径保持现状）：

**① 平时：ProviderBadge 旁小环形图标**
- 右上角 provider 名称后加一个 8px 的小圆环
- 环的填充比例 = `utilization`（0%-100%）
- hover 弹 tooltip：「Opus 5 小时额度 · 已用 47% · 剩 2 小时 13 分重置」
- 无数据时隐藏（不是空环）

**② 预警：输入框上方黄色 banner（`allowed_warning`）**
```
┌──────────────────────────────────────────────┐
│ ⚠ Opus 5 小时额度剩余 23% · 2 小时 13 分后重置  │  [切 Sonnet]
└──────────────────────────────────────────────┘
```
- 可关闭（×），关闭后当前会话内不再弹
- 下次命中 `allowed_warning` 重新出现

**③ 阻断：**可关闭**恢复面板（`rejected`）**

Codex 校准点：浮层**不可关闭 + 自动重发**是反模式——用户可能想复制内容、改 prompt、等恢复、切其他 provider；而且上一轮可能已有工具副作用，自动重发到另一个模型可能重复执行。
```
┌─────────────────────────────────────────┐
│                                    [×]  │
│   🚫 Opus 7 日额度已用尽                  │
│                                         │
│   还剩 3 天 14 小时 22 分重置              │
│                                         │
│   上一条消息已保存为草稿                     │
│                                         │
│   当前 provider 可尝试的替代模型：             │
│   ● Sonnet 4.6                           │
│   ○ Haiku 4.5                            │
│   （额度状态未知，切换后才知晓是否可用）          │
│                                         │
│   [ 切换并重试 ]  [ 只切换不重试 ]            │
│   [ 查看额度详情 ]                        │
│                                         │
└─────────────────────────────────────────┘
```
- **可关闭**（右上 × 或 ESC 键）：关闭后面板消失，上一条消息作为 draft 留在输入框，用户自行决定
- **替代模型列表的能力边界（Codex 校准）**：`SDKRateLimitEvent` 只携带本次事件的 `rate_limit_info`，**不是所有模型 / 桶的 quota snapshot**。我们能**可靠判断**的只有：
  - ✅ 模型已在当前 provider 配置
  - ✅ 协议 / auth 兼容
  - ❌ 无法证明目标模型当前非限流
  - ❌ 无法显示目标模型剩余百分比
- 只有在**本次会话周期内已有对应 model/bucket 的 `SDKRateLimitEvent` 快照且未过期（<10 分钟）**时，才在该模型条目旁显示 `· 5h 额度剩 X%`；否则不显示额度信息，只说「可尝试」
- 若切换到目标模型后立即又触发限流，走新一轮 Phase 2 面板（不 fall back 到上次的）
- 「切换并重试」是**显式二次动作**：弹一个确认「将切到 Sonnet 4.6 并重发上一条消息。上一轮如有工具副作用可能重复执行。[取消] [确认切换]」
- 「只切换不重试」：只换模型、不碰消息，输入框保留 draft
- 「查看详情」：打开 Settings → Provider

**🔁 交互脚本（`seven_day_opus` 场景，修正版）：**
1. 用户发送第 N 条消息
2. SDK 返回 `SDKRateLimitEvent { status: 'rejected', rateLimitType: 'seven_day_opus' }`
3. 本轮消息终止（与 Phase 1 的 `blocking_limit` chip 联动）
4. 可关闭恢复面板弹出 + 上一条消息保存为 draft
5. 用户有四个选择：
   - 直接关掉 × → 自己处理（可能去 Settings 切 provider、或等恢复）
   - 「切换并重试」→ 二次确认 → 模型切换 + 重发 draft
   - 「只切换不重试」→ 模型切换 + draft 留在输入框
   - 「查看额度详情」→ 打开 Settings

**🔎 发现路径：**
- **被动触发**（收到 rate limit event 自动显示）
- ProviderBadge 小环形图标是**持续可见**（让用户有「额度快满了」的预感，而不是突然阻断）
- 首次出现阻断浮层时，在 action 区额外加一个「了解 Claude 订阅额度规则」链接（一次性外链，不强制）

**非订阅路径（API key / OpenRouter / OpenAI-compat / Native）**：**UI 完全不变**，保持现有 `error-classifier.ts` 的正则兜底文案。

**Codex 校准点：** typings 里注释明确「**Rate limit information for claude.ai subscription users**」（`sdk.d.ts:2691, 2699`）。CodePilot 的 provider 矩阵里：
- ✅ 会收到：Claude Code SDK（OAuth 订阅路径）
- ❌ 不会收到：API key / Native runtime / OpenAI-compatible / OpenRouter / 三方 Anthropic 代理

因此 **不能** 用它替换 `error-classifier.ts` 的 429 正则主干，也**不能**把「group 级 rate limit hint」放到 `/api/providers/models/route.ts`（那是静态模型列表，限流是运行时事件）。

**重新界定范围：订阅路径 UI 增强层**

| 路径 | 限流处理主干 | 限流增强 |
|------|--------------|----------|
| Claude Code SDK + OAuth 订阅 | `SDKRateLimitInfo`（新） | 倒计时 + 模型切换建议 |
| API key / Native / OpenAI-compat / OpenRouter / 三方代理 | `error-classifier.ts` 正则（保留） | 无（保持现状） |

**改动：**

1. **消息管道增量消费**
   - `src/lib/claude-client.ts:395` stream 循环识别 `SDKRateLimitEvent`（type: `'rate_limit_event'`）
   - 仅当 provider 属于 OAuth 订阅路径时转发到前端（通过 provider metadata 判断）

2. **前端倒计时 UI（订阅路径限定）**
   - `src/components/chat/MessageInput.tsx` 附近加 Banner（只在订阅路径显示）
   - `allowed_warning` → 黄色预警 + `utilization` 进度条
   - `rejected` + `five_hour` → 可关闭恢复面板（见下方「③ 阻断」）：倒计时 + 替代模型列表 + 显式二次确认
   - `rejected` + `seven_day_opus` → 同上：展示 Sonnet 作为可尝试替代 + 「切换并重试」二次确认；**不自动 replay**
   - 读 `overageStatus` / `overageDisabledReason` 做额外提示（如 `out_of_credits`）

3. **模型切换 suggestion（会话级，不挂模型列表）**
   - `seven_day_opus` 事件到达时查当前会话 provider 的 roleModels，动态构造「切 Sonnet」按钮
   - **不**修改 `/api/providers/models/route.ts`（限流是会话事件不是静态元数据）

4. **`error-classifier.ts` 保持不动**
   - 429 / retry 正则继续作为 **所有非订阅路径的主干**
   - 订阅路径收到 `SDKRateLimitInfo` 时可以跳过 classifier 的 429 匹配（避免双重提示）

**验收标准：**
- 订阅路径 Opus 限流时 UI 能显示正确剩余时间 + 可关闭恢复面板
- 恢复面板的替代模型列表**只声明「可尝试」**；额度信息只在本会话内有对应 bucket 快照（<10 min）时才显示
- 「切换并重试」走**显式二次确认**，不发生自动 replay；任何时刻用户都能关闭面板让上一条消息以 draft 形式留在输入框
- **API key / OpenRouter / OpenAI-compat 路径行为不变**，限流体验保持现状
- 订阅路径不会同时弹 `error-classifier` 的正则文案和 `SDKRateLimitInfo` 的 Banner

**风险：** 低 — 订阅路径专属增强，不动任何主干

---

### Phase 2b — SDK 类型适配（capability cache / Query / Options）

**背景：** typings 从 2189 行扩到 4827 行，`ModelInfo`、`Options`、`SDKMessage` 等类型都有字段增量。Phase 0 输出的 diff 摘要会指出具体破坏面。

**👤 用户今天的痛点：** 无（这是纯代码层 Phase，用户不感知）

**🎨 改动后 UI 长什么样：** 无直接 UI 变化

**🔁 交互脚本：** 无

**🔎 发现路径：** 纯静默适配，不需要用户感知。**承认这是唯一一个没有 UI 表现的 Phase**，因为它是其他 Phase 的基础设施。

**改动：**

1. **`src/lib/agent-sdk-capabilities.ts`** — 升级后的 `ModelInfo` 新增字段纳入缓存（如果有）
2. **`src/lib/conversation-registry.ts`** — `Query` 类型的新方法（`forkSession`、`getContextUsage`、`reloadPlugins` 等）先占位，不调用
3. **`src/types/index.ts`** — 如果 ModelMeta / SessionMeta 缺字段，按 SDK 扩展
4. **`src/lib/claude-client.ts`** — `Options` 若新增 `onElicitation`、`settingSources` 等字段，按当前行为保留 undefined（不接入，仅声明）

**验收标准：**
- `tsc --noEmit` 零错误
- 新 Query 方法未被意外调用（grep 确认）

**风险：** 低 — 仅类型层面

---

### Phase 3 — `startup()` / `WarmQuery` **窄场景**采纳（Layer B）

**背景：** 0.2.111 新增 `startup(params?: { options?: Options }): Promise<WarmQuery>`（`sdk.d.ts:4550`），预热 Claude Code subprocess。

**👤 用户今天的痛点：** 打开一个已有长对话 session，发第一条消息时感觉「卡了一下」才开始流式响应（1-3 秒延迟），与后续消息的流畅度形成对比，被感知为「这个 app 反应有点慢」。

**价值形态：B — 静默体感（Codex 校准后修正）**

上一版硬加了一个常驻 ⚡ 预热状态图标，这是**暴露内部实现状态**而不是用户价值——用户没有可操作动作，失败时还隐藏，反而增加一个需要解释的状态源。修正：**取消常驻 UI 指示**，只在以下三种场景才有可见反馈：

1. **预热仍在进行时用户就按了发送** → 发送按钮的 loading 状态比未预热时多一个「衔接中」的短态（比硬等 cold start 的停顿更平滑），不需要单独图标
2. **预热失败影响发送**（极端情况：预热拿到错误凭据导致正常 query 也失败）→ 在现有错误路径里走 Phase 1 的 terminal chip，而非专门的 warmup 失败 UI
3. **开发者诊断模式**（Settings → 高级 → Dev Tools 打开时）→ 显示预热状态计数、命中率、失败原因

**🎨 改动后 UI 长什么样：**

- **普通模式**：**无任何可见 UI**。用户不感知预热存在，只感知「发消息响应快了」。
- **开发者诊断模式**：Settings → 高级 → Dev Tools 里的 "SDK runtime stats" 面板新增一行「WarmQuery 命中率 / 平均预热耗时 / 最近 10 次失败原因」——这是给我们自己调优和排障用，不是面向普通用户。

**🔁 交互脚本：** 无主动交互脚本。用户从 Sidebar 点已有会话 → 稍等几秒 → 发消息 → 响应更快。这是**体感**不是**交互**。

**🔎 发现路径：** 不让用户发现。静默优化。

**效果量化（验收硬标准，达不到则砍）：**
- 打开已有会话到首字返回的 **p50 延迟下降 ≥ 30%**
- 发送按钮 loading 态无明显抖动（主观）
- WarmQuery 失败率 < 5%（从 Settings Dev Tools 监控）
- 以上任一指标未达则 Phase 3 整体不上线，代码保留在 feature flag 后

**Codex 校准点（关键约束，必须遵守）：**

| 约束 | typings 证据 | 对我们意味着 |
|------|--------------|--------------|
| WarmQuery 只能 `query(prompt)` **一次** | `sdk.d.ts:4800`「Can only be called once per WarmQuery」 | 不能做成共享池 |
| Options 在 `startup()` 时**固化** | `sdk.d.ts:4550-4552` 签名 | 预热时锁定的 cwd/model/provider env/permissionMode/mcpServers/systemPrompt/resume/canUseTool 后续不能改 |
| CodePilot 每次发送**动态组装** queryOptions | `src/lib/claude-client.ts:395` | 通用 provider 池会拿到错误 cwd / 凭据 / 权限 / MCP |
| 「Long Idle 空白」bug 根因**未证** | memory 里只记了症状 | 不能把此 bug 的修复挂钩 WarmQuery 验收 |

**重新界定范围：仅在「同 cwd + 同 provider + 同 permission + 同 model」的 resume 场景启用预热**

具体就是：用户打开某个已有会话时，背景预热一个以该会话当前配置为 Options 的 WarmQuery，等用户真的输入第一条消息时 consume。**不做** app 启动预热、provider 切换预热、idle 阈值重热。

**先 POC，再实施：**

1. **POC（阻塞 Phase 3 实施）**
   - 在 `src/__tests__/integration/warm-query-poc.test.ts` 写一个最小场景：打开已有 session → `startup(options)` 预热 → 等 2 秒 → 真发消息 → 测首字延迟 vs 冷启动基线
   - 同时跑一个对照：预热后**修改** cwd/permission 再发消息 —— 确认会 fail 或行为异常（证伪「能套用到切换场景」）
   - 产出：`docs/research/warm-query-feasibility.md`，包含时序图 + 实测延迟数据 + 边界场景列表

2. **实施（如果 POC 说值得做）**
   - `src/lib/claude-client.ts` 导出 `prewarmSessionQuery(sessionId, options)`，仅在 `ChatView` mount 到已有 session 时调
   - `src/lib/conversation-registry.ts` 存 `Map<sessionId, WarmQuery>`（一个 session 最多一个 WarmQuery）
   - 用户发消息时从 registry 取：取到 → `warmQuery.query(prompt)`；取不到 → 走原有 `query()` 路径
   - 切换会话 / 离开页面 / 修改 session 配置（model/permission）时 dispose 对应 WarmQuery
   - 预热失败 catch + log，不阻塞正常流程

3. **不做**
   - ❌ app 启动时预热 env provider
   - ❌ ProviderSelector 切换时预热
   - ❌ idle 阈值触发重热
   - ❌ 把 Long Idle 空白 bug 的修复挂钩到本 Phase（**另立 bug 工单**调查 `stream-session-manager` 的 snapshot/GC 生命周期）

**验收标准：**
- POC 时序图显示窄场景下首字延迟下降 ≥ 30%（宽场景不做验收）
- 切会话 / 改配置时无 WarmQuery 泄漏
- 原有 `query()` 路径行为**完全不变**
- Long Idle 空白 bug **不在**本 Phase 验收范围内

**风险：** 中 — 窄场景后风险可控；但 AsyncDisposable 的释放时机需要特别小心，Electron 窗口关闭 / 用户切换 / 睡眠唤醒等 lifecycle event 都要挂钩

---

### Phase 4 — Session fork / rename / tag / subagent 查询（Layer B）

**背景：** 0.2.111 新增：
- `forkSession(_sessionId: string, _options?: { upToMessageId?: string, title?: string }): Promise<ForkSessionResult>`（`sdk.d.ts:552-562`）
- `renameSession(_sessionId: string, _title: string, _options?: SessionMutationOptions): Promise<void>`（`sdk.d.ts:1938`）
- `tagSession(_sessionId: string, _tag: string | null, _options?: SessionMutationOptions): Promise<void>`（`sdk.d.ts:4627`）——**单 tag，不是多 tag**
- `listSubagents` / `getSubagentMessages` / `getSessionInfo`

**👤 用户今天的痛点（分三种用户场景）：**

1. **Fork 场景**：用户跟 Claude 讨论方案 A 到一半想换方案 B 试试。现有机制只有 rewind（覆盖历史），试 B 就丢了 A 的后续。用户只能在脑子里记着 A 的结果，或者复制对话到外部文档。
2. **Tag 场景**：用户积累几十上百个 session 后，sidebar 就是一列长长的 title。找某个 session 只能靠搜索 title 关键词。没有「项目分组」/「状态分组」这个维度。
3. **Subagent 场景**：让 Claude 跑一个长 plan（比如 5 个子任务），subagent 的消息全部铺平在主聊天流里，刷屏严重。用户想看主 agent 的 summary 要不断往下滚，过程中丢失上下文。

**🎨 改动后 UI 长什么样：**

**① Fork UI**

**首版（Path A）：仅在已有 rewind point 的 user message 上展示 Fork**

MessageItem hover 时，**仅 user 消息**右上角（已在 rewind point 列表的）出一个 `⋯` 菜单：
```
┌─────────────────────┐
│ 📋 复制              │
│ ↩️ 回滚到这里         │
│ 🌿 从这里分叉对话     │  ← 新增（首版仅 user message）
│ 📎 引用              │
└─────────────────────┘
```

Assistant 消息 hover 时菜单里**没有** Fork 项（首版的已知限制，等 Phase 4b 全消息映射落地后再补）。

分叉后：
- 自动跳转到新 session
- 顶部面包屑显示 `来自：《原会话标题》 · [返回]`
- Sidebar 原会话下方缩进 2 格显示新 session（树形）：
  ```
  ▸ 2026-04-17 方案讨论
    └─ 方案 B (fork)            ← 新
  ▸ 2026-04-16 bug 排查
  ```

**② Tag UI（单 tag 对齐 SDK）**

Sidebar session 条目右侧出一个小色标点 + tag 文字：
```
▸ 方案讨论              🟢 项目A
▸ bug 排查              🔴 紧急
▸ 随便聊聊               —
```

顶部 Sidebar 加一个 tag 筛选器：
```
[全部 ▼]  [新建对话 +]
─────────
▸ 🟢 项目A (5)
▸ 🔴 紧急 (2)
▸ 🔵 参考 (3)
```

打 tag 的操作：session hover 右键菜单 / 顶部 `⋯` 下拉 → 「添加标签」→ 输入或选已有 → Enter。
单 tag 语义：已有 tag 的 session 再打新 tag 会替换（弹确认对话）。

**③ Subagent 可视化**

Subagent 的消息折叠为一张卡片插在主聊天流里：
```
┌─────────────────────────────────────┐
│ 🤖 子 Agent：代码审查                  │
│ ✅ 已完成 · 14 步操作 · 3 个文件改动     │
│                          [ 展开详情 ▸ ] │
└─────────────────────────────────────┘
```

点 `展开详情` → 右侧 drawer 滑出，展示完整子 agent 消息链；drawer 不挡主对话流。

**🔁 交互脚本（Fork 场景）：**
1. 用户在「方案讨论」会话里聊到第 8 条（自己发出的 user 消息，且是带回滚点的那种——即已有 rewind 按钮的那条），觉得模型给的方案 A 可以先放着，想试方案 B
2. hover 到那条**带回滚点的 user 消息**右上角 → 出 `⋯` 菜单 → 点「🌿 从这里分叉对话」（不带回滚点的 user 消息菜单里这项是禁用态 + tooltip「这条消息还不能分叉」）
3. 弹一个轻量对话框：「新会话标题：[方案讨论 (fork) ✏]  [取消] [创建]」
4. 点创建 → 自动跳转到新会话 → Sidebar 树形结构更新 → 新会话继承到该消息为止的所有消息、provider/model/permission 全部一致
5. 用户在新会话里开始讨论方案 B；需要看回方案 A 时点面包屑「返回原会话」

**🔎 发现路径：**
- **Fork**：hover 发现 + 首次使用一次性气泡引导（「试试**从带回滚点的用户消息**分叉对话」——只弹一次，存 local settings；文案明确「带回滚点」避免与 Path A 禁用态冲突，也不承诺首版做不到的 assistant 分叉）
- **Tag**：Sidebar 顶部筛选器持续可见 + 新建会话时弹出的对话框可选 tag
- **Subagent 卡片**：被动触发（subagent 运行时自动折叠），配文案「展开详情 ▸」即自解释

**Codex 校准点（含第二轮追加）：**
- sessionId 参数指 **SDK session UUID**（对应 `chat_sessions.sdk_session_id`），不是 `chat_sessions.id`
- 参数是 `upToMessageId` 不是 `fromMessageId`
- `tagSession` 单 tag 语义，原计划的多对多 `session_tags` 表会让 SDK transcript metadata 和 DB 状态双源分裂
- **`upToMessageId` 是 Claude Code transcript 里的 message id**，但 CodePilot DB messages 只有本地 message id；现有 `rewind` 按位置把 SDK `userMessageId` 映射到可见 user message，**不覆盖 assistant message**。承诺「assistant 消息也能 fork + 按 upToMessageId 复制 DB messages」在没有 SDK↔DB message 映射表时会落空。

**前置子任务 A：SDK ↔ DB message id 映射**（阻塞 Fork 落地）

memory `Rewind Point Emission Rules` 的现状：
- 只在 prompt-level user messages 上发 rewind point（`parent_tool_use_id === null`）
- 前端按位置映射（第 N 个 rewind point = 第 N 个可见 user message）
- 没有 assistant message 的 SDK id
- 没有完整的 SDK message id ↔ DB message id 映射表

**两条路径选一：**

1. **Path A（推荐首版）：只允许从已有 rewind point 的 user turn fork**
   - UI 只在 user 消息 hover 时展示「🌿 从这里分叉」，assistant 消息不展示
   - 服务端用现有 rewind 的 `sdkUserMessageId` 当作 `upToMessageId`
   - DB messages 复制按「到该 user message 为止」的位置切片（现有 rewind 逻辑已覆盖）
   - 能力弱化但立刻可做，先验证产品价值

2. **Path B（后续迭代）：全消息 ID 映射**
   - DB messages 表加 `sdk_message_id TEXT INDEX` 列
   - 改造 stream 消费循环：对 SDK 每条 message（含 assistant）记录 id 写入 DB
   - 历史 session 需要 transcript backfill（从 `~/.claude/projects/*` 读 transcript 导入 mapping）
   - assistant 消息 hover 也能 fork
   - 工作量大，放 Phase 4b 独立做

**决策：首版走 Path A**，产品价值先验证；Path B 作为 Phase 4b 在用户反馈「想从 assistant 消息分叉」强烈时再做。

**前置子任务 B：ID 映射与 source-of-truth 设计**（阻塞 Phase 4 其余工作）

产出 `docs/handover/session-id-mapping.md`，明确：

1. **ID 语义**
   - `chat_sessions.id`：CodePilot 本地 DB 主键，UI 用
   - `chat_sessions.sdk_session_id`：SDK 分配的 session UUID，调用 SDK API 用
   - `SDKResultMessage.session_id` / `forkSession` 结果：SDK UUID
   
2. **ID 映射操作**
   - DB id → SDK UUID：`getSession(dbId).sdk_session_id`
   - SDK UUID → DB id：加索引 `CREATE INDEX idx_sessions_sdk_id ON chat_sessions(sdk_session_id)`

3. **Source of truth**
   - **Title**：SDK 主写（`renameSession`），DB 镜像（订阅 `SDKSessionStateChangedMessage` 更新）
   - **Tag**：SDK 主写（`tagSession`），DB 镜像
   - **Messages**：按现状，DB 持有完整历史（用于渲染），SDK 持有 transcript（用于 resume）
   - **Parent-child 关系**：DB 加 `parent_session_id` 列（SDK 侧没有这个概念，属 CodePilot 扩展）

4. **DB migration**（遵循 `feedback_db_migration_safety`：永不 DELETE，只 backfill）
   - `chat_sessions` 加 `parent_session_id TEXT DEFAULT ''`
   - `chat_sessions` 加 `tag TEXT DEFAULT ''`（单 tag，对齐 SDK）
   - **不**新建多对多 `session_tags` 表

**实施（映射设计通过后）：**

1. **Fork（Path A 首版：本地切点 + SDK 校验）**
   - 新建 `src/app/api/chat/fork/route.ts`
   - **入参（含本地切点，Codex 校准）**：`{ dbSessionId: string, dbMessageId: string, title?: string }`
     - `dbMessageId` 是本地 user message 的 DB id（**不是** SDK transcript id）
     - 由 UI 从 hover 的 user MessageItem 直接拿，不需要用户操心
   - **服务端流程：**
     1. 加载父 session：`parent = getSession(dbSessionId)`，拿 `parent.sdk_session_id`
     2. **前置校验（Path A 硬约束）：**
        - 父 session 必须有非空 `sdk_session_id`（走过 SDK 路径）
        - `dbMessageId` 必须是 user 消息（role === 'user'）
        - 该 user 消息必须在 conversation-registry 维护的 **已知 rewind point 列表**里（memory 规则：prompt-level user message + `parent_tool_use_id === null`）
        - 任一校验失败 → 返回 400 + 明确错误原因（告诉前端这条消息不能 fork）
     3. 从 rewind point 映射取该 dbMessageId 对应的 `sdkUserMessageId`（现有机制已按位置映射）
     4. `result = await forkSession(parent.sdk_session_id, { upToMessageId: sdkUserMessageId, title })`
     5. 新建 DB session：`parent_session_id = dbSessionId`, `sdk_session_id = result.newSdkSessionId`, working_directory / provider / model / permission_profile **从父会话继承**
     6. 从父 session 复制 messages **按本地位置**切片（到 `dbMessageId` 所在位置为止）到新 DB session（UI 可立即渲染）
   - **UI：** `MessageItem.tsx` **user 消息上才出** hover 菜单「🌿 从这里分叉」；assistant 消息不展示（首版限制）
   - **禁用态：** 如果该 user 消息不在 rewind point 列表里（如 session 还没走过 SDK），菜单项禁用 + tooltip「这条消息还不能分叉」
   - 侧边栏缩进树展示

2. **Rename（按 runtime 分流，Codex 校准）**

   不是所有 session 都有 `sdk_session_id`。以下三类会话存在空 UUID：
   - 本地新建会话（还没发第一条消息）
   - Native runtime / 直连 API key 路径走 native-runtime 的会话
   - 导入 / 未跑过 SDK query 的会话
   
   **分流策略：**
   | 会话状态 | rename 路径 |
   |---------|-------------|
   | `sdk_session_id` 非空 | SDK 主写（`renameSession(sdkUuid, title)`） + DB 镜像 |
   | `sdk_session_id = ''` | **DB-only**（`UPDATE chat_sessions SET title = ?`），不调 SDK |
   | DB-only 会话后来拿到 `sdk_session_id`（首次 SDK query 完成） | **reconcile**：把 DB 当前 title 通过 `renameSession` 推给 SDK 一次，后续回归 SDK 主写 |
   
   - 订阅 `SDKSessionStateChangedMessage`（如果 SDK 推送 title 变更）做被动同步；仅对 SDK 会话有效

3. **Tag（单 tag 语义 + 同 Rename 分流）**
   - Sidebar session 条目加单 tag 输入框（非多选）
   - **分流同 Rename**：SDK 会话走 `tagSession(sdkUuid, tag || null)` + DB 镜像；空 UUID 会话 DB-only；首次拿到 UUID 时 reconcile
   - 搜索/筛选用 DB 索引；列标签颜色仍可做，但**不支持一个会话多个 tag**
   - 接受「功能比原设想弱一点」换「与 SDK 一致的 source of truth」

4. **Subagent 可视化（仅 SDK 会话）**
   - 入口条件：`chat_sessions.sdk_session_id` 非空 **且** 本会话收到过 SDK 的 subagent 事件（如 `SDKTaskStartedMessage` / `SDKTaskUpdatedMessage` 含 subagent 标识）
   - 条件满足 → 调 `listSubagents(sdkUuid)` + `getSubagentMessages(sdkUuid, subagentId)` 渲染卡片
   - 不满足（空 UUID 会话 / Native runtime / 导入会话 / 未产生 subagent）→ **不展示 subagent 卡片**，保持铺平渲染现状
   - per-session cache（与现有 per-provider capability cache 同模式）

**验收标准（按会话 runtime 分段）：**

- `docs/handover/session-id-mapping.md` 明确所有 ID 语义和 SoT
- **Fork**：父会话保留 / 子会话独立 / 缩进树正确展示；**仅 `sdk_session_id` 非空的父 session 且目标为带 rewind point 的 user 消息**才能 fork，其余 hover 菜单项为禁用态
- **Rename / Tag 三段验收（对应三种 session 状态）：**
  - `sdk_session_id` 非空的会话：SDK 与 DB 一致（双写 + 被动同步）
  - `sdk_session_id = ''` 的会话：DB-only 可 rename / tag，不调 SDK，不报错
  - 首次拿到 `sdk_session_id` 后的 reconcile：DB 当前 title / tag 成功推给 SDK，之后回归 SDK 主写保持一致
- **Subagent**：仅在 SDK 会话收到过 subagent 事件时卡片才出现；非 SDK 会话 / 未产生 subagent 场景保持铺平渲染无任何残留

**风险：** 中
- DB migration 严格走 backfill
- 双写失败（SDK 成功 DB 失败，或反过来）需要 retry / 对账逻辑

---

### Phase 5 — `getContextUsage()` 活跃会话**展示/校准**（Layer B）

**背景：** 0.2.111 在 Query 实例上提供 `getContextUsage(): Promise<SDKControlGetContextUsageResponse>`（`sdk.d.ts:1827`）。

**👤 用户今天的痛点：** MessageInput 右下角的 context indicator 显示「剩余 87K」但实际发一条就溢出了，或者显示「还剩一半」但实际上还能发很多条。**估算偏差 15-20%** 让用户无法判断「还能发多少」。手动压缩时也不知道压缩前后的真实占用差。

**Codex 校准点：** `getContextUsage()` 是 Query 实例方法，stream 结束后 active Query 被 unregister；历史 session 打开 / 压缩按钮点击时通常**没有活跃 Query 实例**可调。实际上只有三种可调度的数据源，UI 必须显式区分。

**三态展示原则：**

| 时机 | 数据源 | UI 标识 |
|------|-------|--------|
| 正在生成时 | `getContextUsage()` 实时调 | 🎯 **精确** |
| 生成刚完成 / 未超时 | 最后一次 usage 快照 + 时间戳 | 📌 **精确（N 秒前）** |
| 没有快照 / 历史 session / 超时 | `context-estimator` | ~ **估算** |

**🎨 改动后 UI 长什么样：**

**① 活跃会话 context indicator 精度提升（分三态）**

MessageInput 右下角的环形图标：
```
生成时：         [🎯 127K/200K]      ← 实时精确
刚完成(<60s)：   [📌 127K/200K]      ← 快照精确
历史/无快照：    [~ 145K/200K]       ← 估算标识
```

hover 显示具体来源：
```
正在生成时:
┌─────────────────────────┐
│ 🎯 上下文占用（实时）      │
│ 127,432 / 200,000        │
└─────────────────────────┘

刚完成:
┌─────────────────────────┐
│ 📌 上下文占用（45 秒前快照） │
│ 127,432 / 200,000        │
│ 发送新消息后自动更新        │
└─────────────────────────┘

历史 session:
┌─────────────────────────┐
│ ~ 上下文占用（估算）       │
│ ~145,000 / 200,000       │
│ 准确值将在下次生成时获取     │
└─────────────────────────┘
```

**② 手动压缩确认对话框（标注来源）**

用户点「压缩历史」按钮时弹对话框，**显式标注数据是精确还是估算**：
```
┌──────────────────────────────────┐
│ 压缩对话历史                         │
│                                  │
│ 当前占用: 127,432 tokens (64%)     │
│         🎯 精确（45 秒前快照）        │
│                                  │
│ 预计压缩后: ~35,000 tokens         │
│            ~ 估算                 │
│                                  │
│ 将合并: 前 18 条消息 → 摘要         │
│                                  │
│ [取消]          [确认压缩]          │
└──────────────────────────────────┘
```
如果数据源是估算（历史 session、无快照），`当前占用` 一行也标 `~ 估算`，用户知道数据不准仍可决定是否压缩。

**🔁 交互脚本（按三态规则）：**

**场景 A：正在生成时**
1. 用户消息流式返回中，ring 显示 🎯 实时值
2. hover → tooltip「🎯 上下文占用（实时）· 127K / 200K」

**场景 B：刚完成未超时（<60s）**
1. 对话完成，active Query unregister，但本轮最后一次 usage 仍缓存在 session 上
2. ring 显示 📌 快照值
3. hover → tooltip「📌 上下文占用（45 秒前快照）· 127K / 200K · 发送新消息后自动更新」

**场景 C：历史 session / 无快照 / 超时**
1. 用户从 Sidebar 切回一个旧 session，无 active Query 也无有效快照
2. ring 显示 ~ 估算值
3. hover → tooltip「~ 上下文占用（估算）· ~145K / 200K · 准确值将在下次生成时获取」

**场景 D：手动压缩**
1. 用户点「压缩历史」
2. 对话框打开，按**当前可用数据源**填充 `当前占用` 一行：实时 🎯 / 快照 📌 / 估算 ~
3. 不强制调 `getContextUsage()`——该方法只有 active Query 才能调
4. 用户基于标注的数据源精度决定是否压缩

**🔎 发现路径：**
- Context ring 是**持续可见**的 UI，精度和来源标识实时变化
- hover tooltip 里的「估算偏差 +14%」仅在 dev mode 显示，不干扰普通用户
- 压缩确认对话框是**用户主动触发**（点压缩按钮时才出现），不是被动打扰

**Codex 校准点：**
- `getContextUsage()` 是 **Query 实例方法**，必须在 Query 初始化后才能调
- stream 结束后 active Query 会被 unregister；历史 session 打开 / 压缩按钮点击时通常**没有活跃 Query 实例**
- `src/app/api/chat/route.ts` 的压缩决策发生在**创建 Query 之前**（preflight）——要先知道是否压缩才决定传什么 history
- 时序悖论：要用 SDK 的 context usage 做压缩决策 → 必须先建 Query → 但建 Query 又需要已压缩的 history

**重新界定范围：活跃会话展示 / 估算器校准，不替 preflight，不强取准确值**

| 用途 | 做 | 不做 |
|------|-----|------|
| 活跃 Query 实时 context 占用显示 | ✅ `getContextUsage()` 实时调 + 标 🎯 | — |
| 活跃 Query 结束后的 context 展示 | ✅ 用最后一次 usage 快照 + 时间戳标 📌 | — |
| 历史 session / 无快照 | ✅ 回退 estimator + 标 ~ | — |
| 手动压缩前的确认对话 | ✅ 按当前可用数据源填充，**显式标注**来源精度 | ❌ **不**强调一次 `getContextUsage()` |
| 估算器校准 | ✅ 活跃 Query 每次消息完成后对比 estimator vs SDK 官方 | — |
| **Preflight 压缩触发决策** | ❌ 继续用 `context-estimator` | — |
| **替换 `context-pruner` / `context-compressor` 阈值** | ❌ 保持现状 | — |

**改动：**

1. **前端 indicator 三态实现**
   - 新建 `src/lib/context-display-source.ts`：封装「当前应展示哪种数据源」的决策（active Query → SDK 实时；有快照 → 快照 + 时间戳；否则 → estimator）
   - `src/lib/conversation-registry.ts` 扩展：保留每个 session 最后一次 usage 快照 + 时间戳（60s TTL）
   - `MessageInput.tsx` 附近 context ring：根据决策函数返回的 source 渲染对应 icon / tooltip
   - 开发者模式展示 estimator 值 vs SDK 值的差值（仅在有精确值时）

2. **估算器校准数据收集**
   - **活跃 Query** 每次消息完成后，从最后 usage 与 estimator 对比 → 写入本地统计（不上报）
   - 没有活跃 Query 的场景不强行调 `getContextUsage()`
   - 如果偏差持续 > 20%，在 dev console log 警告

3. **手动压缩对话（按数据源精度标注）**
   - 用户点「压缩历史」→ 对话框打开时按 `context-display-source` 决策渲染 `当前占用` 行
   - 三态标注：🎯 精确（活跃 Query）/ 📌 精确（N 秒前快照）/ ~ 估算
   - 不新发起 `getContextUsage()` 调用；如果只有估算也让用户看估算决策，而不是阻塞对话框

4. **与 Opus 4.7 Phase 3 联动**
   - 4.7 tokenizer 膨胀 1.0-1.35× 的 safety factor 可以基于这里收集的校准数据动态调整（不是直接替换 estimator）

**验收标准：**
- 活跃 Query 的 context indicator 显示与 SDK 官方数偏差 < 5%
- 刚完成 <60s 的 session 显示快照值并带时间戳
- 历史 session / 超时 session 回退 estimator 并标 `~`
- 压缩对话框在所有三种数据源下都能打开并显式标注精度
- Preflight 压缩决策链路**完全不变**

**风险：** 低 — 展示/校准性质，不改压缩主链路

---

### Phase 6 — 新 hooks 接入

**前置：** Phase 0 的 hook bug 复核结论为「修复」

**背景：** 0.2.111 新增多组 hook：`CwdChanged` / `FileChanged` / `InstructionsLoaded` / `PermissionDenied` / `PostCompact` / `StopFailure` / `TaskCreated` / `WorktreeCreate`。

**现状问题：** 如决策日志所述，当前 `queryOptions.hooks` 被主动关闭。我们靠流消息反推 PostToolUse / Notification。

**👤 用户今天的痛点（按 hook 分）：**

1. **PostCompact（压缩事件）**：用户正看着长对话往前滚，突然历史「变短了」，不知道发生了什么。只能看到右下角 ring 的数字下降。
2. **CwdChanged（工作目录切换）**：Claude 说「我切到另一个目录了」，但左侧 FileTree 还显示旧目录。用户得手动在文件树里点新目录才同步，容易搞错上下文。
3. **PermissionDenied（权限拒绝）**：工具调用被拒后，聊天流里只显示「用户拒绝了此工具」。多次被拒时（比如 5 次同类工具都被 always_deny）聊天流被这种提示刷屏，但没有「我今天一共拒了多少」的汇总。
4. **WorktreeCreate（worktree 创建，Codex 校准：限定 SDK runtime）**：**Claude Code SDK runtime 下** agent 创 worktree 时（如 Claude 调 `git worktree add` 的工具、或未来 SDK 内置 worktree 能力），Sidebar 和 FileTree 没任何提示。用户不知道文件改动发生在 worktree 分支。
   > 边界说明：`WorktreeCreate` **是 Claude Code SDK hook**，Native runtime 不会天然触发它。Native runtime 的 worktree 提示需要 native-runtime 自己发等价 event，**不在本 Phase 范围**，另立任务（见「不在范围内」）。

**🎨 改动后 UI 长什么样：**

**① PostCompact — 聊天流里的压缩分隔条**

聊天流里在被压缩的消息之上插入一个**不可折叠的灰色分隔条**（替代现有基于 SDKMessage 反推的简陋提示）：
```
───────────────────────────────────────────────
📦 已压缩历史 · 18 条消息合并为摘要 · 节省 92K token
              [ 查看摘要 ▸ ]
───────────────────────────────────────────────
```
点「查看摘要」→ 右侧 drawer 显示压缩摘要文本 + 原始消息索引。

**② CwdChanged — FileTree 同步 + 顶部 toast**

- FileTree 根目录自动切到新 cwd（无需用户手动点）
- 顶部滑出一个 2 秒 toast：
```
📂 工作目录已切换到 /Users/op7418/projects/new-repo
```
- ChatView 顶部面包屑的 cwd 路径同步更新

**③ PermissionDenied — 结束态汇总徽章**

session 结束气泡（Phase 1 的 footer）左侧加一个可点击徽章：
```
                                      🚫 3 次工具被拒绝 ▸
```
点击展开 drawer 列出每一次被拒详情：工具名、入参、被拒原因（always_deny / user_rejected）+ 「前往权限设置」链接。

**④ WorktreeCreate — Sidebar 图标 + 面包屑（仅 SDK runtime）**

- Sidebar 会话条目 title 前加 🌿 图标（**仅当该 session 在 SDK runtime 下运行且收到 WorktreeCreate hook 时**）
- ChatView 顶部面包屑加「🌿 worktree: feature/xxx」chip，点击可切回主分支 view
- Native runtime 的 session 即便有 worktree 也**不**显示此 UI（需等 native-runtime 发等价 event 的独立任务落地）

**🔁 交互脚本（PostCompact 场景）：**
1. 用户在 ~150K token 的长对话里发送新消息
2. SDK 内部触发 auto-compact → `PostCompactHook` fire
3. 聊天流里对应位置出现灰色分隔条 `📦 已压缩历史 · 18 条消息合并为摘要 · 节省 92K token`
4. 新消息 AI 响应开始流式输出
5. 用户如果好奇被压缩了什么，点「查看摘要 ▸」→ drawer 打开看摘要

**🔎 发现路径：**
- 4 种 hook 的 UI 都是**被动触发**（事件发生自动显示）
- PostCompact 的分隔条是**聊天流内联**，用户滚动时自然看到
- CwdChanged 的 toast 是一次性短时显示（2s），不干扰；FileTree 同步是持续反映
- PermissionDenied 的徽章只在「确有拒绝」时显示，无拒绝时不出现（空态即隐藏）
- WorktreeCreate 的 🌿 图标持续可见，是一种状态指示

**改动：**

1. **重启用 hooks**（如果 bug 修复）
   - 移除 `claude-client.ts:970-974` 的禁用注释
   - 接入最稳的几个 hook 先试水：`PostCompact`、`CwdChanged`

2. **`PostCompact` hook**
   - 替代现有 `SDKMessage` 反推的压缩通知
   - UI 显示压缩前后 token 数、裁剪的消息条数

3. **`CwdChanged` hook**
   - 自动更新 FileTree 的根目录
   - 与 memory 里记的「auto-open panels on new chat」功能协同

4. **`PermissionDenied` hook**
   - 记录被拒绝的工具调用到 audit log
   - 在 session 结束气泡显示「X 次工具被拒绝」

5. **`WorktreeCreate` hook（仅 SDK runtime）**
   - 仅消费 Claude Code SDK 的 `WorktreeCreate` hook，更新对应 SDK session 的 Sidebar 🌿 图标 + 面包屑
   - **不**改动 `src/lib/runtime/native-runtime.ts`；Native runtime 的等价 event adapter 另立任务（见「不在范围内」）
   - 遵守 CLAUDE.md 的 Worktree 隔离规则

**降级方案：** 如果 Phase 0 核查发现 bug 未修 → 放弃 real hook，只做 `SDKTaskUpdatedMessage` / `SDKSessionStateChangedMessage` 等流消息驱动的事件化 UI

**验收标准：**
- 压缩通知切到 `PostCompact` 后功能等价
- FileTree 根目录能跟随 cwd 切换
- Hook CLI control frame 污染 bug 不复现

**风险：** 高 — 完全依赖 Phase 0 结论

---

### Phase 7a — MCP Elicitation（`onElicitation` callback + URL mode 完成通知）

**背景（Codex 校准后正确版本）：**
- **真实入口**：`Options.onElicitation: OnElicitation`（`sdk.d.ts:1163`）—— `(request: ElicitationRequest, options: { signal }) => Promise<ElicitationResult>`
- **ElicitationRequest** 有 `mode: 'form' | 'url'`（`sdk.d.ts:470-475`）：
  - `'form'`：MCP 工具请求结构化输入（字段列表 schema）
  - `'url'`：浏览器 OAuth 类流程（通过 `SDKElicitationCompleteMessage` 通知完成）
- **`SDKElicitationCompleteMessage`** 只是 URL mode 的完成通知（`sdk.d.ts:2459`），**不是表单交互请求入口**

**👤 用户今天的痛点：** 接入某些 MCP 服务器（如 Notion、Linear、Slack）时，工具执行中突然需要用户补充信息（选哪个数据库、授权 OAuth 等），目前产品里这种请求**根本无法响应**——工具直接失败或卡住，用户只能从错误文案里猜「啊原来缺了个参数」。

**🎨 改动后 UI 长什么样：**

**① Form mode — 聊天流内联表单卡片**

MCP 工具请求结构化输入时，聊天流里工具 card 之后插入一个表单卡片：
```
┌──────────────────────────────────────────┐
│ 📋 notion-mcp 需要更多信息                   │
│                                          │
│ 选择目标数据库：                             │
│ ○ Projects                               │
│ ● Tasks                                  │
│ ○ Notes                                  │
│                                          │
│ 页面标题：                                  │
│ [_________________________]               │
│                                          │
│              [取消]  [提交]                 │
└──────────────────────────────────────────┘
```
- 字段按 SDK 返回的 schema 渲染（radio / text input / select / multi-select）
- 提交后卡片折叠为 `✅ 已响应：Tasks · 「周会纪要」` → MCP 收到 `{ action: 'accept', content: {...} }`
- 用户点取消 → 卡片折叠为 `✖ 已取消` → MCP 收到 `{ action: 'cancel' }`（**resolve**，不是 reject）
- session abort（整个消息被终止）→ 才真 reject（视为异常）

**② URL mode — 授权预览 + 用户显式确认打开（Codex 安全校准）**

**Codex 校准点：** URL 来自外部 MCP server/工具链，直接后台打开等于让工具自动触发外部导航，这是 phishing/隐私风险。**禁止系统自动打开**——必须先展示来源 + 域名 + 用途，让用户显式点按钮才跳转。

**协议 allowlist（代码强制）：**
- ✅ 允许：`https:`
- ❌ 拦截并在 UI 上报告风险：`http:`（明文）/ `file:` / `javascript:` / `data:` / 私网地址（`localhost` / `127.0.0.1` / `10.*` / `192.168.*` / `172.16-31.*`）
- 拦截后显示错误卡片，不给「打开」按钮，只给「复制 URL 自查」或「取消」

**安全授权卡片（替代原自动打开浮层）：**
```
┌──────────────────────────────────────────────────┐
│ 🔐 notion-mcp 请求浏览器授权                          │
│                                                  │
│ 目标域名：accounts.notion.com                        │
│ 来源 MCP：notion-mcp（你已配置的集成）                  │
│ 用途：授权访问你的 Notion workspace                   │
│                                                  │
│ 完整链接（点击展开）▸                                 │
│                                                  │
│    [ 取消 ]     [ 在浏览器中打开 ]                    │
│                                                  │
│ ⚠ 如果这个请求不符合你的预期，请点取消                     │
└──────────────────────────────────────────────────┘
```
- 域名高亮（不是完整 URL，避免长 URL 被用来 phishing），点「完整链接 ▸」才展开看全文
- 「在浏览器中打开」是唯一跳转入口，用户必须主动点
- 点击后状态变为：「等待浏览器授权完成... [取消]」
- 等 `SDKElicitationCompleteMessage` 到达 → 卡片收起为 `✅ 授权完成` → MCP 工具收到 `{ action: 'accept', ...content }`
- 用户点「取消」 → 卡片收起为 `✖ 已取消` → MCP 工具收到 `{ action: 'cancel' }`（**resolve**，不是 reject）
- 60s 无响应 → 卡片收起为 `⏱ 已超时` → MCP 工具收到 `{ action: 'cancel' }`
- 拦截的协议 / 地址直接显示错误：`🚫 notion-mcp 请求了不安全的链接（file:///...）· [查看详情]`，**没有打开按钮** → MCP 工具收到 `{ action: 'decline' }`

**🔁 交互脚本（Form mode）：**
1. 用户让 Claude 帮我把本周会议纪要存到 Notion
2. Claude 调用 `notion-mcp` 工具 → 工具发现没指定数据库 → 发起 elicitation
3. 聊天流里弹出 Form 卡片「选择目标数据库 + 页面标题」
4. 用户选 Tasks，输入标题，点提交
5. 卡片折叠为 `✅ 已响应`，MCP 工具继续执行 → 成功创建页面 → Claude 继续对话回复「已创建」

**🔎 发现路径：**
- 完全**被动触发**（MCP 工具发起时自动弹）
- Form 卡片 / URL 授权卡片都**内联在聊天流**，用户视线焦点
- URL mode **不自动打开浏览器**，必须用户点按钮才跳转——安全优先
- session abort 时所有 pending elicitation 批量取消
- 不安全协议被拦截的情况下，显示错误但不给打开入口，避免一键 phishing

**原计划错误：** 把「在 SSE 管道里识别 `SDKElicitationCompleteMessage`」当作全部入口，这只覆盖 URL mode 的完成通知，form mode 的请求来源（`onElicitation` callback）完全漏了。

**改动：**

1. **在 query options 注册 `onElicitation` callback**
   - `src/lib/claude-client.ts:395` 拼 queryOptions 时加 `onElicitation`
   - callback 收到 request 后通过 control request 机制（与现有 `canUseTool` permission prompt 同模式）转发到前端
   - 返回一个 `Promise<ElicitationResult>`，等前端响应

2. **Pending elicitation 注册表（Codex 校准后修正 id 来源 + resolve/reject 语义）**
   - 新建 `src/lib/elicitation-registry.ts`：`Map<localPromptId, { resolve, reject, request, sdkElicitationId? }>`
   - **id 来源分流（Codex 校准）：** SDK typings 里 `ElicitationRequest.elicitationId` 是**可选且只用于 URL mode 的 correlation**（`sdk.d.ts:480`）。form mode 很可能没这个 id，不能作为 key。
     - **key 用 CodePilot 本地生成的 `localPromptId`**（每个 `onElicitation` 调用生成一个 UUID）
     - **URL mode** 额外保存 SDK 的 `elicitationId` 到 value，用于后续收到 `SDKElicitationCompleteMessage` 时做 correlation（match SDK id → 找到本地 promise → resolve）
     - **form mode** 的响应走 SSE/POST，携带 `localPromptId`，不依赖 SDK id
   - MCP 的 `ElicitResult` 有三种产品态：`{ action: 'accept', ... }` / `{ action: 'decline' }` / `{ action: 'cancel' }`
   - **resolve（正常产品态）：**
     - 用户提交表单 → `resolve({ action: 'accept', content: {...} })`
     - 用户点取消 → `resolve({ action: 'cancel' })`
     - 60s 超时 → `resolve({ action: 'cancel' })`
     - 安全协议拦截 → `resolve({ action: 'decline' })`
   - **reject（真异常）：**
     - SDK abort signal 触发
     - 页面销毁 / session 被强制终止
     - Registry 错乱（找不到对应 `localPromptId`）
   - 这样 MCP 工具能按用户意图正常处理「用户主动取消」，不会把它表现为系统错误

3. **前端 UI（按 mode 分离，统一走安全审查）**
   - `mode: 'form'` → 新建 `ElicitationFormPrompt` 组件，按 schema 渲染表单字段
   - `mode: 'url'`：
     1. 服务端先校验 URL 命中 allowlist（仅 `https:`、非私网地址、非危险协议）
     2. 校验通过 → 发 `elicitation_request` SSE 事件到前端，携带 domain / serverName / 用途
     3. 前端渲染**授权卡片**（见上方 mockup）——**此时系统不自动打开浏览器**
     4. 用户显式点「在浏览器中打开」→ 前端调受控 endpoint（Electron 的 `shell.openExternal` / 浏览器的 `window.open`），传入白名单校验过的 URL
     5. 等 `SDKElicitationCompleteMessage` 到达 → 卡片收起
     6. 校验失败 → 不发 `elicitation_request`，直接 resolve `{ action: 'decline' }` + 前端显示拦截提示
   - 两种 mode 共用 session abort 机制

4. **SSE 通道（按 `localPromptId` 关联，不依赖 SDK id）**
   - `src/hooks/useSSEStream.ts` 新增 `elicitation_request` / `elicitation_complete` 事件类型
   - `elicitation_request` payload 携带 `localPromptId` + mode + schema/domain/用途 等展示所需字段
   - 用户提交响应 → POST 到 `src/app/api/chat/elicitation-response/route.ts` with `{ localPromptId, result: ElicitResult }` → 服务端 registry 按 `localPromptId` 查到对应 promise → resolve with 对应 `ElicitResult.action`
   - URL mode 收到 `SDKElicitationCompleteMessage` 时，**先按 SDK `elicitationId`** 在 registry value 里反查 `localPromptId`，再 resolve 对应 promise

**验收标准：**
- form mode：一个支持 elicitation 的 MCP 工具能调出表单、用户填写、工具收到 `{ action: 'accept', content }`
- url mode：URL 通过 allowlist → 前端卡片显示 → 用户显式点按钮 → 浏览器打开 → 完成后 UI 自动关闭；工具收到 `{ action: 'accept', ... }`
- 用户取消 / 超时场景：MCP 工具收到 `{ action: 'cancel' }`（正常 resolve），不是异常 reject
- 不安全 URL（`file:` / `javascript:` / `data:` / 私网）：前端完全不拿到 URL，MCP 收到 `{ action: 'decline' }`
- 用户 abort 整个消息时：pending elicitation 才 reject（视为真异常）

**风险：** 中 — 需要测试的 MCP 工具配合；pending registry 的生命周期要仔细管理（abort / 页面关闭 / 超时）

---

### Phase 7b — Deferred tools（PreToolUse defer → resume）

**背景（Codex 校准后正确版本）：**
- **真实机制**：PreToolUse hook 返回 defer → `SDKResultMessage.terminal_reason === 'tool_deferred'`（`sdk.d.ts:4656`） + `deferred_tool_use: SDKDeferredToolUse`（`sdk.d.ts:2749-2750`）→ 调用方注册 pending + await 用户响应 promise → 按**相同权限模式** resume
- **官方 docs 把工具 schema 延迟加载叫 Tool Search**（`CLAUDE_CODE_TOOL_SEARCH` 等环境变量控制），与 Deferred tools **不是同一概念**
- **AskUserQuestion** 是 Deferred tools 机制的一个具体应用，不是独立通道

**👤 用户今天的痛点：** 目前 CodePilot 里 AskUserQuestion 类工具（Claude 想停下来问用户问题）体验不连贯——工具「执行」完就结束本轮，用户回答后下一轮才 resume，中间有断层感。

**Codex 校准点（首版单 defer，多 defer 待 POC 验证）：**

SDK 0.2.111 `SDKResultSuccess.deferred_tool_use?: SDKDeferredToolUse`（`sdk.d.ts:2749`）是**单数**，不是数组。typings 上 SDK 本身不支持同一轮产生多个并发 deferred tool。原计划的「多 deferred tool 合并 drawer + 全部响应后一次性 resume」是**建立在未验证的 SDK 能力假设上**。

**首版策略（单 defer）：**
- 一轮只处理一个 deferred tool
- 响应后 resume；如果 resume 后又有工具被 defer，走新一轮单卡片流程
- 多 deferred tool UI **推迟到 Phase 7b 的 POC 验证之后**（见下方 POC 前置）

**POC 前置（阻塞多 defer UI）：**

在 Phase 0 的 `hooks-poc.test.ts` 里加一个子任务：
- 构造一个场景让 Claude 在同一轮连续调用两个需要 defer 的工具
- 观察 SDK 的行为：
  - 是否第一次 defer 就 terminal，第二个工具根本没发起？
  - 还是 SDK 在内部排队，只暴露一个 `deferred_tool_use`，等 resume 后才提起第二个？
  - 还是 SDK typings 未更新但实际可能扩展为数组？
- 结论写入 `docs/research/agent-sdk-0-2-111-capabilities.md`；只有证明 SDK 确实支持多并发 defer 时，才解锁本 Phase 的多 defer UI

**🎨 改动后 UI 长什么样（首版仅单 defer）：**

工具被 defer 后，聊天流里工具 card 变成「待响应」状态：
```
┌──────────────────────────────────────────┐
│ ⏳ AskUserQuestion · 待响应                  │
│                                          │
│ 你想让我优先修复哪个 bug？                      │
│                                          │
│ ○ #493 macOS 启动崩溃                      │
│ ● #499 SDK keepalive 间隙                 │
│ ○ #501 keychain 弹窗                      │
│                                          │
│              [跳过]  [响应并继续]              │
└──────────────────────────────────────────┘
```
响应后卡片折叠为 `✅ 已选择：#499 SDK keepalive 间隙`，Claude 自动 resume 继续对话。

**多 defer 场景（首版未落地，UI 占位）：**
- 如果 SDK 在同一轮产生多个 `deferred_tool_use`（按 POC 结论可能或不可能），首版退化为**串行处理**：先展示第一个 pending card，响应后再展示下一个
- 验证 SDK 支持并发 defer 后（Phase 7b-future），再评估合并 drawer UI 的必要性

**🔁 交互脚本（单 defer 场景）：**
1. Claude 在分析 issues 时调用 AskUserQuestion「你想优先修哪个」
2. PreToolUse hook 返回 defer → SDK 以 `tool_deferred` 结束本轮
3. 聊天流出现 ⏳ 卡片 + Phase 1 的 🔵 `有工具等待响应` chip
4. 用户选「#499」点「响应并继续」
5. 服务端 resume（保持同权限模式 + model + cwd） → Claude 继续「好的，我来看 #499...」
6. 卡片折叠为 ✅ 已响应

**🔎 发现路径：**
- **被动触发**（hook 决定 defer 时自动弹卡片）
- 卡片内联在聊天流，与 Phase 1 的 `tool_deferred` terminal chip 联动（chip 点击可滚动到对应卡片）
- 首版单 defer 场景，一次只有一张 pending card；如果后续 resume 又触发 defer，新的 card 按正常节奏加到聊天流末尾
- pending 状态下输入框被禁用（有 tooltip「先响应待处理工具」），避免用户绕过 defer 继续发消息

**原计划错误：** 把 Deferred tools 与 `ToolConfig.askUserQuestion` 绑定、默认开启、当作减少 context 占用的方案 —— 这三个都不对。

**前置要求：Phase 0 的 hook POC 结论为「修复」**（Deferred tools 依赖 PreToolUse hook 可用）

**改动：**

1. **PreToolUse hook 接入 defer 决策**
   - hook 判断工具是否需要延迟执行（如需要用户确认的 widget），返回 `{ decision: 'defer' }`
   - SDK 会以 `terminal_reason: 'tool_deferred'` + `deferred_tool_use` 结束本轮

2. **Deferred tool 注册表**
   - 新建 `src/lib/deferred-tool-registry.ts`：`Map<tool_use_id, { request, resolve, sessionContext }>`
   - `sessionContext` 保存 session id / permission mode / model / cwd —— **resume 时必须用相同上下文**（权限模式不一致会导致工具重新执行失败）

3. **用户响应 + resume**
   - UI 展示待处理工具：用户填写/确认 → POST 到 `src/app/api/chat/defer-response/route.ts`
   - 服务端拿 response + saved sessionContext 调用新一轮 `query({ resume: sessionId, ... })` 恢复会话
   - 新 query 必须传入同样的 permission mode / MCP servers / model，否则 resume 行为不一致

4. **多 deferred tool（首版：按 POC 结论决定，默认串行）**
   - **首版严格按单 defer 走**：一次 `SDKResultMessage` 只可能带一个 `deferred_tool_use`，响应后 resume，如果后续又有 defer 就走新一轮
   - Phase 0 POC 验证「SDK 能否在单轮产生多并发 defer」的结论决定是否解锁批量 UI：
     - 若 SDK 确实不支持 → 永远串行，删除「合并 drawer」设计
     - 若 SDK 支持并发 → 另立 Phase 7b-future 做批量 drawer

5. **AskUserQuestion 是可选落地之一**
   - 如果 Phase 7a + 7b 都实施后还需要，可把 AskUserQuestion 以 `defer` 方式实现
   - 但**不是**迁移到某个 `ToolConfig.askUserQuestion` 通道

**验收标准：**
- PreToolUse hook 返回 defer 后 SDK 正确 terminal
- Deferred tool 注册表正确持久化 sessionContext
- Resume 后工具以原 tool_use_id 续跑成功
- 首版**单 defer** 流程走通；多 defer 按 POC 结论决定（默认串行）

**风险：** 高
- 严重依赖 Phase 0 的 hook bug 结论
- sessionContext 持久化 + resume 的权限一致性是容易踩坑的地方
- 如果用户在 pending 期间改了 provider / model，resume 需要特殊处理（当前倾向：视为无效，放弃该 deferred tool）

---

## 不在范围内

- **Remote control 协议**（`ConnectRemoteControl*` / `InboundPrompt`）— 长期对 `claude-to-im` bridge 有价值，但现有 conversation-engine 够用；另起计划
- **`SDKPromptSuggestionMessage`** — UI 建议后续 prompt；功能增益有限，单独小改动
- **`SDKMemoryRecallMessage`** — 我们的 memory 系统是自建的，SDK memory 召回事件对我们暂不适用
- **`SDKPluginInstallMessage`** / `SDKControlReloadPluginsResponse` — 运行时重载插件；MCP 管理已有路径，收益边际
- **`FastModeState`** — 需要与产品侧确认是否引入「快速模式」这个概念，属于产品决策，不在工程计划
- **`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`** — cache hit rate 优化，需要先测 baseline，另起 research
- **Sonnet / Haiku 4.7 的同步接入**（如果官方发布）— 另起计划
- **Native runtime 的 worktree UI 提示**（Sidebar 🌿 图标 + 面包屑）— `WorktreeCreate` 是 Claude Code SDK hook，Native runtime 不会天然触发。需要 native-runtime 先发等价 event，另立任务（参考 `docs/handover/decouple-native-runtime.md`）
- **Phase 4b：全消息 ID 映射 + assistant 消息 fork + transcript backfill** — Path A 首版不覆盖，待用户反馈强烈时再做
- **Phase 7b-future：多并发 deferred tool UI** — 需 Phase 0 POC 证明 SDK 支持单轮多并发 defer 后才解锁

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Phase 0 POC 只用最小复现场景，证明不了真实 bug 修复 | 已改为 repo 内 integration test，使用 CodePilot 实际 queryOptions 组合；Phase 6 / 7b 的 go/no-go 必须基于 repo POC 结论 |
| Phase 0 发现 hook bug 未修，直接砍掉 Phase 6 / 7b | 保留后手：Phase 6 降级为 `SDKTaskUpdatedMessage` / `SDKSessionStateChangedMessage` 流消息反推；Phase 7b 若 hook 不可用则推迟至 SDK 修复 |
| WarmQuery 被误用于宽场景（切 provider、idle 重热） | Phase 3 **强制窄场景**（同 cwd + provider + permission + model），宽场景明确标记为 out-of-scope；POC 必须证伪宽场景可行性 |
| 「Long Idle 空白」bug 被错误归因到冷启动 | 已从 Phase 3 验收范围剔除；**另立 bug 工单**调查 `stream-session-manager` 的 snapshot/GC 生命周期 |
| DB migration 破坏现有 session | 严格走 `feedback_db_migration_safety` 的 backfill；新列 NOT NULL DEFAULT ''；不新建多对多 session_tags 表 |
| Fork / Tag 出现 SDK 与 DB 双源分裂 | Phase 4 前置的 `session-id-mapping.md` 明确 SoT：SDK 主写、DB 镜像；双写失败要 retry + 对账 |
| `tagSession` 单 tag 与产品希望的多 tag 冲突 | 接受「功能弱化」换「SoT 一致」；如果产品一定要多 tag，另起 CodePilot 侧独立 tag 系统（不用 SDK tagSession） |
| `getContextUsage` 被误用于 preflight 压缩决策 | Phase 5 **强制**限定活跃会话展示/校准；preflight 主干继续用 estimator |
| RateLimitInfo 在非订阅路径上缺失 → UI 空白 | Phase 2 **仅在订阅路径**启用 Banner；非订阅路径继续走 `error-classifier.ts` 正则主干 |
| TerminalReason 覆盖不到无 result 的错误路径 | Phase 1 **附加层**定位，`error-classifier` 主干不动；未识别 reason 回退 `terminal.unknown` |
| Elicitation / Deferred tools / AskUserQuestion 被写成一条链导致漏掉关键机制 | Phase 7 拆成 7a（elicitation callback + registry）/ 7b（defer + resume），各自独立 |
| **Fork 的 `upToMessageId` 是 SDK transcript id，但 CodePilot DB messages 只有本地 id**；无完整 SDK↔DB message 映射会导致 fork 落不到实处 | Phase 4 首版走 Path A（仅 user turn fork + 复用现有 rewind point 的 `sdkUserMessageId`）；全消息 fork 放 Phase 4b 等用户反馈 |
| **限流自动重发 + 不可关闭浮层**替用户做决定，且上一轮可能已有工具副作用，重发到另一个模型可能重复执行 | Phase 2 阻断改为**可关闭恢复面板** + 替代模型可用性校验 + 「切换并重试」二次确认 + draft 保留 |
| **URL elicitation 自动打开外部 MCP 提供的 URL**是 phishing/隐私风险 | Phase 7a 改为**安全授权卡片**：展示 domain + 来源 + 用途，用户显式点按钮才打开；协议 allowlist（仅 `https:`，拦 `file:/javascript:/data:/` 私网） |
| **Phase 0 integration test 不会被 `npm run test` 自动跑**，可能被误以为已覆盖；塞默认跑又依赖本机凭据不稳定 | 新增 `test:sdk-poc` 脚本 + `CLAUDE_SDK_POC=1` env gate + fixture MCP server + 无凭据自动 skip + runbook |
| 为每个 Phase 强行加 UI 导致暴露内部实现状态 | UX 原则修订为三种价值形态（A 显性 UI / B 静默体感 / C 基础设施），静默优化不加人为可见指示，量化指标达不到则砍 Phase |
| Fork API 签名只收 `upToMessageId` 但 DB messages 没这个 id，导致服务端不知道本地切到哪条 | Path A 入参改为 `{ dbSessionId, dbMessageId, title? }`；服务端由 dbMessageId 经现有 rewind point 映射推导 `sdkUserMessageId`；校验失败则 400 |
| Rename / Tag 默认所有会话都有 `sdk_session_id`，忽略本地新会话 / Native runtime / 导入会话的空 UUID 状态 | 按 `sdk_session_id` 是否非空分流：SDK 会话走 SDK 主写 + DB 镜像；空 UUID 走 DB-only；首次拿到 UUID 时 reconcile |
| `WorktreeCreate` hook 是 SDK runtime 专属，原计划的痛点写成 Native runtime 场景，hook 覆盖不到 | 本 Phase 明确只覆盖 SDK runtime；Native runtime 的 worktree 提示移到「不在范围内」，等 native-runtime 发等价 event 后另立任务 |
| 用 SDK `elicitationId` 作为 form mode 注册表 key，而 typings 声明它**仅 URL mode correlation** 用 | Registry key 改用 CodePilot 本地生成的 `localPromptId`；URL mode 额外存 SDK `elicitationId` 做 correlation |
| 设计多 deferred tool 合并 drawer，但 `SDKResultSuccess.deferred_tool_use` 是**单数**，SDK 能力未经证实 | 首版严格单 defer；Phase 0 POC 验证 SDK 是否支持多并发 defer；结论不支持则永久删除多 defer UI 设计，支持则另立 Phase 7b-future |

## 文档

完成后需同时输出（CLAUDE.md 规范）：

- `docs/handover/agent-sdk-0-2-111-adoption.md` — 技术交接（各 Phase 接入点、SDK 消息解析、hook 开关策略、migration 路径）
- `docs/insights/agent-sdk-0-2-111-adoption.md` — 产品思考（为什么选这几条能力、用户会感知到什么、未做的能力为什么不做）
- 两份文档互相反链
- 完成后本计划移至 `docs/exec-plans/completed/`
