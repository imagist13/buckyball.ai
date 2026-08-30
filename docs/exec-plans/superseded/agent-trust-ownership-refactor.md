> **Archive note（2026-06-05，document-system-governance）**：本计划已移出 `active/`，归入 `superseded/`——被 refactor-closeout 接管，仅作历史参考。**不是当前任务入口**；当前工作入口见 [exec-plans README](../README.md)，重启方式见 [superseded/README.md](README.md)。

# Agent Trust & Ownership Refactor

> ⚠️ **Superseded by [refactor-closeout.md](../completed/refactor-closeout.md)** — 不再单独推进，保留作历史参考。Phase 2A/2B/2C 已完成；剩余 Run Cockpit + session-level Runtime + 事件日志并入 refactor-closeout 的 **Phase 2（Runtime 与会话执行）**，长期助理叙事并入 **Phase 3（助理、定时任务、心跳通知）**。

> 创建时间：2026-04-25
> 最后更新：2026-04-29
> 工作区：`/Users/op7418/Documents/code/opus-4.6-test/.claude/worktrees/product-refactor-research`
> 关联调研：`docs/research/harness-and-ux-refactor.md`

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 产品原则、事实边界、范围冻结 | 🔄 进行中 | 本计划已作为本轮执行入口；DB 方向已确认，Luma 资源待定 |
| Phase 1 | UI 基线、Provider 样板页、设计原则沉淀 | 🔄 进行中 | shadcn Style 已切 radix-luma;`docs/design.md` **partial v1 已写**(0 lint error)含 sidebar/button/input/select/switch/card/tabs spec + 颜色 3 层 + Do/Don't + Confirm-vs-auto-apply 双路径;Provider 样板页 + design.md 完整版待 Phase 1.3-1.6 推进 |
| Phase 2A | **Provider Trust + Models Control** | ✅ **2026-04-27 阶段性完成** | Provider 卡片三栏、Add Service 五桶分类、保守自动刷新 + manual_* 保护、Models 页是 picker 暴露范围的单一控制点；详见下方 Phase 2A 决策日志 |
| Phase 2B | Runtime Trust | ✅ **2026-04-27 完成** | Claude Code Runtime + CodePilot Runtime 平级展示、降级原因 + 恢复路径；session 控制延后到 Phase 3 |
| Phase 2C | **Default Model Contract + Health + Logs** | ✅ **2026-04-29 阶段完成 / 收尾验证** | 默认模型升为 Models 页单一写入点；Auto/Pinned 双模式 + invalid-default 硬阻断 + 4 恢复 CTA；Settings → Health 顶级只读总览；About → 持久日志 + 脱敏 + Open log folder + 导出诊断包；旧"诊断 / 修复"承诺被收为"Health 索引 + Logs 取证"。详见下方 Phase 2C 决策日志 + 收尾验证 |
| Phase 3 | Run Cockpit + session-level Runtime | 📋 **下一步** | v1：chat 顶部状态条（当前 Runtime / Provider / Model / 默认来源 / 健康 dot）。v2：session-level Runtime 切换，仅影响下一轮消息（不热迁移正在 stream 的会话）。session_events 埋点跟随 v2 落库 |
| Phase 4 | Session / Context / Memory 基础设施 | 📋 待开始 | 事件日志、fragment ledger、Local Agent Adapter Registry、护栏文档、必要 schema/API |
| Phase 5 | 长期 Agent 最小闭环 | 📋 待开始 | 通知/定时任务只做服务长期助理叙事的最小闭环 |
| Phase 6 | 回归、CDP 验证、测试包 | 📋 待开始 | `npm run test`、UI CDP、smoke、Electron 包验证 |

> Phase 2 在执行中拆成了两块。**2A** 是 Provider / Models 控制面板（已完成），**2B** 是 Runtime Trust（下一步）。原计划把它们合一是因为当时没区分"用户认为他控制了什么"和"他在用什么 runtime 跑"——前者绑卡片 + 模型表，后者绑 SDK 子进程 + 兼容矩阵；信息架构必须分两块表达。

## 决策日志

- 2026-04-25: 本轮重构命名为 **Agent Trust & Ownership Refactor**。目标不是单纯换主题或整理代码，而是让用户清楚掌控运行环境、会话状态、上下文、记忆和工具。
- 2026-04-25: 顶层产品承诺定为：**CodePilot 帮用户掌控 Agent 的运行环境、上下文、记忆和工具，让用户可以放心把长期工作交给 AI，而不被某个模型、CLI 或托管平台锁住。**
- 2026-04-25: 交互原则定为：**确定性越强，界面越清楚；AI 越能接管，按钮越克制。**
- 2026-04-25: 明确将 Claude Code Runtime 与 CodePilot Runtime 都产品化。Claude Code Runtime 侧重兼容 Claude Code 生态；CodePilot Runtime 侧重开放、多 provider、可观察、可恢复。
- 2026-04-25: Provider / Model 兼容性必须分层表达：服务商能不能接 Claude Code，不等于该服务商下每个模型都能用于 Claude Code；Models 页要同时标出 Claude Code 兼容、Claude Code 实验兼容、仅 CodePilot Runtime、仅媒体、需验证。
- 2026-04-25: shadcn Style 更换为 **Luma**，作为统一表达层采用；不把“全页面无差别翻修”作为目标。核心页面必须围绕新的用户心智模型重排。
- 2026-04-25: Codex / Cursor 改版只作为可核验的设计参考：官方资料用于功能事实，用户提供截图用于视觉与布局启发，不把截图推断写成外部产品事实。
- 2026-04-25: Codex / Cursor 参考的定位定为“趋势校准 + CodePilot 转译”，不做界面克隆。只吸收与“可信、可观察、可拥有的 Agent 工作台”一致的部分。
- 2026-04-25: 借鉴 Cat Wu 访谈中的 AI-native 产品节奏：本轮采用 **preview + eval + dogfood** 机制。核心路径必须稳定；探索性能力明确标记 preview；每个阶段绑定可重复验收场景；CodePilot 自己的重构过程就是第一批 dogfood。
- 2026-04-25: DB 草案确认采用 `session_events` + `context_fragments` 单独建表；批准方向，但要求 Phase 4 落库前补齐事件关联字段、默认值一致性和脱敏策略（见 Phase 0.4）。
- 2026-04-25: `design.md` 不作为 Phase 1 起点，而作为核心页面验证后的沉淀结果。先做 Luma 基线升级和 Provider Trust 样板页，经用户与 Claude Code 反复调整后，再把稳定原则写入 `docs/design.md`。
- 2026-04-26: **保守自动刷新**取代 preview-then-apply 作为模型刷新默认路径。Add Service 成功后自动 probe + apply，per-provider "刷新" 按钮和顶部 "刷新全部 (N)" 都走同一条 helper（`runAutoDiscoverForProvider` / `probeAndApplyProvider` in `src/lib/auto-discover-models.ts`）。安全性靠数据层守卫——`applyDiscoveryDiff` 永远不翻动 `enable_source IN ('manual_enabled','manual_hidden')` 或 `user_edited=1` 的行，所以静默 apply 不会覆盖用户选择。preview-first 保留给"按推荐整理" + 高级 diff 对话框（保留为 orphan 复盘 / 强制重置入口）。
- 2026-04-26: **5-state `enable_source` 列**作为 `provider_models` 行的"为什么是当前状态"标记，distinct from `source`（数据来源）。状态值：`recommended` / `manual_enabled` / `manual_hidden` / `discovered` / `catalog`。用户在 Models 页 toggle enabled 时由 `updateProviderModelUserFields` 自动写 `manual_*`；refresh apply 读 `enable_source` 决定是否允许翻动。Models 页徽章直接对应这个标记。
- 2026-04-26: **Models 页是 chat picker 暴露范围的单一控制点**。Provider 卡片（资产）+ Models 页（暴露范围）+ Setup Center（入门诊断）三层职责完全分离；Provider 卡片不显示模型清单，Models 页不出现 Key 表单，Setup Center 不承载完整管理。Chat picker `/api/providers/models` 的过滤链：`enable_source IN (manual_hidden) → 永远剔除` → runtime filter（claude_code_compatible / codepilot_runtime_compatible）→ 用户搜索。
- 2026-04-27: **Phase 2 拆为 2A（Provider Trust + Models Control）+ 2B（Runtime Trust）**。2A 已阶段性完成，验收点：Add Service 五桶分组 + Provider 卡片三栏（icon 可用模型 / 上次刷新 / 接入方式）+ Models 页双行 section header + 5-state badge + 刷新全部 (N) 批量；测试 1223 通过；CDP 验证 6 项交互无状态错位。下一步进入 2B：Claude Code Runtime / CodePilot Runtime 平级展示，session-level "本次会用谁 + 为什么" 数据源到位。Run Cockpit (Phase 3) 在 2B 之后做；Runtime Trust 给 Cockpit 顶部状态条提供数据基础。
- 2026-04-27: **Phase 2B 范围拍板，4 条决策**：① Runtime 提到 Settings 侧栏顶级入口（不再藏在 Setup Center 内）— 确立"Providers / Models / Runtime"三层心智，Runtime 必须以"运行环境"而非"安装配置项"被理解；② Session-level 解释先在 Settings 内做**只读解释块**（"当前默认走谁 / 为什么 / 用什么 provider+model / 不可用时降级到什么"），完整的 session 控制由 Phase 3 Run Cockpit 在 chat 顶部承载；③ CodePilot Runtime 描述用**中等粒度三类**："能力 / 权限 / 上下文"，回答"它能替我做什么、会不会乱动、为什么和 Claude Code 不一样"；④ `session_events.runtime.selected` **Phase 2B 就最小落库**（runtime / reason / provider / model / fallback / session_id / timestamp），Runtime Trust 的核心是"可解释轨迹"而不是"当前状态 UI"，埋点必须先于面板，否则 Phase 3 / Phase 4 没有上游。
- 2026-04-27: **2B.6 调整为 deferred**。原计划要求 `session_events.runtime.selected` 在 Phase 2B 落库；评审发现 RuntimePanel 的 read-only 解释块可以直接从 `/api/providers/models?runtime=auto` + `runtime_applied` + 全局默认推导出"新会话会用谁"，并不强依赖事件落库。埋点是 DB schema + provider-resolver 改动，和本阶段的 UX 整改风险面不同，单独一个 commit 更干净。下游消费者是 Phase 3 Cockpit，做埋点跟 Cockpit 同期能更明确 schema。如果 Phase 3 推进时仍未落，重新提为 P0。
- 2026-04-27: **Session-level Runtime switching 纳入 Phase 3**。全局 Runtime 只作为"新会话默认值"；每个 chat session 应拥有自己的 Agent 引擎选择，用户可以在会话开始前选择，也可以在会话过程中切换。第一版不做运行中热迁移：正在 stream 时禁用切换或要求先停止；切换只对下一轮消息生效。切换后必须重新按目标 runtime 解析 provider/model，若当前组合不兼容，应给出可解释 fallback，并写入 `session_events.runtime.selected` / `runtime.changed`（from / to / reason / provider / model / fallback）。
- 2026-04-27: **Runtime 长期形态升级为 Local Agent Adapter Registry**。Claude Code / CodePilot Runtime 只是第一批内置 adapter；后续可把 Codex、OpenClaw、其它本地 Agent CLI、自定义 command 作为候选 adapter 纳入同一层管理。适配不要求一开始全能力 UI 化，按能力分层：可检测（installed/version/health）→ 可拉起（cwd/prompt/session）→ 可观察（running/waiting/failed/completed + output/log）→ 可恢复（stop/retry/open native session）→ 深度集成（tools/permissions/model/context/session resume）。UI 必须明确"哪些由 CodePilot 管，哪些由外部 Agent 自管"，避免把外部 Agent 自己的模型/工具/上下文错误拆进 CodePilot 的 Providers / Models 管理。
- 2026-04-29: **多 Agent 协作方向记录：主 Agent + 显式 `@agent` 调度**。未来聊天里仍保留一个主 Runtime / 主 Agent 负责理解用户意图、拆任务和汇总结果；Codex、Claude Code、OpenClaw、自定义命令等本地/外部 Agent 作为可被显式 `@codex` / `@claude-code` / `@openclaw` 调用的执行者。第一版不做自动多 Agent 编排，也不把所有外部能力 UI 化；先依赖 Local Agent Adapter Registry 提供 detect / launch / observe / log / ownership boundary，再在 Chat 中支持显式调用、结构化结果回写和 `session_events` 轨迹。主 Agent 可以在后续 preview 中建议"这个子任务适合交给 X"，但用户确认前不自动派发。
- 2026-04-29: **Self-Healing Agent Harness 转译**。该材料不直接变成"自动诊断 / 自动修复"功能清单，而是拆成两层：① 产品层把 CodePilot 从"运行前配置面板"推进到"Agent 运行质量闭环"：Health 是失败信号路由器，Run Cockpit 关注 outcome / fallback / recovery，`session_events` 记录结果信号，多 Agent 协作必须可追踪；② 开发流程层把 Codex review findings / 用户反馈 / CDP 失败 / 测试失败视为 signal，进入 `Signal → Triage → Fix → Verify → Guardrail` 闭环。Claude Code 是带护栏的执行者，不是自由扩范围的自动修复器。
- 2026-04-28: **Settings IA Phase 2.5：Overview redesign（dashboard 三层）**。原 Phase 2 Overview 是单列 5 卡，全用同样的 muted 卡片底色——视觉上是"配置页又一个"，没有 dashboard 的体感。本轮按"GitHub Settings / Cursor 计费页"的层级模式重做：① 顶部 Getting Started checklist（4 项：连接服务商 / 启用模型 / 验证 Runtime / 配置助理工作空间），未完成项展示深色 jump 按钮一直挂着，4/4 全完即整条隐藏（不留视觉噪音）；② 中部由 5 卡升为 6 卡 + 改 `lg:grid-cols-2`：把原"系统"拆成"版本与账户" + "设置 / 诊断"，"新会话默认"按用户心智改名为"服务商"，warning-tone 卡片用 `status-warning-muted` 浅色 accent + 深色 CTA 引导，已配置卡片去掉图标 bg 走 flat 背景——配置好的项不再"全黑亮"；③ 底部加 GitHub-style token 用量热力图：复用现成 `/api/usage/stats?days=N`（接口已支持到 365 天，无需后端改动），30/90/365D 切换 + 总用量 / 最活跃日 / 最长连续天数 / 当前连续天数 stats，"查看完整用量统计"跳 #usage。新增文件：`OverviewHeatmap.tsx`；OverviewSection 容器从 `max-w-4xl` 提到 `max-w-5xl` 给 2 列卡 + 365 天热力图留宽度。i18n 加 19 个 `overview.*` 键。CDP 验证：1440×900 桌面 + 800×900 窄屏均无溢出；checklist 在 force-show 模式下 2 pending + 2 done 行展示正确；热力图在窄屏靠 `overflow-x-auto` 兜住，stats 行 `sm:grid-cols-4` 自适应。
- 2026-04-29: **Phase 2C 阶段完成 + 诊断承诺降档为"Health + Logs"**。**全 7 块落地**：① 默认模型契约（`9a39d42` / `7e74200`）：`global_default_mode` schema + `resolveNewChatDefault` 返回 tagged status + 5 个调用方过新 shape + 13 单元测试；同 commit 修了 `setDefaultProviderId` 静默改写 user pin 的根因 bug，加 2 个回归测试。② Models 页默认入口（`a075670` / `90e64ff`）：顶部 Auto/Pinned 状态卡 + "改回自动" + 行级 PushPin（hidden 行原子两步"启用并设为默认" + 启用步失败回滚不写默认）+ 跨 Runtime "Other Runtime only" badge。③ Runtime 页 invalid-default banner（`4824a03`）：4 个 explicit recovery CTA — 切到对面 Runtime / 去启用此模型（deep-link 带 provider+model+filter='all' + 高亮目标行）/ 选别的默认 / 改回 Auto。④ Providers 页 default selector 删除（`f33b3b1`）：净减 95 行，pointer 卡引导去 Models 页。⑤ Settings → Health 顶级页（`3dc6c74`）：5 行只读 health（providers connectivity / runtime CLI / default model validity / models exposure / workspace），复用 useOverviewData 不造平行诊断管线。⑥ 旧诊断入口收敛（`d4c16dd`）：Overview Setup-Diagnostics 卡 → Health 入口；Health 底部从"深度诊断与修复"降为"需要进一步排查？ → 去 About"；About 卡名 "诊断与维护" → "支持与日志"。⑦ 持久日志支持（`9bf5856` / `748e457` / `f00a403` / `7821313` / `f3a42ed` / `5aafa87`）：Electron `app.getPath('logs')` 下的 `codepilot-main.log`，写盘前每行过 `electron/log-sanitize.ts` 脱敏（vendor 前缀 / Bearer / URL 凭证 / Authorization / **字段名规则** 覆盖 AWS / api_key / secret / password / `$HOME` 等），17 单元测试锁住每条规则；首次升级一次性 rotate 旧未脱敏文件为 `*.unsanitized-legacy.log`，rotation 失败时本会话写到 `codepilot-main-sanitized.log` fallback 不污染 canonical；marker 仅在成功时写。**产品定位调整（用户 2026-04-29 拍板）**：旧"诊断 / 修复"承诺被弱化——*Health 是日常状态索引，不是 wizard；问题排查靠 logs + issue。* Setup Center 留作 install / wizard 入口而不是"修复一切"按钮；ProviderDoctor 留在 Providers 页作为单 provider 探测工具，但不再是头条诊断动作。**收尾验证（2026-04-29）**：`npm run test` 1268/1268；CDP 6 页（Overview / Providers / Models / Runtime / Health / About）总体扫一遍 + 1440×900 / 560×900 两组视口 + 0 console error；6 重点用户路径走通（Auto/Pinned 默认切换、隐藏模型设默认、Runtime 切换、cross-Runtime pin → invalid-default、Open log folder Web 模式正确隐藏、Health → About logs deep-link）；旧"运行诊断"假动作 CTA 全部改名为真实导航。
- 2026-04-28: **Phase 2C 拍板：Default Model Contract + Settings → Health**。Phase 2A/2B 把 Providers / Models / Runtime 三层心智立起来了，但默认模型还跨层泄漏——存于 `settings` 表的 `global_default_model` / `global_default_model_provider`，**唯一写入点是 Providers 页**（资产页）；`resolveNewChatDefault` 不区分模式，不可达就 null + 调用方各自 fallback。结果：用户在 Providers 页设了 default，刷新 / 切 Runtime 后系统"半静默"替他跑别的，"我设了默认但系统不听"是长期 bug 的根。Phase 2C 把契约重立。**核心原则（用户 2026-04-28 拍板）**：*Pinned default is a hard promise — Auto is the only mode allowed to fallback.* `global_default_mode='pinned'` + 当前 effective Runtime 下 pinned provider/model 不可执行 → 必须曝光 invalid-default + **阻断新消息发送** 直到用户解决。chat 入口不允许为 pinned default 静默替代任何 provider/model。**6 个独立 commit**：① 2C.1 数据契约 + resolver 形状（schema migration、`resolveNewChatDefault` 返回 `{ status: 'ok' \| 'auto-resolved' \| 'invalid-default' \| 'no-compatible', provider?, model?, reason? }`、5 个调用方 + 单元测试改）；② 2C.2 Models 页成默认入口（行级"设为默认"、Auto/Pinned toggle、跨 Runtime 模型显式 badge）；③ 2C.3 Runtime 页 invalid-default banner + 4 恢复 CTA（切 Runtime / 启用模型 / 选别的默认 / 改 Auto）；④ 2C.4 Providers 页移除 default selector + "在 Models 页管理 →" 引导；⑤ 2C.5 Settings → Health 顶级页（侧栏放 Runtime 与 Usage 之间，聚合 Providers connectivity / Runtime CLI / Default-model validity / Models exposure / Workspace 5 个 section，Setup Center 仍是 wizard 模态保留）；⑥ 2C.6 旧诊断入口收敛（Overview Setup-Diagnostics 卡 → Health 入口卡，chat header 连接失败 → Health，About 仍是 Setup Center）。**4 条决策**：⒜ invalid-default 时**阻断发送**（不临时 first-compatible）— 半静默 fallback 是 bug 根源；⒝ 跨 Runtime 模型可被 Pin（用户可能在为切 Runtime 准备），但立刻进 invalid-default 可见状态，UI 写清"已固定，但当前 Runtime 不可执行"；⒞ Health 放 Runtime 与 Usage 之间（先建运行条件，再查健康，再看消耗——放 About 上面会让它退化为"维护杂项"）；⒟ 6 commit 节奏（不合并：2C.1 动契约、2C.5 动 IA，单独 review 单独回滚）。

