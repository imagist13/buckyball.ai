# Windows Codex Loopback Proxy 502 修复

> 创建时间：2026-07-27
> 最后更新：2026-07-27
> 状态：🟡 Code complete + Tests pass；修复已随 v0.60.0 正式发布（commit `7690cee6`），真实 Windows + Clash packaged smoke 待原报告用户升级复测后回写

## 用户问题与结论

Windows 11 / CodePilot 0.59.1 用户在 Codex Runtime 发送任意请求时收到：

```text
unexpected status 502 Bad Gateway: Unknown error,
url: http://127.0.0.1:47823/api/codex/proxy/v1/responses
```

实机报告证明请求继承了 Clash 的 `HTTP_PROXY` / `HTTPS_PROXY`，却没有 `NO_PROXY`；带
`Proxy-Connection` 的 502 表明发往 CodePilot 本机 Responses proxy 的 loopback 请求在到达
Next route 前已被系统代理截获。当前 Electron 主进程还会在 Windows 上把 Chromium 解析到的
system proxy 注入 packaged server，而 Codex app-server 继续全量继承该环境，两道进程边界均未
确保 loopback bypass。

报告中 `~/.codex/proxy.mjs` 是用户自建中继，不属于 CodePilot managed proxy 的生命周期。
本轮不自动执行或守护用户主目录里的脚本；只修复 CodePilot 自己的进程环境与错误诊断。

## 状态总览

| Phase | 内容 | 状态 | 用户可见验收 |
|------|------|------|--------------|
| Phase 0 | 报告、请求链、Electron/Codex spawn 与 upstream 行为核对 | ✅ 已完成 | 能区分“本机 proxy 被截获”与“上游 Provider 返回 502”；记录 `respect_system_proxy` 未决风险 |
| Phase 1 | 共享 loopback bypass + Windows proxy env 优先级 | ✅ 已完成 | 保留用户 `NO_PROXY`，追加 loopback；显式代理不被 system proxy 覆盖 |
| Phase 2 | Codex 502 诊断 + 自动化门禁 | ✅ 已完成 | loopback 502 给出可操作错误；外部 502 不误判 |
| Phase 3 | build / packaged / Windows Clash smoke | 🟡 部分完成 | 自动化与本机 build 已通过；Windows packaged app 在开启 Clash 时 Codex turn 待验证 |

## 执行清单

### Phase 1 — Process environment

- [x] 增加共享、幂等的 `NO_PROXY` / `no_proxy` 合并函数，保留用户规则并追加 `127.0.0.1`、`localhost`、`::1`。
- [x] Windows 子进程环境只保留一组规范化 proxy key，避免 Node 对大小写重复键的不确定选择。
- [x] Electron → packaged Next server 边界使用合并后的完整 env 判断显式 proxy；只有没有任何显式 proxy 时才注入 Chromium system proxy。
- [x] Next server → Codex app-server 边界再次应用 loopback bypass，防止 dev/非 Electron 启动绕过第一道边界。

### Phase 2 — Diagnosis / guardrail

- [x] 对已解析的 `stream:true` 请求，把 CodePilot managed Provider 错误统一编码为 HTTP 200 SSE `response.failed`；不再让上游 502 与 loopback transport 502 共用 HTTP 签名。
- [x] 仅把指向 `/api/codex/proxy/` loopback URL、且不含 CodePilot structured error envelope 的 transport 502 识别为 `CODEX_LOOPBACK_PROXY_INTERCEPTED`；诊断必须附带原始 Codex error。
- [x] 补纯函数、两道 spawn 接线、错误正反例的行为测试。
- [x] 更新 ElectronMain / Runtime guardrail，记录外网代理保留、loopback 必须直连的不变量。

### Phase 3 — Verify

- [x] targeted tests、`npm run test`、production build、Electron build 通过。
- [ ] Windows packaged + Clash/system proxy + 无预设 `NO_PROXY` 的真实 Codex turn 通过。
- [ ] Windows 仅启用系统代理、进程无 proxy env 的真实 Codex turn 通过，验证 bundled Codex `respect_system_proxy` 路径不会绕过 loopback bypass。
- [ ] 关闭代理以及自定义 `NO_PROXY` 反例不回归。

## Bundled Codex `respect_system_proxy` 风险

本机实际被 CodePilot 发现的 `/Applications/ChatGPT.app/Contents/Resources/codex`
报告 `codex-cli 0.145.0-alpha.27`；binary strings 中存在
`NetworkProxyRespectSystemProxy` / `respect_system_proxy`。这只能证明当前 bundled
Codex 含该 feature flag，**不能证明它默认启用，也不能证明 Windows 系统代理解析仍遵守
环境变量里的 `NO_PROXY`**。

用户报告已经证明的根因是进程 `HTTP_PROXY` / `HTTPS_PROXY` 继承且缺失 `NO_PROXY`，所以本轮
env 修复仍然成立。但“仅启用 Windows 系统代理、无 proxy env”必须作为独立 packaged smoke；
在该 smoke 通过前不宣称 system-proxy-only 路径已关闭。

## Required checks

