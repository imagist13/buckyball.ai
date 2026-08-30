> **Archive note（2026-06-05，document-system-governance）**：本计划已完成并移出 `active/`，归入 `completed/`——预览包流程已被正式 v0.55.x 发布取代。作为历史执行记录保留；当前任务入口见 [exec-plans README](../README.md)。

# Branch Preview Build Readiness / 分支预览包发布前收口

> 创建时间：2026-05-29
> 最后更新：2026-05-31
> 父计划：[`refactor-closeout.md`](./refactor-closeout.md) + [`post-refactor-cleanup.md`](../completed/post-refactor-cleanup.md)（已完成归档）

## 背景与目标

用户决定：**暂不合并 main，先从 `worktree-product-refactor-research` 打预览包给少量用户试用**。这次预览包必须覆盖 macOS 与 Windows；macOS 只打 **Apple Silicon / arm64**，Windows 打 x64；macOS 负责验证新视觉 / Runtime / MCP 能力，Windows 负责验证跨平台基础体验，尤其不能继续出现"Windows 版 Agent 生成 bash 命令"这类一眼失信的问题。

本计划不是新一轮大重构，而是把**预览包之前必须修的问题、必须做的打包验证、以及用户试用后的合并门槛**收成一张执行图。它引用 `post-refactor-cleanup.md` 里已经拆好的遗留项，但把它们提升为"能不能发分支预览包"的发布门槛。

## 2026-05-31 P0 复盘：本地预览包不可再分发

用户在另一台 Mac 上替换旧安装包后发现几个 P0 信号：

1. **版本仍显示 0.53**：本次本地打包只用 `electron-builder --config.extraMetadata.version=0.55.0-preview.2` 临时覆盖了 Electron 包元数据，但仓库 `package.json` 仍是 `0.53.0`。应用内多处读取 `package.json` / `NEXT_PUBLIC_APP_VERSION` / packaged standalone 里的版本，因此 Info.plist 与 UI / runtime clientInfo 可能不一致。后续禁止只靠 `extraMetadata.version` 做 preview 版本。
2. **Codex 应用服务启动失败**：用户日志 `/Users/op7418/Downloads/codepilot-main_副本.log` 显示 packaged app 仍在以旧参数启动 Codex：`codex app-server --listen ...`，真实 Codex 0.133 报 `unexpected argument '--listen' found`。这说明该安装包没有包含当前 P0 修复，或打包输入/产物来源不受控。
3. **Claude Code 输入框一直“正在准备运行环境” / 模型加载中**：同一日志显示 `Claude Code compat API error: 503 model_not_found`，模型为 `sonnet` 时落到错误的渠道/别名：`分组 auto 下模型 sonnet 无可用渠道`。这同样属于 packaged smoke 必须覆盖的 Runtime P0，不能只看单元测试或开发态 smoke。

结论：`release-preview-p0-0.55.0-preview.2/` 这类本地临时产物只可作为**诊断样本**，不得继续给外部测试用户。下一个可分发包必须先修版本源、确认打包 commit、再走 packaged app 真实启动 smoke。

## 状态

| Phase | 内容 | 用户能看到什么 | 状态 | 备注 |
|-------|------|----------------|------|------|
| 0 | 预览边界与版本策略 | 不会静默升级；测试用户明确拿到 Preview 包 | ✅ 版本单源已修 | `package.json` + lock bump 到 `0.55.0-preview.4`（>0.54.0）；NEXT_PUBLIC_APP_VERSION / app.getVersion / Codex clientInfo 全部派生自 package.json，已核实。剩签名/绕过说明（P2，非阻断） |
| 1 | 必修用户可见问题 | Mac 通知、默认模型提示、Plan Widget、Windows shell 方言修正 | 🟢 源码已修，待 packaged smoke | 两个 runtime P0（Codex `--listen` / ClaudeCode `sonnet`）**已由 `6923f13` 在 HEAD 修复 + 回归 pin 通过**（坏包是 6923f13 之前的过时构建）；剩 packaged app 真机/CI smoke 确认 |
| 2 | Windows Preview Readiness | Windows 包不像 macOS 硬搬；命令默认 PowerShell 兼容 | 📋 待开始 | #28 代码已修（默认 PowerShell，bash 只认显式 opt-in），真机验收 blocking |
| 3 | macOS Preview Readiness | macOS 视觉与通知路径可验证；已知系统设置限制有说明 | 📋 待开始 | #34 链路已确认 delivered/acked，真机通知权限核查 blocking |
| 4 | 打包与安装验证 | macOS / Windows 安装包能安装、启动、跑核心 smoke | 🔄 workflow 就绪，待 CI run | 旧 macOS 包废弃；下次只打 macOS arm64 + Windows x64，经 `preview-build.yml` 产出（用户触发） |
| 4A | GitHub Preview CI | 用 CI 产出可复现 artifacts，减少本机环境漂移 | ✅ 已加 `preview-build.yml` | `workflow_dispatch`（输入 preview_version / build_macos_arm64 / build_windows_x64 / commit_sha）；verify-source gate（typecheck + 6923f13 回归 pin + 全量单测）→ 版本单源 patch（非 extraMetadata，diff 上传 audit）→ mac arm64 / win x64 构建 → 版本 + native ABI 校验 → 只传 artifacts/SHA/commit/logs，**不建 Release、不推 tag**（`permissions: contents: read` + `--publish never`） |
| 5 | 小范围试用与反馈闭环 | 用户知道测什么、怎么回滚、怎么报问题 | 🔄 进行中 | 预览包说明 + P0 反馈表见 [`docs/preview/branch-preview-2026-05-31.md`](../../preview/branch-preview-2026-05-31.md) |
| 6 | 合并 / 不合并决策 | 有明确 go/no-go 标准 | 📋 待开始 | 不用聊天拍脑袋 |

