# Phase 8 — Codex MCP / Memory 注入

> 创建时间：2026-05-21
> 完成时间：2026-05-29
> **状态：✅ 已归档（2026-05-29 收口，文件由 `active/` 移入 `completed/`）**
>
> **收口摘要**：Codex `config.mcp_servers` 注入链路打通，**5 项核心能力**（Memory / Widget / Tasks+Notify / Dashboard / CLI）在 Codex Account 下全部**已接入 + 真实账号 smoke 通过**（见下方 Smoke Ledger）。引入按能力区分的 elicitation 审批策略（safe-read 自动接受 / mutating 走用户审批 / 未知 decline；Dashboard / CLI 各拆成 read+write 两个 server 以绕过 Codex elicitation 只识别 server 不识别 tool 的限制）。Codex 原生图片入库已对齐素材库（prompt + model + provider 都接进 Gallery API）。
>
> **用户明确 defer（2026-05-29）**：(a) Image/Media — 不叠加 App 的 Gemini 图片 MCP（Codex 自带图片够用，避免双"画图"工具混淆）；(b) 用户自定义 MCP — 独立工程（transport / OAuth / 白名单）。如要重启，**新立独立计划**，不在本文档续写。
>
> 关键内容：5 项能力的真账号 smoke 见 Smoke Ledger；按能力的拆分 / 注入 / 审批策略见 #31 capability 表；为什么这样收口、什么不做见决策日志（按日期倒序最新数条）。
> 上游：Phase 5 Codex Runtime / Phase 5e Runtime Harness Architecture / Phase 7 Icon System
> POC 记录：[docs/research/codex-mcp-injection-poc/](../../research/codex-mcp-injection-poc/)

## 用户目标

用户希望 CodePilot 成为本地 Agent 框架与自定义 Harness 的集中地：切到 Codex Runtime 后，不能只保留 Codex 自己的能力，也应该尽可能让 CodePilot Memory MCP、用户 MCP、工作区规则等可感知、可调用。朋友的同类实践表明 Codex 可以注入 MCP，因此本计划专门验证并补上 CodePilot 当前缺失的 Codex MCP 注入链路。

用户可见结果：

- 在 Codex Runtime 下，CodePilot Memory MCP 不再只是 Settings 里的“可感知不可执行”，而是在已验证路径下成为真正可调用工具。
- Codex Account 与 CodePilot provider proxy 两条路径分别给出明确能力状态：能注入就显示可调用，不能注入就说明具体原因和替代 Runtime。
- MCP 启动失败、OAuth / elicitation、权限请求不再静默卡住；用户能在 Settings 或聊天工具结果里看到可理解的状态。

## 为什么排在 Phase 7 后

当前主线是 Phase 7 图标体系与视觉锚点。Codex MCP 注入涉及 Runtime config、MCP bridge、权限 / elicitation、Settings capability matrix、真实凭据 smoke，风险面大于图标表意校准。为了避免两条大线互相污染，本计划只先登记事实、边界与执行顺序，等 Phase 7 UI 优化收口后再开工。

## 已确认事实

### Codex 侧支持 MCP 注入

不是“Codex 不允许注入上下文”。本地 vendored Codex schema 与文档显示 app-server / SDK 都支持 config override 与 MCP server：

- `资料/codex/codex-rs/app-server-protocol/schema/typescript/v2/ThreadStartParams.ts`：`thread/start` 支持 `config?: { [key: string]: JsonValue }`。
- `资料/codex/codex-rs/app-server-protocol/schema/typescript/v2/ThreadResumeParams.ts`：`thread/resume` 也支持 config override。
- `资料/codex/codex-rs/app-server/README.md`：列出 `mcpServerStatus/list`、`mcpServer/tool/call`、`mcpServer/resource/read`、`mcpServer/oauth/login`、`mcpServer/elicitation/request`。
- `资料/codex/codex-rs/config/src/mcp_types.rs`：定义 `mcp_servers` config，支持 stdio 与 streamable HTTP 类 transport。
- `资料/codex/sdk/typescript/README.md` 与 `src/exec.ts`：SDK 也能把 config override 下发给 Codex CLI。

结论：我们应该优先补 app-server `config.mcp_servers` 注入，而不是把 Runtime 主控面迁到 `@openai/codex-sdk`。

### CodePilot 当前缺的是注入链路

当前实现只给 Codex 注入 provider proxy：

- `src/lib/codex/provider-proxy.ts` 只构造 `config.model_providers.codepilot_proxy`。
- `src/lib/codex/runtime.ts` 的 `thread/start` / `thread/resume` 都复用该 Thread params，因此也只带 model provider config。
- `codex_account` 分支不注入 provider proxy，也没有注入 `mcp_servers`。
- `src/__tests__/unit/codex-user-mcp-wiring.test.ts` 目前明确 pin 住“Codex Runtime 不挂 CodePilot user MCP servers”。
- `src/lib/harness/user-codepilot-extensions.ts` 当前把 `mcp_server` 在 `codex_runtime` 下标成 `perception_only`，这是对现状的诚实描述，不是最终目标。

### 现有 Memory MCP 不能直接塞给 Codex

`src/lib/memory-search-mcp.ts` 当前用 Claude Agent SDK 的 `createSdkMcpServer()` 创建 in-process MCP server。它适合 ClaudeCode SDK 路径，但不是一个 Codex config 能直接启动的 stdio / HTTP server。

Phase 8 需要先做 wrapper / shim：

- stdio shim：启动一个 Node entry，内部挂 CodePilot Memory MCP。
- 或 streamable HTTP endpoint：由 CodePilot dev server / Electron server 暴露给 Codex。

选型必须由 POC 决定，不能在产品代码里猜。

### provider proxy bridge 与 Codex MCP 注入不是一回事

目前 Codex + CodePilot provider proxy 下已有 `codepilot_memory_*` AI SDK bridge tool。这条路径解决的是 `/api/codex/proxy/v1/responses` 中的 CodePilot built-in tools。

本计划解决的是另一层：通过 Codex 原生 `mcp_servers` config，让 Codex 自己感知并调用 MCP 工具，然后把 `mcpToolCall` / startup status / elicitation 映射回 CodePilot UI。

两条路最终可以并存，但 Settings 和测试必须区分来源，不能把 provider proxy bridge 的成功当作 Codex MCP 注入已完成。

### MCP 协议统一 ≠ CodePilot 能力自动统一

2026-05-27 用户补充目标：**所有原生 CodePilot 能力都应尽可能接入 Codex Runtime；接不进去的能力必须在 Settings / 提示里诚实说明，而不是只接 Memory 就算 Codex 适配完成。**

MCP 统一的是传输与工具调用协议，不自动统一 CodePilot 的产品能力。每个能力还要逐项处理三层差异：

- **注入层**：能力是否已有可被 Codex `config.mcp_servers` 挂载的 stdio / streamable HTTP server。
- **执行层**：模型自主调用走 `item/tool/call`，需要 Runtime handler 转发到 `mcpServer/tool/call`，不能只验证手动 RPC。
- **结果层**：不同能力的结果契约不同。Memory 是文本；Widget 要 `show-widget` artifact；Image / Media 要 `MediaBlock` 与素材导入；Tasks / Dashboard / CLI 有 side effect 与权限边界。

因此 Phase 8 先闭环 Memory，是因为它是 safe-read 文本工具、最适合作为 Codex 原生 MCP 注入样板；这不代表其他 CodePilot 能力天然完成。后续要按 capability 逐项做 parity：

