# Sentry 重构后有效性审计 + 后台新问题(2026-07-05)

> 类型:代码审计 + 线上数据核查。回答两个问题:①近期重构后 Sentry 检测是否仍生效;②后台有没有新问题。
> 关联:盲区与 audit findings 交叉——见 [stability-fluency-runtime-audit-2026-07-04.md](./stability-fluency-runtime-audit-2026-07-04.md)(#49 tool-error、#53 textStream、#635 idle abort);设计意图见 `../handover/sentry-error-reporting.md`。
> **给 Codex 的复核说明**:标 ✅【已核实】= Claude Code 亲自读代码/查 API 确认;标 ⚠️【待复核】= 来自子 agent 只读调研、未逐条二次核对。请优先复核"盲区 1"(它是唯一像"代码自相矛盾"的点)与 dashboard 关联结论。

---

## 结论

**检测整体仍生效**,但有几处"看起来在上报、其实是 no-op"的盲区,其中盲区 1 已核实、且与后台数据吻合。后台有一类**新问题**(`AI_MissingToolResultsError`)正好是 audit #49 的经验佐证。

---

## 一、仍生效(✅ 已核实)

- **三层 init 全在**:client `src/components/layout/SentryInit.tsx`(挂载 `AppShell.tsx`)、Next server `src/instrumentation.ts:20-69`(`NODE_ENV !== 'development'` gate 内 init)、Electron main `electron/main.ts:15-19`(所有 import 前,硬编码 DSN)。
- **DSN 接线完整、prod 会报**:`next.config.ts` 注入 `NEXT_PUBLIC_SENTRY_DSN`(client+server 共用),main 用同一 DSN 硬编码(`electron/main.ts:17`)。gate = 非 dev,打包后 `NODE_ENV=production` → 会报。
- **ingest 侧确认活着**:线上 API 查询显示今天(07-04/05)仍在持续收事件,且有当天首现的新 issue——重构没有把上报管道打断。
- ⚠️【待复核】stop/abort 后真实错误仍 `captureException`(`claude-client.ts:2062-2094`、`agent-loop.ts:539/740`);`safe-stream.ts:75/84` 只吞 "controller already closed" 竞态、真实错误照抛;`pumpTextStream`(`text-generator.ts:35-47`,#53)现在向用户如实抛上游 4xx/5xx。
- ⚠️【待复核】回归测试 `sentry-dev-guard.test.ts` / `instrumentation-shape.test.ts` 守 dev 内存契约 + server init 不被删/外泄;但**不校验** electron/browser 层、不校验 `SENTRY_REPORTABLE` 集合内容、不校验 `reportToSentry` 是否真被调用——下述语义盲区测试守不住。

---

## 二、盲区(按要紧程度)

### 盲区 1 —— `reportNativeError` 对 `EMPTY_RESPONSE` / `TIMEOUT_*` 是 no-op(✅ 已核实,最像疏漏)

`src/lib/error-classifier.ts:10-16` 的 `SENTRY_REPORTABLE` 集合**不含** `EMPTY_RESPONSE`,也不含任何 `TIMEOUT_CONNECT/FIRST_TOKEN/TOOL_EXECUTION/TOTAL_RUN`:
```
SENTRY_REPORTABLE = { UNKNOWN, CLI_NOT_FOUND, CLI_INSTALL_CONFLICT, MISSING_GIT_BASH,
                      PROVIDER_NOT_APPLIED, SESSION_STATE_ERROR,
                      NATIVE_STREAM_ERROR, OPENAI_AUTH_FAILED, MCP_CONNECTION_ERROR }
```
`reportToSentry`(`:27-28`)对不在集合的 category 直接 `return`;`:31` 再对 message 含 `abort|cancel` 的 return。而 `agent-loop.ts:640` 明确调用 `reportNativeError('EMPTY_RESPONSE', ...)`(以及 timeout 各 code)——**这些调用实际是 no-op**。timeout 还被双重抑制(其 err 是 AbortError,又撞 `:31` 过滤)。

**后果**:
- #635 那类"非用户主动的 idle 超时中断"对 Sentry 完全不可见。
- agent-loop 优雅兜住的"空响应"(`:637-648` 走 enqueue error SSE、不抛)不可见 → 后台的 `AI_NoOutputGeneratedError`(见 §三,累计 5489)**只是空输出问题的 SDK-throw 那一半**,agent-loop 自兜的那半没进 Sentry,真实量更高。

**需产品决策**:是有意控额度(那就删掉/注释掉这些误导性的 `reportNativeError` 调用),还是遗漏(那就把 `EMPTY_RESPONSE`/`TIMEOUT_*` 加进集合,并让 timeout 绕过 abort 过滤)。

### 盲区 2 —— `tool-error` 被吞(⚠️ 对应 audit #49,有后台数据佐证)

`agent-loop.ts:556-626` 的 fullStream `switch` 无 `case 'tool-error'`,ai@7 工具 `execute()` 抛错产生的 `tool-error` part 落 `default:`(`:624`)静默丢弃——不转发 SSE、不上报。模型可恢复的工具错丢弃合理,但**系统性坏工具**(execute 恒抛)对 Sentry 不可见。**与后台 `AI_MissingToolResultsError` 强相关(见 §三)。**

### 盲区 3~5(⚠️【待复核】,多为既有非本次重构引入)

- **后台/工具文本流错误不接 Sentry**:`pumpTextStream` 调用方(`media/jobs/plan/route.ts:130`、`quick-actions/route.ts:104`、checkin/onboarding-processor、memory-extractor、task-scheduler)把错误 catch 到 UI/日志/静默,不走 `reportToSentry`。#53 之前更差(被静默吞),非回归。
- **过滤过宽**:`error-classifier.ts:31` `/abort|cancel/i` 会误伤文案含这两个词的真实错误(范围窄)。
- **Electron main 层不一致(偏噪)**:`main.ts:15-19` 无 dev gate、无 `beforeSend`/`ignoreErrors`——dev 也报、不剥 auth header、不滤 abort。与另两层不一致。
- **客户端 by-design**:`stream-session-manager.ts` 的客户端错误/abort 分支只建 UI 快照,不 `captureException`,依赖服务端兜底。
- **文档漂移**:`handover/sentry-error-reporting.md` 仍把已删除的 `PROCESS_CRASH` 列为上报项,也未列入新增的 `NATIVE_STREAM_ERROR`/`OPENAI_AUTH_FAILED`/`MCP_CONNECTION_ERROR`。

---

## 三、后台线上数据(✅ 通过 Sentry API 亲查,org `codepilot-rg` / project `javascript-nextjs`)

**方法**:用 `.env.local` 的 `SENTRY_AUTH_TOKEN` 只读查询 issues API(`is:unresolved`,近 14 天)。

**新问题(firstSeen 近几天),最值得看的一类**:

| firstSeen | 说明 |
|---|---|
| 06-27 起,07-03/04 放量 | **`AI_MissingToolResultsError: Tool results are missing for tool calls …`**(多个新组 + 累计 164) |
| 07-03 | `AI_InvalidResponseDataError: Expected 'function' type` |
| 07-02~04 | `Claude Code compat API error: 401/405/429/502`、`/api/providers/test` HTTP 404 |

**关键关联(强相关/高可信推断,非已证因果)**:`AI_MissingToolResultsError` = "tool_call 找不到配对 tool_result",与**盲区 2 / audit #49 吞掉 tool-error** 的机制强相关——工具错若没转成 tool_result,下一轮请求就会带悬空 tool_call。出现时点(06-27~)贴合 ai-sdk-7 迁移。**可作为代码审计结论的有力佐证,但尚未逐事件追踪证实因果(建议修 #49 后看该 issue 是否回落来验证)。**

**长期高量级(非新,但量大)**:
- `Claude Code process exited with code 1` —— 累计 8160(最高)。
- `AI_NoOutputGeneratedError: No output generated` —— 累计 5489,今天仍触发;与 #53/#635 相关,#53 修复今天(07-04)才落,**需过几天看趋势验证修复是否见效**;注意受盲区 1 影响,真实"空输出"量比这个数字更高。
- `No provider credentials available` —— 2302(多为用户没配 key,噪音)。
- `SqliteError: FOREIGN KEY constraint failed` —— 79(对应 tech-debt #32,未修)。
- `[object Object]` —— 66,**上报卫生问题**:某处抛了非 Error 对象、未正确序列化就进 Sentry,真实信息丢失,建议顺手修。

**说明**:所有 issue `users=0` 是匿名上报设计使然(无 setUser),非 bug;代价是无法从 Sentry 判断影响的独立用户数。

---

## 四、建议(供 Codex 复核后决定)

1. **先定夺盲区 1**(唯一"代码自相矛盾"):`EMPTY_RESPONSE`/`TIMEOUT_*` 要报就加进 `SENTRY_REPORTABLE` + timeout 绕过 abort 过滤;不报就删掉误导性调用。
2. **盲区 2(#49)** 连带处理,有 `AI_MissingToolResultsError` 佐证:agent-loop 补 `case 'tool-error'`,至少对"非模型可恢复"的系统性 tool-error 上报 + 转 SSE 错误气泡。
3. 修 `[object Object]` 上报卫生(找抛非 Error 对象的点)。
4. 回写 `handover/sentry-error-reporting.md` 文档漂移。
5. 过几天复查 `AI_NoOutputGeneratedError` 趋势,验证 #53 修复。

**安全提醒**:`.env.local` 的 `SENTRY_AUTH_TOKEN` 是明文,确认已被 `.gitignore` 忽略、未进版本库。
