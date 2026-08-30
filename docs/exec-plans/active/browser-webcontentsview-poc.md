# Browser WebContentsView 技术 POC 与 Go / No-Go

> 创建时间：2026-08-25
> 最后更新：2026-08-26
> 状态：🧭 **BLOCKED / INCONCLUSIVE；已被 MVP 路线取代**。本文件继续记录 WebContentsView 研究事实，不再阻塞 hardened `<webview>` MVP
> 风险等级：Tier 2（Electron Main / 远端内容 / 权限 / IPC / 下载）
> 交付物：Smoke Ledger + 风险矩阵 + go/no-go 决议；**不合入产品代码**
> 事实基线：[T3 Code 模型输入区、统一侧边栏与内置浏览器专项调研](../../research/t3code-composer-sidebar-browser-ux-2026-08-25.md)
> 上游依赖：[Workspace Surface Sidebar](workspace-surface-sidebar-pin-and-inspector.md) Phase 1
> 下游计划：[Browser Surface MVP](browser-surface-mvp.md)

## 用户问题与争议

用户希望 CodePilot 拥有完整内置浏览器。T3 使用 Electron `<webview>`、persistent partition、主进程 Manager、CDP 和 Playwright selector runtime；但 Electron 官方不推荐把 `<webview>` 作为长期默认，并已用 `WebContentsView` 取代废弃的 `BrowserView`。

方向上优先验证主进程拥有的 `WebContentsView`，但 CodePilot 当前使用 transparent + vibrancy BrowserWindow，Renderer 有大量 dropdown/dialog/toast。native view 会绘制在 DOM 之上；焦点、IME、zoom、快捷键、overlay 遮挡和三平台打包表现都不能由官方 API 存在推断为可用。

因此本计划是隔离 POC，不是 Browser MVP。2026-08-26 用户明确要求不再等待该 POC 并直接实现 T3 路线；下游据此显式选择 hardened `<webview>`。这不是本 POC 的 GO，也不改变 Windows/Linux、IME、focus、overlay 与 packaged 均未执行的事实。

## 状态

| Phase | 内容 | 状态 | 用户能看到什么 |
|-------|------|------|----------------|
| Phase 0 | 合同冻结与隔离 harness | ✅ 完成 | research-only harness 与窄 IPC/隔离 partition 可复查 |
| Phase 1 | 单 tab、bounds、材质、焦点/IME | ⚠️ 部分 | localhost 与安全基线通过；IME/focus/packaged 未跑 |
| Phase 2 | Native overlay、快捷键、zoom、crash | ⏸ 阻塞 | 首轮 crash 序列已判无效；canonical immediate-reload 尚未跑到执行点 |
| Phase 3 | Session/partition、导航、权限、下载安全 | ⚠️ 部分 | 固定 fixture 与默认拒绝合同已落；完整下载矩阵未跑 |
| Phase 4 | 三平台 packaged smoke + go/no-go | ⏸ 未形成决议 | macOS 重跑阻塞，Windows/Linux 未跑；产品入口保持禁用 |

## 决策日志