| Capability | 当前事实 | Codex 原生接入还缺什么 |
|------------|----------|------------------------|
| Memory | ✅ **已接入 + smoke 通过（2026-05-27 / 重测 2026-05-28）**：注入 Memory MCP；dynamic tool bridge 仅放行 `codepilot_memory_*` safe-read；模型主动调 `codepilot_memory_recent` 读出真实记忆（条数 1） | — |
| Widget | ✅ **已接入 + smoke 通过（#31，机制 2026-05-27 / 真账号 smoke 2026-05-28）**：widget MCP 经泛化路由 `/api/codex/mcp/[server]` 注入（关键词门控，复用 `promptNeedsWidget`）；elicitation 审批接受（safe-read guidelines）；`show-widget` 渲染 runtime 无关（`parseAllShowWidgets`）；Codex Account 下 executable。真实账号实测：模型生成可渲染 widget（带固定 / 导出 PNG / 查看代码） | — |
| Tasks / Notify | ✅ **已接入 + smoke 通过（#31，2026-05-28）**：notify MCP 经路由注入（always-on）；建立**按能力区分**的 elicitation 审批策略——safe-read 自动接受，mutating（tasks）走用户审批（复用 `registerPendingPermission` + `permission_request` SSE），未知服务 decline。真实账号实测：`codepilot_schedule_task` 弹权限卡，Deny 后未创建 | — |
| Image generation / Media import | ✅ **Codex 原生图片入库（2026-05-28）**：Codex 自带的 `imageGeneration` item 通过 `buildImageGenerationMedia` + `materializeCodexEventMedia` 进入素材库——本轮把 `revisedPrompt` 也带过去，库里行的 `prompt` 不再是无意义的 `codex-out.webp` 而是真实的生成提示词；`model` 标 `codex-image` 区分自 Gemini。Gallery API 现在也暴露 `provider` 字段。 | **用户决定 defer（2026-05-29）**：不再叠加 App 的 Gemini 图片 MCP（会出现两个画图工具且需要补 Codex `mcpToolCall` 完成分支的 `__MEDIA_RESULT__` 解析）。Codex 自带图片生成已用、入库已对齐，足够当前需求。 |
| Dashboard / CLI | ✅ **已接入 + 真账号 smoke 通过（#31，机制 2026-05-28 / 真账号 smoke 2026-05-29）**：仪表盘 / CLI 工具每个能力拆成「只读 MCP（auto_accept）+ 写 MCP（user_approval）」两路注入；Codex elicitation 按 server 分类的限制下，这是唯一干净的「读自动、写要审批」实现路径。仪表盘 list/refresh 自动可用；pin/update/remove 调用前会请你确认。CLI list/check_updates 自动可用；install/add/remove/update 都要确认。关键词门控（与 Claude Code SDK 同一 gate，复用 `promptNeedsDashboard` / `promptNeedsCli`，不 per-runtime 重写）。route/4 个工具子集 + matrix 翻转单测 + live 路由 + 真账号 smoke 全部验证通过。 | — |
| User MCP | 与 built-in CodePilot capability 分开 | **用户决定 defer（2026-05-29）**：需要 transport / OAuth / permission / per-workspace allowlist 一整套独立工程，当前不开。后续要做时以独立计划立项，不混进 #31 收口。 |

## 非目标

- 不读取 `~/.codex/auth.json`、token、credentials、key、pem 等敏感文件。
- 不把 `@openai/codex-sdk` 作为 Runtime 主控面的替代方案；SDK 只作为 schema / POC / fixture 参考。
- 不在 POC 通过前把 `codex_runtime + mcp_server` 从 `perception_only` 翻成 executable。
- 不放宽 provider proxy parser 来“猜” namespace / MCP 工具格式。
- 不绕过权限、OAuth 或 elicitation；无法接 UI 时必须安全拒绝并可见说明。
- 不把 Codex 原生 plugins / skills 与 CodePilot MCP 混成一个概念。前者是 Codex Framework Harness，后者是 CodePilot Harness。

## 状态

| Phase | 内容 | 状态 | 用户可见结果 |
|-------|------|------|-------------|
| Phase 0 | MCP 注入 POC + schema fixture | ✅ 基本完成 | 无 UI 变化；live 验证：Codex `0.133.0` 接受 per-thread `config.mcp_servers` 注入、`mcpServer/tool/call` 命中 fixture、错误/elicitation/broken-server 均可见；仅模型自主调用 auth-gated（见 POC 记录） |
| Phase 1 | Codex MCP config builder + Memory MCP wrapper | ✅ 完成 | 无 UI 变化；`src/lib/codex/mcp-config.ts` 构造 + Memory MCP 经 `/api/codex/mcp/memory` streamable-HTTP route 复用（非 stdio wrapper），单测 + 路由测试通过 |
| Phase 2 | Runtime start/resume 注入 | ✅ 完成 | 无 UI 变化；start/resume 都带 `config.mcp_servers`（Memory MCP，assistant 模式门控）；MCP fingerprint 入 session ref，变化即重开 thread |
| Phase 3 | 事件、状态、elicitation / OAuth 桥接 | ✅ 完成（OAuth 见备注） | MCP 启动失败/就绪可见、mcpToolCall 错误进 canonical tool_completed、elicitation 安全 decline 且可见；OAuth 留待用户 MCP 注入（Phase 4）|
| Phase 4 | Settings capability matrix 翻转 | ✅ 完成 | Codex Account 下 **Memory / Widget / Tasks+Notify / Dashboard / CLI 五项均显示「可调用」**（Tasks 文案注明调用前会确认；Dashboard / CLI 带「部分需批准」徽章——read 工具自动可用、write 工具弹审批）。Image/Media / 用户 MCP 在 Settings 里标为「不可调用」并注明是用户明确 defer 的决策（2026-05-29），不是未完成的能力缺口 |
| Phase 5 | 真实 smoke + 归档 | ✅ 五项核心能力均真账号 smoke 通过 | Codex Account 真实账号 smoke：Memory 读出真实记忆；Widget 渲染可交互 widget；Tasks/Notify 权限卡 Deny 后不执行；**Dashboard / CLI read 工具自动调用、write 工具弹审批且 Deny 真实阻断**（见下方 Smoke Ledger 2026-05-27 / 28 / 29 行）。**Image/Media + 用户 MCP 是用户明确 defer 的决策（2026-05-29），不是未完成项**——见 #31 capability 表与决策日志最末两条 |

## Phase 0 — POC 与事实夹具

目标：先证明“Codex app-server + `config.mcp_servers` + CodePilot fixture MCP”能跑，而不是在主链路里盲写。

> ✅ **已 live 验证（2026-05-27）**，结论与事件样本见 [docs/research/codex-mcp-injection-poc/](../../research/codex-mcp-injection-poc/)。
> **关键修正（推翻下方旧假设）**：
> 1. per-thread 注入的 server **不进** `mcpServerStatus/list`（实测对注入 server 返回 `data:[]`）；server 的 starting/ready/failed 状态走 `mcpServer/startupStatus/updated` **通知流**。凡涉及“查 list 断言”的任务以通知流为准（Phase 3 状态桥接同理）。
> 2. **模型自主调用的执行 + 审批（Phase 5 真实登录 smoke 实测，更正早先的 `item/tool/call` 假设）**：模型在 turn 里调 Codex **托管**的 `config.mcp_servers` MCP 工具时，Codex **内部执行**它，不会发 `item/tool/call` 给客户端（实测该方法 **0 次**；早先以为走 dynamic tool call 是误判，bridge 仅留作防御）。手动 POC 的 `mcpServer/tool/call`（client→server）只证明 MCP manager 可被调用，不代表 turn 内自主调用闭环。真正的闭环点是**审批**：在 `approvalPolicy: on-request` 下 Codex 把工具调用审批发成 server→client 的 `mcpServer/elicitation/request`，客户端必须**正确应答**——对 safe-read Memory `accept`（否则被记为 `"user rejected MCP tool call"`）。

