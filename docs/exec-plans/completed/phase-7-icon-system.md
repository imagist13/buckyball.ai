# Phase 7：图标体系与表意校准 / Icon System

> 创建时间：2026-05-21
> 最后更新：2026-05-29（✅ Phase 0-4 全部完成并归档）
> 父计划：[`refactor-closeout.md`](refactor-closeout.md)
> 技术交接见 [`docs/handover/icon-system.md`](../../handover/icon-system.md)；产品思考见 [`docs/insights/icon-system.md`](../../insights/icon-system.md)
> 参考：[`docs/design.md`](../../design.md)、HugeIcons React docs、`@hugeicons/react` npm package、Phase 6 点阵式 Context Breakdown

## 用户会看到什么变化

- 设置页、聊天输入框、工具结果、文件树、插件 / Skills / MCP / CLI 等高频区域的图标不再“一个 Brain / Lightning / Terminal 到处用”。
- 相同概念在不同页面使用同一个图标；不同概念不再共用一个图标。
- 图标风格从现在的混合状态（Phosphor + Lucide + LobeHub + 少量直引）收敛到 CodePilot 自己的语义图标层，并以 HugeIcons 作为新的主图标库。
- 品牌图标（Anthropic / OpenAI / OpenRouter / Kimi 等）继续保留 LobeHub，不用通用线性图标伪装品牌。

## 为什么要单独立计划

现在的问题不是“图标包不够好”，而是三件事叠在一起：

1. **来源混杂**：大部分组件通过 `@/components/ui/icon` 间接使用 Phosphor；`ai-elements` 里还有 21 处直接 `@phosphor-icons/react`；`attachments` 和 `RateLimitBanner` 还有 2 处 `lucide-react`；品牌 icon 用 LobeHub。
2. **语义缺失**：项目导出的是 vendor icon name（`Brain` / `Lightning` / `Terminal`），而不是产品语义（`ModelIcon` / `RuntimeIcon` / `SkillIcon` / `CliToolIcon`）。结果一个图标被拿去表达多个概念。
3. **迁移风险高**：`src/components/ui/icon.tsx` 被 127 个 import 消费，直接机械替换会一次性影响聊天、设置、插件、文件树、Git、终端、AI Elements、Bridge 等多个面。

所以 Phase 7 不做“一口气替换所有 import”。正确路径是：先建语义图标契约，再把关键产品面切过去，最后再清理底层直引。

## 当前审计快照（2026-05-21，gap pass 后）

本地扫描范围：`src/**/*.ts(x)`。

| 项目 | Phase 7 之前 | gap pass 后（现况） |
|------|------|------|
| `CodePilotIcon` 消费者 | 0 | **89** 文件 |
| `@/components/ui/icon` 引用（含 CodePilotIcon 混合的） | 127 | 105（53 纯 wrapper + 52 已部分迁到 CodePilotIcon） |
| 直接 `@phosphor-icons/react`（业务，排除 wrapper / IconProvider / ai-elements / shadcn primitive） | 2（cross_phase_risk） | **0** |
| 直接 `lucide-react`（业务） | 2 | **0** |
| LobeHub 品牌图标（3 文件 / 19 行 import） | 3 文件 / 19 行 | 不变（按 plan 保留） |
| `@hugeicons/react` / `@hugeicons/core-free-icons` | 尚未安装 | **已安装并使用** (`@hugeicons/react@^1.1.6` + `@hugeicons/core-free-icons@^4.1.4`) |
| `semantic-icon.tsx` alias 数 | 0 | **~75**（含通用 UI + 资源 + 状态 + capability + brand-adjacent） |

剩余 53 个纯 wrapper 引用主要是**结构性图标**（CaretDown / CaretUp / CheckCircle / Warning / XCircle / SpinnerGap / X / Check / Stop / DotOutline / Circle / ArrowsIn / ArrowsClockwise / Bell / Lock / LockOpen 等）和 `IconComponent` 类型 import。这些目前没有 HugeIcons 等价或视觉差异不大，作为 wrapper compatibility 保留。

重复高频图标（需重点校准语义）：

