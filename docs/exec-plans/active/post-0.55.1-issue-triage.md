# Post 0.55.1 Issue Triage / 0.55.1 后 Issues 调研

> 创建时间：2026-06-08
> 最后更新：2026-06-08

## 状态

这份文档给 Claude Code 接手修复用。Codex 本轮只做调研、复现设计、证据整理和优先级建议；不改产品代码。

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | Issue inventory + release/commit 对照 | ✅ 完成 | 覆盖 GitHub #606/#612/#613/#614/#615/#616/#617/#618/#619/#620/#621，以及 0.55 后更新的 #554/#577 |
| Phase 1 | #615/#614 截图发送被吞 | ✅ 已实现（单测） | P0 已修：`onSend` 升级为可回传"未投递"的契约，MessageInput 所有带附件的 no-send 路径改走 `abortComposerSubmit`（首条 + 后续两条流都覆盖）。真实 UI smoke 待补 |
| Phase 2 | #620 Ollama 添加时要求安装 Claude Code | ⏸ 本轮不做（用户 2026-06-08） | P1，方向较明确（语义/文案），但本轮先只做 P0；记录待排期 |
| Phase 3 | #613/#615 Codex/Opus 模型切换与模型列表不稳定 | ⏸ 本轮不做（用户 2026-06-08） | P1，**未复现**，需冷缓存专项复现后再动，不盲改 |
| Phase 4 | #619 概率串会话 | ⏸ 本轮不做（用户 2026-06-08） | P1，**未复现**，必须先按复现脚本坐实再碰 stream/ context，不盲改 |
| Phase 5 | 低优先级/待补证队列 | ⏸ 本轮不做（用户 2026-06-08） | #612/#554/#617/#618/#606/#616/#621 |

## 用户会看到什么

- 修完 Phase 1 后：截图/附件在未真正发送时不会消失；用户无需靠“仍要发送”提示绕路。
- 修完 Phase 2 后：添加 Ollama 不再被误导去安装 Claude Code CLI；本地 Ollama 只要求 Ollama 服务和模型本身可用。
- 修完 Phase 3 后：Codex Runtime 的模型列表、Opus/Codex 模型选择在冷启动、缓存空、Codex app-server 慢/失败时都有明确 UI 状态，不再表现成随机丢模型或选不中。
- 修完 Phase 4 后：两个不同项目/会话并发时，A 会话的问题不会进入 B 会话，也不会让两个窗口同时回答同一条输入。

## 本轮明确不做

- 不重开 MiMo 模型回退。#577 的 MiMo 部分已经随 0.55.0/0.55.1 发布，当前默认模型是 `mimo-v2.5-pro`。
- 不把 #612 归因成 0.55 回归。该 issue 自报 CodePilot 版本是 0.54.0。
- 不无条件采信 #619 用户对根因的猜测。只采信现象，再用源码和复现验证。
- 不把 #606/#616/#621 当 bug 修；它们是 provider endpoint / 文件区右键功能请求。

## 决策日志

- 2026-06-08：确认 #577 MiMo 回退修复已包含在 `v0.55.0` 和 `v0.55.1`。`git tag --contains ea860da` 返回两个正式 tag；当前 catalog 对 `xiaomi-mimo` 与 `xiaomi-mimo-token-plan` 均使用 `mimo-v2.5-pro`。
- 2026-06-08：#615 拆成两个问题处理：截图/附件丢失为 P0，可从 `PromptInput` + `MessageInput` 清空契约直接证明；模型无法选中/列表不稳定并入 Phase 3。
- 2026-06-08：#620 定为语义/UX P1，而不是“真实需要 Claude Code CLI”。后端 test provider 已明确绕过 Claude Code SDK subprocess。
- 2026-06-08：#619 定为高严重待复现。主路径 stream subscription 按 `sessionId` 分桶，当前不能直接判定为全局广播 bug。
- 2026-06-08：Claude Code 复核 triage——深挖确认 P0（#615）成立（MessageInput 多条裸 `return` no-send 路径 + `onSend` 为 `void` 导致 ChatView/首消息页的 provider 门早退后附件已被清空；首条与后续两条流都中招）；spot-check Phase 2（Ollama）代码证据成立；Phase 3/4 认同"未复现、需专项复现再动"。
- 2026-06-08：用户决定**本轮只修 P0（#615）**，Phase 2/3/4/5 暂不做（不确定 / 待复现），保留本文档作记录。P0 已由 Claude Code 实现并通过单测；真实 UI smoke 待补。其余 Phase 待用户后续主动发起。

