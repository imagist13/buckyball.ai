> **Archive note（2026-06-05，document-system-governance）**：本计划已完成并移出 `active/`，归入 `completed/`——侧栏新建对话入口已交付、tech-debt #37 已修并经 Codex 复审。作为历史执行记录保留；当前任务入口见 [exec-plans README](../README.md)。

# 合并前收口：侧栏新建对话入口（OpenRouter 发送回归 → 暂缓 / 另记 tech-debt）

> 创建时间：2026-06-03
> 最后更新：2026-06-03
> 状态：🔧 Blocker A 已交付侧栏「写新对话」入口（commit a1c9997）；Blocker B 暂缓（用户本机复现不了）。待 Codex 审。
> 范围：当前 worktree `product-refactor-research`，不得改主目录，不得自动 merge / push。

## 用户原始反馈

用户发现两个严重问题，认为当前分支暂时不能合并：

1. **新建对话的归属区分问题**
   - 现在无法区分新对话到底创建在助理、文件还是文件夹上下文里。
   - 即便用户已经选择了文件，下次操作时系统仍会默认选择该文件或目录。
   - 用户建议：在助理右侧和文件夹右侧都增加 `+`，让用户明确选择从哪里创建对话，还是创建助理对话。

2. **对话发送故障**
   - 在助理里使用 Claude Code Runtime，并选择 OpenRouter 的 Opus 4.6 / Opus 4.7 类模型时，输入内容后按 Enter 无法发送。
   - 用户强调：以前同样的 OpenRouter + Claude Code + Opus 模型是可以正常发送的，所以不能简单解释成“OpenRouter 本来就不支持 Claude Code”。

## 需求最终态与变更轨迹（2026-06-03 收口，供 Codex 审）

> 上面「用户原始反馈」是起点；本节是收敛后的**真实范围与交付**。审阅以本节为准。
> 中途多次变更均为用户主动收窄/否决，原因见下。

### 用户最终诉求（收敛后，只有一个）

侧栏要有**清晰的「写新对话」入口**：

- **助理**（顶层、没有“文件夹”概念，所以在侧栏顶层）需要一个明确的「写新对话」入口（带笔的 compose 图标）。
- **项目文件夹**行原来的 `+` 表意不清（“加什么？”），改成同款「写新对话」铅笔图标。

用户**明确否决**“给对话打来源标记 / 在对话顶部显示归属”那一整套——认为是计划初稿（Codex 拟）带来的过度设计。原话：“我看它让你加标记，有什么乱七八糟的，我这诉求只有一个。”

### 变更轨迹 + 原因（按时间，全部由用户发起）

| # | 变更 | 原因 / 触发 |
|---|------|-------------|
| 1 | **Blocker B（OpenRouter「无法发送」）暂缓** | 用户本机**复现不了**。ClaudeCode 先做 Phase 0 采样（真实 DB + 真机 CDP + 用户提供的打包日志），结论：OpenRouter `https://openrouter.ai/api` 是 Anthropic skin，在 Claude Code 下**可发送**（CDP 真机发出第一条并收到 Opus 回复）；唯一真实缺陷是“选的 Opus 被静默换成 Sonnet”——会话存的是 canonical slug（`anthropic/claude-opus-4.7`）而 picker 按别名 `opus` 匹配，不 round-trip，**属静默替换、不是硬阻断**；硬阻断只在 `codepilot_runtime`（Anthropic skin 不兼容，属正确）。用户给的打包日志是旧 preview 包的**服务端**日志：0 条 OpenRouter，错误都是旧 codex `--listen`/`xhigh`（已在更早 preview P0 修复）。→ Phase 1/3 本轮不做。 |
| 2 | **文件树「在此新建对话」入口不做** | 用户决定：文件树保留现有“附加到输入框”即可，新建入口冗余。 |
| 3 | **来源建模 + 顶部显示归属 不做** | 用户判为过度设计（见上“最终诉求”）。真实诉求只是侧栏清晰的新建入口。已写入的来源字段暂留为**休眠基础设施**（界面不可见、不影响发送），可单独 strip。 |