任务：

- 用临时 `CODEX_HOME` 与独立 test workspace 启动 Codex app-server，避免污染用户真实配置。
- 准备最小 MCP fixture server，优先 stdio；如果 stdio 失败，再评估 streamable HTTP。
- 发 `thread/start`，传入：
  - `config.mcp_servers.codepilot_memory_fixture`
  - `cwd`
  - `model`
- 监听 `mcpServer/startupStatus/updated` 通知，断言注入的 fixture server 报 `starting → ready`，并经 `mcpServer/tool/call` 调用其 tool 成功。（实测：per-thread 注入 server **不进** `mcpServerStatus/list`，不能用 list 断言。）
- 经 `mcpServer/tool/call` 直调 fixture memory tool（无需模型，已验证命中）；模型**自主**调用走 `turn/start`，为 auth-gated，待登录后补。
- 覆盖 broken optional / required MCP startup status，确认错误能被 app-server 暴露。
- 探测 `mcpServer/elicitation/request` 行为：如果 fixture 工具发 elicitation，当前 CodePilot 应安全拒绝并可见记录，而不是卡住。

验收：

- POC 产物放 `docs/research/` 或 unit fixture，不直接进产品路径。
- Smoke Ledger 记录 Codex CLI version、transport、thread id、`mcpServer/startupStatus/updated` 状态（starting/ready/failed）、事件样本。
- 如果 Codex 版本或 app-server schema 与 vendored source 不一致，先记录版本门槛，不继续产品化。

## Phase 1 — Codex MCP Config Builder

目标：把 CodePilot MCP 配置转成 Codex 能理解的 config，且来源可测试。

任务：

- 新建 `src/lib/codex/mcp-config.ts`：
  - `buildCodexMcpServersConfig(input)`
  - `buildCodexMemoryMcpConfig(input)`
  - `fingerprintCodexMcpConfig(config)`
- 支持 CodePilot `MCPServerConfig` 到 Codex `mcp_servers` 的安全映射：
  - `stdio`: `{ command, args, env }`
  - `http` / `sse`: 只在 POC 验证后支持；未验证 transport 显式 unsupported
- 为 CodePilot Memory MCP 提供 stdio 或 HTTP wrapper。不能直接把 `createSdkMcpServer()` 当成 Codex 可执行 server。
- 所有 env 注入必须脱敏；禁止把 auth/token 文件路径或内容塞进 config。
- 产出 `mcpConfigFingerprint`，供 start/resume 判断是否需要新 thread。

验收：

- 单测覆盖 stdio / http / unsupported / env redaction / fingerprint stable。
- Codex Memory MCP wrapper 有独立 fixture 测试。
- 旧的 `codex-user-mcp-wiring.test.ts` 不能直接删除，必须改成“有 MCP injection builder 时 scanner flip 与 runtime injection 成对发生”的 guardrail。

## Phase 2 — Runtime Start / Resume 注入

目标：让 Codex Runtime 真正在启动与续聊时携带 `config.mcp_servers`。

任务：

- 扩展 `buildCodexThreadParams()`：合并 `model_providers` 与 `mcp_servers`，两者互不覆盖。
- `thread/start` 与 `thread/resume` 都必须带相同 MCP config override；避免第一轮能用、第二轮丢 config。
- `codex_account` 分支也要注入 `mcp_servers`，但不注入 `model_providers.codepilot_proxy`。
- `codepilot_proxy` 分支同时带 provider proxy config 与 MCP config。
- Session ref metadata 存 `mcpConfigFingerprint`；workspace / MCP config 变化时清旧 thread 并 start fresh。

验收：

- Source / behavior tests pin：resume 不能只有 `{ threadId }`，必须带 MCP config。
- codex_account + proxy 两个分支分别有测试。
- 不改 `~/.codex/config.toml`；所有注入都是 per-thread config override。

## Phase 3 — Event / Permission / Elicitation Bridge

目标：MCP 可调用之后，状态和交互也必须可见，不允许静默失败。

任务：

- `mcpServer/startupStatus/updated` 不再纯 `return null`；至少映射到 status / unknown_item / Settings diagnostic。
- `mcpServer/oauth/login` 只给显式链接，不自动 `window.open`。
- `mcpServer/elicitation/request` 接入现有 permission / prompt flow，或安全 decline + 明确工具结果。
- `mcpToolCall` 输出里的 server / tool / arguments / error 要进入 canonical `tool_started` / `tool_completed`。
- 失败状态进入聊天可见错误或 Runtime capability diagnostic，不能只留 console。

验收：

- Fixture 覆盖 startup success / startup failure / tool success / tool error / elicitation safe decline。
- UI smoke 至少验证一条失败路径可见。

## Phase 4 — Harness Capability Matrix 翻转

目标：只有真实注入成功的能力，才在 Settings 与模型提示里显示 executable。

任务：

- 更新 `src/lib/harness/user-codepilot-extensions.ts`：
  - `mcp_server + codex_runtime` 从 `perception_only` 翻成 executable 只限已验证 transport / scope。
  - 未验证 transport 保持 perception_only，说明“Codex MCP 注入暂不支持此 transport”。
- 更新 capability matrix：
  - Codex Account + Memory MCP：如果 Phase 2/3 通过，显示可调用。
  - Codex + provider proxy + Memory MCP：区分 CodePilot built-in bridge 与 Codex MCP 注入两种来源。
- Settings 能力清单文案使用用户语言，不暴露 `mcp_server` / `codex_runtime` 等内部变量名。

验收：

- Settings UI 显示：
  - 可调用：Memory / User MCP（限定已验证路径）
  - 不可调用：具体原因 + 替代 Runtime
- matrix tests 与 scanner tests 同步，禁止“UI 显示可调用但 Runtime 没注入”。

## Phase 5 — Smoke Ledger 与归档

真实验证必须写入本文件，不只留在聊天里。