## Release / Commit 对照

| 问题 | 结论 | 证据 |
|------|------|------|
| #577 MiMo 回退 + 成功回答后追加 provider error | ✅ 已在 0.55 发布前修复 | `ea860da fix(provider,chat): MiMo 可设型号不再回退默认 + 成功回答后不再追加 provider error`；`git tag --contains ea860da` 包含 `v0.55.0` / `v0.55.1` |
| #578 中断后前端发送无响应 | ✅ 已在 0.55 发布前修复前端 force-abort | `fcce794 fix(chat): 中断任务后无条件调度 force-abort`；`git tag --contains fcce794` 包含 `v0.55.0` / `v0.55.1` |
| Codex Runtime Stop 后无法恢复发送 | ✅ 当前分支已修，未必在用户 0.55.1 中 | `5436ee6 fix(codex): recover send after Stop`; 见 `docs/exec-plans/active/codex-stop-recovery.md` |
| PromptInput reject 保留附件 guard | ✅ 当前分支已有测试 pin，但只覆盖 RunCheckpoint reject 形态 | `2c0f768 test(run-checkpoint): pin PromptInput reject branch preserves attachments` |

## MiMo 当前状态

### 结论

MiMo 模型回退在 0.55 正式更新中已经修好。当前模型如下：

| Preset | baseUrl | 默认 upstream | 显示名 | role mapping |
|--------|---------|---------------|--------|--------------|
| `xiaomi-mimo` | `https://api.xiaomimimo.com/anthropic` | `mimo-v2.5-pro` | `MiMo-V2.5-Pro` | default / sonnet / opus / haiku 全部指向 `mimo-v2.5-pro` |
| `xiaomi-mimo-token-plan` | `https://token-plan-cn.xiaomimimo.com/anthropic` | `mimo-v2.5-pro` | `MiMo-V2.5-Pro` | default / sonnet / opus / haiku 全部指向 `mimo-v2.5-pro` |

### 代码证据

- `src/lib/provider-catalog.ts` 中两个 MiMo preset 的 `defaultModels` / `defaultRoleModels` 均为 `mimo-v2.5-pro`，并已暴露 `fields: ['api_key', 'model_names']`。
- `src/lib/provider-resolver.ts` 会在 DB `role_models_json` 为空时回填 preset `defaultRoleModels`；当前回填值已是 `mimo-v2.5-pro`，不是旧的 `mimo-v2-pro`。
- `src/__tests__/unit/mimo-model-mapping.test.ts` 断言：
  - 每个 MiMo preset 必须暴露 `model_names`；
  - 用户设置的 `role_models_json.default = 'mimo-v2.5-pro'` 会被使用；
  - 空 mapping 也回填 `mimo-v2.5-pro`，不回 `mimo-v2-pro`。

### 不再进入本轮优先级的原因

#577 的根因不是“有代码覆盖用户 mapping”，而是旧 preset 没有 `model_names` 字段，连接弹窗保存了空 `role_models_json: '{}'`，resolver 再按旧 catalog 默认回填 `mimo-v2-pro`。当前三层都已收口：preset 默认更新、connect dialog 可填模型、resolver 回填目标更新。

## Phase 1: #615/#614 截图发送被吞

### 现象

- 用户在 0.55.1 中反馈：对话框发送截图后，回车或点击发送都会让截图直接消失。
- 只有触发上下文将满的确认提示，并点击“仍要发送”时，部分用户能发出去。
- 评论中还出现“确认后也有概率被吞”的反馈。

