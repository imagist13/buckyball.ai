# Chat Composer Redesign (April 2026)

> 产品思考见 [docs/insights/chat-composer-redesign.md](../insights/chat-composer-redesign.md)
> **设计原则（5 条沉淀版）见 insights 文档的 "Chat 页设计原则" 节** — 新增 Chat 页元素前按那 5 条交叉检验

聊天页（`/chat` + `/chat/[id]`）输入框区 + 顶部栏 + Run 状态显示的一次完整视觉与交互重构。

## 改造范围

- 顶部栏：`UnifiedTopBar.tsx`
- Composer 输入框：`MessageInput.tsx` + `MessageInputParts.tsx`
- Composer 下方工具栏：`ChatComposerActionBar.tsx`
- 模式选择：`ModeIndicator.tsx`
- 权限选择：`ChatPermissionSelector.tsx`
- 模型选择：`ModelSelectorDropdown.tsx`
- 上下文用量：`ContextUsageIndicator.tsx`
- Run 状态：`RunCockpit.tsx` + 新增 `RunStatusPanel.tsx`
- 用户消息气泡：`ai-elements/message.tsx`
- 弹窗底座：`patterns/CommandList.tsx`
- 弹窗派生：`SlashCommandPopover.tsx`、`CliToolsPopover.tsx`
- 全局阴影：`app/globals.css`
- 左侧栏密度：`ChatListPanel.tsx`、`SessionListItem.tsx`、`ProjectGroupHeader.tsx`

## 核心架构变化

### 1. 三层视觉规则（贯穿整轮设计的判定基线）

聊天页底部工具栏整体视觉是「浅灰打底」。在低对比环境里，任何"再轻量的 chip"也会成为视觉焦点。三层规则：

| 层 | 适用 | 视觉 |
|---|---|---|
| 默认 / 用户主动选过的非默认 | 代码 / 计划、默认权限、已固定（正常） | `text-muted-foreground` 同色，靠图标 + 文字内容区分，不靠色彩 |
| 错误 / 危险态 | 已固定·不可执行、运行环境降级、完全访问权限、健康警告 | 上 status-pair chip 配色 + bg |
| 常态 OK | 无 | 完全不渲染 |

**反例**：给"计划模式"或"已固定"用 `bg-primary/10 text-primary`，会让它在浅灰工具栏里成为最显眼的元素，违背克制初衷。

→ 沉淀为 memory: `feedback_composer_invisible_until_hover.md`

### 2. Run 状态聚合：4 chips → 1 Popover

#### 改造前

底部右侧 4 个独立可点 chip + 1 个独立 ContextUsageIndicator HoverCard：

```
[⚡ Claude Code] [📌 已固定] [⚠ 健康] [○ 16%]   [上下文 hover card]
```

每个跳到不同设置页（`/settings#runtime` / `#models` / `#health`），用户得自己拼"这次会怎么跑"。

#### 改造后

一个紧凑状态文本行 + 整行作为 Popover 触发器：

```
Claude Code · 已固定 · 16%
```

点击展开 `RunStatusPanel`：5 行只读状态（引擎 / 模型 / 默认 / 权限 / 上下文）+ 异常区。每行右侧有"设置 / 切换 / 修改"次级链接（默认 `text-muted-foreground/40`，hover row 才升到 `muted-foreground`）跳到对应设置页。**面板本身不写状态**，纯解释 + 转跳。

```
ChatComposerActionBar
└── right slot
    └── RunCockpit
        ├── 状态文本行（PopoverTrigger，asChild 包 Button）
        └── PopoverContent (w-80)
            └── RunStatusPanel
                ├── 引擎          Claude Code            设置 ↗
                ├── 模型          GLM · glm-4.5          切换 ↗
                ├── 默认          Auto / 已固定          修改 ↗
                ├── 权限          默认权限 / 完全访问
                ├── 上下文        31.2K / 200K tokens · 16%
                └── 需要处理（仅当有异常）
```

#### Severity 计算

`RunCockpit.tsx` 的 `severity` 复用 `Settings → Health` 的 rollup 规则，确保两个表面永远一致：