### 本轮实际交付（可验证）

- **`a1c9997`（满足用户诉求的提交）**：侧栏「写新对话」入口
  - `src/components/layout/ProjectGroupHeader.tsx`：项目行 new-chat 按钮图标 `plus` → `edit`（铅笔 compose）+ tooltip。
  - `src/components/layout/ChatListPanel.tsx`：助理区头新增**常驻**铅笔 compose 按钮 → `handleCreateSessionInProject(e, aGroup.workingDirectory)`（在助理工作区新建对话）。
  - 测试 `src/__tests__/unit/sidebar-compose-new-chat.test.ts`；CDP 实测 `localhost:3001` 两入口生效；`npm run test` 3218 全过。
- **来源建模（已否决 → 决定 strip 代码路径）**：`b8b1669` + `1b00edc` 曾加
  `chat_sessions.chat_origin_type` / `chat_origin_path` 两列、`createSession` 参数、建会话 API
  透传、侧栏 POST body 的来源透传。界面无任何显示、不影响发送。**决定：strip 代码使用路径**
  （随后代码提交移除；已迁移的两个空 DB 列因禁止破坏性迁移保留为历史包袱）。已登记
  `docs/exec-plans/tech-debt-tracker.md`。

### 明确不做（+原因）

- 文件树新建入口（用户：不需要）。
- 对话顶部显示归属（用户：过度设计）。
- Blocker B OpenRouter 发送修复（用户：复现不了；证据：非硬阻断，是模型别名 round-trip）。

### 留给 Codex 审的点

1. 侧栏两个新建入口的图标/可达性是否清晰、与现有“新对话/新建项目”语义是否冲突。
2. ~~休眠的 `chat_origin_*` 字段保留还是 strip~~ → **已决定：strip 代码使用路径**（见随后代码提交；已迁移的两个空 DB 列保留为历史包袱，禁止破坏性迁移）。已登记 tech-debt。
3. **OpenRouter 静默 Opus→Sonnet 是 P1 缺陷，已登记** `docs/exec-plans/tech-debt-tracker.md`（不是“未来如果要修”）。**合并前需用户明确接受“选 Opus 可能静默发成 Sonnet”这一风险**，否则它仍是合并 blocker。若修，方向是“别名 ↔ upstream slug round-trip / 不静默替换”，**不是**放宽 runtime gate（gate 对 claude_code 是对的）。

---

> ⚠️ **以下「当前判断 / Phase 0–4 / Smoke Ledger / 决策日志」为初版计划与调研记录，勿按此审。**
> 权威口径见上方「需求最终态与变更轨迹」。要点：
> - **Blocker A 的"来源建模 / 四种入口（assistant·workspace·folder·file）/ 文件树新建 / 顶部显示归属"已被用户否决** —— 旧 Phase 2/4 正文与 Smoke Ledger 仅作历史保留，**不要按它们审来源建模**。实际只交付了侧栏「写新对话」入口。
> - **Blocker B（Phase 0–1）= OpenRouter 调研记录，结论：暂缓**。其中暴露的真实缺陷（选 Opus 可能静默发成 Sonnet）**已单独登记**到 `docs/exec-plans/tech-debt-tracker.md`，不是"未来如果要修"。

## 当前判断（初版，部分已被否决，见上方最终态）

### Blocker A：新建对话归属不是单纯 UI 问题

当前代码只有“最近工作目录”，没有“这次新建对话来自哪里”的语义。

关键代码：

- `src/app/chat/page.tsx`
  - 初始化新对话时读取 `localStorage['codepilot:last-working-directory']`。
  - 选择文件夹 / project 时继续写回同一个全局 key。
- `src/app/api/chat/sessions/route.ts`
  - 创建 session 只接收 `working_directory` / model / provider / mode 等字段。
  - 没有 `assistant | file | folder | workspace` 这类来源字段。
