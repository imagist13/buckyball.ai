> **Archive note（2026-06-05，document-system-governance）**：本计划已完成并移出 `active/`，归入 `completed/`——所列 blocker 已全部收口（见各 Phase 提交）。作为历史执行记录保留；当前任务入口见 [exec-plans README](../README.md)。

# Preview Final Blockers

> 创建时间：2026-06-02
> 最后更新：2026-06-02

## 状态

这份计划用于交给 Claude Code 执行：当前目标不是继续做新功能，而是把 0.55 preview 用户反馈里会阻断使用或明显影响信任的问题一次性收口，然后再进入合并前打包 smoke。

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | Scope freeze + 证据基线 | ✅ 完成 2026-06-02 | 明确 FileTree / Workflow 不进本轮；plan + 0.55.0-preview.5 内测说明落地，已对照代码评审 6 个 Phase 根因 |
| Phase 1 | Windows Codex 启动 / 登录 P0 | ✅ 完成 2026-06-02 | `.cmd` shim spawn EINVAL → `buildCodexLaunch` cmd.exe wrapper；真机 smoke 留 Phase 7 |
| Phase 2 | 中断任务后输入无响应 P0 | ✅ 完成 2026-06-02 | GitHub #578；force-abort 脱离 interrupt fetch `.finally`，先且无条件调度 |
| Phase 3 | Windows app shell / installer / packaged cache | ✅ 完成 2026-06-02 | single-instance lock / NSIS 可选目录 / 内存 cacheHandler 免 `.next/cache` 写盘 |
| Phase 4 | 新会话 provider / Mimo mapping | ✅ 完成 2026-06-02 | #577A=MiMo 缺 model 字段+stale 默认（非"覆盖"）；#577B=SDK result 后 catch 仍 emit error |
| Phase 5 | 两个用户体验阻断 | ✅ 完成 2026-06-02 | 移除发送阶段 permission-elevation checkpoint；fullscreen dialog close 让出 Windows WCO |
| Phase 6 | 日志噪音与非阻塞记录 | ✅ 完成 2026-06-02 | Feishu bot info 改用 `client.request` 文档端点；失败每进程仅记一次 |
| Phase 7 | Packaged smoke + 合并准备 | 📋 待开始 | macOS arm64 + Windows 包，真实安装验证 |

## 用户会看到什么

- Windows 用户可以登录 / 使用 Codex Runtime，不再看到 `Codex app-server spawn failed: spawn EINVAL`。
- 中断一个构建 / 长任务后，可以继续在输入框里发送新消息。
- Windows 不再反复叠加托盘图标 / 后台进程。
- Windows 安装器允许选择安装目录（如果产品确认要开放）。
- Windows 默认安装目录启动不再刷 `Program Files/.../.next/cache` 权限错误。
- full access 模式只在开启时确认一次，发送时不再每轮阻断。
- Windows 编辑服务商界面右上角不会出现两个关闭按钮贴得很近。
- 新会话不再“先正常回答、再追加一条 provider error”；Mimo 用户配置不会被默认值覆盖。

## 本轮明确不做

- GitHub #576 右侧文件树：用户在 macOS 5.5 preview 复测正常，本轮不作为 blocker。若 Windows 或特定会话仍能复现，再单独开。
- GitHub #574 Workflow：用户明确暂不处理。
- 新 Runtime / 新模型 / 新视觉改造：不进入本轮。
- 不合 main、不推送、不发正式更新通知。本轮目标只是得到可测试 preview 包。

## 事实与证据

### 用户反馈

