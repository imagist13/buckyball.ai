# Sentry 遥测可信度与错误分诊修复计划

> 创建时间：2026-08-02  
> 最后更新：2026-08-07
> 事实核验基线：`origin/main@979fda51` / `v0.65.0`（本任务从该 commit 的 detached clean checkout 起步）
> 当前状态：🚧 `v0.66.0` 已于 2026-08-07 15:01（北京时间）正式发布，作为 Phase 6 新的单一修复后 cohort。Build & Package run `31155340623` 的跨平台 packaged、source-map 与 macOS Sentry synthetic/native-crash gates 全部通过；真实 opt-in/opt-out、no-IP/Release Health 与 24h/72h cohort 仍待只读观察。本地已有 gitignored、mode 600 的只读 Sentry credential；本次发版没有修改外部 Sentry project 设置。

## 一、用户问题与本计划的边界

### 1.1 用户原始问题

用户观察到近期 Sentry 报错明显增多，并怀疑现有检测没有适配当前 CodePilot 版本，希望确认：

1. Sentry 采集本身是否仍然有效；
2. 报错增长是 SDK / Electron / Next.js 版本不兼容，还是检测规则失真；
3. 当前后台具体有哪些真实产品问题；
4. 哪些只是开发环境、旧版本、Fork、用户配置或供应商状态造成的噪音；
5. 应该按什么顺序修复，才能让后续 Sentry 数据重新可用；
6. Sentry 是否还能在不采集个人信息的前提下，提供用户量与用户活跃度变化趋势。

### 1.2 核心判断

Sentry 传输链路仍然有效；当前主要问题不是“SDK 完全失效”，而是遥测合同没有跟上 CodePilot 现在的多 Runtime、多 Provider、Electron + Next 三层运行形态：

- 一个公开硬编码 DSN 同时接收官方版本、开发环境和衍生项目事件；
- Browser、Next server、Electron main 三层初始化策略不一致；
- 用户取消、没凭据、认证失败、额度不足、模型权限、Provider 测试失败等预期结果大量进入 Error Issues；
- 自定义 fingerprint 含动态错误文本，tool/session/request ID 与原始响应把同一根因裂成多个 Issue；
- 构建会生成部分 source map，但发布流程没有向 Sentry 注入 / 上传可匹配的调试信息；
- 当前脱敏只删除少量认证请求头，原始响应、路径、主机名、URL 与高基数 ID 仍可能进入事件；
- `@sentry/browser` / `@sentry/node` 9.47.1、`@sentry/electron` 6.11.0 比当前主版本落后一代，但这不是噪音增长的主因，不能用盲目升级代替采集治理。

### 1.3 本计划负责什么

本计划只负责把遥测基础修到“可信、可定位、可分诊、可安全发布”：

1. 隔离官方稳定构建、开发环境、preview 和 Fork；
2. 统一三层 Sentry 初始化、opt-out、release、environment、runtime layer 与脱敏合同；
3. 建立稳定的错误语义分类和 fingerprint；
4. 上传并验证 renderer、Next server、Electron main 的 source map；
5. 补齐被 catch / fallback 吞掉的关键产品故障，同时禁止把预期失败重新灌入 Error Issues；
6. 在独立阶段升级 Sentry SDK，并验证 Electron 40 / Next 16 / packaged app；
7. 发布后用 72 小时干净数据生成下游缺陷清单。

### 1.4 本计划明确不做什么

- 不在同一计划里直接修完 `AI_NoOutputGeneratedError`、SenseNova malformed tool call、`MissingToolResults`、GPU crash 等所有产品缺陷；它们使用干净遥测重新定级后，各自进入 issue tracker 或独立执行计划。
- 不新增 Session Replay、性能 tracing、录屏、prompt 采集或完整用户行为分析。
- 不生成硬件指纹，不上传 email、用户名、IP、设备名。默认 U0 合同不新增安装 ID；若用户在 Phase 0 明确选择 4.6 的 U1a/U1b，只允许使用按月轮换的随机匿名安装标识，并必须配套独立、透明的“匿名使用统计”开关，不能借用现有“错误上报与崩溃率统计”授权。
- 不删除、改写或批量 resolve 旧 Sentry 项目中的历史 Issue；旧项目保留为只读历史基线。
- 不把 DSN 当成密码。目标是避免源代码和 Fork **意外继承**官方项目，不承诺阻止攻击者从官方二进制提取公开 ingest DSN。
- 不自动创建 Sentry 项目、GitHub Secret、push、tag 或发版；这些外部动作必须由用户明确批准。

## 二、状态总览

| Phase | 内容 | 状态 | 用户结果 / 备注 |
|---|---|---|---|
| Phase 0 | 合同冻结、POC、外部资源决策 | 🔄 新 project、Secrets、资源取舍已落地；线上基线独立复核待完成 | 用户已采用默认 U0；无 user/did/行为统计；接受 stable tag 绝对 +13.4s |
| Phase 1 | 官方构建隔离 + 三层统一初始化 | 🚧 已随 v0.64.0/v0.65.0 发布；真实 opt-out/main-only session 抽查待完成 | development/preview/Fork 默认 no-op；U0 目标为仅保留 main session |
| Phase 2 | 脱敏、语义分类、稳定 fingerprint | 🚧 Phase 6 P1 code complete + local gates pass；stable smoke 待闭合 | 4xx/DNS/timeout/NoOutput 统一 normalizer；user-action 0 event；product fault stack grouping 保留 |
| Phase 3 | Source map 发布闭环 | ✅ macOS/Windows/Linux upload/package + 三层 symbolication + 有界重试闭合 | CI #310/#311/#313；三层分别定位 `smoke.ts:21/23/25`；所有已验证最终包 0 map；上传最多 3 次后 fail closed |
| Phase 4 | 关键覆盖补洞 + 端到端遥测合同 | 🔄 shared provider/native root-cause extractor、anti-double-capture fixture 与 local build 已补；真实 stable smoke 待跑 | callScene、connection-test 排除、provider body marker、resolved terminal/catch one-shot capture 已落地 |
| Phase 5 | Sentry SDK 独立升级 | 🟡 已随 v0.64.0/v0.65.0 发布；migration/RSS 记录待收尾 | browser/node 10.69.0、Electron 7.16.0；CI #312 event `778040c8…` 为真实 minidump；CI #313 Linux 双架构通过 |
| Phase 6 | 发布、72h 观察、信号清理与下游缺陷移交 | 🚧 `v0.66.0` 已发布，P0/P2/P3 待线上证据 | v0.64.0/v0.65.0 只作修复前基线；以 v0.66.0 单一 release 重新建立 24h/72h 窗 |

## 三、事实基线（2026-08-02）

### 3.1 线上事件基线

下列数字来自 Codex 于 2026-08-02 使用只读 Sentry API 对 `codepilot-rg / javascript-nextjs` 的查询。首轮 Claude Code reviewer 因无凭据未能独立复核；数字与代码事实自洽，但在 Phase 0 冻结基线前必须由第二个持只读凭据的执行者重跑同口径查询，不能把本表当作不可变事实：

| 指标 | 基线 |
|---|---:|
| Error events 总量 | 4,889 |
| `production` | 4,105 |
| `development` | 784 |
| `POST /api/chat` | 3,967 |
| `POST /api/providers/test` | 255 |
| `POST /api/bridge` | 134 |
| `codepilot@0.63.0` | 查询时 0 条，尚无可判断样本 |

Release 中同时出现 `CapyWork@0.3.x`、`linkiebuypilot@1.0.2`、`xteam@0.59.1`、`xclaude@1.50.7` 等非官方 CodePilot 身份。不能再用项目总量直接代表当前官方版本质量。

同日再次只读查询当前 Top unresolved issues，返回的 `userCount` 均为 `0`；仓库中也没有显式 `Sentry.setUser`、`startSession`、`captureSession` 或 `endSession` 调用。因此当前后台**不能**据此推导活跃用户数。

已安装的 `@sentry/electron` v6 默认启用 `mainProcessSessionIntegration()`，`@sentry/browser` v9 默认启用 `browserSessionIntegration()`；当前 main 与 renderer 初始化又没有逐层覆盖该默认值。因此在启用遥测的打包版中，旧项目会同时收到 main + renderer 两层 session。现有 session 总数存在重复分母，不能直接解释成“应用启动数”，更不能解释成用户活跃；U0 是治理并收窄一项**已经存在**的 crash-free 基础采集，而不是新增用户行为采集。Next server 是否产生 session envelope 仍须 Phase 0/1 用 mock transport 核实。

### 3.2 已确认的高频问题族

下面是实施前的分诊底稿，不是本计划内全部直接修复的承诺：

| 问题族 | 当前判断 | 本计划动作 | 下游动作 |
|---|---|---|---|
| `AI_NoOutputGeneratedError` / `EMPTY_RESPONSE` | 真实高频，但混有旧版本、Provider / proxy / stream 多种根因 | 统一 reason code、fingerprint、release/runtime/provider tags；确保错误 part 不丢失 | 72h 后按 root-cause bucket 建独立修复项 |
| Claude-compatible 401/402/403、额度不足、无 payment method | 用户或供应商状态 | 从 product error 中分离；保持用户可见错误，不进高优先级 Error Issue | 无产品 bug 时不立项 |
| Provider test 404 / model permission | 连接测试的预期负结果 | 测试 API 返回结构化诊断；禁止携带完整 HTML / raw body 上报 | 如目录映射错误再单独立项 |
| SenseNova malformed tool call | 真实 Provider 协议兼容问题 | 生成稳定 `provider_protocol_invalid_tool_call`，不上传原始 chunk | 用脱敏 fixture 建专门兼容修复 |
| `MissingToolResults` | 真实工具生命周期问题，旧版占比高；`tool-error` 处理在 v0.58.0（`0cfdfe41`）已落地，不是 v0.63 新修复 | 用稳定 invariant code 合并 issue；补成功 / tool-error / abort / missing-result 合同证据 | 若 v0.63 新样本仍发生，独立修复 |
| `toLocaleString` on `undefined` | 真实 renderer 崩溃；当前 minified stack 无法定点 | source map 闭环后确认源码；禁止先凭猜测把缺失统计伪造为 0 | 确认位置后单独修复；疑似 token usage 时缺失字段应隐藏而非显示假 0 |
| Electron `Utility process abnormal-exit` | 正常退出 / 重启和真实崩溃混杂 | 增加 lifecycle reason/context；只过滤有证据的 expected exit | 真实 server/utility crash 独立修复 |
| Windows GPU/native crash | 真实稳定性问题但主要来自旧版 | 保留 native crash 可观测性与 platform tags；禁止 blanket ignore | 依据当前 release 样本决定 GPU fallback / Electron 升级 |

### 3.3 当前代码触点

| 层 | 当前入口 | 已确认问题 |
|---|---|---|
| Browser / renderer | `src/components/layout/SentryInit.tsx`、`src/components/layout/ErrorBoundary.tsx` | development 也初始化；过滤与脱敏不完整；ErrorBoundary 直接依赖 browser SDK |
| Next server | `src/instrumentation.ts`、`src/lib/error-classifier.ts` | 有 dev gate，但 fingerprint 含 message；`setExtras(extra)` 全量发送；background catches 覆盖不完整 |
| Electron main / native | `electron/main.ts` | 只有 DSN；无 release/environment/beforeSend/ignore policy；dev 与 expected process exit 偏噪 |
| Build / release | `next.config.ts`、`scripts/build-electron.mjs`、`electron-builder.yml`、`.github/workflows/build.yml` | DSN 写死；Electron esbuild 生成 map 但没有 debug-id inject/upload/verification；Next production server 当前实测没有可上传 map |
| Docs / tests | `docs/handover/sentry-error-reporting.md`、现有 Sentry unit tests | 文档仍列已删除的 `PROCESS_CRASH`；未锁 Browser/Electron/CI/source-map/fingerprint/sanitizer 合同 |