| Date | Runtime | Provider | Model | MCP transport | 场景 | Result | Evidence |
|------|---------|----------|-------|---------------|------|--------|----------|
| 2026-05-27 | codex_runtime | codex_account | gpt-5.5 | streamable-HTTP route | 自然对话里模型**主动**调 `codepilot_memory_recent` 并读出真实记忆 | ✅ | electron:dev 日志确证 `[codex.mcp-elicitation] serverName:codepilot_memory action:accept`（mode:form / hasSchema:true）；用户确认对话中模型成功读出 Memory。对照：**修复前**同一调用为 `codex.tool_result ... success=false output=[{"text":"user rejected MCP tool call"}]`（6 次），修复后不再出现 |
| 2026-05-28 | codex_runtime | codex_account | gpt-5.5 | streamable-HTTP route | Memory：模型调 `codepilot_memory_recent` 读出最近记忆 | ✅ | 用户实测：`codepilot_memory_recent` → PASS，读出最近记忆条数 1 |
| 2026-05-28 | codex_runtime | codex_account | gpt-5.5 | streamable-HTTP route | Widget：widget-keyword 对话里模型生成可渲染 widget | ✅ | 用户实测：聊天里渲染出 iframe widget，带「固定 / 导出 PNG / 查看代码」操作 |
| 2026-05-28 | codex_runtime | codex_account | gpt-5.5 | streamable-HTTP route | Tasks/Notify：模型调 `codepilot_schedule_task`，权限卡 Deny 后不执行 | ✅ | 用户实测：调用弹出权限确认卡；**Deny 后任务未创建**，模型明确报告 `user rejected MCP tool call`（证明审批门控真实阻断，非装饰） |
| 2026-05-29 | codex_runtime | codex_account | gpt-5.5 | streamable-HTTP route | Dashboard / CLI：read 工具自动可用、write 工具走审批 | ✅ | 用户实测：dashboard / cli 关键词触发后两路 MCP 注入；list/refresh/check_updates 自动调用，pin/update/remove + install/add/remove/update 弹出权限确认卡（Deny 真实阻断）|

### 未来可选验证（非收口门槛）

下列场景在 #31 收口时**未做**也不阻断归档——它们是后续若复现某类回归 / 接新 provider / 升级 Codex 协议时可以补的纵向 smoke，不是 Phase 8 的完成门槛。

| 场景 | 想验证什么 | Evidence 形式 |
|------|----------|---------------|
| 续聊（resume）仍可调 MCP | 同一 session 第二轮续聊，`thread/resume` 传入的 `config.mcp_servers` fingerprint 一致 → MCP 仍挂着、模型仍能调 | same thread/provider binding + resume payload diff |
| Codex via CodePilot proxy provider | 非 codex_account 路径下（OpenRouter / GLM / Kimi）Memory MCP 仍可调用 | proxy request id + mcpToolCall event |
| broken optional MCP server 不阻塞主回复 | 故意挂一个无法连通的 stream MCP，Settings / chat 显示「启动失败」状态但 thread 仍能正常 turn | mcpServer/startupStatus/updated `failed` 事件 + screenshot |
| elicitation 长时间挂起不死锁 | 模型触发 elicitation 但客户端不回应，等到超时后 Codex 不挂死 | permission timeout + decline 事件序列 |

完成准则（本轮收口）：

- 上方 Smoke Ledger 中标 ✅ 的行（5 项核心能力 2026-05-27 / 28 / 29）有真实证据。
- `codex-user-mcp-wiring.test.ts` 不再 pin “没有 MCP loader”，而是 pin “scanner executable 状态与 runtime injection 同源”。
- `docs/research/codex-sdk-app-server-coverage.md` 更新结论：SDK 仍非主控面，但 app-server MCP injection 已验证。
- 本计划从 `active/` 移至 `completed/`，`docs/exec-plans/README.md` 与 `refactor-closeout.md` 同步。

## 风险与防线

- **MCP server 生命周期**：Codex 负责启动外部 MCP server，CodePilot 也有自己的 MCP connection manager。两个生命周期不能互相抢同一进程。
- **权限语义**：MCP tool 可能触发本地副作用，必须走 mutationLevel / permission policy；不可因为是 Codex 调用就默认 allow。
- **resume config 漂移**：MCP config 变化必须重开 thread，否则续聊可能绑定旧工具集。
- **Codex Account 差异**：Codex Account 不经过 provider proxy，但仍走 app-server；如果 MCP 注入在 Account 下失败，要记录真实原因，不用 provider proxy 成功覆盖。
- **Context accounting**：Memory MCP 被调用后，context breakdown 不应伪造 memory 注入；只有真实注入 / tool invocation 的 tokens 才显示。
- **UI 承诺**：Settings 一旦显示“可调用”，必须有 start/resume 注入 + smoke 证据支撑。

## 决策日志

- 2026-05-21：用户要求在 Phase 7 UI/icon 优化后补 Codex Runtime 的 MCP / Memory 注入问题。结论：Codex app-server 支持 `config.mcp_servers`，当前 CodePilot 缺的是注入链路与 Memory MCP wrapper；先登记 Phase 8，等 Phase 7 完成后按 POC → 产品化 → Settings 翻转推进。
- 2026-05-27：Phase 7 收口，进入 Phase 0。Codex review + 文档复核：
  - **文档事实核对全部属实**（vendored ThreadStart/Resume Params 的 `config` override、app-server README 的 5 个 MCP 方法、`mcp_types.rs` 的 stdio + streamable_http、产品侧只注 `model_providers`、Memory MCP 是 in-process `createSdkMcpServer`）。
  - **待 fold-in 的修订（复核发现，尚未改各 Phase 正文）**：
    1. guardrail 失真——`codex-user-mcp-wiring.test.ts` Test 1 锁的是 4 个 Claude SDK loader 符号，**抓不到** Codex 原生 `config.mcp_servers` 注入路径；Phase 1/5 改写 guardrail 时新断言必须挂在 thread params 出现 `mcp_servers` / `buildCodexMcpServersConfig` 上。
    2. Phase 1「sse」措辞——Codex 原生只有 `Stdio` + `StreamableHttp`，无独立 sse；应写「CodePilot http/sse → Codex streamable_http；Codex 无原生 sse」。
    3. Phase 1 新测试避让已有 `unit/mcp-config.test.ts`，建议命名 `codex-mcp-config.test.ts`。
    4. 风险表补：Codex 自己 spawn `config.mcp_servers` 的 stdio 进程，生命周期归 Codex，与 CodePilot connection manager 可能重复启动同一 Memory MCP；stdio wrapper 不可依赖被 spawn 时的 cwd/PATH。
  - **Phase 0 已 live 验证通过**：用户提供现有 codex 二进制（`/Applications/Codex.app/Contents/Resources/codex`，`0.133.0-alpha.1`），在隔离 `CODEX_HOME` 下跑通（产物 `docs/research/codex-mcp-injection-poc/`）：
    - `generate-ts` 核对：live `0.133.0` 的 `ThreadStartParams` 与 vendored 逐字一致，thread/MCP 关键方法都在；漂移项（`mcpServer/reload`→`config/mcpServer/reload`、`turn/start` 跑提示、新增 `getAuthStatus`）已记录。
    - `thread/start` 接受 `config.mcp_servers` 注入 → 注入 server **即时启动**（`mcpServer/startupStatus/updated` starting→ready）→ `mcpServer/tool/call` 命中 fixture（memory_search→mem-1、fail_always→isError、ask_user→elicitation 往返安全 decline）。
    - broken server 启动失败被通知暴露（`status:failed` + 详细 error），且不阻塞 thread。
  - **Phase 0 暴露的两处文档纠正**（已写进 POC 记录，待 fold-in 到 Phase 0/3 正文）：
    5. per-thread 注入 server **不进** `mcpServerStatus/list`（该 RPC 实测对注入 server 返回 `data:[]`）；状态/失败走 `mcpServer/startupStatus/updated` **通知流**。Phase 0 断言方式 & Phase 3 状态桥接要按通知改，不能轮询 list。
    6. 「工具可调用」（`mcpServer/tool/call`，无需 auth）≠「模型自主调用」（`turn/start` 走模型，需 OpenAI 登录）。后者实测 `401 Unauthorized`，仍待登录后验证；按边界**未读 `~/.codex/auth.json`**，仅用 `getAuthStatus` 记录未登录。
  - 全程守边界：未改产品 start/resume、未翻 Settings capability、未动 guardrail 测试、未污染真实 `~/.codex`（隔离 `CODEX_HOME`，驱动脚本带拒绝闸）。
  - **下一步**：(a) `thread/resume` 续聊带同份 MCP config 的验证；(b) 若用户授权在临时 CODEX_HOME `codex login`，补「模型自主调 memory_search」一行 smoke；(c) 进入 Phase 1（`buildCodexMcpServersConfig` + Memory MCP wrapper），按修订 1（guardrail 挂在新注入路径）做。