| 图标 | 当前高频含义风险 |
|------|------------------|
| `Brain` | 模型、Assistant、Memory、Task、空状态等多处复用，语义过宽 |
| `Lightning` | Runtime、Skills、插件、快速动作等多处复用，容易混淆 |
| `Terminal` | CLI、Shell、命令、终端设置、Slash command 多处复用 |
| `File` / `Code` / `FileCode` | 文件树、代码块、Artifact、Preview 类型边界不清 |
| `CheckCircle` / `Warning` / `XCircle` | 状态语义基本成立，但各组件 tone / 尺寸 / label 不统一 |

直引 21 处的分布（Phase 3 允许清单要据此分清）：

| 类别 | 文件数 | 文件 |
|------|--------|------|
| ai-elements（接近 upstream primitive） | 13 | `message / code-block / tool-actions-group / chain-of-thought / artifact / conversation / prompt-input / terminal / task / file-tree / tool / reasoning / sources` |
| shadcn primitive（生成出，升级风险高） | 6 | `ui/command / ui/sheet / ui/select / ui/dialog / ui/spinner / ui/dropdown-menu` |
| 业务组件（Phase 7 必须迁） | 2 | `chat/TaskCheckpoint.tsx`（Phase 6 刚改过）/ `layout/IconProvider.tsx`（图标主题元层，跨页面影响） |

`chat/TaskCheckpoint.tsx` 与 `layout/IconProvider.tsx` 视为 **cross_phase_risk** 文件，Phase 2 单独验收。

## 图标来源策略

| 类别 | 目标来源 | 说明 |
|------|----------|------|
| 产品 / 功能图标 | HugeIcons | Phase 7 主迁移目标。优先用 `@hugeicons/react` + free core icons；若需要 Pro-only 图标，必须降级到 free 近义图标或记录限制，不能偷换成别的库 |
| 品牌图标 | LobeHub icons | Anthropic / OpenAI / OpenRouter / Kimi / Bedrock 等继续用品牌图标 |
| 状态图标 | HugeIcons semantic aliases | success / warning / error / loading 统一语义层；loading 可保留自有 spinner |
| 代码编辑器 / AI Elements 内部图标 | Phase 7 后半段迁移 | 这些组件接近库组件，先建立例外清单，再逐步消除 direct import |
| Lucide | 迁出 | 现有 2 处必须迁到语义层；后续不新增 |

HugeIcons 调研结论：

- 官方 React 集成推荐 `@hugeicons/react`，并通过 `HugeiconsIcon` 渲染从 core package 导入的 icon definition。
- npm 包 `@hugeicons/react` 说明 free package 需要配合 `@hugeicons/core-free-icons` 使用。
- 当前 repo 未安装 HugeIcons；Phase 7 真正实施时需要新增依赖并锁定 import 形态。

参考链接：

- HugeIcons React docs: https://hugeicons.com/docs/integrations/react
- HugeIcons React quick start: https://hugeicons.com/docs/integrations/react/quick-start
- npm `@hugeicons/react`: https://www.npmjs.com/package/%40hugeicons/react

## 状态

| Phase | 内容 | 状态 | 用户结果 |
|-------|------|------|----------|
| Phase 0 | Icon inventory + semantic taxonomy | ✅ 已完成（2026-05-21）— `docs/handover/icon-system.md` | 明确每个产品概念该用哪个图标，不再凭感觉挑 |
| Phase 1 | HugeIcons 基础封装 | ✅ 已完成（2026-05-21）— `src/components/ui/semantic-icon.tsx`（75 alias） | 新图标库接入，旧 UI 兼容层不变 |
| Phase 2 | 高频 UI 表意校准 | ✅ 主体完成（2026-05-21）— 89 文件迁到 CodePilotIcon；Brain/Lightning/Terminal 三大冲突在业务代码全部清除；剩余 53 文件只用结构性图标（CaretDown/CheckCircle/...）作 wrapper 兼容 | Settings / Chat / Plugins / Skills / MCP / CLI / FileTree / Gallery / Git / 思维链 / 工具链 / 代码块 全部 HugeIcons 视觉 |
| Phase 3 | Direct import 清理 + guardrail | ✅ 已完成（2026-05-21）— `eslint.config.mjs` 更新：lucide 重定向到 CodePilotIcon；Phosphor 直引重定向到 CodePilotIcon（warn）；`@/components/ui/icon` 显式禁用 Brain/Lightning/Terminal 三个 named import（error 级，防再次引入冲突语义） | 新代码不能用 Brain/Lightning/Terminal 绕过语义层 |
| Phase 4 | 视觉 QA + 文档收口 | ✅ 已完成（2026-05-29）— design-system "Icon Semantics" 区 + design.md "图标语义" 章节 + ui-governance §2 交接给 icon-system.md + insights/icon-system.md；本计划归档至 completed/ | 设计系统页 + 反向链接产品思考文档 |