### 本地判断

真实存在，且不是只由 RunCheckpoint 引起。当前代码仍存在多条“没有真正发送，但 submit Promise 成功 resolve”的路径。`PromptInput` 看到 success 后会清空文件。

### 代码证据

- `src/components/ai-elements/prompt-input.tsx`:
  - `onSubmit` Promise resolve 后调用 `clear()`；
  - reject / throw 才保留输入和附件。
- `src/components/chat/MessageInput.tsx`:
  - RunCheckpoint blocking 已修成 `throw new Error('run-checkpoint-blocked')`，这条会保留附件；
  - `if ((!finalContent && !hasFiles) || disabled) return;` 仍是成功返回；
  - badge active + streaming 时 `if (isStreaming) return;`；
  - slash command + streaming 时 `if (isStreaming) return;`；
  - 正常发送路径调用 `onSend(...)` 后立即 `setInputValue('')`，而 `onSend` prop 类型是 `void`，输入层无法知道 `ChatView.sendMessage` 是否被 provider/runtime gate 早退。
- `src/components/chat/ChatView.tsx`:
  - `sendMessage` 在 `providerFetchState === 'idle'`、`noCompatibleProvider`、`sessionProviderRuntimeIncompatible` 时会早退；
  - 这些早退发生在 `MessageInput` 已经认为 submit 成功之后。

### 推荐修法

优先做契约修复，而不是逐个 return 打补丁：

1. 将 `MessageInput.onSend` 从 `void` 升级为可表达结果的返回值，例如 `Promise<{ accepted: boolean; reason?: string }>` 或同步/异步 `SendResult`。
2. `MessageInput` 只在 accepted / queued / command-handled 时清空输入和文件；blocked / disabled / provider-loading / incompatible 时 throw 或返回 rejected result，让 `PromptInput` 保留附件。
3. 所有 no-send 分支统一走一个 helper，例如 `blockSubmit(reason)`，避免未来新增 guard 又写成裸 `return`。
4. 回归测试要覆盖真实 `PromptInput` 清空契约，而不只是本地 mock：
   - disabled + file submit 后文件仍在；
   - provider loading + file submit 后文件仍在；
   - runtime incompatible + file submit 后文件仍在；
   - RunCheckpoint confirm-send 后文件能发送并清空；
   - accepted send 后文件清空。

### 验收

- UI smoke：粘贴截图，在 provider loading / runtime incompatible / RunCheckpoint blocked 三种状态下点击发送，截图仍保留。
- UI smoke：解除阻断后点击发送，截图出现在用户消息气泡或请求 payload 中。
- Unit/source-pin：禁止 `MessageInput` 内出现 no-send 裸 `return` 触发 submit success。

## Phase 2: #620 Ollama 添加时要求安装 Claude Code

### 现象

用户反馈：添加 Ollama 时要求安装 Claude Code，而且提示要 npm 模式。用户本机已经安装 Claude Code。

### 本地判断

大概率真实，属于 UX/语义 bug。后端连接测试不需要 Claude Code CLI，但 preset 和 UI 分类文案容易把用户引到 Claude Code CLI 安装。

### 代码证据

- `src/lib/provider-catalog.ts` 中 Ollama preset:
  - `protocol: 'anthropic'`;
  - `authStyle: 'auth_token'`;
  - `baseUrl: 'http://localhost:11434'`;
  - `defaultEnvOverrides.ANTHROPIC_AUTH_TOKEN = 'ollama'`;
  - `sdkProxyOnly: true`;
  - docs URL 指向 `https://docs.ollama.com/integrations/claude-code`。
- `src/app/api/providers/test/route.ts` 调用 `testProviderConnection(...)`，不是 Claude Code SDK subprocess。
- `src/lib/claude-client.ts` 的 `testProviderConnection` 注释明确：直接 HTTP request，bypass Claude Code SDK subprocess。
- `src/lib/runtime-compat.ts` 已说明 `claude_code_experimental` / `verified` 这类 Anthropic-compat provider 也可由 CodePilot Runtime 的 `ClaudeCodeCompatAdapter` 访问，不应等价于“必须安装 Claude Code CLI”。

