# Icon System — Phase 7 交接文档

> 产品思考见 [docs/insights/icon-system.md](../insights/icon-system.md)
>
> **当前阶段：Phase 0-4 已完成并归档**（taxonomy / HugeIcons skeleton / 96 文件迁到 CodePilotIcon / eslint guardrail + Brain/Lightning/Terminal 永久禁用 / Phase 4 文档收口：design-system Icon 区 + design.md 图标语义 + ui-governance §2 交接 + insights/icon-system.md）。详细对账见第八节"closeout gap pass 残留清单"。
>
> 父计划：[`docs/exec-plans/completed/phase-7-icon-system.md`](../exec-plans/completed/phase-7-icon-system.md)（已归档）
>
> 相关存量文档：[`docs/handover/ui-governance.md`](./ui-governance.md) 第 2 节描述的是 Phase 7 **之前**的图标规则（"Phosphor 通过 `ui/icon.tsx` 统一入口"），Phase 4 收口已把该节重写为指向本文件。
>
> **下方第一到第四节是 Phase 0 立项时写下的 strategic snapshot（2026-05-21 立项快照）**；第八节是 closeout 阶段的实际现状对账。两者数据可能略有差异，**以第八节为准**。

## 范围与边界

**本文件管什么：**

- CodePilot 自有 semantic icon alias 字典（产品概念层）。
- 每个 alias 在 HugeIcons free 包（`@hugeicons/core-free-icons`）里的候选 icon name。
- 当前 vendor icon name 与 semantic alias 的冲突解决决议（Brain / Lightning / Terminal 等）。
- 7 个优先迁移区域的 inventory snapshot：每个面用哪些图标、迁哪些 → 哪些 → 跨阶段风险标记。

**本文件不管什么：**

- 品牌图标（Anthropic / OpenAI / OpenRouter / Kimi 等）— 继续使用 LobeHub `@lobehub/icons`，不进入 HugeIcons 迁移。
- shadcn primitive（`src/components/ui/{command,sheet,select,dialog,spinner,dropdown-menu}.tsx`）— 这些是 shadcn 生成代码，本轮不动，避免与下次 shadcn 升级冲突。
- ai-elements 内部组件 — 接近 upstream primitive 的部分留例外清单；CodePilot 自维护的部分一并迁移。具体逐文件判定在 Phase 3。

### 受控例外：文件类型 artwork（2026-07-29）

`material-icon-theme` 的文件类型 artwork 表达的是 `.md`、`.ts`、`Dockerfile` 等外部文件格式，不是 CodePilot 自有产品语义，因此不进入 `CodePilotIcon` semantic alias 字典。

- 源包只能作为 devDependency，由 `scripts/generate-file-type-icons.mjs` 构建期提取固定静态子集；运行时不得 import。
- 产品代码只能通过 `src/components/ui/FileTypeIcon.tsx` 消费；generated mapping 仅允许该组件导入，ESLint fail closed。
- 产物必须携带逐图标 manifest、MIT LICENSE 和第三方品牌标识免责声明。
- 文件夹不使用这套 artwork；文件树以 Caret 表示文件夹，以 FileTypeIcon 表示文件。
- 增删类型必须重新运行 generator 和 `file-type-icon.test.ts`，禁止在业务组件散落手写映射。

完整数据流和解析优先级见 [Markdown Live Preview × Explorer 文件树交接](./markdown-live-preview-file-tree.md)。

## 一、Semantic alias 字典

下表是 CodePilot 自有 semantic alias，**业务代码不要再直接表达 vendor icon name**（`Brain` / `Lightning` 等），而是通过 `<CodePilotIcon name="model" />` 这种方式调用。

| 类别 | Alias | 用户语义 |
|------|-------|----------|
| Navigation | `overview` | 设置首屏 / Dashboard 入口 |
| | `settings` | 通用设置入口 |
| | `appearance` | 主题 / 外观 |
| | `health` | 服务商 / Runtime 健康度 |
| | `usage` | 使用量统计 |
| | `about` | 关于 / 元信息 |
| Provider / Model / Runtime | `provider` | 服务商（账号 / 网关） |
| | `model` | 大模型实体（**不再用 Brain**） |
| | `runtime` | 执行引擎（**不再用 Lightning 表达"快"**） |
| Capability | `assistant` | 人格 / 助理工作区 |
| | `task` | 定时任务 / 后台任务 |
| | `bridge` | IM Bridge（远程信道） |
| | `plugin` | 插件 / extension container |
| | `skill` | Skill（AI 可调用的能力包） |
| | `mcp` | MCP server / 协议 |
| | `cli` | 本地 CLI 工具（catalog 概念） |
| | `terminal` | Terminal UI / shell session（**不与 `cli` 混用**） |
| Resource | `file` | 文件资源 |
| | `folder` | 目录资源 |
| | `code` | 代码块 / snippet / 语言 |
| | `artifact` | Artifact 表现层 |
| | `preview` | 预览动作 |
| | `memory` | Memory 上下文（**不再用 Brain**） |
| | `widget` | Widget 表现层 |
| | `image` | 图片资源 |
| | `media` | 媒体资源（视频 / 音频） |
| | `attachment` | 通用附件 |
| Action / State | `permission` | 权限 / 锁 |
| | `success` | 成功 |
| | `warning` | 警告 |
| | `error` | 错误 |
| | `loading` | 加载中 |
| Workspace | `workspace` | 工作目录（cwd 概念） |
| | `git` | Git 操作 |

