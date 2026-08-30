# CodePilot Branch Preview — 2026-05-31

> ⚠️ **已废弃，不要分发本页旧包。**  
> 用户安装后确认 P0：app 内仍显示 `0.53`，Codex app-server 启动失败，ClaudeCode 输入框长期停在"正在准备运行环境"。详见 [`docs/exec-plans/completed/preview-build-readiness.md`](../exec-plans/completed/preview-build-readiness.md) 的 `2026-05-31 P0 复盘`。下一版必须重新生成，版本单源高于 `0.54.0`，并通过 packaged Runtime smoke 后再更新本页。

> 分支：`worktree-product-refactor-research`  
> Commit：`2606371`  
> 版本：`0.53.0`  
> 性质：小范围预览包，不是正式 Release，不走自动更新。

## 下载 / 本地包路径

| 平台 | 架构 | 包 | SHA-256 | 状态 |
|------|------|----|---------|------|
| macOS | Apple Silicon | `/Users/op7418/Documents/code/opus-4.6-test/.claude/worktrees/product-refactor-research/release-preview-2026-05-31/CodePilot-0.53.0-preview-2026-05-31-arm64.dmg` | `7965d9f51df41814c86785d0a16cc64966f5a9dc1692f35e0c10ee684ed285a8` | 🚫 **已废弃 / 不分发**（0.53.0 旧版 + 6923f13 前过时构建，仅诊断样本；当时 codesign/hdiutil 通过不代表可发） |
| macOS | Intel x64 | `/Users/op7418/Documents/code/opus-4.6-test/.claude/worktrees/product-refactor-research/release-preview-2026-05-31/CodePilot-0.53.0-preview-2026-05-31-x64.dmg` | `be65141fd48643439f0d95a9cd94e56cd3e5fe2ed686cf91a8096d22bd351bd0` | 🚫 **已废弃 / 不分发**（0.53.0 旧版 + 6923f13 前过时构建，仅诊断样本；当时 codesign/hdiutil 通过不代表可发） |
| Windows | x64 | 待 Windows 机器本地构建 | 待补 | ⏳ 不能在 Mac 上交叉构建可用包 |

说明：

- 这两个 macOS 包是 **ad-hoc signed**，没有公证。首次打开可能需要右键打开，或在 System Settings → Privacy & Security 里允许打开。
- `release/` 目录里那批 Developer ID 构建签名校验失败，不给测试用户使用。以本文件表格里的 `release-preview-2026-05-31/` 为准。
- Windows 包必须在 Windows 环境打，因为 `better-sqlite3` 需要目标平台的 Electron ABI 原生重编译。

## 安装前必读

本预览包沿用正式版数据目录与 app identity。它会替换当前 CodePilot，并读取 / 迁移现有数据。

安装前请先退出 CodePilot，并备份：

- `~/.codepilot/codepilot.db`
- macOS 如使用了 Application Support 数据，也备份 `~/Library/Application Support/CodePilot`

不要同时运行正式版和预览版。回滚方式是重新安装稳定版，并在需要时恢复备份的 `codepilot.db`。

## Windows 构建步骤

在 Windows 机器或 Windows CI 上，从同一个 worktree / commit 构建：

```powershell
cd <product-refactor-research-worktree>
npm install
npm run build
npx electron-builder --win --x64 --config electron-builder.yml
```

Windows 验收必须在真机完成：

- 安装 NSIS 包并启动。
- 打开 Chat / Settings → Runtime / Models / Plugins。
- 让 Agent 生成“创建目录并写文件”的命令，确认默认是 PowerShell / Windows 兼容语法。
- 确认没有把 macOS 的 shell / 路径 / 视觉假设带到 Windows。

## 测试重点

请优先反馈 P0 / P1，视觉细节可以后置。

| 级别 | 定义 | 示例 |
|------|------|------|
| P0 | 无法继续测试或可能损坏数据 | 无法安装 / 无法启动 / 现有会话丢失 / 数据库损坏 / 无法回滚 / 登录凭据丢失 |
| P1 | 核心路径不可用 | 无法发送消息 / Runtime 切换错误 / Provider 不可用 / Codex MCP 能力不可用 / Windows 命令不可执行 / macOS 通知完全无 fallback |
| P2 | 可绕过但影响体验 | 视觉错位 / 文案不清 / 轻微交互问题 / console 已知 noise |

## 建议 Smoke

1. 安装并打开预览版。
2. 确认旧会话、Provider、模型、素材库还能看到。
3. 用当前默认 Runtime 发一条普通消息。
4. 打开 Settings → Runtime，确认能力清单与当前引擎一致。
5. 如果你使用 Codex Account，测试 Memory / Widget / Tasks / Dashboard / CLI 任意 2-3 条路径。
6. 创建一个 3 分钟定时提醒，确认 app 内 toast 或 macOS 系统通知至少一种可见。
7. 如在 Windows，额外测试 PowerShell 命令生成。

## 反馈表

```text
测试人 / 联系方式：
系统版本 + 架构：
安装包路径 / SHA：
是否使用已有 CodePilot 数据：
安装前是否已备份：

严重级别：P0 / P1 / P2
一句话标题：

复现步骤：
1.
2.
3.

期望结果：
实际结果：

截图 / 录屏 / 日志：
是否稳定复现：
临时绕过方式：
是否阻塞继续测试：
```

## 已知边界

- macOS 包未公证，属于内部预览验证。
- Windows 包尚未产出，必须 Windows 侧补构建与真机 smoke。
- 预览包不自动更新、不合 main、不推正式 release。
- 这次测试目标是发现 P0/P1，不要求所有 P2 视觉细节一次收口。