## 发布边界

### 本轮要做

- 从当前 worktree 分支打 **Branch Preview Build**。
- 产物至少包含：
  - macOS Apple Silicon 包。
  - Windows x64 NSIS 包。
- 本轮不再构建 macOS x64。原因：用户明确要求只打 ARM；本地 arm64 机器跨打 x64 会反复污染 `node_modules/better-sqlite3` 架构，且没有 Intel 真机 smoke。
- 修掉预览包前会直接误导用户或破坏基础信任的 blocker：
  - **P0 packaged regression**：版本必须高于 `0.54.0` 且 app 内外一致；Codex app-server 不得再用 `--listen` 旧参数；ClaudeCode 不得卡在"正在准备运行环境" / `sonnet` model_not_found。
  - #34 macOS 定时任务通知：**链路已确认工作**（Codex 真实 smoke：renderer-toast + electron-native 均 delivered/acked；0605b80 已加观测）。**非代码 bug**——"没看到前台横幅" = macOS 前台应用抑制横幅 / 通知权限样式。本阶段只需**真机核查通知权限 + 前台展示策略**（必要时让聊天内 fallback 更显眼），不改链路代码。
  - #27 默认模型 `pin-incomplete` 被误报为当前执行环境不可用。**✅ 已修（e1ccb3b，code+test）**
  - #26 Native Plan 模式无法创建 Widget。**✅ 已修（f32275f，code+test）**
  - #28 Windows 版脚本命令仍偏 bash。**✅ 代码已修（970a1fa + d6e9d96）**：Windows 默认 PowerShell，bash 只认显式 `CLAUDE_CODE_GIT_BASH_PATH`（不再"检测到 Git Bash 就允许 bash"）。**Windows 真机验收待**（本阶段做）。
- 保留保守默认：
  - 不把 `opus` 默认切到 Opus 4.8；只保留显式 `opus-4-8`。
  - 不自动开启高副作用能力。
  - 不把 deferred 能力包装成"已完全支持"。

### 本轮不做

- 不合并 main。
- 不推送正式 release，不开启自动更新。
- 不把 preview 包伪装成稳定版。
- 不做 Windows 全量 Fluent 重设计；只做 preview 必需的平台正确性与壳层 smoke。
- 不做 Liquid Glass / liquid-dom POC；该方向已经暂缓，不混入预览包收口。
- 不清空所有非阻塞 tech-debt；只修发布前 blocker。

## Phase 0：预览边界与版本策略

### 用户能看到什么

测试用户拿到的是一个明确标注的 **Preview / Beta** 包，而不是静默覆盖稳定版。用户知道这是分支预览，反馈目标是 Runtime / MCP / Windows / macOS 视觉与通知，而不是正式升级。

### 不做什么

- 不把预览版本写成正式 release 号。
- 不把包挂到正式自动更新渠道。
- 不承诺现有用户会自动迁移到这个版本。

### 怎么验收

- Release notes / 分发说明中明确：
  - 分支：`worktree-product-refactor-research`
  - Preview 性质：小范围试用，不是稳定推送。
  - 已知问题与回滚方式。
- 包名或版本号含 preview / beta 标识，例如 `0.55.0-preview.N`。
- app 内 About、`app.getVersion()`、`NEXT_PUBLIC_APP_VERSION`、Codex clientInfo version、`latest-mac.yml`、DMG/ZIP/EXE 文件名显示同一个 preview version。
- `git status` 干净，`git log --oneline -5` 可读，记录最终打包 commit。

### 实现路径（不需用户审阅）