### 推荐修法

1. Provider 添加/测试流程中，Ollama 应显示为“本地服务 / CodePilot 可直连 / Claude Code-compatible wire format”，而不是“必须安装 Claude Code”。
2. 若当前默认 runtime pin 是 Claude Code 且 CLI 不可用，提示应限定为“当前会话选择 Claude Code Runtime 不可用；可改用 CodePilot Runtime 或 Codex Runtime”，不能阻断 provider 保存/测试。
3. Ollama docs / helper 文案应优先说明：
   - 需要本地 Ollama 服务；
   - 需要已 pull 对应模型；
   - Base URL 默认 `http://localhost:11434`；
   - Claude Code CLI 只是可选运行路径，不是添加 provider 的前置条件。
4. 测试：
   - `POST /api/providers/test` 对 Ollama 不依赖 Claude Code status；
   - ProviderManager / SetupCenter 文案 source-pin：Ollama card 不出现“npm install Claude Code”作为添加前置条件；
   - Runtime 不可用提示只出现在 runtime card / session runtime gate，不出现在 provider add primary path。

### 验收

- 未安装 Claude Code CLI 的环境中，能添加 Ollama provider，并能看到“本地 Ollama 服务未启动 / 模型不可用”等 provider 自身错误。
- 已安装但非 npm 安装的 Claude Code 环境中，不再误要求 npm 模式。

## Phase 3: #613/#615 模型切换与模型列表不稳定

### 现象

- #613: “Codex 作为内置引擎以后总是切换模型失败”。
- #615: “对话中选择模型无法选中 Opus，经常出现旧版 4.6/4.7，4.8 出现靠运气，无法优先选中或者搜索到”。

### 本地判断

用户现象可信，但本地当前 warm-cache 状态未复现。我用 dev server `http://127.0.0.1:3001` 访问：

- `/api/providers/models`;
- `/api/providers/models?runtime=codex_runtime`;
- `/api/providers/models?runtime=auto`;

三条都返回 `codex_account` group，模型为 `gpt-5.5`、`gpt-5.4`、`gpt-5.4-mini`、`gpt-5.3-codex-spark`。

但是源码存在冷缓存/发现链路风险。

### 代码证据

- `src/app/api/providers/models/route.ts`:
  - `runtime=codex_runtime` 时调用 `buildCodexProviderModelGroup({ timeoutMs: 2500 })`；
  - full catalog path 无 runtime 参数时只调用 `buildCodexProviderModelGroup({ cacheOnly: true })`，不会隐式 spawn app-server；
  - cache 空时 full catalog 可能没有 Codex Account group。
- `src/__tests__/unit/codex-models-decoupling.test.ts` 明确 pin 住：
  - `cacheOnly` 空缓存返回空，并且不触碰 app-server；
  - warm cache 才会返回 Codex model group。
- `src/__tests__/unit/provider-model-roundtrip.test.ts` 已修过 canonical id round-trip，说明“选中 Opus 后 UI 回落到别的模型”曾经是一个真实风险区，不能只靠现状乐观判断。

### 需要 Claude Code 深挖的问题

1. Chat composer 是否在初次加载时使用 full catalog，而非 runtime-filtered `codex_runtime` feed？
2. Codex Account group 在 cold cache 为空时，UI 应显示“正在加载 Codex 模型 / Codex app-server 不可用”，还是静默消失？
3. “无法选中 Opus”是否是 canonical matcher 仍有遗漏，还是不同 provider group 的 `opus` alias 排序/搜索导致用户选错 group？
4. 模型搜索是否只搜 label/value，没有搜 upstream id / provider name / role alias？
5. 旧版 4.6/4.7/4.8 同时出现是否来自多个 provider group 的真实 catalog，而非 Codex Account；如果是，UI 是否需要 provider 分组和最近使用更清晰？

### 推荐修法