**实施前的源码暴露（已关闭的历史基线）：** 当时 `electron-builder.yml` 的 `files: dist-electron/**/*` 会把 `dist-electron/main.js.map` 打入安装包；该 map 默认含 `sourcesContent`。Phase 3 已改为所有 FileSet 排除 `.map`，并由 macOS/Windows/Linux 最终包 0-map gate 实证；不得再把本段误读为 v0.64.0/v0.65.0 的当前风险。

### 3.4 SDK 版本基线

| Package | 当前 lockfile | 2026-08-02 npm registry | 判断 |
|---|---:|---:|---|
| `@sentry/browser` | 9.47.1 | 10.69.0 | 落后一代，但现有事件证明 transport 仍工作 |
| `@sentry/node` | 9.47.1 | 10.69.0 | 落后一代；升级必须复测 Next dev 内存门禁 |
| `@sentry/electron` | 6.11.0 | 7.16.0 | 落后一代；升级必须复测 Electron 40 native/utility/packaged 行为 |

版本升级是维护项，不是对当前污染、分组和脱敏问题的根因解释。

### 3.5 既有修复不得回退

以下能力已经存在，本计划必须在其上收口，不得重新引入历史盲区：

- `EMPTY_RESPONSE` 和 `TIMEOUT_*` 已加入 reportable allow-list；timeout 不再被 abort filter 吞掉。
- Native agent loop 和 POC 自 v0.58.0 起已处理 `tool-error` part。
- Next server 在 development 下不初始化 `@sentry/node`，避免把 OpenTelemetry 依赖链拉入 Turbopack dev 内存图。
- 用户已有 Sentry opt-out 设置与 marker file；本计划只能统一语义，不能静默取消用户选择。
- `PROCESS_CRASH` 因历史噪音从 reportable 分类中移除；不得仅为“多收数据”原样恢复。

### 3.6 2026-08-04 当前发布线复核

**修复前诊断基线（已独立核验，并在本 worktree P1 修正）：**

- 本任务起点 worktree clean，`HEAD == origin/main == v0.65.0 == 979fda51`；现有计划此前仍写“尚待用户明确 v0.64.0 tag”，属于状态失真。
- GitHub Release 只读查询确认 `v0.64.0` 为非 draft、非 prerelease，发布时间为 2026-08-02 16:44:25 UTC（北京时间 2026-08-03 00:44）；`v0.65.0` 为非 draft、非 prerelease，发布时间为 2026-08-04 04:06:25 UTC（北京时间 12:06）。
- `v0.64.0..v0.65.0` 没有改动 `src/lib/telemetry/**`、Sentry source-map 脚本或三层 init policy；`electron/main.ts` / `src/instrumentation.ts` 有助理通知/心跳相关改动，所以两个 release 的 crash/error 指标仍必须分开，不得直接合并成一个 72h cohort。
- `src/lib/telemetry/contract.ts` 已满足：凭据缺失和模型不支持类别进入 `user_action_required`；`TIMEOUT_*` 进入 `transient_upstream`；有 stack 的 `product_fault` / `unknown` 保留默认 stack grouping。
- `src/lib/telemetry/provider-failure.ts` 只把 401/403/404 归 `user_action_required`；402、400/422 与其他 4xx 仍落 `unknown`，429 仍落 `transient_upstream`，不符合本轮冻结的“HTTP 4xx → user_action_required”目标。
- 同文件只识别 message 中的 timeout；DNS `ENOTFOUND` / `EAI_AGAIN` 没有稳定映射。Native catch 又以 `NATIVE_STREAM_ERROR` 上报，`classifyTelemetryOutcome()` 不会仅凭 `retryExhausted` 把它转成 transient，因此 DNS 可继续成为 `unknown + needs_classification`。
- `agent-loop.ts` / `experimental/agent-loop-toolloop-poc.ts` 的 `onError` 和 catch tail 都只看顶层 message；`AI_NoOutputGeneratedError` 在 `finishReason` / stream 失败时被作为 `NATIVE_STREAM_ERROR` 上报，没有有界解包 `cause` / status。底层 403 因而可能被 wrapper 隐藏，正好解释交接快照中的 `NATIVE_STREAM_ERROR / unknown / needs_classification`。
- `src/lib/error-classifier.ts` 对 `user_action_required` 仍调用 `Sentry.captureMessage('telemetry.health_summary', 'info')`。info event 仍会形成 Issue，违反本轮“不要用 info event 灌 Issue”的冻结合同；`provider-failure.ts` 的 shared boundary 则已经直接丢弃该 outcome，两处政策目前不一致。
- `MessageItem.tsx` 对从 DB JSON 直接解析出的 `token_usage` 不做 runtime shape 校验，随后调用 `usage.input_tokens.toLocaleString()` / `output_tokens.toLocaleString()`；字段缺失时是真实 renderer 产品缺陷候选。本主线已用稳定 ID `HEXP-SENTRY-001` 交接“历史体验问题”任务 `019fcbe8-7d8e-7ac3-a3ea-e7532a663223`，不在这里修 UI。

**本 worktree 修复后判断：**

- `src/lib/telemetry/root-cause.ts` 统一 shared Provider、Claude classifier 与 Native 两条 loop：最多 4 层/16 节点，只读取 cause/status/code/name/message allow-list，不遍历或返回 body/chunk/request/data；循环、超深、非 Error、hostile getter fixture 已锁定。
- 全部结构化 HTTP 4xx（含 400/402/422/429）、凭据与模型不支持均为 `user_action_required + shouldReport=false`；旧 `health-summary.ts` 与 info capture 路径已移除。
- 5xx、`ENOTFOUND`、`EAI_AGAIN` 与 timeout 只有 `retryExhausted:true` 才创建 stable transient event；Native/ToolLoop `onError` 只保存并 marker 原始 SDK error，response/finish-step 或 catch 确认 terminal 后才 one-shot 上报。
- NoOutput wrapper 优先使用底层 4xx/5xx/DNS/timeout；无 upstream 根因才进入 `EMPTY_RESPONSE` protocol bucket。unknown/product Error 用固定 message 的安全副本保留原 stack frame，不设置 custom fingerprint；原始 message/cause graph 不进入事件。

**尚未独立核验：**

- 交接快照称新 project 约有 37 个 unresolved issue、406 个 error samples、8 个 unhandled、334 sessions，crash-free sessions 约 98.5%。当前已有本地只读 credential 并完成一次 API 访问校验，但尚未按 `project + production + 单一 release` 完成整组 P0/cohort 复跑；这些数字在查询补齐前仍标为 `unverified handoff snapshot`。
- crash-free users 为 0% 与 U0 不绑定 user id 的代码合同一致，但线上展示值仍需只读 API/Release Health 查询复核；它不能被当作产品故障或“没有用户”。

## 四、目标遥测合同

### 4.1 事件身份

每个允许上报的事件必须具有稳定且低基数的字段：

| 字段 | 允许值 / 来源 | 约束 |
|---|---|---|
| `release` | `codepilot@<package.version>` | stable build 必须存在；禁止 `undefined` |
| `environment` | `production` / `preview` | development 默认完全关闭；preview 仅显式 opt-in |
| `app.channel` | `stable` / `preview` | 由 CI 构建注入，不由客户端猜测 |
| `runtime.layer` | `renderer` / `next_server` / `electron_main` | 三层统一命名 |
| `runtime.id` | canonical RuntimeId 或 `host_application` | 不使用用户可编辑显示名 |
| `provider.protocol` | `anthropic` / `openai` / `responses` / `unknown` 等稳定枚举 | 不发送完整 base URL 或用户自定义 provider 名 |
| `provider.class` | 官方 preset key / `custom_endpoint` / `local_proxy` | 自定义域名不进入 tag |
| `model.family` | 可稳定归一化的 family；无法确认时 `unknown` | 不把任意 raw model 字符串用于 fingerprint |
| `outcome.kind` | 见 4.2 | 必须先分类再决定是否发送 |
| `error.code` | 稳定机器码 | 禁止直接使用动态 message |
| `http.status_class` | `4xx` / `5xx` / `network` / `none` | 只有确有 HTTP 语义时写入 |
| `os.platform` / `os.arch` | 运行时系统枚举 | 不含主机名、用户名或硬件唯一标识 |

### 4.2 Outcome 分类与发送政策

| `outcome.kind` | 例子 | 用户行为 | Sentry Error policy |
|---|---|---|---|
| `product_fault` | DB invariant、renderer crash、内部状态机错误、必需字段非法 | 保留当前错误 UI / recovery | 100% 上报；有 stack 的异常保留 Sentry 默认 stack-based grouping，不强设 custom fingerprint |
| `provider_protocol_fault` | malformed stream/tool call、响应 schema 不合法 | 显示 Provider 兼容错误 | 上报脱敏结构，不上传 raw chunk/body；custom fingerprint 必须含 `provider.class` |
| `transient_upstream` | retry exhausted 的 5xx、DNS、TLS、timeout、ECONNRESET | 显示可重试提示 | 只在重试耗尽后上报；按协议 + status/code 合并 |
| `user_action_required` | HTTP 4xx、no credentials、余额/额度、model permission、region opt-in | 显示明确操作建议 | 不创建 Error Issue，也不以 info event / `captureMessage` 创建 health-summary Issue；本轮不新增 metrics、身份或行为采集 |
| `provider_test_result` | 设置页测试返回 404/invalid model | 测试结果留在 UI | 不创建 Error Issue |
| `user_cancelled` | stop、AbortError、窗口关闭导致的主动中断 | 正常结束或显示已停止 | 丢弃，不上报 |
| `expected_lifecycle` | 应用退出 / 主动重启导致的 child exit | 无额外错误 | 只有可证明的退出状态才丢弃 |
| `unknown` | 无法分类 | 保持原有 recovery | 受控上报并标 `needs_classification=yes`，不得附 raw payload；有 Error stack 时保留默认 stack grouping |

本轮按用户冻结的信号治理目标，Provider HTTP 4xx 先统一归 `user_action_required`，包括 400/402/403/404/422/429 等；明确由本地 timeout budget 产生的 `TIMEOUT_*` 仍按 timeout 事实进入 `transient_upstream`。这会牺牲“canonical payload 400 是产品 bug”的自动推断，但当前生产边界没有可靠责任证据，继续把 400/422 送入 `unknown` 只会污染 Issues。未来若调用方提供结构化、可测试的责任枚举，可另开计划把确定由 CodePilot canonical payload 造成的 4xx 提升为 `product_fault`，不得靠 message substring 猜测。