## 二、HugeIcons free 候选映射

下表是 Phase 0 实测核对：每个 alias 在 `@hugeicons/core-free-icons@4.1.4` 里的候选 icon name（已确认存在）。无 free 候选的 alias 显式标 `fallback`，不留空。

| Alias | HugeIcons free 候选 | 备选 | 备注 |
|-------|---------------------|------|------|
| `overview` | `DashboardCircleEditIcon` | `Layout01Icon` | Dashboard 是"看板"语义，与 Settings nav 一致 |
| `settings` | `Settings02Icon` | `Settings01Icon` | 齿轮通用语义 |
| `appearance` | `PaintBoardIcon` | `PaintBrush02Icon` | 调色板 > 画笔（覆盖主题 / 颜色 / 字体） |
| `health` | `HeartCheckIcon` | `Shield02Icon` | 心跳带 ✓ 表达健康 |
| `usage` | `Analytics02Icon` | `Chart01Icon` | Analytics 比单 Chart 更贴"统计" |
| `about` | `InformationCircleIcon` | `HelpCircleIcon` | i 圆 |
| `provider` | `Plug02Icon` | `ConnectIcon` | 插头 = 服务商接入 |
| `model` | `CubeIcon` | `Atom01Icon` / `BrainIcon`（refused） | **不用 Brain** — Brain 留给 Memory。Cube 表达"模型实体 / asset" |
| `runtime` | `ChipIcon` | `WorkflowCircle01Icon` | 芯片 = 执行引擎。**不再用 Lightning**（Lightning 被 model 选择器误用） |
| `assistant` | `Robot01Icon` | `BotIcon` / `User03Icon` | 人格化机器人，与 model 区分 |
| `task` | `Timer02Icon` | `Clock02Icon` / `ScheduleIcon` | Timer 优于 Clock（Clock 在 nav 里太通用） |
| `bridge` | `BridgeIcon` | `Wifi02Icon` | HugeIcons 直接有 BridgeIcon，无需替代 |
| `plugin` | `PuzzleIcon` | `Package01Icon` | 拼图块 = 插件 |
| `skill` | `MagicWand03Icon` | `SparklesIcon` | 魔杖表达"能力"，不与 model 撞 |
| `mcp` | `McpServerIcon` | `ServerStack01Icon` | **HugeIcons 直接有 McpServerIcon** — 不需要替代 |
| `cli` | `CommandLineIcon` | `ConsoleIcon` | HugeIcons 有专用 CommandLineIcon — 比 Code 更贴"CLI 工具"语义，与 terminal 区分 |
| `terminal` | `TerminalIcon` | — | 命令行窗口 |
| `file` | `File01Icon` | — | 文件 |
| `folder` | `Folder01Icon` | `Folder02Icon` | 目录 |
| `code` | `CodeIcon` | `CodeCircleIcon` | `</>` 符号 |
| `artifact` | `Layers02Icon` | `BoxerIcon`（不合适） | 多层 = artifact 复合产物 |
| `preview` | `EyeIcon` | — | 眼睛 |
| `memory` | `BrainIcon` | `Brain02Icon` | **Memory 拿走 Brain**（Phase 7 之前 Brain 用在 models nav；改为 model→Cube，Brain 归位 Memory 语义） |
| `widget` | `ComponentIcon` | `Layout02Icon` | 组件块 = widget |
| `image` | `Image01Icon` | `Image02Icon` | 单图 |
| `media` | `MusicNote01Icon` 或 `Video01Icon` | — | 用法分两路：音频 → MusicNote，视频 → Video |
| `attachment` | `Attachment01Icon` | `AttachmentCircleIcon` | 通用附件回形针 |
| `permission` | `Shield01Icon` | `LockedIcon` | 盾 > 锁（permission 是策略不是已锁） |
| `success` | `Tick02Icon` | `CheckmarkBadge01Icon` | 勾 |
| `warning` | `Alert02Icon` | `AlertCircleIcon` | 警告 |
| `error` | `AlertCircleIcon` | `CancelCircleIcon` | 错误圆 |
| `loading` | `Loading02Icon` | `Refresh01Icon` | 旋转 |
| `workspace` | `Folder02Icon` | `LaptopIcon` | 与 folder 区分（workspace 是 cwd 整体） |
| `git` | `GitBranchIcon` | `GitCommitIcon` | Phase 1 装库后实测确认 HugeIcons free 已有 git 系列；不需要 fallback |

