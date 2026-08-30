# Workspace Sidebar Tabs

> 创建时间：2026-04-29
> 最后更新：2026-04-30（Phase 2 完成）
> **Superseded breadcrumb（2026-08-25）**：本文记录的“独立 FileTree rail + Workspace Sidebar”与 Files pin 形态已由 Active index 中的 `workspace-surface-sidebar-pin-and-inspector.md` 取代。当前是一个 shell 内的 Files Primary + Preview Inspector；历史动机保留，不再作为现行验收合同。

## Phase 2 完成后的实际形态（2026-04-30）

**右侧栏组成**
- `<WorkspaceSidebar>` — 统一 Tab 容器
  - 固定 Tab：Git、Widget（不可关闭）
  - 动态 Tab：Markdown Preview / Artifact / 文件 / 代码预览，按 path / artifactId 复用同一 Tab
  - Files Tab：可选 pin，仅在用户从轻量文件树点 PushPin 时创建；可关闭，可重新 pin
- `<PanelZone>` — 仅承载 **FileTreePanel + AssistantPanel**；Git / Widget / Preview 原有渲染路径已删，由 Workspace Sidebar 接管

**Topbar 入口**
- 文件树独立按钮（点击开/关轻量 FileTreePanel）
- Workspace Sidebar 按钮（点击开/关侧栏 shell）
- 两者打开状态互斥：开任一关另一，避免双右栏挤压 Chat

**已删除**
- `gitPanelOpen` / `dashboardPanelOpen` / `previewOpen` state + `PanelContext` 暴露
- `GitPanelContainer` legacy export
- `DashboardPanel.embedded` prop（一直 true 形态）
- `PreviewPanel.variant` 行为分支（一直 sidebar 形态；param 保留以保持调用点签名）
- AppShell 的 legacy `setPreviewOpen(true)` 路径

**保留**
- 文件树独立 topbar 入口
- AssistantPanel 独立通道
- Terminal 抽屉（旧代码，不在本期范围）

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | IA 决策与现有入口盘点 | ✅ 已记录 | 本文先锁产品边界，不立即重写 Git / Widget 内部 |
| Phase 1 | 右侧栏 Shell + 固定 Tab + 动态 Tab 入口 + 文件树双形态 + 顶栏收敛 | ✅ 已完成 2026-04-29 | 一次性交付（用户要求一次性搞定）。Git / Widget 固定不可关闭；Markdown / Artifact / 文件预览按 key 复用；Files Tab 按 pin 出现；顶栏 3 toggle → 1 toggle。CDP 验证留给用户检查。 |
| Phase 2 | 清理 PanelZone 里的 Git / Widget / Preview 旧通道 + 终端复审 | ✅ 已完成 2026-04-30 | 删 PanelZone Git/Widget/Preview 通道；删 GitPanelContainer + DashboardPanel 的 embedded prop + PreviewPanel 的 variant prop（legacy 模式不可达）；AppShell 的 gitPanelOpen / dashboardPanelOpen / previewOpen state 移除；chat/[id] default_panel 设置 'git'/'dashboard' 改为开 sidebar 对应 Tab。**保留**文件树独立 topbar 入口；**保留** PanelZone 用于挂 FileTreePanel + AssistantPanel；**不删**文件树入口。 |

## 决策日志

- 2026-04-29: **Git / Widget / Markdown / Artifact 统一收进右侧工作区侧栏。** 它们都是当前工作区的辅助表面，不应在右上角长期占多个入口。Chat 继续作为主舞台；右侧栏像浏览器标签页一样管理辅助工具与预览。
- 2026-04-29: **文件树不默认并入右侧栏。** 文件树是项目导航基础设施，使用频率高且常是临时动作；默认保留轻量入口，避免每次打开都占据大面板。用户需要持续查看文件结构时，可以 pin 成右侧栏的 Files Tab。
- 2026-04-29: **打开文件不等于打开文件树。** 文件树用于导航和添加上下文；点击 Markdown / Artifact / 代码预览时应打开对应动态 Tab，复用同一路径已有 Tab，不强制让文件树常驻。
- 2026-04-29 Phase 1 实现：**PanelZone 共存策略**——保留旧 PanelZone 但顶栏不再点亮其 Git / Widget toggle，只剩 PreviewPanel 在非 chat-detail 路由作 fallback。Phase 2 再删旧通道，回滚成本最低。
- 2026-04-29 Phase 1 实现：**Terminal 不进 Tab**——用户确认终端"是旧代码、不是真功能"，本期不动。
- 2026-04-29 Phase 1 实现：**`setPreviewSource → window.dispatchEvent('workspace-tab-open-request')`**——AppShell 在 chat-detail 路由不再触发 `setPreviewOpen(true)`，改为发事件，避免新旧两套 PreviewPanel 同时渲染。WorkspaceSidebarProvider 监听并把事件 detail 通过 `tabFromPreviewSource()` 转成 Tab。
- **2026-04-30 Phase 2 交付**：按修订边界完成 PanelZone 清理。
  - **PanelZone**：删除 Git / Widget / Preview 三个分支；只保留 FileTreePanel + AssistantPanel
  - **AppShell**：移除 `gitPanelOpen` / `dashboardPanelOpen` / `previewOpen` state 和 PanelContext 暴露；`setPreviewSource` 在 chat-detail 路由只派 `workspace-tab-open-request` 事件，不再尝试开 legacy panel（legacy 没了）
  - **PanelContext type** (`hooks/usePanel.ts`)：`PanelContextValue` 移除上述三对 setter / getter
  - **chat/[id]/page.tsx**：`default_panel` 设置 `'git'` / `'dashboard'` 现在改为 `ws.setActiveTab('git'|'widget')` 开 sidebar 对应 Tab；`'file_tree'` 和 `'none'` 行为不变
  - **GitPanel.tsx**：删除 `GitPanelContainer` legacy export；只剩 `GitTabContent`
  - **DashboardPanel.tsx**：移除 `embedded` prop（一直是 true 形态）；`WidgetTabContent` 直接 alias 到 `DashboardPanel`
  - **PreviewPanel.tsx**：移除 `variant` prop（一直是 sidebar 形态）；删除 `handleClose` 和 legacy ResizeHandle/width chrome；`Outer` 函数收成单分支
  - **ChatView.tsx**：从 `usePanel()` 解构里删掉空挂的 `setDashboardPanelOpen`
  - **新增 unit 测试**：3 用例锁定 Files Tab 是 opt-in only（initialState 不含 / 仅 openDynamicTab 创建 / 重复 open 不复制）
  - 不动 Terminal、AssistantPanel、文件树独立入口