`user_action_required` 在本轮必须完全退出 Sentry Issues：不逐错误发送，不发 `level=info` health summary，不以 `captureMessage` 或异常 level 名称规避 Issue 成本。凭据/header/模型权限的版本回归只能通过用户反馈、Provider Doctor、本地脱敏诊断，或未来单独审批的非 Issue metrics 合同观察；本阶段不为补这个洞扩大 telemetry、身份或行为采集。现有 `telemetry-health-v1.json` / `claimHealthSummary()` 路径在下一次获授权实现时应与 capture 入口一起移除或停用，并同步更新 guardrail/handover/tests。

`AI_NoOutputGeneratedError` 不是最终分类。进入分类前必须有界解包 wrapper（至少顶层、`cause`、SDK error/response status 的结构化字段），只保留稳定类型、code、status class 和 retry 事实：底层 4xx → `user_action_required`，5xx/DNS/timeout → `transient_upstream`，协议上成功但真正无输出 → `provider_protocol_fault`；无法证明时才是 `unknown`。不得上传 raw response body/chunk，也不得让 wrapper message 进入 fingerprint。

### 4.3 稳定 fingerprint

custom fingerprint **只用于已经结构化归一的** `provider_protocol_fault`、`transient_upstream`、`expected_lifecycle` 以及没有可用 stack 的已知机器码事件。统一格式为：

```text
[error.code, runtime.layer, runtime.id, provider.protocol, provider.class, http.status_class]
```

有 stack 的 `product_fault`（包括 renderer 未处理异常、Next/Electron 内部异常）默认交给 Sentry stack-based grouping；source map 完成后应利用源码 frame 分组，禁止把所有 renderer crash 压成一个 `renderer_unhandled` Issue。只有经过 fixture 证明某模型家族确实需要独立修复时，normalized custom fingerprint 才允许追加 `model.family`。以下内容禁止进入 fingerprint：

- error message 或其 substring；
- session/task/tool/request ID；
- URL、base URL、文件路径；
- HTTP response body / provider raw chunk；
- 用户自定义 Provider / Assistant / Workspace 名称；
- 时间戳、PID、端口、随机 ID。

### 4.4 隐私与脱敏 allow-list

默认拒绝、只有 allow-list 字段可以进入 Sentry。至少覆盖：

- 请求：删除 cookies、authorization、所有 API key/token header、query、body；只保留 route template 与 method。
- Exception：保留错误类型、稳定 code、可 symbolicate stack；message 先做 secret/path/URL/control-char 清洗和长度上限。
- SDK：三层显式设置 `sendDefaultPii: false`；任何后续改动不得仅依赖 SDK 当前默认值。
- Breadcrumb：禁止 UI input、prompt、assistant response、tool input/result、clipboard、local file content；网络 breadcrumb 只保留 method、route class、status class；console breadcrumb 默认关闭，或经过与 event 相同的 sanitizer/allow-list 后才允许保留，不能让 `console.log/warn/error` 绕过脱敏。
- Context/extras：删除 `sessionId`、task/tool/request ID、baseUrl、rawMessage、responseBody、provider chunk、工作目录与本地文件绝对路径。
- Host/device：删除 `server_name`、username、device name、IP；只保留 `os.platform`、`os.arch`、Electron/Node/Chromium 版本。
- Stack path：必须同时满足“用户目录不可见”和“source map 仍可匹配”。若改写 frame `abs_path` / `filename`，必须同步改写相关 `debug_meta.images[].code_file`，确保二者保持同一 canonical path；禁止在未做 symbolication smoke 前直接粗暴删除所有 `abs_path`。
- 任何 payload 单字段设定长度上限；超限只写 `{truncated: true, originalLength}`，不上传前 N KB 原文。

### 4.5 Opt-out 与失效原则

- Browser、Next server、Electron main 必须读取同一个用户语义；实现可以分别使用 localStorage / marker file，但状态变更、重启需求和 UI 文案必须真实。
- Sentry 初始化、transport、上传失败永远不能阻断聊天、启动、退出或打包后的核心功能。
- stable release 的 **CI 遥测门禁** fail-closed：缺少官方 DSN 或 source-map upload token 时禁止宣称该构建已具备本计划能力。
- 客户端运行时 fail-open：Sentry 不可用时应用继续运行，本地诊断日志仍可用。

### 4.6 用户量与活跃度合同（Phase 0 待用户拍板）

Sentry 可以提供 Release Health 的 session 数、版本采用率、crash-free sessions；在事件或 session 附带匿名 user id 后，也能查询 `count_unique(user)` 与 crash-free users。但这些数字只能代表“被当前遥测合同观测到的匿名安装”，不是自然人数量：同一用户的两台设备会被算两次，重装会产生新安装，关闭遥测的用户完全不可见。

当前打包版已经通过 SDK 默认集成向旧项目发送 main + renderer 两层 session。这个现状不具备可靠计数口径：同一次应用运行可能产生多个 session，而且 renderer reload 还可能进一步放大分母。U0 的目标是只保留 Electron main 的进程 session，显式关闭 renderer 并核实/关闭 Next server session tracking，用它服务于发布采用率和 crash-free sessions。设置文案同步改为“匿名错误上报与崩溃率统计”，明确 session 属于错误健康基础设施；它不等同于用户行为授权。

当前可选档位如下：

| 档位 | 采集合同 | 能回答什么 | 明确不能回答什么 |
|---|---|---|---|
| U0：Release Health only（默认） | 仅官方 stable 的应用进程 session，不附 user/install id | 启动 session、版本采用率、crash-free sessions | 独立用户、DAU/MAU、留存、功能使用 |
| U1a：匿名启动安装趋势（现有 Sentry 原语优先候选） | 用户单独 opt-in 后，在 Electron main session 起点绑定按月轮换匿名 did | 月内去重的匿名启动安装数、版本分布、crash-free users | 不是行为活跃；开机自启/纯托盘驻留会高估，多日常驻进程只在启动日计数而低估后续日期，不能承诺准确 DAU/MAU |
| U1b：匿名行为活跃趋势（条件候选） | 用户单独 opt-in；只有主窗口首次发生有意义操作才产生当日一次信号 | 只有 Phase 0 POC 成功后，才允许承诺近似日/月活跃安装趋势 | 当前没有已证明可用的 Sentry 数据集/绑定时机；POC 失败即不可选，不能假装由 session 或 info Issue 实现 |
| U2：完整产品分析（独立计划） | 使用独立 project/service、独立 consent 与事件 taxonomy | 留存、路径、功能采用、漏斗 | 不得混入本错误治理计划或 Error Issues 项目 |

U1a/U1b 的共同硬约束：

- 匿名 id 不得从硬件序列号、MAC、用户名、email、路径、主机名或 IP 推导；服务端永远收不到本地随机 seed。
- 按月轮换意味着月界附近的跨月留存不可计算，这是主动接受的隐私代价，不得用永久 id 偷补。
- 现有设置只承诺“匿名错误上报与崩溃率统计”，不能据此附加匿名 did 或发送 activity signal。U1a/U1b 必须增加独立文案、独立开关和独立 opt-out 行为；关闭后所有 session 与错误事件都不得出现 user/did。
- U1a 开启后，为得到 crash-free users，按月匿名 did 会从 main session 起点开始附在该 session 与 consent 期间的三层脱敏错误事件上；这一组合必须在独立开关文案中明示。
- U1b 开启后，main 的 U0 session 仍不附 did；当日首次有意义操作成功写入合格 activity 数据集后，按月匿名 did 才附在 activity signal 与该 app-run 后续脱敏错误事件上，操作前的错误事件保持无 did。U1b 因此不承诺 crash-free users。两种档位的 did 均不得进入 fingerprint、日志或本地诊断导出。
- U1b 中“应用进程仍在托盘运行”不算活跃；只有主窗口中发生明确用户操作才可触发当日 signal。后台任务、轮询、自动更新和 provider retry 不得冒充活跃。U1a 不满足这个定义，所以只能叫“启动安装趋势”，不能叫“活跃用户”。
- Sentry 自定义 Metrics 不作为现成可用能力。U1b POC 必须找到实施时仍受支持、不会创建 Error Issue、能查询 distinct anonymous did、可按有意义操作触发且成本可控的数据集/API。`captureMessage` 或 `level=info` 仍会形成 Issue，不是合格实现；找不到机制就停止 U1b，回到 Phase 0 由用户选择 U1a 或 U2，不得静默降级。
- U1a POC 必须证明 did 能在 main session 创建前绑定，同时不把 `Sentry.init` 移到 Electron import 之后；若必须读取本地 seed，必须给出同步读取的启动耗时上界与故障降级。U1b 的 activity 初始化在 app ready 后独立进行，两个失败域均不得阻断错误采集或应用启动。

## 五、详细实施计划

## Phase 0 — 合同冻结、POC、外部资源决策

### 用户会看到什么变化

无产品 UI 变化。用户得到一份经 Claude Code review 后可直接执行的范围和外部资源清单。

### 用户如何验收

- Claude Code review 明确给出 `Review passed` 或逐条 blocker；
- 用户只需拍板“新建干净 Sentry project + stable CI 注入”方案，以及 4.6 的 U0/U1a/U1b/U2 档位；U1b 在 POC 前只是一项候选能力，不得作为已可交付选项推荐；
- 不要求用户审核 Sentry SDK API 细节。

### 本阶段明确不做

不修改产品运行时分类/业务行为、不升级 SDK、不创建 production Sentry project、不写 GitHub Secret。允许在隔离产物上做 source-map POC，并允许先落 `*.map` 打包排除这一项独立 security fix；POC 不得把测试 artifact 伪装成可发布产物。

### 执行清单

- [x] 把本文及 `docs/exec-plans/README.md` 索引改动迁入从 `origin/main@91a99606` 建立的独立 `codex/sentry-telemetry-plan` 分支；`codex/harness-home-implementation` 已清理本任务草案与索引改动，未跨 feature worktree 提交。
- [ ] Claude Code 已独立复核代码坐标和修复状态，两轮 finding 修复后本地审查结论为 `Review passed`；但 reviewer 无线上只读凭据，最近 14 天事件口径尚未由第二执行者复跑，本项保持未完成。
- [ ] 由第二个具有只读 Sentry 凭据的执行者重跑 3.1 同口径查询，记录查询时间、environment/release filters 与结果；若数字变化，只更新基线，不改变分类判断。
- [x] 用户批准新建仅供官方 stable build 的 Sentry project；已创建 `codepilot-desktop`，旧 `javascript-nextjs` 保持不动，作为历史基线。
- [x] 用户先选择希望验证的 U0/U1a/U1b/U2 候选：本轮按默认 U0 实现；不生成 did，不启动 U1a/U1b POC。
- [x] 确认并配置 CI Secrets：`SENTRY_DSN`、`SENTRY_AUTH_TOKEN`、`SENTRY_ORG`、`SENTRY_PROJECT`；上传 token 仅有 `org:ci` 权限，没有事件读取或管理权限。
- [x] 实测 `turbopackSourceMaps` / `turbopackInputSourceMaps`：仅 `productionBrowserSourceMaps + debugIds` 只有一个 53B 空 map；必须开启 output maps；input maps 对 CodePilot symbolication 非必需且保持关闭。
- [x] POC 已生成真实 renderer/server maps；编译从 9.2s 增至 22.6s（+146%，绝对 +13.4s），用户于 2026-08-02 明确接受该 stable tag CI 代价。该决定不豁免真实 upload、符号化或 native crash 门禁。
- [x] `sentry-cli sourcemaps inject --dry-run` 已覆盖最终 Next renderer/standalone server/Electron bundle；GitHub Actions run #310 已向新 project 执行 macOS/Windows 真实 upload，两个上传均关联 release `0.63.0`。
- [x] 本地 unpacked macOS package 证明最终 bundle 与构建树一致，`.app` 外部及 `app.asar` 内均为 0 map；后续 CI #311 已完成真实上传后的三层 debug-id symbolication，本项不再待执行。
- [x] `dist-electron/**/*.map` 及所有 standalone/static/node_modules FileSet 已从 electron-builder 输入排除，并有包结构测试。
- [ ] 记录 SDK v10 / Electron SDK v7 migration breaking changes；Phase 0 只形成升级清单，不混进 Phase 1。
- [x] 新增 `docs/guardrails/SentryTelemetry.md` 并更新 guardrails/handover/insights 三处索引与配对文档。

