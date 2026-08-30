> **Archive note（2026-06-05，document-system-governance）**：本计划已移出 `active/`，归入 `deferred/`——用户明确暂缓，未来可能重启。**不是当前任务入口**；当前工作入口见 [exec-plans README](../README.md)，重启方式见 [deferred/README.md](README.md)。

# Git + 终端集成规划

> ⏸ **本轮重构暂缓**（见 [refactor-closeout.md](../completed/refactor-closeout.md) "暂缓清单"）— 终端会话层 / git 工作区状态层不在本轮 6 条主线内；保留作长期参考。

> 创建时间：2026-03-12
> 最后更新：2026-03-12
> 参考基线：Codex `main@917c2df`（本地参考副本：`/tmp/codex-main-latest`）

## 状态

| Area | 目标 | 状态 | 备注 |
|------|------|------|------|
| Terminal | 独立终端会话层 | 📋 待开始 | 参考 Codex `command/exec` 语义 |
| Git | 工作区 git 状态层 | 📋 待开始 | 先做只读，再做变更操作 |
| Approval | 终端 / git 统一审批 | 📋 待开始 | 复用现有 permission 机制 |
| UI | 底部终端面板 + repo 状态栏 | 📋 待开始 | 尽量不打断现有聊天主链路 |

## 目标

- 让 CodePilot 拥有类似 Codex 的“可观察、可控制、可审批”的终端执行层，而不是只显示 Claude SDK 工具输出。
- 让 git 从“用户自己在外部终端运行命令”升级为应用内的一等工作区状态服务。
- 保持现有桌面聊天主链路稳定：`remote disabled = current desktop behavior unchanged`。

## 非目标

- 第一阶段不做完整 IDE 式 Source Control 面板。
- 第一阶段不做复杂 git 流程 UI，如 rebase、cherry-pick、conflict editor。
- 第一阶段不重写现有 Claude Agent SDK 聊天链路。
- 第一阶段不把终端能力直接塞进 Electron `main` / `preload` 的零散 IPC。

## 当前项目现状

### 已有能力

- Electron 主进程已经会读取用户 login shell 环境，并构造扩展后的 `PATH`，再传给内部服务进程。
- Claude SDK 子进程也继承了工作目录、环境变量、权限模式和 Git Bash 探测逻辑。
- 聊天流里已经能显示 `tool_use`、`tool_result`、`tool_progress`，也已经有权限审批持久化与恢复。

### 当前缺口

- 还没有“独立终端会话”概念。前端目前只能消费聊天流中的工具事件，没有 `start/write/resize/terminate` 这类终端控制面。
- `preload` 只暴露了 `openPath`、目录选择、安装器和 bridge 状态，没有终端或 git IPC。
- 数据层只有 `chat_sessions.working_directory` / `sdk_session_id`，没有 repo root、branch、HEAD、dirty、remote diff 等 git 元数据。
- git 相关逻辑仍以“Claude 工具可能调用 git”或“外部终端自己执行”为主，应用本身没有统一 git service。

## Codex 参考结论

### 终端集成

Codex 的关键不是“会跑命令”，而是把命令执行抽象成独立协议：

- `command/exec` 有明确的 `processId`、`tty`、`streamStdin`、`streamStdoutStderr`、`timeoutMs`、`cwd`、`env`、`sandboxPolicy`。
- 跟随接口有 `command/exec/write`、`command/exec/resize`、`command/exec/terminate`。
- 终端输出不是一次性结果，而是流式 delta。
- 会话管理是连接级的，不是“临时跑一个 shell 命令然后丢掉”。

### Shell / 环境集成

Codex 不只在启动时读取一次环境，而是有 `shell_snapshot` 机制，为每个 session 生成并校验 shell 快照文件，解决别名、导出变量、shell 初始化脚本差异等问题。

### Git 集成

Codex 既有轻量 git 探测，也有专门的 git tooling：

- 轻量层负责 repo root、HEAD、branch、remote、dirty、recent commits、diff-to-remote。
- tooling 层负责 git 仓库校验、repo root 解析、路径归一化、命令错误上下文。
- `gitDiffToRemote` 是独立接口，不把“比较当前工作区和远端”塞到 UI 层临时拼接。