- **2026-04-30 Phase 2 边界修订**：放弃"右上角只剩一个侧栏入口"目标。新边界：
  - 文件树是高频确定性工具，**保留独立 topbar 入口**（轻量面板）
  - Workspace Sidebar 承接 Git / Widget / Markdown Preview / Artifact / 文件代码预览这类工作表面
  - 两者**互斥打开**：开任一关另一，避免双右栏挤压 Chat
  - 点文件树按钮**总是优先开/关轻量文件树**，不会强切到 Files Tab
  - Files Tab 只是**可选 pin 能力**，用户在文件树面板里点 PushPin 才出现；不默认存在
  - Phase 2 清理重点是 PanelZone 里的 **Git / Widget / Preview 旧 Container**，**不要删文件树入口**
  - UnifiedTopBar 文件树按钮：删掉了"sidebar 已开时切到 Files Tab"的 pivot 逻辑，改回单纯 toggle 轻量文件树 + 互斥关 sidebar

## 产品原则

1. **Chat 是主舞台。** 侧栏只承接辅助工作表面，不把用户从对话流里拉走。
2. **入口按工具类别收敛，不强求"右上角只剩一个入口"。**（2026-04-30 修订）原计划想把 Git / Widget / Preview / Artifact / 文件树全部塞进同一个侧栏入口，实际跑下来发现文件树是高频确定性工具，跟 AI 工作表面（Git / Widget / Markdown Preview / Artifact / 文件预览）的使用频率和场景都不一样。新边界：**文件树独立成一个 topbar 入口；Workspace Sidebar 承接 AI 工作表面的入口**。两者共存为两个按钮，但开启状态互斥（避免双右栏挤压 Chat）。
3. **确定性工具要清楚。** Git 和文件树属于非 AI 的确定性工具，状态和动作要明确——文件树继续以独立轻量入口存在，Git 进 Workspace Sidebar 的固定 Tab。
4. **AI 产物要可持续管理。** Markdown Preview、Artifact、代码预览是动态工作对象，应该像浏览器 Tab 一样可切换、可关闭、可复用。
5. **文件树是导航入口，不是默认工作面板。** 默认轻量打开（独立 topbar 按钮）；Files Tab 只是**可选 pin 能力**，用户在文件树面板里主动点 PushPin 才出现，不是默认形态；点击文件树按钮总是优先开/关轻量文件树，不会把用户强制带到 Files Tab。

## 目标形态

### 右侧栏 Shell

- 支持展开 / 收起 / resize。
- 收起后保留一个轻量入口按钮。
- 顶部是 Tab bar，分为固定 Tab 和动态 Tab。
- 侧栏状态按 workspace/session 作用域保存，避免跨项目串场。

### 固定 Tab

| Tab | 规则 |
|-----|------|
| Git | 固定存在，不可关闭；迁移现有 Git 面板，不重写业务能力 |
| Widget | 固定存在，不可关闭；迁移现有 Widget / Dashboard surface，不重写渲染系统 |

### 动态 Tab

| 来源 | 打开规则 |
|------|----------|
| Markdown Preview | 打开 `.md/.mdx` 时创建或复用同 path Tab |
| Artifact | 从聊天 Artifact 卡片打开；同 artifact id 复用 |
| 文件 / 代码预览 | 从文件树或消息引用打开；同 path 复用 |
| Files | **可选 pin 能力**——用户在轻量文件树面板里主动点 PushPin 才创建。不会因为点了顶栏文件树按钮而出现，也不默认存在。可关闭。关闭后再点 PushPin 可重新创建。 |

