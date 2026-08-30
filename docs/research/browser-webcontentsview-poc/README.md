# Browser WebContentsView POC 结果

> 日期：2026-08-25
> 决议：**BLOCKED / INCONCLUSIVE（尚无 GO）**
> 产品代码：本 POC 未接入；2026-08-26 产品已另行采用 hardened `<webview>`，本研究路线被取代
> 基线：`c97de028`，Electron 40.10.6 / Chromium 144.0.7559.236，macOS arm64（Darwin 25.5.0）

## 结论

POC 尚未形成可采信的 `GO / CONDITIONAL GO / NO-GO` 生产判决。首轮 crash 探针在 `render-process-gone` observer 内调用新的 `loadURL()`，随后 Electron host 以 `SIGTRAP` 退出并记录 `Observers can only be added once`。复核 Electron 的恢复合同后，这条执行顺序被判定为非 canonical：当前 harness 已改为 `forcefullyCrashRenderer()` 后立即 `reload()`，observer 只记事件。因此首轮 SIGTRAP 只能证明旧 harness 序列有问题，不能继续写成 WebContentsView 产品路线的 P1 结论。

修订后的隔离基线于 2026-08-25 再跑时仍停在 `app.whenReady()` 前，checkpoint 固定为 `waiting-app-ready`，60 秒内没有创建窗口或执行 guest 检查，随后人工终止。随后用不创建 `BrowserWindow` / `WebContentsView` 的最小 ready probe 复核：脚本 1ms 启动、13ms 收到 `will-finish-launching`，15,006ms watchdog 触发时仍未 ready；15,032ms 才收到 `ready`，且 `app.exit(2)` 后进程仍需人工 `SIGINT` 结束。该证据把阻点进一步缩小到当前 macOS Electron host 的 ready/exit 握手，而不是 WebContentsView guest 本身，但仍不足以归因到 CodePilot 产品或 Electron 通用缺陷。由于没有完成 macOS canonical crash 重跑，Windows/Linux、IME、focus、overlay visual 和 packaged 也均未执行，POC 当前状态只能是 **BLOCKED / INCONCLUSIVE**。2026-08-26 用户选择不再等待该研究，产品 MVP 改走 hardened `<webview>`；因此本结论不再阻塞 MVP，也绝不改写为 GO。

## Harness 与运行边界

- 独立临时 `userData`；partition 使用 opaque workspace key + `default` profile + run nonce 派生，不读取 CodePilot 或系统浏览器 cookie。
- `BrowserWindow` 复刻 macOS transparent、`under-window` vibrancy、hiddenInset 与 1024×600 最小窗口。
- guest 设置 `sandbox:true`、`nodeIntegration:false`、`contextIsolation:true`、`webSecurity:true`。
- Renderer 只通过固定 IPC 上报 bounds、导航和 overlay 意图；没有通用 `executeJavaScript(code)` IPC。
- 固定 localhost fixture 覆盖 data/remote HTTP redirect、popup、geolocation、download、cookie/localStorage、nested overlay、audio mute、zoom 与 crash。

典型自动运行方式：

```bash
BROWSER_POC_WORKSPACE_KEY=<64-char-opaque-id> \
BROWSER_POC_RUN_NONCE=mac_auto_20260825 \
BROWSER_POC_AUTO=1 \
BROWSER_POC_REPORT=/tmp/codepilot-browser-poc-mac.json \
./node_modules/.bin/electron docs/research/browser-webcontentsview-poc/harness/main.cjs
```

## Smoke Ledger

| 平台 / 场景 | 结果 | 证据 / 限制 |
|---|---|---|
| macOS 基线安全与隔离（9 项） | PASS | [macos-baseline-report.json](./macos-baseline-report.json) |
| macOS 首轮 guest crash 探针 | INVALIDATED | 非 canonical 的 observer 内 `loadURL()` 序列触发 host `SIGTRAP`；不得作为产品 NO-GO 证据 |
| macOS 修订 harness 隔离重跑 | BLOCKED / INCONCLUSIVE | [macos-recheck-stage.json](./macos-recheck-stage.json) 停在 `waiting-app-ready`，60 秒后人工终止 |
| macOS 最小 Electron ready probe | BLOCKED / INCONCLUSIVE | [macos-ready-probe.json](./macos-ready-probe.json)：未创建 window/view；15 秒未 ready，watchdog 后才 ready，且需 SIGINT 结束 |
| macOS IME / focus / packaged / overlay visual | NOT RUN | crash 门禁失败后停止扩展 smoke |
| Windows DPI / focus / packaged | NOT RUN | 无目标平台环境 |
| Linux X11/Wayland / focus / packaged | NOT RUN | 无目标平台环境 |

基线通过项只证明局部 contract 可工作：loopback navigation、data URL 拒绝、partition cookie、overlay 页面状态、隐藏音频策略，以及四项 guest webPreferences。它不等价于 bounds、IME、overlay z-order、packaged 或三平台通过。

## 风险矩阵

| 优先级 | 风险 | 现状 | Go 前要求 |
|---|---|---|---|
| P1 | guest crash 是否与主窗隔离、能否有界恢复 | 首轮探针已失效；修订探针未跑到窗口创建 | 在可进入 `app.whenReady()` 的干净环境重跑 canonical crash/reload 序列并留正常 report |
| P1 | 当前测试宿主 Electron ready/exit 握手异常 | 两次隔离重跑停在 ready 前；最小 probe 也在 watchdog 后才 ready 且不能自行退出 | 干净主机/重启后复核，不能靠重试掩盖 |
| P2 | DOM overlay 与 native view z-order | 自动测试只验证隐藏/恢复状态 | 真实 Dialog/Dropdown/peek 视觉与点击 smoke |
| P2 | IME、focus、shortcut、zoom | zoom 局部 contract 已写，人工路径未跑 | 三平台输入法、焦点和快捷键矩阵 |
| P2 | screenshot 证据 | `BrowserWindow.capturePage()` 未包含 child view 像素 | 分离 guest capture + shell capture，并明确合成限制 |
| P2 | Windows/Linux packaged 行为 | 未运行 | 两平台正式包 Smoke Ledger |

## 后续选择

1. 优先在干净环境确认 Electron 能进入 `app.whenReady()`，再用当前 canonical crash/reload harness 从零重跑三平台。
2. 若 native view 路线仍失败，退回受限 localhost preview 或系统浏览器打开。
3. 只有重做完整 threat model 后才可重新评估 `<webview>`；T3 在使用它不是自动采纳理由。

若未来重新采用 WebContentsView，仍需明确 `GO`（或用户书面接受条件的 `CONDITIONAL GO`）。当前 [Browser Surface MVP](../../exec-plans/active/browser-surface-mvp.md) 的 `<webview>` 路线由独立安全合同与验证门禁约束。
