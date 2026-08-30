# Phase 5 — Codex Runtime 接入

> 创建时间：2026-05-12
> 最后更新：2026-05-19
> 状态：✅ 已完成并归档。Codex Runtime 主链路、Codex Account、provider proxy translator、Tool Bridge、Settings UI 收口均已完成；最后一轮 OpenRouter haiku 真实两轮 smoke 通过，`installed_idle` 状态文案修正为“已安装，可用 / 按需启动”。
> 协作边界：Codex 负责计划制定、方案审查和 Review；ClaudeCode 负责执行代码改动、测试和提交整理。除非用户明确重新授权，Codex 只改 `docs/` 下的计划 / 交接 / review 文档。
> 上下文同步：本计划不是只给 ClaudeCode 的任务列表。执行前必须读完“讨论脉络”与“Runtime Contract Hardening”，理解为什么 Codex 不能降级成 `Codex Account only`，也不能用三套 runtime 私有语义直接污染 UI。

## 讨论脉络

这段是给 ClaudeCode 的上下文，不是实现 checklist。

1. 起点：用户希望 Phase 5 变成 Codex Runtime 接入，而不是原先排在 Phase 5 的上下文可视化。
2. 初版判断：Codex 先作为 `Codex Account` 模型入口会更小，provider proxy 可后移。ClaudeCode 也指出 provider proxy 是独立大工程，担心用户价值不够清晰、三 Runtime invariant 复杂度过高。
3. 用户修正：这个收窄不符合产品定位。Codex 有自己的 Agent 能力和插件 / 工具生态，应该像 ClaudeCode 一样成为同等级 Runtime，而不是轻量模型入口。
4. 当前决定：Phase 5 仍然是完整 Codex Runtime。可以按里程碑执行，但完成口径必须包括 Codex app-server、Codex Account 模型、Codex 原生工具 / 命令 / 插件式 item / 文件改动 / 权限事件，以及 CodePilot provider proxy MVP。
5. 风险判断：ClaudeCode 对复杂度的担心成立。现在已有 ClaudeCode + CodePilot Runtime 两套 permission / model / session / tab metadata invariant；直接加 Codex 会制造 P0 风险。
6. 因此增加前置：Phase 0.5 Runtime Contract Hardening。它不是可选清理，而是接 Codex 前的工程安全带。先收口 session / permission / model / event / preview metadata 契约，再接 Codex app-server。
7. 审查重点：实现报告不能只说“加了 Codex Runtime”。必须说明三 Runtime invariant 如何被统一、哪些 UI 组件没有吃 Codex 私有字段、未知 Codex item 如何 fallback、provider proxy 覆盖与 unsupported reason 如何呈现。
8. 2026-05-14 验证结论：Codex Account 主链路已能实际跑通一轮 chat。UI 里选择 `Codex Runtime` + Codex Account 模型后，服务端日志显示走 `codex_runtime`，回复正常返回；`codex_account` 虚拟 provider、`runtime_pin='codex_runtime'` 白名单、`streamClaude` force-route 均已修过 review finding。
9. 2026-05-14 取舍曾经写成“Settings 状态卡 + 模型选择 disclosure 同批发布，Codex Runtime 暂时只显示 Codex Account 模型”。这个口径只适合 scaffold 阶段，不能作为产品目标。
10. 2026-05-15 用户修正：最终兼容目标不是“Codex Account only + 少量 OpenAI-compatible”，而是 **Codex Runtime 与 CodePilot Runtime 的模型能力对齐**。凡是 CodePilot Runtime（AI SDK / provider transport）今天能跑的模型，Codex Runtime 也应通过 CodePilot provider proxy 可用；唯一明确排除的是 Claude Code 默认/env 模式与 Claude Code CLI 私有账号路径。ClaudeCode-compatible / CodePlan 不能被永久延期成“后续再说”。Phase 5b 可以在代码内部按 adapter 轨道组织，但对外交付必须是一批完整实现，不接受先交 OpenAI-compatible 再反复补其它 provider 的半成品。
11. 2026-05-16 真实 smoke 发现新的 P0：Codex Runtime 的 **Codex 原生 shell/file 能跑**，例如能用 Codex 自己的 Bash 读取 `HEARTBEAT.md`；但 `codepilot_memory_recent` / `codepilot_list_tasks` 没有被 Codex 感知或调用。GPT-Image-2.0 相关修复也只补了工具结果闭环和 media 渲染的一部分，不能证明所有 CodePilot 内置工具 / Skills 已经可用。用户明确要求底线是：换成 Codex Runtime 后，CodePilot 自身的 Widget、助理、Memory、定时任务、图片 / 媒体等内置工具必须能被感知和调用，不能因为换 Agent 框架就失去交互能力。

## 一句话目标

把 Codex 像当前 Claude Code 一样接入为 CodePilot 的一个同等级 Runtime 框架：用户登录 Codex 后，CodePilot 能读取 Codex 账号可用模型；用户可以在 Runtime Selector 里选择 Codex Runtime；Codex 原生的执行能力、工具 / 插件事件、权限语义和 thread/session 生命周期都要进入 CodePilot 的现有 UI；同时通过 CodePilot provider proxy，让 Codex Runtime 也能使用 CodePilot 现有服务商 / CodePlan 模型。

这不是“Codex 输出格式适配”，也不是“上下文可视化”。上下文可视化顺延到后续 Phase；本阶段只做 Runtime 接入。

## 用户价值

ClaudeCode 和 Codex 不是互相替代的两个按钮，而是两种不同 Agent runtime：

- **复用 Codex 账号与模型**：已登录 Codex 的用户不需要在 CodePilot 里重新配置同一套 Codex 模型。
- **获得 Codex 原生能力**：Codex 的 app-server 暴露 thread / turn / item / command / file-change / token usage / account / model 等结构化能力，能比文本 CLI 更完整地映射进 CodePilot。
- **保留 CodePilot 工作区体验**：用户仍在 CodePilot 的 chat、文件树、Markdown / Artifact 预览、任务和通知里工作，而不是在 Codex 与 CodePilot 之间切换上下文。
- **为多 Runtime 打基础**：ClaudeCode、CodePilot Runtime、Codex Runtime 并列后，后续 Gemini / OpenClaw / Hermes 类 runtime 才有统一入口和验收标准。
- **最终复用现有 provider**：Codex Runtime 不能只停留在 Codex Account；本阶段完成口径是对齐 CodePilot Runtime 的模型能力。除 Claude Code 默认/env 模式外，CodePilot Runtime 能用的 provider/model 都应能通过 `CodePilot via Codex` 在 Codex Runtime 下运行；暂未接好的 provider 必须显示“proxy translator 未实现”的明确原因，不能被误写成永久不支持。

## 调研结论