- `src/lib/db.ts`
  - `createSession(..., source?: 'user' | 'task')` 的 `source` 只区分普通用户会话和 task-bound hidden session。
  - 不能表达“助理会话 / 文件会话 / 文件夹会话”。
- `src/components/layout/panels/FileTreePanel.tsx`
  - 文件树 `+` 目前只 dispatch `attach-file-to-chat` / `attach-directory-to-chat`，语义是“附加到当前输入框”，不是“从这里创建新会话”。

结论（**已被用户否决，见顶部「需求最终态」**）：~~需要给“新建会话来源”建模~~ —— 用户判定为过度设计，最终只做侧栏「写新对话」入口，不建模、不显示归属。

### Blocker B：OpenRouter 问题要按回归查

Codex 初步分析曾把它归因于 OpenRouter `/api` vs `/api/v1` skin 差异，但用户指出过去 OpenRouter + Claude Code + Opus 4.6/4.7 是可用的。因此当前判断改为：

> 这更像是近期为了防止 provider/model 静默替换而加的前端 Runtime gate 过强，导致过去可工作的 OpenRouter Opus 场景被挡在发送前。

关键代码：

- `src/components/chat/ChatView.tsx`
  - `sessionProviderRuntimeIncompatible` 由 `providerWasFilteredOut` + 当前 provider/model 与 resolved provider/model 不一致触发。
  - 一旦触发，`sendMessage` / `doStartStream` 会直接 return，用户消息不会 append。
  - `MessageInput` 也会 disabled，用户表现为“按 Enter 没反应 / 第一条都发不出去”。
- `src/hooks/useProviderModels.ts`
  - 先从全量 provider catalog 派生 `compatibleProviderGroups`。
  - `providerWasFilteredOut` 只要 requested provider 与 resolved provider 不一致就置 true。
- `src/lib/runtime-compat.ts`
  - OpenRouter `https://openrouter.ai/api` 被认为是 Anthropic skin，可支持 Claude Code。
  - OpenRouter `/api/v1` 被认为是 OpenAI-compatible skin，不支持 Claude Code。
- `src/lib/provider-resolver.ts` + `src/app/api/providers/models/route.ts`
  - 已经有 OpenRouter alias canonicalization：`opus` / `sonnet` / `haiku` 可以映射到真实 upstream slug。
  - 过去可用链路可能是后端 resolver 修正了别名或 legacy row；现在前端 gate 在发送前先拦掉。

不能接受的结论：

- 不能说“OpenRouter + Claude Code 本来就不能用”。
- 不能只给用户显示“切换 Runtime”而不查为什么 OpenRouter Anthropic-skin 也被拦。
- 不能用静默改 session provider/model 的方式修复。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 复现与数据采样 | ✅ 完成 2026-06-03 | 根因重定：非 runtime gate 过强；是 session.model 存 canonical slug 与 picker alias 不 round-trip → 静默换模型 |
| Phase 1 | 修 OpenRouter Claude Code 发送回归 | ⏸ 暂缓 2026-06-03（用户复现不了） | 见下决策日志；非引擎不支持，dev 仅见“模型被静默换掉”，硬阻断只在 codepilot_runtime（正确）。本轮不做 |
| Phase 2 | 侧栏新建对话入口 | ✅ 交付 2026-06-03（a1c9997） | 侧栏「写新对话」铅笔入口（助理顶层 + 项目行）。**来源建模 / 四种入口 / 文件树新建 / 顶部显示归属 已被用户否决**（见最终态），原 Phase 2 设计正文作废 |
| Phase 3 | UI 文案与恢复动作 | ⏸ 暂缓（随 Blocker B） | 真正不兼容（codepilot_runtime）的恢复提示已存在；本轮不做 |
| Phase 4 | 测试与 smoke | ✅ 仅侧栏入口 | sidebar-compose-new-chat 单测 + CDP 实测两入口。四种来源 / 污染 smoke 随建模否决一并作废 |