### Phase 0 完成门禁

- 文档已迁入独立分支，Harness Home worktree 恢复无本任务改动；
- 新项目 / 复用项目方案与 U0/U1a/U1b/U2 使用统计档位由用户拍板；
- 若用户选择 U1a 或 U1b，对应 POC 已给出真实 transport/API 查询证据、成本与已知偏差；U1b 找不到合格的非 Issue 信号机制时必须标记不可选；
- 3.1 Sentry 基线已由第二个持只读凭据的执行者复核；
- source-map POC 至少证明 Next renderer + Next server 能实际生成 map，并对一个 synthetic Node 或 Electron bundle 成功 symbolicate；
- 下一次 packaged artifact 已通过“不含 `.map` / `sourcesContent`”结构门禁；
- Claude review 对“官方构建身份、分类边界、隐私 allow-list、SDK 升级隔离”无 blocker。

## Phase 1 — 官方构建隔离与三层统一初始化

### 用户会看到什么变化

设置中的开关保持原位置，但文案更新为“匿名错误上报与崩溃率统计”，解释 U0 的 main-process session 用于版本采用率与 crash-free sessions，不代表行为活跃。开发运行和普通源码 Fork 默认不再向 CodePilot 官方 Sentry 发送事件；官方 stable 安装包仍按用户 opt-out 选择上报。

### 用户如何验收

- `npm run dev` 和 `npm run electron:dev` 触发 synthetic error，mock / network 断言为 0 次 Sentry envelope；
- 官方 packaged smoke 中 opt-in 发送 1 条 synthetic event，opt-out 发送 0 条；
- Sentry 事件显示正确 `release / environment / app.channel / runtime.layer`。

### 本阶段明确不做

不调整业务错误分类，不升级 SDK，不修 NoOutput 等产品问题。

### 执行清单

- [x] 删除 `next.config.ts` 和 `electron/main.ts` 中的硬编码 DSN；源码 checkout 无 CI 注入时 Sentry 全层 no-op。
- [x] stable tag build wiring 从 GitHub Actions Secret 注入 DSN；preview 默认关闭。v0.64.0/v0.65.0 已完成正式发布，仓库侧 Secret 不再是“尚待配置”。
- [x] 建立 universal 纯函数配置层与三层 adapter；Electron main policy 为同步无副作用 import。
- [x] Browser、Next、Electron 统一 release、environment、channel、runtime layer、opt-out 与 traces=0 合同。
- [x] Session tracking 逐层显式配置：U0 仅保留 Electron `MainProcessSession`；renderer 过滤 `BrowserSession`；server 过滤 `ProcessSession` 并以 `trackIncomingRequestsAsSessions:false` 替换默认 `Http`，真实 Node client/request 行为测试锁定 0 request session。
- [x] 更新设置页 i18n、handover 与 insight：U0 明示 crash-free session 用途及非行为分析边界。
- [ ] 若 Phase 0 最终选择 U1a，实现仅限已通过 POC 的 main-session did 绑定；若最终选择 U1b，实现仅限 POC 证明的非 Issue 数据集/API。有任一语义无法满足即停止该可选项，不影响 U0 和错误治理主线。
- [x] Electron 保持源码顶部同步初始化；options 只过滤明确禁用 integration，不清空默认列表，保留 `MainProcessSession`/minidump；CI #312 已完成真实 native crash smoke。
- [x] ErrorBoundary 通过统一 facade capture；非 production/stable/未初始化时 no-op。
- [x] stable workflow 与测试禁止源码 ingest literal，上传 token 只在 CI upload step。
- [x] 已有 universal config、真实 Node client、instrumentation shape、Electron source/build-wiring 测试覆盖 dev、stable、preview、无 DSN、opt-out 与 default integrations；`telemetry-build-wiring.test.ts` 锁定源码中 `Sentry.init` 早于 Electron import。最终 packaged `dist-electron/main.js` 的 init 顺序仍由发布 smoke 负责，不把源码 shape 冒充最终 bundle 反汇编证据。

### Phase 1 完成门禁

- development 三层均为 0 envelope；
- stable opt-in 三层均能送达，stable opt-out 三层均为 0；
- U0 每次 app process run 只有 Electron main 的一个 session 序列；renderer / Next server 均为 0 session envelope；U1a/U1b 关闭时错误事件均无 user/did，开启时严格遵守 4.6 与验证矩阵的绑定时机；
- 事件不存在 `release=undefined`；
- 新官方项目 72h 内无普通 Fork / development 事件（恶意提取 DSN 不在承诺内）；
- `npm run test`、production build、macOS packaged smoke 通过；Windows 由 CI packaged gate 验证。

## Phase 2 — 脱敏、语义分类与稳定分组

### 用户会看到什么变化

聊天和 Provider 测试仍显示真实错误原因；取消、没凭据、余额不足、模型无权限等情况不再被后台误判为 CodePilot 崩溃。用户输入、模型回复、本地路径和凭据不会因为本轮治理被新增到遥测。

### 用户如何验收

用户不需要查看 Sentry 内部字段。行为 smoke 应证明：相同失败仍有明确 UI 提示，且 mock transport 收到的事件符合发送政策。

### 本阶段明确不做

不隐藏用户需要采取行动的错误，不把缺失统计显示成假 0，不通过删除所有 stack frame 换取表面脱敏。

### 执行清单

- [x] 实现 `classifyTelemetryOutcome(error, context)` 纯函数；输入为稳定上下文，不依赖 UI 文案字符串作为唯一事实源。
- [x] 移除 `CLI_NOT_FOUND` 的宽泛 `not found`，新增 executable/model/endpoint 反例 fixture；Provider connection test 在 shared provider boundary 明确进入 `provider_test_result`。
- [x] telemetry capture 对 non-Error 只抽取 status 等 allow-list 字段；event sanitizer 阻断任意对象正文与 `[object Object]` grouping。
- [x] 替换 `scope.setExtras(extra)` 全量写入；逐字段 allow-list。
- [x] 删除 `msg.slice(0, 100)` fingerprint；实现稳定 key builder。
- [x] provider / AI SDK shared boundary 已补齐：HTTP 4xx → `user_action_required`，5xx/DNS/timeout → `transient_upstream` 且只有 retry-exhausted 才上报。
- [x] no credentials、模型不支持、Provider 4xx、provider test、user abort 产生 0 个 Sentry event；旧 info health-summary capture/module/test 已移除。
- [x] `AI_NoOutputGeneratedError` 先有界解包真实根因；底层 403 不再表现为 `NATIVE_STREAM_ERROR / unknown / needs_classification`，raw body/chunk 不进入 normalizer/capture。
- [x] rich upstream error 使用非枚举 marker 阻断 Node auto-capture，防重复及正文泄漏；这一安全边界在后续分类修正中不得回退。
- [ ] Electron expected exit 必须以 `isQuitting / restart reason / child role / exit code / signal` 证据分类；禁止按标题 blanket ignore 所有 Utility/GPU crash。
- [x] 实现三层共享 sanitizer，覆盖 message、exception、request、breadcrumbs、contexts、extras、tags，并有假 secret/path/URL/ID/body fixture。
- [x] 三层显式 `sendDefaultPii: false`；console/ui.input breadcrumb 删除，网络 breadcrumb 只留 method/path/status。
- [x] stack filename 与 `debug_meta.images[].code_file/debug_file` 同步匿名化；保留行列号/debug ID 的 fixture 已锁定。真实 Sentry symbolication 仍属 Phase 3 smoke。
- [x] fingerprint table tests 覆盖稳定枚举、provider.class、非法动态 token；有 stack 的 product fault 不设置 custom fingerprint。

### Phase 2 完成门禁

- 规定的 `user_action_required / provider_test_result / user_cancelled` fixture 产生 0 个 Error envelope 且 0 个 info/message Issue；
- product/protocol fault 产生且只产生 1 个脱敏 envelope；
- payload snapshot 中不存在 fake secret、prompt、response、tool args/result、用户名、本地目录、raw URL、动态 ID；
- 同根 fixture 的 fingerprint 稳定，异根 fixture 不误合并；
- UI/API 原有错误反馈语义不降级。

## Phase 3 — Source map 发布闭环

### 用户会看到什么变化

无直接 UI 变化。后续 renderer、Next server、Electron main 的线上崩溃可以定位到实际 `.ts/.tsx` 文件和行号，缩短修复时间。

### 用户如何验收

用户只需看到 Smoke Ledger 中三个 synthetic event 的源码文件 + 行号证据，不需要进入 Sentry 手动核对构建细节。

### 本阶段明确不做

不把 `.map` 文件打进公开安装包；不把上传 token 注入客户端；不以 dev/watch bundle 代替 production/packaged 验证。

### 执行清单

- [x] 已选择 Turbopack output maps 并产出三层真实 map；时长实测超 20% 红线，用户已接受 stable tag 绝对增加约 13.4 秒。
- [x] stable CI wiring 在 `next build + electron esbuild` 后、electron-builder 前，对最终 packaged JS 执行 debug-id inject。
- [x] upload 脚本使用 `codepilot@<version>` 且 strict/wait；不使用 `dist`（macOS universal bundle 与运行时 arch 不一一对应，debug ID 负责匹配）；CI run #310 已对新 project 完成 macOS/Windows 两次真实上传。
- [x] upload token 只存在于 upload step；脚本不输出 token/map 内容，构建门禁检查 release/root/map。
- [x] 上传成功是 stable build gate；上传脚本最多执行 3 次（2s 有界退避），最终仍失败则非零退出并阻断 package；行为测试覆盖“第三次恢复”与“三次均失败”。
- [x] 所有 electron-builder FileSet 排除 `.map`；macOS unpacked `.app` 与 app.asar 实测均为 0 map。
- [x] 分别触发 renderer、Next server、Electron main synthetic fault；CI #311 三个代表 event 已记录到 Smoke Ledger，均为 release `0.63.0` / `production`，并精确符号化到 `smoke.ts:21/23/25`。
- [x] CI wiring 已保证 Next renderer/server map 生成、inject 在 package 前、upload token 非 public env；CI run #310 的 macOS/Windows 两个最终包均通过 `Resources` + `app.asar` 0 map 扫描，CI #311 已完成三层线上 symbolication。

### Phase 3 完成门禁

- 三层 synthetic event 均映射到源码行；
- Sentry `sourcemaps explain` 或 API 证据表明 debug metadata 匹配；
- packaged artifact 不含 source map；
- 同一 release 的 source map 必须在真实错误发生前完成上传；
- build / packaged server / Electron ABI 既有门禁不回退。

## Phase 4 — 关键覆盖补洞与端到端遥测合同