## 文件树双形态

### 默认轻量入口

- 保留现有文件树入口，不强制占用右侧栏大区域。
- 适合快速找文件、添加上下文、打开预览。
- 文件 / 目录行仍保留「添加到对话」能力。

### Pin 到右侧栏

- 文件树面板内提供「固定到侧栏」动作。
- 固定后出现 `Files` Tab，可与 Git / Widget / Preview 并列。
- 关闭 Files Tab 不影响文件树轻量入口。

## 第一阶段实施范围

1. 新建 WorkspaceSidebar shell 与 Tab 状态模型。
2. 把现有 Git / Widget 迁移为固定 Tab，保持内部功能不变。
3. 把现有 Preview / Artifact 打开动作改为创建动态 Tab。
4. 顶栏入口收敛到一个「侧边栏」按钮，减少右上角分散图标。
5. 文件树暂保留现有轻量入口，只加「Pin to sidebar」占位或最小实现。

### Phase 1 交付（2026-04-29）

**新文件**
- `src/lib/workspace-sidebar.ts` — pure 状态模型 + `tabFromPreviewSource()` 桥接
- `src/hooks/useWorkspaceSidebar.tsx` — Provider + `WORKSPACE_TAB_OPEN_EVENT` 监听
- `src/components/layout/WorkspaceSidebar/{index,TabBar,TabPanel}.tsx` — Shell / Tab 条 / 内容路由
- `src/__tests__/unit/workspace-sidebar.test.ts` — 19 用例覆盖 Tab 生命周期 + 持久化

**改动文件（业务零变更）**
- `src/components/layout/AppShell.tsx` — 包 Provider；chat-detail 路由 `setPreviewSource` 改派事件而非 `setPreviewOpen(true)`；同时挂 `<WorkspaceSidebar>` + `<PanelZone>`（共存）
- `src/components/layout/UnifiedTopBar.tsx` — 删 Git / Dashboard 三 toggle；新增单一 sidebar toggle；branch label 改为 click-to-jump-to-Git-Tab
- `src/components/layout/panels/GitPanel.tsx` — 拆 `GitTabContent`（embedded）+ legacy `GitPanelContainer`
- `src/components/layout/panels/DashboardPanel.tsx` — 加 `embedded` prop + `WidgetTabContent` export
- `src/components/layout/panels/FileTreePanel.tsx` — 头部加 PushPin → `openTab({kind:'files-pinned'})`
- `src/i18n/{en,zh}.ts` — `workspaceSidebar.{toggle, collapse, tab.{git,widget,files}, closeTab, pinFiles}` 7 键

**关键约束已落实**
- ✅ Shell 支持展开 / 收起 / resize（min 320 / max 800 / default 480 px）
- ✅ Tab 状态按 `workspace::cwd::sessionId` 作用域持久化到 localStorage
- ✅ Git / Widget 固定不可关闭（pure helper `closeTab` 对 fixed Tab no-op + 单测锁定）
- ✅ Markdown / Artifact / 文件预览按 key 复用
- ✅ 文件树仍保留轻量入口；pin 后 Files Tab 出现，可关闭
- ✅ 顶栏 3 toggle → 1 toggle + branch label
- ✅ `npm run test` 1324 / 1324 通过

## 暂不做

- 不重写 Git 业务逻辑。
- 不重写 Widget 渲染、安全沙箱或 Dashboard store。
- 不做完整浏览器标签能力：不做拖拽排序、多窗口、Tab 分组。
- 不把文件树默认常驻侧栏。
- 不改变 Context Chips / MessageInput 的添加上下文协议。

## 验收标准（按 2026-04-30 修订边界更新）

- Chat 页右上角入口按工具类别收敛：**文件树独立按钮 + Workspace Sidebar 按钮**，不再有 Git / Widget / Preview / Artifact 各自的常驻图标。
- 文件树按钮和 Workspace Sidebar 按钮**互斥打开**——一个开自动关另一个，永远不会两个右栏同时挤 Chat。
- 点文件树按钮**总是开/关轻量文件树**，不会跳到 Files Tab。
- Files Tab 只在用户主动点轻量文件树面板里的 PushPin 时出现，可关闭；关闭后再点 PushPin 可重建。
- Git / Widget 在 Workspace Sidebar 固定 Tab 内可用，原功能不回退。
- 打开同一个 Markdown / Artifact / 文件预览不会重复创建 Tab；切回旧 Tab 内容能正确恢复。
- 侧栏展开、收起、resize 在桌面宽度下无布局挤压；窄屏有降级策略。
- CDP 验证：打开 / 收起侧栏、切换固定 Tab、打开动态 Tab、关闭动态 Tab、文件树轻量入口、pin Files、互斥行为。