1. **版本单源策略（P0）**：打包前用 commit 改 `package.json` + `package-lock.json` 到 `0.55.0-preview.N`（或后续用户指定版本），并让构建脚本从同一源派生 `NEXT_PUBLIC_APP_VERSION`。禁止只用 `electron-builder --config.extraMetadata.version=...` 覆盖，因为这只保证部分 Electron metadata，不能保证 renderer / API / Codex clientInfo / standalone package 全部一致。完成后用 packaged app 验证：
   - `plutil` 读 `CFBundleShortVersionString`。
   - app 内 About 显示。
   - `/api/app/updates` 当前版本。
   - `codex app-server initialize` 的 `clientInfo.version`。
2. **数据目录（用户 2026-05-29 决定：不隔离）**：preview 沿用 `appId=com.codepilot.app` / `productName=CodePilot` / `~/.codepilot`。**核实迁移机制后风险可控**（修正最初 review 的过度标定）：`db.ts` 用 `PRAGMA table_info` 按列存在性做**增量迁移**（49 ALTER ADD + 41 CREATE IF NOT EXISTS），**无 `user_version` 单调版本门、无"schema 太新即拒绝"上界**——stable 打开被 preview 向前迁移过的 DB 不会被拒，只补自己认识的列、忽略多出的列/表，**回滚基本安全**。残留风险（试用说明必须写明）：① install **替换**用户 stable app（回滚 = 重装 stable 包）；② DB 向前迁移（基本可回滚，不保证 100%）；③ 一条非纯增量迁移 `db.ts:944 DELETE FROM api_providers WHERE protocol='openai-compatible'` 会清该类 provider（可重加）。→ **硬要求**：试用说明给一句"preview 会替换你的 CodePilot 并改其数据，装前先备份 `~/.codepilot/codepilot.db`"。（完全隔离 `productName="CodePilot Preview"` + 独立 `appId` + `CLAUDE_GUI_DATA_DIR=~/.codepilot-preview` 只有在需要 preview 与 stable **并存** / 保证零数据触碰时才做。）
3. **自动更新已禁用**：`electron/updater.ts` 已 DISABLED（运行时不检查更新）。本计划只需**确认 preview 构建保持禁用** + 不把产物上传到 `electron-builder.yml` 的 GitHub release feed（Phase 4 已有"不上传正式 Release"约束）。不需新增禁用动作。
4. **分发签名（P2）**：未签名 / 未公证的 DMG 在外部 Mac 被 Gatekeeper 拦、未签名 NSIS 触发 SmartScreen。确定 preview 是否签名；不签名则在试用说明给绕过指引（Mac 右键打开 / `xattr -dr com.apple.quarantine`；Win「更多信息 → 仍要运行」）。
5. 打包脚本使用 worktree 内代码；不得从主目录启动 dev / build。
6. Smoke Ledger 登记每个平台包的 commit hash、构建命令、产物路径、安装结果。

## Phase 1：预览前必修用户可见问题

> 这一 phase 消化 `post-refactor-cleanup.md`（已完成归档至 completed/）的 B/C——**代码已全部完成**，本 phase 只做真机 / 权限验收。Phase A（Opus 4.8 + Sonnet 4.6）已完成并 smoke；Phase D1（enforce）+ D2 均已完成：**D2 的 unit flake 已用 per-worker temp DB 隔离根治**（commit cd2a024），剩 13 个 React Compiler error 拆 tech-debt #35（on-touch，不作为 preview blocker）。

### 用户能看到什么

- macOS：定时任务到点后有系统通知或明确 fallback，不再静默执行。
- Settings：默认模型缺少 provider pin 时不再误导用户"模型不可用"。
- Native Plan 模式：仍能生成 Widget。
- Windows：Agent 给出的脚本命令默认是 Windows 可执行的 PowerShell / CMD 语法。

### 不做什么

- 不重写整个任务系统。
- 不重写 Settings 健康检查。
- 不扩大 Plan 模式权限。
- 不做 Windows 全 UI 重设。

### 怎么验收

| 问题 | 验收 |
|------|------|
| packaged P0: Codex app-server | packaged app 日志中不再出现 `codex app-server ... --listen` / `unexpected argument '--listen'`；Settings Runtime 显示 Codex ready 或 installed_idle 的正确状态；发一条 Codex Account / Codex Runtime smoke 不报应用服务启动失败 |
| packaged P0: ClaudeCode 准备运行环境 | packaged app 中 ClaudeCode Runtime 输入框不再长期停在"正在准备运行环境"；`sonnet` / 默认模型解析不再落到 `model_not_found`；至少跑一条 ClaudeCode smoke marker |
| packaged P0: 版本显示 | packaged app 外部 metadata 与 app 内 UI 均显示同一 preview version，且高于 `0.54.0` |
| #34 Mac 通知 | 3 分钟定时任务触发后，macOS 系统通知弹出；如果系统权限阻止，聊天 / 状态区有可见 fallback；日志能说明通知出口是否调用 |
| #27 pin-incomplete | 构造 `default_mode='pinned'` + `default_model` 有值 + `default_model_provider` 缺失，Runtime / Health 文案都说"固定信息不完整"，不再说当前引擎不可用 |
| #26 Plan Widget | Native Plan 模式要求创建 Widget，能输出合法 `show-widget`；回归测试证明 `codepilot_load_widget_guidelines` 与 Widget prompt 保留，mutating 工具不保留 |
| #28 Windows shell | Windows shell fixture 中不出现 `export` / `source` / `rm -rf` / `/tmp` 等 bash-only 语法；真实或接近真实 Windows smoke 验证命令可复制执行 |