| 结论 | 依据 | 影响 |
|---|---|---|
| 主协议应使用 `codex app-server` JSON-RPC，而不是 `codex exec` 文本输出 | `资料/codex/codex-rs/app-server/README.md`、`资料/codex/sdk/python/README.md`、`资料/codex/sdk/python/docs/api-reference.md` | 能稳定拿到 thread / turn / item / token usage / account / model 事件，不需要解析终端文本。 |
| Codex 原生模型从 `model/list` 读取 | `资料/codex/codex-rs/app-server-protocol/schema/typescript/v2/Model.ts`、`资料/codex/codex-rs/app-server/src/models.rs` | 登录 Codex 后先把 Codex account 的模型作为 `Codex Account` provider group 暴露到 CodePilot 模型选择器。 |
| Codex 登录状态通过 `account/read` 和 login flow 获取，不读本地 token 文件 | `资料/codex/codex-rs/app-server/README.md`、Python SDK account API | 避免直接读取 `~/.codex` 敏感文件；Settings 只显示 app-server 返回的账号状态。 |
| Codex provider 配置当前以 Responses wire API 为中心 | `资料/codex/codex-rs/model-provider-info/src/lib.rs` | CodePilot 现有 Anthropic / ClaudeCode-compatible / CodePlan provider 不能直接全量塞给 Codex；需要本地 Responses-compatible proxy/adapter。 |
| `model/list` 模型结构不直接暴露 context window | `Model.ts` 里只有 displayName / modalities / reasoning / service tiers 等；context 可从 token usage event 的 `modelContextWindow` 补充 | 第一版模型卡不承诺容量；运行后用 token usage 事件回填上下文容量。 |
| Codex 的工具 / 插件能力必须走结构化事件，不做文本模拟 | app-server notification 有 thread / turn / item 事件；Codex SDK 负责实际工具 / 命令 / 文件事件生命周期 | CodePilot 需要接收并渲染 Codex 原生 item，而不是把 Codex 降级成普通 text completion。 |

## 用户会看到什么变化

1. Settings → Runtime 出现 `Codex Runtime` 状态卡：能看到 Codex CLI / app-server 是否可用、当前是否登录、登录方式入口、版本信息和最近错误。
2. Settings → Models / Chat 模型选择器出现 `Codex Account` 模型组：用户登录 Codex 后，能看到 Codex 内置模型（含 displayName、reasoning effort、service tier 等可见能力）。
3. Chat composer 的 Runtime Selector 增加 `Codex Runtime`：选择后，新消息通过 Codex app-server thread/turn 执行。
4. Codex Runtime 的输出进入现有聊天 UI：assistant delta、工具 / 命令事件、插件事件、文件改动、token usage、错误状态都映射到 CodePilot 现有事件面。
5. Codex Runtime 运行目录、权限策略、会话绑定与 CodePilot 当前会话一致：不会默认跑到主目录，不会绕开 Worktree 隔离。
6. Codex Runtime 不止能跑 Codex Account 模型；通过本阶段的 provider proxy，最终应覆盖所有 CodePilot Runtime 已支持的 provider/model（Claude Code 默认/env 模式除外）。实现内部可以按 adapter 轨道组织，但对用户和 review 的交付必须是一批完整能力；UI 兼容矩阵在交付前可以表达“待 proxy translator 接入”，不能把这些模型永久置为不可用。

## 状态

| Phase | 内容 | 状态 | 备注 |
|---|---|---|---|
| 0 | POC 与契约确认 | ✅ 已并入实现 | 本机 `codex app-server`、`account/read`、`model/list`、`thread/start`、`turn/start` 路径随 Phase 1-3 落地验证。 |
| 0.5 | Runtime Contract Hardening | ✅ 已完成 | RuntimeId / session-store / permission union / event union / model compat 契约已落地并有 guardrail test。 |
| 1 | Codex app-server 管理层 | ✅ 已完成 | 进程发现 / 启停 / JSON-RPC client / server request / wildcard notification / status API 已落地；Settings 状态卡 UI 留到 Phase 6。 |
| 2 | 账号与模型同步 | ✅ 已完成 | `account/read` + login flow + `model/list` → `Codex Account` ProviderModelGroup；模型兼容只暴露给 `codex_runtime`。 |
| 3 | Codex Runtime Adapter | ✅ 已完成 | Runtime registry 接入；`codex_thread_id`；thread / turn / item / token usage 映射到 canonical events。 |
| 4 | Codex 原生能力 / 插件事件接入 | ✅ 已完成 | file_changed、approval bridge、turn interrupt、unknown item fallback、fs/watch 兜底已落地。 |
| 5 | CodePilot provider proxy for Codex | ✅ 已完成 | `/api/codex/proxy/v1/responses` 从 scaffold 进化为统一 translator，覆盖 OpenAI-compatible / Anthropic-compatible / CodePlan 家族；env provider 显式排除。 |
| 6 | UI / Electron / 测试收口 | ✅ 已完成主体收口 | Settings Runtime / Providers / Models IA、Codex 状态卡、模型 disclosure、runtime gate、Electron dispose 已落地；剩余模型可用性属于 Phase 5b provider proxy translator。 |
| 5b | CodePilot provider proxy translator | ✅ 已完成 | 统一翻译层基于 ai-sdk `createModel()` + `streamText`/`generateText`：Responses 输入 / 工具 / 流式事件 / 非流式响应四路转换 + 同一 adapter 覆盖 OpenAI-compatible、Anthropic-compatible、CodePlan 三个家族。`thread/start` / `thread/resume` 都注入 `model_providers.codepilot_proxy`；OpenAI OAuth refresh、OpenRouter Anthropic-skin、legacy alias canonicalization、willRetry lifecycle、text-delta self-allocate、macOS Codex.app fallback 均已收口。 |
| 5c | CodePilot Tool Bridge for Codex | ✅ 已完成 | Codex Runtime 下 Memory / Tasks / Widget / Image / Media 等 CodePilot 自有工具可感知、可调用并回 UI；Dashboard / CLI / assistant_buddy 等不支持项在 Settings 和工具提示中诚实降级，后续如需执行能力按 Harness Capability Contract 另开 slice。 |

## 详细设计

### Phase 0 — POC 与契约确认

目标是先证明协议和数据结构，不动主业务链路。

1. 在本 worktree 下做只读 POC 脚本或测试夹具，启动 / 连接 `codex app-server`。
2. 验证 `account/read`：
   - 未登录时能得到明确状态。
   - 已登录时能得到 account / auth 模式 / 是否需要 OpenAI auth。
   - 不读取 `~/.codex` token 文件。
3. 验证 `model/list`：
   - 记录 `id`、`displayName`、`supportedReasoningEfforts`、`defaultReasoningEffort`、`serviceTiers`、`inputModalities`、`isDefault`。
   - 明确 `modelContextWindow` 不在模型列表中，运行时从 token usage event 补。
4. 验证最小 thread：
   - `thread/start` 指定 `cwd`。
   - `turn/start` 发一条简单 prompt。
   - stream notifications 能拿到 assistant delta、turn completed、token usage。
5. 形成 guardrail：
   - 代码里不能把 `codex exec` 作为主 Runtime 协议。
   - 代码里不能直接读取 `~/.codex` token / auth 文件。

### Phase 0.5 — Runtime Contract Hardening

这是 Phase 5 的工程安全带。Codex 进来后会同时存在 ClaudeCode Runtime、CodePilot Runtime、Codex Runtime 三套执行语义；如果继续让 UI 和模型列表直接理解 runtime 私有字段，会把 permission / model / tab metadata / session resume invariant 放大成三倍。

前置审计范围：