- 2026-05-27：**Phase 1–3 实现完成并 live 验证**（待用户审查）。
  - **transport 决策**：Memory MCP 用 **streamable-HTTP route**（`/api/codex/mcp/memory`）而非 stdio wrapper。理由：打包态用 `utilityProcess.fork` 跑 standalone Next server，stdio 子进程难解析被打包的 memory 依赖；HTTP route 复用同一在跑的 server，dev/打包一致（与 provider proxy 同模式）。先 POC 验证 Codex streamable_http 可行（`poc-streamable-http.mjs`）再选型。
  - **零 refactor 复用**：`createMemorySearchMcpServer().instance` 本身是标准 MCP `McpServer`，跨 SDK 副本可 `connect()` 到 WebStandard HTTP transport；route 每请求新建实例（stateless），不重写 search/get/recent 逻辑（守 [[新 Agent 复用 contract]]）。
  - **Phase 1**：`src/lib/codex/mcp-config.ts`（buildCodexMcpServersConfig: stdio→{command,args,env}、http→streamable_http、sse→unsupported；buildCodexMemoryMcpConfig；fingerprintCodexMcpConfig；redact）；`/api/codex/mcp/memory` route；guardrail 改写为单向不变量（executable ⟹ injects）。
  - **Phase 2**：buildCodexThreadParams 合并 `mcp_servers`（account 仅 mcp_servers、proxy 两者）；DB 加 `codex_thread_mcp_fingerprint` 列（additive 安全迁移）；session ref 存读 fingerprint；start/resume 都注入，fingerprint 变化重开 thread。Memory MCP 注入门控 = assistant workspace（同 claude-client）。**仅注入 Memory MCP**，用户 MCP 注入留待 Phase 4（避免触 guardrail 禁止的 Claude loader + 与能力翻转配对）。
  - **Phase 3**：`mcpServer/startupStatus/updated` 移出静默组（failed→可见诊断、ready→轻量状态）；mcpToolCall completed 把 error 提进 canonical `tool_completed.error`；runtime 注册 `mcpServer/elicitation/request` → 安全 decline（`{action:'decline'}`）+ 可见 `mcpElicitationDeclined` 状态。OAuth：Memory MCP 不需要；用户 MCP 的 OAuth 链接处理留待 Phase 4。
  - **测试**：codex-mcp-config(13) / codex-memory-mcp-route(3) / codex-user-mcp-wiring 改写(3) / codex-mcp-injection(8) / codex-mcp-events(7)；全量 `npm run test` 3009 通过、typecheck 干净。
  - **端到端 live smoke**（`integration-phase-1-3.mjs`，2026-05-27）：真实 Codex 0.133 → 注入 Memory MCP（指向 :3001 dev server 的 route）→ startupStatus ready → `mcpServer/tool/call codepilot_memory_recent` 返回真实记忆文本。证据见 POC 记录。
  - **未做（守边界）**：未翻 Settings capability（Phase 4）；未注入用户 MCP；未读 `~/.codex/auth.json`；模型自主调用 auth-gated（Phase 5）。handover/insights 文档待 Phase 4-5 收口后补。
  - **审查修复 P1（route 鉴权，2026-05-27）**：Memory MCP route 原先直接信任 `x-codepilot-workspace-path` header → 任意本地进程可把 workspace 指向任意目录、经 `codepilot_memory_get` 读任意文件（攻击者选 root）。修复：route 校验 header realpath 等于 `getSetting('assistant_workspace_path')`，否则 403。把路由能力降到「只服务用户已配置的 assistant workspace」=不超过同用户已有的 FS 访问。补测试两条（configured→200 / 其他→403）；live route 实测任意目录 → `403 Workspace not authorized`。nonce 暂不加（同用户本地威胁模型下等值校验已充分）。
  - **复核 P2/P3（reviewer 看了旧快照）**：文档 line 101 早已是「监听 startupStatus 通知…不能用 list 断言」的改正版（在 commit 1071d5e）、Smoke Ledger evidence 已改、脚本注释已改正、header 无 trailing whitespace、`git diff --check` clean——均在上一轮已 fold-in，本轮无需再改。
- 2026-05-27：**Phase 4 完成**（用户确认翻转）。判断标准（用户拍板）：Runtime 层 executable = 原生 MCP 注入成功 + server ready + 手动 `mcpServer/tool/call` 返回真实 Memory（已验证）；模型在自然对话中是否主动调用属 Phase 5 真实登录 smoke，不作为 Phase 4 门槛。
  - **只翻 Memory**：`capability-matrix.ts` 把 `memory` 从 `CODEX_ACCOUNT_BRIDGE_DEMOTED_CAPS` 移除（它经原生 `config.mcp_servers` 注入，非代理桥，故 Codex Account 下也 executable）；widget / tasks_and_notify / image_generation / media_import 仍 perception_only（无原生注入）；用户 MCP 仍 perception_only（guardrail 不动，[[新 Agent 复用 contract]] 不受影响）。
  - **诚实 caveat**：新增 `CapabilityMatrixCell.noteKey` + `capability-display-text.ts` 的 `CAPABILITY_NOTES`/`getCapabilityNote`（双语）；codex_account 下 memory cell 带 `noteKey='memory_codex_native'`，UI（`RuntimeCapabilityList`）对任意状态渲染该 note。文案按本仓库「用户语言、不暴露内部词汇」规则**去掉了「Phase 5」「MCP」**（用户建议稿里有，但 capability-display-text 规则 #3 + 「describe in user terms」要求不漏架构词）：「Memory 已接入 Codex，可供模型调用；模型是否会在自然对话中主动使用它，待真实账号验证。」
  - **测试**：`harness-capability-matrix.test.ts` 拆分 codex_account 用例（4 个 bridge-only 仍 perception_only；memory → executable + noteKey 解析出双语文案 + 不含内部词汇）；全量 3014 通过、typecheck 干净。
  - **验证缺口（诚实记录）**：codex_account 专属的 caveat note 未在 live 页面目视确认（当前生效 provider 非 codex_account，无法在不改用户设置的前提下强制切换）；数据/逻辑已单测锁定，`/settings/runtime` SSR 返回 200（组件含改动渲染无错）。
  - **未做**：模型自主调用 smoke（Phase 5，auth-gated）。