## 建议的目标架构

### 一、Workspace Runtime 层

在现有 Next.js server 进程内新增一个独立的运行时层，建议放在：

- `src/lib/workspace-runtime/terminal-session-manager.ts`
- `src/lib/workspace-runtime/git-service.ts`
- `src/lib/workspace-runtime/approval-broker.ts`

职责拆分：

- `TerminalSessionManager`
  负责终端 session 生命周期、PTY / pipe 管理、输出流、stdin 写入、resize、terminate、超时和清理。
- `GitService`
  负责 repo 探测、repo root、branch、HEAD、dirty、remote URLs、recent commits、diff to remote。
- `ApprovalBroker`
  负责把“Claude 工具权限请求”和“应用内终端 / git 高风险操作”收口到一个审批模型。

### 二、传输契约

不必照搬 Codex 的 JSON-RPC / WebSocket 形态，但建议尽量复用它的语义。

### Terminal API

- `POST /api/terminal/sessions`
  创建终端会话，参数包含 `cwd`、`shellProfile`、`envOverrides`、`tty`、`cols`、`rows`。
- `GET /api/terminal/sessions/:id/stream`
  通过 SSE 推送 stdout / stderr / exit / error / metadata。
- `POST /api/terminal/sessions/:id/write`
  写入 stdin。
- `POST /api/terminal/sessions/:id/resize`
  调整 PTY 大小。
- `POST /api/terminal/sessions/:id/terminate`
  终止会话。

### Git API

- `GET /api/git/status?cwd=...`
- `GET /api/git/diff-to-remote?cwd=...`
- `GET /api/git/commits?cwd=...&limit=...`
- `GET /api/git/branches?cwd=...`

原则：

- Phase 1 只提供只读接口。
- 变更类接口如 `stage`、`unstage`、`commit`、`checkout` 放到后续阶段。

### 三、UI 结构

### Terminal

- 底部抽屉式终端面板，默认折叠，不打断聊天。
- 同一工作目录允许多个终端 tab，但同一 chat session 默认绑定一个“主终端”。
- 前端建议使用 `xterm.js` + `xterm-addon-fit`。

### Git

- 会话头部显示 repo 状态：仓库名 / branch / dirty / ahead-behind。
- 聊天页侧边或 Inspector 区域增加 Git 卡片：
  - 当前分支
  - 最近提交
  - 与远端 diff 摘要
  - 未提交文件计数

### Approval

- 当 Claude 触发 git 命令时，审批卡片展示 repo root、命令分类和风险等级。
- 当用户直接从终端面板触发高风险操作时，也走同一审批中心，而不是绕开现有 permission 体系。

## 分阶段落地

### Phase 0：契约与边界

目标：先把终端 / git 从“实现细节”提升为产品层能力。

任务：

- 定义 `TerminalSession`、`TerminalEvent`、`GitWorkspaceState`、`GitDiffSummary` 类型。
- 抽出 `workspace-runtime` 目录，不把逻辑继续堆到 `electron/main.ts` 或 `claude-client.ts`。
- 约定审批模型：哪些终端命令 / git 操作要走审批，哪些在 Full Access 下可自动放行。

交付标准：

- 类型、API 契约、错误码和 UI 事件模型先固定下来。

### Phase 1：Terminal MVP

目标：先拿到“像终端一样工作的终端”。

实现建议：

- 后端 MVP 使用 `node-pty`，挂在当前 Next.js server 进程中。
- 通过接口封装 PTY 实现，保留未来替换成 sidecar / Rust helper 的空间。
- 会话创建时继承当前 Electron 已构造好的环境，并保留 `envOverrides` 能力。
- 支持：
  - 创建 session
  - 实时输出
  - stdin 写入
  - resize
  - terminate
  - idle / exit 清理

暂不做：

- 会话恢复
- 复杂 shell snapshot
- 多 Host / 远程共享终端

### Phase 2：Git Read-only MVP

目标：先把 git 状态变成产品内可见上下文。

实现建议：

- 建一个 `GitService`，集中封装所有 git 命令，统一超时和错误处理。
- 参考 Codex 做法：
  - repo root 检测
  - HEAD / branch / remote URL
  - dirty 状态
  - recent commits
  - diff to remote