## 事实边界

为避免计划里出现事实性问题，本节区分“已核验事实”“本地资料”“截图启发”和“本轮推断”。

### 已核验外部事实

- OpenAI 2026-02-02 公布 Codex app，公开定位是用于管理多个 coding agents、并行运行工作、协作处理长任务的 command center；公开页面另注明 2026-03-04 Windows 可用。
  来源：OpenAI 官方《Introducing the Codex app》。
- Cursor 官方 changelog 显示 Cursor 3 引入 Agents Window，用于跨 repo 和环境并行运行多个 agents，环境包括本地、worktrees、cloud、remote SSH；同时提到 Design Mode、Agent Tabs、`/worktree`、`/best-of-n`、Canvases、CLI `/config`、status bars、footer 显示 working directory / worktree / branch 等。
  来源：Cursor 官方 Changelog。

### 本地资料

- `/Users/op7418/Documents/code/资料/codex-main/README.md` 说明 Codex CLI 是本地运行的 coding agent，并可通过 `codex app` 进入桌面 app 体验。
- `/Users/op7418/Documents/code/资料/codex-main/codex-rs/app-server/README.md` 描述了 Thread / Turn / Item 的事件模型、`thread/status/changed`、`turn/started`、`turn/completed`、`item/started`、`item/completed`、token usage、MCP startup status 等事件。它可作为 CodePilot 事件流和运行状态设计参考。
- `/Users/op7418/Documents/code/资料/codex-main/codex-rs/tui/styles.md` 强调克制颜色和明确状态色，可作为“低噪声、高可读”视觉原则参考。

### 用户截图启发

- Cursor 设置截图启发：左侧稳定分类导航、中间窄内容列、设置项按主题分组、行内操作明确、页面留白克制。
- Codex/Cursor 工作区截图启发：左侧 agent / workspace 列表、中央 AI composer、右侧代码/文件工作区，整体表达“agent 中心 + 工具现场并存”。
- 截图只用于视觉和信息架构参考，不作为“最新版本一定具备某功能”的证据。

### 本轮产品推断

- CodePilot 的差异化不应停留在“多 Provider GUI”，而应升级为“用户可拥有的本地 Agent Harness”：服务商可换、runtime 可换、会话状态和记忆归用户所有。
- 用户最需要被解释的不是 harness 概念，而是四个问题：我现在用的是谁、为什么这么跑、这一轮把什么放进模型、出问题怎么恢复。

## 设计参考与 CodePilot 转译

Codex 和 Cursor 的新方向不是 CodePilot 要复制的界面，而是在验证一个趋势：AI 编程产品正在从“聊天入口”转向“Agent 工作台”。本轮参考对象用于校准趋势，不用于定义范围；CodePilot 只吸收与“可信、可观察、可拥有的 Agent 工作台”一致的部分。

### 行业信号

- Codex app 的公开定位是 agent command center，强调多 agent、并行任务、long-running work、worktrees、skills、automations。
- Cursor 官方 changelog 近期持续强调 Agents Window、worktrees、multi-root workspace、async subagents、canvases、runtime/status signals、配置菜单、设置页和工作区性能。
- 这些信号说明头部 AI 编程产品正在从单个聊天框，转向管理多个 agent、多个任务、多个执行现场。

### 视觉与交互启发

- 左侧稳定导航减少迷路感。
- 中央内容区克制，不把所有功能都做成大卡片。
- 设置页按确定性问题分组，行内操作明确。
- Agent / composer / editor / file tree / terminal 可以在同一工作区中并存。
- 视觉轻，但状态明确。

这些启发与本轮交互原则一致：确定性部分要清楚，AI 能接管的部分要收敛。

### 转译到 CodePilot

CodePilot 不能照搬 Codex / Cursor，因为核心资产不同。CodePilot 的关键资产是多 Provider、Claude Code Runtime + CodePilot Runtime 双运行体系、本地 memory/session/context ownership、Bridge / 助理 / 长期任务，以及中文开发者和多 API 场景。

转译关系：
- Cursor 设置页 → CodePilot 的运行环境中心。
- Codex command center → CodePilot 的项目工作现场 + 长期助理空间。
- Cursor statusline / runtime signals → CodePilot 的 Run Cockpit。
- Codex / Cursor worktrees 与多 agent → CodePilot 后续的多 session / worktree / sub-agent 编排。
- Codex skills / automations → CodePilot 的 Skills、通知、定时任务、Bridge 长期闭环。

