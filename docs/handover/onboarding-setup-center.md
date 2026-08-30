# 首次引导 Setup Center + Claude Code 环境检测

> 完成时间：2026-03-13 | 涉及 ~25 个文件 | 6 阶段交付

## 概述

为 CodePilot 新增可跳过的首次设置引导（Setup Center），替代原先被动的"失败后提示"模式。引导覆盖三个核心前置条件：Claude Code CLI 连接、API Provider 配置、默认项目目录。同时修复 Windows 顶栏重叠，统一错误反馈路径。

## 架构

### 整体流程

```
应用启动
  ↓
AppShell.useEffect → GET /api/setup
  ↓
setup_completed !== true?
  ├── 是 → 弹出 SetupCenter 蒙层
  │         ├── ClaudeCodeCard: 检测 CLI 环境
  │         ├── ProviderCard: 检测 API 凭据
  │         └── ProjectDirCard: 选择项目目录
  │         用户可逐个完成或跳过，全部完成后自动关闭
  └── 否 → 正常进入应用
              ↓
         /chat 页独立校验 provider + 目录
         缺失时显示 ChatEmptyState 引导
```

### 组件结构

```
AppShell
  └── SetupCenter (fixed overlay, z-50)
        ├── WelcomeCard (静态)
        ├── ClaudeCodeCard → /api/claude-status
        ├── ProviderCard → /api/providers + /api/settings/app
        └── ProjectDirCard → /api/setup/recent-projects
```

### 状态持久化

Setup 状态存储在 SQLite settings 表，键名：

| 键 | 值 | 说明 |
|---|---|---|
| `setup_completed` | `'true'` | 整体完成标记，控制是否自动弹出 |
| `setup_claude_skipped` | `'true'` | 用户跳过了 Claude Code 检测 |
| `setup_provider_skipped` | `'true'` | 用户跳过了 Provider 配置 |
| `setup_project_skipped` | `'true'` | 用户跳过了项目目录选择 |
| `setup_default_project` | 路径字符串 | 用户选择的默认项目目录 |

### 重新打开

- 设置页 GeneralSection 中有"首次设置引导"入口（FieldRow + Open 按钮）
- 代码中任何位置可通过 `window.dispatchEvent(new CustomEvent('open-setup-center'))` 触发
- 支持 `initialCard` 参数跳转到指定卡片：`{ detail: { initialCard: 'provider' } }`

### 自动关闭逻辑

- 用 `initialCompletedCountRef` 记录打开时的已完成数
- 只在用户**当前会话中**完成了最后一张卡时才自动关闭
- 已全部完成的状态下手动打开不会自动关（避免从设置页点开瞬间关闭）

## Claude Code 环境检测（详细）

### 检测链路

```
ClaudeCodeCard
  ↓ GET /api/claude-status
  ↓
findClaudeBinary() + findAllClaudeBinaries()  (src/lib/platform.ts)
  ↓
返回:
  connected: boolean        — 是否找到可用二进制
  version: string | null    — 版本号
  binaryPath: string | null — 当前使用的路径
  installType: string       — native / npm / bun / homebrew / unknown
  otherInstalls: Array<{path, version, type}>  — 其他冲突安装
  missingGit: boolean       — Windows 上未检测到 Git
```

### 四种状态及 UI 展示

#### 1. 已检测到（connected = true, 无冲突）
- 绿色 completed 状态
- 显示版本号、安装类型、二进制路径

#### 2. 已检测到但存在冲突（connected = true, otherInstalls.length > 0）
- 黄色警告框，标题："检测到多个安装版本，可能导致版本冲突"
- 显示当前使用的版本（路径 + 安装类型 + 版本号）
- "查看清理方式"按钮 → 展开详情：
  - 逐条列出每个冲突安装的路径、类型、版本
  - 根据安装类型给出卸载命令（带一键复制按钮）：
    - npm: `npm uninstall -g @anthropic-ai/claude-code`
    - bun: `bun remove -g @anthropic-ai/claude-code`
    - homebrew: `brew uninstall --cask claude-code`
  - 底部提示"清理完成后，点击重新检测以确认" + Re-detect 按钮

#### 3. 未找到（connected = false, missingGit = false）
- 显示安装命令：
  - macOS/Linux: `curl -fsSL https://claude.ai/install.sh | bash`
  - Windows: `irm https://claude.ai/install.ps1 | iex`
- Re-detect 按钮

#### 4. 缺少 Git（Windows 专用, missingGit = true）
- 显示 Git for Windows 安装步骤（三步引导）
- Re-detect 按钮

### 冲突处理的设计决策

- **不自动切换**：冲突状态下仍标记为 completed（能正常工作），只给出警告和清理建议
- **复用 InstallWizard 的卸载逻辑**：`getUninstallCommand()` 与 InstallWizard 的 `getUninstallAdvice()` 保持一致
- **CopyableCommand 组件**：卸载命令支持一键复制，降低操作门槛

## Provider 检测（详细）

### 三条凭据来源（优先级从高到低）

1. **DB provider**：`api_providers` 表中配置的自定义服务商（含 preset 预设）
2. **进程环境变量**：`ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN`
3. **App settings token**：`getSetting('anthropic_auth_token')`（旧版本的凭据存储路径）

### 关键判断规则