## Phase 0：复现与数据采样

### 用户会看到什么

暂无 UI 改动。ClaudeCode 先确认真实根因，避免再按错误方向修。

### 不做什么

- 不先改 OpenRouter protocol 判断。
- 不先删 runtime gate。
- 不先修改用户 provider 数据。

### 实现路径

1. 在当前 worktree 启动 dev 环境，复现：
   - Runtime：Claude Code
   - Provider：OpenRouter
   - Model：Opus 4.6 / Opus 4.7 或用户实际看到的同类条目
   - 场景：新对话第一条 + 已有会话继续发送
2. 记录以下数据，不记录 API key：
   - provider `id / provider_type / protocol / base_url / name`
   - provider_models 中对应 rows：`model_id / upstream_model_id / enabled / role`
   - session row：`id / provider_id / model / working_directory / runtime_pin`
   - 前端状态：`currentProviderId/currentModel/resolvedProviderId/resolvedModel/providerWasFilteredOut/noCompatibleProvider/sessionProviderRuntimeIncompatible`
3. 如果实际是 `/api/v1`，也要记录“以前为何能发”：是旧 provider 行以前被当成 Anthropic compat，还是模型其实走了另一条 provider。

### 验收

- 能明确说出“哪一个 gate 拦住发送”。
- 能明确说出 OpenRouter provider 是 `/api` Anthropic skin 还是 `/api/v1` OpenAI skin。
- 能明确说出是新 chat 被拦、已有 session 被拦，还是两者都被拦。

## Phase 1：修 OpenRouter Claude Code 发送回归

### 用户会看到什么

Claude Code Runtime 下，OpenRouter 的 Opus 4.6 / Opus 4.7 这类过去可用模型可以重新发送；如果确实不兼容，输入框附近会明确解释原因。

### 不做什么

- 不静默把会话 provider 改成另一个 provider。
- 不把 `/api/v1` OpenAI skin 伪装成 Claude Code 可用。
- 不破坏 Codex Runtime / CodePilot Runtime 的 provider gate。

### 实现路径

按 Phase 0 的证据选择最小修法：

1. 如果 OpenRouter `/api` Anthropic skin 被误过滤：
   - 修 `runtime-compat` 或 `/api/providers/models` annotation，让 OpenRouter Anthropic-skin rows 正确包含 `claude_code`。
   - 加测试：OpenRouter `/api` + `opus` / `anthropic/claude-opus-4.7` 必须 `supportedRuntimes` 包含 `claude_code`。
2. 如果 provider/model raw value 与 normalized upstream 不一致导致 `sessionProviderRuntimeIncompatible`：
   - 不要直接用 raw `currentModel !== resolvedModel` 判定不可发送。
   - 用同一套 canonicalization 比较“是否同一个 provider + 是否可解析为同一个可发送模型”。
   - 或者让 picker/ChatView 在显示层同步当前 model 到可发送 alias，但不要自动 PATCH session。
3. 如果是已有 session 的 saved provider 被新 runtime filter 误判：
   - 允许用户在 composer 内一次显式重选同 provider 的 compatible model，并立即解除 disabled。
   - 不允许用户看起来选中了可用模型，但发送路径仍以旧 session state 禁止发送。

### 验收

- Claude Code + OpenRouter `/api` + Opus 4.7 可以发送第一条消息。
- 已有 session 中保存 OpenRouter + Opus 的会话可以恢复发送，或给出明确可操作的修复入口。
- `/api/v1` 仍不应被误标 Claude Code 可用。