## 先读文档

实施前必须先读：

- `docs/design.md` — Settings / cards / badges / density / hover / icon click target 规范。
- `docs/exec-plans/completed/refactor-closeout.md` — Phase 7 父计划与边界。
- `docs/guardrails/i18n.md` — 图标替换如果同步 tooltip / aria-label，必须双语同步。
- `docs/guardrails/Runtime.md` — Runtime / Provider / Model 图标语义不能破坏当前三层心智模型。
- `docs/guardrails/ComposerModelSelection.md` — Chat composer / model picker / runtime selector 是高风险入口。
- `src/components/ui/icon.tsx` — 当前图标出口。
- `src/components/settings/nav-config.ts` — Settings 主导航语义。
- `src/lib/constants/command-icons.ts` — Slash command 图标语义。

## 语义分类

Phase 7 必须先定义 CodePilot 自己的 semantic aliases，不能继续在业务代码里直接表达 vendor icon name。

建议第一批语义层：

```ts
type CodePilotIconName =
  | 'overview'
  | 'settings'
  | 'appearance'
  | 'provider'
  | 'model'
  | 'runtime'
  | 'health'
  | 'usage'
  | 'assistant'
  | 'task'
  | 'bridge'
  | 'plugin'
  | 'skill'
  | 'mcp'
  | 'cli'
  | 'terminal'
  | 'file'
  | 'folder'
  | 'code'
  | 'artifact'
  | 'preview'
  | 'memory'
  | 'widget'
  | 'image'
  | 'media'
  | 'permission'
  | 'success'
  | 'warning'
  | 'error'
  | 'loading';
```

语义规则：

- `model` 不能继续用 `Brain`。模型是 provider/model asset，不是 Assistant / Memory。
- `runtime` 不能继续用 `Lightning` 表达所有执行相关概念。Runtime 是“执行环境 / engine”，要和 Skills / quick action 区分。
- `skill` 与 `plugin` 必须分开。Skill 是模型可调用能力；Plugin 是安装包 / extension container。
- `mcp` 与 `cli` 必须分开。MCP 是协议 / server；CLI 是本地命令工具。
- `terminal` 只表达 terminal UI / shell session，不表达 CLI tools catalog。
- `memory` 与 `assistant` 必须分开。Memory 是上下文来源；Assistant 是人格 / 工作区。
- `artifact` / `preview` / `code` / `file` 必须分开。Artifact 是表现层，Preview 是查看动作，Code 是语言 / snippet，File 是资源。

## 分阶段执行

### Phase 0：Inventory + semantic taxonomy

用户能看到什么：

- 暂时没有 UI 改动，但计划里会出现一张“产品概念 → 图标语义 → 当前图标 → 目标图标”的表。
- 后续 review 不再争论“这个地方用哪个图标”，而是看语义表。

任务：

- 新增 `docs/handover/icon-system.md` 或本计划内附表，列出高频页面图标矩阵：
  - Settings nav
  - Runtime selector / Runtime panel
  - Model picker / Provider cards / Models page
  - Chat composer / Slash command / Quick actions
  - Tool result / RunCheckpoint / Permission / Rate limit
  - File tree / Preview panel / Artifact
  - Plugins / Skills / MCP / CLI tools
- 生成一次 `icon inventory` 表，每行至少包含以下列：
  1. **业务位置**：文件 + 行号 + 视觉区域（Settings nav / Chat composer / Tool result / …）。
  2. **当前图标**：vendor + icon name（如 `Phosphor:Brain`）。
  3. **当前语义负载**：该图标在此处用来表达什么概念。
  4. **目标 semantic alias**：从下方语义分类里挑一个（`model` / `runtime` / `skill` / …）。
  5. **HugeIcons free 候选**：实际去 `@hugeicons/core-free-icons` 里挑一个目标 icon name；free 包没有就在此列直接写 `fallback: keep Phosphor:<Name> aliased as <semantic>`，不能留空。
  6. **关联 i18n key**：grep 该 icon 周围的 `aria-label={t(...)}` / `<TooltipContent>{t(...)}` / `title={t(...)}`，把对应 i18n key 写下；没有就标 `none`（说明该图标无文案，仅视觉用途）。
  7. **cross_phase_risk 标签**：`TaskCheckpoint.tsx`（Phase 6 context-accounting popover）/ `IconProvider.tsx`（主题元层）/ 其他 Phase 6 / Phase 5 刚动过的文件命中即标 `Y`，否则 `N`。