### 实现路径（不需用户审阅）

> **打包态运行时启动的症状 → 机制 → 分诊信号 → 需要的日志，已整理在 [`docs/research/packaged-preview-runtime-diagnosis-2026-05-31.md`](../../research/packaged-preview-runtime-diagnosis-2026-05-31.md)**（Codex「应用服务启动失败」= `spawn_failed` 三产生点的 reason 分诊；「正在准备运行环境」= 模型列表请求在途 + runtime 异步解析重取 + Codex app-server 冷启）。下面两条 packaged P0 的根因待该文所列日志确认。

- #34：先定位断点。区分 scheduler 未调用通知、Electron Notification API 被系统拒绝、IPC 丢上下文、Focus/权限阻止四类原因。加可观测日志后再修。
- packaged P0 / Codex：先确认当前 HEAD 是否包含 `6923f13 fix(runtime): unblock preview Codex and Claude Code startup` 等后续修复；再检查 packaged `dist-electron/main.js` 与 source 是否一致。用户日志里的 `--listen` 是旧协议参数，不允许靠 UI 文案绕过，必须在启动命令层修掉并加 packaged smoke。**「应用服务启动失败」= `spawn_failed`，reason 在屏幕「Codex 应用服务启动失败：<reason>」+ 日志，先读 reason 再定是过时构建(--listen)/旧版本/协议不匹配——见上方诊断文档。**
- packaged P0 / ClaudeCode：复现 `model_not_found sonnet` 的 resolver 输入，确认 packaged app 使用的 provider / model alias catalog 与 dev smoke 一致；把 "sonnet" 这种短别名解析到当前可用渠道，或在 packaged smoke 中明确失败。
- packaged P0 / 版本：修 package version 单源，详见 Phase 0。
- #27：给 `pin-incomplete` 独立文案与 severity，Runtime 页 / Health 页共用同一解释函数。
- #26：Plan 模式工具集合从硬编码 `Read/Glob/Grep` 改为派生保留 safe-read Harness 工具，Widget guideline 与 wire-format prompt 必须留下。
- #28：把 `platformShell` 纳入 Runtime / Harness context。Windows 默认 `powershell`；只有检测或用户选择 Git Bash / WSL 时才允许 bash。

## Phase 2：Windows Preview Readiness

### 用户能看到什么

Windows 用户打开包后，界面不是 macOS 壳层硬搬；模型生成的本地命令能按 Windows 语境使用。至少不会第一眼出现 bash-only 命令、标题栏按钮被遮挡、字体不对劲这类基础问题。

### 不做什么

- 不做完整 Fluent redesign。
- 不把 macOS Liquid Glass / floating card 视觉原样照搬到 Windows。
- 不强行实现所有 Windows 原生系统集成。

### 怎么验收

- Windows x64 包安装后可启动。
- Settings → Runtime / Chat / Models / Plugins 至少四个页面可打开。
- 标题栏按钮安全区正常；关闭 / 最小化 / 最大化可用。
- 默认字体为 Segoe UI / Segoe UI Variable 系列。
- 发送一个要求"给我一条创建目录并写文件的命令"的 prompt，输出为 PowerShell / Windows 兼容命令。
- Console / app log 无新增 P0/P1 error；已知 noise 必须登记。

### 实现路径（不需用户审阅）

1. renderer root 注入 `data-platform='win32'` 后，确认回退到**默认产品 token**——7b 只实现了 macOS profile，Windows 无专属材质层，走默认 token = 符合预期（不是 bug，别误以为有 Windows 材质层要验）。
2. 检查 Electron Windows `titleBarOverlay` / Mica 设置与当前样式是否冲突。
3. 为 shell dialect 增加 Windows unit / fixture 测试。
4. 如果本机没有 Windows 环境，至少产出 Windows smoke checklist，让真实 Windows 机器执行并登记结果；不能用 macOS 结果代替 Windows 结果。
5. **构建环境（P1，Codex review 2026-05-29）**：Windows 包**必须在 Windows 机器 / Windows CI 上构建**——`scripts/after-pack.js` 为目标 ABI 重建 better-sqlite3，但原生 `.node` 无法从 macOS 交叉编译出可用的 Windows 版。在 Mac 上 `electron:pack:win` 的产物会带 Mac 二进制 → Windows 一读 DB 即崩。这是 Windows preview 的**构建前提**，不是测试项；上面第 4 点只解决"测试"，不解决"构建"。