> **Phase 2 / closeout 期间持续追加的 alias**（与 semantic-icon.tsx 同步；这里只记最关键的几个，完整列表以 `src/components/ui/semantic-icon.tsx` SEMANTIC_MAP 为准）：

| 新增 alias | HugeIcons | 说明 |
|------------|-----------|------|
| `panel_left` / `panel_left_close` / `panel_left_open` | `PanelLeftIcon` / `PanelLeftCloseIcon` / `PanelLeftOpenIcon` | 侧栏开 / 折 / 打开按钮（替代原通用 `sidebar`，方向语义更准） |
| `panel_right` | `PanelRightIcon` | workspace sidebar toggle |
| `file_tree` | `HierarchyFilesIcon` | 文件树切换按钮（不是单 file 也不是普通 folder） |
| `favorite` | `StarIcon` | 素材收藏 |
| `rating` | `StarIcon` | CLI 工具评分；与收藏 alias 分离，后续任一视觉变化不会串改另一处 |
| `tag` | `Tag01Icon` | 标签 |
| `bookmark` | `Bookmark01Icon` | 书签 |
| `external` | `ArrowUpRight01Icon` | 外部链接 / 新窗口打开（替代 Phosphor `ArrowSquareOut`） |
| `archive` | `ArchiveIcon` | `/compact` 命令（压缩对话）等"归档/压缩"语义；替代 Phosphor `FileZip` |

**Fallback 政策**：任一 alias 在 free 包里找不到合适候选，semantic 层暴露 alias 名但内部仍用 Phosphor — `aliased as semantic_name`。**绝不在第三方库混入第三套**（Lucide / Tabler / Hero）。**新增 alias 必须同步本节表 + `src/components/ui/semantic-icon.tsx` + 在第八节残留清单同步更新数字**。

## 三、冲突解决决议

Phase 7 之前的图标使用里，三个 Phosphor icon 严重负载多个语义。本节锁定每个 icon 的归宿。

| 图标 | Phase 7 之前 表达的概念 | Phase 7 决议归属 | 取代图标 |
|------|------------------------|------------------|----------|
| `Brain` | 1. Settings nav "Models"（line 51 `nav-config.ts`）<br>2. Slash `/memory` 命令（line 31 `command-icons.ts`）<br>3. 部分 Assistant 文案 | 归 `memory` 语义 | 1. Models → `model` (`CubeIcon`)<br>2. `/memory` 保留 `BrainIcon` 但走 alias `memory`<br>3. Assistant 用 `assistant` (`Robot01Icon`) |
| `Lightning` | 1. Settings nav "Runtime"（line 52 `nav-config.ts`）<br>2. Chat composer "插入斜杠命令"按钮（line 1086 `MessageInput.tsx`）<br>3. 部分 Skills / Quick action 图标 | 不再作为 default vendor 输出 | 1. Runtime → `runtime` (`ChipIcon`)<br>2. "插入命令"按钮 → `code` (`CodeIcon`)（命令是 slash 不是闪电）<br>3. Skill → `skill` (`MagicWand03Icon`) |
| `Terminal` | 1. Chat composer "调用 CLI"按钮（line 1090 `MessageInput.tsx`）<br>2. Slash `/terminal-setup` 命令（line 30 `command-icons.ts`）<br>3. 内嵌 terminal 抽屉 | 归 `terminal` 语义（terminal UI / shell session） | 1. "调用 CLI"按钮 → `cli` (`CommandLineIcon`)（CLI 工具不是 terminal）<br>2. `/terminal-setup` 保留 `terminal` alias（语义对得上）<br>3. 内嵌 terminal 抽屉 → `terminal` (`TerminalIcon`)无需变 |

**核心动作**：`cli` 与 `terminal` 分离；`model` 与 `memory` 分离；`runtime` 不被 `Lightning` 这种泛义图标承载。

## 四、Inventory snapshot — 7 优先迁移区域

> 本节是 Phase 0 的 **strategic snapshot**，记录每个区域的 anchor 文件 + 当前主要图标 + 目标 alias。**完整 7 列 inventory（含 i18n key、cross_phase_risk 等）在 Phase 2 迁移每个文件时随 commit 增长，不要求 Phase 0 一次填满**。

### 区域 A — Settings nav + 各页

**Anchor 文件**：`src/components/settings/nav-config.ts`（12 entries 已映射）