> **执行进度（2026-06-03）**
> - 调研完成（3 路并行）：现状——会话只存 `working_directory` + `source(user|task)`，无来源语义；`chat_sessions` 无 JSON metadata 列。侧栏「助理」行与「项目文件夹」行**已有 `+`** 会建会话（`handleCreateSessionInProject`），只是不记来源；文件树 `+` 只「附加到当前输入框」（`attach-file-to-chat`/`attach-directory-to-chat`）；污染真实存在（`codepilot:last-working-directory` 在 9 处被无条件写）。助理是真实实体（`assistant_workspace_path` 设置）。
> - **Step 1 完成（地基/建模）**：新增 `chat_origin_type`（assistant/workspace/folder/file）+ `chat_origin_path` 两列（`safeAddColumn` 迁移，旧行默认 `''` 兼容）；`createSession` + `CreateSessionRequest` + `POST /api/chat/sessions` 串通；`ChatSession` 类型 + `ChatOriginType`。DB 集成测试 4 条（四种来源 round-trip / 旧会话空来源兼容 / 与 source、working_directory 独立 / API 透传 pin）。typecheck + 3213 单测全过。
> - Step 2a 完成（接线）：侧栏「助理」`+`→assistant、「项目」`+`→workspace、"新对话"/首条消息→workspace（按是否=助理工作区路径区分），旧入口行为不变。源码 pin + 3215 单测全过。commit `1b00edc`。
> - **2026-06-03 范围调整（用户）：文件树「在此新建对话」入口不做**（用户决定，文件树保留现有"附加到输入框"即可）。Step 2 剩余 = ① 聊天顶部显示归属 ② 修 `last-working-directory` 污染 ③ CDP smoke。
> - **2026-06-03 再次收窄（用户）：用户明确诉求只有一个——侧栏要有清晰的「写新对话」入口；"加来源标记/显示归属"那套被判为多余（"乱七八糟"）。** 落地：① 项目行的 `+` 改为「写新对话」铅笔图标（`CodePilotIcon name="edit"`，原 `plus` 表意不清）；② 助理（顶层、无文件夹）的 `助理` 区头新增同款铅笔 compose 图标 → 在助理工作区新建对话。**不做**顶部显示归属。Step 1/2a 的来源建模（`chat_origin_type/path`）暂留为休眠基础设施（不可见、无害），用户要的话可单独 strip 掉。CDP 实测确认两入口生效；3218 单测全过。

## Phase 2：修新建对话归属语义

### 用户会看到什么

用户可以明确从以下入口创建对话：

- 助理右侧 `+`：创建助理对话。
- 文件夹右侧 `+`：围绕该文件夹创建新对话。
- 文件右侧 `+`：围绕该文件创建新对话，或按产品决策附加到新对话。
- 普通新建对话：不再被上一次选中文件/文件夹污染。

### 不做什么

- 不把所有文件树 `+` 继续解释为“附加到当前输入框”。
- 不继续用 `last-working-directory` 代表所有来源。
- 不在没有来源 metadata 的情况下只改 UI。

### 实现路径

1. 定义新建来源：
   - `chat_origin_type`: `assistant | workspace | folder | file`
   - `chat_origin_path`: 可选，文件/文件夹来源时填真实 path
   - 如果不想立即加 DB schema，可先用 session metadata JSON；但合并前要有持久化来源，不要只靠 URL query。
2. 创建入口：
   - 助理列表 / 助理工作区右侧增加 `+`。
   - 文件夹 row 右侧增加“新建对话”动作，和“附加到当前输入框”区分。
   - 普通新对话入口保持 project/workspace 语义。
3. 修 localStorage：
   - `codepilot:last-working-directory` 只表示普通 workspace 默认目录。
   - 选中文件/文件夹不应无条件写这个 key。
4. session 创建 API：
   - `/api/chat/sessions` 接收来源字段。
   - DB/createSession 写入来源字段或 metadata。

### 验收

- 从助理 `+` 创建，对话归属显示为助理，不被文件树选择影响。
- 从文件夹 `+` 创建，新会话携带该文件夹上下文。
- 普通新建对话不会因为刚刚选过某文件而默认指向该文件。
- 旧会话无来源字段时保持兼容。

## Phase 3：UI 文案与恢复动作

### 用户会看到什么

如果 runtime/provider/model 不兼容，输入框附近明确说明“为什么不能发”和“怎么恢复”，而不是按 Enter 没反应。