### 用户会看到什么变化

定时任务、memory extraction、onboarding/check-in、媒体计划、quick actions 等后台能力发生真实内部故障时，不会只留下难追踪的 console；若已有 fallback，用户仍得到诚实降级结果。

### 用户如何验收

- 每类后台场景各用一个 product fault 和一个 expected provider failure fixture；
- product fault 产生单个稳定事件，expected failure 只留下本地诊断 / 用户提示；
- fallback 不能冒充成功，原有任务状态与 UI 语义不变。

### 本阶段明确不做

不把每个 `console.warn/error` 自动接入 Sentry；不捕获 prompt、生成内容或 tool payload；不因为方便观测而改变任务 retry / fallback 行为。

### 执行清单

- [x] inventory 确认 task scheduler、memory extractor、onboarding、check-in、media plan、quick actions、title / skill search 等统一经过 `text-generator.ts` 且已有 `callScene`。
- [x] rich provider error 继续供原调用方 fallback/UI；遥测在 shared boundary 只 capture 一次，auto-capture 由 marker 阻断。
- [x] 共享边界事件只携带 `callScene`、protocol/provider class/status class/retry 状态，不携带 prompt/result/body。
- [ ] Native agent loop 补齐 timeout / empty / tool lifecycle 的 normalized reason code；保持现有 timeout reportable 与 tool-error 修复。
- [x] `connection_test` 在 provider shared boundary 明确映射 `provider_test_result` 并不生成 Error Issue。
- [ ] Widget / React boundaries 做覆盖盘点；只有会造成用户路径中断的 boundary 才进 product fault。
- [ ] 新增 mock transport E2E：一条 renderer crash、一条 server product fault、一条 Electron lifecycle fault、一条后台 fallback、一条 user cancellation。
- [ ] 新增 anti-double-capture assertion：同一 trace marker 最多一个 Error event。

### Phase 4 完成门禁

- inventory 每个入口都有“capture / local-only / expected”明确结论和测试或代码坐标；
- product fault 不再只靠 console；
- expected/fallback 场景不增加 Error volume；
- 全量测试、production build、targeted packaged smoke 通过。

## Phase 5 — Sentry SDK 独立升级

### 用户会看到什么变化

无直接 UI 变化。CodePilot 使用与当前 Electron / Next 生态匹配的 Sentry 主版本，同时保持启动速度、dev 内存、opt-out、native crash 与打包能力。

### 用户如何验收

不需要用户逐项测试 SDK。验收以三层 synthetic event、正常启动/退出、opt-out 和 packaged build 为准。

### 本阶段明确不做

不同时升级 Electron、Next、AI SDK 或其他依赖；不启用 tracing、replay、profiling 或 local variables。

### 执行清单

- [x] 同步升级 `@sentry/browser`/`@sentry/node` 10.69.0、`@sentry/electron` 7.16.0，并加入 `@sentry/cli` 3.6.2；依赖升级已独立提交为 `b83df4ee`，可与合同实现 `13782d77` 分别审查/回滚。
- [ ] 对照官方 migration guide 审核 integrations、init、event processor、Electron renderer/main API 与 native crash 行为。
- [x] dev guard 保持：只有 production/stable 路径动态 import `@sentry/node`，源码行为测试通过；dev RSS 仍待单独记录。
- [x] Electron 40 macOS arm64/x64 与 Windows package 在 GitHub Actions run #310 通过；CI #312 的 macOS arm64 test-only package 已用 helper 产生并上传真实 minidump。
- [x] 跑 Phase 1–4 所有合同测试和三层 packaged synthetic smoke；本地全量 4985/4985，CI #311 三层事件均送达并符号化。
- [x] 在隔离的 packaged 测试构建中使用 test-only fixture 触发真实 native crash；CI #312 崩溃后 recovery launch 上传 completed dump，Sentry event `778040c8b19a40ee983c2b3bfe79cb1c` 解析为 `electron::ElectronBindings::Crash` / `EXC_BAD_ACCESS`，release `0.63.0`、production、Electron 40.2.1 macOS arm64。opt-out 真包反例仍归 Phase 1/6，不把本条扩写为 opt-out 已实测。
- [ ] 若升级导致 dev 内存、startup、native packaging 或 event shape 回归，只回滚 SDK upgrade commit，不回滚已独立落地的分类 / 脱敏 / CI 合同。

### Phase 5 完成门禁

- tests/build/packaged smoke 全通过；
- 三层 event shape 与 source map 不回退；
- native crash 有真实 packaged minidump 证据，或由用户明确接受并记录盲区；
- dev 不上报且内存无不可接受回归；
- SDK upgrade commit 可独立回滚。

## Phase 6 — 发布、72h 观察与下游缺陷移交

### 用户会看到什么变化

没有新增管理 UI。用户正常使用官方 stable 版本，团队能够从干净数据判断真正影响当前版本的故障。

### 用户如何验收

发布后给用户一份短报告：事件总量、预期噪音占比、Top actionable issues、是否存在隐私/分组/source-map 回归，以及下一批真正值得修的问题。

### 本阶段明确不做

不根据旧项目 lifetime count 宣称当前版本回归；不在观察期内批量 resolve 历史 issue；不因样本少伪造“下降百分比”；不以 info event 补 metrics；不在本主线顺手修 `MessageItem`、MissingToolResults 或其他历史体验产品代码。

### 2026-08-04 观察窗口

| Release | 正式发布时间（北京时间） | 24h checkpoint | 72h checkpoint | 用法 |
|---|---|---|---|---|
| `codepilot@0.64.0` | 2026-08-03 00:44 | 2026-08-04 00:44（已到） | 2026-08-06 00:44 | 第一版 official-stable U0 线上基线；只作同 release 统计 |
| `codepilot@0.65.0` | 2026-08-04 12:06 | 2026-08-05 12:06 | 2026-08-07 12:06 | 当前 release；与 0.64.0 分开查询，不因遥测文件无 diff 就合并 crash/error 分母 |

### 有界优先级（P1 已实施；P0/P2/P3 保持只读/待发布观察）

| 优先级 / 时限 | 信号 | 处理边界 | 退出条件 |
|---|---|---|---|
| P0 / 先于任何 Issue 清理 | 查询口径与隐私 | 使用只读 token 固定 `project=codepilot-desktop + environment=production + release=单一当前版本`；复核 unresolved、error samples、unhandled、sessions、crash-free sessions、unsymbolicated ratio；抽查 Top 20 是否含 prompt/body/path/secret。禁止 resolve/delete/mute。 | 查询时间、filter、结果与隐私抽样写入 ledger；无 token 时明确 blocked，不沿用交接数字冒充实测 |
| P1 / ✅ 2026-08-05 code complete + two review rounds closed | 分类合同修正 | 有界 root-cause normalizer：HTTP 4xx/凭据/模型不支持 → `user_action_required`；5xx/DNS/timeout → retry-exhausted `transient_upstream`；NoOutput 与 resolved/rejected stream error 解包 root cause；user-action 产生 0 Error/0 info Issue；product fault 保留 stack grouping。只改遥测分类与测试，不修业务 UI。 | 定向超集 67/67（真实 Native/ToolLoop SSE + 初始 HTTP + Sentry transport 10/10）、全量 5071/5071、production build 通过；仍需新 stable release 真实 smoke，不能拿本地 fixture 代替线上 zero-Issue |
| P2 / 24–72h | 干净信号观察 | 每个 release 分别看 24h/72h；按 outcome/category/provider.class/runtime.layer 看 volume、duplicate、unhandled、unsymbolicated；不拿旧 `javascript-nextjs` lifetime count 比涨跌。若 P1 需要新 release，重新建立该 release 的 72h 窗，不把修复前后拼成同一 cohort。 | Top 20 中 ≥80% 可直接判断行动方向；expected/user-action 在 Issues 中为 0；真正 product fault 可 symbolicate |
| P3 / 72h 后 | 产品缺陷交接 | 只登记 root bucket、影响 release/count、代表 event id、symbolicated file:line 与 owner。`MessageItem.toLocaleString` 等交“历史体验问题”任务；NoOutput 只把 wrapper 分类修正留在本主线，底层真实业务缺陷另交接。 | 每个活跃产品缺陷有独立 owner/任务入口；本计划不吞并 UI/Runtime 业务修复 |

### 执行清单

- [x] v0.64.0 / v0.65.0 已由前序流程发布；v0.66.0 已在用户明确授权的发版任务中由 `d983917f` tag 构建并正式发布。
- [ ] 真实 stable package 跑 opt-in / opt-out、renderer/server/Electron source map smoke，写入 Smoke Ledger。v0.66.0 CI packaged synthetic/native-crash 已通过，但用户设置与后台最终 envelope 仍需独立抽查。
- [ ] 用只读 Sentry token 补跑 v0.64.0 24h 与 v0.65.0 当前快照；只查询新 official project + 单一 release + production，并记录 query time/filters。本地只读 credential 与访问已验证，但完整 cohort 查询尚未执行，交接数字保持 unverified。
- [ ] 检查 development / foreign release 是否为 0；检查 expected/user-action Issue、duplicate ratio、unhandled、unsymbolicated ratio、sanitizer violations。`user_action_required` 目标为 0 Issue，不再观察或保留 info health-summary signal。
- [x] 用户已明确授权 P1；已实现 4xx/DNS/timeout/NoOutput/in-band normalizer、移除 info Issue/health-summary，并补 Native/ToolLoop resolved/rejected terminal exactly-once、初始 HTTP 403/503、阳性 transport 对照与 anti-double-capture fixture。
- [ ] 人工审阅 Top 20 issue，至少 80% 应能从 title/code/tags 直接判断行动方向；无法分类的 issue 回写 classifier fixture。
- [ ] 将仍活跃的真实问题拆到“历史体验问题”任务、`docs/exec-plans/active/issue-tracker.md` 或独立计划，至少包括：NoOutput 底层 product root buckets、SenseNova tool call、MissingToolResults、renderer `toLocaleString`、Electron utility/GPU；本主线只保留分类/脱敏/source map/session health。
  - [x] `MissingToolResults` 已由 [production-observation-remediation-2026-08-07.md](production-observation-remediation-2026-08-07.md) 独立承接：0.65 真实 stack 定位到残缺 persisted tool history，future terminal + legacy replay 两侧 code/tests 已落地；新 stable cohort 待验证。
- [x] 更新 `docs/guardrails/SentryTelemetry.md`、`docs/handover/sentry-error-reporting.md` 与配对 `docs/insights/sentry-error-reporting.md`；保留执行计划/索引互链。
- [ ] 状态表、执行清单、决策日志、Smoke Ledger 四处一致后，才把本计划移入 `completed/`。

### Phase 6 完成门禁

- development 和普通 Fork 对新官方 project 的意外事件为 0；
- known expected / user-action outcome 在线上没有形成 Error 或 info/message Issues；
- synthetic + 真实 Top issues 可 symbolicate；
- Top 20 actionable ratio ≥ 80%；
- 无已知 secret / prompt / response / local-path sanitizer finding；
- 下游产品缺陷全部有独立 owner/入口，本计划不继续吞并业务修复。

## 六、验证矩阵