| 来源 | 现象 | 本轮状态 |
|------|------|----------|
| Windows 用户截图 / 日志 | `Error: Codex app-server spawn failed: spawn EINVAL` | P0 |
| Windows 用户反馈 | 关闭菜单 / 窗口后托盘图标重复增加，任务管理器有多个后台任务 | P1 |
| Windows 用户反馈 | 安装时不能选择安装位置 | P1 |
| GitHub [#578](https://github.com/op7418/CodePilot/issues/578) | 构建任务中断后，再在输入框中点击发送无响应 | P0 |
| GitHub [#577](https://github.com/op7418/CodePilot/issues/577) | 新会话正常回答后追加 provider error；Mimo mapping 回退 | P1 |
| 用户截图 | full access 下每次发送都要点“已了解，继续发送” | P1 |
| 用户截图 | Windows 编辑服务商时系统关闭按钮和应用内关闭按钮太近 | P1 |
| Windows 日志 | `EPERM: operation not permitted, mkdir 'C:\Program Files\CodePilot\resources\standalone\.next\cache'` | P1 |
| Windows 日志 | Feishu bridge 每分钟 `Cannot read properties of undefined (reading 'v3')` | P2 |

### 本地代码证据

- Codex Windows binary discovery 会把 `.cmd` 列为候选：`src/lib/codex/app-server-manager.ts`。
- Codex app-server 当前直接 `spawn(binary, ['app-server'])`；Windows `.cmd` shim 不应按普通 executable 直接启动。
- `electron-builder.yml` 当前 `nsis.allowToChangeInstallationDirectory: false`，与“安装不能选目录”一致。
- Electron 主进程内 `ensureTray()` 有单进程 guard，但未见 `app.requestSingleInstanceLock()`；如果用户多次启动多个 CodePilot 进程，每个进程都会有自己的 tray。
- `provider-catalog.ts` 里的 Xiaomi MiMo preset 仍指向 `mimo-v2-pro`，与用户反馈 v2.5/v2.5pro mapping 回退高度相关。

### 外部文档依据

- Node.js 官方 child_process 文档：Windows 的 `.bat` / `.cmd` 不能像普通 executable 一样直接启动，通常需要 shell / `cmd.exe` 路径处理。
  - https://nodejs.org/api/child_process.html
- Electron 官方 app 文档：`app.requestSingleInstanceLock()` 用于保证单实例，并通过 `second-instance` 将后续启动转回已有实例。
  - https://www.electronjs.org/docs/latest/api/app
- electron-builder NSIS 文档：`allowToChangeInstallationDirectory` 是 NSIS 安装目录选择开关。
  - https://www.electron.build/nsis/

## Phase 0 — Scope freeze + 证据基线

### 用户能看到什么

没有 UI 变化。这一步只保证 Claude Code 不把已经 defer 的问题重新拉进范围，也不把修复扩大成新功能。

### 实现路径

- 读本计划 + `docs/exec-plans/tech-debt-tracker.md` 对应 #11-#22。
- 确认 worktree 为 `worktree-product-refactor-research`，禁止在主目录改代码。
- 保留当前用户日志 / 截图引用；如需要新增证据，追加到本计划的 Smoke Ledger 或 `docs/preview/`，不要只留在聊天里。

### 验收

- `git status` 明确只在 worktree 修改。
- 不触碰 FileTree / Workflow 代码。

## Phase 1 — Windows Codex app-server spawn EINVAL

### 用户能看到什么

Windows preview 包里，Codex 登录 / 启动不再报 `spawn EINVAL`；Settings 执行引擎不再长期 degraded；聊天里 Codex Runtime 能正常开始运行。

### 根因假设

Windows 日志显示选择了：

```text
C:\Users\tyler\AppData\Roaming\npm\codex.cmd
args: ['app-server']
```

当前 app-server 路径直接 `spawn(binary, ['app-server'])`。Node 官方文档指出 Windows `.bat` / `.cmd` 不是普通 executable，直接启动容易失败。这里应当把 `.cmd` / `.bat` 和真实 `.exe` 分开处理。

### 实现路径

- 新增一个小的 Codex binary launch helper，不要把平台分支散落在 `getCodexAppServer()`。
- Windows candidate 排序建议：
  - 优先真实 `.exe`。
  - `.cmd` / `.bat` 允许作为 fallback，但启动时用 `cmd.exe /d /s /c` 或明确 `shell` 策略，并保证参数安全转义。
  - `windowsHide: true`，避免弹黑窗。
- `probeCodexVersion()` 也要用同一个 Windows shim 策略，否则 `.cmd` 版本探测仍会失败并排序不稳定。
- 继续保留 macOS Codex.app fallback 与 PATH 新版本优先策略。

### 验收

- 单测覆盖：
  - Windows `.exe` candidate 直接 spawn。
  - Windows `.cmd` candidate 走 cmd/shell wrapper，不直接 `spawn(codex.cmd, ['app-server'])`。
  - version probe 对 `.cmd` 同样可用。
  - macOS / Linux 路径不变。
- Windows packaged smoke：
  - Settings → 执行引擎 → Codex 状态不报 spawn EINVAL。
  - Codex 登录 / 模型列表 / 发送一条消息。

## Phase 2 — 任务中断后输入框发送无响应

### 用户能看到什么

用户中断一个构建任务或长任务后，可以立刻继续输入并发送；输入框不会卡在“运行中 / 准备中 / disabled”状态。

### 根因假设

GitHub #578 只有截图，结合代码路径，优先怀疑：

- interrupt 后 stream snapshot 没有稳定进入 completed / aborted。
- `isStreaming` 长时间为 true，导致新消息进入 queue 但 dequeue 条件永远不满足。
- abort controller / pending optimistic message / permission state 没清干净。

### 实现路径

- 从 `stream-session-manager.stopStream()` 和 `ChatView.sendMessage()` / dequeue effect 查起。
- 找到 interrupt 成功、interrupt 失败、2s force abort 三条路径是否都发出终止事件。
- UI 层不要只依赖一个容易卡住的 `isStreaming`；必要时用 stream snapshot terminal status 兜底。
- 需要补一个最小复现测试：创建 streaming snapshot → interrupt → 后续 sendMessage 可达。

### 验收

- 单元或组件测试覆盖 interrupt 后可再次发送。
- 手动 smoke：
  - 触发一个会持续执行的任务。
  - 点击中断。
  - 立刻输入新消息并发送。
  - 看到新消息进入正常流。

## Phase 3 — Windows app shell / installer / packaged cache

### 3.1 单实例 + Tray 重复

#### 用户能看到什么

Windows 上无论重复点击快捷方式、关闭窗口、从托盘打开，都只保留一个 CodePilot 托盘图标和一个后台主进程。

#### 实现路径

- 在 Electron app ready 前引入 `app.requestSingleInstanceLock()`。
- 第二个实例启动时：
  - 阻止新进程继续初始化 tray/server。
  - 唤起已有窗口或显示已有窗口。
- 退出路径仍由 tray Quit 触发；不要破坏 menubar resident 模式。

#### 验收

- 单测 / source pin：主进程必须调用 `requestSingleInstanceLock()`，失败时 `app.quit()`。
- Windows packaged smoke：
  - 双击启动两次。
  - 只出现一个 tray icon。
  - 任务管理器只有一个主 CodePilot app 进程树。

### 3.2 安装目录选择

#### 用户能看到什么

Windows 安装器提供安装路径选择入口。

#### 实现路径

- `electron-builder.yml` 的 NSIS 配置从 `allowToChangeInstallationDirectory: false` 改为 `true`。
- 如 electron-builder 还需要非 one-click 模式，确认 `oneClick: false` 已保持。

#### 验收

- Windows 安装器 smoke：能选择安装路径。

### 3.3 Program Files 下 `.next/cache` EPERM

#### 用户能看到什么

默认安装到 `C:\Program Files\CodePilot` 后启动不再出现 `.next/cache` 权限错误。

#### 根因假设

Packaged standalone 不应该向 `resources/standalone/.next/cache` 写入运行时 cache；这一路径在 Program Files 下不可写。

#### 实现路径

- 定位触发 `.next/cache` mkdir 的代码路径。
- packaged 环境下禁用此 cache，或重定向到 `app.getPath('userData')` 下的可写目录。
- 不要把 cache 写回安装目录。

#### 验收

- Windows packaged log 无 `EPERM ... .next/cache`。
- 应用仍能启动和加载页面。

## Phase 4 — 新会话 provider error + Mimo mapping 回退

### 用户能看到什么

新建聊天不再出现“正常回答后又追加一条 provider error”；Mimo 用户设置的 v2.5/v2.5pro 不再被默认 v2 pro 覆盖。

### 根因假设

- 当前 Xiaomi MiMo preset 仍以 `mimo-v2-pro` 为默认；如果 refresh / eager seed / materialized provider model 逻辑优先 preset，用户自定义 mapping 可能被覆盖。
- 新会话比旧会话更容易走默认 resolver；旧会话可能保留了历史 provider/model pin。
- “正常回答后追加错误”可能是 stream 已完成后另一路状态 / provider probe / secondary request 继续发出 error。

### 实现路径

- 加一个 DB 集成测试：
  - 建 Xiaomi MiMo provider。
  - 写入用户自定义 model mapping（v2.5/v2.5pro）。
  - 走 `resolveProvider()` / `toAiSdkConfig()` / `/api/providers/models`。
  - 断言用户 mapping 不被 preset 覆盖。
- 检查新会话创建时默认 provider/model 的来源。
- 对 stream result/error 顺序加 guard：如果 result terminal 已落，不应再追加 unrelated provider error 到同一 assistant turn。

### 验收

- Mimo mapping regression test。
- 手动 smoke：
  - 新建聊天。
  - 用 Anthropic Third-party API provider 发一条。
  - 只出现正常回答，不追加 provider error。

## Phase 5 — 两个用户体验阻断

### 5.1 full access 二次确认

#### 用户能看到什么

切到 full access 时仍会有一次明确风险确认；之后每次发送不再弹“当前是完全访问权限 / 已了解，继续发送”的阻断横幅。

#### 根因

现在有两层确认：

- `ChatPermissionSelector` 切换 full access 时已经有 AlertDialog。
- `RunCheckpoint` 又在发送时触发 `permission-elevation` checkpoint。

这会把同一风险确认重复收取，尤其 full access 用户会每轮被打断。

#### 实现路径

- 保留切换 full access 的确认。
- 移除或禁用发送阶段的 `permissionElevationPending` checkpoint。
- 如果仍想提醒，改成非阻塞状态：例如 composer 权限 chip / RunCockpit 里显示 full access，不阻止 send。

#### 验收

- 切到 full access：出现一次确认。
- 连续发送两条：都不再出现阻断横幅。
- default 权限 / context-cost checkpoint 不受影响。

### 5.2 Windows 服务商编辑两个 X 太近

#### 用户能看到什么

Windows 下编辑服务商窗口 / 面板右上角不会有应用内关闭按钮贴着系统窗口关闭按钮。

#### 实现路径

- 找到 provider edit UI 的容器类型：是独立 BrowserWindow / Dialog / Sheet / page panel。
- Windows 平台下给应用内 close button 加 titlebar safe-area，或在该窗口模式下隐藏应用内 close button。
- 不影响 macOS 视觉，不改变表单内容。

#### 验收

- Windows 截图验证两个关闭入口不重叠、不贴脸。
- 键盘 Esc / 保存 / 关闭仍正常。

## Phase 6 — Feishu identity 日志噪音

### 用户能看到什么

如果用户启用了 Feishu bridge，后台不再每分钟刷 `Cannot read properties of undefined (reading 'v3')`。

### 实现路径

- 查 Feishu client 初始化：是否 SDK import 形态变化导致 `client.contact.v3` 或类似字段不存在。
- 如果缺配置，应降级为明确的配置错误，不要每分钟抛 TypeError。
- 这项不挡 Codex / Preview 主线，可单独提交。

### 验收

- bridge 未配置：不刷 TypeError。
- bridge 已配置：bot info 可获取，或显示明确的配置缺失。

## Phase 7 — Packaged smoke + 合并准备

### 用户能看到什么

拿到一个新的 macOS arm64 + Windows preview 包，用来做合并前最后内测。

### 验收清单

| 平台 | 场景 | 结果 |
|------|------|------|
| macOS arm64 | 启动、菜单栏图标、Claude Code、Codex、full access 连续发送 | 待填 |
| Windows | 安装可选目录、启动无 cache EPERM、单实例 tray、Codex 登录/发送、编辑服务商 close button | 待填 |
| Windows | 中断任务后再次发送 | 待填 |
| Provider | Mimo / Anthropic Third-party API 新会话 | 待填 |

## Smoke Ledger（真实凭据 / UI / E2E 验证记录）

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _待跑_ | codex_runtime | Codex Account | gpt-5.5 | 用户登录 | Windows packaged Codex app-server + chat | 📋 | Windows 用户机器 / log |
| _待跑_ | claude_code | Claude Code | sonnet | 用户本机授权 | full access 连续发送两条 | 📋 | screenshot / session id |
| _待跑_ | codepilot_runtime | Xiaomi MiMo | v2.5/v2.5pro | API key | 新会话不追加 provider error | 📋 | provider id / session id |

## 给 Claude Code 的执行摘要

请在 `worktree-product-refactor-research` worktree 内执行，不要改主目录，不要 push。先读本计划和 `docs/exec-plans/tech-debt-tracker.md` #11-#22。

优先顺序：

1. Phase 1 Windows Codex `.cmd` spawn EINVAL。
2. Phase 2 任务中断后输入无响应。
3. Phase 3 Windows single-instance tray / installer dir / packaged cache。
4. Phase 5 full access 二次确认 + Windows 服务商编辑 close button。
5. Phase 4 provider/Mimo。
6. Phase 6 Feishu 日志噪音。

每个 Phase 独立 commit。交付时必须写：根因、改动、测试、手动 smoke。如果某项只能在 Windows 真机验证，代码侧先加 source/regression guard，并把 smoke 留到 Phase 7 表格。

## 决策日志

- 2026-06-02：用户确认 GitHub #576 文件树在 macOS 5.5 正常，Workflow 暂不处理；本计划把两者排除出合并前 blocker。
- 2026-06-02：新增 full access 二次确认和 Windows provider edit 双 X 过近为本轮收尾问题；前者为高优先级，因它每轮阻断发送。
- 2026-06-02：Codex 调研结论：Windows `.cmd` spawn 与 Node 官方文档行为一致，不能继续按普通 executable 处理；Windows tray 反馈更像缺 single-instance lock，而非单进程内重复 `ensureTray()`。
- 2026-06-02：Claude Code 评审计划并逐条对照代码（file:line）核对 6 个 Phase 根因。结论：Phase 1 / 3 / 5.1 / 6 根因成立。4 处调整：
  1. **Phase 2** 真正根因是 `stream-session-manager.stopStream()` 发起的 interrupt fetch **无超时**、终态在 `runStream()` catch 里异步落，后端慢/挂起时 `isStreaming`（= `snapshot.phase==='active'`）卡 true → 发送被入队但永不出队；不只是"snapshot 没进 completed"。修复需含 fetch 超时 + 同步终态兜底，并补 interrupt→再发送的最小复现测试（当前 0 覆盖）。
  2. **Phase 4** 两个根因均**未在代码坐实**：MiMo mapping 在 resolver 里 DB 行会 shadow preset，没找到 refresh/re-seed 覆盖用户 mapping 的路径（可能在 discover-models/apply 或 onboarding）；"回答后追加 provider error" 的前端 `useSSEStream` 收到 error 事件即 append（治标），根因在**后端 result 落地后仍 emit 了 error 事件**。按"先复现定位再改"执行。
  3. **Phase 5.2** provider 编辑是 in-app 模态 `Dialog`（`ProviderForm`）而非独立窗口；"两个 X 贴脸"实为与 Windows `titleBarStyle:'hidden' + titleBarOverlay`（WCO，右上角 44px 系统按钮）重叠。修法是 Windows 下让出 WCO 安全区 / 该模式隐藏 app 内 close，而非按独立窗口处理。
  4. **Phase 5.1** 触发条件已存在 `permissionElevationConfirmedFor`"确认一次"标志（`chat/page.tsx`），优先修它的持久化/重置（为何没记住已确认），而非删除整个 `permission-elevation` checkpoint；`context-cost-change` 拦截不受影响。与暂缓的 RunCheckpoint Round 3（`PermissionPrompt` 视觉收编）无冲突。
- 2026-06-02：**Phase 1 完成**。新增可注入平台的 `buildCodexLaunch()`：Windows `.cmd`/`.bat` shim 走 `cmd.exe /d /s /c "<整体加引号命令行>"` + `windowsVerbatimArguments`，`.exe`/macOS/Linux 仍直接 spawn（保持不带 `--listen` 的 app-server stdio 约定）；`getCodexAppServer` spawn launch spec，`probeCodexVersion` 改 `spawnSync` 复用同一 wrapper。单测覆盖 darwin/win .exe/.cmd/.bat/含空格路径/版本探测；本机 `spawnSync` 真机探测 Codex.app 0.135.0-alpha.1 status=0 无回归。Windows 真机 smoke 留 Phase 7。
- 2026-06-02：**Phase 2 完成**（GitHub #578）。根因：`stopStream` 把 2s force-abort 调度放在 interrupt fetch 的 `.finally()` 里，`/api/chat/interrupt` 挂起不 settle 时 `.finally` 不执行 → abort 永不触发 → `phase` 卡 `'active'` → ChatView `isStreaming`（= `phase==='active'`）把新消息入队却永不出队。修法：抽出可注入的 `stopStreamWith()`，**先且无条件**调度 force-abort（脱离 interrupt 结果），interrupt fetch 加 `AbortSignal.timeout` 上界。ChatView 无需改（dequeue 本就由 isStreaming 驱动）。单测 9 条 pin 调度顺序 / 终态守卫 / 无 `.finally` / fetch 有界；真机 interrupt→再发送 smoke 留 Phase 7。
- 2026-06-02：**Phase 3 完成**（Windows app shell / installer / packaged cache）。**3.1 单实例**：`electron/main.ts` 在 `app.whenReady` 前加 `app.requestSingleInstanceLock()`，抢锁失败者直接 `app.quit()`（不设 isQuitting），主实例 `second-instance` → `showMainWindow()`，whenReady 内对失败者早返回，避免重复 tray/后台 server。**3.2 安装目录**：`electron-builder.yml` `allowToChangeInstallationDirectory` false→true（oneClick 仍 false）。**3.3 cache EPERM**：standalone server cwd 在只读安装目录，Next 默认 FileSystemCache 写 `.next/cache` → EPERM；新增内存 `cache-handler.js`（Next16 CacheHandler：get/set/revalidateTag/resetRequestCache，null 删除、FIFO 上限 1000、按 tag 失效），`next.config` 接 `cacheHandler` + `cacheMaxMemorySize:0`；next/image 未使用，无独立 image cache。验证：`next build` 通过，cache-handler.js 已 trace 进 `.next/standalone/`，`required-server-files` 含 `cacheHandler: ../cache-handler.js` + `cacheMaxMemorySize:0`，standalone 输出无 `.next/cache`；handler 单测 7 条 + 配置/源码 pin 8 条。3.1 单实例 / 3.2 安装目录 / 3.3 真机 EPERM-gone smoke 留 Phase 7。
- 2026-06-02：**Phase 5 完成**（两个 UX 阻断）。**5.1 full access 二次确认**：切到 full access 时 `ChatPermissionSelector` 已弹一次 AlertDialog 确认，但 `run-checkpoint.ts` 的 `permission-elevation` checkpoint 又在每次发送拦一道（"已了解，继续发送"），且 `/chat`→`/chat/[id]` 重挂载使 confirmed 标志丢失 → 几乎每条都拦。修法：移除 send 阶段 `permission-elevation` checkpoint（含 `CheckpointReasonId`/`CheckpointActionId` 联合成员、`permissionElevationPending` 选项、两个入口的 `permissionElevationConfirmedFor` state/effect/handler、RunCheckpoint 的 actionId 分支）；保留切换时的一次性 AlertDialog + 持久红色 full-access chip 作为确认与可见性；`context-cost-change` 拦截不受影响；与暂缓的 RunCheckpoint Round 3（PermissionPrompt 视觉）无冲突。**5.2 Windows 双 X**：`ProviderForm` 用 `<DialogContent fullscreen>`（fixed inset-0），close 按钮 top-5/right-5（20px）落在 Windows WCO（`titleBarOverlay` height 44）右上系统按钮旁。修法：新增 `--platform-titlebar-safe-area` token（默认 0，win32+electron=44px），fullscreen close 按钮 top 改 `calc(1.25rem + token)`，Windows 下下移到 WCO 带以下；macOS/web token=0 无变化。验证：dev server（3007）含 cacheHandler 干净启动；CDP 打开 fullscreen provider 编辑弹窗，close 按钮正常渲染于右上（token=0），证明 Tailwind 任意值类编译且 macOS 无回归；run-checkpoint 两份单测更新（移除 permission-elevation 用例，保留 bypass/context-cost 机制）+ provider-edit-close-button 6 条 pin。Windows 真机双 X 视觉留 Phase 7。
- 2026-06-02：**Phase 4 完成**（GitHub #577；两个根因经并行调研均被重定为与计划假设不同——印证 Phase 0 评审）。**#577A MiMo mapping**：**无任何覆盖路径**（resolver 中 DB 行 shadow preset；upsert/align/discovery 均守 `user_edited`）。真因——两个 MiMo preset `fields: ['api_key']` 缺 model 字段，连接弹窗把 `role_models_json` 存成 `{}`，resolver（`provider-resolver.ts:987`）在为空时回填 stale 默认 `mimo-v2-pro`，用户 v2.5 选择从未被持久化。修法：两个 MiMo preset 加 `model_names`（用户填实际型号→写入 `role_models_json.default`→resolver 直接采用）；`QuickPreset` 透传 `defaultModelId`；连接弹窗 create 模式用 preset 默认预填 model 字段（避免空框 + Volcengine 占位误导），helper 文案改通用。**未硬编码 v2.5 id**（无法核实真实 upstream id，由用户填；如要更新 preset 默认需用户确认真实 id）。DB 集成测试断言用户设的 role default 被采用（`mimo-v2.5-pro`），仅空映射回填 `mimo-v2-pro`。**#577B 回答后追加 provider error**：确认在后端 SDK 路径——`claude-client.ts` 发出 `result` SSE 后仍在同一 try 内 `await iter.next()`，result 之后的 reject（控制通道 teardown 与 capability capture 抢占等）落入 catch，emit 出 result 之后的 error 事件（前端忠实渲染成 error 气泡）；Native/Codex 结构上安全。修法：`resultEmitted` 标志，result enqueue 后置真；catch 中 **error 事件 / `sdk_session_id` 清除 / `CONTEXT_TOO_LONG` 重试** 三处均加 `!resultEmitted` 守卫（result 即权威：成功后不再追加 error、不毁 session、不重试）。源码 pin 7 条 + MiMo catalog/DB 集成/wiring pin。真机新会话首条不再追加 error + MiMo 选型生效的 smoke 留 Phase 7。
- 2026-06-02：**Phase 6 完成**（Feishu 日志噪音，P2，独立提交）。根因：`identity.ts` 调旧 typed-client bot 路径，但 `@larksuiteoapi/node-sdk` 1.59 的生成 client 无 bot 命名空间 → 每次 `Cannot read properties of undefined (reading 'v3')`，被 getBotInfo 的 catch 以 `console.error` 记录；身份重试 timer 每 60s 轮询 → 每分钟刷屏。修法：改用文档端点 `client.request({method:'GET', url:'/open-apis/bot/v3/info'})`（SDK 响应拦截器解包到 body，`bot` 在顶层；同时兼容 `data.bot`），失败每进程仅 `console.warn` 一次（重试 timer 回调本就只在成功时记日志）。已确认 SDK 导出 typed `request<T>` 且响应拦截 `return resp.data`。单测 6 条：端点/方法正确、顶层与 `data.bot` 解析、无 bot 返回 null、连续失败仅记一次、源码无 `.bot.v3` 残留。bridge 已配置但仍失败（如缺 scope）→ 安静降级，不再刷屏。
- 2026-06-02：**Phase 1-6 全部完成**。下一步仅剩 Phase 7（packaged smoke + 合并准备）——需用户在另一台 Mac + Windows 真机跑下方 Smoke Ledger / Phase 7 验收表，本助手不 push、不打包。
- 2026-06-02：**本机 @smoke 收尾**（用户本机跑出的唯一红项）。`Settings page loads @smoke` 抓到 `GET /api/providers/codex_account/models?all=1` → 404 "Provider not found"：`codex_account` 是 Codex OAuth 虚拟 provider（走 Codex app-server，无 `api_providers` 行 / 无 `provider_models`），但 `useOverviewData` 的 per-provider 计数循环只排除了 `env` 与 `openai-oauth`，漏了它。修法：把排除项收敛为命名集合 `NON_DB_PROVIDER_IDS = {env, openai-oauth, codex_account}` + `isCountableDbProvider()`，计数循环改用它（未来新增虚拟 provider 只在一处加）。单测 5 条。验证：worktree dev（PORT=3005）跑 Playwright `@smoke` **16/16 全绿**（此前 15/16）。
