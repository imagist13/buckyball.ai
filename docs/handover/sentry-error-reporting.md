# Sentry 匿名错误上报与崩溃率统计

> 产品取舍见 [docs/insights/sentry-error-reporting.md](../insights/sentry-error-reporting.md)，稳定开发契约见 [docs/guardrails/SentryTelemetry.md](../guardrails/SentryTelemetry.md)。

## 一、当前产品边界

当前只实现 U0（Release Health）：官方 stable build 在用户未 opt-out 时发送经脱敏的错误，并只保留 Electron main-process session 作为 crash-free sessions 的分母。

- 不设置 `user.id` / installation id / device fingerprint；
- 不统计 DAU、MAU、留存或功能使用；
- renderer 的 `BrowserSession`、Next server 的 `ProcessSession` 与 `Http` request-session 显式关闭；
- preview、development、普通源码 checkout 即使安装了 SDK 也不会发送到官方项目。

设置文案因此是“匿名错误上报与崩溃率统计”，不是“使用分析”。

## 二、三层结构

| 层 | 初始化入口 | SDK | Session | 事件策略 |
|---|---|---|---|---|
| Renderer | `src/components/layout/SentryInit.tsx` | `@sentry/browser@10.69.0` | 关闭 `BrowserSession` | ErrorBoundary 走 browser facade；beforeSend 统一脱敏 |
| Next server | `src/instrumentation.ts` | `@sentry/node@10.69.0` | 关闭 `ProcessSession`；以 `trackIncomingRequestsAsSessions:false` 替换默认 `Http` | classifier / provider shared boundary；beforeSend 统一脱敏 |
| Electron main | `electron/main.ts` 文件顶部 | `@sentry/electron@7.16.0` | 唯一 `MainProcessSession`，`sendOnCreate:true` | 保留 SDK 默认 native/minidump，禁截图、console、PII |

三层 release 统一为 `codepilot@<package version>`，environment 为 `production`、`app.channel` 为 `stable`。DSN 只由 stable CI 的 `SENTRY_DSN` 注入；源码不再包含 ingest literal。`SENTRY_AUTH_TOKEN` 只给独立 source-map upload step，绝不能进入 build/package step、Next public env 或 Electron define。

## 三、启用与 opt-out

`src/lib/telemetry/contract.ts` 的 `resolveTelemetryConfig()` 是唯一启用判定：同时满足 production、stable、有 DSN、未 opt-out 才启用。

| 层 | opt-out 事实源 | 生效时机 |
|---|---|---|
| Renderer | `localStorage['codepilot:sentry-disabled']` | beforeSend 即时生效 |
| Next server | `~/.codepilot/sentry-disabled` | 应用重启 |
| Electron main | `~/.codepilot/sentry-disabled` | 应用重启 |

设置路由仍由 `POST /api/settings/sentry` 写 marker；UI 明确提示完全生效需要重启。

## 四、事件合同

`src/lib/telemetry/contract.ts` 将错误分成 `product_fault`、`provider_protocol_fault`、`transient_upstream`、`user_action_required`、`provider_test_result`、`user_cancelled`、`expected_lifecycle`、`unknown`。

- 有真实 stack 的 `product_fault` 与 `unknown` 保留 Sentry 默认 stack grouping；`unknown` 额外标 `needs_classification=yes`；
- protocol/transient/无 stack 错误只使用稳定枚举 fingerprint，禁止 message、URL、model/session/request id；
- connection test、用户取消、正常生命周期与 `user_action_required` 生成 0 个 Sentry event；不再保留 `telemetry.health_summary` info/message Issue 或本地 health-summary 状态文件；
- `src/lib/telemetry/root-cause.ts` 是 shared Provider、Claude classifier 与 Native 两条 loop 的共同分类源：HTTP 4xx（含 429）、缺凭据、模型不支持 → `user_action_required`；5xx、`ENOTFOUND`/`EAI_AGAIN`、timeout 只有 retry exhausted 才上报稳定 transient bucket；
- `AI_NoOutputGeneratedError` 与 in-band stream error 先在最多 4 层/16 节点的 allow-list cause graph 中检查 status/code/type；底层 4xx/5xx/DNS/timeout 优先，只有确实没有 upstream 根因时才归 `EMPTY_RESPONSE` protocol fault；provider SSE `type` 只接受固定低基数 enum 映射，不读取 body/chunk；
- normalizer 不读取或返回 response body、chunk、request/data/header/path。原始 upstream body 可继续用于本地用户诊断，但 shared boundary 在 rethrow/async capture 前写 non-enumerable marker，Node auto-capture 丢弃原始对象；受控 unknown/product event 以固定 message 的安全 Error 副本保留原 stack frame，其他事件只发送固定 message + 枚举 tag/fingerprint；
- Native agent loop 与 experimental ToolLoop 的 `onError` 只保存结构化错误并 marker，不 capture；shared per-step terminal state 在 response/finish-step 或 catch 确认 retry exhausted 后 exactly-once 上报。ToolLoop 必须先 await result promise，再执行 resolved-stream fallback：初始 HTTP/DNS 失败可能让 fullStream 正常结束、随后以 fresh NoOutput reject，提前 fallback 会造成二报。resolved in-band、partial content 与 rejected initial request 三种形态均有真实 transport fixture。