| 场景 | Browser | Next server | Electron main | 预期 |
|---|---:|---:|---:|---|
| development + DSN absent | ✅ | ✅ | ✅ | 0 init / 0 envelope |
| development + 环境误设 DSN | ✅ | ✅ | ✅ | 仍为 0 envelope，dev gate fail-closed |
| stable opt-in | ✅ | ✅ | ✅ | 正确 release/channel/layer，单次 capture |
| stable opt-out | ✅ | ✅ | ✅ | 0 envelope |
| preview 默认 | ✅ | ✅ | ✅ | 0 envelope |
| Error object | ✅ | ✅ | ✅ | 类型、稳定 code、symbolicated stack |
| non-Error object | ✅ | ✅ | ✅ | 不出现 `[object Object]`，只保留 allow-list |
| 用户取消 | ✅ | ✅ | ✅ | 0 Error envelope |
| no credentials / model unsupported / HTTP 4xx | — | ✅ | — | UI 诚实提示，0 Error envelope、0 info/message Issue |
| HTTP 4xx + 无责任证据 | — | ✅ | — | 本轮统一 `user_action_required`；不靠 message 推断 canonical payload product fault |
| retry exhausted 5xx/DNS/network/timeout | — | ✅ | — | 1 个 normalized transient event；明确 retry-exhausted |
| NoOutput wrapper + 底层 403 | — | ✅ | — | 解包为 `user_action_required`，不保留 `NATIVE_STREAM_ERROR/unknown` Issue |
| NoOutput wrapper + 底层 503/DNS/timeout | — | ✅ | — | 解包为 retry-exhausted `transient_upstream`，无 raw response body |
| 真正无输出且无 upstream error | — | ✅ | — | 1 个脱敏 `provider_protocol_fault` |
| provider malformed tool chunk | — | ✅ | — | 1 个脱敏 protocol fault，无 raw chunk |
| expected app quit/restart | — | — | ✅ | 0 Error envelope |
| unexpected utility exit | — | — | ✅ | 1 个带 lifecycle code 的 event |
| fake secret/path/URL/IDs | ✅ | ✅ | ✅ | payload snapshot 全部已清洗 |
| source map synthetic fault | ✅ | ✅ | ✅ | 精确源码文件 + 行号 |
| packaged native crash | — | — | ✅ | 真实 minidump，或明确登记未验证盲区 |
| U0 app process session | 0 session | 0 session | 1 session/run | 可查 crash-free / release adoption，不出现 user/did |
| 错误上报开、U1a/U1b 关 | ✅ | ✅ | ✅ | 错误事件正常脱敏发送，但全部无 user/did |
| U1a 开、main session + error | ✅ | ✅ | ✅ | 仅 main session + 三层脱敏错误事件含按月匿名 did；自启/驻留与多日偏差按文案披露 |
| U1b 开、尚无有意义操作 | ✅ | ✅ | ✅ | main session 与三层错误事件均无 did，0 activity signal |
| U1b 当日首次有意义操作 | ✅ | — | ✅ | opt-in 时 1 个有界非 Issue signal；main session 不补 did，随后错误事件才可含 did，同日后续操作不重复 |
| U1a/U1b opt-out | ✅ | ✅ | ✅ | 0 did / 0 activity envelope，U0 错误与 crash-free 开关保持独立 |

### 分层验证命令

- Targeted：telemetry classifier / sanitizer / fingerprint / init / build-wiring / Electron lifecycle tests。
- Tier 1：mock transport 行为测试，Provider test 与错误 UI 语义测试。
- Tier 2：`npm run test`、`npm run build`、macOS packaged smoke、Windows CI package gate、Linux x64/arm64 原生 CI package gate、Sentry API event/source-map 验证。
- Release observation：24h / 72h 只读 Sentry 查询，必须固定 `environment=production + release=current official`。

## Smoke Ledger（真实 Sentry / packaged / E2E 验证记录）