| ID | 必须满足 | Evidence |
|----|----------|----------|
| C1 | 既有 `NO_PROXY=.corp.test` 被保留，loopback 三项只追加一次 | ✅ `process-proxy-env.test.ts` |
| C2 | Windows 同时存在大小写 proxy key 时按明确规则归一，不把 system proxy 覆盖显式值 | ✅ `process-proxy-env.test.ts` |
| C3 | Electron server 与 Codex app-server 两道 child env 都含 loopback bypass | ✅ behavior + Electron source wiring test；bundle 中确认 helper |
| C4 | managed Provider 502 在 streaming 请求中编码为 HTTP 200 `response.failed`；真正 loopback transport 502 才显示专用诊断并保留原文 | ✅ `codex-proxy-foundation.test.ts` + `codex-event-mapper.test.ts` |
| C5 | Windows + Clash 真实请求不再出现 `Proxy-Connection` loopback 502 | 待真实 smoke |
| C6 | Windows 仅启用 system proxy、无 proxy env 时 loopback 仍直连 | 待真实 smoke；覆盖 `respect_system_proxy` 风险 |

## Smoke Ledger

| Date | Runtime | 环境 | 场景 | Result | Evidence |
|------|---------|------|------|--------|----------|
| 2026-07-27 | codex_runtime | Windows 11 + Clash `127.0.0.1:7892` | 0.59.1、无 `NO_PROXY`，请求 CodePilot loopback Responses proxy | ❌ 基线 | 用户报告；outer URL `127.0.0.1:47823/api/codex/proxy/v1/responses` 返回 502 |
| 2026-07-27 | codex_runtime | 自动化 + macOS build host | Windows env 合并矩阵、两道 spawn、streaming Provider 502 与 loopback transport 502 分层、production/Electron build | ✅ Tests pass | targeted 130/130；全量 4699/4699；`npm run build`、`build-electron.mjs`、ESLint、docs drift、`git diff --check` 通过；不代替 Windows smoke |
| _待实施_ | codex_runtime | Windows packaged + Clash + env proxy、无 `NO_PROXY` | 修复后发送真实 Codex turn | ⏳ | child env 含 loopback bypass；turn 成功 |
| _待实施_ | codex_runtime | Windows packaged + 仅 system proxy、无 env proxy | 验证 `respect_system_proxy` 路径 | ⏳ | loopback 仍直连 |
| _待实施_ | codex_runtime | Windows packaged + 自定义 `NO_PROXY=.corp.test` | 保留用户 bypass 并追加 loopback | ⏳ | `.corp.test` 与 loopback 三项同时存在，外网仍走代理 |
| _待实施_ | codex_runtime | Windows packaged + 无代理 | 无代理反例 | ⏳ | Codex turn 正常，无回归 |
| _待实施_ | codex_runtime | 任意平台 + CodePilot Provider 不可用 | managed upstream 502 反例 | ⏳ | 收到 structured `upstream_*` / `response.failed`，不得显示 `CODEX_LOOPBACK_PROXY_INTERCEPTED` |
| _待实施_ | codex_runtime | Windows packaged + loopback endpoint 未监听 | 本地连接失败反例 | ⏳ | 连接拒绝类原始诊断；不误标代理截获、不启动用户 `proxy.mjs` |
| _待实施_ | codex_runtime | Windows packaged + Process Explorer / `curl -v` | child env 与响应头终检 | ⏳ | proxy key 单一 casing；CodePilot loopback 响应无 `Proxy-Connection` |

## 决策日志

- 2026-07-27：Signal → 用户实机稳定复现 loopback 502；`--noproxy "*"` 后同请求 200。
- 2026-07-27：Triage → 根因位于 Electron server 与 Codex app-server 的代理环境继承，不是 CodePilot Provider proxy 的上游 502；`~/.codex/proxy.mjs` 不属于应用管理范围。
- 2026-07-27：决定保留系统代理的外网能力，只为 loopback 追加 bypass；不使用 `session.setProxy({ mode: "direct" })` 全局关闭 Chromium 代理，也不自动执行用户脚本。
- 2026-07-27：Fix → 新增共享 proxy-safe env builder，在 Electron → Next 与 Next → Codex 两道边界幂等应用；Windows 规范化大小写键，修复旧逻辑只检查空 `userShellEnv` 而覆盖 inherited proxy 的问题；Codex 事件增加结构化 `CODEX_LOOPBACK_PROXY_INTERCEPTED`，且只命中 CodePilot loopback path。
- 2026-07-27：Review / Triage → Claude 独立审查指出 CodePilot proxy 自己也会把上游错误映射为 loopback HTTP 502，原诊断会把真实 Provider 故障误报为系统代理截获；同时确认 bundled `codex-cli 0.145.0-alpha.27` 含 `respect_system_proxy` flag，但其 Windows 启用与 bypass 语义无法由静态代码定案。
- 2026-07-27：Fix / Guardrail → 对 parsed streaming request 的 managed application/upstream 错误统一返回 HTTP 200 SSE `response.failed`，保留 non-stream HTTP status + JSON；诊断层再排除 CodePilot structured error envelope并附上原始 Codex error。增加真实协议形状反例、空 proxy env 边缘用例，并把 system-proxy-only 场景列为独立 Windows smoke。
- 2026-07-27：Verify / Guardrail → targeted 130/130、全量 4699/4699、ESLint、typecheck、production build、Electron build、docs drift、`git diff --check` 通过；真实 Windows + Clash / system-proxy-only smoke 未执行，计划保持 active/🟡，不标 Smoke passed。
- 2026-07-27（v0.60.0 正式发布）：修复随 `v0.60.0` 发布（fix commit `7690cee6`，release commit `d6c4090e`）；GitHub Actions run `30272492570` verify-source / build-macos / build-windows / release 全绿，Windows NSIS 安装包已上传稳定 Release。Release Notes 已注明"实机验证仍在进行中"。下一步：请原报告用户升级 0.60.0 后按上方待实施矩阵复测，结果回写本 Ledger；全部通过后移至 `completed/`。