## Phase 3：macOS Preview Readiness

### 用户能看到什么

macOS 预览包保留本轮新视觉，但不因为透明 / vibrancy / floating cards 牺牲可用性。定时任务提醒、Runtime 切换、Codex / ClaudeCode / Native 三引擎核心路径可用。

### 不做什么

- 不继续追 liquid-dom / WebGPU 玻璃 POC。
- 不重开 7b Phase 3-5。
- 不为了视觉微调继续改 layout primitive，除非发现 P0/P1 视觉遮挡。

### 怎么验收

- macOS 包安装后启动。
- Chat 默认页、已有会话、Settings Runtime、素材库、Plugins 可打开。
- floating cards 底部圆角 / 阴影没有明显脏边或遮挡。
- 关窗后后台行为符合预期；定时任务通知见 Phase 1 #34。
- 三 Runtime smoke：
  - ClaudeCode：Sonnet 4.6 / Opus 4.8 marker。
  - Native：OpenRouter Opus 4.8 marker。
  - Codex：Memory / Widget / Tasks / Dashboard / CLI 核心能力至少抽样。

### 实现路径（不需用户审阅）

- 用 Electron 实包而不是 Browser-only 截图验 macOS 壳层；Browser 只作为 DOM / layout 辅助。
- **确认并 pin 整窗 vibrancy 值（P2，Codex review 2026-05-29）**：dev 实测当前是 `vibrancy:'menu'`，不在 7b 评估过的候选（`sidebar` / `under-window` / `content`）内。preview 前确认这是有意还是遗留；若不定稿，在已知问题里写明 macOS 底材质未最终确定，避免试用反馈"视觉"时无基准。
- 检查 macOS Reduce Transparency / wallpaper tinting 对视觉的影响，必要时在已知问题里说明。
- 对 macOS 系统通知必须同时记录系统权限状态与 app 内 dispatch 日志。

## Phase 4：打包与安装验证

### 用户能看到什么

测试用户拿到可安装、可启动、可回滚的包；不是一堆开发命令。

### 不做什么

- 不上传正式 GitHub Release。
- 不推 tag。
- 不自动发布到 stable channel。

### 怎么验收

| 平台 | 产物 | 必验 |
|------|------|------|
| macOS arm64 | DMG / zip | 安装、启动、版本显示、Codex status、ClaudeCode smoke、Settings Runtime |
| Windows x64 | NSIS | 安装、启动、版本显示、标题栏、Settings、Chat、PowerShell 命令 smoke |

### 实现路径（不需用户审阅）

1. 构建前清理 release 输出目录和 `.next/`，但不要清工作区或 DB；确认旧 `release-*` 不会被 Next standalone trace 进新包。
2. 记录实际命令和耗时。
3. 记录产物 sha / 文件大小。
4. 验证包内 native module：
   - `ELECTRON_RUN_AS_NODE=1 <PackagedAppBinary> -e "require('<app>/Contents/Resources/standalone/node_modules/better-sqlite3')"` 必须输出 Electron ABI `143` 且成功。
   - 打包后恢复 worktree 本地 `node_modules/better-sqlite3` 到 Node ABI，避免污染后续测试。
5. 安装后 smoke 结果写入本计划 Smoke Ledger。

## Phase 4A：GitHub Preview CI / 可重复打包基础设施

### 用户能看到什么

测试包不再依赖某台开发机的本地状态、临时 config、临时 xcodebuild shim 或手工记忆。每个 preview 包都能追溯到 GitHub Actions run、commit、artifact、hash 和 smoke 结果。

### 不做什么

- 不创建正式 GitHub Release。
- 不推 tag。
- 不走 stable auto-update feed。
- 不在 CI 里读取真实用户凭据；真实账号 smoke 仍由本机/测试机执行。

### 怎么验收

- GitHub Actions 有一个 `workflow_dispatch` preview workflow，输入：
  - `preview_version`，例如 `0.55.0-preview.4`。
  - `build_macos_arm64` / `build_windows_x64`。
  - `commit_sha` 或默认当前分支 HEAD。
- macOS job 只产出 arm64 DMG/ZIP；Windows job 只产出 x64 NSIS。
- 每个 job 上传：
  - installer artifact。
  - SHA-256。
  - `git rev-parse HEAD`。
  - package version check。
  - native module ABI check。
  - build logs。
- CI 不发布 Release，只上传 workflow artifacts；分发说明从 artifacts 生成或手工引用。

### 实现路径（不需用户审阅）