- 标记三类问题：
  - `duplicate_semantics`：同一图标表达多个概念。
  - `split_semantics`：同一概念在多个页面用了不同图标。
  - `direct_import`：绕过 `@/components/ui/icon` 或 future semantic layer。

验收：

- inventory 文档能回答"为什么这个图标要换"。
- 至少覆盖 Settings / Chat / Plugins / Skills / MCP / CLI / FileTree 七个区域。
- 每个 semantic alias 在 inventory 表里至少有一个 HugeIcons free 候选或显式 fallback 注记；不允许"先开工再说"。
- 不改 UI，不新增依赖。

### Phase 1：HugeIcons 基础封装

用户能看到什么：

- UI 基本不变；这是为后续迁移铺底座。

任务：

- 安装并锁定 HugeIcons 依赖：
  - `@hugeicons/react`
  - `@hugeicons/core-free-icons`
- 新建或重构图标出口：
  - `src/components/ui/icon.tsx` 保留兼容导出，避免一次性炸 127 个 import。
  - 新增 `src/components/ui/semantic-icon.tsx` 或 `src/components/ui/icons.tsx`，暴露 `CodePilotIcon` / semantic aliases。
  - LobeHub 品牌图标继续走 `provider-presets.tsx` / Runtime brand icon，不进入 HugeIcons 迁移。
- 统一尺寸：
  - toolbar: 14
  - inline / row: 16
  - card header: 20
  - empty state / hero-lite: 24
- 统一 stroke / color：
  - 默认 `text-muted-foreground`
  - active `text-foreground`
  - status 走现有 status token，不新增彩色图标体系。

验收：

- `npm run test` 通过。
- `src/components/ui/icon.tsx` 兼容旧 import。
- 新语义层至少覆盖 Settings nav 与 Chat composer 所需图标。
- 不做大规模视觉替换。

### Phase 2：高频 UI 表意校准

用户能看到什么：

- Settings 左侧导航和 Runtime / Models / Providers 三层更容易区分。
- Chat 输入框底部的模式 / Runtime / 权限 / 模型 / CLI / Skill 入口图标不再互相撞脸。
- Tool result / checkpoint / permission / warning 的状态图标更稳定。

优先迁移区域：

1. **Settings nav**
   - `providers` / `models` / `runtime` / `assistant` / `tasks` / `bridge` 必须语义清楚。
   - `models` 不再用 `Brain`。
   - `runtime` 不再用泛用 `Lightning`。
2. **Chat composer**
   - Mode / Runtime / Permission / Model / Skill / CLI / file attachment 分别有稳定语义。
   - icon-only button 必须有 tooltip / aria-label。
3. **Runtime + Provider**
   - Runtime 使用 engine / workflow 语义；provider 使用 brand icon；model 使用 model asset 语义。
4. **Capability surfaces**
   - Skills / MCP / Plugins / CLI Tools / Memory / Widget / Image / Media 分开。
5. **Status surfaces**
   - success / warning / error / loading 统一 aliases，避免每个组件自己挑。

验收：

- Browser/CDP 打开：
  - `/settings/runtime`
  - `/settings/models`
  - `/settings/providers`
  - `/plugins`
  - `/chat`
- 截图确认图标不挤、无错位、无重复误导。
- Console 口径沿用 Phase 6：`console clean except known tech-debt #20`；新噪音必须修或登记。
- 中英文 tooltip / aria-label 同步。Phase 0 inventory 表里"关联 i18n key"列非 `none` 的条目，必须确认 zh.ts / en.ts 文案与新图标语义一致；旧文案误导（如 icon 已换 `model` 但 key 还是 `common.brain`）必须改 key 或换文案，不可放任。
- **反例 smoke（强制，不可省）**：截一组真实工具调用消息，覆盖以下场景，确认同一界面里语义不撞且与设计稿一致：
  - 普通 Bash / Read 消息（仅 tools 类）
  - 带 Skill 调用的消息（Skills + tools 两类共存）
  - 带 MCP 调用的消息（MCP + tools 两类共存）
  - 带 CLI tool 调用的消息（CLI vs Terminal vs Bash 三个概念在同一会话里）
  - 带 Image 生成或 Media import 的消息
  - 这五种场景下，`skill / mcp / cli / terminal / tools / image / media` 七个 semantic alias 在用户视觉上必须能区分；任何一对相撞或互相误导，回 Phase 0 重选 HugeIcons 候选。
