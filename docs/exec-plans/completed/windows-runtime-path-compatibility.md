# Windows Runtime / 路径兼容性收口

> 创建时间：2026-08-06
> 最后更新：2026-08-06

## 用户结果与边界

用户在 Windows 中选择包含中文、空格或合法特殊字符的项目目录后，CodePilot Runtime、Claude Code Runtime 与 Codex Runtime 都应使用同一个真实工作目录；原生工具不再依赖系统中未必存在的 Unix `bash/find/grep`。设置页必须区分“安装了 ChatGPT/Codex 桌面应用”和“存在 CodePilot 可启动的 Codex CLI”，并给出可执行的恢复路径。

可从会话内读取/搜索项目文件、Bridge `/cwd`、后台 Agent 任务、Runtime 设置页和 Windows 开发脚本验收。本阶段不改变 provider/model 选择、不放宽工具权限、不修改数据库 schema，也不尝试绕过 Windows 沙盒或访问控制。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | Windows 实机取证与三 Runtime 路径审计 | ✅ 已完成 | 复现原生 Bash/Unix fallback、CWD 分叉、Codex MSIX 误判与 npm scripts 不兼容 |
| Phase 1 | 原生 Shell、Glob/Grep 与 Unicode 路径修复 | ✅ 已完成 | PowerShell UTF-8 启动 + Node.js 搜索回退 + Windows 原生 realpath |
| Phase 2 | CWD/Bridge/后台任务路径统一 | ✅ 已完成 | 共享 resolver、现存目录校验、合法 Windows 路径字符兼容 |
| Phase 3 | Codex/Claude CLI 发现与状态诚实化 | ✅ 已完成 | 独立 CLI 优先；桌面包不可复用时明确 desktop-only |
| Phase 4 | Windows 脚本、测试与真实 smoke | ✅ 已完成 | 5,082 tests、typecheck、guardrails 与 Electron production build |

## Signal → Triage → Fix → Verify → Guardrail

- Signal：用户在 Windows 游戏项目目录中执行分析任务时无法读取文件；Codex 渠道长期显示不可用。
- Triage：CodePilot Runtime 的系统提示声称使用 PowerShell，但 Bash 工具固定 `spawn('bash')`，Glob/Grep 在 `rg` 不可用时固定回退 Unix 命令；Bridge 和会话使用不同 CWD resolver；路径 validator 将合法的 `()`、`&`、`$` 当 shell 注入拒绝；Codex 发现逻辑会把受保护 MSIX 包内二进制当成普通 CLI。
- Fix：保留 Runtime/permission 边界，只修进程启动、路径解析、跨平台回退、CLI 可用性探测和状态文案。
- Verify：为中文/空格/合法特殊字符目录补单测，在 Windows 真实执行 PowerShell/文件搜索，验证本机 Claude CLI，并对 Codex 桌面包与独立 CLI 两种状态做契约测试。
- Guardrail：跨平台路径与命令构造改为纯函数/Node API；Windows 回归测试不依赖开发机恰好安装的 Git Bash 或 ripgrep。

## 决策日志

- 2026-08-06：不通过转义用户路径来修复，因为 CWD 应作为 `spawn` 的独立字段传递，不应拼接进 shell 命令。
- 2026-08-06：原生 Runtime 在 Windows 默认使用 PowerShell UTF-8 编码命令；用户明确配置 Git Bash 时仍允许使用 Git Bash。
- 2026-08-06：Glob/Grep 的无 `rg` 回退使用 Node.js 文件 API，避免继续引入 `find`、`grep`、shell 编码和命令注入差异。
- 2026-08-06：不把 ChatGPT/Codex 商店应用的存在等同于可启动的 Codex app-server；受保护 bundle 必须通过实际版本探测，独立 CLI 按官方安装目录和 `CODEX_BIN` 发现。
- 2026-08-06：合法 Windows 路径字符不再按 shell 元字符拒绝；保留绝对路径、长度、控制字符、目录存在性和 permission boundary 校验。
- 2026-08-06：受限 Windows 沙盒中改用 `fs.realpathSync.native`，避免 Node 的 JavaScript realpath 逐级 `lstat C:\Users\...` 导致目标可读却返回 `EPERM`；覆盖 Asset、HTML bundle、Harness Home、Codex MCP、Memory 与工作区整理链路。
- 2026-08-06：Harness Home 原子写仍保留 fsync + rename，只把 Windows 文件 fsync 的句柄从只读 `r` 改为可刷盘的 `r+`；Next production build 阶段不启动 scheduler，构建不再触碰用户数据库。