1. 给 Codex Runtime 模型列表增加冷启动状态：
   - `loading_codex_models`;
   - `codex_unavailable`;
   - `cache_empty`;
   - `loaded`.
2. Chat composer 在 `runtime=codex_runtime` 时优先调用 runtime-filtered feed，并允许 2.5s timeout 后显示降级原因。
3. 保留 full catalog cacheOnly 设计，避免 Settings 全局列表被 Codex app-server 拖死；但 UI 不应把 cacheOnly empty 伪装成“没有模型”。
4. 给 model selector 增加 source breadcrumb：显示 provider group / runtime support / upstream id，至少在 debug tooltip 或 test hook 中可见。
5. 测试：
   - cold cache + Codex app-server ok：composer 能加载 Codex Account group；
   - cold cache + app-server timeout：UI 显示明确不可用状态，不静默回退；
   - saved canonical Opus/OpenRouter slug 能 round-trip 到 Opus row；
   - 搜索 `opus` / `4.8` / upstream slug 时返回正确 group。

### 验收

- 清空 Codex model cache 后，切到 Codex Runtime，首次打开模型选择器能看到 loading 或最终模型，不出现空白/随机旧列表。
- 选择 Opus-like 模型后，trigger label、session model、实际发送 model 三者一致。
- 对同名 `opus` alias，UI 能让用户看出属于哪个 provider。

## Phase 4: #619 概率串会话

### 现象

用户反馈：两个不同项目/工作空间都打开会话。A 项目正在处理研究内容，B 项目提问后，两个不同会话/工作空间一起回答 B 的问题。

### 本地判断

高严重，但不能直接认定根因。当前主流 stream 路径看起来是按 `sessionId` 隔离的。

### 代码证据

- `src/lib/stream-session-manager.ts`:
  - active streams map 用 `params.sessionId` 作为 key；
  - emit 时从 `getListenersMap().get(stream.sessionId)` 取 listener；
  - window event 的 detail 也带 `sessionId`。
- `src/hooks/useStreamSubscription.ts`:
  - 订阅 `subscribe(sessionId, listener)`；
  - append final assistant message 时写当前 `sessionId`。
- `src/components/chat/ChatView.tsx`:
  - `startStream({ sessionId, ... })` 使用当前 ChatView prop 的 `sessionId`。
- `src/app/chat/[id]/page.tsx`:
  - 路由切换时先清 stale workingDirectory / model / provider，再 fetch session info。

### 可疑区域

1. Split view / active column:
   - `AppShell` split mode 会用 `activeColumnId` 同步 URL；
   - 如果某个输入组件拿到的是 active panel context 而非列自己的 session context，可能出现跨列发送。
2. Chat list / route state:
   - 多窗口快速切换时，`PanelContext.sessionId` 是全局单值；
   - SplitColumn / ChatView prop 需要确认是否始终使用列 session，而不是全局 session。
3. Background auto-trigger:
   - `useAssistantTrigger` 也会 `startStream({ sessionId, workingDirectory })`；
   - 需要确认 assistant workspace 与普通项目不会复用错误 owner。
4. DB session/cwd binding:
   - 历史上 `getLatestSessionByWorkingDirectory` 曾经需要过滤 `source='task'`，说明 session/cwd 复用区域有过串写风险。

### 推荐复现脚本

1. 准备两个真实工作目录 A/B，并创建两个不同 chat session。
2. 打开 A 会话，启动一个长流式任务，记录：
   - A `sessionId`;
   - A `working_directory`;
   - A `stream-session-event.detail.sessionId`。
3. 打开 B 会话或 split 第二列，发送带唯一 marker 的问题，例如 `B_ONLY_MARKER_20260608`。
4. 断言：
   - 只有 B 的 `/api/chat` request body 里出现该 marker；
   - A 的 stream snapshot / final assistant content 不包含该 marker；
   - DB `messages` 表里 marker 只出现在 B `session_id`；
   - window `stream-session-event` 的 sessionId 不跨发。
5. 重复三种 UI 形态：
   - 单窗口 route 切换；
   - split view 两列；
   - 两个独立 app/browser window。