- **cross_phase_risk 文件单独验收**：`TaskCheckpoint.tsx` 改完后必须复跑 Phase 6 上下文 popover 截图；`IconProvider.tsx` 改完后扫一遍主题切换 + 深浅色截图，确认无图标丢失或主题感知漂移。

### Phase 3：Direct import 清理 + guardrail

用户能看到什么：

- 视觉上不会突然大改，但后续新增页面不会再回到混乱图标来源。

任务：

- 把 `lucide-react` 直接 import 迁出。
- 把业务组件里的 `@phosphor-icons/react` 直接 import 迁到 semantic layer。
- `ai-elements` 内部组件分两类：
  - 若是 CodePilot 直接 fork/维护的组件，迁移。
  - 若接近 upstream primitive，先登记例外，不为了“数字归零”硬改。
- 增加测试 / lint：
  - 业务组件禁止 direct import `@phosphor-icons/react` / `lucide-react`。
  - **允许清单**（source-grep guardrail 必须显式列出，不许靠"默认放行"绕过）：
    - 图标出口本身：`src/components/ui/icon.tsx`、`src/components/ui/semantic-icon.tsx`（或 Phase 1 最终命名的语义层入口）。
    - **shadcn primitive 6 个**：`src/components/ui/command.tsx` / `sheet.tsx` / `select.tsx` / `dialog.tsx` / `spinner.tsx` / `dropdown-menu.tsx`。这些是 shadcn 生成代码，迁移会与下次 shadcn 升级冲突，本轮 Phase 3 不动。
    - **ai-elements**：先按"接近 upstream primitive vs CodePilot 自维护"逐个判定；本轮**不强制清零**，留例外清单到 `docs/handover/icon-system.md`，逐文件标注"为什么暂留"。
    - LobeHub brand imports 允许，但**只能出现在 provider / runtime brand 场景**（当前 3 个文件：`provider-presets.tsx` / `RuntimePanel.tsx` / `RuntimeSelector.tsx`），source-grep 加一条断言：LobeHub 不得出现在 brand 场景之外的业务组件。

验收：

- `rg "@phosphor-icons/react|lucide-react"` 只剩允许清单。
- 新增 source-grep test 或 lint script。
- `npm run test` 通过。

### Phase 4：视觉 QA + 文档收口

用户能看到什么：

- 设计系统页能看到 CodePilot semantic icons 的样例。
- 后续新增功能可以直接查图标语义表，不再随机挑。

任务：

- `src/app/design-system/page.tsx` 增加 Icon semantics section：
  - 图标
  - semantic name
  - 使用场景
  - 不要用于什么
- 更新 `docs/design.md` 的 icon 规则。
- 归档本计划到 completed。
- 如果 Phase 7 后续还要做点阵背景 / loading / 空状态，另开子计划或在 refactor-closeout 的 Phase 7 继续拆。

验收：

- Browser/CDP 截 design-system icon section。
- 设计文档可回答“这个概念用哪个图标”。
- `npm run test` + UI smoke 通过。

## 不做

- 不把品牌图标替换成 HugeIcons。
- 不一口气全局替换所有 Phosphor import。
- 不因为换图标顺手重排页面布局。
- 不新增大面积彩色图标；颜色仍由状态 token / text token 控制。
- 不把图标语义藏在组件内部私有 map 里；语义表必须是可复用入口。

## Smoke Ledger（真实 UI 验证记录）

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _示例_ | n/a | n/a | n/a | n/a | Settings nav + Chat composer 图标迁移 | ✅ | screenshots + console clean except known tech-debt |

## 风险与防线