| Settings section | 当前图标 | 目标 alias |
|------------------|---------|-----------|
| overview | Eye | `overview` |
| general | Gear | `settings` |
| appearance | PaintBrush | `appearance` |
| providers | Plug | `provider` |
| **models** | **Brain ⚠️** | **`model` (CubeIcon)** |
| **runtime** | **Lightning ⚠️** | **`runtime` (ChipIcon)** |
| health | Heart | `health` |
| usage | ChartBar | `usage` |
| assistant | UserCircle | `assistant` |
| tasks | Clock | `task` |
| bridge | WifiHigh | `bridge` |
| about | Info | `about` |

**待 Phase 2 实测扫描**的下游 Settings 页（约 24 文件）：`OverviewSection.tsx`, `GeneralSection.tsx`, `AppearanceSection.tsx`, `ProviderManager.tsx`, `ModelsSection.tsx`, `RuntimePanel.tsx`, `RuntimeCapabilityList.tsx`, `HealthSection.tsx`, `UsageStatsSection.tsx`, `AssistantWorkspaceSection.tsx`, `TasksSection.tsx`, `AboutSection.tsx`, 等。

### 区域 B — Chat composer

**Anchor 文件**：`src/components/chat/MessageInput.tsx`

| 位置 | 当前图标 | 目标 alias |
|------|---------|-----------|
| line 1086 "插入斜杠命令"按钮 | **Lightning ⚠️** | `code` (`CodeIcon`)（slash 命令不是闪电） |
| line 1090 "调用 CLI"按钮 | **Terminal ⚠️** | `cli` (`CommandLineIcon`)（CLI 不是 terminal session） |

**复合组件**（待 Phase 2 实测扫描）：`MessageInputParts.tsx`, `ChatComposerActionBar.tsx`, `RuntimeSelector.tsx`, `ChatPermissionSelector.tsx`, `ModelSelectorDropdown.tsx`, `EffortSelectorDropdown.tsx`, `SlashCommandPopover.tsx`, `CliToolsPopover.tsx`, `QuickActions.tsx`, `ContextUsageIndicator.tsx`, `RunCockpit.tsx`, `RunCockpitPopoverContent.tsx`, `MessageItem.tsx`, `MessageList.tsx`, `PermissionPrompt.tsx`, `TaskCheckpoint.tsx ⚠️ cross_phase_risk`, `RunCheckpoint.tsx`, `RateLimitBanner.tsx`（含 `lucide-react` 直引）。

### 区域 C — Tool result + ai-elements

**Anchor 文件**：13 文件直接 `@phosphor-icons/react`，1 文件 `lucide-react`

| 文件 | 当前导入源 | Phase 3 处理 |
|------|----------|-------------|
| `ai-elements/message.tsx` | `@phosphor-icons/react` | 业务侧：迁 semantic 层 |
| `ai-elements/code-block.tsx` | `@phosphor-icons/react` | 业务侧：迁 semantic 层 |
| `ai-elements/tool-actions-group.tsx` | `@phosphor-icons/react` | 业务侧：迁 semantic 层 |
| `ai-elements/chain-of-thought.tsx` | `@phosphor-icons/react` | 业务侧：迁 semantic 层 |
| `ai-elements/artifact.tsx` | `@phosphor-icons/react` | 业务侧：迁 semantic 层 |
| `ai-elements/conversation.tsx` | `@phosphor-icons/react` | 业务侧：迁 semantic 层 |
| `ai-elements/prompt-input.tsx` | `@phosphor-icons/react` | 业务侧：迁 semantic 层 |
| `ai-elements/terminal.tsx` | `@phosphor-icons/react` | 业务侧：迁 semantic 层 |
| `ai-elements/task.tsx` | `@phosphor-icons/react` | 业务侧：迁 semantic 层 |
| `ai-elements/file-tree.tsx` | `@phosphor-icons/react` | 业务侧：迁 semantic 层 |
| `ai-elements/tool.tsx` | `@phosphor-icons/react` | 业务侧：迁 semantic 层 |
| `ai-elements/reasoning.tsx` | `@phosphor-icons/react` | 业务侧：迁 semantic 层 |
| `ai-elements/sources.tsx` | `@phosphor-icons/react` | 业务侧：迁 semantic 层 |
| `ai-elements/attachments.tsx` | **`lucide-react` ⚠️** | **Phase 3 必迁** |

**逐文件 ai-elements primitive 判定**：Phase 3 实施前对每个文件做 5 行 diff 复核，标 `upstream-aligned`（保留 vendor，进允许清单）vs `codepilot-maintained`（迁 semantic 层）。本 snapshot 默认所有 ai-elements 都迁，除非 Phase 3 发现某文件与 upstream 完全一致。

### 区域 D — Plugins / Skills / MCP