### 不做什么

- 不只在 console 打 `sendMessage suppressed`。
- 不只在页面上方显示用户容易忽略的小提示。

### 实现路径

1. 当 `sessionProviderRuntimeIncompatible` 为 true：
   - 在 composer 上方显示阻断提示。
   - 提供动作：切换到兼容模型 / 打开模型选择器 / 切换 Runtime。
2. 当 OpenRouter skin 不匹配时：
   - 文案说明 `/api` vs `/api/v1` 差异。
   - 不显示内部实现词过多，但要能让用户修配置。
3. Model picker disabled tooltip 保留，但不能作为唯一提示。

## Phase 4：测试与 Smoke

### 单元 / 集成测试

必须新增或更新：

- OpenRouter `/api` provider：
  - `opus` / `sonnet` / `haiku` alias rows 被 normalized 到 OpenRouter upstream slug。
  - `supportedRuntimes` 包含 `claude_code`。
- OpenRouter `/api/v1` provider：
  - 不包含 `claude_code`。
  - 显示明确不可用原因。
- ChatView / useProviderModels：
  - OpenRouter Anthropic-skin + Opus 4.7 不触发错误的 hard block。
  - 真 runtime-incompatible session 仍会阻断，并显示可恢复提示。
- 新建对话归属：
  - assistant / folder / file / workspace 四种入口产生不同 origin。
  - 选中文件/文件夹不污染普通新对话默认目录。

### Smoke Ledger（真实凭据 / UI / E2E 验证记录）

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _待跑_ | claude_code | OpenRouter `/api` | Opus 4.7 | API key | 新对话第一条 | 📋 | session id / provider id / screenshot |
| _待跑_ | claude_code | OpenRouter `/api` | Opus 4.7 | API key | 已有会话继续发送 | 📋 | session id / DB row |
| _待跑_ | claude_code | OpenRouter `/api/v1` | Opus-like row | API key | 不兼容提示 | 📋 | screenshot + disabled reason |
| _待跑_ | claude_code | 任意兼容模型 | assistant/folder/file 新建入口 | existing config | 新建归属验证 | 📋 | session origin dump + screenshot |

## 决策日志