| 风险 | 防线 |
|------|------|
| 机械替换导致语义更乱 | Phase 0 先做 semantic taxonomy，Phase 2 只改高频面 |
| HugeIcons 图标名 / free package 覆盖不足 | 缺图标时记录 fallback，不临时混入第三套库 |
| 业务组件继续 direct import | Phase 3 加 source-grep guardrail |
| 品牌图标被通用图标替代 | LobeHub brand icon 明确保留 |
| 图标变大导致布局抖动 | 尺寸 token 固定，CDP 截 Settings / Chat / Plugins |
| ai-elements 迁移影响 upstream primitive | 允许清单 + 后续单独迁移，不硬清零 |

## 决策日志

- 2026-05-21：Phase 7 先做图标体系，不先做点阵背景 / loading。原因：用户明确指出当前图标重复使用、表意不清；图标是所有页面的识别基础，先收敛语义层再扩视觉锚点。
- 2026-05-21：主图标库目标定为 HugeIcons，但品牌图标保留 LobeHub。原因：品牌识别不能用通用线框图标替代。
- 2026-05-21：迁移策略定为"semantic aliases first"。原因：当前痛点是表意混乱，直接把 Phosphor 换成 HugeIcons 只能换皮，不能解决重复语义。
- 2026-05-21：Plan 补硬 5 点（开 Phase 0 前的补丁）：
  1. 直引 21 处拆分为 ai-elements 13 / shadcn primitive 6 / 业务组件 2；shadcn primitive 进 Phase 3 允许清单，本轮不动，否则与 shadcn 升级冲突。
  2. Phase 0 inventory 表强制 7 列（业务位置 / 当前图标 / 当前语义负载 / 目标 semantic alias / HugeIcons free 候选 / 关联 i18n key / cross_phase_risk）；HugeIcons 覆盖度必须在 Phase 0 就解决，禁止"先开工再说"。
  3. 每个 semantic alias 必须在 Phase 0 同步选定 HugeIcons free 候选或显式 fallback 注记，避免 Phase 1 装库后才发现 free 包缺图。
  4. Phase 2 验收强制反例 smoke：覆盖普通 / Skill / MCP / CLI / Image+Media 五个场景，验证 7 个高频 semantic alias 在同一界面下不撞、不互相误导。
  5. `chat/TaskCheckpoint.tsx`（Phase 6 context popover 刚改过）与 `layout/IconProvider.tsx`（主题元层）标 `cross_phase_risk = Y`，单独验收，不与其他业务组件同批走。
- 2026-05-21：LobeHub guardrail 收紧。原因：实测 LobeHub 仅 3 个文件 / 19 行 import 且全在 provider / runtime brand 场景；Phase 3 source-grep 加断言"LobeHub 不得出现在 brand 场景之外的业务组件"，避免后续 PR 复用为通用图标。
- 2026-05-21：**Phase 7 closeout gap pass**（Codex review 推动）。前几轮做的是"热点 commit"，没把 plan / guardrail / 表意错位收齐。这轮做 5 件结构性的事：
  1. **eslint guardrail 改向**：lucide 直引重定向从 "use Phosphor" 改到 "use CodePilotIcon"；Phosphor 直引重定向同样改到 CodePilotIcon（warn）；`@/components/ui/icon` 名导入 Brain/Lightning/Terminal 三个被 error 级别禁用，防新 PR 再次引入冲突语义。
  2. **`command-icons.ts` 重写**：从 raw Phosphor 组件引用（`Brain` / `Terminal` 等）改为 `COMMAND_ICON_NAMES: Record<string, CodePilotIconName>`；`PopoverItem.icon` 改为 `iconName`；`SlashCommandPopover` 渲染走 CodePilotIcon。`/memory` 的 Brain 形状通过 `memory` alias 表达，不再绕过语义层。
  3. **Plugin/MCP 表意错位**：`PluginCard.tsx` / `PluginDetail.tsx` 按 `source` 分流（`source === 'plugin'` 用 `plugin`，`project/global` skill 用 `skill`）；`McpManager.tsx` 两处 `WifiHigh` runtime status 改为 `mcp`。
  4. **Plan 状态对齐现实**：把 Phase 0/1/2/3 标 ✅，更新审计数字（CodePilotIcon 消费者 89、剩余 wrapper 53 纯结构性引用），不再显示"待开始 / 未安装"。
  5. **残留清单** 维护在 `docs/handover/icon-system.md` 第 X 节（gap pass closeout）：列出 53 个 wrapper-only 文件 + 类别（结构性 / IconComponent 类型 / 真有 HugeIcons 等价但暂未迁），后续按需逐批清理或保留作 compat layer。
