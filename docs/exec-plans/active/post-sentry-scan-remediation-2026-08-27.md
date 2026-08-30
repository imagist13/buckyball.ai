# 2026-08-27 Sentry 生产问题修复闭环

> 创建时间：2026-08-27
> 最后更新：2026-08-29
> 当前状态：🟡 已随 `v0.67.11` Shipped；Code / Tests / Build / Review / package 门禁通过，stable Sentry cohort 停增仍待观察

## 状态

| Phase | 内容 | 状态 | 备注 |
|---|---|---|---|
| Phase 0 | 只读 Sentry 取证与源码根因核对 | ✅ 已完成 | 以 2026-08-23 为增量边界；未修改 Sentry/GitHub 外部状态 |
| Phase 1 | updater Promise 所有权与 utility 生命周期分组 | ✅ 已完成 | Main 显式消费 nested download Promise；Windows teardown zero-event、app-alive 仍 recovery，真实退出按 class 分组 |
| Phase 2 | token usage 运行时校验与 assistant 消息原子持久化 | ✅ 已完成 | 缺字段隐藏且不补 0；insert/update/select 同事务、空读稳定失败并回滚 |
| Phase 3 | media 用户错误分类与本地路径脱敏 | ✅ 已完成 | expected/user-action 保持 tool error；自动 Sentry zero-Issue；普通文本路径整段脱敏 |
| Phase 4 | targeted/full/build、复审与文档回写 | ✅ 已完成 | 首轮 targeted 91/91；复审 targeted 83/83；final full 5406（5405 pass/1 skip）、production build、scoped ESLint、hook/docs-drift/diff pass |

## 用户结果

- 自动更新下载遇到断网/连接重置时不再产生未处理 Promise rejection，仍按现有错误状态与退避策略恢复。
- Windows 注销/关机导致的 utility 生命周期不会再冒充产品崩溃；真实异常仍保留按 generation 一次的低敏诊断。
- 历史或第三方 Runtime 写入不完整 token usage 时，消息仍正常显示，只隐藏没有真实来源的 token 统计。
- assistant checkpoint/终态写入以单次事务返回真实行；若数据库不满足持久化不变量则明确失败，不在下游以 `undefined.id` 二次崩溃。
- 图片配置、计费、安全审核和不存在的媒体路径继续作为工具错误反馈给模型/用户，但不再被自动通道灌入 Sentry；本地路径不再保留用户名后的目录结构。
- 本轮明确不做：不推测或修改数据库最初损坏原因；不全局关闭 GPU；不在缺少组件证据时猜修 React ref 循环；不 resolve 历史 Sentry Issue，不 push/tag/发版。

## Signal → Triage → Fix → Verify → Guardrail

### Signal

- `CODEPILOT-DESKTOP-3V`：`electron-updater@6.8.3` 的 `checkForUpdates()` 返回未被消费的 `downloadPromise`，网络失败落入全局 unhandled rejection。
- `CODEPILOT-DESKTOP-25`：同一 normalized fingerprint 混入普通 `exit 1`、Windows shutdown/logoff 与其他平台退出状态；最近样本不支持统一归因为 OOM。
- `CODEPILOT-DESKTOP-A`：DB `token_usage` 只做 JSON parse 后即以 TypeScript 类型断言使用，缺字段在 `toLocaleString()` 崩溃。
- `CODEPILOT-DESKTOP-3Z`：terminal assistant insert 后二次 SELECT 可能返回空，调用方再读取 `saved.id`。
- `CODEPILOT-DESKTOP-3Y/3X/3T/2J`：media tool 的 expected/user-action 错误被 Vercel AI 自动通道捕获；路径 sanitizer 只隐藏用户名，仍暴露目录后缀。

### Triage