结论：参考对象证明方向，但 CodePilot 的落点是开放、多 provider、本地可拥有的 Agent Harness，而不是 IDE 或单一模型平台的克隆。

## 产品目标

本轮之后，用户应形成稳定心智：

1. **运行环境是清楚的。**
   用户知道当前 provider、model、runtime、Claude Code 状态、网络和权限状态。
2. **Agent 运行是可观察的。**
   用户能看到工具、权限、上下文压缩、记忆检索、错误和恢复建议，不再只面对黑箱聊天流。
3. **长期状态是可拥有的。**
   会话事件、记忆、上下文摘要、项目状态由 CodePilot 本地持久化和解释，而不是被某个模型 API 或 Claude Code 黑箱状态完全接管。
4. **AI 能接管的事情不会被按钮淹没。**
   基础设施界面详细，Agent 操作界面克制，长期任务和记忆整理尽量交给 AI 主导。

## 三人协作机制

本轮实际协作角色只有三类：用户、Claude Code、Codex。借鉴 Cat Wu 访谈的关键点不是照搬 Anthropic 的组织流程，而是让这个小队用更快但更可控的方式迭代。

### 分工

- **用户**：负责产品 vision、用户判断、最终取舍，决定“什么值得做”。
- **Claude Code**：负责快速执行、批量改代码、跑测试、按计划落地实现。
- **Codex**：负责产品结构、事实校验、范围约束、方案审查，把零散讨论压成可执行文档，并在关键 schema / UI / runtime 决策前做 review。

### Golden Path

本轮不是把所有功能都做完，而是让一条核心路径稳定成立：

> 用户配置服务商 → 明确当前 Runtime → 在项目里启动 Agent → 看得懂它在做什么 → 出错能恢复 → 长期状态归自己所有。

所有阶段都用这条路径判断优先级。不服务这条路径的功能，即使正确，也默认延后。

### Preview 策略

- Run Cockpit 第一版标记为 preview：先解决可观察性，不承诺完整审计和 replay。
- Context Fragment Ledger 第一版标记为调试/可视化用途：先记录关键 metadata，不承诺保存完整上下文正文。
- 通知/定时任务第一版只做最小闭环：可以提醒、可以跳回上下文、失败有状态；不承诺完整 automation 平台。
- Luma Style 先覆盖核心页面和 token：不承诺全产品像素级翻新。

### Dogfood 策略

CodePilot 自己的本轮重构就是第一批 dogfood：

- Phase 1 先用真实 Provider 样板页 dogfood UI 原则，稳定后再写 `design.md` 约束后续页面。
- Phase 2 用 Provider / Runtime 状态面板解释本 worktree 的真实运行状态。
- Phase 3 用 Run Cockpit 观察本轮改造中的工具、权限、错误和 context 事件。
- Phase 4 用 `session_events` / `context_fragments` 记录本轮重构过程，反向验证 schema 是否够用。

### Evals

访谈里提到“10 个好的 eval 就很有用”。本轮不追求大而全的自动评测，先建立 10 个高价值验收场景：

1. 新用户配置 OpenRouter，完成测试、保存、设默认，真实聊天可用。
2. 新用户配置智谱或 Kimi，已知限制能显示，并给出恢复建议。
3. Claude Code installed / not installed / disabled 三种状态解释正确。
4. Provider 强制 CodePilot Runtime 时，原因、影响、恢复动作展示正确。
5. 慢 provider 首包期间持续 keepalive，不再误判为 330s timeout。
6. Context 压缩后，Run Cockpit 能看到 `context.compressed` 事件。
7. Memory retrieval 后，Run Cockpit 能看到来源和脱敏后的摘要。
8. Permission pending 时，用户能看见卡点、风险和可选动作。
9. 项目会话和长期助理入口不会混淆，空状态文案能说明区别。
10. Luma Style 切换后 6 个核心页面 CDP 验证无明显溢出、遮挡和 console error。

### Self-Healing Harness 转译

`自愈代理框架`材料对本计划的启发分为产品和开发流程两层，避免把"自愈"误解成一个能自动修好一切的按钮。

**产品层**

- **CodePilot 要从运行前控制面推进到运行质量闭环。** Providers / Models / Runtime / Health / Logs 已经解释"能不能跑、用谁跑、坏了去哪看"；Phase 3/4 要继续解释"这一轮跑得好不好、为什么失败、下次怎么避免"。
- **Health 是 Triage Center，不是万能 Doctor。** Health 只承诺确定性状态、影响范围、证据和下一步入口；无法判断根因时引导用户打开日志文件夹 / 导出诊断包 / 提交 issue，不承诺自动修复。
- **Run Cockpit 优先评价 outcome，不堆过程噪音。** 第一屏回答 runtime / provider / model / default source / fallback / blocked reason / recovery action；工具轨迹和上下文细节放在展开层。
- **多 Agent 协作必须先可追踪。** `@agent` 显式调用前置于自动派发；每次调用记录谁被调用、输入边界、输出摘要、失败原因、日志位置和恢复动作。
- **发布前的核心风险不只看编译。** 模型、prompt、context、tool contract、provider resolver、runtime fallback、默认模型契约都可能让用户看到"坏答案"；这些要进入 golden path，而不只是普通单测。

**开发流程层**

- **Review finding / 用户反馈 / CDP 失败 / 测试失败都是 signal。** Signal 不应只停在聊天里；P1/P2 必须变成修复 commit、tech-debt tracker 条目或 guardrail。
- **Claude Code 是带护栏的执行者。** 每次改动必须绑定具体 finding / exec-plan task；说明根因、改动文件、验证方式；不把小修复扩成无关重构。
- **修复必须闭环。** 采用 `Signal → Triage → Fix → Verify → Guardrail`：先描述信号，再归因，再做最小修复，再跑测试 / CDP，再判断是否需要文档或 guardrail。
- **同类问题第二次出现就升级为 guardrail。** 例如 runtime-filtered provider/model 错位、hidden model 泄漏、诊断承诺过度、日志脱敏遗漏，都应沉淀到 `docs/guardrails/` 或 `CLAUDE.md` 索引。
- **Golden path 是我们的轻量 Grader。** 不急着做三模型评审团，先用 10-15 条稳定用户路径做回归评估；每次 Phase 收口必须重新跑相关路径并记录结果。

### 文档状态契约

这套文档要服务"下一次修复"，不只服务本次讨论。本计划先采用轻量三层，后续再推广到执行计划模板：

- **文件夹管生命周期**：`active/` 表示正在推进，`completed/` 表示已完成归档，`research/` 放事实输入，`guardrails/` 放复发防线，`tech-debt-tracker.md` 放暂缓问题。
- **状态块 / YAML 管机器可读状态**：本计划后续收口时补 front matter，记录 `status`、`current_phase`、`last_verified`、`open_p1/open_p2`、`next_action`、相关 guardrails 和 golden paths。
- **Repair Ledger 管闭环**：P1/P2 finding 修复后不只留在聊天里，要在本计划或 tracker 中记录 `Signal / Triage / Fix / Verify / Guardrail / Status`。同类问题第二次出现时，必须升级为 guardrail 或 CLAUDE 索引。

## 用户心智模型

### 项目是工作现场

项目绑定 repo、cwd、branch、worktree、files、terminal、git、当前任务。项目会话强调“在这个现场把事情做完”。

页面表达：
- 顶部或侧边明确显示 cwd / branch / worktree / runtime。
- 文件、终端、diff、任务状态是项目会话的一等信息。
- 出现错误时优先给出与当前项目现场相关的恢复动作。

### 助理是长期关系

助理绑定用户偏好、记忆、日程、提醒、跨项目任务、长期上下文。助理空间强调“长期理解用户并主动协助”。

页面表达：
- Dashboard 是助理总览，不是聊天页装饰。
- Bridge、通知、定时任务更偏助理，但可以绑定到具体项目。
- 记忆、偏好、长期任务要有可解释的归属和来源。

### Runtime 是运行引擎

Runtime 不只是内部实现。它决定 provider 能力、工具行为、上下文管理、状态恢复和可观测性。

页面表达：
- Claude Code Runtime：兼容 Claude Code 生态和已有 CLI 能力。
- CodePilot Runtime：CodePilot 自己管理上下文、工具、记忆和会话状态，更适合多 provider、可观察和可恢复。
- Runtime 选择必须展示原因和影响，而不是只有开关。

## 交互原则

### 确定性基础设施要显性

适用范围：Provider、Model、Claude Code、Runtime、权限、网络、安装、费用、诊断。

要求：
- 信息详细、状态明确、操作完整。
- 可以有较多按钮，但每个按钮必须是确定性动作，例如测试连接、刷新模型、设为默认、打开 key 地址、诊断、修复。
- 不把基础设施问题交给 AI 猜。

### Agent 运行要可观察但少打扰

适用范围：工具调用、context、memory、hook、permission、error recovery。

要求：
- 展示状态、来源、影响和下一步建议。
- 默认收敛，必要时可展开。
- 避免把每个中间过程都变成显眼按钮。

### AI 能管理的部分要精简

适用范围：任务拆解、计划、总结、提醒、会话命名、记忆整理、跨项目归纳。

要求：
- UI 提供入口、确认、撤销、历史，不做按钮矩阵。
- 让 AI 发起建议，用户做少量确认。
- 复杂度下沉到对话和运行状态，而不是铺满页面。

## 信息架构

### Setup Center / 运行环境中心

承载确定性基础设施。

一级分组建议：
- Overview：当前运行环境健康度、默认 provider/model/runtime、关键告警。
- Providers：服务商控制中心。
- Models：模型目录、能力、可用性、刷新。
- Claude Code：安装、版本、登录、settings/MCP/hooks 影响范围。
- CodePilot Runtime：原生 runtime 状态、能力、限制、诊断。
- Network：代理、连接状态、国内网络环境提示。
- Permissions：默认权限策略、自动审批、风险说明。

设计参考：
- 采用类似 Cursor 设置截图的稳定左导航 + 中央内容列。
- 设置行可密，但每个分组只承载同一类确定性问题。
- 关键状态使用行内 badge 和右侧动作，不用大面积营销式卡片。

### Project Workspace / 项目工作现场

承载项目会话、文件、终端、diff、worktree。

一级结构建议：
- 左侧：项目 / 会话 / agent 列表。
- 中央：AI composer + message stream。
- 右侧：文件、编辑器、terminal、diff、artifact、run cockpit 可切换面板。

设计参考：
- 采用用户提供的 Codex/Cursor 工作区截图思路：agent 中心与编辑工作区并存。
- 默认界面应让用户一眼知道“当前项目现场”是什么。

### Assistant Home / 长期助理空间

承载跨项目、记忆、日程、通知、Bridge。

一级结构建议：
- Memory：长期记忆、主题页、最近写入、体检状态。
- Tasks：定时任务、提醒、长期自动化。
- Bridge：Telegram / 飞书 / QQ 等远程入口。
- Dashboard：助理总览和可执行建议。

要求：
- 明确与项目会话区分。
- 任务和通知可以绑定项目，但默认归属于助理的长期关系。

### Run Cockpit / 运行观察层

不一定是独立页面，可作为聊天页的顶部状态条 + 右侧详情面板。

回答四个问题：
- 我现在用的是谁？
- 为什么这么跑？
- 这一轮把什么放进模型？
- 出问题怎么恢复？

## 核心交付

### 1. Provider Trust

目标：服务商从“设置表单”升级为“运行环境控制中心”。

功能范围：
- 当前默认 provider / model 清晰展示。
- provider 连接测试和诊断。
- 模型刷新、模型可用性和能力标签。
- Key 获取地址、docs/pricing/status 链接。
- 已知限制提示：thinking、tool_search、timeout、计费方式、SDK/Native 适配限制。
- 错误恢复动作：重新测试、打开设置、切模型、切 runtime、查看网络。

验收：
- 新用户能在不理解 Claude Code 细节的情况下完成 provider 配置和测试。
- provider 错误不再只显示技术 stack 或原始 401/400。
- 默认模型不会因为端口/localStorage 等 UI 状态漂移而悄悄重置。

### 2. Runtime Trust

目标：把 Claude Code Runtime 和 CodePilot Runtime 都产品化。

功能范围：
- Runtime 状态模型：`available` / `selected` / `degraded` / `blocked` / `disabled`。
- Runtime 选择原因：全局设置、会话 override、provider 强制、CLI 不可用、用户禁用。
- Claude Code 状态：安装、版本、登录、settings/MCP/hooks 影响范围。
- CodePilot Runtime 状态：provider support、tool support、permission support、context/memory 管理能力。
- 切换 runtime 的影响说明：会话 resume、工具、MCP、权限、模型能力。