- 2026-08-25：首选 `WebContentsView` POC，不启用 `<webviewTag>`；`BrowserView` 已废弃，不进入候选。
- 2026-08-25：POC 代码使用 research harness / disposable integration patch，不进入产品 runtime；产品实现由独立 MVP 计划承担。
- 2026-08-25：Browser partition 消费 Sidebar 输出的 `canonicalWorkspaceKey`，不复制 Git/path identity 逻辑，不引入 CodePilot 不存在的 environment 实体。
- 2026-08-25：native z-order/overlay 是 go/no-go 核心，不是 MVP 后补 polish。
- 2026-08-25：Agent automation、annotation、recording、React grab 全部超出 POC；POC 只验证未来 CDP 是否存在技术阻断。
- 2026-08-25：Sidebar Phase 1 已提供 versioned opaque workspace identity；harness 只消费 64 位 opaque id。
- 2026-08-25：首轮 crash 探针在 `render-process-gone` observer 内启动新的 `loadURL()`，随后出现 native `SIGTRAP`（`Observers can only be added once`）。复核后该序列被判为非 canonical，不能继续作为 WebContentsView 产品 NO-GO 证据。harness 改为 `forcefullyCrashRenderer()` 后立即 `reload()`，observer 只记录事件。
- 2026-08-25：修订 harness 的隔离基线仍停在 `app.whenReady()` 前，60 秒后人工终止；canonical crash/reload 未实际执行。因此 POC 状态改为 **BLOCKED / INCONCLUSIVE**。Browser MVP 继续阻塞的依据是“尚无 GO”，不是已证明 WebContentsView 必然带崩主窗。
- 2026-08-25：不创建 window/view 的最小 ready probe 也在 15 秒 watchdog 后才 ready，且 `app.exit(2)` 未结束进程、需人工 SIGINT。阻点因此进一步定位到当前 macOS Electron host 的 ready/exit 握手阶段；它发生在 WebContentsView 创建前，只能作为 POC 环境阻塞证据，不能冒充产品 NO-GO。证据见 [macos-ready-probe.json](../../research/browser-webcontentsview-poc/macos-ready-probe.json)。
- 2026-08-25：Windows/Linux、IME、focus、packaged 均标记 `not run`；完整记录见 [POC README](../../research/browser-webcontentsview-poc/README.md)。
- 2026-08-26：用户书面要求实现 Browser，MVP 决策改为 `<webview>` + Main attach gate。此 POC 保持 `BLOCKED / INCONCLUSIVE` 并作为 superseded research；不再是 MVP 启动门禁。

## 硬前置

- Sidebar Phase 1 已定义并 review 通过 versioned opaque workspace id。
- 当前 Electron 版本、BrowserWindow transparent/vibrancy 配置和 `ElectronMain.md` 安全不变量已锁基线。
- POC 执行使用独立分支/worktree或 research harness；不得污染用户当前 dirty worktree，也不得提交到产品入口。
- 每个平台的“未执行”必须写 `not run`，不能用另一平台结果代替。

## Phase 0：合同冻结与隔离 harness

### 用户结果 / 验收入口 / 明确不做

- 用户结果：无产品 UI 变化；工程上得到可重复测试的 BrowserWindow + renderer slot + WebContentsView harness。
- 验收入口：独立 Electron 窗口，不出现在 CodePilot 正式导航或设置里。
- 明确不做：不改正式 `electron/main.ts` 发布路径，不新增 Browser surface，不写用户默认 session 数据。

### Harness 形态

1. Standalone research harness：复刻当前 window options（尤其 macOS transparent/vibrancy/hiddenInset），渲染可拖动/缩放 slot、基础 HTML overlay 和一个 WebContentsView。
2. Disposable CodePilot integration patch：仅用于证明真实 AppShell/Dropdown/Dialog/Toast 与 native view 的交互；测试后不合入产品代码。
3. 使用隔离临时 userData 和显式 POC partition；禁止读取用户真实 browser cookies、provider secrets 或默认 session。

### 执行清单

- [x] 建 POC checklist、平台/版本/窗口配置基线和证据目录。
- [x] 主进程创建/destroy WebContentsView；Renderer 只经 narrow IPC 报 slot rect/visibility，不取得 webContents handle。
- [x] IPC schema 校验 finite integer bounds、known view id、trusted main renderer sender；越界/unknown fail closed。
- [x] guest 初始 `sandbox:true`, `nodeIntegration:false`, `contextIsolation:true`, `webSecurity:true`。
- [x] harness 不包含通用 `executeJavaScript(code)` IPC；调试动作由固定测试命令控制。

## Phase 1：单 tab、bounds、材质、焦点与 IME

### 用户结果 / 验收入口 / 明确不做

- 用户结果：测试壳中浏览器跟随 slot 正确定位，可输入中文、缩放窗口并切换焦点。
- 验收入口：localhost test page + HTTPS page；拖动 sidebar/窗口、全屏、最小化/恢复、切换 tab。
- 明确不做：不实现完整地址栏/history/download UI，不声称三平台成熟。

### 矩阵