| 区域 | 当前风险 | 需要收口的契约 |
|---|---|---|
| `src/lib/chat-runtime-shared.ts` | `ChatRuntime` 仍是 `claude_code | codepilot_runtime` 二值；client 入口散落 runtime 判断。 | 扩展到统一 runtime id，并提供只读 helpers；UI 只能用 helper，不写字符串分支。 |
| `src/lib/runtime/types.ts` | `RuntimeStreamOptions.runtimeOptions` 是松散袋子；runtime 私有 session id 容易外泄到 UI。 | 增加 `RuntimeSessionRef` / `RuntimeRunEvent` / `RuntimeCapabilities` 等窄契约；私有 metadata 只在 adapter-owned namespace 下。 |
| `src/types/index.ts` / `src/lib/runtime-compat.ts` | 兼容矩阵目前是 `claude_code_compatible` / `codepilot_runtime_compatible` 布尔叠加。 | 模型输出 `supportedRuntimes[]` + `unsupportedReasonByRuntime`；旧布尔只做迁移兼容，不再新增第三个散布尔。 |
| Permission UI / registry | ClaudeCode、Native、Codex 的 approval / sandbox 语义不同。 | Adapter 统一输出 `permission_request` / `permission_granted` / `permission_denied` / `permission_unavailable`，UI 不判断来源 runtime。 |
| Event stream | 当前 SSE 事件既承载 SDK 事件，也承载 Native 事件；Codex item 若直接塞 UI 会污染。 | Adapter 统一输出 `assistant_delta`、`tool_started`、`tool_completed`、`command_started`、`file_changed`、`usage_updated`、`run_completed`、`run_failed`。 |
| Preview / Tab metadata | Phase 4 的 PreviewSource / Tab trust tier 已经稳定，不能再挂 runtime 私货。 | Codex 文件 / Artifact / plugin item 必须翻译成通用 `file_changed` / `artifact_created` / `preview_source`，Panel state 不出现 Codex-specific 字段。 |

实施要求：

1. 先写 contract types / adapter boundary，再接 Codex。
2. Chat UI、RunCockpit、RunCheckpoint、ModelPicker、PermissionPrompt 不得新增 “if runtime is codex then ...” 的散落逻辑；必要分支集中在 runtime adapter / resolver / mapping 层。
3. Session metadata 统一：
   - CodePilot session 只知道 `runtimeId` 与通用 `runtimeSessionRef`。
   - Claude SDK session id、Native internal state、Codex thread id / turn id 均藏在 adapter-owned metadata 下。
   - Runtime 切换时不覆盖其他 runtime 的 metadata。
4. Permission 统一：
   - Codex approval / sandbox / command confirm 先映射到 CodePilot 内部 permission event。
   - 不确定语义时走 `permission_unavailable` 或 conservative prompt，不自动放行。
5. Model compatibility 统一：
   - `/api/providers/models?runtime=...` 基于 `supportedRuntimes` 和 per-runtime unsupported reason 过滤。
   - 旧 `claude_code_compatible` / `codepilot_runtime_compatible` 仅作 back-compat 输入，不再作为新 UI 的唯一输出。

Guardrail tests：

- `runtime-contract-shape.test.ts`：禁止新增第三个 `*_runtime_compatible` 布尔作为主契约；必须存在 `supportedRuntimes` / `unsupportedReasonByRuntime` 或等价结构。
- `runtime-ui-isolation.test.ts`：扫 ChatView / MessageInput / RunCockpit / RunCheckpoint / PreviewPanel，禁止直接分支 Codex-specific event / metadata；允许 RuntimeSelector 显示 label。
- `runtime-session-metadata.test.ts`：Codex thread id / Claude SDK session id / Native state 必须存放在 runtime-scoped metadata，不能平铺进 panel / preview tab state。
- `permission-event-contract.test.ts`：Codex / ClaudeCode / Native permission source 都映射到同一内部 permission event union。
- `runtime-event-contract.test.ts`：Codex item unknown type 必须落 fallback block，不得丢弃。

验收：

- 在不接 Codex 的情况下，ClaudeCode + CodePilot Runtime 现有消息发送、模型过滤、权限弹窗、Preview 自动刷新全部不回归。
- 加入 `codex_runtime` label 后，UI 不需要在多个组件里新增 codex 专用分支。
- 任何 Codex-specific 字段只出现在 `src/lib/codex/*` 或 runtime adapter 层；如果出现在 Chat / Preview 组件，需要 review finding 阻断。

### Phase 1 — Codex app-server 管理层

新增一个小而清晰的 Codex Runtime 基础设施层，不直接耦合 Chat UI。

候选模块：

| 模块 | 职责 |
|---|---|
| `src/lib/codex/app-server-client.ts` | JSON-RPC v2 client；方法封装：account、models、thread、turn、interrupt。 |
| `src/lib/codex/app-server-manager.ts` | 查找 `codex` binary；启动 / 复用 app-server；退出清理；错误分类。 |
| `src/lib/codex/types.ts` | CodePilot 内部 Codex event / model / account 类型，隔离上游 schema 漂移。 |
| `src/app/api/codex/status/route.ts` | Settings 状态查询；只暴露脱敏状态。 |
| `src/app/api/codex/login/*` | 触发 Codex login flow；只走 app-server account API。 |

关键规则：

- 不把 app-server 绑死到 dev server 生命周期；Electron 后续也要能复用。
- 不在 renderer 直接 spawn Codex；进程管理只在 server / Electron main 安全侧。
- 所有日志脱敏：不要打印 access token、refresh token、完整 auth headers。
- app-server 不可用时 UI 显示“未安装 / 不可用 / 版本过旧”，而不是让 Runtime 列表消失。

### Phase 2 — 账号与模型同步

先让用户看见“Codex 登录后 CodePilot 能读到 Codex 模型”。

1. Settings → Runtime / Providers 增加 Codex Account 状态：
   - 未安装 Codex：显示安装指引。
   - 未登录：显示登录按钮。
   - 已登录：显示账号摘要和模型同步状态。
2. 新增 Codex 模型同步路径：
   - `model/list(includeHidden=false)` → `ProviderModelGroup`。
   - Provider group 建议命名：`Codex Account`。
   - 模型 id 使用 app-server `Model.id` / `Model.model` 保持可追踪。
   - `displayName`、reasoning effort、modalities、service tiers 映射到 UI metadata。
3. Runtime compatibility：
   - 增加 `codex_runtime_compatible` 标记或等价能力字段。
   - Codex Account 模型默认只对 Codex Runtime 可见。
   - 不影响 `claude_code` / `codepilot_runtime` 的现有列表。
4. 缓存策略：
   - 短 TTL，手动刷新按钮。
   - account updated / logout 后清理缓存。

验收：

- 未登录时 `/api/providers/models?runtime=codex_runtime` 不返回假模型，只返回清楚的未登录状态或空组 + actionable issue。
- 登录后模型选择器能看到 Codex Account 的模型。
- 切回 Claude Code / CodePilot Runtime 时，不被 Codex-only 模型污染。

### Phase 3 — Codex Runtime Adapter

把 Codex 接入现有 Runtime registry，让它成为可选择的执行引擎。

候选改动点：