- 2026-06-03：用户指出 OpenRouter + Claude Code + Opus 4.6/4.7 过去可以发送，不能按“OpenRouter 本来不支持”关闭问题。本计划改为回归修复：优先检查前端 runtime gate 是否过强。
- 2026-06-03：新建对话归属问题确认不是单纯 UI 问题；当前系统只有 `last-working-directory`，没有“创建来源”语义，必须补来源建模。
- 2026-06-03：**Phase 0 完成（采样 + 真机复现，结论重定 Blocker B）。** 证据：
  - **数据**：OpenRouter provider `id=2395ea71…`，`provider_type=openrouter`，`protocol=openrouter`，`base_url=https://openrouter.ai/api`（**`/api` Anthropic skin**），`role_models_json={}`。`provider_models` 三行均为 catalog 别名 `opus|opus` / `sonnet|sonnet` / `haiku|haiku`（`upstream_model_id` 是裸别名）。全局 `agent_runtime=codex_runtime`，`global_default_mode=pinned`，`global_default_model=`（空）。
  - **API**：`/api/providers/models?runtime=claude_code`（及 `codex_runtime` / `auto`）下 OpenRouter group **存在**，`compat=openrouter_anthropic_skin`，`opus` 行 `upstreamModelId=anthropic/claude-opus-4.7`、`supportedRuntimes=["claude_code","codex_runtime"]`；仅 `runtime=codepilot_runtime` 下 OpenRouter 被正确排除（Anthropic skin 不能走 CodePilot Runtime）。
  - **CDP 复现**：Claude Code + OpenRouter + Opus 4.7 **新对话第一条发送成功**（收到 Opus 真实回复，103 tokens / $1.2278），无任何 guard 触发；picker 里 OpenRouter Opus 4.7 **可选且未 disabled**。
  - **真正根因**（非 runtime gate 过强）：发送后会话保存 `model=anthropic/claude-opus-4.7`（**canonical upstream slug**），但 picker 与 `useProviderModels.resolvedModel` 以行的 `value`（别名 `opus`）匹配。重开会话时 `currentModel`(slug) 匹配不到任何 `modelOptions[].value` → `resolvedModel` 静默回落到 `modelOptions[0].value`（=`sonnet`，组内第一项）。结果：composer 显示**错误模型**（Sonnet 4.6 而非 Opus 4.7），继续发送会**静默把 Opus 换成 Sonnet**（违反“不能静默改 session model”）。这正是计划 Phase 1.2 预判的“raw value 与 normalized upstream 不一致”。
  - **硬阻断**（`sessionProviderRuntimeIncompatible` → send disabled + “本会话保存的服务商在当前执行引擎下不可用…”提示）只在 `providerWasFilteredOut` 为真时触发，对 OpenRouter 仅发生在 `codepilot_runtime`（已 CDP 确认，且属正确行为），**claude_code 下不触发**。Phase 3 的恢复提示对该正确场景已存在。
  - **Phase 0 验收回答**：① 哪个 gate 拦？claude_code 下**没有硬拦**（发得出去，但模型被静默替换/显示错）；硬拦只在 codepilot_runtime（正确）。② skin？`/api` Anthropic skin。③ 新 chat 还是已有 session？新 chat 发送成功；已有 session（model 存 canonical slug 的）显示错模型 + 继续发送会静默替换。
  - **Phase 1 方向锁定 = 计划 1.2（canonicalization-aware 匹配）**：让 `resolvedModel` / `currentModelOption` 按 `value` 或 `upstreamModelId`（canonical）匹配，使存了 canonical slug 的 session.model 能 round-trip 回它的别名行；不动 runtime gate（gate 对 claude_code 是对的），不静默 PATCH session。1.1（改 skin 判断）/ 1.3（误判 saved provider）经证据**不需要**。
  - 备注：复现产生了一条测试会话 `de19e576…`（OpenRouter/Opus，真实 Opus 回复一条）留在真实 DB；属测试残留，可由用户删除。
- 2026-06-03：**用户复现不了“无法发送”，决定 Blocker B（Phase 1/3）暂缓，本轮只做 Blocker A（Phase 2 新建对话归属）。** 补充佐证——用户提供的 packaged 日志（`codepilot-main 2.log`，0.54→preview.5 服务端日志）：① 0 条 OpenRouter，且只有服务端日志，前端发送拦截本就不会出现在这里；② 63 条错误几乎都是旧包的 codex 老问题（旧 `/opt/homebrew/bin/codex` 拒绝 `--listen` 退出 14 次 + `xhigh`/`model_reasoning_effort` 503），正是先前 preview P0 已修内容（preview.5 起日志已见 `[codex] selected binary` 新逻辑生效）；③ “model/list 风暴”实为 codex `RUST_LOG=info` 单请求上百行 trace（同秒仅 2 个 request_id），非请求循环；④ 残留：ede_diagnostic stop_reason=tool_use ×2、better-sqlite3 ABI 警告 ×1、日志 199MB。均与 OpenRouter 发送无关，不在本轮范围。

## 给 ClaudeCode 的执行提醒

1. 先做 Phase 0 采样，不要凭记忆修。
2. OpenRouter 修复时，必须同时考虑旧 DB rows、preset catalog、`provider_models.upstream_model_id`、runtime compatibility annotation。
3. 不要用静默 PATCH session provider/model 作为修复手段。
4. 不要把 `/api/v1` 误开放给 Claude Code。
5. UI 入口加 `+` 前，先确认 session 能保存来源；否则只是换一种方式制造歧义。
6. 修完后必须跑 targeted tests + `npm run test`；涉及 UI 的新建入口和 composer 阻断提示需要 CDP smoke。