- 2026-05-27：**Phase 5 关键发现 + dynamic tool bridge**（用户真实登录 smoke）。
  - **好消息**：Codex Account 登录后，模型在自然对话里**已主动调用** `codepilot_memory.codepilot_memory_recent {}` —— 最难的「模型会不会主动调」已过。注入 + 模型决策都 OK。
  - **根因（之前 POC 漏的一层）**：模型自主调用走 **server→client 的 `item/tool/call`**（`DynamicToolCallParams`），不是 POC 手动用的 client→server `mcpServer/tool/call`。runtime 没注册 `item/tool/call` handler → `CodexAppServerClient.routeServerRequest` 默认回 `-32601` → Codex 视为 rejected。**手动 POC 的 mcpServer/tool/call 只证明 MCP manager 可调用，不代表 turn 内自主调用闭环。**
  - **修复**：`src/lib/codex/dynamic-tool-bridge.ts` + runtime 注册 `client.onServerRequest('item/tool/call', ...)`。handler 仅允许 `namespace==='codepilot_memory'` + recent/search/get（safe_read），**转发回 `client.request('mcpServer/tool/call',{threadId,server:namespace,tool,arguments})`**（不绕过 Codex MCP 生命周期），把 `McpToolCallResult` → `DynamicToolCallResponse{contentItems:[{type:'inputText',text}],success:!isError}`（text 取 content[] 的 text，非 text/structuredContent 用 JSON 兜底）；unsupported namespace/tool 或 forward 失败 → graceful `success:false`，**不 throw**（避免 -32603）。
  - **schema 核对**：live `0.133` ServerRequest union 确含 `{ "method":"item/tool/call", params: DynamicToolCallParams }`；`DynamicToolCallParams{threadId,turnId,callId,namespace:string|null,tool,arguments}`、`DynamicToolCallResponse{contentItems,success}`、contentItem `{type:'inputText',text}|{type:'inputImage',imageUrl}` 全部逐字确认。
  - **测试**：`codex-dynamic-tool-bridge.test.ts`（forward 映射 namespace→server / isError→success:false / unsupported namespace+tool 不转发 / null namespace / structuredContent 兜底 / forward 抛错 graceful / source pin runtime 注册 item/tool/call 且经 mcpServer/tool/call 转发）。
  - **范围**：仅 Memory（safe_read 自动转发）；用户 MCP / mutating 工具留待接 mutationLevel / permission policy 后再放行。
  - **待确认**：用户重跑登录 smoke —— 同一句对话里模型调 Memory 应从「被拒绝」变成「读出真实 Memory」。我无法 headless 跑 authed turn（隔离 driver 不能登录，且不碰真实 `~/.codex`）。
- 2026-05-27：**真实根因更正（推翻 item/tool/call 假设）**。用户重跑 smoke 仍「被拒绝」；从 electron:dev 日志（`/tmp/p7c-electron-dev.log`，未碰真实 `~/.codex`）定位到真因：
  - **`item/tool/call` 全程出现 0 次**——模型自主调用 **不走** dynamic tool call。Codex 对它**自己管理的** `config.mcp_servers` MCP server 是**内部执行**，不反向请客户端。所以 Phase 5a 的 `item/tool/call` bridge 针对的是**未被触发的路径**（保留为防御性代码，但不是本问题的解）。
  - **真因是我 Phase 3 的 elicitation handler 无脑 decline**。Codex 在 `approvalPolicy: on-request` 下，把 MCP 工具调用的**审批**当成 `mcpServer/elicitation/request` 发给客户端；我的 handler 对所有 elicitation 回 `{action:'decline'}` → 日志 `tool_result ... success=false output=[{"text":"user rejected MCP tool call"}] mcp_server=codepilot_memory`（6 次 decline 对应 6 次 reject）。
  - **证据**：`<- response JSONRPCResponse {id:0, result:{"action":"decline"}}` → `op.dispatch.resolve_elicitation` → `codex.tool_result tool_name=mcp__codepilot_memory__codepilot_memory_recent success=false "user rejected MCP tool call"`。
  - **好消息**：模型**确实主动调用了** Memory、Codex **确实注入并执行**了 MCP——唯一坏的是我那个过激的 decline。
  - **修复**：elicitation handler 改为 **Memory server（`codepilot_memory`，safe_read / auto_safe）→ `{action:'accept', content:{}}`**，其余 server 仍安全 decline；加 `[codex.mcp-elicitation]` 日志记录 serverName/mode/hasSchema 以确认形状。待用户重跑确认「accept → 读出真实 Memory」。`content:{}` 是否够（若 approval elicitation 带 requestedSchema）由重跑日志确认。
- 2026-05-27：**#31 首切片：Widget 接入 Codex（以 Memory 为样板）**。Widget 结构同 Memory（`createWidgetMcpServer` 也是 `createSdkMcpServer`、`codepilot_load_widget_guidelines` safe-read、`show-widget` 文本 artifact）。
  - **泛化路由**：memory-only 的 route 改成 `/api/codex/mcp/[server]`，由 `builtin-mcp-servers.ts` 注册表服务多个内置 MCP（memory 需 workspace 等值鉴权；widget 静态文本无需 workspace scope）。`mcp-config` 加 `buildCodexWidgetMcpConfig` + `CODEX_WIDGET_MCP_SERVER_NAME` + `CODEX_MCP_ROUTE_BASE`（URL 路径=server 名）。
  - **注入**：runtime 关键词门控注入 widget——复用 `promptNeedsWidget`（从 `widget-guidelines.ts` 抽的共享 helper，与 Claude 路径同一 gate，不 per-runtime 复写）；claude-client 内联正则留作 de-drift 跟进。
  - **elicitation**：`decideCodexElicitation` 扩展为「safe-read 内置 server 集合（memory+widget）accept，其余 decline」。
  - **能力翻转**：`widget` 移出 `CODEX_ACCOUNT_BRIDGE_DEMOTED_CAPS`，codex_account 下 executable + `noteKey='widget_codex_native'`（caveat：模型自主生成 widget 待真实账号验证）。`show-widget` 渲染 runtime 无关（`parseAllShowWidgets`，已确认）。
  - **验证**：route(memory/widget/unknown)/config/injection/elicitation/matrix 单测 + 全量 3030 通过、typecheck 干净；live 路由实测 widget→200(serverInfo `codepilot-widget-guidelines`)、memory 任意 workspace→403、unknown→404。
  - **待真实账号 smoke**：widget-keyword 对话里模型是否自主调 guidelines 并输出可渲染 show-widget（同 Memory 的 auth-gated 验证）。verified 后把 caveat 文案转肯定式。
  - **范围**：仅 Widget；Tasks/Image/Media/Dashboard/CLI/用户 MCP 仍按 #31 逐项做（mutating/权限的不能照 safe-read 直接 accept）。