1. 复用现有 `.github/workflows/build.yml` 里的 build/test/packaging 知识，但新增 `preview-build.yml`，避免污染正式 release workflow。
2. Windows 包必须在 `windows-latest` 上构建；这是 better-sqlite3 / zlib-sync 等 native module 的正确平台。
3. macOS arm64 优先使用 GitHub 可用的 arm64 macOS runner；如果仓库没有 arm64 runner 权限，则保留本机 arm64 构建，但 CI 仍负责 Windows 包和通用校验。
4. preview workflow 的第一步必须把 `package.json` / lockfile version 设置为输入的 preview version 并提交到工作分支，或在 checkout 后做一次可审计的 version patch 并把 patch diff 上传为 artifact。**不能只用 electron-builder extraMetadata。**
5. CI smoke 分层：
   - 无凭据：启动 packaged app / main process dry-run / native module ABI / settings route if possible。
   - 有测试凭据（后续可选，用 GitHub Environments + Secrets）：只跑非破坏性 provider smoke，输出 marker。
   - 不在 CI 做真实用户数据迁移；真实安装覆盖测试仍走本机/测试机。

## Phase 5：小范围试用与反馈闭环

### 用户能看到什么

试用用户知道该测什么、哪里可能有问题、怎么回滚；反馈能被分级，不会混成一堆聊天记录。

### 不做什么

- 不开放大范围自动升级。
- 不把所有反馈都承诺进 preview 版修完。

### 怎么验收

- 给测试用户的说明包含：
  - 重点测试清单。
  - 已知问题。
  - 回滚方式。
  - 日志 / 截图反馈方式。
- 反馈按 P0/P1/P2 分类：
  - P0：启动、发送、数据损坏、无法回滚。
  - P1：核心 Runtime / MCP / Windows 命令 / macOS 通知不可用。
  - P2：视觉、文案、轻微交互。
- P0/P1 必须在合 main 前关闭或明确 defer 并得到用户同意。

## Phase 6：合并 / 不合并决策

### 用户能看到什么

不是“感觉差不多就合”。合 main 前有明确的通过标准；如果不合，也知道还差什么。

> **两道门，别混（Codex review 2026-05-29）**：① **Ship-to-testers 门槛**（能不能把 preview 发给试用用户）= Phase 1 blocker 全关 + 两平台安装 smoke 各一轮 + 数据隔离方案已定（Phase 0 实现路径 2）+ 签名 / 绕过说明就位。② **Merge-to-main 门槛**（下面的 Go / No-go）= 试用反馈 P0/P1 关闭后才评估。**先过 ① 才发包，试用后再谈 ②**——下面的 Go 标准是 ② 的，不要拿它当发包门槛。

### Go 标准

- Phase 1 blocker 全部关闭。
- macOS + Windows preview 包至少各有一轮真实安装 smoke。
- 三 Runtime 核心路径 smoke 无 P0/P1。
- Settings Runtime 能力清单与实际能力没有明显相反承诺。
- 已知问题写入 release notes / tech-debt tracker。
- 用户确认可以合 main。

### No-go 标准

- 任一平台包无法启动。
- 预览包 app 内仍显示 `0.53.0` 或任何低于 `0.54.0` 的版本。
- macOS packaged app 日志出现 `codex app-server` 的旧 `--listen` 参数。
- ClaudeCode packaged app 仍卡在"正在准备运行环境"或默认 `sonnet` 解析到 `model_not_found`。
- Windows 仍默认输出 bash-only 命令。
- Mac 定时任务仍静默无通知 / 无 fallback。
- Runtime 选择 UI 与实际运行 runtime 不一致。
- Provider / model resolver 出现用户无法自行恢复的错误。
- **不隔离时未在试用说明告知"preview 会替换 stable + 改其数据、需先备份 `~/.codepilot/codepilot.db`"**（共用本身可接受——迁移无版本门、增量；不可接受的是不告知/不给备份指引，见 Phase 0 实现路径 2）。
- **外部测试用户因 Gatekeeper / SmartScreen 打不开包，且未提供绕过指引**。

## Smoke Ledger（真实凭据 / UI / E2E 验证记录）

> 跑了真实 smoke 后必须追加一行。Preview 包 smoke 不能只写"我试了可以"，必须写平台 / runtime / provider / 场景 / 结果 / 证据。