> 不记录 API key、auth token、prompt、用户路径或完整 event payload。Evidence 只写 event id、release、layer、symbolicated file:line 或 CI run。

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|---|---|---|---|---|---|---|---|
| 2026-08-02 | host_application | N/A | N/A | Sentry CI secret | macOS packaged renderer synthetic fault | ✅ | CI [#311](https://github.com/op7418/CodePilot/actions/runs/30752743946)；event `dc96beb83997469db14659a0074adb90`；`runtime.layer=renderer`；`src/lib/telemetry/smoke.ts:21:18`；release `0.63.0`，environment `production` |
| 2026-08-02 | host_application | test fixture | fixture | Sentry CI secret | packaged Next server synthetic fault | ✅ | CI #311；event `fa7f0bb8aa854d59bd77e9f57408fba4`；`runtime.layer=next_server`；`src/lib/telemetry/smoke.ts:23:18`；2 events 来自 package-startup gate + smoke 两个独立 server process，非单进程重复 capture |
| 2026-08-02 | host_application | N/A | N/A | Sentry CI secret | packaged Electron main synthetic fault | ✅ | CI #311；event `8043bff038a3440baa1b25c22f73e95c`；`runtime.layer=electron_main`；`src/lib/telemetry/smoke.ts:25:14` → `electron/main.ts:49:45`；Electron 40.2.1 arm64 |
| _待执行_ | host_application | N/A | N/A | opt-out marker | packaged 三层不发送 | ⏳ | mock/envelope count 0 |
| 2026-08-02 | host_application | N/A | N/A | test-only packaged fixture | Electron native crash/minidump 首跑 | ❌ dump 未送达 | CI #311 证明 `process.crash()` 非零退出，但新 project 只有三个 JS Issue；SDK 本体证实 `SentryMinidump` 需下次启动读取 completed dump，已补 recovery launch 并待第二次 CI 验证 |
| 2026-08-02 | host_application | N/A | N/A | test-only packaged fixture + Sentry CI secret | Electron native crash/minidump 恢复上传 | ✅ | CI [#312](https://github.com/op7418/CodePilot/actions/runs/30753373017)；issue `CODEPILOT-DESKTOP-4`；event `778040c8b19a40ee983c2b3bfe79cb1c`；mechanism `minidump`、handled `false`；`electron::ElectronBindings::Crash` (`electron_bindings.cc:119`)；release `0.63.0`、production、Electron 40.2.1、macOS 15.7.7 arm64 |
| _待执行_ | host_application | N/A | N/A | U0 opt-in | packaged main-only session | ⏳ | main 1 session/run；renderer/server 0 session；无 did |
| _条件执行_ | host_application | N/A | N/A | U1a 独立 opt-in | main session + 三层 error did 组合 | ⏳ | 月内 did、绑定时机、启动偏差披露 |
| _条件执行_ | host_application | N/A | N/A | U1b 独立 opt-in | 首次有意义操作前后 | ⏳ | 操作前 0 did；操作后 1 signal + subsequent error did |
| 2026-08-02 | host_application | N/A | N/A | fake DSN / no upload token | official-style production source-map build | ⚠️ 部分通过 | renderer + packaged server + Electron 共 1846 个非占位 map；inject dry-run exit 0；compile 9.2s → 22.6s，超过 20% 红线 |
| 2026-08-02 | host_application | N/A | N/A | fake DSN / no network upload | macOS arm64 unpacked package | ✅ | electron-builder exit 0；`.app` filesystem 0 map；`app.asar` 0 map；本行仅证明本地产物卫生，真实 Sentry symbolication/native crash 证据见 CI #311/#312 |
| 2026-08-02 | codepilot_runtime | fixture | fixture | none | telemetry classifier/sanitizer/provider/build targeted suite | ✅ | 29 tests / 29 pass；含真实 Node client + HTTP request 0 session；typecheck pass |
| 2026-08-02 | all local runtimes | fixture | fixture | none | repository full regression | ✅ | `npm run test`：4981 tests / 4981 pass；production build 8.4s；docs-drift 与 `git diff --check` 通过 |
| 2026-08-02 | host_application | N/A | N/A | GitHub Secrets + `org:ci` upload token | macOS/Windows official-style source-map upload | ✅ | GitHub Actions [Build & Package #310](https://github.com/op7418/CodePilot/actions/runs/30751815526)；Sentry 两个 upload 关联 release `0.63.0`，分别含 4344 / 4346 files（upload `0ea14955-ee42-56a2-b047-38caa14409cc` / `f1ab06ce-3400-5cc8-97bc-42bff0ccf2b9`） |
| 2026-08-02 | host_application | N/A | N/A | CI package，无 upload token 进入 package step | macOS arm64+x64 / Windows final package gates | ✅ | run #310；macOS 8m05s、Windows 7m14s；两端 package 0 map、native ABI 与 packaged server startup 全通过 |
| 2026-08-02 | all telemetry layers | static fixture | fixture | none | manual-CI-only smoke guardrail 本地回归 | ✅ | targeted 15/15；`npm run test` 4987/4987；普通无 Sentry 生产构建通过，compile 8.6s；ESLint、docs-drift、YAML parse、`git diff --check` 通过；新增 source-map upload 第三次恢复/三次失败门禁 |
| 2026-08-03 | host_application | N/A | N/A | GitHub Secrets + 原生 Ubuntu 22.04 runners | Linux x64/arm64 source-map upload + AppImage/deb/rpm package gates | ✅ | GitHub Actions [Build & Package #313](https://github.com/op7418/CodePilot/actions/runs/30756193409)，commit `d29e102b`；arm64 8m11s、x64 8m50s；六个 v0.64.0 包均通过架构、better-sqlite3 Electron ABI 143、packaged server、0 map；glibc 2.35 |
| 2026-08-04 | all telemetry layers | code audit | N/A | read-only repo + GitHub Release metadata | origin/main 发布状态与 Phase 6 分类合同校准 | ⚠️ 计划已校准，代码未修 | `HEAD/origin/main/v0.65.0=979fda51`；v0.64.0/v0.65.0 均为正式 Release；telemetry targeted 22/22；docs drift/diff check 通过；full `npm run test` 在 typecheck 前置因共享依赖缺 `thinking-orbs` 未启动单测；发现 4xx/DNS/NoOutput/info Issue P1 偏差；当前无 `SENTRY_AUTH_TOKEN`，37/406/334/98.5% 保持 unverified |
| 2026-08-04 | codepilot_runtime / Claude classifier / shared provider | fixture | fixture | none | Phase 6 P1 root-cause/classification/privacy/duplicate local closeout | ✅ local gates pass | bounded cause graph 4 层/16 节点；4xx 含 429 zero-event；5xx/DNS/timeout retry gate；NoOutput 403/503/DNS/timeout/true-empty；循环/超深/non-Error/body/chunk/secret/path；marker + safe stack；targeted 46/46；`npm run test` 5053/5053；最终 `npm run build` compile 8.9s、exit 0（保留既有 NFT trace warning）；锁文件无漂移；当时尚无 token，后续 credential 校验见下方独立 Ledger 行；新 stable smoke 仍待执行 |
| 2026-08-04 | Native loop / ToolLoop POC | Anthropic SSE fixture | claude-sonnet-4-6 fixture | fake provider key + local Sentry transport | Claude P1/P2 review closeout：resolved in-band 4xx/5xx、empty/partial content、terminal/catch duplicate | ✅ local gates pass | 真实 `ai@7` lifecycle 证明 `response`/`finishReason` 可在 error part 后 resolve；两条真实 loop 的 overloaded empty/partial 均 exactly 1 transient event，permission empty 为 0 event（6/6）；bounded provider `type` 映射、V8 frame-only safe stack、product-fault text 反例已锁定；定向超集 63/63、`npm run test` 5067/5067、`npm run build` exit 0；未连接 provider/Sentry 网络 |
| 2026-08-04 | Sentry API access | N/A | N/A | local gitignored mode-600 read-only credential | official project 只读访问校验 | ✅ credential available | token scope 仅 event/org/project read；一次只读请求成功。该行只解除“无凭据” blocker，不代表 v0.64.0/v0.65.0 单 release cohort、Top 20 隐私抽查或新 stable smoke 已完成；无外部写操作 |
| 2026-08-07 | Electron packaged CI | official stable | `codepilot@0.66.0` | official release secrets | macOS/Windows/Linux packages + source maps + packaged version/native ABI/server startup；macOS Sentry synthetic/native crash | ✅ CI gates pass | run `31155340623` 全部 success；公开 Release 非 draft/prerelease；真实 no-IP/Release Health 与 24h/72h cohort 待观察 |
| 2026-08-05 | Native loop / ToolLoop POC | Anthropic initial HTTP + SSE fixture | claude-sonnet-4-6 fixture | fake provider key + local Sentry transport | 同 tip 复审 P2：fullStream 结束后 result promise reject 的 exactly-once 顺序 | ✅ local gates pass | 修复前行为实证：主 loop 403/503 为 0/1 event，POC 为错误的 1/2；修复后两条 loop 均为 0/1。初始 HTTP 与 resolved in-band/partial 共 10/10，定向超集 67/67；`npm run test` 5071/5071；`npm run build` compile 8.6s、136 pages、exit 0（保留既有 NFT warning）；无 provider/Sentry 网络与外部写操作 |

## 八、风险与回滚

| 风险 | 预防 | 回滚 |
|---|---|---|
| 过滤过度，真实错误消失 | `unknown` 受控上报；fixture 正反例；72h 对照本地诊断 | 回滚单条 classifier mapping，不恢复 raw capture |
| 过滤不足，噪音仍高 | outcome/fingerprint telemetry contract + Top 20 人工审阅 | 增加稳定 mapping，不按动态文案临时 ignore |
| 脱敏破坏 symbolication | fake home path + source-map 双门禁 | 回滚 path transform，保留其他敏感字段清洗，继续阻断发布 |
| source map 泄露源码 | upload 后删除 map；包结构检查 | 阻断 release，删除错误 artifact；不删除已发布 tag |
| 当前安装包继续携带 Electron map | Phase 0 先独立排除 `dist-electron/**/*.map`，不等待上传链路完成 | 阻断下一次 release；不得以 map 尚未公开托管为理由放行 |
| CI Secret 泄漏 | auth token 仅 upload step；日志 masking；不进 public env | revoke/rotate token，审计 CI log；DSN 单独处理 |
| SDK 升级导致 dev 内存回归 | 独立 commit + RSS/startup 对照 | 只回滚 Phase 5 |
| Electron early crash 丢失 | Electron adapter 仍在 imports 前初始化 | 回滚抽象位置，不回退统一 policy |
| 新项目样本不足 | 保留旧项目只读；使用 synthetic events 验证管道 | 延长观察期，不伪造趋势 |
| Fork 仍恶意发送 | 新项目 + CI 注入只解决意外继承 | Sentry inbound filter / DSN rotation；明确非完全安全边界 |
| 使用统计口径冒充真实用户 | U1a 明示启动偏差；U1b 未通过 action-based POC 不可选；所有数字称“匿名安装” | 回退 U0，隐藏不可信看板，不补造历史数据 |

## 九、Claude Code review 清单

Claude Code review 时需要重点回答，不能只核对文档格式：

1. **事实**：当前三层 init、dev gate、opt-out、fingerprint、extras、build workflow 与 source-map 判断是否逐条属实？
2. **架构**：Next 16 production renderer/server 是否真实生成可用 map？post-build `sentry-cli inject/upload` 是否真能覆盖 Next 16 Turbopack + Electron esbuild 的最终 packaged bundle？是否需要 `@sentry/nextjs`，若需要必须说明运行时和 dev 内存代价。
3. **Electron**：统一 facade 是否会推迟 main-process init，导致 early/native crash 丢失？
4. **隐私**：stack path 清洗与 debug ID symbolication 是否能同时成立？allow-list 是否遗漏 breadcrumbs、server_name、request body、raw provider chunk？
5. **语义**：HTTP 4xx / no credentials / model unsupported 是否统一为 `user_action_required` 且 0 Issue；5xx/DNS/timeout 是否只有在 retry exhausted 后成为 transient；NoOutput 是否先解包根因；这套保守政策是否有清晰的未来 canonical-payload product-fault 升级门槛？
6. **分组**：normalized fingerprint 是否会误合并不同 `provider.class` 的协议缺陷；有 stack 的 product fault 是否完整保留 Sentry 默认分组？
7. **测试**：mock transport 是否能真实抓住 auto-capture + manual capture 的重复事件？build-wiring test 是否检查最终包而不只是源码形状？
8. **发布**：新 Sentry project、CI Secrets、source-map token 最小权限与 stable fail-closed 是否可在现有 GitHub workflow 中执行？
9. **计划边界**：是否仍把多个无关产品 bug 偷塞进本计划；下游缺陷是否有清晰移交门槛？
10. **升级**：SDK v10/v7 是否保持独立可回滚，没有顺手升级 Electron/Next 或开启额外采集？
11. **使用统计**：U0/U1a/U1b/U2 边界是否可执行？U0 是否只保留 main session；U1a 是否诚实披露自启/多日偏差；U1b 是否已经证明非 Issue 数据集、did 绑定时机与跨日折算，而不是把托盘驻留误算活跃或靠 info Issue 灌量？

以下任一情况视为 review blocker：

- DSN 仍硬编码在公开源码；
- development 或普通 preview 默认发送到官方 production project；
- `SENTRY_AUTH_TOKEN` 进入 public env / JS bundle / packaged artifact；
- `scope.setExtras(extra)` 或等价的任意对象全量上报仍存在；
- raw message / response body / dynamic ID 继续参与 fingerprint；
- source map 只生成不上传，或上传的不是最终 packaged bundle；
- Next production renderer/server 没有 map，却宣称三层 source-map gate 可执行；
- DMG/ZIP/EXE 仍包含 `.map` 或任意含 `sourcesContent` 的调试产物；
- custom fingerprint 覆盖有 stack 的 `product_fault`，导致不同 renderer/server 崩溃被合并；
- `provider_protocol_fault` 的 custom fingerprint 缺少 `provider.class`；
- `user_action_required` 仍通过 Error、info、message 或 health-summary event 形成任何 Sentry Issue；
- `AI_NoOutputGeneratedError` 未解包真实 status/code/cause 就以 `NATIVE_STREAM_ERROR / unknown` 上报；
- DNS/5xx/timeout 在 retry exhausted 后仍进入 `unknown`，或未耗尽 retry 就被当成 transient Issue；
- `classifyError` 的 `not found` 等 substring first-match 陷阱没有反例 fixture；
- 未显式设置 `sendDefaultPii: false`，或 console breadcrumb 可绕过 sanitizer；
- Electron policy 使用 async/dynamic import 推迟 early init，或覆盖 default integrations 导致 native/minidump 能力丢失；
- 为降噪 blanket ignore 全部 NoOutput、Utility exit、GPU crash 或 unknown error；
- U0 中 main + renderer/server 多层同时发送 session，造成启动量与 crash-free 分母重复；
- 在 U0 下发送任何 user/install id，或在 U1a/U1b 下使用永久用户/安装/硬件指纹换取 user count；
- 把“匿名错误上报与崩溃率统计”开关解释为 U1a/U1b 使用统计授权，或把 U1a 启动量宣传成行为活跃；
- U1b 未证明非 Issue 数据集与 action-based did 语义就承诺 DAU/MAU，或用 `captureMessage` / info Issue 冒充 activity signal；
- SDK 升级与遥测合同重构混在不可独立回滚的提交中；
- 只验证 Sentry Dashboard 有事件，没有反例验证 opt-out、expected error、隐私与重复捕获。

## 十、外部参考

- [Sentry Electron SDK / npm](https://www.npmjs.com/package/%40sentry/electron) — 当前版本、Electron 支持范围与 main/renderer 初始化入口。
- [Sentry JavaScript source-map troubleshooting](https://docs.sentry.io/platforms/javascript/guides/hono/sourcemaps/troubleshooting_js) — debug ID、artifact 匹配、上传时序与验证要求。
- [Sentry esbuild source-map upload](https://docs.sentry.io/platforms/javascript/guides/tanstackstart-react/sourcemaps/uploading/esbuild) — CI auth token、production build、上传后删除 map 的官方建议。
- [Sentry Release Health session statistics](https://docs.sentry.io/api/releases/retrieve-release-health-session-statistics/) — `sum(session)`、`count_unique(user)`、crash-free session/user 与可用分组维度。
- [Sentry Project Users API](https://docs.sentry.io/api/projects/list-a-projects-users/) — Sentry 的 user 统计来自事件所附用户标识，不会凭空推导真实用户。

## 十一、决策日志

- 2026-08-02：只读 Sentry API 复核确认采集链路工作，但最近 14 天混入 development、旧 release 与多种衍生产品；项目总量不能代表当前 CodePilot stable 质量。
- 2026-08-02：决定把“遥测可信度”与“所有线上产品 bug”分开。本计划关闭条件是数据可信和下游移交，不以修完所有 Sentry issue 为目标。
- 2026-08-02：SDK 落后一代记为独立 Phase，不认定为报错增长主因；先修身份、分类、脱敏、fingerprint 和 source map。
- 2026-08-02：推荐新建 official stable Sentry project，并通过 stable CI 注入 DSN；旧项目只读保留。该外部动作等待用户拍板。
- 2026-08-02：用户询问能否用 Sentry 观察用户量与活跃度。复核确认当前 Top issues 的 `userCount=0`，代码也未显式设置 user/session；现状不能回答该问题。第二轮 review 指出原 U1 把 launch session 与 action signal 混为一种不可兑现能力，因此拆成 U1a（诚实报告偏差的匿名启动安装趋势）与 U1b（只有非 Issue action-based POC 成功后才可选）；完整留存/漏斗归 U2 独立计划。
- 2026-08-02：确认当前 Electron main 与 renderer 的 SDK 默认 session integration 均开启。U0 定性为对既有 crash-free 采集的治理：只保留 main session，并把开关文案明确为“匿名错误上报与崩溃率统计”；U1a/U1b 必须使用独立 consent。U1a/U1b 开启时匿名 did 会附在对应 session 及同意期间的脱敏错误事件上，关闭时两者均不得携带 did。
- 2026-08-02：Claude Code 第二轮 review 为 `Review failed`（0 P0 / 1 P1 / 3 P2 / 3 P3），阻塞只在新增使用统计合同。已据此拆分 U1a/U1b，补齐 main-only session、U0 consent 文案、user/did 组合矩阵、跨进程 24h 去重和条件 POC gate；Source Map、Electron early init、隐私脱敏与错误分类部分不再改动。
- 2026-08-02：source map 推荐从 post-build CLI POC 起步，避免在未证明必要前引入 `@sentry/nextjs` 和新的 dev/runtime graph。
- 2026-08-02：Claude Code 首轮 review 为 `Review failed`（0 P0 / 2 P1 / 6 P2 / 3 P3）。方向无异议；P1/P2 已回写：Next production map 生成与资源基线、product fault 默认 stack grouping、provider.class 分组、substring 反例、400/422 与 user-action aggregate、当前 packaged map 暴露、console/default PII、Electron 同步 early init/debug-meta 约束、真实 native crash smoke。
- 2026-08-02：修正历史归属：`tool-error` 处理在 v0.58.0 已落地，不是 v0.63 新修复。
- 2026-08-02：用户明确授权后，从 `origin/main@91a99606` 创建独立 `codex/sentry-telemetry-plan` worktree；本文与索引草案已迁入，Harness Home worktree 恢复无本任务改动。首次自动审批超时只作过程记录，不再构成 blocker。
- 2026-08-02：用户明确“实现一下”，本轮采用默认 U0 落地；没有启用 U1a/U1b、没有 user/did/行为活跃采集。产品代码、测试、CI wiring、guardrail/handover/insight 已修改；没有 Sentry 外部写、push/release。
- 2026-08-02：Source Map POC 纠正了两个错误假设：`productionBrowserSourceMaps + debugIds` 在 Next 16/Turbopack 下只得到空占位 map；`turbopackSourceMaps` 才产生真实 renderer/server map，而 standalone tracer 会漏 server map，需按最终 JS 图复制。最终验证上传前 1846 个非占位 map、macOS package 0 map。
- 2026-08-02：真实 output maps 让 compile 从 9.2s 增至 22.6s（+146%，绝对 +13.4s），超过本文 20% 门槛。实现保留为 official stable 条件开关，但 Phase 3 不标完成，等待用户/reviewer接受资源取舍或要求改方案。
- 2026-08-02：本地实现收口复跑通过：telemetry targeted 24/24、全量 `npm run test` 4979/4979、普通无 Sentry 环境的 production/Electron build 通过、docs-drift 与 diff whitespace gate 通过。真实 project/upload/symbolication/native crash 与 source-map 资源门禁仍保持未完成状态。
- 2026-08-02：Claude Code 实现审查发现 3 P1/4 P2：Node `Http` request-session、stack `abs_path`、known/unknown grouping 三项为真实上线阻塞；CI Secret scope、environment、400/422 死参数与 Phase 状态为合同缺口。修复轮改为真实 Node client/request 证据、五路径同步清洗、known expected 映射与 unknown 默认 stack，并将 environment 固定为 `production`、channel 固定为 `stable`；400/422 无证据时诚实保持 `unknown`。
- 2026-08-02：审查修复轮验证通过：telemetry targeted 29/29、全量 4981/4981、production build compile 8.4s、docs-drift 与 diff whitespace gate 通过。SDK 依赖升级 `b83df4ee` 与遥测合同 `13782d77` 已独立提交，避免互相绑定回滚。
- 2026-08-02：补齐非阻塞 P3 的最终包证据：`verify-packaged-server.mjs` 在 macOS/Windows 打包后真实遍历 Resources 并读取 `app.asar` 目录，任一 `.map` 立即 fail closed；行为测试同时覆盖干净包、asar 内泄漏和 loose resource 泄漏。
- 2026-08-02：用户在 Claude Code 复核通过后明确接受 source map 令 stable tag 构建绝对增加约 13 秒（实测 +13.4s）的代价。资源门禁据此关闭；真实 Sentry project/Secrets、三层上传符号化与 native crash smoke 仍是 Release ready 前置条件。
- 2026-08-02：用户授权继续后创建新 official stable project `codepilot-desktop`，旧 `javascript-nextjs` 保持不动；GitHub Secrets 使用只含 `org:ci` 的上传 token。手动 CI run #310 已证明 macOS/Windows 真实上传和最终 package gate；因尚无可安全触发的三层故障，symbolication/native minidump 仍保持未完成。
- 2026-08-02：为关闭三层 symbolication 和 native minidump 门禁，新增手动 macOS CI-only 隔离夹具。只有 `workflow_dispatch + telemetry_smoke=true` 才在编译期打开三层静态故障；native crash 还需运行时 `CODEPILOT_NATIVE_CRASH_SMOKE=1`；tag/本地/Windows 编译关闭，smoke package 不上传为 artifact。
- 2026-08-02：CI #311 首次真实 packaged smoke 完整通过三层 JS 符号化，但 native Issue 为 0。根因不是 Sentry 延迟，而是 SDK v7 `SentryMinidump` 以 `uploadToServer:false` 生成 Crashpad dump，只在下次启动读取上传。已在同一隔离 job 补上无 crash flag 的 recovery launch；未看到真实 native event 前不标 Phase 5 完成。
- 2026-08-02：CI #312 的 crash + recovery launch 链路通过；Sentry 收到 event `778040c8b19a40ee983c2b3bfe79cb1c`，机制明确为未处理 `minidump`，解析到 Electron native frame、release/environment/platform。Phase 5 的 native crash 门禁关闭；首次失败记录保留，避免抹掉真实 SDK 行为。
- 2026-08-03：用户要求在下一版恢复 Linux。复核确认 Linux builder 配置一直存在，v0.55 只是在重写 stable workflow 时移除了 CI job；v0.64.0 采用原生 Ubuntu 22.04 x64/arm64 matrix 恢复 AppImage/deb/rpm，任一架构失败都会阻断 Release。CI #313 六个安装包与 Sentry upload 全通过，兼容基线据真实 runner 固定为 glibc 2.35。
- 2026-08-04：从 clean `origin/main@979fda51` 重新校准。GitHub Release 只读证据确认 v0.64.0 / v0.65.0 已正式发布，Phase 6 改为进行中，并为两个 release 分别固定 72h 窗口。代码审计确认 product-fault stack grouping、main-only 目标和 sanitizer 主体仍在，但本轮目标合同尚未满足：shared Provider 只把 401/403/404 归 user action，429 仍归 transient、400/422/402 等仍归 unknown；DNS 与 NoOutput wrapper 没有统一根因解包；`error-classifier.ts` 仍用 info health-summary 生成 Issue。用户本轮只要求诊断与计划校准，因此未修改产品代码、测试、外部 Sentry 状态、push 或 release；后续 P1 实现必须再次获得明确授权，并同步更新 guardrail/handover/tests。
- 2026-08-04：本轮 shell 无只读 `SENTRY_AUTH_TOKEN`。交接中的约 37 unresolved / 406 error samples / 8 unhandled / 334 sessions / crash-free sessions 98.5% 以及 crash-free users 0% 均未冒充独立实测；待 token 可用后按 `project=codepilot-desktop + environment=production + 单一 release` 重跑。crash-free users 0 与 U0 不绑定 user id 的预期一致，但仍不能代表用户数。
- 2026-08-04：验证证据为 telemetry targeted 22/22、`npm run lint:docs-drift`、`git diff --check` 通过。完整 `npm run test` 尝试使用现有共享依赖时在 typecheck 阶段因依赖树缺少 v0.65.0 新增的 `thinking-orbs` 而停止，单元测试未启动；没有运行 `npm install`，避免修改其他 worktree 的共享依赖。该环境缺口不推翻纯函数/静态代码诊断，也不能被写成 full tests pass。
- 2026-08-04：用户随后明确授权在当前隔离 worktree 实施 Phase 6 P1。新增共享有界 root-cause normalizer（4 层/16 节点/字段 allow-list/字符串上限），全部 4xx 含 429 固定 user action，5xx/DNS/timeout 加 retry-exhausted send gate，NoOutput 先解包 root cause；移除 info health-summary module/capture。Native 与 ToolLoop `onError` 只 marker + 保存结构化错误；unknown/product 用固定 message 的安全 Error 副本保留 stack frame，原始 provider body/cause graph 不进入事件。
- 2026-08-04：依锁文件在本 worktree 运行 `npm install` 恢复缺失 `thinking-orbs`，`package.json`/`package-lock.json` 无漂移；首轮定向 46/46、全量 `npm run test` 5053/5053、`npm run build` 成功（compile 8.9s，保留既有 NFT dynamic-trace warning）。没有 push/merge/tag/release，没有修改外部 Sentry；当时只读 token 尚缺，随后 credential 可用性另行验证；修复后 stable 72h smoke 保持待执行。
- 2026-08-04：Claude findings-first 独立复核（1 P1 / 2 P2 / 4 P3）证明 `ai@7` 的 in-band error part 可在 `response`/`finishReason` 正常 resolve 后绕过 catch：空输出会被合成 `EMPTY_RESPONSE` 覆盖，partial content 则完全漏报。修复采用 shared per-step terminal state，在 Native response / ToolLoop finish-step / catch 间 exactly-once capture，并加 full-stream fallback；低基数 provider `type` enum 恢复 HTTP 语义。P3 同轮收紧为 generic provider 才允许 timeout/DNS 文本嗅探，safe Error 只保留 V8 `at` frame；默认 retry exhausted 与 499 语义维持已记录取舍。
- 2026-08-04：新增真实 AI SDK mock lifecycle 与两条生产 loop + Anthropic SSE + local Sentry transport 行为 fixture，覆盖 empty/partial in-band 4xx/5xx、true empty 与 catch 去重。修复后定向超集 63/63（真实 loop 6/6）、全量 `npm run test` 5067/5067、`npm run build` 通过。随后本 worktree 获得 gitignored、mode 600、仅 event/org/project read 的 credential，并以一次只读请求验证访问；P0 单 release cohort/Top 20/新 stable smoke 仍未执行。没有打印或提交 token，没有外部 Sentry 写、push、merge、tag 或 release。
- 2026-08-05：Claude 在 clean `fed7508d` 同 tip 复审新增 1 个仅限 experimental ToolLoop POC 的 P2：初始 HTTP 失败会先结束 fullStream、再用 fresh 无 cause NoOutput reject result promise，原 full-stream fallback 过早把 provider error 标成 reported，catch 因而二报 protocol fault。先用真实 createAnthropic + 初始 403/503 + local Sentry transport 复现 POC 1/2 event（主 loop 阳性对照 0/1），再把 POC 的 `await result.response` 移到 fallback 之前；修复后两条 loop 均为 0/1。零事件 fixture 必须与阳性 event 共用同文件 carrier 的方法论写入 guardrail。
- 2026-08-05：最终定向超集 67/67、全量 `npm run test` 5071/5071、`npm run build` compile 8.6s / 136 pages / exit 0。没有扩大到生产 UI/Runtime 行为，没有新增身份或内容遥测，没有读取/打印 token，没有外部 Sentry 写、push、merge、tag 或 release；新 stable 24h/72h cohort 仍是线上完成门禁。
- 2026-08-07：用户在独立修复复审达到 Code complete + Tests pass + Review passed 后明确授权发版。`d983917f` / `v0.66.0` 已发布，run `31155340623` 的 verify-source、macOS、Windows、Linux x64/arm64、release job 全部 success；以北京时间 2026-08-07 15:01 为新 cohort 起点。CI 通过不自动等于真实 no-IP/Release Health/opt-out smoke，24h/72h 仍按固定 release + production 口径只读验证。
- 2026-08-07：只读 0.65 复核发现 server event 在删除 user 后仍被补 IP/Geo、release `hasHealthData:false`，并确认 MissingToolResults 为下一轮 prompt conversion 的真实产品缺陷。隐私 tombstone/main eager session 留在遥测边界；MissingToolResults 与 Windows external-open Promise 交由独立生产观察修复计划，保持本计划“不吞所有产品 bug”的范围约束。
