# CLI 版本检测 + 一键升级 + 代理支持

> 创建时间：2026-04-02
> 状态：待实施

## 背景

Issue 分析发现 P0 集群（11 个 issue）的共性根因：用户的 Claude Code CLI 版本过旧或与 SDK 不兼容，导致 `exit code 1`。另外有多个用户反馈因代理/VPN 问题无法连接。

## 需求

### 1. CLI 版本检测 + "可更新"状态

**已有基础设施：**
- `src/lib/platform.ts` — `findAllClaudeBinaries()`, `classifyClaudePath()`, `getClaudeVersion()`
- `src/app/api/claude-status/route.ts` — 返回 `connected`, `version`, `installType`, `features`
- `src/components/layout/ConnectionStatus.tsx` — 绿/黄/红状态 + dialog

**需要新增：**
- 获取最新版本号（npm registry 或 GitHub API）
- `/api/claude-status` 返回 `latestVersion` + `updateAvailable`
- `ConnectionStatus.tsx` 在 `updateAvailable` 时显示黄色"可更新"状态
- Dialog 中显示当前版本 vs 最新版本

### 2. 一键升级

**升级命令映射（来自 https://code.claude.com/docs/en/overview）：**

| installType | 升级命令 |
|---|---|
| `native` | `curl -fsSL https://claude.ai/install.sh \| bash`（macOS/Linux）或 `irm https://claude.ai/install.ps1 \| iex`（Windows PowerShell） |
| `homebrew` | `brew upgrade claude-code` |
| `npm` | `npm update -g @anthropic-ai/claude-code` |
| `bun` | `bun update -g @anthropic-ai/claude-code` |
| `unknown` | 建议用 native 方式重新安装 |

**注意：**
- Native 安装虽然文档说"自动后台更新"，但 CodePilot 通过 SDK spawn 短生命周期子进程，自动更新机制来不及生效。所以 native 也需要手动升级能力。
- 升级完成后需要提示用户重启 CodePilot（CLI 和应用都需要重启）
- 升级过程通过新 API endpoint `/api/claude-upgrade` POST 执行
- 升级完成后调用 `/api/claude-status/invalidate` 刷新缓存

**UI 流程：**
1. 左上角"已连接"按钮变黄色"可更新"
2. 点击打开 dialog，显示版本对比 + "一键升级"按钮
3. 按钮点击后显示升级进度（命令输出）
4. 升级成功后显示"请重启 CodePilot 以应用更新"

### 3. 代理支持

**现状：**
- `src/lib/claude-client.ts` line 464 — `sdkEnv` 从 `process.env` 继承，但 macOS Electron 从 launchd 启动，不继承 shell 环境变量
- `src/lib/provider-resolver.ts` `toClaudeCodeEnv()` 清理 `ANTHROPIC_*` 但不碰 proxy 变量
- `electron/updater.ts` 有个已禁用的 `session.defaultSession.resolveProxy()` 模式可参考

**需要新增：**
- 设置页增加代理配置（HTTP_PROXY / HTTPS_PROXY / NO_PROXY）
- 或自动检测系统代理设置
- 在 `claude-client.ts` 构造 `sdkEnv` 时注入代理环境变量
- 在 `provider-doctor.ts` 的网络探测中也使用代理

## 关键文件

| 文件 | 改动 |
|------|------|
| `src/app/api/claude-status/route.ts` | 增加 latestVersion + updateAvailable |
| `src/app/api/claude-upgrade/route.ts` | **新建** — 执行升级命令 |
| `src/components/layout/ConnectionStatus.tsx` | 可更新状态 + 升级按钮 + 进度显示 |
| `src/lib/claude-client.ts` | 代理 env 注入 |
| `src/lib/provider-resolver.ts` | 代理 env 保留 |
| `src/lib/platform.ts` | 可能需要增加 getUpgradeCommand(installType) |
| `src/i18n/zh.ts` + `en.ts` | 新翻译 key |

## 相关 Issues

#417, #416, #414, #413, #412, #410, #406, #393, #381, #380, #376, #360, #356
