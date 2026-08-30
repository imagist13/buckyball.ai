# Git 集成 + 终端 + 统一布局重构

> 完成时间：2026-03-13 | 涉及 ~50 个文件 | 5 阶段交付

## 概述

将 CodePilot 从纯聊天界面升级为轻量桌面聊天工作区：新增独立 Git 功能面板、交互式终端抽屉、统一顶栏，并将布局从左右面板模型重构为四层纵向架构。

## 布局架构

```
┌───────────────────────────────────────────────────────────────┐
│ UnifiedTopBar (固定顶栏, Electron drag, h-12)                  │
├───────────────────────────────────────────┬───────────────────┤
│                                           │ PanelZone (右侧)  │
│ Chat Main Area                            │ Preview | Git |   │
│ (flex-1, overflow-hidden)                 │ FileTree          │
│                                           │ (各面板独立开关)    │
├───────────────────────────────────────────┴───────────────────┤
│ TerminalDrawer (底部抽屉, 默认隐藏, 可 resize)                  │
└───────────────────────────────────────────────────────────────┘
```

关键布局决策：
- PanelZone 在聊天区**右侧**（非上方），因为上方展开会压缩聊天区高度，体验不佳
- 面板固定顺序：Preview | Git | FileTree（从左到右）
- 每个面板独立开关，可同时打开多个
- 所有面板支持拖动调整宽度，统一使用 `ResizeHandle` 组件

## 状态模型

### PanelContext (`src/hooks/usePanel.ts`)

废弃旧的 `panelOpen` / `panelContent` 单面板模型，改为独立布尔状态：

```
fileTreeOpen / setFileTreeOpen    — 文件树面板
gitPanelOpen / setGitPanelOpen    — Git 面板
previewOpen / setPreviewOpen      — 文件预览面板
terminalOpen / setTerminalOpen    — 终端抽屉
currentBranch / setCurrentBranch  — 当前分支名（供顶栏显示）
gitDirtyCount / setGitDirtyCount  — 已跟踪变更数（不含 untracked）
```

`currentBranch` 和 `gitDirtyCount` 由 `AppShell` 中的 `useGitStatus` hook 驱动，不依赖 Git 面板是否打开。

### 跨组件通信

使用 CustomEvent 进行松耦合通信：

| 事件名 | 触发方 | 监听方 | 用途 |
|--------|--------|--------|------|
| `git-refresh` | CommitDialog, GitPanelContainer refresh 按钮 | useGitStatus, GitHistorySection | 提交/推送后刷新 Git 状态 |
| `session-updated` | UnifiedTopBar 标题编辑 | ChatListPanel | 会话标题变更同步到列表 |
| `attach-file-to-chat` | FileTreePanel | MessageInput | 文件树中添加文件到聊天 |

## 统一顶栏 (`UnifiedTopBar.tsx`)

```
[聊天标题 ✏️] / [项目文件夹名]     [提交全部 ▾] [Git main · N] [终端] [文件树]
```

- 左侧：聊天标题（可编辑，铅笔图标常显）+ 斜杠 + 项目文件夹名（可点击打开）
- 右侧按钮顺序：提交全部（带下拉含推送选项）→ Git（含分支名+脏文件数）→ 终端 → 文件树
- 按钮图标默认 `text-muted-foreground`，hover 变 `text-foreground`，激活态用 `variant="secondary"`
- 提交按钮用 `border border-border` 描边，文字和图标用正常前景色
- 仅在 `/chat/[id]` 路由显示操作按钮，`/chat` 空页面不显示
- Electron 拖拽区：整个顶栏 `WebkitAppRegion: drag`，交互区域设为 `no-drag`

## Git 后端 (`src/lib/git/service.ts`)

所有函数接收 `cwd` 参数，通过 `execFile` 执行（非 `exec`，防 shell 注入）：

| 函数 | 超时 | 说明 |
|------|------|------|
| `isGitRepo` | 5s | `rev-parse --is-inside-work-tree` |
| `getRepoRoot` | 5s | `rev-parse --show-toplevel` |
| `getStatus` | 10s | porcelain v2 解析，分离 tracked/untracked |
| `getBranches` | 10s | `-a` 列出所有分支，**用 `git branch`（不带 -a）获取本地分支列表来区分 local/remote** |
| `checkout` | 15s | 检查 dirty 状态后切换 |
| `getLog` | 10s | 自定义分隔符格式化输出 |
| `commit` | 30s | `add -A` → `diff --cached --quiet` 检查 → `commit` |
| `push` | 30s | 自动 `set-upstream` 如果需要 |
| `getWorktrees` | 10s | porcelain 解析 + **逐个 worktree 检查 dirty 状态** |
| `deriveWorktree` | 30s | `worktree add -b` |

### 已修复的问题

1. **分支 `/` 误判**：`feat/xxx` 这类本地分支名曾被 `includes('/')` 误标为 remote。修复方案：先用 `git branch`（无 `-a`）获取本地分支名集合，只有不在本地集合中的才标 `isRemote`。
2. **Commit diff 检测**：`git diff --cached --quiet` exit 1 = 有变更，`runGit` 会 reject。原始逻辑正确地 catch 并继续；如有真实错误（如索引损坏），后续 `git commit` 会给出正确报错。
3. **Worktree dirty 状态**：不再硬编码 `false`，改为对每个非 bare worktree 执行 `git status --porcelain --untracked-files=no`。