- [ ] macOS transparent + `under-window` vibrancy、light/dark、traffic lights、rounded content。
- [ ] Windows packaged window、DPI 100/125/150%、最大化/restore。
- [ ] Linux 至少一个受支持 WM/session，记录 X11/Wayland 实际环境。
- [ ] DOM rect → device-independent native bounds，在 app zoom/DPI/resize 后无偏移或裁切。
- [ ] focus 从主 Composer → browser input →主菜单正确往返；Tab/Shift+Tab 行为可预测。
- [ ] 中文 IME composition、复制/粘贴、selection、context menu。
- [ ] hidden/show、workspace switch、window hide/show 后不出现白块、残影或 orphan view。

## Phase 2：Overlay、快捷键、zoom 与 crash

### 用户结果 / 验收入口 / 明确不做

- 用户结果：任何主界面弹层位于浏览器区域时仍可见、可点击；恢复后浏览器焦点和页面状态不丢。
- 验收入口：Dialog、Dropdown、Command Palette、Toast、Inspector peek 逐一覆盖 browser 区域。
- 明确不做：不让每个组件各写一份 browser-hide hack；不做 Agent automation。

### Overlay coordinator 候选

POC 比较而不预设最终方案：

- 从 window contentView 临时 remove，再按原顺序 add 回；
- view visibility API（若当前 Electron 版本行为可靠）；
- 移到离屏 bounds；
- capturePage 截图替身 + 隐藏 native view。

每种策略记录：首次延迟、闪烁、焦点、音频、页面/表单状态、GPU/内存、恢复正确性。只允许一个 centralized coordinator 持有 overlay count/token，nested overlays 关闭一个时不得提前恢复 view。

- [ ] Cmd/Ctrl+K、Cmd/Ctrl+L、reload、find、copy/paste、app menu 等快捷键仲裁；guest 不吞主窗全局命令。
- [ ] app zoom 与 guest zoom 独立；attach/show 后恢复 guest factor，不继承错误主窗 zoom。
- [ ] renderer-process-gone / unresponsive：有界退避、用户可见 reload、超过预算停止，不无限 remount。
- [ ] 隐藏期间音频/mute 状态有明确策略；overlay 不应让不可见页面意外播放。
- [ ] nested overlay、快速开关、workspace switch、view destroy race 反例。

## Phase 3：Session、导航、权限与下载安全

### 用户结果 / 验收入口 / 明确不做

- 用户结果：测试壳能安全浏览 HTTPS/localhost；不安全 scheme、权限和新窗口不会绕过主进程。
- 验收入口：安全 fixture 页面主动请求 popup、permission、download、file/javascript URL、跨站导航。
- 明确不做：不复用真实用户 cookies，不承诺下载产品 UI，不开放 DevTools/任意 CDP 给 Renderer。

### Partition

`persist:codepilot-browser-poc-<hash(canonicalWorkspaceKey + 'default' + runNonce)>`

- POC 加 runNonce 防止污染未来产品 partition；验证同 POC workspace tabs 共享、不同 workspace 隔离。
- 清站点数据只清当前 POC partition，并以 fixture cookie/localStorage 证明作用域。

### 安全清单

- [ ] HTTPS 远端；HTTP 仅 loopback/localhost fixture。拒绝 `file:`, `javascript:`, `data:` 顶层与未知 scheme。
- [ ] `will-navigate` / redirects / `setWindowOpenHandler` 全部经过 URL policy；popup 默认 deny。
- [ ] `setPermissionRequestHandler` + check handler 默认 deny，按 origin + permission allowlist；未知权限拒绝。
- [ ] preload 若非必需则无 preload；若需要，只暴露固定、无参数或闭合 schema API，并验证 sender/frame。
- [ ] 下载 fixture 覆盖文件名清洗、重复、取消、危险扩展、超大/失败；明确 T3 无现成产品实现可抄。
- [ ] IPC sender、view id、workspace scope、bounds、navigation input 的恶意反例。
- [ ] guest compromise 无法访问 Node、文件系统、provider secrets、CodePilot preload API 或主窗任意 IPC。
- [ ] main renderer `sandbox:true` 不在本 POC 承诺内；单列安全 tech-debt/评估，不用 guest 结果冒充整窗安全。