| 区域 | 预期改动 |
|---|---|
| Runtime types / registry | 新增 `codex_runtime` label、display name、capability。 |
| `streamClaude` / runtime selector | 分支到 Codex adapter，不再混在 ClaudeCode SDK 逻辑里。 |
| Session persistence | 保存 Codex thread id / turn id / sdk-like session id；支持 resume。 |
| Event mapper | app-server notification → CodePilot SSE / DB message / tool event。 |
| Permission mapping | Codex approval / sandbox events → CodePilot PermissionPrompt 或 waiting state。 |
| Token usage | `thread/tokenUsage/updated` → `TokenUsage`，捕获 `modelContextWindow`。 |

事件映射草案：

| Codex app-server event | CodePilot 行为 |
|---|---|
| `thread/started` | 写入 session runtime state / codex thread id。 |
| `turn/started` | 标记当前 run active。 |
| `item/agentMessage/delta` | assistant streaming delta。 |
| `item/started` / `item/completed` command/tool/file change | 映射到现有 tool / command / diff / file-changed UI。 |
| `thread/tokenUsage/updated` | 更新 token usage；如果有 context window，优先写入。 |
| `turn/completed` | finalize assistant message + run done。 |
| error / interruption | RunCheckpoint / banner / retry action。 |

会话规则：

- `cwd` 必须来自当前 CodePilot session working directory / `sdk_cwd`，不能默认主目录。
- Codex thread id 绑定 CodePilot chat session。
- 新会话首次 Codex message 走 `thread/start`；已有 Codex session 走 `thread/resume` + `turn/start`。
- Runtime 切换不应覆盖旧 runtime 的 session id；每个 runtime 独立保存自己的 thread metadata。

### Phase 4 — Codex 原生能力 / 插件事件接入

这一阶段回答“为什么 Codex 是同级 Runtime，而不是另一个文本模型入口”。

1. 工具 / 命令事件：
   - Codex app-server 的 item lifecycle 进入现有 tool / command UI。
   - shell / command 输出不混入 assistant 文本；保留结构化事件和状态。
   - 文件改动触发 `codepilot:file-changed`，复用 Phase 4 Markdown / Artifact 自动刷新。
2. 插件 / 扩展能力：
   - Codex 暴露的 plugin-like item 或外部能力事件必须被保留为结构化块。
   - CodePilot UI 不认识的 item 类型先显示可读 fallback，不直接丢弃。
   - 事件落库时保留 raw type / id / status，方便后续补 richer renderer。
3. 权限与 sandbox：
   - Codex approval / sandbox event 映射到 CodePilot 现有 PermissionPrompt 或明确 waiting state。
   - 不确定语义时采取保守策略：要求用户确认，不自动放行。
4. 线程与恢复：
   - Codex thread / turn 生命周期和 CodePilot session 绑定。
   - 中断 / resume / retry 不污染 ClaudeCode Runtime 的 session metadata。

验收：

- Codex Runtime 执行一个会列文件或读文件的任务，UI 中能看到结构化 command / tool 过程，而不是只看到最后文本。
- Codex 修改 Markdown 后，PreviewPanel 自动刷新。
- 未识别的 Codex item 不丢失，至少以 fallback block 可见。
- 需要审批的动作能到达 CodePilot permission UI 或明确 waiting state。

### Phase 5b — CodePilot provider proxy translator（一次性完整交付）

这是“Codex Runtime 下也能使用我们现在已经可以用的这些模型”的关键，但不能假装已经完成。

当前实现状态（2026-05-15）：

- 已有 scaffold：本地 `/api/codex/proxy/v1/responses` route、provider proxy injection helper、按 provider compat tier 返回结构化 `unsupported_yet`。
- 还没有 Responses API 请求/响应翻译、streaming 转换、provider transport forwarding，也没有让 `CodexRuntime` 用这个 proxy 真跑 CodePilot provider。
- 因此当前用户可用范围仍是：`Codex Runtime` 已能跑 `Codex Account` 模型；CodePilot 现有 provider 还没有真实接入 Codex。
- 但产品目标已经明确：**Codex Runtime 的模型兼容应与 CodePilot Runtime 对齐**。只把 OpenAI-compatible 当第一刀会让 GLM / 百炼 / Kimi / OpenRouter / CodePlan 等 CodePilot 已可用模型在 Codex 下长期不可用，不符合用户目标。
- 真实 translator 改名为 **Phase 5b**，但 Phase 5b 不再是“只做 OpenAI-compatible”的小口径；它必须在同一轮交付里覆盖 CodePilot Runtime 的主要 provider transport 能力。内部可以分轨开发，不能分批发布或只交一个 provider slice。

现实约束：

- Codex provider config 当前围绕 Responses wire API。
- CodePilot Runtime 已经能通过 provider resolver / provider transport / `claude-code-compat` adapter 跑多类 provider：OpenAI-compatible、Anthropic-compatible、ClaudeCode-compatible、CodePlan / 套餐型 provider 等。
- 因此不能只把 CodePilot provider 静态写进 Codex config；需要本地 proxy 把 Codex 的 Responses-shaped 请求转换成 CodePilot Runtime 现有 provider transport 能消费的内部请求，再把 streaming / tool-call / error / usage 转回 Codex 期待的 Responses shape。
- 唯一明确不纳入 parity 的是 Claude Code 默认/env 模式：它依赖 Claude Code CLI / Anthropic 账号私有上下文，不是 CodePilot Runtime provider，也不应通过 Codex provider proxy 伪装。

交付口径：

- **一次性完成，不拆两次 review**。ClaudeCode 可以在实现内部按 adapter 轨道拆文件、拆 commit、拆测试，但最终提交给 Codex review 的必须是一组完整成果：OpenAI-compatible、Anthropic-compatible / ClaudeCode-compatible、CodePlan / 套餐型 provider 三类主链路都要可运行或给出具体、可验证、非永久性的缺口。
- **不接受“先只做 OpenAI-compatible”作为 Phase 5b 完成**。OpenAI-compatible 可以作为内部第一个打通的 adapter，但不能作为对用户发布的完成边界。
- **不新增另一个 Runtime 语义层**。Phase 5b 是 Codex Runtime 使用 CodePilot provider 的桥，不是第四套 provider 系统；provider credential、model exposure、套餐白名单、错误分类都复用 CodePilot Runtime 的现有 resolver / transport 语义。

执行计划：

1. 建立 provider parity inventory：
   - 以 `codepilot_runtime` 当前可用模型为基准生成兼容矩阵：provider id、model id、compat tier、credentials 状态、transport 类型、media-only / chat-capable、是否属于 Claude Code 默认/env 私有路径。
   - 明确排除项只有 Claude Code 默认/env / CLI 私有账号路径与 media-only 非 chat 模型；其它 `codepilot_runtime` 可用 chat 模型默认都应进入 `codex_runtime`。
   - 这份矩阵要进入测试夹具或 contract test，防止后续新增 provider 时只更新 CodePilot Runtime、忘记 Codex proxy。