1. updater 必须显式拥有 auto-download Promise，不能只依赖 emitter；同一失败仍只能增加一次 backoff。
2. utility telemetry 必须在上传前识别已知 Windows shutdown lifecycle，并让 fingerprint 至少区分稳定退出类别，但仍禁止 raw stderr/report/path；exit code 只决定 telemetry，不得绕过 app-alive 的 bounded recovery。
3. token usage 是 DB 外部输入，必须用运行时验证证明必需数字存在；缺证据时隐藏统计，不补 0。
4. `addMessage` 的 insert + session timestamp + row read 必须在同一同步 SQLite transaction 内完成并验证返回行；调用方不再依赖不真实的类型断言。
5. media expected failure 在 tool boundary 写 shared handled marker，使 framework auto-capture 丢弃 rich error；marker 必须有界穿透常见 `cause` wrapper，取消只接受明确信号；错误本身继续 reject，保留真实 tool failure 语义。

### Fix

- [x] 消费 `checkForUpdates()` 返回的 auto-download Promise，并补行为/源码合同测试。
- [x] 为 utility exit 建立低基数 exit class 与 expected-shutdown zero-event 判定；更新 Main 接线、sanitizer 和回归测试。
- [x] 新增 token usage parser/validator；MessageItem 仅在输入/输出 token 都是有限非负数时展示。
- [x] 将 `addMessage` 改为事务内 insert/update/select，并对不可能的空读抛稳定产品错误；覆盖真实行返回与失败整体回滚。
- [x] media tool catch 在 rethrow 前标记 provider/user-action 错误已由产品拥有；新增缺配置、4xx、安全/计费与文件不存在的 zero-Issue 对照。
- [x] sanitizer 将 POSIX/Windows 用户目录整体替换为固定 `[local-path]`，不保留后缀；更新 fixture 和 guardrail。
- [x] Claude review P2：handled marker 增加 bounded/cycle-safe `cause` 追踪；真实 Node Sentry transport 验证 wrapped handled error 0 event、wrapped 503 1 event。
- [x] Claude review P3：恢复不再被 teardown exit code 短路；media cancel 改为显式 abort/专用类型；updater 补 emitter-first / Promise-first exactly-once + no-unhandled-rejection 行为测试。
- [x] 复跑 targeted、`npm run test`、`npm run build`、docs/diff 门禁并回写最终证据。

### Verify

- Targeted：updater contract、utility telemetry/recovery、token usage、collect owner/DB isolation、media tool、telemetry sanitizer/provider marker。
- Full：`npm run test`。
- Build：`npm run build`；Electron packaged smoke 仅在本轮改动要求且环境允许时执行，不用源码测试冒充真包。
- 发布后：下一个 stable release 按单 release + production 观察对应 Issue 是否停止新增；当前任务不发版。

### Guardrail

- `Updater.md` 固化 auto-download Promise 所有权。
- `ElectronMain.md` / `SentryTelemetry.md` 固化 expected shutdown 与 utility exit-class grouping。
- `StreamSession.md` 固化 DB token usage 的运行时 shape 与 assistant insert 返回行不变量。
- 同类 media expected-error 自动 capture 与路径后缀泄漏加入 Sentry telemetry 合同与测试。