- 2026-05-28：**#31 Tasks/Notify 切片 + 按能力区分的审批地基**（commit `55f6b82`）。
  - **审批地基**：`builtin-mcp-servers.ts` 每个内置 MCP 声明 `elicitationPolicy`——safe-read（memory/widget）`auto_accept`、mutating（tasks）`user_approval`、未知 `decline`。`mcp-elicitation.ts` 把 `decideCodexElicitation` 拆成纯分类器 `codexElicitationPolicy` + `handleCodexMcpElicitationApproval`（mutating 工具复用 `registerPendingPermission` + `permission_request` SSE，落到既有 PermissionPrompt UI；用户同意才 accept，重复 RPC 幂等软 decline）。runtime elicitation handler 按策略分派。
  - **Tasks 注入**：notify MCP（`createNotificationMcpServer`）经 `/api/codex/mcp/codepilot_tasks` always-on 注入；`tasks_and_notify` 移出 `CODEX_ACCOUNT_BRIDGE_DEMOTED_CAPS`，executable + `noteKey='tasks_codex_native'`。
  - **审批硬化**（Codex review，commit `9c2f759`）：permission requestId 加 sessionId 作用域（`codex-mcp-elicit:${sessionId}:${jsonRpcId}`，避免跨会话/重连 JSON-RPC id 撞 stale DB 行被误判 duplicate）；把 elicitation `mode` + `requestedSchema` 放进审批 toolInput，使 message 笼统时弹窗仍可判断。
  - **真实账号 smoke 全通过（用户实测，2026-05-28）**：Memory（`codepilot_memory_recent`→PASS，记忆条数 1）、Widget（渲染 iframe widget，带固定/导出 PNG/查看代码）、Tasks/Notify（`codepilot_schedule_task` 弹权限卡，**Deny 后未创建**，模型报告 `user rejected MCP tool call`——证明门控真实阻断）。据此把 widget/tasks 的 caveat note 转为肯定式（Memory note 早已肯定）。
  - **测试**：`codex-mcp-events`（分类器 + 审批往返 accept/deny + sessionId 作用域回归 + 审计字段）、`harness-capability-matrix`（tasks executable + note）；全量 3033 通过、typecheck 干净；live 路由：`codepilot_tasks`→tools/list 暴露 `codepilot_notify`+`codepilot_schedule_task`、widget→guidelines、unknown→404。
  - **收口决策**：Image/Media 列为**独立产品决策点**（Codex 自带原生图片生成已接 MediaPreview；是否叠加 App Gemini 图片待用户拍板——不叠加则 Settings 写明，叠加则需在 Codex `mcpToolCall` 完成分支补 `__MEDIA_RESULT__` 解析）。Dashboard/CLI/用户 MCP **保持 deferred**（诚实降级，不翻可调用）。
  - **技术债**：`codex-mcp-events.test.ts` 用 synthetic session，`createPermissionRequest` 触发 `FOREIGN KEY constraint failed` 噪音（12/12 仍 pass，非用户路径 blocker）；后续改建真实 session 或 mock DB（见 tech-debt-tracker）。
- 2026-05-28：**#31 Codex 工具面 exposure audit + 修复 `codepilot_hatch_buddy` 泄漏**（Codex review 触发）。
  - **发现**：`/api/codex/mcp/codepilot_tasks` 实际 `tools/list` 返 **5** 个工具（含 `codepilot_hatch_buddy`），但 capability matrix 把 `assistant_buddy` 标成 `perception_only`。属于「工具其实暴露了，但 UI 说没有」的真实 drift——Tasks/Notify 切片把 `createNotificationMcpServer` 整包注入时，把 buddy 顺带带进了 Codex 的工具面。审批策略 (`user_approval`) 仍生效，所以不是静默执行，但 matrix 是错的。
  - **审计**：逐项核对 codex_account 视图下的 8 项 + 用户 MCP 行的 tool list 是否与 matrix 一致——memory（3 工具）/widget（1 工具）/image/media/dashboard/cli/user-MCP 全部一致；唯一 misalignment 是 buddy 通过 tasks 路由泄漏。
  - **修复**：`createNotificationMcpServer` 新增 `ctx.excludeTools?: readonly string[]`，在工具数组里用条件 spread 跳过对应工具（buddy 抽成 `createHatchBuddyTool()` helper 避免大块重缩进）；`codepilot_tasks` 注册项传 `excludeTools: ['codepilot_hatch_buddy']`。ClaudeCode SDK / Native 调用方默认行为不变（仍服务 5 个工具）。
  - **防回归**：route 测试新增两条 guard——(1) `createNotificationMcpServer({})` 默认列出 5 个工具（含 buddy），SDK/Native 无回归；(2) `getBuiltinMcpServer('codepilot_tasks').create(...)` 必须列出**精确** 4 个工具（notify/schedule/list/cancel），不含 buddy——这也卡住未来 notification-mcp.ts 加新工具时不会自动漏进 Codex。
  - **实测**：live `/api/codex/mcp/codepilot_tasks` `tools/list` 返 4 个工具，buddy 未出现；typecheck + 全量 3036 通过。
  - **未做**：buddy 在 Codex 下的「正式支持」(自主调用 smoke + matrix 翻成可调用)留作后续；当前是诚实降级。Codex review 建议的下一刀是 Dashboard/CLI 按 mutation level 拆（只读注入、写操作走审批），不先碰 image。
- 2026-05-28：**#31 Dashboard + CLI 按 mutation level 拆分注入**（Codex review next slice）。
  - **设计约束（事实确认）**：Codex `mcpServer/elicitation/request` 的 params 只带 `server_name` + `message` + `requested_schema`，**不带 tool_name**（参考 `资料/codex/codex-rs/app-server/tests/suite/v2/mcp_server_elicitation.rs`）。所以「同一个 server 里 read 自动、write 审批」的 per-tool policy 没法靠 elicitation handler 区分。**唯一干净方案**：拆成两个 server name，每个挂自己的 elicitation policy。
  - **实现**：`createDashboardMcpServer` + `createCliToolsMcpServer` 新增 `opts.includeTools?: readonly string[]` 参数（SDK MCP `tool().name` 直接暴露，过滤简单）；`builtin-mcp-servers.ts` 注册 4 个新 entry：`codepilot_dashboard_read`（auto_accept，list/refresh）/ `codepilot_dashboard_write`（user_approval，pin/update/remove）/ `codepilot_cli_tools_read`（auto_accept，list/check_updates）/ `codepilot_cli_tools_write`（user_approval，install/add/remove/update）；4 个 mcp-config builder 拼 streamable-HTTP URL；runtime 关键词门控注入（dashboard / cli 关键词，分别复用 `promptNeedsDashboard` / `promptNeedsCli`——从 `claude-client.ts` 抽到对应 MCP 文件，Claude SDK 路径同步切回共享 helper，遵守 [[新 Agent 复用 contract]]，不 per-runtime 重写正则）。
  - **能力矩阵翻转**：`CODEX_ACCOUNT_NATIVE_PROMOTED_BY_CAP` 新机制——`codex_proxy` 契约里 `unsupported`（默认 perception_only）但 Codex Account 下经 split MCP 注入的能力，矩阵层翻成 `executable` + `trustBoundary='mixed'` + 对应 noteKey。`dashboard_codex_native` / `cli_tools_codex_native` 双语 note 用用户能看懂的话写「查看自动、写入要确认」，不漏 MCP/elicitation/auto_accept 等内部词。
  - **防回归**：4 条 route tools/list guard（每个 server 必须精确暴露其 mutation-level 子集，多了少了都炸）；2 条 matrix 翻转 guard（dashboard / cli_tools 在 codex_account 下必须 executable + 'mixed' trust + 正确 noteKey + 无 suggestedRuntime）。这两层一起把「工具其实暴露了但 UI 说没有」+「matrix 说能但 server 没注入」两个方向都钉死。
  - **实测**：live 4 个 route tools/list 各自返精确子集（read 2 / write 3 或 2 / 4）；dashboard 路由 workspace 校验保留（错 workspace 仍 403）；typecheck + 全量 3042 通过。
  - **未做**：真实账号 smoke（自然对话里 dashboard/cli 关键词触发 + write 工具弹审批 + Deny 阻断）。完成后把 #31 表里两行的「待真账号 smoke」字样去掉。Codex review 建议的最后一刀（图片/媒体）仍是独立产品决策（叠不叠加 App Gemini）。