2. 完成本地 Responses-compatible proxy 主链路：
   - 继续使用 `/api/codex/proxy/v1/responses` 作为 Codex 看到的 Responses provider endpoint。
   - Codex 请求通过 header / model namespace / metadata 定位 CodePilot target provider 与 model；proxy 内部只调用 CodePilot provider resolver / transport，不直接读取 Codex Account，不绕过 CodePilot Provider / Models 设置。
   - 支持 non-stream 与 stream 两条路径；streaming 必须转换为 Codex app-server / Responses 期待的增量事件形态，不能只在结束时吐整段文本。
   - 支持 instructions / messages / input text / system prompt / temperature / max tokens / reasoning effort 的最小稳定映射；未知字段保守忽略并记录 debug 信息，不得传出敏感配置。
3. 一次性实现三类 adapter：
   - **OpenAI-compatible**：覆盖标准 chat/text、tool-call 占位策略、stream delta、usage、provider error。它负责打底统一 request / response / stream / error 框架。
   - **Anthropic-compatible / ClaudeCode-compatible**：复用现有 `claude-code-compat` adapter 与 provider transport 能力，把 Anthropic shape 的 messages / tool_use / thinking / alias / timeout 语义折到同一 Responses proxy contract；不能把它永久标成 unsupported。
   - **CodePlan / 套餐型 provider**：复用套餐型 provider 白名单、quota / auth / model exposure 规则，确保 GLM / Kimi / 百炼 / MiniMax / DeepSeek 等当前 CodePilot Runtime 可用模型在 Codex 下也可选、可发、可得到明确错误。
4. 统一错误与 usage 映射：
   - provider credentials missing、quota/rate-limit、unsupported media、proxy adapter missing、upstream timeout、tool-call unsupported 等错误要有结构化 code 与用户可读 message。
   - 对 Codex Runtime 来说，真正尚未覆盖的缺口写成 “Codex provider proxy 尚未覆盖该 provider 类型 / translator 尚未接入”；已接入但凭据缺失写 credentials；不要混成 “Codex 不支持此模型”。
   - usage / token / context window 能从 provider 返回时就映射；拿不到时不要伪造。
5. 接入 CodexRuntime provider injection：
   - 优先使用运行时 config override，让 Codex app-server 看到 `CodePilot via Codex` provider；不直接修改用户 `~/.codex/config.toml`。
   - 如果 app-server 当前不支持运行时 provider injection，再评估临时 shadow config；shadow config 必须在 CodePilot 管理目录中生成和清理，不能污染用户全局 Codex 设置。
   - Codex Account 与 CodePilot via Codex 要在 UI 和 resolver 中保持两个清晰来源：前者是 Codex 原生账号，后者是 CodePilot provider proxy。
6. 更新模型兼容与 UI：
   - `supportedRuntimes` 目标规则：凡 `codepilot_runtime` 可用的 chat 模型，除明确排除项外也应包含 `codex_runtime`。
   - 模型选择器在 Codex Runtime 下展示 `Codex Account` 与 `CodePilot via Codex`；仍不可用的模型置灰并给具体原因。
   - Settings → Providers / Models 不新增一套 Codex 私有配置；账户、模型、执行引擎仍各归其位。
7. 防回归测试与 smoke：
   - Unit：Responses request parser、provider target resolver、三类 adapter、stream event converter、usage/error mapper、provider matrix parity。
   - API：`/api/codex/proxy/v1/responses` non-stream + stream、credentials missing、unsupported media、upstream error。
   - UI/CDP：Codex Runtime 下模型 picker 全量展示；OpenAI-compatible、Anthropic-compatible / ClaudeCode-compatible、CodePlan / 套餐型 provider 各发一条真实 chat。
   - Electron：`npm run electron:dev` 下 Codex Runtime + CodePilot via Codex 至少跑一条 chat，退出时 proxy/app-server 不留 orphan。

验收：

- Codex Runtime 继续可以用 Codex Account 模型跑通一条 chat，不能被 provider proxy 改坏。
- Codex Runtime 可以通过 `CodePilot via Codex` 跑通至少三类真实 provider：OpenAI-compatible、Anthropic-compatible / ClaudeCode-compatible、CodePlan / 套餐型 provider。
- 所有 `supportedRuntimes` 包含 `codepilot_runtime` 的 chat 模型，除 Claude Code 默认/env 私有路径和 media-only 外，也应包含 `codex_runtime`；若没有，必须有具体 translator 缺口记录和测试断言。
- Claude Code 默认/env 模式不进入 `CodePilot via Codex`，UI 显示它属于 Claude Code Runtime 私有路径。
- 模型 picker 不再让用户误以为 CodePilot provider 在 Codex 下永久不可用；置灰原因必须区分 proxy 未覆盖、凭据缺失、套餐/额度、media-only。
- 失败时不能静默 fallback 到 Claude Code SDK 或 CodePilot Runtime；Codex Runtime 选择必须 fail-closed，并在 UI / logs 里说明 proxy 错误。

### Phase 5c — CodePilot Tool Bridge for Codex Runtime

这是 2026-05-16 smoke 后新增的 P0 计划。它不替代 Phase 5b provider proxy：5b 解决“Codex Runtime 用哪些模型”；5c 解决“Codex Runtime 是否还能使用 CodePilot 自己的工具、上下文和表现层能力”。

#### 背景与问题陈述

真实 smoke 给出的事实是：

- ✅ Codex 原生能力可用：Codex Runtime 能通过 Codex 自己的 shell/file 工具读取当前工作区文件，例如读取 `HEARTBEAT.md`。
- ❌ CodePilot 内置工具不可见：同一轮 prompt 明确要求 `codepilot_memory_recent` / `codepilot_list_tasks`，结果没有调用这两个工具，最后只得到 `memory=FAIL` / `tasks=FAIL`。
- ⚠️ GPT-Image-2.0 之前的修复只补了两类通用 bug：tool-result `toolName` 闭环、`imageGeneration` / `imageView` item 不再丢弃以及 media 通道补齐。它不能证明所有 CodePilot built-in tools / skills 都已在 Codex Runtime 下可见、可调用、可渲染。

用户底线：

- 每个 Agent 框架可以保留自己的特色能力和内置插件。
- 但 CodePilot 自己的核心能力不能因为切换 Runtime 就消失。
- Widget、助理功能、助理 Memory、定时任务、图片 / 媒体、Dashboard、CLI tools、文件改动通知等能力都属于 CodePilot 产品层，不能只在 ClaudeCode / Native Runtime 可用。

#### 目标

1. Codex Runtime 下，模型能 **感知** CodePilot 内置工具的存在与何时该用。
2. Codex Runtime 下，模型能 **调用** CodePilot 内置工具，工具执行结果能回到 Codex turn。
3. 工具结果能 **映射回 CodePilot UI**：media 走 `MediaPreview`，widget 走 show-widget / Artifact，file writes 走 `codepilot:file-changed`，task / notification 走现有任务与通知日志。
4. 所有能力用一个 capability matrix 验收，不再靠“某个 skill 修了”推断全局可用。
5. 这套桥要成为后续 Gemini / OpenClaw / Hermes 等新 Agent Runtime 接入的模板：每个新 runtime 都必须声明“原生能力”和“CodePilot-owned tools”两条通路。

#### 现有资产

不要重新手写工具清单。当前已有这些源头：

