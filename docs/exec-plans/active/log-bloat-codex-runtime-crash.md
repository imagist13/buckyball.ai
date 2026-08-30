# Log Bloat and Codex Runtime Crash / 日志暴涨与 Codex Runtime 闪退

> 状态：🔄 P0+P1 产品代码已实现并通过单测（主 tsc 0 错误 + 全量 3290 unit）；日志暴涨链路（rotation + serverErrors ring + tracing 降噪 + RUST_LOG warn 默认 + crash breadcrumb）已封；Codex Runtime 闪退 **live smoke 待跑**

## 背景

用户反馈两件事：

1. 另一台电脑的 CodePilot 主日志达到 12.5G。
2. Codex Runtime 下客户端偶发闪退，最近一次疑似发生在突破沙盒权限、需要网络授权或搜索文件时。

本次调查使用用户提供的日志副本：

- `/Users/op7418/Downloads/codepilot-main_副本 4.log`
- 文件大小：`12,498,072,118` bytes，约 12G。
- 文件创建：2026-05-31 15:12:56，本次样本最后修改：2026-06-08 14:28:51。

结论先行：

- **12.5G 不正常。** 仓库代码明确没有 size-based log rotation，且 Codex app-server 默认 `RUST_LOG=info`，会把大量 tracing 行经 server stdout/stderr 写进持久主日志。
- **闪退不能仅凭这份日志直接定案。** 近期片段没有 `panic` / `uncaughtException` / OOM 栈，但出现了 Codex tracing 洪水、Codex app-server `Process exited with code 0`，随后 CodePilot 新 session start。结合主进程无界 `serverErrors.push(msg)`，日志暴涨可同时造成磁盘和内存压力，是高置信候选根因。

## 已确认事实

### 1. 主日志没有大小轮转

代码位置：

- `electron/main.ts:1250-1252` 注释写明：`No size-based rotation`。
- `electron/main.ts:1326` 使用 `fs.createWriteStream(activeLogFile, { flags: 'a' })` 追加写入。
- `electron/main.ts:1355-1357` 覆盖 `console.log/warn/error`，所有主进程日志都持续写入同一个 active file。

这说明 12.5G 不是“预期上限内的大日志”，而是“此前假设 real-world 文件不会过大”被真实使用打穿。

### 2. Codex app-server 默认 INFO tracing，并被转存到主日志

代码路径：

- `src/lib/codex/app-server-manager.ts:419-421`：未显式设置时默认 `RUST_LOG=info`。
- `src/lib/codex/app-server-manager.ts:100-105`：Codex app-server stderr 每行通过 `console.debug('[codex.app-server]', line)` 输出。
- packaged 模式下 server 进程 stdout/stderr 又被 Electron 主进程接住：
  - `electron/main.ts:878-881`：server stdout `console.log('[server] ...')`，同时 `serverErrors.push(msg)`。
  - `electron/main.ts:884-887`：server stderr `console.error('[server:err] ...')`，同时 `serverErrors.push(msg)`。

因此 Codex app-server 的 tracing 不是只在开发终端里可见，而是会进入用户可导出的主日志。

### 3. 最近 50MB 几乎全是同一种 Codex tracing 噪声

对日志尾部 50MB 做聚合：

```text
lines=69995
codex_core_tasks=69253
session_starts=1
interesting_keyword_lines=3
```

也就是约 99% 行都是类似：

```text
[codex.app-server] ... INFO session_loop{thread_id=...}: submission_dispatch{...}: turn{... model=gpt-5.5 ...}: codex_core::tasks: enter
[codex.app-server] ... INFO ... codex_core::tasks: exit
```

这些行在 2026-06-08 06:27:50 到 06:28:00 附近密集出现，十秒内即可写出数万行。

### 4. 这不只是磁盘问题，还是内存问题

`electron/main.ts:881` 和 `electron/main.ts:887` 把每个 server stdout/stderr chunk 追加进 `serverErrors`，当前没有 ring buffer 或字节上限。这个数组原本用于 server startup timeout 的错误上下文，但运行期间也一直接收 server 输出。

当 Codex app-server 在一个 turn 中刷大量 tracing 时，CodePilot 同时：

- 写持久日志到磁盘。
- 在主进程内存里累积 `serverErrors`。
- 通过 Electron utility process pipe 传输这些大块日志。

这条链路可以解释用户看到的“日志巨大”和“客户端闪退/卡死”同时出现。真正 OOM 或 crash 还需要 OS crash report 或 live repro 证实，但这是目前最强候选根因。

### 5. 权限/授权路径确实也会产生高噪声 tracing

日志中能看到与用户描述相近的 Codex approval 路径：

- `approval_policy=OnRequest`
- `sandbox_policy=WorkspaceWrite { ... network_access: false ... }`
- `op.dispatch.exec_approval`
- `ToolCall: exec_command {... "sandbox_permissions":"require_escalated", "justification": "...", "prefix_rule": [...] }`
- `codex.tool_result` 记录完整 tool arguments 和输出摘要。

