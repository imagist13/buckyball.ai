# CLI 版本检测 + 一键升级 + 系统代理透传

> 产品思考见 [docs/insights/cli-upgrade-proxy.md](../insights/cli-upgrade-proxy.md)

## 背景

P0 issue 集群（11 个）的共性根因是用户 Claude Code CLI 版本过旧导致 `exit code 1`。中国用户有 VPN 但 Electron 子进程拿不到系统代理，导致升级命令无法访问外网。Windows 用户缺少 Git for Windows 也会导致 exit code 1。

## 架构概览

```
┌─ Electron Main ──────────────────────────────────┐
│  resolveSystemProxy()                            │
│    → session.defaultSession.resolveProxy()        │
│    → 解析 Chromium 代理列表 → HTTP_PROXY env      │
│  install:git IPC → winget install Git.Git        │
│  proxy:resolve IPC → 前端可查询系统代理            │
└──────┬───────────────────────────────────────────┘
       │ env 注入 (startServer)
┌──────▼── Next.js Server ─────────────────────────┐
│  /api/claude-status                              │
│    → fetchLatestVersion() (npm registry, 缓存)    │
│    → isWingetInstall() (winget list, 进程缓存)    │
│    → 返回 updateAvailable / manualUpdateChannel   │
│                                                   │
│  /api/claude-upgrade                             │
│    → getUpgradeCommand(installType)              │
│    → execFile 执行升级命令                        │
│    → 清除所有缓存                                 │
└──────────────────────────────────────────────────┘
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `electron/main.ts` | 系统代理检测 `resolveSystemProxy()`、Git 安装 IPC `install:git`、代理查询 IPC `proxy:resolve`、安装向导 Git 步骤 |
| `electron/preload.ts` | 暴露 `proxy.resolve` 和 `install.installGit` |
| `src/types/electron.d.ts` | proxy 和 installGit 类型声明 |
| `src/app/api/claude-status/route.ts` | 版本检测 `fetchLatestVersion()`、WinGet 检测、`updateAvailable` / `manualUpdateChannel` 计算 |
| `src/app/api/claude-status/invalidate/route.ts` | 缓存清除（含 WinGet 检测缓存） |
| `src/app/api/claude-upgrade/route.ts` | 升级 API，调用 `getUpgradeCommand()` 执行 |
| `src/lib/platform.ts` | `ClaudeInstallType`（含 winget）、`getUpgradeCommand()`、`isWingetInstall()`、`invalidateWingetCache()` |
| `src/components/layout/ConnectionStatus.tsx` | 可更新状态按钮、升级 dialog、Git 缺失 error UI |
| `src/i18n/en.ts` / `zh.ts` | 所有新增翻译 key |

## 安装类型检测与升级命令

| installType | 检测方式 | 升级命令 | updateAvailable 来源 |
|-------------|---------|---------|---------------------|
| `native` | 路径 `~/.local/bin/` | `claude update` | 不显示（自动更新） |
| `homebrew` | 路径含 `/homebrew/` 或 `/Cellar/` | `brew upgrade claude-code` | `manualUpdateChannel`（不对比 npm） |
| `npm` | 路径含 `/npm` | `npm update -g @anthropic-ai/claude-code` | npm registry 对比 |
| `bun` | 路径含 `/.bun/` | `bun update -g @anthropic-ai/claude-code` | npm registry 对比 |
| `winget` | `winget list Anthropic.ClaudeCode`（异步，进程缓存） | `winget upgrade Anthropic.ClaudeCode` | `manualUpdateChannel`（不对比 npm） |
| `unknown` | 以上均不匹配 | `claude update` | 不显示 |

### 为什么不用 npm registry 对比所有渠道

npm registry 是 npm/bun 的权威版本源，但 Homebrew cask 和 WinGet 包是独立分发渠道，版本发布可能滞后 npm 数小时到数天。用 npm 版本对比会导致误报"可更新"但实际 `brew upgrade` / `winget upgrade` 无事可做。

## 系统代理透传

### 问题

macOS VPN 工具（Clash、Surge 等）通常只设置系统代理（macOS HTTP Proxy Settings），不 export `HTTP_PROXY` 到 shell 环境变量。`loadUserShellEnv()` 读 shell env 时拿不到代理变量，导致 Next.js server 和它 spawn 的子进程（SDK、升级命令）都不走代理。

### 方案

在 `app.whenReady()` 中、`startServer()` 之前：

1. 调用 `session.defaultSession.resolveProxy('https://registry.npmjs.org')`
2. 解析 Chromium 返回的有序代理列表（如 `"PROXY 127.0.0.1:7890; DIRECT"`）
3. 按 `;` 分割，取第一个非 `DIRECT` 条目
4. 用严格正则 `([\w.-]+:\d+)` 提取 `host:port`，避免匹配到列表分隔符
5. 注入到 `startServer()` 的 env 中（仅在 `userShellEnv` 没有 `HTTP_PROXY` 时）

### 注意事项

- 代理检测只在启动时执行一次，如果用户在应用运行期间开关 VPN，需要重启 CodePilot
- `proxy:resolve` IPC 可以在运行时查询，但当前未用于动态更新 server env

## Git for Windows

### 为什么是 error 级别

Claude Code 在 Windows 上使用 Git Bash 执行所有命令。缺少 Git Bash 会导致**所有**命令以 exit code 1 失败，不仅仅是 git 相关操作。这是 Windows 用户最常见的 P0 问题。

### 安装链路

1. **ConnectionStatus dialog** — 红色 error 卡片 + "一键安装 Git" 按钮（通过 `install:git` IPC 调用 `winget install Git.Git --silent`）+ "手动下载" 按钮（打开 git-scm.com）
2. **安装向导** — `install:start` 检测到 Windows 缺 Git 时，自动在装 Claude CLI 前插入 Git 安装步骤
3. **非致命设计** — winget 安装 Git 失败时标记 `skipped`（不是 `failed`），继续安装 Claude CLI。用户可以事后手动装 Git。

## 缓存策略

| 缓存 | TTL | 失效触发 |
|------|-----|---------|
| `fetchLatestVersion()` | 成功 60min / 失败 5min | 自动过期 |
| `isWingetInstall()` | 进程生命周期 | `invalidateWingetCache()` |
| `findClaudeBinary()` | 60s | `invalidateClaudePathCache()` |

`/api/claude-status/invalidate` POST 同时清除 Claude 路径缓存和 WinGet 检测缓存。升级 API 成功后也会清除。

## 设计决策

1. **不让用户手动配置代理** — 中国用户电脑上已有 VPN，只需透传系统代理，不增加配置负担
2. **Native 安装不显示"可更新"** — 官方文档明确 native 安装自动后台更新，显示更新提示是误导
3. **Homebrew/WinGet 用"检查更新"而非"有新版本"** — 无法可靠判断这些渠道是否有新版本，只能提供一键执行升级命令的入口
4. **Git 安装步骤非致命** — 不是所有 Windows 环境都有 winget（如 Windows Server 2019 的旧版本），失败不应阻断 Claude 安装