| 源头 | 用途 |
|---|---|
| `src/lib/builtin-mcp-catalog.ts` | 内置 MCP 能力目录，列出 `codepilot-notify`、`codepilot-memory`、`codepilot-image-gen`、`codepilot-media`、`codepilot-widget`、`codepilot-cli-tools`、`codepilot-dashboard` 及工具名。 |
| `src/lib/claude-client.ts` | ClaudeCode SDK Runtime 当前的 in-process MCP 注册逻辑，包括 always / workspace / keyword gating、system prompt 注入、allowed tools。 |
| `src/lib/builtin-tools/*` | Native Runtime 的 AI SDK tool 实现。部分能力已与 MCP 版本同源或接近同源。 |
| `src/lib/builtin-mcp-bridge.ts` | 早期桥接尝试，说明“从 SDK MCP tool 格式转 AI SDK tool 格式”是可行方向，但当前 `getBuiltinMcpTools()` 仍是空实现，不能当成已完成能力。 |
| `src/lib/runtime/contract.ts` / `event-adapter.ts` | Runtime canonical event 层，应该承接工具 started / completed / media / file_changed / unknown_item。 |

#### 能力矩阵

第一步必须输出并测试一张矩阵。矩阵不要只写文档；至少要有 unit test 从 catalog 或注册表生成，防止新增内置工具时 Codex Runtime 漏接。

| 能力族 | 代表工具 | 可见性要求 | 调用要求 | UI / side effect 要求 |
|---|---|---|---|---|
| Memory / 助理上下文 | `codepilot_memory_recent`、`codepilot_memory_search`、`codepilot_memory_get` | workspace 有 assistant memory 时可见；第一轮有明确提示 | 能读最近记忆 / 搜索 / 读取具体文件 | 不把 memory 大段塞进 system prompt；只通过工具返回可审计内容。 |
| 通知与定时任务 | `codepilot_notify`、`codepilot_schedule_task`、`codepilot_list_tasks`、`codepilot_cancel_task`、`codepilot_hatch_buddy` | always 可见；任务创建需注入 `origin_session_id` / `working_directory` | schedule/list/cancel 真实写库 / 读库 | delivery log、task run、origin session 继承保持 Phase 3 约束。 |
| Widget / Artifact 指南 | `codepilot_load_widget_guidelines` | 用户要求 widget / dashboard / 可视化时可见 | 能返回 guidelines | 生成结果仍走 show-widget / Artifact 渲染，不塞入不可执行脚本通道。 |
| 图片 / 媒体 | `codepilot_generate_image`、`codepilot_import_media` | 图片 / 素材关键词触发；也允许显式工具名 | 能生成 / 导入媒体 | 结果必须落到 `.codepilot-media` 或 `data`，通过 `tool_result.media` → `MediaPreview` 可见；savedPath 必须导入 media library 后再 serve。 |
| CLI tools 管理 | `codepilot_cli_tools_*` | CLI tool / install / register / update 语义触发 | install/update 等危险操作必须走 permission | 不绕过权限；执行输出与注册结果结构化返回。 |
| Dashboard | `codepilot_dashboard_*` | dashboard / pin widget / refresh widget 语义触发 | pin/list/refresh/update/remove 真实读写 dashboard 状态 | Dashboard UI 与 widget source metadata 保持一致。 |
| File changed | 来自 write/edit/tool result 或 Codex `fileChange` item | 不作为普通模型工具暴露，而是 runtime event | 修改文件后发 canonical `file_changed` | PreviewPanel quiet-refresh；dirty buffer 显冲突横幅。 |

#### 架构选项与当前取舍

被否掉 / 暂不采用：

- **只靠 prompt 告诉 Codex 有 `codepilot_*` 工具**：不够。模型可能输出伪工具调用文本，SDK / app-server 不会执行，之前 GLM/Kimi 与 pseudo XML 已经踩过这个坑。
- **让 Codex 用 Bash 直接调用 CodePilot HTTP API**：不够安全，也绕过工具 schema、permission、origin session、delivery log 等产品约束。
- **逐个 skill 打补丁**：会导致 GPT-Image 修了、Memory / Tasks 仍不可用；不能满足用户“内置工具必须可感知可调用”的底线。
- **把所有 CodePilot context 重新塞回 system prompt**：会倒退到上下文污染和 token 浪费；Memory / dashboard / tasks 这类数据应继续按需工具化。

当前推荐：

1. 建立 `CodePilotToolBridge` 作为 runtime-agnostic 工具注册层。
2. 源头优先复用 `BUILTIN_MCP_CATALOG` + 各 MCP server / builtin-tools 的 handler，不创建第二套业务逻辑。
3. 对 Codex Runtime，优先走 Codex app-server 支持的 tool/provider/plugin 注入方式；如果 app-server 只接受 Responses provider tools，则把 CodePilot tools 转成 Responses function tools，再由 proxy/adapter 执行。
4. 工具执行结果统一映射回 canonical events：`tool_started`、`tool_completed`、`file_changed`、`unknown_item`，不要让 Chat UI 直接理解 Codex 私有 item。
5. 对能力不可达的 runtime，用 capability matrix 明确显示“未接桥 / bridge unavailable”，而不是让模型假装会调用。

#### 执行计划

1. Inventory 与 contract
   - 新建 `src/lib/runtime/tool-capability-matrix.ts` 或等价模块。
   - 从 `BUILTIN_MCP_CATALOG` 生成内置工具族清单，标记 trigger condition、是否需要 workspace、是否可能产生 media / file_changed / permission。
   - 输出测试：catalog 中每个 `codepilot_*` 工具必须在 matrix 里有状态；新增工具没有状态时测试失败。

2. CodePilot tool registry
   - 抽出 runtime-agnostic tool descriptor：`name`、`description`、`inputSchema`、`execute(ctx, input)`、`resultMapper`、`permissionProfile`。
   - 复用现有 MCP handler / builtin-tools handler；不要复制实现。
   - 对需要 hidden context 的工具统一注入 `sessionId`、`workingDirectory`、`providerId`、`runtimeId`，尤其是 `codepilot_schedule_task`。

3. Codex bridge adapter
   - 把 CodePilot tool descriptor 转成 Codex 可理解的工具声明。
   - 如果 Codex app-server 原生支持动态工具注册，走 app-server 注册。
   - 如果当前实际链路只能通过 Responses provider proxy，走 Responses function tools：Codex 发 function_call → proxy 执行 CodePilot tool → function_call_output 带真实 `toolName` 回到 provider。
   - 工具不可用时返回结构化 `tool_unavailable`，不能让模型输出伪 XML / 伪 JSON 当成功。

4. Result mapping
   - text result → `tool_completed.output`。
   - media result → `tool_completed.media`，且本地文件先导入 `.codepilot-media` 再给 `MediaPreview`。
   - file write / edit result → `file_changed`。
   - widget result → show-widget / inline Artifact 的现有渲染路径。
   - task / notification result → delivery log / task run log 仍走 Phase 3 约束。
   - unknown structured payload → `unknown_item` fallback，不静默丢弃。

5. Permission and safety
   - 读类工具（memory get/search、list tasks）可按现有权限策略自动执行。
   - 写 / 执行类工具（CLI install/update、file write、dashboard update、schedule task）要保持现有 permission / trust 边界。
   - Codex approval bridge 与 CodePilot tool permission 不要互相绕过；未知语义默认拒绝或要求用户确认。