这说明“需要授权的工具调用”路径会触发 app-server 的 INFO tracing，并可能把命令、路径、模型、sandbox policy 等诊断字段写进主日志。它和日志暴涨链路高度相关，但本次日志还不足以证明“授权 UI 本身”是闪退根因。

### 6. 早期日志还有旧 Codex app-server 启动失败噪声

2026-05-31 开头出现多次：

```text
[codex.app-server] error: unexpected argument '--listen' found
[codex.app-server] exited { code: 2, signal: null }
```

这是旧 binary / 旧启动参数兼容问题造成的重复失败。它会增加早期日志体积，但不是 2026-06-08 最近 50MB 的主要来源。近期主要来源是 INFO tracing 洪水。

## 未证实但需要优先复现

### 闪退具体类型

当前日志尾部能看到：

```text
[codex.app-server] Process exited with code 0
=== session start 2026-06-08T06:28:50.478Z (sanitized) ===
```

这表示 CodePilot 在 Codex app-server 退出后出现了新的 session start。它符合“用户看到应用退出后重新打开”的轨迹，但缺少以下信息，不能直接定为 main process crash：

- macOS `.crash` report。
- Electron `render-process-gone` / `child-process-gone` 事件。
- Node `uncaughtException` / `unhandledRejection` 记录。
- 主进程退出前的 RSS / heap / log file size breadcrumb。

## 修复计划

### P0. 主日志和 serverErrors 先做硬上限

用户可见变化：日志不再无限增长；即使 Codex app-server 刷 tracing，应用也不会因为日志链路自身吃光磁盘或内存。

建议 Claude Code 修改：

1. 给 `codepilot-main.log` 加 size-based rotation。
   - 建议 active file 25MB 或 50MB。
   - 保留 5 个归档文件即可。
   - app 启动时如果 active file 已超过上限，先 rotate 再 append session marker。
2. 把 `serverErrors` 改成有界 ring buffer。
   - 只保留最近 N 行或最近 N KB，例如 200 行 / 256KB。
   - startup timeout 仍能展示最近上下文，不再保留整段运行期 stdout。
3. 对 stdout/stderr `data` chunk 做 line split 或 bounded append，避免单个超大 chunk 直接进入数组。

防回归测试：

- 单测模拟 10,000 条 server stdout，断言 `serverErrors` 不超过上限。
- 单测模拟 active log 超过 cap，断言新 session 写入 rotated fresh file。

### P0. 降低或过滤 Codex app-server tracing

用户可见变化：普通用户日志只保留关键诊断，不保存大量 `enter/exit` span。

建议 Claude Code 修改：

1. 默认不要强制 `RUST_LOG=info`。
   - 推荐默认 `warn`。
   - 如需调试，使用显式开关，例如 `CODEPILOT_CODEX_TRACE=1` 才设置 `RUST_LOG=info`。
2. 在 `src/lib/codex/app-server-manager.ts` 的 stderr tee 处过滤高频 span：
   - 丢弃 `codex_core::tasks: enter/exit`。
   - 丢弃 `codex_core::session::handlers: enter/exit`。
   - 对 `feedback_tags`、`codex.tool_result`、`ToolCall` 做采样或只保留 event type / call id / status。
3. 默认不要把完整 tool arguments 持久化到用户支持日志。
   - 特别是 command、path、justification、remote URL、邮箱/account id。
   - 如需 support bundle，走显式 debug export。

防回归测试：

- 给 Codex tracing filter 喂入 `codex_core::tasks: enter/exit`，断言默认丢弃。
- 给 fatal config stderr 喂入旧 binary 错误，断言仍能保留并触发 fail-fast。
- 给 ordinary warn/error 喂入，断言仍进入日志。

### P1. 增加闪退定位 breadcrumb

用户可见变化：再遇到闪退时，日志能说明是 renderer gone、server child gone、main uncaught，还是用户主动退出。

建议 Claude Code 添加：

1. Electron main:
   - `process.on('uncaughtException')`
   - `process.on('unhandledRejection')`
   - `app.on('child-process-gone')`
   - `webContents.on('render-process-gone')`
2. Codex Runtime session breadcrumb:
   - turn id、thread id、approval request id、tool call id。
   - 不记录完整 command/path，只记录 hash 或简短类型。
3. 退出前/异常时记录：
   - 当前 log file size。
   - `process.memoryUsage()`。
   - serverErrors ring buffer 使用量。

### P1. Codex approval / network escalation live smoke

必须在真实 Codex Runtime 凭据环境跑。建议记录在本计划 Smoke Ledger。

复现步骤：

1. 启动 CodePilot，选择 Codex Runtime。
2. 让 Codex 执行一个需要 `require_escalated` 的命令，例如网络访问或写受限目录，但不要让命令本身危险。
3. 等待授权 UI 出现，点击允许。
4. 观察：
   - 应用是否闪退。
   - `codepilot-main.log` 体积是否在 30 秒内快速增长。
   - Activity Monitor 中 CodePilot 主进程 RSS 是否快速增长。
   - 日志里是否出现 `render-process-gone` / `child-process-gone` / app-server exit。

验收标准：