| Date | Platform | Runtime | Provider / Model | 凭据形态 | 场景 | Result | Evidence |
|------|----------|---------|------------------|---------|------|--------|----------|
| 2026-05-29 | macOS dev | native | OpenRouter / `anthropic/claude-opus-4.8` | 本机 OpenRouter provider | Phase A Opus 4.8 marker | ✅ | `OPENROUTER_OPUS48_OK`；登记于 `post-refactor-cleanup.md` |
| 2026-05-29 | macOS dev | claude_code | Claude Code account / `claude-opus-4-8` | 本机 Claude Code 授权 | Phase A Opus 4.8 两轮 | ✅ | `OPUS48_CLAUDE_ACCOUNT_A_OK` / `B_OK`；登记于 `post-refactor-cleanup.md` |
| 2026-05-29 | macOS dev | claude_code | OpenRouter / `anthropic/claude-sonnet-4.6` | 本机 OpenRouter provider | #23 Sonnet 4.6 两轮 | ✅ | `SONNET46_SMOKE_A_OK` / `B_OK`；登记于 `post-refactor-cleanup.md` |
| 2026-05-31 | macOS packaged | N/A | N/A | N/A | Apple Silicon ad-hoc DMG 构建校验 | ✅ | `release-preview-2026-05-31/CodePilot-0.53.0-preview-2026-05-31-arm64.dmg`; SHA-256 `7965d9f51df41814c86785d0a16cc64966f5a9dc1692f35e0c10ee684ed285a8`; `codesign --deep --strict` + `hdiutil verify` 通过 |
| 2026-05-31 | macOS packaged | N/A | N/A | N/A | Intel x64 ad-hoc DMG 构建校验 | ✅ | `release-preview-2026-05-31/CodePilot-0.53.0-preview-2026-05-31-x64.dmg`; SHA-256 `be65141fd48643439f0d95a9cd94e56cd3e5fe2ed686cf91a8096d22bd351bd0`; `codesign --deep --strict` + `hdiutil verify` 通过 |
| 2026-05-31 | macOS packaged | N/A | N/A | N/A | Developer ID 路径构建校验 | ❌ | `release/` 产物生成但 `codesign --verify --deep --strict` 失败；不分发给测试用户 |
| 2026-05-31 | macOS packaged | N/A | N/A | N/A | `0.55.0-preview.2` 本地临时包安装 smoke | ❌ | 用户实测：app 内仍显示 `0.53`；Codex app-server 启动失败；ClaudeCode 输入框一直"正在准备运行环境"。日志 `/Users/op7418/Downloads/codepilot-main_副本.log`：`Version changed from 0.54.0 to 0.53.0`、`codex app-server error: unexpected argument '--listen' found`、`model_not_found ... sonnet`。该包废弃，不再分发 |
| 2026-06-01 | dev (worktree) | N/A | N/A | N/A | 版本单源 bump 校验（P0-版本） | ✅ | `package.json` + lock（root + packages['']）= `0.55.0-preview.4`；NEXT_PUBLIC_APP_VERSION（next.config:48 派生）/ `app.getVersion`（Info.plist）/ Codex clientInfo（`readCodePilotVersion` 读 pkg.version）全部同源 |
| 2026-05-31 | dev (worktree) | N/A | N/A | N/A | 6923f13 P0 回归 pin（Codex/ClaudeCode） | ✅ | `codex-binary-discovery.test.ts` "spawns app-server without --listen" + `provider-resolver.test.ts` "canonicalizes short role-model aliases to upstream IDs" 全过 → 两个 runtime P0 在 HEAD 已修，坏包系 6923f13 前过时构建 |
| 待跑 | macOS arm64 packaged | TBD | TBD | TBD | `preview-build.yml` CI：版本显示 + native ABI + 启动（无凭据） | ⏳ | 用户触发 workflow_dispatch（preview_version=`0.55.0-preview.4`）|
| 待跑 | Windows x64 packaged | TBD | TBD | TBD | `preview-build.yml` CI：版本 + ABI + 启动（无凭据） | ⏳ | windows-latest job |
| 待跑 | macOS packaged | TBD | TBD | TBD | 真机安装 + Codex/ClaudeCode 真实凭据 marker | ⏳ | 用户本机安装 smoke（CI 不跑真实凭据）|
| 待跑 | Windows packaged | TBD | TBD | TBD | 真机安装 + Windows shell command smoke | ⏳ | |

## 详细自审 / Codex Review Checklist

### 一致性检查

- 本计划没有替代 `post-refactor-cleanup.md`，而是把其中 B/C 这两组 preview blocker 和打包门槛串成 preview 发布计划；E（design.md 横切规范）仍可并行，但不是预览包阻断项。
- 已完成的 Phase A / D1 不重新开工，只作为 preview 依赖记录。
- #28 被升级为 Windows preview blocker；这符合用户"Windows 也得打，所以 Windows 适配也得做"的最新决定。
- #34 被列为 macOS preview blocker；这符合用户明确纠正"我说的是定时任务的问题"后的上下文。

### 风险检查