## Git 前端面板

### 组件层次

```
panels/GitPanel.tsx (GitPanelContainer)
  ├── ResizeHandle (left side, 280-600px)
  ├── Header: 标题 + 刷新按钮 + 关闭按钮
  └── git/GitPanel.tsx (业务容器, 4 个可折叠区块)
        ├── GitStatusSection    — 分支 + upstream + ahead/behind + 变更文件列表
        ├── GitBranchSelector   — 分支切换（dirty 时禁用，worktree 占用时标注）
        ├── GitHistorySection   — 提交历史（订阅 git-refresh 事件）
        └── GitWorktreeSection  — 工作树列表 + 切换 + 派生
```

### 变更文件列表

- 已跟踪变更（M/A/D/R）排前面，untracked 文件单独一组
- 顶栏脏文件计数只统计已跟踪变更，不含 untracked
- 无变更时显示"所有更改都已提交"

### 提交流程

1. 顶栏"提交全部"按钮 → 打开 `CommitDialog`
2. Dialog 提供两个 radio 选项：仅提交 / 提交并推送
3. 提交成功后触发 `git-refresh` 事件，所有 Git 相关组件刷新
4. 推送通过 dropdown 也可以单独触发

### Worktree 操作

- 列表显示 current 标识（高亮 + badge）和 dirty 指示器
- "切换到工作树"按钮：先查 `/api/chat/sessions/by-cwd` 找现有 session，没有则 POST 创建新 session，然后 `router.push`
- "派生新工作树"：创建 git worktree + 创建新 DB session（继承源 session 的 model/mode/provider 等），自动跳转

### 分支切换错误处理

`handleCheckout` 在 `res.ok === false` 时抛异常 → `GitBranchSelector` catch 后设置 `localError`，分支列表保持展开不收起。

## 终端 (`electron/terminal-manager.ts`)

### 当前实现（Phase 4 v1）

使用 `child_process.spawn` + `stdio: 'pipe'`，**不是真正的 PTY**。已知限制：
- `resize()` 是 no-op
- 全屏程序（vim, htop）无法正常渲染
- readline 行编辑受限

### 升级到 node-pty 的步骤

1. `npm install node-pty`
2. `scripts/after-pack.js`：rebuild 列表添加 `node-pty`
3. `electron-builder.yml`：asarUnpack 添加 `"**/node-pty/**"`
4. `scripts/build-electron.mjs`：esbuild externals 添加 `node-pty`
5. `terminal-manager.ts`：`spawn` → `pty.spawn`，实现 `resize()`

### 前端组件

- `TerminalDrawer.tsx`：底部抽屉，可 resize 高度
- `TerminalInstance.tsx`：连接 Electron IPC，管理生命周期
- 快捷键 `Ctrl+`` / `Cmd+`` 切换终端

## Resize Handle 统一

所有可拖动宽度的面板统一使用 `ResizeHandle` 组件（`src/components/layout/ResizeHandle.tsx`）：

| 使用方 | side | 宽度范围 | 默认宽度 |
|--------|------|----------|----------|
| ChatListPanel | right | — | — |
| PreviewPanel | left | 320-800px | 480px |
| GitPanelContainer | left | 280-600px | 360px |
| FileTreePanel | left | 220-500px | 280px |

右侧面板的 handle 在 left side，拖动方向：左拖 = 变宽（`w - delta`）。

## API 路由

| 路由 | 方法 | 用途 |
|------|------|------|
| `/api/git/status` | GET | Git 状态（branch, dirty, changedFiles） |
| `/api/git/branches` | GET | 分支列表 |
| `/api/git/checkout` | POST | 切换分支 |
| `/api/git/log` | GET | 提交历史 |
| `/api/git/commit` | POST | 提交（add -A + commit） |
| `/api/git/push` | POST | 推送 |
| `/api/git/commit-detail/[sha]` | GET | 提交详情 + diff |
| `/api/git/worktrees` | GET | 工作树列表 |
| `/api/git/worktrees/derive` | POST | 派生工作树 + 创建 session |
| `/api/chat/sessions/by-cwd` | GET | 按 working_directory 查找 session |

## 已废弃的文件

- `src/components/layout/RightPanel.tsx` — 由 PanelZone + panels/ 替代
- `src/components/layout/Header.tsx` — 由 UnifiedTopBar 替代
- `src/components/layout/DocPreview.tsx` — 由 panels/PreviewPanel.tsx 替代

## 已知技术债务

1. **终端不是 PTY**：见上文升级步骤，需要 native module 编译支持
2. **Git 面板无 staging UI**：当前 commit 直接 `git add -A`，无法选择性 stage/unstage
3. **Worktree 无删除功能**：只有列表和派生，没有 `git worktree remove`
4. **Git 轮询间隔固定 10s**：未做 WebSocket 或 file watcher 优化

## i18n 键

新增键前缀：`topBar.*`（~8 键）、`git.*`（~40 键）、`terminal.*`（~5 键）。分布在 `src/i18n/en.ts` 和 `zh.ts` 中。