| 文件 | 主要图标 | 目标 alias |
|------|---------|-----------|
| `plugins/PluginList.tsx`, `PluginCard.tsx`, `PluginDetail.tsx` | `Plug`, `MagnifyingGlass` 等 | `plugin` (`PuzzleIcon`) |
| `plugins/McpManager.tsx`, `McpServerList.tsx`, `McpServerDetailDialog.tsx`, `BuiltInMcpSection.tsx` | `Plug`, `Storefront` 等 | `mcp` (`McpServerIcon`) |
| `skills/SkillsManager.tsx`, `SkillListItem.tsx`, `SkillDetailDialog.tsx`, `MarketplaceBrowser.tsx`, `MarketplaceSkillDetail.tsx`, `CreateSkillDialog.tsx` | `Sparkle`, `Lightning` 等 | `skill` (`MagicWand03Icon`) |
| `app/plugins/page.tsx` | nav 容器 | `plugin` |

### 区域 E — CLI tools + Slash commands

**Anchor 文件**：`src/lib/constants/command-icons.ts`（9 entries 已映射）

| Slash 命令 | 当前图标 | 目标 alias |
|------------|---------|-----------|
| /help | Question | `about` (`HelpCircleIcon`) |
| /clear | Trash | `error` 系列 alias 或保留 Trash semantic |
| /cost | Coins | （保留 Phosphor — 货币图标 HugeIcons 候选弱） |
| /compact | FileZip | 保留语义 alias |
| /doctor | Stethoscope | 保留语义 alias |
| /init | NotePencil | 保留语义 alias |
| /review | ListMagnifyingGlass | 保留语义 alias |
| /terminal-setup | Terminal | `terminal` (`TerminalIcon`) |
| **/memory** | **Brain ⚠️** | **`memory` (`BrainIcon`)** — Brain 在 Phase 7 之后归 memory，所以这里 vendor 不变但语义改 alias |

### 区域 F — FileTree / Workspace / Git

**Anchor 文件**：

- `src/components/project/FileTree.tsx`
- `src/components/layout/panels/FileTreePanel.tsx`
- `src/components/layout/WorkspaceSidebar/*.tsx`
- `src/components/git/*.tsx`

主要图标：`File`, `Folder`, `FolderOpen`, `GitBranch`, `GitCommit`, `CloudArrowUp`, `Eye` 等。

| 当前图标 | 目标 alias |
|---------|-----------|
| File / FileCode | `file` (`File01Icon`) |
| Folder / FolderOpen | `folder` (`Folder01Icon`) |
| GitBranch / GitCommit | `git` (待 Phase 1 实测 HugeIcons 候选；缺则 fallback Phosphor) |
| CloudArrowUp | `git` 子语义 push 或保留 |
| Eye | `preview` (`EyeIcon`) |

### 区域 G — 其他 cross_phase_risk

| 文件 | 风险点 | 单独验收要求 |
|------|--------|-------------|
| `src/components/chat/TaskCheckpoint.tsx` | Phase 6 context-accounting popover 刚改过；icon 切换可能影响 RunCheckpoint footer 视觉 | 改完复跑 Phase 6 popover 截图 + console 检查 |
| `src/components/layout/IconProvider.tsx` | 主题元层；可能影响图标 weight / color 的全局感知 | 改完跑主题切换 + 深浅色截图 |
| `src/components/ui/icon.tsx` | wrapper 自身；Phase 1 必须保留所有 vendor re-export 以兼容旧 import | 用 source-grep 测试断言旧 export 列表完整 |

## 五、迁移顺序建议（Phase 2 wave plan）

**Wave 1（Settings nav anchor，1-2 文件）**：

- `nav-config.ts` 一次性切 12 entries 到 semantic alias。
- 这是最高 leverage 的一刀：12 个高频入口语义同时收敛。
- 反例 smoke：`/settings/models` `/settings/runtime` `/settings/providers` 三页 anchor 截图。

**Wave 2（高频 chat composer，~5 文件）**：

- `MessageInput.tsx`（Lightning + Terminal 两个误用，line 1086 / 1090）
- `ChatComposerActionBar.tsx` 容器（无 icon，但反例 smoke 时需要查整体）
- `RuntimeSelector.tsx`（含 LobeHub brand — 不变）
- `ChatPermissionSelector.tsx` / `ModelSelectorDropdown.tsx`
- 反例 smoke：发一条带 Skill 调用消息，确认 composer 七联（mode / runtime / permission / model / skill / cli / file）图标语义不撞。

**Wave 3（Capability surfaces，~12 文件）**：

- Plugins / Skills / MCP 三大组件家族
- 反例 smoke：触发 Skill 调用 / 触发 MCP server 调用 / 触发 CLI tool 调用 三场景的工具结果消息。

**Wave 4（Tool result + ai-elements，~14 文件）**：

- `ai-elements/*.tsx` 13 文件（先判定 upstream-aligned vs codepilot-maintained）
- `attachments.tsx` 强制迁出 `lucide-react`
- 反例 smoke：带 Bash×3 / Read×2 / Image generation / MCP call 的多类工具消息。