- 2026-05-28：**#31 Dashboard / CLI 拆分两个 P1 修复 + 契约文字同步**（Codex review 第二轮）。
  - **P1.1（注入门控 ≠ route 鉴权）**：runtime.ts 注入 dashboard read/write MCP 时之前只要 `prompt + workingDirectory + 关键词` 命中就注入，但 builtin-mcp-servers.ts 的 dashboard route 鉴权要求 `sameRealPath(workspacePath, assistant_workspace_path)`——所以模型能看到工具，调用时会拿 403。修复：dashboard 注入完整镜像 memory 的 workspace gate（`sameRealPath` + 用 `assistantWorkspacePath` 作为 `workspacePath` 入参，与 route 鉴权同口径），workspace 不对就根本不注入，避免「看得到但调不动」。CLI 不需要（无 workspace 依赖）。
  - **P1.2（matrix 只翻 codex_account，runtime 注入所有 codex_runtime provider）**：原本 matrix promotion 在 `providerId === 'codex_account'` 才生效，但 runtime.ts 注入 dashboard/cli MCP 时没按 provider 分支——所有 codex_runtime provider 都注入。结果非 account 用户能调用工具但 Settings 写「不可调用」。修复（按 Codex 建议「倾向前者」）：把 promotion 从 `capabilityMatrixForRuntimeProvider` 的 codex_account 分支抽出来，放到 `capabilityMatrixForRuntime` 里——对所有 codex_runtime provider 都生效；`buildCapabilityMatrix` 也通过 `capabilityMatrixForRuntime` 走，确保所有矩阵 API 一致。
  - **契约文字同步（Codex review non-blocking #1）**：dashboard / cli_tools 的 `deferredReason` + `codex_proxy.notes` 改写——明确「legacy 代理桥**确实**没建（kind:unsupported 还是事实），现在的路径是 mutation-level MCP split + matrix 层 promotion」。不改 schema（不动 `kind` 联合）；契约文字与实现行为现在自洽。
  - **测试不变量例外（Codex review non-blocking #1 副产品）**：`harness-capability-matrix.test.ts` 的「`exposure.kind=unsupported → 不可 executable`」严格不变量加了 `MATRIX_LAYER_PROMOTIONS` 例外白名单（dashboard / cli on codex_runtime）。例外里的 cell 必须满足 `executable + mixed trust + 非空 noteKey`（promotion 真的发生），否则测试照样报错。schema 清理（让 contract 长出 `mcp_server_split` kind 干掉这个白名单）写进 tech-debt #33。
  - **elicitation policy pin（Codex review non-blocking #2）**：`codex-mcp-events.test.ts` 补 4 条断言：`dashboard_read` / `cli_tools_read` → `auto_accept`；`dashboard_write` / `cli_tools_write` → `user_approval`。
  - **新增 P1.2 regression guard**：`codex_runtime + 任意 non-codex_account provider` 必须把 dashboard / cli_tools 也显示为 `executable + mixed + 正确 noteKey + 无 suggestedRuntime`——这条直接钉死「按 provider 翻」不能回头。
  - **「待真账号 smoke」字样保留**（按 Codex review 显式要求："尤其别急着把'待真账号 smoke'删掉"）。
  - **未做**：图片/媒体仍是独立产品决策；用户 MCP 仍独立工程。
- 2026-05-28：**Codex 原生图片入库（统一素材库管理）**。用户决定要做：Codex 自带 `imageGeneration` 生成的图片应该和 Gemini 生成的图片在同一个素材库里被统一管理。
  - **缺口诊断**：`materializeCodexEventMedia` 早就把 Codex 的 `savedPath` 复制进了 `~/.codepilot/.codepilot-media/` 并写了 DB 行（provider=`codex`），但**只传 `source: 'codex'` 给 `importFileToLibrary`，不传 `prompt`/`model`**——导致 DB 行的 `prompt='codex-out.webp'`、`model=''`、`metadata='{}'`。技术上"入库"，但素材库里**搜不到、识别不出来**——和"统一管理"不对齐。
  - **修复**：`MediaBlock` 增 `sourceMetadata?: { prompt?: string; model?: string }` 可选字段（渲染器忽略）；`buildImageGenerationMedia` 把 Codex item 的 `revisedPrompt` 抽出来塞进 `sourceMetadata.prompt`、`model` 标 `codex-image`；`materializeCodexEventMedia` 读 `block.sourceMetadata?.prompt|model` 透传给 `importFileToLibrary`。无 `revisedPrompt` 时（失败生成 / 老协议）回退到旧行为（filename）。
  - **Gallery API 同步**：`/api/media/gallery` 响应增 `provider` 字段；`GalleryItem` 类型同步。UI 现在能区分图片来源（chip / 筛选都可按需加，本轮先不动 UI 卡片）。
  - **测试**：两层各一组——event-mapper 层（`codex-tool-result-media.test.ts`）pin `revisedPrompt → sourceMetadata.{prompt, model='codex-image'}`、无 `revisedPrompt` 时 `sourceMetadata` 缺省；import 层（`codex-media-import.test.ts`）端到端验证 DB 行 `prompt = revisedPrompt`、`model = 'codex-image'`、`provider = 'codex'`，并验证回退分支不回归。全量 3049/3049 通过。
  - **影响范围**：纯 Codex 路径。ClaudeCode SDK / Native 走 Gemini MCP 的 `generateSingleImage()`，独立 DB 写路径，不受影响。
  - **未做（仍是产品决策）**：是否在 Codex 自带图片之上再叠加 App 的 Gemini 图片 MCP（会出现两个画图工具，需要 Codex 那条分支补 `__MEDIA_RESULT__` 解析）。当前一刀只让 Codex 自己生成的图能进库被找到。
- 2026-05-29：**#31 收口 — Dashboard/CLI 真账号 smoke + 图片/媒体 + 用户 MCP 用户决定 defer**。
  - **Dashboard / CLI 真账号 smoke 通过**（用户实测）：自然对话里关键词触发后 read+write 两路 MCP 都注入；read 工具（list / refresh / check_updates）自动调用、不打扰；write 工具（pin / update / remove + install / add / remove / update）弹出权限确认卡，Deny 真实阻断。`MATRIX_LAYER_PROMOTIONS` 例外 + Settings「可调用 · 部分需批准」标签描述与实际行为对齐。#31 表里这两行的「待真账号 smoke」字样**去掉**；Smoke Ledger 加 2026-05-29 一行。
  - **Image / Media — 用户决定 defer（不叠加 Gemini MCP）**：Codex 自带原生图片生成 + 已对齐到素材库（prompt / model / provider 都接进 Gallery API，渲染入 MediaPreview，库里能搜能识别）已经满足当前需求。再叠加 App 的 Gemini 图片 MCP 的成本（两个画图工具会让模型混淆 + 需要在 Codex `mcpToolCall` 完成分支补 `__MEDIA_RESULT__` 解析）大于收益，**不做**。要重启的话立独立计划，不混进 #31。
  - **用户自定义 MCP — 用户决定 defer**：和 built-in MCP 注入是完全不同的工程面：第三方 server transport（HTTP / stdio / SSE） + OAuth 登录回路 + 按 MCP 来源分级的权限策略 + per-workspace allowlist。**不做**，要做单独立项。
  - **#31 整体收口判定**：5 项核心能力（Memory / Widget / Tasks+Notify / Dashboard / CLI）全部真账号 smoke 通过；图片入库对齐；剩余两项用户明确 defer。Phase 8 / #31 整套工作功能性结束；后续如果用户路径出现 drift 或 Codex 协议变化再开新 slice。