- **`ANTHROPIC_BASE_URL` 不算凭据**：只有 `ANTHROPIC_API_KEY` 和 `ANTHROPIC_AUTH_TOKEN` 才是真正的认证凭据，仅有 base URL 无法发起请求
- **`OPENAI_API_KEY` 不参与判断**：运行时 env 解析不支持它，setup 也不应把它算作可用 provider
- **`skipped` 不等于 `completed`**：/chat 页只认 `completed`，跳过引导的用户在发消息前仍会看到"去配置 provider"的提示
- **skipped 不是粘性状态**：`/api/setup` 先查真实凭据，有任何一条就返回 `completed`；只有完全没有凭据时才看 `setup_provider_skipped` flag

### ProviderCard 交互

- 检测到 env 凭据 → 显示"使用 Claude Code 环境"按钮，一键确认
- 无凭据 → 显示"添加服务商"按钮，跳转 `/settings#providers`（hash 路由）
- 监听 `provider-changed` 事件自动刷新状态

## 项目目录

### 目录回退链

```
page.tsx 初始化 workingDir:
  1. localStorage['codepilot:last-working-directory']
     ↓ 校验 /api/files/browse → 有效则使用
     ↓ 无效 → 清除 localStorage
  2. GET /api/setup → defaultProject
     ↓ 校验 /api/files/browse → 有效则使用并写入 localStorage
  3. 都无效 → 显示空状态（ChatEmptyState）
```

ChatListPanel 的 `handleNewChat` 使用相同的回退链：最近目录 → defaultProject → 弹 picker。

### 跨组件同步

- ProjectDirCard 选中目录后，通过 `project-directory-changed` CustomEvent 通知 /chat 页
- /chat 页监听该事件，实时更新 `workingDir` 状态
- 同时写入 `localStorage` 和 `/api/setup`（server 端持久化）

## Toast 系统

### 架构

- `useToast.ts`：全局状态 + `showToast()` 命令式 API
- `toast.tsx`：`<Toaster />` 组件，渲染在 AppShell 底层
- FIFO 策略，最多 3 条，默认 5s 消失（error 8s）
- 支持 `action: { label, onClick }` 可选操作按钮

### 使用场景

| 场景 | 类型 | 位置 |
|---|---|---|
| Push 成功/失败 | success/error | GitStatusSection |
| 标题保存失败 | error | UnifiedTopBar |
| 目录失效 | warning + action | ChatListPanel |

## Windows 适配

- UnifiedTopBar 右侧添加 138px spacer（3 × 46px 系统标题按钮宽度），通过 `useClientPlatform().isWindows` 判断
- 路径分割统一使用 `split(/[\\/]/).filter(Boolean)` 兼容反斜杠
- ProjectGroupHeader 的"在文件管理器中打开"文案根据平台动态切换（Finder / Explorer / Files）

## 文件清单

### 新增文件

| 文件 | 用途 |
|---|---|
| `src/hooks/useClientPlatform.ts` | SSR 安全的平台检测 hook |
| `src/hooks/useToast.ts` | Toast 状态管理 + 全局 API |
| `src/components/ui/toast.tsx` | Toaster 渲染组件 |
| `src/components/ui/error-banner.tsx` | 内联错误条 |
| `src/app/api/setup/route.ts` | Setup 状态 CRUD |
| `src/app/api/setup/recent-projects/route.ts` | 最近项目列表 |
| `src/components/setup/SetupCenter.tsx` | 引导蒙层主组件 |
| `src/components/setup/SetupCard.tsx` | 可复用卡片壳 |
| `src/components/setup/WelcomeCard.tsx` | 欢迎卡片 |
| `src/components/setup/ClaudeCodeCard.tsx` | Claude Code 检测 + 冲突处理 |
| `src/components/setup/ProviderCard.tsx` | Provider 检测 + 配置入口 |
| `src/components/setup/ProjectDirCard.tsx` | 项目目录选择 |
| `src/components/chat/ChatEmptyState.tsx` | /chat 空状态引导 |

### 关键修改文件

| 文件 | 改动 |
|---|---|
| `src/components/layout/AppShell.tsx` | 挂载 SetupCenter + Toaster |
| `src/components/layout/UnifiedTopBar.tsx` | Windows safe zone、路径兼容、移除 commit/push 按钮 |
| `src/components/git/GitStatusSection.tsx` | 新增 Commit + Push 按钮 |
| `src/components/layout/ConnectionStatus.tsx` | 断连时派发 setup-center 事件 |
| `src/components/settings/GeneralSection.tsx` | 首次设置引导入口 |
| `src/app/chat/page.tsx` | 目录校验回退链 + provider 检测 + ChatEmptyState |
| `src/components/layout/ChatListPanel.tsx` | 失效目录回退到 defaultProject |
| `src/i18n/en.ts` / `zh.ts` | ~80 个新 i18n 键 |

## 已知限制

- Setup Center 不是分步向导，而是所有卡片同时展示在滚动面板中
- Claude Code 冲突检测依赖 `findAllClaudeBinaries()` 的路径扫描，可能遗漏非标准安装路径
- Provider 检测不覆盖 `OPENAI_API_KEY`（运行时 env 模式不支持），如果未来支持需要同步更新检测逻辑
- 目录校验使用 `/api/files/browse` 接口，额外产生一次文件系统访问