## Smoke Ledger（真实凭据 / UI / E2E 验证记录）

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|---|---|---|---|---|---|---|---|
| 2026-08-27 | Sentry API | official `codepilot-desktop` | `codepilot@0.67.x` | 本地只读 token | 增量 Issue、去敏栈帧、utility 退出码与内存样本 | ✅ 只读取证完成 | 未修改外部状态；根因与代码位置写入本计划 Signal/Triage |
| 2026-08-27 | local Node/Electron source | local checkout | current | 无真实用户凭据 | updater/utility/token/DB/media/sanitizer targeted | ✅ | `npx tsx --test ...`：91 tests pass；恢复原有 message persistence 覆盖后单文件 12 tests pass |
| 2026-08-27 | local Node/Sentry SDK | local checkout | current | 无真实用户凭据 | Claude review：wrapped media zero-event、503 阳性、updater 双竞态、utility recovery | ✅ | 复审 targeted：83/83；真实 transport 按 envelope item type 统计 error event，handled wrapper 0、503 wrapper 1；updater 两种顺序均一次失败且无 `unhandledRejection` |
| 2026-08-27 | local Node/Electron source | local checkout | current | 无真实用户凭据 | Claude review 后 Tier 2 final full + production build | ✅ | `npm run test`：5406 tests，5405 pass / 1 existing skip / 0 fail；`npm run build` 成功（1 条既有 NFT dynamic-path warning）；本轮全部 TS/TSX scoped ESLint 0 error / 7 个 `MessageItem.tsx` 既有 warning，`lint:hooks`、`lint:docs-drift`、`git diff --check` 通过 |
| 2026-08-29 | official stable | Sentry production | `codepilot@0.67.11` | U0 opt-in | 新 release cohort 是否停止新增对应 Issue | 🟡 Release 已发布；cohort 观察待进行 | [Actions](https://github.com/op7418/CodePilot/actions/runs/33230535883) / [Release](https://github.com/op7418/CodePilot/releases/tag/v0.67.11)；发布成功不等于对应 Issue 已停增，需等待生产事件窗口 |

## 决策日志

- 2026-08-27：用户在只读根因报告后明确授权“修一下”。本轮只修能够由生产证据和当前源码闭环的缺陷；数据库最初损坏、Chromium GPU 与缺少具体组件的 React ref 循环保持诊断状态，不用猜测改动扩大风险。
- 2026-08-27：utility 组被证实是异质集合，不按 Issue count 直接判断同一产品崩溃；修复目标是 expected lifecycle zero-event、稳定 exit class 分组和保留低敏本地诊断，而不是吞掉真实 `exit 1`。
- 2026-08-27：全量前 diff 审核发现新增事务测试一度覆盖同名既有结构化消息测试；在门禁前恢复全部旧用例并追加事务探针，最终该文件 12/12、全量 0 fail。
- 2026-08-27：首次 production build 被 `.next/dev/lock` 安全门禁拒绝；锁内 PID 21511 已不存在且 localhost:3000 无响应，确认 stale 后只移除该精确锁文件，重跑 build 成功。未停止用户进程、未删除其他 `.next` 内容。
- 2026-08-27：全仓 `npm run lint` 意外递归扫描未改动的 `.claude/worktrees/decouple-claude-code/.next` 大型生成 bundle，连续数分钟只有 Babel/旧 `eslint-env` 警告且未进入源码终态，故中止该无效扫描；改为对本轮全部 TS/TSX 文件精确运行 ESLint并通过。全量 typecheck/unit/build 由独立门禁覆盖。
- 2026-08-27：Claude 复审的 P2 成立：原测试只证明同一异常对象上的 marker，不能证明框架用 wrapper/cause 时 `beforeSend` 仍会丢弃。修复选择 bounded own-data `cause` traversal，并补真实 `@sentry/node` transport 阳性/阴性对照。首版测试把被丢弃事件产生的 `client_report` envelope 误计为 error event；随后按 envelope item type 只统计 `event`，既保留 SDK 丢弃报告，也精确验证 zero-Issue 合同。
- 2026-08-27：Claude P3-2/3/4/6 作为防回归一起收口：teardown code 不再独占 recovery 决策；模糊“aborted”文本不再等同用户取消；`retryExhausted:true` 文档化为 media tool 当前终态边界；updater 从源码正则升级为两种竞态的行为测试。P3-5 的路径尾部丢失是 ST-17 已明确接受的隐私优先取舍：普通 message 不保留本地项目/文件名，stack/debug_meta 仍走独立 canonicalization 保留 symbolication 结构。
- 2026-08-27：final full 首次复跑在 typecheck 阶段发现新 transport 测试的 `reduce` accumulator 被推断为 `unknown`；仅为测试类型缺口，显式指定 `number` 后从头重跑 `npm run test`，最终 5406/0 fail。该失败不被从证据中省略，也不把修复前 targeted 通过冒充 final full。
- 2026-08-28：代码与 guardrail 以 commit `424f566f` 提交；pre-commit 再次完成 code tier 门禁：5406 tests，5405 pass / 1 existing skip / 0 fail。Claude review 的 P2 与可执行 P3 均有实现或测试证据闭环；仍保留发布后 official stable cohort 观察，不把本地验证冒充生产停增。
- 2026-08-29：修复随不可变 `v0.67.11` 正式发布；run `33230535883` 全绿，Latest Release 与 20 个公开资产完成独立复核。该证据把“待发布”推进为“stable cohort 可开始观察”，但在新的生产窗口形成前不宣称 Sentry Issue 已停增。