```ts
if (state.providersConfigured === 0) return "error";
if (state.modelsEnabled === 0) return "error";
if (state.noCompatibleProvider) return "error";
if (state.defaultInvalid) return "error";
if (runtimeFallback) return "error";
if (claudeStatus.warnings.length > 0) return "warn";
if (state.agentRuntime === "claude-code-sdk" && !state.cliEnabled) return "warn";
if (!state.workspaceConfigured) return "warn";
return "ok";
```

#### 状态行 segment 规则

- 始终包含: 引擎 label
- `runtimeFallback` 时追加: "已自动降级"
- `modeIsPinned` 时追加: "已固定" 或 "已固定 · 不可执行"
- `usage.hasData` 时追加上下文：
  - 容量已知 → `${pct}%`
  - 容量未知 → `上下文 ${used}K`（前缀避免裸数字让人困惑）
- 异常态前面贴 `Warning` 图标 + 警告色

### 3. ai-elements 整合

#### Context 组件（新装）

`npx ai-elements@latest add context` 装入 `src/components/ai-elements/context.tsx`，替换原来自写的 ContextUsageIndicator。

`ContextUsageIndicator.tsx` 现在是薄壳：
- 调用 `useContextUsage` hook 拿到 used/cache/output/contextWindow
- 容量已知 → 用 ai-elements `Context` + `ContextTrigger` + `ContextContent` 渲染（带 token breakdown + cost via `tokenlens`）
- 容量未知 → 自渲染一个 `HoverCard`（避免 `Context` 的 `usedTokens / 0 = Infinity` 渲染成 ∞%）

#### PromptInput canonical 结构（已有但用错）

之前 `MessageInput.tsx` 把附件 / slash / CLI 做成三个独立按钮：

```tsx
<PromptInputTools>
  <AttachFileButton />
  <SlashCommandButton onInsertSlash={...} />
  <Tooltip>...<PromptInputButton><Terminal /></PromptInputButton></Tooltip>
</PromptInputTools>
```

改成 ai-elements canonical 的 `PromptInputActionMenu` 套件：

```tsx
<PromptInputActionMenu>
  <PromptInputActionMenuTrigger tooltip="添加上下文或命令" />
  <PromptInputActionMenuContent>
    <PromptInputActionAddAttachments label="添加文件上下文" />
    <PromptInputActionMenuItem onSelect={slashCommands.handleInsertSlash}>
      <Lightning /> 插入命令
    </PromptInputActionMenuItem>
    <PromptInputActionMenuItem onSelect={cliToolsFetch.handleOpenCliPopover}>
      <Terminal /> 调用 CLI 工具
    </PromptInputActionMenuItem>
  </PromptInputActionMenuContent>
</PromptInputActionMenu>
```

伴随删除：
- `SlashCommandButton.tsx`（整个文件）
- `MessageInputParts.tsx` 里的 `AttachFileButton`

#### Message bubble 去深色

`ai-elements/message.tsx` 的 `MessageContent` 原本对用户气泡用了 `is-user:dark` 触发暗色主题反转：

```tsx
// 改造前
"is-user:dark ... group-[.is-user]:bg-(--user-bubble) group-[.is-user]:text-(--user-bubble-foreground)"
```

`--user-bubble` 在浅色模式被设成 `oklch(0.22 0.005 250)`（接近黑），气泡反过来变成深底白字。改成：

```tsx
// 改造后
"... group-[.is-user]:rounded-2xl group-[.is-user]:bg-muted group-[.is-user]:text-foreground"
```

直接走 `bg-muted` 浅灰 + 默认文字色 + `rounded-2xl`（24px 跟输入框对齐）+ `break-words`。

`MessageItem.tsx` 长消息收起渐变同步从 `from-secondary` 改为 `from-muted` 匹配新底色。

`--user-bubble` / `--user-bubble-foreground` CSS 变量保留但实际不再被引用。

### 4. 隐形 Select 模式

`ModeIndicator` / `ChatPermissionSelector` 触发器不用按钮形态——默认无边框无背景，`hover:bg-accent` 才显形。