- 授权流程完成后应用不退出。
- 30 秒内主日志增长小于 1MB，除非显式开启 debug trace。
- 主进程内存不随 tracing 行数线性增长。
- 若 Codex app-server 子进程退出，UI 能给出可恢复状态，不导致整 app 闪退。

## Smoke Ledger

| 日期 | Runtime | 触发场景 | 结果 | 证据 |
|------|---------|----------|------|------|
| 2026-06-08 | Codex Runtime | 用户日志离线分析，tail 50MB 聚合 | ✅ 日志暴涨已证实；闪退未定案 | `69995` 行中 `69253` 行为 `codex_core::tasks`；尾部出现 app-server exit + 新 session start |
| 2026-06-08 | 单元 | P0+P1 实现单测 | ✅ rotation / serverErrors ring / tracing filter / RUST_LOG warn / crash breadcrumb 全部实现 + 16 单测 | `bounded-line-ring` / `main-log-rotation` / `codex-trace-filter` 测试；主 tsc 0 + 全量 3290 |
| _待跑_ | Codex Runtime | live `require_escalated` / network approval | 📋 | 需要真实 app-server + 用户授权；验收见下方标准 |

## 给 Claude Code 的优先级

1. **P0：bounded logging。** 先修 log rotation + `serverErrors` ring buffer，这是用户磁盘和闪退风险的共同根。
2. **P0：Codex tracing default 降噪。** 默认 `RUST_LOG` 不要是 info，且过滤高频 enter/exit span。
3. **P1：闪退 breadcrumb。** 没有 crash report 前，不要把 approval UI 当成唯一根因，先把下次闪退留证。
4. **P1：live smoke。** 用真实 Codex Runtime 跑授权路径，确认是 logging/backpressure/OOM，还是 approval bridge 另有 bug。

## 临时规避建议

在正式修复前，如果用户机器已经出现 12G 日志：

1. 先退出 CodePilot。
2. 保留一份压缩样本或最后 100MB 即可，不需要长期保留完整 12G。
3. 清理 live log 后再启动。
4. 尽量用 `RUST_LOG=warn` 启动 CodePilot 或把该环境变量写入用户 shell 环境，降低 Codex app-server INFO tracing。

注意：临时清理只能缓解磁盘占用，不能修复无界日志和无界内存累积。

## 决策日志

- 2026-06-08：Codex 离线分析用户提供的 12G 主日志，确认近期尾部日志 99% 为 Codex app-server `codex_core::tasks` enter/exit tracing；仓库代码确认主日志没有 size-based rotation，且 server stdout/stderr 同时进入无界 `serverErrors` 数组。将日志暴涨定为真实产品缺陷，闪退定为高相关待 live 复现。
- 2026-06-08：Codex 复审两条 P1 finding，Claude Code 已修。**(1) crash breadcrumb 改变了崩溃语义**：普通 `process.on('uncaughtException')` listener 会覆盖 Node 默认 fatal 退出、`unhandledRejection` listener 会阻止默认升级——可能把闪退变成"主进程活着但状态坏"。改用只读 `uncaughtExceptionMonitor`（不覆盖默认 fatal + Sentry），并**移除** `unhandledRejection` listener（throw 模式下它会升级为 uncaughtException 被 monitor 记到，warn 模式下非崩溃，退出策略保持原样）。**(2) log rotation 不是硬上限**：原用 async `createWriteStream` + `end()` 后立刻 `renameSync`，buffer flush 可能写进归档 / Windows open-file rename 失败被吞导致 active 继续涨。改为同步 fd（`openSync/writeSync/closeSync`，rotate 前先 close 再 rename），主日志降噪后写量可接受；测试改为对真实同步写入器跑真实 fs（不再 fake stream）。验证：主 tsc 0、全量 3290、16 单测仍全绿。
- 2026-06-08：Claude Code 实现 P0+P1 产品代码。抽 3 个纯逻辑模块（不依赖 `electron`，可单测）：`src/lib/logging/bounded-line-ring.ts`（有界 ring，行数 + 字节双上限）、`src/lib/logging/main-log-rotation.ts`（size-based rotation + 滚动写入器，启动时若 active 已超 cap 先 rotate）、`src/lib/codex/codex-trace-filter.ts`（`shouldDropCodexTraceLine` 丢高频 INFO span 但永不丢 warn/error/fatal；`resolveCodexRustLog` 默认 warn）。接线：`electron/main.ts` 用 ring 替换无界 `serverErrors` + 用滚动写入器替换裸 stream（active 50MB / 5 归档）+ 加 crash breadcrumb（uncaughtException / unhandledRejection / child-process-gone / render-process-gone，同步写入 log size + memoryUsage + ring 占用，仅类型化摘要 + sanitizeLogLine）；`app-server-manager.ts` stderr tee 接 filter + RUST_LOG 默认 warn（`CODEPILOT_CODEX_TRACE=1` 才 info）。fatal-config fail-fast 保留不动。验证：主 tsc 0、全量 3290 通过、16 条新单测。**未做**：真实 Codex 凭据下的 approval/network escalation live smoke（本环境无 live app-server），验收标准见「P1. live smoke」。