6. UI / Settings
   - Settings → Runtime 的 Codex 卡增加 capability health：Codex native tools、CodePilot built-ins、provider proxy 三块状态分开显示。
   - 不新增顶层 Codex 设置页；工具桥状态属于执行引擎健康状态。
   - 模型 picker 不承担工具可用性提示；工具桥异常应在 RunCheckpoint / Runtime status 中显示。

7. Smoke matrix
   - 每个能力族至少一条真实 smoke。
   - smoke 不只看“模型回复说成功”，还要查副作用：DB 行、media card、file_changed 事件、widget DOM、task list、delivery log。

#### 必须覆盖的 smoke

| Smoke | Prompt / 操作 | 通过标准 |
|---|---|---|
| Memory | “调用 `codepilot_memory_recent`，只输出 memory=PASS/FAIL” | 工具调用记录里出现 `codepilot_memory_recent`；不是 Bash 读文件；结果文本进入回复。 |
| Tasks | “调用 `codepilot_list_tasks` 列出当前 active tasks” | 工具调用记录里出现 `codepilot_list_tasks`；读取 DB/API 返回任务；不通过 shell。 |
| Schedule | “1 分钟后提醒我喝水” | `codepilot_schedule_task` 写入 task，带 origin session / working directory；到点通知。 |
| Widget | “生成一个简单 widget，必要时先加载 guidelines” | 调用 `codepilot_load_widget_guidelines`；最终渲染 show-widget / Artifact。 |
| Image | “用 GPT-Image-2.0 画一张小猫” | 调用 `codepilot_generate_image` 或等价 image tool；结果有 `tool_result.media`；MediaPreview 可见；savedPath 被导入 `.codepilot-media`。 |
| Media import | “导入这个本地图片到媒体库” | `codepilot_import_media` 生成 media DB 记录；图片可 serve。 |
| Dashboard | “把这个 widget pin 到 dashboard” | `codepilot_dashboard_pin` 写入 dashboard；Settings/Dashboard 可见。 |
| CLI tools safe read | “列出已安装 CLI tools” | `codepilot_cli_tools_list` 返回结构化结果。 |
| File change | “修改当前 Markdown 第一行” | runtime 发 `file_changed`；PreviewPanel quiet-refresh 或 dirty conflict。 |

#### 防回归测试

- `codex-tool-capability-matrix.test.ts`：catalog 中每个 `codepilot_*` 工具都有 Codex bridge 状态。
- `codex-codepilot-tool-visibility.test.ts`：Codex Runtime 构造 turn 时包含 expected CodePilot tool declarations；Memory / Tasks 至少 always/workspace 可见。
- `codex-codepilot-tool-execution.test.ts`：function_call → CodePilot tool execute → function_call_output 保留真实 `toolName`。
- `codex-codepilot-media-result.test.ts`：图片工具返回本地路径时必须导入 `.codepilot-media`，SSE media localPath 指向可 serve 路径。
- `codex-codepilot-file-changed.test.ts`：写类工具结果触发 canonical `file_changed`。
- `codex-codepilot-permission.test.ts`：危险工具不因 Codex bridge 绕过 permission。
- `codex-runtime-ui-health.test.ts`：Settings Runtime 卡能区分 Codex native ready / CodePilot tool bridge ready / provider proxy ready。

#### 完成口径

Phase 5c 只有在下面条件都满足时才能标 ✅：

- CodePilot built-in tools 的 capability matrix 完整，并由测试从 catalog 锁住。
- Codex Runtime 下至少 Memory、Tasks、Widget、Image/Media、Dashboard 或 CLI tools 各有一条真实 smoke 通过。
- 工具结果能回到 CodePilot UI，而不是只在 Codex 内部完成。
- 没有任何 smoke 通过 Bash / shell 模拟 `codepilot_*` 工具成功。
- 失败路径可见：工具桥没注册、工具执行失败、permission denied、media serve 失败，都要有明确 UI / log。

### Phase 6 — UI / Electron / 测试收口

这是已落地的收口层，不新增 transport、不改 schema、不做 provider proxy 翻译；目标是把 Codex Account 主链路变成用户可理解、可诊断、不会误选模型的产品入口，并为 Phase 5b 的 CodePilot parity 留出正确 UI 语义。当前下一步不是继续补 Phase 6，而是进入上面的 **Phase 5b provider proxy translator**。

UI 和交互：

1. Runtime Selector 显示 `Codex Runtime`，并区分状态：
   - Ready
   - Codex not installed
   - Not logged in
   - App-server failed
   - Model unavailable
2. Model picker：
   - 当前 scaffold 阶段，Codex Runtime 下只有 `Codex Account` 是真正可发送模型；其他 CodePilot provider 暂时 disabled。
   - disabled reason 必须表达为“Codex provider proxy 尚未接入 / 尚未覆盖该 provider 类型”，而不是“Codex 只能用 Codex Account”或“请切回其他 Runtime”这种永久性口径。
   - 模型选择器可以全量展示 + disabled + tooltip，但不能让 disabled 行可点击，也不能在 `runtime='auto'` 时失去 runtime gate。
   - provider proxy translator 完成后，所有 CodePilot Runtime 可用模型（Claude Code 默认/env 除外）归入 `CodePilot via Codex` 或等价分组，并变为可选。
3. RunCockpit / RunCheckpoint：
   - 显示 Codex Runtime 当前 thread / model / usage / permission 状态。
   - app-server 不可用时给出清晰修复入口。
4. Electron：
   - packaged app 能找到 bundled 或用户安装的 `codex`。
   - 关窗常驻不杀 app-server orphan。
   - 退出 CodePilot 时优雅停止 Codex app-server 子进程。
5. Settings Codex 状态卡：
   - 使用 `/api/codex/status`、`/api/codex/account`、`/api/codex/models`。
   - 显示 binary 是否找到、版本 / 路径、app-server 状态、登录状态、模型数量、最近错误。
   - 对 featured plugin / manifest warning 这类非阻断问题显示为 degraded / warning，不挡住 Codex Account chat。
   - 提供刷新状态 / 刷新模型入口；不读取 `~/.codex` token，不展示敏感字段。

测试：

| 测试 | 覆盖 |
|---|---|
| `codex-app-server-client.test.ts` | JSON-RPC request / notification / error / timeout。 |
| `codex-model-mapping.test.ts` | Model schema → ProviderModelGroup。 |
| `codex-runtime-events.test.ts` | app-server events → CodePilot SSE / DB。 |
| `codex-auth-guard.test.ts` | 禁止直接读取 token 文件；只用 account API。 |
| `codex-provider-proxy.test.ts` | CodePilot provider → Responses proxy contract。 |
| Browser/CDP smoke | Settings status、模型列表、Runtime 切换、chat streaming。 |
| Electron smoke | packaged / electron dev 下 app-server 生命周期。 |

## 不做什么