验收：
- 用户能明确知道当前会话为什么走 Claude Code 或 CodePilot Runtime。
- Claude Code 相关状态异常有明确恢复建议。
- Native/CodePilot Runtime 不再呈现为兜底备胎，而是原生能力。

### 3. Run Cockpit

目标：让 Agent 运行从黑箱变成可观察系统。

第一版展示：
- provider / model / runtime。
- cwd / branch / worktree。
- tools / MCP 状态。
- permission pending。
- context compressed。
- memory retrieved。
- provider/runtime error。
- retry/recovery suggestion。

交互形态：
- 默认顶部轻量状态条。
- 点击展开右侧详情面板。
- 状态多、按钮少；只保留高价值恢复动作。

验收：
- 用户不展开详情也能看出当前会话健康状态。
- 展开后能看见本轮关键事件和 context fragments。
- 交互不打断聊天主路径。

### 4. Session Event Log

目标：把长期 Agent 的状态从聊天消息里解耦出来。

事件类型第一版：
- `runtime.selected`
- `runtime.status_changed`
- `provider.tested`
- `provider.error`
- `model.selected`
- `tool.started`
- `tool.completed`
- `permission.requested`
- `permission.resolved`
- `context.fragments_built`
- `context.compressed`
- `memory.retrieved`
- `memory.written`
- `hook.injected`
- `turn.started`
- `turn.completed`

实现原则：
- 事件是 append-only。
- 消息表继续承载聊天历史；事件表承载运行轨迹。
- 事件 payload 必须结构化、可脱敏、可用于 UI 展示。

验收：
- Run Cockpit 不需要反解析消息文本即可展示运行状态。
- session resume / debug / export 有稳定事件来源。

### 5. Context Fragment Ledger

目标：记录每轮进入模型上下文窗口的关键片段。

Fragment 类型第一版：
- system prompt base。
- user/project/workspace instructions。
- provider/runtime hints。
- tool/MCP descriptions。
- hook injections。
- retrieved memory。
- dashboard/assistant hints。
- compressed summary。
- file/project fragments。

实现原则：
- 记录 metadata，不默认保存敏感正文。
- 对可展示正文做长度限制和脱敏。
- 与 context assembler 的 static prefix / volatile suffix 设计对齐。

验收：
- 开发者能调试“为什么模型看到了这个信息”。
- 用户能在 Run Cockpit 里理解“这一轮用了哪些上下文来源”。

### 6. Guardrails Docs

目标：给未来 Claude Code / Codex / reviewer 明确开发契约。

文件建议：
- `docs/guardrails/Runtime.md`
- `docs/guardrails/Session.md`
- `docs/guardrails/Context.md`
- `docs/guardrails/Providers.md`
- `docs/guardrails/Tools.md`
- `docs/guardrails/Memory.md`

每份文档必须包含：
- 负责的模块和文件。
- 不变量。
- 新功能触及时必须检查的点。
- 常见坑。
- 对应测试或 lint。

验收：
- `CLAUDE.md` 或 `AGENTS.md` 增加索引：改什么模块先读哪份 guardrail。
- 文档不是大作文，必须能指导代码审查。

### 7. Long-running Agent 最小闭环

目标：半成品收口只服务“长期 Agent 工作台”叙事。

建议优先候选：
- Notification MCP + 系统通知最小版。
- Scheduled task 最小版：once / interval 二选一先行，不强吃完整 cron。
- 任务完成后能写 session event，并可跳回关联 session/project。

验收：
- 用户可以让助理“稍后提醒我/任务结束通知我”。
- 通知事件能回到对应会话和项目。
- 不为了功能完整度牺牲稳定性。

## 设计系统落地

### shadcn Style：Luma

原则：
- 可以全局切 token。
- 不因 Style 切换重写所有页面。
- 核心页面按新信息架构重排：Setup Center、Project Workspace、Run Cockpit。
- 非关键页面只做 token 对齐和明显破损修复。

### `design.md` 最小可执行版

定位：
- `design.md` 是 Phase 1 的沉淀结果，不是第一步输入。
- 先通过 Luma 基线升级、核心 UI 破损修复、Provider Trust 样板页验证真实界面。
- 等用户和 Claude Code 在样板页上确认信息密度、状态表达、按钮数量、卡片使用和错误恢复方式后，再写入 `docs/design.md`。

第一版必须覆盖：
- Colors：语义色、状态色、背景层级。
- Typography：页面标题、设置行、状态 badge、聊天正文、代码/终端文本。
- Layout：设置页、项目工作区、聊天页、右侧面板。
- Components：Button、Input、Select、Switch、Dialog、Sheet、Tabs、StatusBanner、EmptyState、RunStatus、ProviderStatus。
- Interaction：确定性动作、AI 建议、确认/撤销、错误恢复。
- Do / Don't：按钮密度、卡片使用、状态展示、AI 可接管场景。

验收：
- Provider 样板页稳定后，新增或重构 UI 才开始直接引用 `design.md`。
- CDP 验证桌面和移动/窄窗口不出现明显遮挡和文本溢出。

## 明确不做

本轮不做：
- 完整 Managed Agents 架构。
- 远程 sandbox / 云端执行环境。
- 所有 provider 余额/用量 API 覆盖。
- Hermes 未完成三项全部落地。
- 全产品页面无差别翻修。
- 自动发版、自动打 tag、自动 push。

可作为后续计划：
- 多 brain / 多 hand 调度。
- 远程环境和 VPC 连接。
- 全量 session replay。
- provider billing 深度集成。
- memory topic pages + 自动体检完整实现。

## 分阶段实施

### Phase 0：范围冻结

#### 任务

| # | 任务 | 状态 | 备注 |
|---|------|------|------|
| 0.1 | 用户确认本计划为唯一执行入口 | ✅ 2026-04-25 | 用户明确指示以本计划为入口 |
| 0.2 | 收束 `docs/research/harness-and-ux-refactor.md` 的排期表述 | ✅ 2026-04-25 | 移除决议 / 章节清单 / 一周排期 / 预警 / Gate 待澄清，仅保留事实速览作为输入 |
| 0.3 | 标记冲突或被吸收的 active exec plans | ⏳ 进行中 | 表见下 |
| 0.4 | 确认 DB 新表方案 | ✅ 2026-04-25 | Codex 过目确认：`session_events` + `context_fragments` 单独建表，Phase 4 落库前按下方约束微调 |
| 0.5 | 确认 Luma Style 来源 | ✅ 2026-04-25 | 已确认 Luma 是 shadcn v4 官方 Style（changelog 2026-03-31，inspired by macOS Tahoe minus the glass）。CodePilot 用 Radix → 选 `radix-luma`。registry 路径 `apps/v4/public/r/styles/radix-luma/`，安装入口 `pnpm dlx shadcn add https://ui.shadcn.com/r/styles/radix-luma` |
| 0.6 | 在 `CLAUDE.md` 增加"改 X 模块前读 Y guardrail"索引段落 | 📋 待开始 | 待 Phase 4 guardrails docs 落盘后追加，不在 Phase 0 完成 |

#### 0.3 — Active exec plans 重叠分类

依据：逐份读 active 目录中除本文档外的 23 份计划的标题 + 创建时间（`docs/exec-plans/active/*.md` 头三行），按"是否落入本计划 Phase 0-5 范围"归类。

**A. 被本计划吸收（本轮以新计划为准，旧计划归档为已完成或并入对应 Phase）**

| 旧计划 | 旧计划状态 | 并入位置 |
|---|---|---|
| `provider-resolver-refactor.md` | 标 "Complete (Phase 1–5)" | 待归档至 `completed/`（当前文件仍在 active 目录） |
| `electron-port-stability.md` | 已修待发版 v0.50.2 | 并入 Phase 2（默认模型不再漂移验收） |
| `cc-switch-credential-bridge.md` | 已修待发版 v0.50.2 | 并入 Phase 2（Claude Code 状态展示） |
| `runtime-auto-and-onboarding.md` | 已修一部分 | 并入 Phase 2（runtime state model + 选择原因） |
| `provider-governance.md` | 已修一部分 | 并入 Phase 2（Provider Trust 信息架构） |
| `agent-runtime-abstraction-revision.md` | 设计稿 | 并入 Phase 2（runtime state model 定义） |
| `unified-context-layer.md` | 设计稿 | 并入 Phase 4（Context Fragment Ledger） |
| `context-storage-migration.md` | 设计稿 | 并入 Phase 4（Session Event Log + 持久化） |
| `scheduled-tasks-notifications.md` | 设计稿 | 并入 Phase 5（长期 Agent 最小闭环） |
| `composer-refactor.md` | 进行中 | 并入 Phase 1（Project Workspace 信息架构 + AI composer） |

**B. 作为依赖/输入，继续独立运行，不进本计划进度条**

| 旧计划 | 关系 |
|---|---|
| `decouple-claude-code.md` / `decouple-test-plan.md` | 双 runtime 解耦的工程依赖，Phase 2 引用其产物 |
| `agent-sdk-0-2-111-adoption.md` | Claude Agent SDK 升级，作为 Phase 2 底层依赖 |
| `opus-4-7-upgrade.md` | Opus 4.7 模型迁移，Phase 2 Provider Trust 涉及但不主推 |
| `chat-latency-remediation.md` | 延迟修复（已大量落地），Phase 3 Run Cockpit observability 引用 |
| `memory-system-v3.md` | V3/V3.1 已上线，Phase 4 Memory 部分作为现状输入 |
| `issue-tracker.md` / `v0.48-post-release-issues.md` / `open-issues-2026-03-12.md` | 持续 Bug 跟踪，Phase 2 / Phase 3 修复直接接入 |

**C. 完全不在本计划范围，各自独立**

| 旧计划 | 理由 |
|---|---|
| `qq-bridge-channel.md` / `weixin-bridge-channel.md` | Bridge 通道，本计划"明确不做"无差别翻修 |
| `git-terminal-integration.md` | 工具现场集成，触及 Phase 1 Project Workspace 但作为已有工作线 |
| `site-and-docs.md` | 官网/文档站，与本计划无交集 |

#### 0.4 — DB 新表决策

**结论：`session_events` 和 `context_fragments` 单独建表，不复用 `messages` / `tasks`**。Codex 过目确认该方向成立。

理由：
- `messages` 表面向用户阅读的对话历史，事件流是结构化运行轨迹，数据形态不同
- 单独表才能支持 append-only 语义和未来导出/查询
- DB schema 既然要动，一次到位最便宜

Codex 审查补充：
- 字段命名尽量跟 `src/lib/db.ts` 既有表保持一致，使用 `created_at TEXT NOT NULL DEFAULT (datetime('now'))`，不要混用 `ts`。
- `context_fragments.turn_id` 不能只写“message id 或 turn 编号”。Phase 4 必须定义稳定 turn 标识；在没有单独 `turns` 表前，建议使用本地生成的 `turn_id`，并同时保存 `message_id` / `event_id` 便于 UI 和调试关联。
- `context_fragments` 应能关联触发它的事件：增加 `event_id INTEGER`，指向 `session_events(id)`，允许为空，避免先后落库 race。
- JSON 字段默认值使用 `'{}'`，文本字段默认 `''`，避免前端每次处理 `NULL`。
- `payload_text` 只保存限长、脱敏后的展示文本；完整上下文正文默认不落库。
- 后续如果要导出 session，必须默认排除 `sensitive=1` 或 `redacted=0` 的正文内容，除非用户显式选择包含敏感数据。

**草案 schema（详细字段在 Phase 4 落盘前可调整）**：

```sql
CREATE TABLE session_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  type TEXT NOT NULL,            -- 见 Phase 4 §4 第一版事件类型清单
  turn_id TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL,    -- 结构化 payload，脱敏后的
  sensitive INTEGER DEFAULT 0,   -- 是否含敏感信息（决定导出策略）
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);
CREATE INDEX idx_session_events_session_created ON session_events(session_id, created_at);
CREATE INDEX idx_session_events_session_type ON session_events(session_id, type);

CREATE TABLE context_fragments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event_id INTEGER,              -- 触发该 fragment ledger 的 session_events.id，可空
  turn_id TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  fragment_type TEXT NOT NULL,   -- 见 Phase 4 §5 fragment 类型清单
  source_type TEXT NOT NULL DEFAULT '',
  source_ref TEXT NOT NULL DEFAULT '', -- file path / mcp tool / memory key 等
  token_estimate INTEGER NOT NULL DEFAULT 0,
  payload_metadata_json TEXT NOT NULL DEFAULT '{}',
  payload_text TEXT NOT NULL DEFAULT '', -- 可展示正文（限长 + 脱敏，可空）
  redacted INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES session_events(id) ON DELETE SET NULL
);
CREATE INDEX idx_context_fragments_session_turn ON context_fragments(session_id, turn_id);
CREATE INDEX idx_context_fragments_event ON context_fragments(event_id);
```