- 最大技术风险：#28 需要三 Runtime 的 shell context 统一注入，不能只改一处 prompt。
- 最大打包风险：本地临时覆盖 version / 临时 config / 旧 release 目录污染会制造"看似成功、实包不可用"的假阳性。后续必须以 version 单源 + clean build + packaged smoke 为准。
- 最大产品风险：Windows 包如果没真实机器验证，不能说 Windows ready。
- 最大发布风险：preview 包被用户误以为 stable；Phase 0 必须先处理命名 / release notes / 回滚说明。
- 流程：D2 unit flake **已根治**（per-worker temp DB 隔离 + 禁测试迁移真实库，commit cd2a024 / 本轮 followup），提交不再被 flake 误挡；仍保持纪律——任何提交失败必须查明根因，不得用 `--no-verify` 混过去。

### 不变量

- 不合 main。
- 不推 tag。
- 不自动更新。
- 不切 `opus` 默认。
- 不把 experimental liquid glass POC 混入 preview。
- 不把未真实验证的平台写成已验证。
- 不再分发任何没有跑 packaged Runtime smoke 的本地临时包。

## 决策日志

- 2026-05-31（P0 复盘）：用户安装 `0.55.0-preview.2` 本地临时包后仍显示 `0.53`，并出现 Codex app-server 启动失败 + ClaudeCode 准备运行环境卡死。日志确认三个根因方向：版本源仍是 `package.json: 0.53.0`；Codex 启动命令仍带旧 `--listen` 参数；ClaudeCode 默认 `sonnet` 解析到 `model_not_found`。结论：此前本地包废弃；下次包必须先完成 version 单源、packaged app runtime smoke、再交付给测试用户。
- 2026-05-29（数据隔离决定）：用户决定**不隔离**，preview 共用 `~/.codepilot` + 同 appId/productName。核实 `db.ts` 迁移机制后确认风险可控（PRAGMA table_info 增量迁移、无 `user_version` 版本门、无 schema 上界拒绝 → 回滚基本安全），最初 review 的 P1-a"回滚不可逆"被**下调**为"需告知 + 备份提示"。硬要求只剩：试用说明写明 preview 替换 stable + 改数据 + 装前备份。完全隔离方案保留为"需 preview/stable 并存时"的可选项。
- 2026-05-31（macOS 包）：在 worktree `2606371` 产出 macOS ad-hoc preview 包。arm64 与 x64 DMG 均通过 app 签名校验和 DMG 校验；x64 本地 ad-hoc 签名失败根因是 Electron Framework 内无扩展名可执行 helper（如 `chrome_crashpad_handler`）未被 afterSign 脚本签入，已修 `scripts/after-sign.js` 后重打 x64。Developer ID 路径 `release/` 产物签名校验失败，不分发。Windows 包仍按本计划 Phase 2 要求在 Windows 构建。
- 2026-05-31（生成物隔离）：preview 输出目录采用 `release-*` 命名，已加入 `.gitignore` 和 `tsconfig.exclude`。原因：Electron 包内含 `standalone/` 源码副本，若留在 worktree 根目录被 `tsc` 扫入，会把包内站点源码 / fixture 源码误当仓库源码检查，导致 `npm run test` 失败。生成物可保留给测试用户取包，但不参与仓库自检。
- 2026-05-31（本机原生依赖恢复）：在 Apple Silicon 机器上构建 x64 macOS 包会让 `after-pack` 把 worktree 的 `node_modules/better-sqlite3` 重编成 x64；打包后必须执行 `npm rebuild better-sqlite3` 恢复 host 架构，否则本机单测会因 `ERR_DLOPEN_FAILED` 失败。这是本地打多架构 preview 的流程风险，不影响已产出的 DMG。
- 2026-05-29（review）：审查本计划。方向准确、与 `post-refactor-cleanup` A-E 状态无冲突（A 已完成/D1 已完成/D2 留债/E 并行，均不重新开工）。补 2 个 P1：(P1-a) preview 与 stable 共用 `~/.codepilot` + 同 appId/productName，DB 迁移与回滚不可逆 → Phase 0 增数据隔离硬约束 + No-go；(P1-b) Windows 包原生模块 better-sqlite3 无法从 Mac 交叉构建 → Phase 2 增"Windows 必须在 Windows 构建"前提。P2：分发签名/Gatekeeper 绕过指引（Phase 0）、Phase 3 pin vibrancy（dev 当前 `'menu'` 不在 7b 候选）、Phase 2 Windows-profile 措辞澄清（无专属材质层、走默认）、ship-to-testers 门槛与合 main 门槛分开（Phase 6）。P3：auto-update 已在 `electron/updater.ts` DISABLED，Phase 0 口径从"明确是否禁用"改为陈述事实。
- 2026-05-29：用户决定不直接合 main，倾向先从当前 worktree 打预览包给少量用户试用；随后补充 Windows 也必须打包，因此 Windows 方言 / Windows 包 smoke 升为 preview blocker。本计划创建，用于把 `post-refactor-cleanup` 的遗留修复、Windows readiness、macOS readiness、打包 smoke 与小范围试用闭环放到同一张发布门槛表里。