## 五、隐私策略

`src/lib/telemetry/sanitize.ts` 是三层共用的 default-deny allow-list：

- 删除调用方提供的全部 user identity，并改写为唯一 `user.ip_address:null` tombstone，阻止 Relay 按连接补 IP/Geo；同时删除 server_name、request headers/body/query/cookies、modules；
- console 与 `ui.input` breadcrumb 删除；网络 breadcrumb 只留 method、pathname、status；
- tags/extras/contexts 只允许稳定、低基数字段；
- URL、secret、长 ID、用户目录与控制字符被清洗；
- stack `filename/abs_path/module` 与 `debug_meta.images[].code_file/debug_file` 同步匿名化，保留行列号与 debug ID；
- 三层显式 `sendDefaultPii: false`、`tracesSampleRate: 0`，Electron `attachScreenshot: false`。

2026-08-07 的 0.65 只读生产复核证明：只删除 `user` 仍会得到 server-inferred IP/Geo；同一 release 为 `hasHealthData:false`，因为 tray-resident 应用不能依赖干净退出才首次发送 session。代码已补 null tombstone 与 eager main session；真正关闭这两项仍需新 stable event/session 验证，并在 Sentry project 侧复核 Prevent Storing IP Addresses（本地任务未修改外部设置）。

## 六、Source Map 发布闭环

官方构建设置 `CODEPILOT_SOURCE_MAPS=1`：

1. Next 开启 `productionBrowserSourceMaps`、Turbopack debug ID 和 output maps；依赖 input maps 保持关闭；
2. `scripts/build-electron.mjs` 给 Electron 生成 map，并把 `.next/server` 中与 standalone JS 对应的 map 复制到实际部署树；
3. `scripts/sentry-source-maps.mjs` 验证 renderer / packaged server / Electron 都存在非占位 map；
4. stable CI 对即将打包的同一份 JS 执行 `sentry-cli sourcemaps inject` 和严格 upload；以 debug ID 匹配，暂不设置 `dist`（macOS universal 构建与运行时 arch 不一一对应）；上传失败阻断构建；
5. `electron-builder.yml` 在 app.asar、standalone、node_modules、static 所有入口排除 `*.map`。

2026-08-02 至 2026-08-03 的 official CI 已完成三层 source-map upload/symbolication、native minidump 恢复上传与 macOS/Windows/Linux package 0-map 门禁；Linux x64/arm64 六个 v0.64.0 包还通过架构、Electron ABI、packaged server 与 glibc 2.35 基线。用户已明确接受 stable source-map build 绝对增加约 13.4s 的资源取舍，资源门禁关闭。

v0.64.0 与 v0.65.0 已正式发布。Phase 6 仍需对实现 P1 后的新 stable release 单独建立 24h/72h cohort；不得把旧 `javascript-nextjs`、修复前 release 或跨 release lifetime count 混在一起。

## 七、关键文件与验证

| 文件 | 责任 |
|---|---|
| `src/lib/telemetry/contract.ts` | enable/session/outcome/fingerprint 合同 |
| `src/lib/telemetry/root-cause.ts` | 有界 cause/status/code normalizer、retry gate、安全 stack 副本 |
| `src/lib/telemetry/sanitize.ts` | 三层 default-deny event/breadcrumb 清洗 |
| `src/lib/telemetry/provider-failure.ts` | background/provider shared capture |
| `src/lib/error-classifier.ts` | Claude/Native capture policy；user-action 0 event |
| `src/lib/telemetry/native-stream-boundary.ts` | per-step in-band error 状态、terminal/catch exactly-once 与 anti-double-capture |
| `src/lib/agent-loop.ts` / `src/lib/experimental/agent-loop-toolloop-poc.ts` | onError 只保留 root cause；resolved terminal / catch capture |
| `src/instrumentation.ts` | Next init、auto-capture 去重 |
| `src/components/layout/SentryInit.tsx` | renderer init 与 opt-out |
| `electron/main.ts` | early main init、main-only session、native crash 默认集成 |
| `scripts/sentry-source-maps.mjs` | release/map/Secret fail-closed upload |
| `electron-builder.yml` | packaged map 排除 |

日常回归：telemetry 定向 fixtures + `npm run test`。2026-08-05 复审修复后的 telemetry/Sentry/stream-honesty 定向超集为 67/67（真实两条 loop 的 SSE + 初始 HTTP + Sentry transport 为 10/10），全量为 5071/5071，production build 通过。每个 zero-event 测试文件都必须包含共用 carrier 的阳性 event 对照。发布前还必须跑 official-style source-map/package gate；发布后在真实 `codepilot-desktop` project、单一 release、`environment=production` 下记录 4xx zero-Issue、retry-exhausted transient、NoOutput root cause、renderer/server/Electron symbolication 与 native crash smoke。当前 worktree 已有 mode 600、gitignored 的只读 Sentry credential（仅 event/org/project read），一次只读 API 请求已证明访问可用；这不等于完成单 release cohort/P0 查询，也不得把 token 打印、提交或送入 build/package。