**Wave 5（FileTree / Git / 其他，~9 文件）**：

- `FileTree.tsx`, `FileTreePanel.tsx`, `WorkspaceSidebar/*.tsx`, `git/*.tsx`
- 反例 smoke：打开文件树 + 进入 git panel + 触发 commit / push 操作的视觉一致性。

**Wave 6（cross_phase_risk 单独，2 文件）**：

- `TaskCheckpoint.tsx`（带 Phase 6 popover 复跑）
- `IconProvider.tsx`（带主题切换复跑）

## 六、不在本轮范围（明确不动）

| 类别 | 文件 | 原因 |
|------|------|------|
| 品牌图标 | `provider-presets.tsx` / `RuntimePanel.tsx` / `RuntimeSelector.tsx`（3 文件 / 19 行 LobeHub import） | 品牌识别不能用通用线框图标替代 |
| shadcn primitive | `ui/{command,sheet,select,dialog,spinner,dropdown-menu}.tsx`（6 文件直引 Phosphor） | shadcn 生成代码，迁移与下次升级冲突 |
| sandpack deps 字符串 | `editor/SandpackPreview.tsx` 的 `"lucide-react"` 字符串 | 不是 import，是 sandpack 内部 dep 列表 |
| Brain 在 /memory 命令 | `command-icons.ts:31` | Brain 在 Phase 7 之后归 memory 语义；vendor 不变 |

## 七、Phase 1 → Phase 4 责任界面

| Phase | 本文件的演化责任 |
|-------|----------------|
| Phase 1 | 装 HugeIcons，新建 `semantic-icon.tsx` 出口。本文件二、三两节实测核对每个 alias 候选可用，发现 fallback 时立即追加注记。 |
| Phase 2 | 每迁完一个 wave，本文件第四节相应区域追加实测 7 列条目。 |
| Phase 3 | 第六节 source-grep guardrail 落地时同步追加允许清单的最终版。 |
| Phase 4 | 本文件升级为正式 handover；同时新建 `docs/insights/icon-system.md` 互链；`docs/handover/ui-governance.md` 第 2 节"图标统一"重写指向本文件。 |

## 八、Closeout gap pass 残留清单（2026-05-21）

Codex review 推动的 closeout 整理。**目标**：让"Phase 7 已完成"对得上代码现实，而不是热点 commit 堆叠。

### 8.1 结构性现状

| 项目 | 数字 | 含义 |
|------|------|------|
| `CodePilotIcon` 消费者 | 89 文件 | 业务代码用 semantic alias 渲染 |
| `@/components/ui/icon` 引用（混合 — 同时也用 CodePilotIcon） | 52 文件 | 已部分迁，剩余结构性图标走 wrapper |
| `@/components/ui/icon` 引用（**纯 wrapper 残留**） | 53 文件 | 全部用结构性图标，未迁到 semantic layer |
| `@phosphor-icons/react` direct import 业务代码 | 0 | lucide 同样 0 |
| `@phosphor-icons/react` direct import 总数 | 19 | 13 ai-elements primitive + 6 shadcn primitive（按 plan 允许清单保留） |

### 8.2 53 个纯 wrapper 残留按 bucket 分类

按"为什么没迁"分桶：

| Bucket | 含义 | 后续动作 |
|--------|------|----------|
| **B-structural-only** | 只用 CaretDown / CaretUp / CaretRight / CheckCircle / Warning / XCircle / SpinnerGap / X / Check / Stop / DotOutline / Circle / ArrowsIn / ArrowsClockwise / Bell / Lock / LockOpen 等结构性 / 状态 / chevron 图标，无 HugeIcons 等价或视觉差异不大 | **保留作 compat layer**；本轮不迁 |
| **B-icon-component-type** | 只 import `IconComponent` 类型（不 import 具体图标），例如 `command-icons.ts` 之前的 `IconComponent` 引用、`GlobalSearchDialog.tsx` 的 `TYPE_ICONS` map | **保留**；type-only import |
| **B-deferred-semantic** | 含有 1-2 个 HugeIcons-aliasable 图标（如 ProviderForm 的 Caret + SpinnerGap），但全文件只用结构性图标；视觉收益小 | **暂不迁**；保留作 compat layer；后续 PR 走到该文件再顺手迁 |
| **B-bridge-family** | `src/components/bridge/*`（6 个 Bridge section + BridgeLayout + page.tsx） | **可迁但本轮不紧急**；下一波专项做 Bridge 视觉刷新时一起处理 |
| **B-setup-wizard** | `src/components/setup/SetupCard.tsx` + `ClaudeCodeCard.tsx` + `InstallWizard.tsx` | **新用户首屏**；优先级中，下一轮如果做 Setup 体验顺手迁 |

### 8.3 不再扩散的红线（强制 guardrail）

`eslint.config.mjs` 2026-05-21 改向后强制：