- 所有 git 调用都设置短超时，避免大仓卡 UI。

建议新增缓存：

- 进程内 LRU 缓存，用于最近一次 git 状态读取。
- 如需持久化，只缓存快照，不缓存“事实真相”；真相仍以实时 git 命令为准。

### Phase 3：聊天链路集成

目标：把终端和 git 变成聊天场景的原生上下文，而不是外挂面板。

任务：

- 每次 session 切换时同步当前 `GitWorkspaceState`。
- 在 Claude 权限请求里增强 git 命令展示：
  - 命令分类（只读 / 写索引 / 写工作区 / 远端网络）
  - 目标 repo
  - 可能影响的路径
- 聊天页支持从消息上下文跳到对应终端输出或 git 状态卡片。

关键决定：

- Claude SDK 工具输出仍保留。
- 但“独立终端面板”不依赖 Claude 消息流才能工作。

### Phase 4：Git 操作能力

目标：在只读稳定后，再开放少量高价值写操作。

优先顺序：

1. `stage / unstage`
2. `commit`
3. `checkout existing branch`
4. `create branch`

继续后置：

- rebase
- merge conflict resolution
- interactive staging hunk editor

### Phase 5：Shell Snapshot / 高级一致性

目标：解决“终端环境”和“Claude SDK 环境”长期不一致的问题。

建议：

- 先继续沿用当前 Electron `loadUserShellEnv()` 方案作为 MVP 基线。
- 待 Terminal MVP 稳定后，再引入类似 Codex 的 per-session shell snapshot：
  - 生成 shell bootstrap 文件
  - 校验可执行性
  - 让终端与 Claude SDK 共用同一环境基线

这样可以避免一次性把复杂度全部压进首版。

## 关键技术决策

- 不在 Electron `preload` 里继续堆大量终端 / git IPC；核心状态应留在 server 进程。
- 不直接把 git 逻辑散落到页面组件；必须集中到 `GitService`。
- 不让 Terminal MVP 依赖 Claude SDK；它应该可以单独工作。
- 传输层可以保留现有 HTTP + SSE 风格，但语义尽量对齐 Codex 的 `command/exec`。
- Windows 继续沿用现有 `findGitBash()` 与 shell 兼容逻辑，不额外发明新约定。

## 风险与规避

#### 风险 1：`node-pty` 的 Electron 打包和 ABI 复杂度

规避：

- 放在隔离的 manager 抽象后面。
- 首版只做 macOS / Linux 稳定，Windows 作为兼容目标但不阻塞 Phase 1。

#### 风险 2：git 命令阻塞大仓库

规避：

- 所有 git 调用统一超时。
- 使用只读快速命令优先，如 `status --porcelain`、`rev-parse`、`remote -v`。

#### 风险 3：终端和 Claude SDK 环境不一致

规避：

- 首版承认现状，统一走 Electron 已加载的环境。
- 后续用 shell snapshot 收敛。

#### 风险 4：审批流分裂

规避：

- 应用内终端 / git 高风险操作接入同一审批中心。
- 不做第二套“终端专用审批 UI”。

## 推荐实施顺序

1. Phase 0：先定契约和数据模型
2. Phase 1：终端 MVP
3. Phase 2：git read-only MVP
4. Phase 3：聊天链路集成
5. Phase 4：git 变更操作
6. Phase 5：shell snapshot

## 与当前代码的直接对接点

- `electron/main.ts`
  继续负责外层环境准备和 server 启动，但不承载终端会话细节。
- `src/lib/claude-client.ts`
  保留 Claude SDK 集成；后续只增强审批和 git 上下文展示。
- `src/app/api/chat/permission/route.ts`
  继续作为审批落点，后续扩展为终端 / git 共用审批入口。
- `src/lib/db.ts`
  后续需要补充 git 快照或终端审计相关表，但不建议把终端实时输出写进 DB。

## 下一步建议

如果继续推进，建议下一步直接做：

1. Phase 0 的类型与 API 契约草案
2. Terminal MVP 的 manager 骨架
3. GitService 的只读接口骨架

这样能最快把“讨论”转成可跑的基础设施。