迁移要求：遵循 `feedback_db_migration_safety` — 只新增表，不删除 / 不修改既有字段。

#### 0.5 — Luma Style 来源（已确认）

**事实**（2026-04-25 在 `shadcn-ui/ui` 源码 repo 中核实）：

- Luma 是 shadcn v4 的 **官方 Style**，2026-03-31 发布
- changelog 描述："Rounded geometry. Soft elevation. Breathable layouts. Inspired by macOS Tahoe, minus the glass."
- 与 default / new-york 同级，是基础视觉语言，不只是颜色 preset
- 两个变体：`base-luma`（用 Base UI）、`radix-luma`（用 Radix UI）。CodePilot 现在用 Radix（见 ARCHITECTURE.md），所以选 **`radix-luma`**
- 源码路径：`apps/v4/public/r/styles/radix-luma/*.json`
- 安装入口：`pnpm dlx shadcn add https://ui.shadcn.com/r/styles/radix-luma`

**Phase 1.1 选择保守路径**（按用户 2026-04-25 指示）：

只改 `globals.css` token + `tailwind.config.ts`（如有）+ `src/components/ui/*` 的 token 引用，**不**用 shadcn CLI 整批重装 ui/*。代价是无法拿到 Luma 全部的几何细节（部分 rounded/spacing 是写在每个 component JSON 里的硬编码 Tailwind 类），收益是不破坏现有 ui/* 的本地修改。

实际操作时再判断：如果有 ui/* 的具体修改太碎,无法手工对齐 Luma token,可以择优单组件用 `pnpm dlx shadcn add https://ui.shadcn.com/r/styles/radix-luma/<component>.json` 增量替换并合并本地修改。

#### 验收

- 本计划是本轮唯一执行入口（其他 active plans 按 0.3 表归类）
- `session_events` / `context_fragments` schema 草案确认，迁移代码草稿就绪
- Luma 资源到位，Phase 1 可启动
- 旧调研文档（`harness-and-ux-refactor.md`）只保留事实速览部分

### Phase 1：UI 基线、Provider 样板页、设计原则沉淀

#### 任务

| # | 任务 | 产出 | 阻塞 |
|---|------|------|------|
| 1.1 | shadcn Style 切到 Luma | `src/app/globals.css` token 替换 + `tailwind.config.ts`（如有）调整 + `src/components/ui/*` token 引用对齐 | Phase 0.5 Luma 资源 |
| 1.2 | 核心 UI 破损和不协调处修复 | 6 个核心页面的明显错位、颜色不协调、文字溢出、按钮层级问题修复 | 1.1 完成 |
| 1.3 | Provider Trust 样板页重构 | 服务商列表 / 详情 / 添加流程的真实 UI 样板 | 1.1 完成；业务链路细节与 Phase 2 对齐 |
| 1.4 | 用户 + Claude Code 视觉调试 | Provider 样板页多轮截图、反馈、调整记录 | 1.3 完成 |
| 1.5 | 沉淀 `docs/design.md` 最小可执行版 | 从 Provider 样板页提炼出的设计原则和 token 使用规则 | 1.4 完成 |
| 1.6 | 四区域信息架构推广规则 | 写入 `docs/design.md` 的 Setup Center / Project Workspace / Assistant Home / Run Cockpit 规则 | 1.5 完成 |

#### 1.1 — shadcn Style 切到 Luma

**只动这些文件**（防止扩范围）：
- `src/app/globals.css`：替换 OKLCH token / radius / spacing token
- `tailwind.config.ts`（若存在）：颜色映射对齐
- `src/components/ui/*`：组件 token 引用对齐（不重写组件结构，只替换 token）

**不动这些**（明确不做）：
- 不重写任何 `src/components/{chat,layout,plugins,bridge,skills,project,gallery}` 的页面级组件结构
- 不动 `WidgetRenderer` 的 CSS 变量桥接（已在 `widget-css-bridge.ts` 解耦）
- 不动 `MarkdownEditor` / `SandpackPreview` / `DataTableViewer` 的内部样式

**验证手段**：CDP 跑 `chrome-devtools` MCP 截图核心页面首屏，逐张目检无明显错位 / 颜色错位 / 文本溢出。

#### 1.2 — 核心 UI 破损和不协调处修复

**只修这 6 个核心页面**：
1. Settings 主页
2. Provider 添加 / 编辑流程（PresetConnectDialog + ProviderForm + ProviderManager）
3. 聊天主页（含 MessageInput + MessageList + 顶部 UnifiedTopBar）
4. 助理首屏（Dashboard）
5. 文件预览面板（PreviewPanel）
6. Setup Center / Onboarding Wizard（如果存在）

**修复边界**：
- 修明显视觉问题：错位、颜色冲突、文字溢出、按钮层级混乱、表单状态不清。
- 不在这一轮抽象设计原则。
- 不为了统一视觉重写非核心页面。

#### 1.3 — Provider Trust 样板页

Provider 是本轮最适合作为样板的核心页面，因为它同时覆盖 CodePilot 的核心价值、确定性基础设施、状态解释、错误恢复和按钮密度问题。

样板页需要验证：
- 服务商列表、详情、添加流程是否能让用户一眼理解当前默认 provider / model。
- 连接测试、模型刷新、设为默认、错误恢复这些确定性动作是否足够清楚。
- 已知限制、key 获取地址、docs/pricing/status 链接是否可见但不吵。
- 状态、说明和操作是否能压成清楚的设置页语言，而不是营销卡片。

本阶段可以调整 Provider UI 结构，但业务链路修复和 runtime/provider resolution 的深层逻辑以 Phase 2 为准，不在 Phase 1 随意扩散。

#### 1.4 — 用户 + Claude Code 视觉调试

样板页完成后，由用户实际查看并和 Claude Code 反复调整：
- 信息密度太高或太低。
- 按钮是否过多，哪些按钮属于确定性基础设施必须保留。
- 状态说明是否能让非实现者理解。
- 卡片、分组、行内动作、空状态、错误状态是否舒服。

这一阶段的产出不是文档，而是一个用户认可的真实页面。

#### 1.5 — `docs/design.md` 最小可执行版（样板沉淀）

等 Provider 样板页稳定后，再写 `docs/design.md`。**沿用 Google `design.md` spec 作为 YAML front matter 骨架**，只填 CodePilot 实际用得到的 token，不照搬 Material Design token 或 Codex/Cursor 的设计语言。

第一版**必须覆盖**：

| 段 | 内容清单 | 产出形态 |
|---|---|---|
| YAML 头 | `name` / `colors` / `typography` / `rounded` / `spacing` / `components` | 来自 Luma token + Provider 样板页验证结果 |
| Overview | CodePilot 整体气质一句话 + 核心心智三层（项目工作现场 / 长期助理 / Runtime 运行引擎） | ~150 字 |
| Colors | 语义色 token + 状态色（pending / error / warning / success）+ 背景层级 | 表格 |
| Typography | 页面标题 / 设置行 / 状态 badge / 聊天正文 / 代码与终端 | 每类给 fontFamily/fontSize/fontWeight/lineHeight |
| Layout | 设置页、项目工作区、聊天页、右侧面板 | 数值表 + 页面规则 |
| Components | Button / Input / Select / Switch / Dialog / Sheet / Tabs / StatusBanner / EmptyState / RunStatus / ProviderStatus | 每个一段说明 + 样板页引用 |
| Interaction | 确定性动作 / AI 建议 / 确认与撤销 / 错误恢复 | 每类给一行原则 + 1-2 个例子 |
| Do / Don't | 按钮密度、卡片使用、状态展示、AI 可接管场景 | 短列表 |

**明确不做**（防止扩范围）：
- 不做 Motion / Elevation 完整定义（Luma token 自带的够用，第一版不引入新动效系统）
- 不做无障碍专章（对比度由 Google CLI lint 检查，焦点/键盘可达放进各组件说明）
- 不做 Flow Maps（端到端场景描述）—— Phase 1 不需要
- 不做 Harness Visualization 章节 —— Phase 3 Run Cockpit 自然落地

**验证手段**：跑 `npx @google/design.md lint docs/design.md`，0 error 通过；跑 `export --format tailwind` 检查 token 与 globals.css 是否一致。

#### 1.6 — 四区域信息架构推广规则（CodePilot 转译，不抄 Codex/Cursor）

**Setup Center / 运行环境中心**

CodePilot 转译要点：
- 一级分组沿用 Codex 计划 §Setup Center 的 7 项（Overview / Providers / Models / Claude Code / CodePilot Runtime / Network / Permissions）
- 不做 Cursor 那种"密集设置行 + 稀疏分组"，而是按 CodePilot 多 provider 现状重排：Providers 是首屏，Overview 是次屏（Cursor 的 Overview 优先级高是因为它单 provider）
- Claude Code 与 CodePilot Runtime 平级展示（不是"高级选项"）—— 体现"双 runtime 都产品化"的核心承诺

**Project Workspace / 项目工作现场**

CodePilot 转译要点：
- 左侧：项目 / 会话列表（不引入 Codex 的"agent 列表"概念，CodePilot 一个会话就是一个 agent，不做并行多 agent）
- 中央：AI composer + message stream（沿用现有聊天主区，Phase 2 才动 Run Cockpit 顶部状态条）
- 右侧：可切换面板（文件 / 编辑器 / terminal / diff / artifact）—— 复用已有 PreviewPanel / 已有 panels 结构，不重新发明

**Assistant Home / 长期助理空间**

CodePilot 转译要点：
- 与 Project Workspace **明确独立的页面入口**（不混在主聊天页里）
- 一级结构：Memory / Tasks / Bridge / Dashboard
- Bridge 在这里只展示"通道状态 + 历史消息"，不做通道配置（配置仍在 Setup Center 或独立 Bridge 设置）—— 避免 Bridge 子系统与本计划冲突

**Run Cockpit / 运行观察层**

CodePilot 转译要点：
- 不是独立页面，是聊天页**顶部状态条 + 右侧详情面板**
- Phase 1 只定**位置和容器**，内容字段在 Phase 3 落地
- 顶部状态条永远可见，右侧详情面板默认收起、点击展开

#### 验收

- Luma 基线升级后，6 个核心页面 CDP 截图归档（一份对照前后）
- Provider Trust 样板页经用户确认，作为后续 UI 原则来源
- `docs/design.md` 在样板页稳定后通过 `npx @google/design.md lint`（0 error）
- 四区域信息架构在 `docs/design.md` §Layout 章节显式描述（不在分散文档里）
- 受影响 i18n key 中英文同步
- 跑 `npm run test` 通过

### Phase 2A：Provider Trust + Models Control（✅ 2026-04-27 阶段性完成）

> 已完成的 Provider 卡片信息架构、Add Service 五桶分组、保守自动刷新、5-state enable_source 守卫、Models 页双行 header / 批量刷新。下方任务表保留以记录追溯路径；具体实现细节见 `docs/research/provider-model-discovery.md` + `docs/handover/`（待补 handover）。

**已落地的数据契约**：
- `provider_models.enable_source`（`recommended` / `manual_enabled` / `manual_hidden` / `discovered` / `catalog`），与 `source`（数据来源）正交
- `applyDiscoveryDiff(providerId, upstreamModels, isRecommended)` 三路分支（INSERT / `updatePristineStmt` / `updatePreservedStmt`），manual_* + user_edited 双重保护
- `isRecommendedModel(modelId, preset, providerCompat)` 判定（黑名单 → catalog 白名单 → Claude alias fallback for anthropic-tier）

**已落地的 UI**：
- Providers 页：三类分组（OAuth / 官方直连 / Claude Code 兼容套餐 / 第三方中转 / 图片）、卡片含 icon + 状态 + compat 标签 + 启用计数 + 上次刷新 + 接入方式 + endpoint
- Add Service 弹窗：五桶分组、对已连接服务标"已连接"
- Models 页：section header 拆双行（icon+name+counter+last-sync+actions / compat+default chip）、5-state enable_source 徽章（manual_enabled / manual_hidden / discovered 显示，recommended/catalog 静默）、Runtime filter dropdown、按推荐整理 preview-then-apply、刷新全部 (N) 批量保守 apply

**已落地的可信路径**：
- Add Service 成功 → 自动 discover + apply + toast，无需手动点刷新
- 单服务商 "刷新" 按钮：自动 apply + 软 refetch（不丢滚动位置），不开 preview 对话框
- "刷新全部 (N)"：sequential 探测 + rolling toast + 汇总（成功 / 失败 / 无更新），try/finally 保证不卡 loading

**保留的 preview-first 入口**（复杂操作）：
- "按推荐整理"（`alignEnabledWithCatalog`）：会主动启用/隐藏/删除多行，必须先 dryRun 看影响范围
- Provider 卡片 kebab → "刷新模型" → 高级 diff 对话框：保留给 orphan 复盘 / 强制重置场景

#### 任务（已完成）

#### 2026-04-25 用户产品 spec(Provider / Models / Setup Center 边界与 Provider Card 数据契约)

**核心定位**:把 CodePilot 变成用户的 AI 服务资产中心。Providers 管资产,Models 管能力映射,Setup Center 只做入门诊断。

**页面边界**:
- **Providers**(资产):用户已连接服务、账号 / Key / OAuth / Relay / Claude Code 环境、订阅 / 余额 / 额度窗口 / 登录态、诊断 / 修复 / 同步到 Claude Code、默认用途(聊天 / 图片 / 备用)
- **Models**(能力):从 Providers 派生可用模型、搜索 / 启用禁用、设置默认用途模型、标记来源(API detected / Preset / Manual);**不出现 Key 表单**
- **Setup Center**(诊断):Runtime / AI Service / 默认模型 是否可用,给入口不承载完整管理

**Providers 首页(Step 1)**:
- **默认只展示已连接 / 已检测到的服务**,不展示未添加 — 这是核心反模式修正
- 紧凑卡片网格或单列卡片,每张卡至少含:
  - 服务名 + 图标
  - 接入方式 badge:OAuth / API Key / Relay / Claude Code Env / Local
  - 状态:可用 / 需登录 / Key 缺失 / 余额低 / 模型获取失败 / 网络失败
  - 账号/订阅:邮箱 / Plan / 余额 / 额度窗口(拿不到显示"未检测",**不假装支持**)
  - 能力标签:语言模型 / 图片生成 / 长上下文 / 小模型
  - 模型数量 + 模型来源(API / Preset / Manual)
  - 默认用途:聊天默认 / 图片默认 / 备用 / 未使用
  - 操作:诊断 / 编辑 / 同步到 Claude Code / 断开
- 空状态:一句话 + Add Service 入口

**Add Service 流程(Step 2)**:独立模式,**不与已连接列表混屏**。第一步按用户语言分组 4 类:
1. 网页授权 / 订阅账号(Claude Pro/Max、ChatGPT Plus/Pro、GitHub Copilot、Gemini)
2. API Key(Anthropic、OpenAI、Google、DeepSeek、Moonshot、MiniMax)
3. 第三方中转 / 网关(OpenRouter、New API、Anthropic-compat / OpenAI-compat relay)
4. 本地模型(Ollama,先预留入口)

第二步:动态表单,按类型变化。

**服务详情(Step 4)** — 详情页或抽屉,固定数据契约:
- Identity:账号 / 邮箱 / 来源 / 凭据类型
- Subscription:Plan / 余额 / 额度窗口 / 重置时间
- Models:模型列表 / 来源 / 最后刷新时间
- Capabilities:聊天 / 图片 / 长上下文 / 小模型 / tool calling
- Runtime Compatibility:Provider 层 + Model 层分别标记 Claude Code / CodePilot Runtime 可用性
- Diagnostics:最近一次诊断 / 错误原因 / 修复动作

**Runtime Compatibility(Step 4.5)** — 这不是一个简单的"兼容 / 不兼容" badge,而是 Provider + Model 两层状态:

Provider 层分类:
- `claude_code_ready`:可通过 Claude Code SDK / Anthropic-compatible env 跑通,适合项目会话和 Claude Code 生态。
- `claude_code_experimental`:理论上 Anthropic-compatible,但 tool calling / thinking / model alias / timeout / `/v1/messages` 兼容度不稳定,需要明确标风险。
- `codepilot_only`:可由 CodePilot Runtime 管理,但不能假装是 Claude Code 原生兼容,典型包括 OpenAI-compatible、Gemini、部分 OpenRouter / Relay、本地 Ollama。
- `media_only`:图片、视频、embedding 等非聊天模型入口,不能进入 Claude Code 聊天模型选择器。
- `unknown`:自定义 base URL / 未验证网关,先显示"需测试",通过连接测试或模型刷新后再提升状态。

Model 层分类:
- `chat`:可作为聊天 / coding model 候选。
- `tool_capable`:可用于工具调用;未知时不能默认宣称支持。
- `thinking_capable`:可用于 thinking / reasoning;未知时显示"未验证"。
- `claude_code_compatible`:当前 runtime 为 Claude Code 时可出现在模型选择器。
- `codepilot_runtime_compatible`:当前 runtime 为 CodePilot 时可出现在模型选择器。
- `media`:媒体模型,只进入对应媒体功能,不进入聊天模型选择器。

UI 规则:
- Provider Card 显示 Provider 层 runtime 标签,例如"Claude Code 可用" / "Claude Code 实验" / "仅 CodePilot Runtime" / "仅媒体" / "需验证"。
- Models 页提供 runtime 过滤:全部 / Claude Code 可用 / CodePilot Runtime 可用 / 媒体 / 需验证。
- 当前会话使用 Claude Code Runtime 时,聊天模型选择器只展示 `claude_code_compatible` 且 enabled 的模型;不兼容模型只能置灰并解释"需要 CodePilot Runtime"。
- 当前会话使用 CodePilot Runtime 时,可以展示 `codepilot_runtime_compatible` 模型,但仍要排除 `media` 和 hidden 模型。
- 隐藏模型必须压过 role default / env default / catalog fallback;不能因为"默认模型"或"角色模型"身份被静默加回。

数据来源:
- 第一版用 preset / catalog 声明式标注,不要靠 UI 推断。
- 连接测试与模型刷新只能补充 `verified_at` / `last_error` / `compatibility_source`,不能把未验证服务商自动宣传成 Claude Code ready。
- 对拿不到能力信息的模型,默认标"未知 / 需验证",而不是乐观显示 tool/thinking。

**模型获取策略(Step 5)** — 统一来源标记:
- `api_detected`:API 直接返回模型列表(优先)
- `preset`:API 拿不到,用内置 catalog
- `manual`:用户手动编辑或选择

刷新策略:**只手动**触发;失败**不能**重置已选默认模型;已选模型不存在时显示 stale 状态 + 修复入口。Models 页消费 Providers 结果,**不直接管理 Key**。

**Claude Code 同步(Step 6)** — CodePilot 差异化能力,但必须安全:
- Provider Card 同步状态:未同步 / 已同步 / Claude Code 当前使用中 / 配置冲突 / 需要新会话生效 / 不支持同步
- 显式动作:Use in CodePilot only / Sync to Claude Code / Set as Claude Code default / Restore Claude Code config
- 写 Claude Code 前必须:展示影响范围 / 备份原配置 / 只写 provider 相关字段 / 保留用户其他配置 / 写后跑诊断 / 支持恢复
- **不静默改 Claude Code**

**实施顺序**:
1. ✅ 进行中(本轮):Providers 首页只展示已连接,改卡片
2. 📋 Add Provider 拆成独立 Add Service 模式
3. 📋 Provider Card 增加状态 / 接入方式 / 能力 / 默认用途 / 模型来源
4. 📋 服务详情抽屉或详情页
5. 📋 Models 页面改为从 Providers 派生
6. 📋 Claude Code 同步状态和显式动作
7. 📋 Provider / Model runtime compatibility matrix
8. 📋 收敛 Setup Center,只保留诊断和入口

**验收**:
- 默认页不混入未添加服务
- 用户一眼看懂当前有哪些服务可用
- 媒体模型不再和语言模型添加入口混乱堆叠
- Models 不出现 Key 表单
- Models 页能区分 Claude Code 可用、Claude Code 实验、仅 CodePilot Runtime、仅媒体、需验证
- Claude Code Runtime 下的模型选择器不会出现仅 CodePilot / 媒体 / hidden 模型
- Claude Code 同步可解释、可恢复
- 390px 窄屏无横向溢出
- UI 改动用 CDP / Playwright 截图验证



#### 任务

| # | 任务 | 触及代码 / 文件 |
|---|------|---|
| 2.1 | Provider Trust 信息架构落地 | `src/components/settings/ProviderManager.tsx` + `ProviderForm.tsx` + `PresetConnectDialog.tsx` + `ProviderOptionsSection.tsx` + `provider-presets.tsx` 重组合 |
| 2.2 | Runtime state model 定义 + 展示 | `src/lib/runtime/types.ts` 增 state 字段；`src/components/settings/CliSettingsSection.tsx` + 新 `RuntimePanel` |
| 2.3 | Claude Code 状态面板 | 复用 `provider-doctor.ts` + `claude-settings.ts` 的产物；新组件 `ClaudeCodeStatusPanel` |
| 2.4 | CodePilot Runtime 状态面板 | 新组件 `CodePilotRuntimePanel`；展示 capability + provider support + tool support |
| 2.5 | Gate 统一：删除 SDK 路径 keyword gating | `src/lib/claude-client.ts:723-797` + `src/lib/builtin-tools/index.ts:71-148` |
| 2.6 | 模型刷新（手动）+ 默认模型稳定性 | `useProviderModels` + `getDefaultProviderId`；依赖 `electron-port-stability` 已修产物 |
| 2.7 | 未修 P1 稳定性修复 | B-008 / B-019 / Sentry 8T |
| 2.8 | 连接测试与聊天 resolution 路径统一 | 收 B-013 残留：`/api/providers/test/route.ts` + `claude-client.ts` 的 provider resolution 入口对齐 |
| 2.9 | Session-level runtime 解释 | Run Cockpit 顶部状态条接 runtime selection 原因（数据源在本 Phase 准备，UI 落地在 Phase 3） |
| 2.10 | Provider / Model runtime compatibility matrix | `provider-catalog.ts` + `provider_models.capabilities_json` + `/api/providers/models` + `provider-resolver.ts` + `ModelsSection.tsx` |

#### 2.1 — Provider Trust 信息架构

**问题陈述**：当前 Provider UI 散在 6 个组件文件，添加流程跨多个对话框 + 表单切换，B-013 的连接测试 mask key bug 暴露的是状态机分散。

**重组方案**（CodePilot 转译，不抄 Cursor 设置）：

将 Setup Center → Providers 重组为 **三层结构**：

| 层 | 内容 | 现有代码映射 |
|---|---|---|
| 列表层 | 已配置 provider 列表 + 全局默认 + Add Provider 入口 | `ProviderManager.tsx` 主体 |
| 详情层 | 单个 provider 的 base URL / api key / 模型槽位 / 已知限制 / 测试动作 / 恢复动作 | `ProviderForm.tsx` + `ProviderOptionsSection.tsx` 合并 |
| 添加层 | 从预设挑选 → 一步表单（不再分 PresetConnect + Form 两步） | `PresetConnectDialog.tsx` + `ProviderForm.tsx` 合并为单组件 |

**单 provider 详情页必须显示**（数据契约）：
- 当前是否为默认 provider / 默认模型属于哪个 provider
- 连接测试结果（最后一次时间 + 状态 + 错误码 + 恢复建议）
- 模型槽位（default / reasoning / small / haiku / sonnet / opus）+ 每个槽位实际填的模型 ID + 模型来源（用户填 / 预设默认 / 模型刷新拉到）
- 已知限制 badges（thinking 是否支持 / tool_search / sdkProxyOnly / 计费方式）
- key 获取地址 / docs / pricing / status 链接（如预设有）

**B-013 修复**（连接测试与聊天 resolution 路径不一致）：
- `/api/providers/test/route.ts` 必须复用 `provider-resolver.ts` 的 `resolveProvider()` —— 不再走独立的 `toClaudeCodeEnv()` 旧路径
- 测试请求和真实聊天请求**走同一条 resolution + auth header 构造链**，差别仅在最终 endpoint 是 ping 还是 chat completion
- 验收：v0.48-post-release-issues §5.5 的 mask-key 循环不复发；同一 provider 测试通过即真实聊天可用（反之亦然）

#### 2.2 — Runtime State Model

**state 定义**（沿用 Codex 计划 §"Runtime Trust"五状态）：

| state | 含义 | 触发条件 |
|---|---|---|
| `available` | 可用但当前未选 | runtime 二进制就绪 / 凭据具备 / 用户未禁用 |
| `selected` | 当前会话或全局默认正在使用 | resolveRuntime 命中 |
| `degraded` | 可用但有已知风险 | 例：Claude Code CLI 版本与 SDK 不匹配（B-007 / #457） |
| `blocked` | 不可用 | 二进制缺失 / 凭据缺失 / 强制 fallback |
| `disabled` | 用户主动关闭 | `cli_enabled = false` 等 |

**state 来源**：每个 runtime 实现 `getState(): RuntimeState` 方法（扩展现有 `isAvailable()` boolean 为五态）。

**state→展示规则**：每条状态必有"原因 + 影响 + 恢复动作"三件套；不展示原因的状态不上线。

**Runtime 选择原因落库**：每次 `resolveRuntime()` 命中时写一条 `session_events` 事件（`type='runtime.selected'`，`payload={runtime, reason, blockedAlternatives}`），数据驱动 Phase 3 顶部状态条。

#### 2.3 — Claude Code 状态面板

**显示字段**（来自现有 `claude-settings.ts` + `provider-doctor.ts` 已有产物，组装到新面板）：
- CLI 安装状态（路径 / 版本 / 是否在 PATH）
- 登录状态（OAuth token 有效性 / 过期时间）
- `~/.claude/settings.json` 来源（CodePilot 自管理 / cc-switch / 用户手写）+ 当前生效的 env / mcpServers / hooks
- 当前会话是否使用 Claude Code Runtime（如是，列出影响范围）

**面板不做的事**（防扩范围）：
- 不在面板内编辑 `~/.claude/settings.json` —— 只读显示，编辑用系统编辑器
- 不内置 Claude Code 升级 / 降级动作 —— 提示用户 brew / npm 升级即可（链接到 docs）

#### 2.4 — CodePilot Runtime 状态面板

**显示字段**：
- 当前 CodePilot Runtime 版本（即 `@ai-sdk/*` 包版本聚合）
- 支持的 provider 协议清单（Anthropic / OpenAI Responses / OpenRouter / Google / 自定义 OAI 兼容 / sdkProxyOnly 黑/白名单）
- 工具能力（builtin tools 数 / MCP tools 数 / 当前会话激活的 keyword-gated tools —— 见 2.5 后改为"全量注册"则简化为"已注册数"）
- 权限模式（explore / normal / trust / 当前生效）
- Context 管理能力（pruning 窗口 / 压缩阈值 / 当前 context 用量百分比）

**与 Claude Code 状态面板的关系**：两者在 Setup Center 里**平级展示**（不是"高级选项"），体现"双 runtime 都产品化"。

#### 2.5 — Gate 统一（SDK 路径删除 keyword gating）

**现状事实**（已挖出，详见 `harness-and-ux-refactor.md` §交互 3 点 + 本 Phase 2.4）：

- SDK Runtime（`claude-client.ts:723-797`）：Widget / Dashboard / Media / CLI tools MCP 是 keyword-gated，对话 prompt 命中关键词才注册
- Native Runtime（`builtin-tools/index.ts:71-148` + `decouple-native-runtime.md:92`）：29 个工具全量注册，**不做** keyword gating
- 后果：同一会话切 runtime 行为不一致，违背 Phase 2 验收"用户能明确知道当前会话为什么走 X runtime 及其影响"

**改动**：
- `src/lib/claude-client.ts:723-797` 删除 keyword gating 分支，所有 Widget / Dashboard / Media / CLI tools MCP 改为全量注册
- `src/lib/builtin-tools/index.ts:71-148` 移除 `keyword: ...` 相关条件，统一注册条件为 `condition: 'always'` 或 entrypoint 级别（desktop / bridge）
- `src/lib/context-assembler.ts:24,28` 注释中的 widget keyword detection 描述移除
- 单测：删除或改写 `context-assembler.test.ts:92` 相关 case

**风险**：理论上每轮上下文中 system prompt + tool description 体积上升。验证：实测 4 个 keyword-gated MCP 全量注册后 system prompt 增加 token 数（预估 < 2K，在 context-pruner / context-compressor 兜底范围内）。如超出预算，回退方案是把不常用的（如 Media MCP）改回 entrypoint-level gating（仅 desktop 注册），不恢复 keyword gating。

#### 2.6 — 模型刷新（手动）+ 默认模型稳定性

**模型刷新**：单 provider 详情页加 "刷新模型" 按钮，调用该 provider 的 `/v1/models` 端点（如可用）拉取最新清单 → 写入用户选择槽位的候选下拉。**不做自动定时拉取**（属于 Codex §"明确不做" 之外的扩范围风险）。

**默认模型稳定性**：依赖 `electron-port-stability.md` 已修产物（v0.50.2 待发版），本 Phase 不再重复修复，只在 Provider Trust 详情页显示"默认模型当前归属哪个 provider + 上次修改时间"，并在 Run Cockpit 状态条显示"本会话用 X 模型（来源：默认 / 用户切换 / session 持久化）"。

#### 2.10 — Provider / Model Runtime Compatibility Matrix

**目标**：让用户清楚知道"这个服务 / 模型能不能用于 Claude Code",以及"不行时该走 CodePilot Runtime 还是媒体功能"。

**数据结构建议**：
- 在 preset / catalog 层增加 provider-level runtime compatibility 声明,至少覆盖 `claude_code_ready` / `claude_code_experimental` / `codepilot_only` / `media_only` / `unknown`。
- 在 model 层通过 `capabilities_json` 或 catalog metadata 表达 model-level capability,至少覆盖 `chat` / `tool_capable` / `thinking_capable` / `claude_code_compatible` / `codepilot_runtime_compatible` / `media`。
- `provider_models.enabled=0` 是用户隐藏意图,优先级高于 catalog、role default、env default、SDK default。
- `source` 继续表达来源(`api` / `catalog` / `manual` / `role_mapping` / `sdk_default`),不要和 runtime compatibility 混用。

**Resolver 规则**：
- `/api/providers/models` 只返回当前模型选择器应该看到的模型;如果调用方传入 runtime context,必须按 runtime compatibility 过滤。
- `provider-resolver.ts` 选择默认模型时,必须跳过 hidden 和当前 runtime 不兼容模型。
- role default / env default 如果指向 hidden 或 runtime 不兼容模型,不能静默使用;应返回可解释的 degraded / needs-selection 状态,或 fallback 到第一个 enabled + compatible 模型。

**UI 规则**：
- Provider Card 展示 provider-level 标签,例如"Claude Code 可用"、"Claude Code 实验"、"仅 CodePilot Runtime"、"仅媒体"、"需验证"。
- Models 页展示 model-level 标签,并提供 runtime filter。
- Add Service 流程里,网页授权 / API Key / Relay / Local 四类入口要提前告诉用户该路径能不能同步到 Claude Code。
- Chat 模型选择器不得出现媒体模型、hidden 模型、当前 runtime 不兼容模型。

**验收**：
- 关闭一个 catalog 模型后,它不会被 role default / env default / catalog fallback 加回模型选择器或运行时解析。
- 选择 Claude Code Runtime 时,OpenAI-compatible / Gemini / media-only 模型不会混进 Claude Code 模型选择器。
- 选择 CodePilot Runtime 时,Claude Code 实验兼容模型可以出现,但必须保留风险说明。
- 自定义 provider 默认显示"需验证",测试通过前不显示为 Claude Code ready。

#### 2.7 — 未修 P1 稳定性修复

| Bug | 来源 | 修复方向 |
|---|---|---|
| B-008 Controller already closed（30x Sentry） | `agent-loop.ts` 的 keep_alive timer / onStepFinish callback | 在 `controller.enqueue` 外加 try-catch + closed 状态检查（`safe-stream.ts` 已有 wrapper，需扩展覆盖剩余路径） |
| B-019 SDK runtime 慢首包 330s timeout（#499） | `stream-session-manager.ts:88` 硬编码 + `claude-client.ts:1451-1452` SDK 路径无 keepalive 兜底 | SDK runtime 的 SSE pipe 加 15s keepalive 定时器，对齐 Native runtime 的兜底节奏 |
| Sentry 8T `AI_MissingToolResultsError: toolu_*`（5x） | agent-loop tool_use/tool_result 配对逻辑（Anthropic 原生格式新场景） | 排查 + 修补 `agent-loop.ts:430-478` 的 tool result 配对路径 |

不修这些（明确不做）：
- B-009 短别名解析 145x（部分是用户配错模型，本 Phase 在 Provider Trust 详情页给"模型 ID 校验提示"已经足够）
- B-010 Windows 弹终端 / B-011 中文输入法 / B-014 批量导入手点 —— 长尾 P3，不在本 Phase

#### 2.8 — 不做项

- ❌ 余额 / 用量 API 集成（Codex §"明确不做" 已列）
- ❌ 模型自动定时刷新（Phase 2 只做手动刷新）
- ❌ Provider 计费深度集成
- ❌ 多 OAuth 账号支持（#458 feature request）
- ❌ Codex CLI / 其他 CLI 后端支持（#234，超本 Phase）

#### 验收

**产品验收**（沿用 Codex 计划，沉淀到具体测点）：
- 新用户可以**不读 Claude Code 文档**，仅在 Setup Center → Providers 完成添加 + 测试 + 设默认（CDP 录屏全程）
- 任意当前会话 hover / 点击 Run Cockpit 状态条，3 秒内能看到"本会话用什么 runtime + 为什么"
- B-013 测试-成功循环不复发（CDP 录屏：创建 → 测试 → 保存 → 编辑 → 测试 → 仍然成功）
- B-019 在慢 provider（如百炼）上发首条消息不再 330s 失败

**工程验收**：
- 跑 `npm run test` 通过
- `controller.enqueue` 路径全量 try-catch 覆盖（B-008 验证用 Sentry 数据 7 天后无新增）
- Gate 统一后单测覆盖：4 个原 keyword-gated MCP 在 SDK + Native 两条路径都默认注册
- `session_events` 至少接入 `runtime.selected` / `provider.tested` / `provider.error` 三种类型（Phase 4 扩展剩余事件）

### Phase 2B：Runtime Trust（📋 范围已确认 2026-04-27，待动手）

#### 心智模型

把 Runtime 从 Setup 子节点抽到 Settings 顶级入口，确立三层心智：

1. **Providers**（资产）— 我拥有哪些服务 / 凭据 / 订阅
2. **Models**（暴露）— 哪些模型暴露给聊天和运行时
3. **Runtime**（运行环境）— **这次 Agent 到底由谁运行**

> Runtime 留在 Setup Center 内部会让用户继续把它理解成"安装配置项"，而不是"运行环境"。提级是这一阶段的核心设计动作。

#### 已确认决策（2026-04-27 用户拍板）

**1. Runtime → Settings 侧栏顶级入口**
- 与 Providers / Models / Claude Code / 用量统计 / 助理同级
- 替代当前 "Claude Code" 那个偏 setup 的子节点（不是删，是重组）
- Setup Center 保留为新用户入门诊断；不再承担 runtime 状态的完整解释

**2. Session-level 解释先 Settings 只读，Cockpit 再常驻化**
- Phase 2B：Settings 内一个**只读解释块**："当前默认会走哪个 Runtime / 为什么 / 会使用哪个 provider+model / 不可用时降级到什么"
- Phase 3：Run Cockpit 才把"本次运行正在用谁"做成 chat 顶部常驻状态条
- 不在 Settings 里做完整 session 控制（避免和 Cockpit 重复，也避免 Settings 长出运行时控制台）

**3. CodePilot Runtime 描述：中等粒度，三类**
- **能力**：内置工具、MCP、文件 / 终端 / 浏览器能力
- **权限**：哪些动作需要确认、哪些可自动执行
- **上下文**：CodePilot 管理的项目 / 会话 / 模型选择 / 本地状态

> 用户关心的是"它能替我做什么、会不会乱动、为什么和 Claude Code 不一样"。三类正好答这三件事。不要写成技术文档（builtin tools 列表 + 版本号 + AI SDK 依赖），也不要太抽象（"开放架构 / 可扩展"）。

**4. `session_events.runtime.selected` Phase 2B 就落库**
- Runtime Trust 的核心**不是一个面板**，而是**可解释轨迹**
- Phase 3 Cockpit 要消费它；Phase 4 memory/context 也会用
- 现在落最小事件就够，不做完整事件系统：
  - `selected_runtime`（claude_code | codepilot_runtime）
  - `reason`（why this runtime, e.g. user-chosen / runtime-setting / fallback-from-X）
  - `provider_id` + `model_id`
  - `fallback_from` + `degraded_reason`（如果是降级路径）
  - `session_id` + `timestamp`
- 即使 Phase 2B 面板上只读消费，落库也要做——埋点先于面板，否则 2B 做完还是"当前状态 UI"，不是"可追踪运行决策"

#### Phase 2B 与 Phase 2A 的边界

- 2A 是用户对**资产**的掌控（哪些 provider 配了、哪些模型暴露给 picker）
- 2B 是用户对**运行环境**的掌控（这次会话靠谁跑、为什么、能不能跑得起来）
- 共用数据源：`provider-resolver.ts` 的 resolve 逻辑、`runtime-compat.ts` 的兼容矩阵
- 共用产物：Provider 卡片的 compat 标签 / Models 页的 runtime filter dropdown 已经预埋了 2B 需要的 RuntimeCompat 类型；2B 把它升级成"为什么 + 影响 + 恢复" UI

#### Phase 2B 与 Phase 3 (Run Cockpit) 的边界

- **2B 落 Settings 内**——Runtime 顶级入口、CliSettingsSection 重组、新建 RuntimePanel；用户**主动去看** runtime 状态的场景
- **3 落 chat surface**——顶部状态条 + 抽屉；用户**在跑会话时被动看到**状态的场景
- 数据契约一致：2B 定义的 RuntimeState (`available` / `selected` / `degraded` / `blocked` / `disabled`) 和 `reason / impact / recovery` 三件套，让 Phase 3 直接消费，不重新定义

#### 任务草稿（待动手前再细化）

| # | 任务 | 触及 |
|---|------|------|
| 2B.1 | Settings 侧栏加 Runtime 顶级入口；CliSettingsSection 内容拆到新 RuntimePanel | `SettingsLayout.tsx` + `SettingsSidebar.tsx` + 新 `RuntimePanel.tsx` |
| 2B.2 | Runtime state model：扩展 `isAvailable()` 为 `getState(): RuntimeState` 五态，每态附 reason / impact / recovery | `src/lib/runtime/types.ts` + 各 runtime 实现 |
| 2B.3 | Claude Code Runtime 状态卡：CLI 安装 / 登录态 / settings.json 来源 / 当前会话是否选用 + reason / impact / recovery | 复用 `provider-doctor.ts` + `claude-settings.ts` 产物 |
| 2B.4 | CodePilot Runtime 状态卡：能力 / 权限 / 上下文三类（中等粒度） | 新组件，描述静态，capability 探测复用现有 |
| 2B.5 | Session-level 只读解释块：当前默认 runtime + reason + 会用 provider/model + 降级路径 | `RuntimePanel` 内一个 sub-card，数据源接 `provider-resolver.ts` |
| 2B.6 | ⏸️ **deferred** — `session_events` 表 + `runtime.selected` 事件最小写入 | 新 schema + `provider-resolver.ts` 在 resolve 完成时埋点 |
| 2B.7 | Setup Center 收敛：移除 runtime 完整解释，保留入门诊断 + 跳到 Settings → Runtime 的链接 | `SetupCenter.tsx` |

> 原 Phase 2.2 / 2.3 / 2.4 的设计稿（在 Phase 2A 块下方 §"Phase 2.2 Runtime State Model" 等）写于 2026-04-25。其中 RuntimeState 五态、Claude Code 状态字段、CodePilot Runtime 状态字段大体可复用，但要按上面拍板的"中等粒度三类描述" + "Settings 顶级入口 + 只读 session 解释" 重新校准；动手前再扫一遍那段，把和本轮决策冲突的部分覆盖掉。

#### 验收（草稿）

- 用户在 Settings 侧栏看到 Runtime 顶级入口，里面 Claude Code Runtime / CodePilot Runtime 卡片平级
- 每个 Runtime 卡片明确告诉用户：现在状态、为什么是这个状态、影响是什么、怎么恢复
- 任意会话进入 Settings → Runtime 能看到一个只读解释块，告诉"本次默认会走 X，因为 Y，会用 provider Z + model W；如果 X 不可用降级到 V"
- ⏸️ ~~`session_events` 表里查询某 session_id 能看到 runtime.selected 事件，字段齐~~ — **deferred**：见下方 2B.6 注记
- 测试 + CDP 跟 2A 同标准

> **2B.6 deferred 原因**（2026-04-27）：埋点是 DB schema 工作（新建表 + ALTER + provider-resolver 埋点 hook），与本阶段的 UX 整改 commit 风险面不同。先把 Settings → Runtime 的 read-only 体验跑稳，下一个独立 commit 再落埋点：
>   - 当前 RuntimePanel 的 session-level 解释块在不依赖 `session_events` 的前提下，已能从 `/api/providers/models?runtime=auto` + `runtime_applied` + 全局默认派生出"新会话会用谁"的客观结果，对用户来说先够用
>   - Phase 3 Run Cockpit 在 chat 顶部展示"本次会话用谁 + 为什么"才是 `runtime.selected` 真正的下游消费方，做埋点和 Cockpit 同期会更明确事件 schema 的契约
>   - 计划 §决策日志 2026-04-27 那条"Phase 2B 就最小落库"暂时先看作目标，本阶段的 commit 范围把它移到 Phase 2B 收尾或 Phase 3 起手；如果 Phase 3 推进时仍未落地，重新提为 P0

#### 不做（边界守卫）

- ❌ 在 Settings 内做 session 级 runtime 切换控制（那是 Run Cockpit 在 chat 顶部的事）
- ❌ 完整 session_events 事件系统（只埋 runtime.selected 一种；其它事件类型 Phase 4 扩展）
- ❌ Runtime panel 编辑 `~/.claude/settings.json`（只读显示，编辑用系统编辑器）
- ❌ Claude Code 升级 / 降级动作（提示用户 brew / npm 升级即可，链接到 docs）
- ❌ runtime fallback 自动决策权下放（fallback 由 resolver 决定，UI 只解释）

### Phase 3：Run Cockpit 第一版

任务：
- 建立轻量顶部状态条。
- 建立可展开详情面板。
- 建立 session-level Runtime 选择器：新会话默认继承 Settings → Runtime 的全局默认，但会话创建后持久化自己的 runtime。
- Runtime 选择器按 adapter registry 思路设计，不把 UI / 类型 / 数据结构写死为 Claude Code + CodePilot 两项；第一版可只渲染这两个内置 adapter。
- 支持会话过程中切换 Agent 引擎：切换只影响下一轮消息；当前正在生成时禁用切换或引导用户先停止当前回复。
- Runtime 切换后重新解析 provider/model：若当前 provider/model 与目标 runtime 不兼容，自动切到兼容组合，并在 UI 中说明原因和影响。
- 记录最小事件：`runtime.selected`（会话创建 / 首次解析）和 `runtime.changed`（用户切换），payload 至少包含 from / to / reason / provider / model / fallback。
- 接入 provider/model/runtime/tool/permission/context/memory/error 状态。

验收：
- 用户能一眼看出当前会话运行状态。
- 用户能在会话开始前选择 Agent 引擎，并在会话过程中切换到另一个引擎；切换语义明确为“下一轮消息生效”。
- 切换后 picker 与实际发送路径使用同一组 runtime-filtered provider/model；不会出现 UI 选了 A、wire 发到 B 的错位。
- 不兼容切换有明确解释，例如“当前模型不支持 Claude Code Runtime，已切到第一个兼容模型”。
- 工具、权限、上下文、记忆事件可展开查看。
- 按钮克制，不干扰聊天。

### Phase 4：Session / Context / Memory 基础设施

任务：
- 设计并实现 `session_events`。
- 设计并实现 `context_fragments` 或同等 ledger。
- 设计 Local Agent Adapter Registry 草案：adapter id / display name / detect command / launch command / capability flags / limitations / ownership boundary。
- 为 Chat 的显式 `@agent` 调度预留 adapter contract：`invoke` 输入（cwd / prompt / files / session context）、输出（summary / artifacts / logs / status）、权限边界、取消 / 重试语义、以及结果如何写入 `session_events`。
- 接入 context assembler、runtime registry、provider test、tool/permission flow、memory retrieval。
- 写 guardrails docs 并更新 `AGENTS.md` / `CLAUDE.md` 索引。

验收：
- Run Cockpit 由结构化事件驱动。
- context fragments 可用于调试和 UI 展示。
- 本地 Agent adapter 有最小契约文档：候选 adapter 可以只声明 detect / launch / observe，不要求一开始支持所有工具、权限、模型和上下文 UI。
- `@agent` 协作被定义为显式调用契约，而不是自动多 Agent 编排；外部 Agent 的结果必须能被 Run Cockpit / Health / logs 解释。
- guardrails 能指导后续开发。

### Phase 5：长期 Agent 最小闭环

任务：
- 从通知/定时任务中选一个最小闭环。
- 试做一个最小 `@agent` 协作闭环：主 Agent 在 Chat 中接收显式 `@codex` / `@claude-code` / `@openclaw` 调用，拉起对应 adapter 执行一个有边界的子任务，并把结构化结果回写到主会话。
- 绑定 session/project。
- 事件进入 `session_events`。
- UI 只做必要入口和恢复路径。

验收：
- 用户可以让助理在任务完成或指定时间提醒。
- 用户可以在主会话里显式把一个子任务交给另一个本地 Agent；调用过程、结果、失败原因都有可追踪记录。
- 通知能跳回上下文。
- 不引入新的稳定性风险。

### Phase 6：测试和发布准备

任务：
- `npm run test`。
- 涉及 UI 时启动 dev server，用 CDP 验证 `http://localhost:3000`。
- 运行 smoke 测试。
- Electron 包验证，尤其关注 macOS ARM 和 Windows 风险。
- 生成测试包给小范围朋友测试。

验收：
- 测试通过。
- 关键 UI 截图归档。
- console 无阻塞错误。
- 发现问题记录到 issue tracker，不自动发版。

## 验收标准

### 产品验收

- 新用户能理解 CodePilot 不等于 Claude Code，也能理解什么时候使用 Claude Code Runtime。
- 用户能在一屏内看见当前 provider/model/runtime 的健康状态。
- 用户能完成 provider 配置、测试、设默认、出错恢复。
- 用户能区分项目会话和长期助理。
- 用户能看到一轮 Agent 用了哪些关键 context fragments。

### 工程验收

- `npm run test` 通过。
- UI 改动按 AGENTS 要求完成 CDP 验证。
- 如涉及 DB schema，迁移安全、可重复运行、保留用户数据。
- 新增事件 payload 脱敏。
- i18n 中英文同步。

### 文档验收

- `docs/exec-plans/README.md` 索引更新。
- `design.md` 可指导 UI 实现。
- guardrails docs 可指导后续 AI/人类开发。
- `harness-and-ux-refactor.md` 与本计划不冲突。

## 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 范围再次膨胀 | 一周内无法稳定交付 | Phase 0 冻结不做项；半成品只选一个最小闭环 |
| Luma Style 切换引发大量 UI 回归 | 影响可用性 | 只深改核心页面；非关键页面 token 对齐 |
| Runtime 状态建模牵动旧逻辑 | 聊天链路回归 | 先只读状态和解释原因，再改行为 |
| Local Agent adapter 范围膨胀 | Runtime 层变成多个 Agent 的完整复刻 UI | 分层适配：先 detect / launch / observe；外部 Agent 自管的模型、工具、权限不强行 UI 化 |
| 多 Agent 协作过早自动化 | 主 Agent 误派发任务、上下文和责任归属混乱 | 第一版只支持用户显式 `@agent`；自动建议必须 preview + 用户确认；所有调用写入 `session_events` |
| Session event schema 设计过重 | 阻塞 UI | 第一版只记录 Run Cockpit 需要的事件 |
| Context fragment 保存敏感内容 | 隐私风险 | 默认保存 metadata，正文限制长度并脱敏 |
| Provider 余额/用量需求被误纳入本轮 | 范围爆炸 | 本轮只做链接、状态和错误恢复，不做全 provider billing API |

## 后续问题

- `Gate` 已收束为 Phase 2.5 的 SDK 路径 keyword gating 统一问题；如出现新的 Gate 含义，另开小节，不混入本术语。
- Runtime 状态已确定同时进入 Setup Center 和 session 级展示：Setup Center 解释 runtime 健康度，Run Cockpit 解释本会话选择原因。
- Local Agent Adapter Registry 第一批除 Claude Code / CodePilot 外是否选 Codex、OpenClaw 或自定义 command，要等 Phase 3 的 session-level Runtime switcher 跑稳后再定；当前只锁适配层抽象，不承诺具体第三方能力。
- `@agent` 协作第一版采用显式调用，不做自动多 Agent 编排；等 adapter registry、session events、Run Cockpit 三者跑通后，再评估主 Agent 自动建议 / 自动派发的边界。
- Long-running Agent 最小闭环优先通知还是定时任务。
- Luma Style 是否已有完整 CSS 片段，还是需要从 shadcn preset 导出。