## 详细设计

1. 抽出平台 Shell launch spec；Windows 命令以 UTF-16LE `-EncodedCommand` 交给 PowerShell，避免中文和引号经过额外一层解析。
2. 为 Glob/Grep 实现受大小、条数与时间限制的 Node fallback，并保留 ripgrep 快速路径。
3. 系统提示中的 Git/OS 探测改用 argv API 与 Node `os`，不再使用 `2>/dev/null`、`uname` 等 Unix shell 语法。
4. Bridge conversation engine 复用共享 working-directory resolver；validator 只拒绝真正非法的路径输入并验证目标确为目录；Windows UI 标签使用 `path.basename`。
5. Codex discovery 补 Windows 独立安装目录，并对桌面/MSIX bundle 强制可执行性探测；availability 增加可解释的 desktop-only 状态。
6. 修复 package scripts 中 POSIX-only 环境变量、`${PORT:-3000}` 与 `grep` 用法。

## 验收标准

- 中文 + 空格 + `()`/`&` 目录能被选择、保存并用于读取、Glob、Grep 和 Shell。
- 未安装 Bash/rg 的 Windows 环境仍能完成原生文件任务。
- 后台任务和 Bridge 不会因 resolver 分叉静默切到 HOME。
- 仅安装商店桌面应用但 bundle 不可执行时，Codex 状态不再显示“已安装可用”；安装独立 CLI 或设置 `CODEX_BIN` 后能被发现。
- Claude Code 的 `.exe`、npm `.cmd` 两类安装路径仍保持兼容。
- typecheck、相关 unit tests、完整 unit suite 和 lint/docs guardrail 通过。

## Smoke Ledger（真实凭据 / UI / E2E 验证记录）

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| 2026-08-06 | native | local tools | n/a | n/a | 中文/空格/`()`/`&` 目录下 PowerShell + Read/Glob/Grep | ✅ | `native-search-tools-security.test.ts` 与 `platform-shell.test.ts` 在 Windows 实际启动 PowerShell 并读取 Unicode 文件 |
| 2026-08-06 | claude_code | Anthropic | n/a | 本机 Claude CLI | ✅ binary probe | `C:\Users\op741\.local\bin\claude.exe --version` = `2.1.74 (Claude Code)`；未使用用户凭据发起计费会话 |
| 2026-08-06 | codex_runtime | OpenAI | n/a | Windows Store desktop app | ✅ honest degradation | 实机诊断返回 `desktop_only / desktop_bundle_not_executable`，不再误报 `installed_idle`；独立 CLI 安装后由官方目录或 `CODEX_BIN` 接管 |

## 验证记录

- `npm run test:unit`：5,082 tests；5,080 passed，0 failed，2 skipped（环境条件）；随后新增的 build-phase scheduler guard 定向通过。
- `npm run typecheck`、`npm run lint:hooks`、`npm run lint:docs-drift`、`npm run test:harness-boundary`：全部通过。
- `npm run electron:build`：Next 136 routes/pages 与 Electron 主进程构建通过；最终日志不再出现 scheduler 启动或 `~/.codepilot` 的 `EPERM`。
- 未执行真实 Claude/Codex 计费请求；Claude 只做本机 binary probe，Codex 当前机器缺少 CodePilot 可启动的独立 CLI，因此按产品契约降级并展示恢复指引。