1. **lucide-react** project-wide 仍 error，但 message 重定向到 `CodePilotIcon` 而不是之前的 Phosphor。
2. **`@phosphor-icons/react`** 业务代码仍 warn，message 重定向到 `CodePilotIcon`。
3. **`@/components/ui/icon` 三个名导入 Brain / Lightning / Terminal**：业务代码 error 级 ban；msg 说明三个图标在 Phase 7 已经映射到 `memory` / `runtime` / `terminal+cli`，raw 用法 = 回滚 Phase 7 冲突解决。
4. ai-elements / shadcn primitive 6 个 / `ui/icon.tsx` 自身 / `IconProvider.tsx` 不在业务 files glob 内，所以这套 rule 不会误伤库组件。

### 8.4 表意错位修复（gap pass 同期）

| 文件 | 修复 |
|------|------|
| `plugins/PluginCard.tsx` + `plugins/PluginDetail.tsx` | 按 `source` 分流：`source === 'plugin'` 用 `plugin` alias（Plugin badge 的语义一致），`project` / `global` skill 仍用 `skill` |
| `plugins/McpManager.tsx`（2 处 runtime status header） | `WifiHigh`（网络信号）→ `mcp`（McpServerIcon）— 这是 MCP runtime status 入口，不是泛 wifi |
| `lib/constants/command-icons.ts` | 整文件重写：raw Phosphor `Brain` / `Terminal` 等 → `COMMAND_ICON_NAMES: Record<string, CodePilotIconName>` 字符串；`/memory` 走 `memory` alias（BrainIcon），不再绕过语义层 |

### 8.5 Phase 4 仍待做

- design-system 加 Icon semantics section（实时渲染样板表，与本文件第一节同步）
- `ui-governance.md` 第 2 节"图标统一"重写：原 "Phosphor 通过 `ui/icon.tsx` 入口" 改为指向本文件 + semantic-icon.tsx
- `docs/insights/icon-system.md`（产品思考文档）— 与本文件互链
- plan 归档到 `docs/exec-plans/completed/`

## 九、图标颜色语义（2026-05-21）

### 9.1 规则

**默认浅色（`text-muted-foreground`），重要 anchor + active 才深色。**

| 状态 | 颜色 | 例 |
|------|------|----|
| 默认（"其他所有图标"） | **浅** — `text-muted-foreground` | 卡片内 icon、chip / badge 内 icon、对话框关闭 X、状态徽章、文件树 icon、工具结果链 icon、聊天 chip / quick action |
| 重要 anchor (a)：**左侧侧边栏快捷** | **深** — `text-inherit`（跟随父级 sidebar text color） | NavRail 4 个 nav icon + ChatListPanel 内 新对话 / 搜索 / Plugins / Gallery / 底部 Settings |
| 重要 anchor (b)：**Settings 页面左导航** | **深** — `text-inherit` | SettingsSidebar 12 项 + 移动端 tab strip 12 项 |
| 状态 (c)：**选中态 / hover 态** | **深** — 父级 active class 自动深色，子 icon 通过 `text-inherit` 跟随 | WorkspaceSidebar TabBar 内 tab leading icon（inactive 浅 / active 深）；同样适用于任何"父级有 active text-foreground"的容器 |
| 品牌 mark | **深** — `text-foreground`（MonolithIcon 内置默认） | RuntimeSelector / RuntimePanel / NewChatWelcome / WelcomeCard / AboutSection 的 MonolithIcon |

### 9.2 实现机制

1. **`CodePilotIcon` 默认 class = `text-muted-foreground`**（`src/components/ui/semantic-icon.tsx`）。
2. **`MonolithIcon` 默认 class = `text-foreground`**（`src/components/brand/MonolithIcon.tsx`），独立组件，跟 CodePilotIcon 不共享 default。
3. **`tailwind-merge`**（通过 `cn(...)`）确保消费者传入的 `className` 替换 default —— `text-inherit` / `text-foreground` / `text-status-*` 都会覆盖 default 的 `text-muted-foreground`，最后写的赢。
4. **anchor 站点**显式传 `className="text-inherit"`，让 icon 继承父级 `<Link>` / `<Button>` 的文字色（sidebar-foreground inactive、sidebar-accent-foreground active）。
5. **状态变化**靠父级容器（Link / Button）的 active 或 hover class 改变自身 text color；子 icon 用 `text-inherit` 跟着走 —— **不需要在 icon 上单独写 `group-hover:...`**。

### 9.3 已显式 override 的 anchor 站点清单