### 推荐修法方向

先复现再修。如果复现落在 split/context：

- SplitColumn 内部应提供 column-scoped context，输入、预览、终端都读列 session，而不是 AppShell 全局 session。
- `ChatView` / `MessageInput` 应把 `sessionId` 显式传到底，避免从 `usePanel()` 读全局 session。
- 增加 e2e：两个 session 并发，发送 marker 不串。

如果复现落在 DB/session:

- 给 `/api/chat` 增加请求级 breadcrumb：`session_id`、resolved workingDirectory、sdk_cwd、provider_id、runtime、lock_id。
- 写入消息时断言 request `session_id` 与 loaded session row 一致。
- 任何 by-cwd lookup 都要标明 `includeSources`，避免隐式复用隐藏 session。

### 验收

- 双项目并发 10 次，marker 不串入另一个 session。
- split view 两列同时发送，两个列的 user/assistant bubble 都只进入自己的 session。
- 相关日志能让用户报告时定位到 session/cwd，而不暴露敏感路径之外的内容。

## Phase 5: 低优先级 / 待补证队列

| Issue | 判断 | 建议 |
|------|------|------|
| #612 image MCP HTTP proxy TLS | 真实兼容性问题，但 issue 自报 0.54.0 | P2；后续调研 SDK 网络层是否支持自定义 dispatcher/agent；不要归为 0.55 回归 |
| #554 1M context 仍显示 200k | 旧问题，核心链路已有修复，DeepSeek 反馈需 provider-specific 验证 | P2；用 DeepSeek provider 真凭据确认 `token_usage.context_window` 是否回传 |
| #617 Claude 只运行一轮 / 输出自动截断 | 证据不足 | 先要求日志、session id、runtime/provider/model、是否命中 Stop/lock 修复 |
| #618 Windows 11 闪退 | 证据不足 | 现有日志到“主窗口已显示”结束，无 crash stack；需要 Windows Event Viewer / app crash log |
| #606/#616 MiMo SGP endpoint | 重复 feature request | 合并为一个 provider catalog request，确认 SGP URL 后排低优先级 |
| #621 文件区右键打开/显示 | feature request | 可独立 UX 小任务，不应挤占 P0/P1 bug |

## Smoke Ledger

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| 2026-06-08 | local dev API | Codex Account | gpt-5.5 / gpt-5.4 / gpt-5.4-mini / gpt-5.3-codex-spark | 本机 dev server warm cache | `/api/providers/models`、`?runtime=codex_runtime`、`?runtime=auto` | ✅ Codex group 当前可见 | terminal probe on `localhost:3001` |
| _待跑_ | UI / Playwright | n/a | n/a | n/a | #615 paste screenshot then blocked submit | 📋 | screenshot + DOM/file count |
| _待跑_ | UI / Playwright | Ollama | local model | local Ollama | add provider without Claude Code CLI | 📋 | screenshot + provider test response |
| _待跑_ | UI / Playwright | Codex Account | gpt-* | cold cache | first open model picker under Codex Runtime | 📋 | console + network + picker screenshot |
| _待跑_ | UI / Playwright | any slow streaming provider | any | test key / mocked stream | two projects/two sessions marker isolation | 📋 | DB marker query + screenshots |

## Claude Code 接手顺序

1. **P0 #615 截图/附件被吞**：用户数据损失感最强，源码证据最硬，修复边界明确。先做契约修复和真实 PromptInput 行为测试。
2. **P1 #620 Ollama 误要求 Claude Code**：影响新 provider 添加；是语义验收问题，修复不应很大。
3. **P1 #613/#615 模型选择不稳定**：需要冷缓存和 runtime-filtered feed 专项复现；避免把 cacheOnly 设计改坏。
4. **P1 #619 串会话**：高严重但先做复现和 breadcrumb；没有复现前不要大改 stream manager。
5. **P2/P3 队列**：#612/#554/#617/#618/#606/#616/#621 分别排入兼容性、待补证、功能请求。