实现都通过项目自有的 `<Button variant="ghost" size="xs">` + className 覆盖，继承 luma button 的 focus ring / disabled / `active:translate-y-px`：

```tsx
<DropdownMenuTrigger asChild>
  <Button
    variant="ghost"
    size="xs"
    className="h-7 rounded-md text-xs font-normal text-muted-foreground"
    // (full_access / pinned-invalid 状态加 status-pair chip className)
  >
    <Icon size={12} />
    <span>{label}</span>
    <CaretDown size={10} className="opacity-60" />
  </Button>
</DropdownMenuTrigger>
```

### 5. 弹窗底座统一

所有 composer 弹窗（@ 文件、斜杠命令、CLI 工具、模型选择器）共用 `patterns/CommandList.tsx`：

- 容器：`rounded-2xl border bg-popover shadow-[var(--shadow-diffuse)]`，跟输入框同款圆角和柔光阴影
- Item：`rounded-md mx-1 py-2`，hover/active 都是 `bg-accent text-foreground`（不再是 `bg-accent text-accent-foreground` 的强对比"列表选中态"）
- Group：分组靠 **加粗的标题（`text-xs font-semibold text-foreground`）+ 12px 上方间距** 区分，**不再用横向分割线**

弹窗一致性整改对应：
- 删 `CommandListSearch`（搜索框）— 用户认为搜索没必要
- 删 `CommandListFooter`（"管理快捷方式"等）
- 模型选择器顶部 Runtime 提示从 30+ 字精简到 "仅显示当前 Agent 引擎可用的模型"

### 6. 弥散阴影 token

`globals.css` 新增 `--shadow-diffuse`：

```css
:root {
  --shadow-diffuse: 0 12px 40px -8px rgba(0, 0, 0, 0.10), 0 4px 12px -4px rgba(0, 0, 0, 0.04);
}
.dark {
  --shadow-diffuse: 0 12px 40px -8px rgba(0, 0, 0, 0.45), 0 4px 12px -4px rgba(0, 0, 0, 0.25);
}
```

应用到：
- `MessageInput.tsx` 输入框：`[&_[data-slot=input-group]]:shadow-[var(--shadow-diffuse)]`
- `CommandList.tsx` 弹窗

负 spread (`-8px` / `-4px`) 让阴影边界羽化，避免 `shadow-sm` / `shadow-lg` 的硬切感。

### 7. 顶部栏

`UnifiedTopBar.tsx` 删了三处：
- 编辑标题的笔图标 + 点击编辑流程
- 标题与工作目录之间的 `/` 反斜杠（改用 `gap-2` 间距）

新增「...」更多操作菜单（在工作目录右侧），跟左侧 chat list 行的 「...」 菜单完全一致：分屏 / 重命名对话 / 复制对话 ID / 删除对话。

`useSplit()` hook 复用，重命名走 `PromptDialog`（跟 sidebar 一致），删除走原生 `confirm()`（跟 sidebar 一致，避免引入新 UI 组件）。

### 8. 左侧栏密度

每行从 `h-9 (36px)` → `h-8 (32px)`，行间 `gap-0.5 (2px)` → 0；项目和助理两 section 之间从 24px 累加空白 → 8px 自然呼吸。Section 内部 padding 也收紧。

参考线：Codex / ChatGPT / Cursor 同类应用 sidebar 行高 28-32px 是密度区。

## 数据流

### Run 状态聚合所需的数据来源

```
RunCockpit (props)
├── providerId            ← ChatView / chat-page state
├── messages, modelName,  ← ChatView state
│   context1m, hasSummary,
│   upstreamModelId,
│   contextUsageSnapshot
├── permissionProfile     ← ChatView state
└── 内部 hook
    ├── useOverviewData() ← Settings 同源（providers/models/runtime/default/health）
    ├── useClaudeStatus() ← CLI 心跳
    └── useContextUsage() ← messages × modelName × snapshot 算 used/ratio
```

`ChatComposerActionBar.right` 只渲染 `<RunCockpit ...>` 一个组件。原来单独的 `<ContextUsageIndicator />` 不再渲染（其内容并入 RunCockpit 的状态行 + 面板）。