| 文件 | 改动 |
|------|------|
| `src/components/layout/NavRail.tsx` | 4 顶级 nav icons + 底部 Settings 三个 `<CodePilotIcon>` 加 `className="text-inherit"` |
| `src/components/layout/ChatListPanel.tsx` | 新对话 / 搜索 / nav items (Plugins+Gallery) / 底部 Settings 共 4 处 |
| `src/components/layout/SettingsSidebar.tsx` | 桌面端左导航 12 项 |
| `src/app/settings/layout.tsx` | 移动端 horizontal tab strip 12 项 |
| `src/components/layout/WorkspaceSidebar/TabBar.tsx` | tab leading icon 包装 span + `tabIcon()` 内 6 个 `<CodePilotIcon>` 都加 `text-inherit`（让选中态自然变深，inactive 自然变浅）|

### 9.4 Codex review checklist（让 Codex 复查这些场景）

请扫一遍 `src/` 下所有 `<CodePilotIcon>` 调用站点，按下面三条 review：

#### A. **应该深色但漏改的 anchor**（少了 `className="text-inherit"`）

候选清单（如果发现这些位置 icon 没 anchor override，需要补）：
- `src/components/layout/UnifiedTopBar.tsx`：顶部条 sidebar toggle / workspace sidebar toggle / file tree toggle / git toggle — 这些是顶部 anchor 性质，可以视为 (a) 类，**建议加 `text-inherit`**
- `src/app/plugins/page.tsx`：tabs (Skills / MCP / CLI) 内的 `<CodePilotIcon name={meta.icon} ...>` — tab 类似选中态，**应跟 WorkspaceSidebar TabBar 一致**，加 `text-inherit` 让选中变深 / 未选浅
- 任何使用 `<Tabs>` + `<TabsTrigger>` 模式的位置（Settings / Plugins 等）

#### B. **应该浅色但被父级污染成深色**

候选清单（找 CodePilotIcon 在父级 default text-foreground 容器内、且没传 anchor override）：
- 普通卡片（`<Card>`）内的 icon — 默认应该是浅
- 表单 label 旁 icon — 应该浅
- 工具调用结果链（`tool-actions-group.tsx`、`tool.tsx`）—— 默认应该浅
- 文件树 icon（`ai-elements/file-tree.tsx`、`project/FileTree.tsx`）—— 默认应该浅
- chip / badge 内 icon —— 默认应该浅
- 这些位置 CodePilotIcon default `text-muted-foreground` 应该够用，**但要确认没有父级在 Tailwind 优先级里覆盖**

#### C. **状态传播断了的"选中态"icon**

候选清单（找父级有 active class 切换、但 icon 没跟着走的）：
- 任何 `data-state="active"` / `aria-selected` 类 Radix 组件的 trigger icon
- 自定义 toggle / chip 组件内 icon
- 这些位置如果 icon 用了 explicit `text-muted-foreground` 而不是 `text-inherit`，**选中态不会自动深** —— 需要改成 `text-inherit` 或加 `data-[state=active]:text-foreground`

#### D. **品牌 mark 的边界**

`<MonolithIcon>` 默认 `text-foreground`（深）。检查这五个使用位置是否合适：
- `chat/RuntimeSelector.tsx` (Agent 引擎选择): ✓ 跟 Anthropic / OpenAI 品牌 icon 并列，深色合理
- `settings/RuntimePanel.tsx` (Settings 默认引擎): ✓ 同上
- `chat/MessageList.tsx` (空聊天 64px): ✓ 中心位 brand 锚点
- `setup/WelcomeCard.tsx` (Setup Center): ✓ Welcome brand
- `settings/AboutSection.tsx` (About 128px hero): ✓ 品牌主入口
- `chat/NewChatWelcome.tsx` (新对话居中 36px logo): ✓ welcome anchor

如果在以上 6 处之外发现 MonolithIcon 用法，需要 review 是否合理。

### 9.5 验证命令

review 时可用以下命令快速过一遍：

```bash
# 找所有 CodePilotIcon 调用站点
rg -n "<CodePilotIcon\b" src/ | wc -l

# 找显式 text-inherit override 的位置（应该 = 已知 anchor 站点数量）
rg -n "<CodePilotIcon[^/>]+text-inherit" src/

# 找显式 text-foreground override（除了 MonolithIcon 自身，CodePilotIcon 不应该有这种用法）
rg -n "<CodePilotIcon[^/>]+text-foreground" src/

# 找 MonolithIcon 调用位置（应该 = 6 处品牌 anchor）
rg -n "<MonolithIcon\b" src/
```

### 9.6 不应该做的

- ❌ 不要在 anchor icon 上既加 `text-inherit` 又加 `text-foreground` —— 后者会赢，吃掉 active 状态的 accent color
- ❌ 不要在普通"其他图标"上加 `text-foreground` —— 这违反"默认浅色"的规则
- ❌ 不要给 CodePilotIcon 加 `group-hover:text-foreground` —— hover 应该由父级 button / link 自身处理 text color，icon 走 `text-inherit` 自动跟
- ❌ MonolithIcon 不要传 `text-muted-foreground` —— 品牌 mark 应该一直是 strong foreground