## Phase 4：三平台 packaged smoke + Go / No-Go

### 用户结果 / 验收入口 / 明确不做

- 用户结果：仍无正式 Browser 入口；用户只收到是否值得进入 MVP 的证据结论。
- 验收入口：macOS/Windows/Linux packaged POC，逐条 Ledger。
- 明确不做：不因 source test 或 dev window 成功标 `Smoke passed`；不自动开始 MVP。

### Go 门槛

- 三平台目标环境均完成关键矩阵；未覆盖平台只能给 conditional/no-go，除非用户明确接受平台裁剪。
- overlay coordinator 无不可接受闪烁/焦点丢失；nested overlay 正确。
- IME、DPI/bounds、zoom、快捷键、crash 恢复达到可产品化水平。
- guest security checklist 全部 pass，无 Node/IPC/scheme/permission escape。
- 性能记录：空闲/加载/隐藏/多次重建的 CPU、内存、GPU 无明显无界增长。
- POC review 无 P1/P2；P2 必须修复或登记并由用户明确接受才可 go。

### No-Go / Alternative

任一核心门槛失败时记录：

- 是否可通过架构调整修复并重跑；
- 是否退回受限系统浏览器/localhost preview；
- 是否需要重新评估 `<webview>`，若评估必须完整重做 threat model，不能因 T3 在用就自动采用。

## 证据输出

- research POC README：环境、commit、Electron/OS、运行命令、fixture、限制。
- 屏幕截图/录屏：bounds、IME、overlay、crash、partition 作用域。
- 安全 fixture 结果与失败日志（脱敏）。
- 本计划 Smoke Ledger。
- 最终一条 decision log：`GO` / `CONDITIONAL GO` / `NO-GO`，列硬条件。
- disposable integration patch 不合入产品代码；如需保留，仅以 research artifact 保存最小无凭据版本。

## Smoke Ledger（真实凭据 / UI / E2E 验证记录）

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| 2026-08-25 | Electron 40.10.6 / macOS arm64 | N/A | N/A | isolated userData | 安全/隔离基线 9 项 | ✅ PASS（仅局部） | [sanitized report](../../research/browser-webcontentsview-poc/macos-baseline-report.json) |
| 2026-08-25 | Electron 40.10.6 / macOS arm64 | N/A | N/A | isolated userData | 首轮 guest crash 探针 | ⚠️ INVALIDATED | observer 内 `loadURL()` 非 canonical；SIGTRAP 不再作为产品判决 |
| 2026-08-25 | Electron 40.10.6 / macOS arm64 | N/A | N/A | isolated userData | 修订 immediate-reload harness 基线重跑 | ⏸ BLOCKED / INCONCLUSIVE | [waiting-app-ready checkpoint](../../research/browser-webcontentsview-poc/macos-recheck-stage.json) |
| 2026-08-25 | Electron 40.10.6 / macOS arm64 | N/A | N/A | isolated userData | 最小 Electron ready/exit probe（不创建 window/view） | ⏸ BLOCKED / INCONCLUSIVE | [ready probe](../../research/browser-webcontentsview-poc/macos-ready-probe.json)：15 秒后才 ready，需 SIGINT 结束 |
| 2026-08-25 | Electron POC / Windows | N/A | N/A | isolated userData | DPI + focus + overlay + packaged | ⏭ NOT RUN | 无目标平台环境 |
| 2026-08-25 | Electron POC / Linux | N/A | N/A | isolated userData | WM + focus + overlay + packaged | ⏭ NOT RUN | 无目标平台环境 |

## 完成定义

- 交付 Smoke Ledger、风险矩阵与明确 go/no-go；POC 不进入产品入口。
- 三平台未跑齐时诚实标 partial/conditional，不写“生产可行”。
- `ElectronMain.md` 的远端内容安全边界在 POC 结论中有明确增补建议，但正式 guardrail 由 MVP 认领。
- 若未来重启 **WebContentsView 路线**，仍需 `GO` 且 Review passed；当前 `<webview>` MVP 使用独立 threat model 与发布门禁。