- 不把 `codex exec` 文本输出解析作为主 Runtime 协议；最多作为诊断 fallback。
- 不直接读取、复制、修改用户 `~/.codex` token / auth 文件。
- 不把 Codex 降级为“只读 Codex Account 模型的 completion 入口”；同级 Runtime 必须接入 Codex 原生工具 / 命令 / 文件 / 权限事件。
- 不要求每个 adapter 轨道落在同一个 commit；但 Phase 5b 不能分批发布、不能只交 OpenAI-compatible、不能把 Anthropic-compatible / ClaudeCode-compatible / CodePlan 写成永久后续。提交给 review 的成果必须是一批完整的 parity 实现。
- 不替换 Claude Code Runtime / CodePilot Runtime 的默认路径；Codex 是新增 runtime。
- 不做 Codex cloud/web agent 产品化，只接本地 Codex CLI / app-server。
- 不做上下文可视化；它顺延到后续 Phase。
- 不做多 Agent 编排 / OpenClaw / Hermes 兼容；Codex Runtime 稳定后再单独立项。

## 验收路径

1. Settings → Runtime：未安装 Codex 时显示“Codex not found”与安装指引。
2. Settings → Runtime：已安装未登录时，点击登录，完成后 `account/read` 状态更新。
3. Settings → Models：登录后出现 `Codex Account` 模型组；模型名称和 reasoning effort 正确。
4. Chat 新会话：切到 `Codex Runtime` + Codex Account 模型，发送“说一句 hello”，能流式返回。
5. Chat 旧会话：Codex thread id 能 resume；第二条消息带上历史上下文。
6. 文件/命令/插件事件：让 Codex 读目录、运行一个安全命令或触发一个 Codex 原生 item，CodePilot 显示结构化过程块；未知 item 有 fallback，不被吞掉。
7. 文件改动：让 Codex 修改一个 workspace Markdown 文件，PreviewPanel 收到 `codepilot:file-changed` 并刷新。
8. 权限事件：触发需要审批的命令，CodePilot 显示 PermissionPrompt 或明确的 waiting state，不静默失败。
9. 切 Runtime：从 Codex Runtime 切回 CodePilot Runtime，不丢旧 Codex thread metadata；切回 Codex 后可继续。
10. Phase 6 模型 disclosure：Codex Runtime 下暂未接入 proxy 的 CodePilot provider 模型可以显示为 disabled，但 tooltip 必须说明“Codex provider proxy 尚未覆盖”，而不是“请切回其他 Runtime”；Codex Account 模型可正常发送。
11. Phase 5b Provider proxy：同一批实现内，Codex Runtime 至少覆盖 OpenAI-compatible、Anthropic-compatible / ClaudeCode-compatible、CodePlan / 套餐型 provider 各一条真实 chat；所有 `codepilot_runtime` 可用 chat 模型最终应同步加入 `codex_runtime`，Claude Code 默认/env 模式和 media-only 除外。
12. Electron：`npm run electron:dev` 下 Codex Runtime 可用；退出 CodePilot 后没有 orphan app-server。

## 风险与降级

| 风险 | 降级策略 |
|---|---|
| 用户未安装 Codex CLI | UI 显示安装指引；Codex Runtime 不出现在可选 ready runtime 里。 |
| 用户未登录 Codex | `model/list` 不伪造模型；显示登录入口。 |
| app-server schema 变动 | 内部 `src/lib/codex/types.ts` 做窄类型适配；contract tests pin 关键字段。 |
| provider proxy 暂未覆盖某类 CodePilot Runtime provider | Phase 5b 交付前允许 UI 标 “Codex provider proxy 尚未覆盖该 provider 类型”；Phase 5b 交付时必须收敛到具体 adapter 缺口或真实运行错误，不能把整类 CodePilot Runtime provider 降级为永久不支持。 |
| 权限 / sandbox 语义不完全一致 | Phase 3 先 conservative：不确定时要求用户审批，不自动放行。 |
| Electron packaged 找不到 `codex` binary | Settings 提供路径检测 / 手动配置；不阻塞其他 runtime。 |

## 决策日志

- 2026-05-12：Phase 5 改为 **Codex Runtime 接入**。上下文可视化顺延到后续 Phase；本阶段目标是让 Codex 像 Claude Code 一样成为可选 Runtime，并优先读取 Codex 登录账号自带模型。
- 2026-05-12：主协议选择 `codex app-server` JSON-RPC，而不是 `codex exec` 文本输出。原因：app-server 暴露 account / model / thread / turn / token usage 等结构化事件，能稳定映射进 CodePilot Runtime。
- 2026-05-12：Codex 内置模型先作为 `Codex Account` provider group 暴露；CodePilot 现有 provider 通过后续 Responses-compatible proxy 接给 Codex Runtime，避免在第一批过度承诺所有模型都可用。
- 2026-05-12：接受用户修正：Codex 不能降级成 `Codex Account only` 的轻入口。Phase 5 完成口径改为“与 ClaudeCode 同等级 Runtime”：必须覆盖 Codex 原生工具 / 命令 / 插件式 item / 文件改动 / 权限事件，并交付 CodePilot provider proxy MVP。当时允许里程碑分批；2026-05-15 的 Phase 5b 口径已经覆盖这一点，provider proxy translator 不再按半成品分批发布。
- 2026-05-14：Round 5 review 后确认当前可交付边界：Codex Account 主链路已可在 UI 中跑通一轮；`codex_account` 虚拟 provider、`runtime_pin='codex_runtime'` 白名单、`streamClaude` force-route 均已修复。下一步先做 Phase 6（Settings Codex 状态卡 + 模型选择过滤 disclosure），两者必须一起发布，避免 Settings 显示“已配置”但聊天页误选 GLM / 百炼 / OpenRouter 等不可用模型。
- 2026-05-14：Provider proxy 改为 Phase 5b 单独推进。当前 `/api/codex/proxy/v1/responses` 是 scaffold，只能结构化返回 `501 unsupported_yet`；不能把它写成“Codex 已可使用所有 CodePilot provider”。当时曾考虑第一刀只做 OpenAI-compatible provider translator。
- 2026-05-15：用户明确修正模型兼容目标：Codex Runtime 不应长期只支持 Codex Account，也不应只扩到 OpenAI-compatible。期望是“除 Claude Code 默认/env 模式外，CodePilot Runtime 能用的模型，Codex Runtime 也能用”。Phase 5b 改为 CodePilot Runtime parity 目标；adapter 可以作为内部实现轨道，但对外必须一次性交付完整 proxy translator，最终兼容矩阵必须让 `codepilot_runtime` 可用模型同步进入 `codex_runtime`，或给出具体 translator 缺口。
- 2026-05-15：用户进一步确认 Phase 5b 不要拆两轮做，避免反复人工同步和 review。执行口径改为“一批完整实现”：OpenAI-compatible、Anthropic-compatible / ClaudeCode-compatible、CodePlan / 套餐型 provider 都必须在同一轮实现报告中给出真实 chat smoke、测试和未覆盖原因；不接受“先 OpenAI-compatible，后续再补”的半成品。
- 2026-05-16：真实 smoke 发现 Codex Runtime 只能证明 Codex 原生 shell/file 可跑，不能证明 CodePilot built-in tools 已接上。`codepilot_memory_recent` / `codepilot_list_tasks` 明确请求后未被调用；GPT-Image-2.0 相关修复也只是补了 toolName / image item / media 渲染链路，不等于所有 CodePilot tools 可感知。新增 Phase 5c：CodePilot Tool Bridge for Codex Runtime。完成口径改为 capability matrix + 每个能力族真实 smoke；不得继续用 Bash 或单个 skill 修复来代替 CodePilot 工具桥。