但 `ContextUsageIndicator.tsx` 文件仍保留 — 它现在是 RunCockpit 没用上的老组件，作为 fallback API（如果将来需要单独显示上下文圆环可以接回）。

### 最近使用模型

`ModelSelectorDropdown.tsx` 维护 `localStorage` key `codepilot:recent-models`：

- 写入：`handleModelSelect()` 触发，每次切模型 push 一条 `{ providerId, modelValue, ts }`，去重保留最多 8 条
- 读取：dropdown 打开时 `useMemo` 跟当前 `providerGroups` 求交集，过滤掉无效项，取前 3 项渲染在顶部"最近使用"分组
- 无记录时分组完全不渲染（连标题都不出现）

### 加载态显式化

之前 `composer` / `model selector` / `RunCockpit` 在数据未到时是空白 + disabled，看起来"页面卡住"。现在三处都显式渲染加载文案：
- `MessageInput` placeholder：`正在准备运行环境...`（条件：`fetchState === 'idle'`）
- `ModelSelectorDropdown` 触发器：`模型加载中...`（条件：`isLoading || !currentModelOption`）
- `RunCockpit`：`运行状态加载中...`（条件：`state.loading`，原来 `return null`）

## i18n 新增 key（zh + en 同步）

```
messageInput.modeCodeDesc, messageInput.modePlanDesc
messageInput.placeholderDefault / placeholderWithBadges / placeholderCli / placeholderLoading
messageInput.actionMenuTooltip / actionAddContext / actionInsertCommand / actionCallCli
messageInput.submitAriaLabel
chatList.moreActions
context.unknownCapacity / unknownCapacityHint
runStatus.title / runtime / model / defaultMode / permission / context
runStatus.issuesHeader / settings / switch / modify / fixIssue
runStatus.modePinned / modePinnedInvalid / modeAuto
runStatus.permissionDefault / permissionFullAccess
runStatus.runtimeFallback / loading / contextPrefix / notConfigured / triggerLabel
permission.defaultDesc / fullAccessDesc
composer.recentModels / modelLoading
```

## 删除的代码

- `src/components/chat/SlashCommandButton.tsx`（整个文件）
- `src/components/chat/MessageInputParts.tsx` 里的 `AttachFileButton` 函数
- `src/components/chat/ImageGenToggle.tsx`（"设计 Agent" 按钮，本轮初期已删）

## 弃用但保留的

- `src/components/chat/ContextUsageIndicator.tsx`：不再被 chat 页直接渲染（内容并入 RunStatusPanel），但文件保留作为 fallback API
- `globals.css` 的 `--user-bubble` / `--user-bubble-foreground` CSS 变量：用户气泡不再引用，保留以防其它地方将来需要

## 已知遗留 / 后续观察项

| 项 | 严重度 | 说明 |
|---|---|---|
| 路由级 spinner | P3 | `/chat/[id]` 段刷新后约 1s 路由级 spinner，然后才进入 composer 加载态。要消掉得动 `loading.tsx` 或换 streaming 策略 |
| Run 面板链接 40% opacity | P3 | 浅色背景下接近 disabled 观感，可能让用户找不到入口。先观察反馈 |
| 输入框 overflow-hidden 反复 | — | 原本想用来裁滚动条出圆角的 `overflow-hidden` 会切到模型选择器浮层，已撤销。功能 > 视觉 |
| `--user-bubble` CSS 变量死代码 | P4 | 留着不影响功能，将来清理 |

## 下一阶段

Context Chips（文件树 → composer 显式上下文）。见 `docs/exec-plans/active/context-chips-phase-1.md`。

## 反向引用 / 相关 memory

- `feedback_composer_invisible_until_hover.md` — 三层视觉规则的经典案例 + memory 里有完整溯源
- `feedback_describe_in_user_terms.md` — 跟用户讨论 UI 改动时只用界面语言不用代码符号
- `feedback_pinned_default_hard_promise.md` — Pinned 在 invalid 状态下必须醒目阻断，是 status-pair chip 保留的来源
