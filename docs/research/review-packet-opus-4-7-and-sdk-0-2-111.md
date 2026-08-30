# Review Packet: Opus 4.7 + Agent SDK 0.2.111 Adoption

> 提交给 Codex 的审查材料。本轮迭代从 `ebd83ea` 到 `b65c6ac`，共 32 个 commit，44 个文件，+4362 / -114 行。

## 1. 本轮目标

1. **Opus 4.7 升级**（模型切默认、xhigh effort、1M context、adaptive thinking display）
2. **SDK 0.2.111 升级**（agent-sdk 0.2.62→0.2.111, ai-sdk/anthropic 3.0.47→3.0.70，49 版本跨度）
3. **阶段 1 用户价值闭环**：Phase 1 chip 显示 / Phase 1b chip 可操作按钮 / Phase 2 订阅限流 banner / Phase 5 indicator 精度

**明确排除**：Phase 3 WarmQuery（需 POC）/ Phase 4 Session fork（独立大工程）/ Phase 6 新 hooks / Phase 7 Elicitation + Deferred tools（用户明确不做）。

---

## 2. Commit 分组

### 2.1 SDK 升级 + 类型适配（基础层）

```
7c476e7 deps: upgrade Claude Agent SDK to 0.2.111 and AI SDK Anthropic to 3.0.70
```

仅版本 bump + claude-client 一处 type-predicate 修复，测试 1047/1047 不变。

### 2.2 Opus 4.7 模型切换与多轮校准

```
c02cc0a feat(opus-4.7): switch default Opus to 4.7 and backfill capability metadata
3fc0f89 fix(opus-4.7): correct cross-runtime gaps after default model switch
ed03098 fix(opus-4.7): unify runtime sanitizer and pin aliases to upstream ids
4590d95 fix(provider-catalog): split first-party vs shared Anthropic catalogs
9834dbf fix(opus-4.7): request summarized thinking display so reasoning UI survives
b640a6d fix(effort,poc): expose Auto state and tighten warm-query first-text metric
78abb9f fix(provider-catalog): route legacy anthropic providers through first-party catalog
bcad42d fix(context-window): pin env aliases to upstream and order fallback by length
f1f1162 fix(context-window): resolve upstream via substring, then fall back to model alias
d71ec7e fix(context,poc): resolve upstream for indicator and fail POC on non-delta samples
e7cb774 fix(provider): require base_url for anthropic-protocol providers on all write paths
e279750 fix(doctor,agent-loop): surface empty-url anthropic + native-runtime effort-ignored
37c317e fix(provider): use inferred protocol so raw='' and missing fields can't bypass validation
7323a55 fix(provider): thread effective protocol through resolver/models, reject invalid raw, exempt cloud from missing-url
2870eb5 fix(provider-resolver): normalize protocol in auxiliary fallback enumeration
2bd51e9 fix(agent-loop): toast effort-ignored for third-party Anthropic proxies too
```

### 2.3 SSE 管道 + toast / chip 基础设施

```
f997873 feat(sdk-0-2-111): surface TerminalReason on end-of-turn chip (additive)
2ec0c24 fix(sdk-poc,chip): tighten POC coverage and TerminalReason fallback
84102bd fix(sse): route whitelisted status codes through toast instead of status text
5899055 fix(sse): share status-toast helper between useSSEStream and page-level parser
```

### 2.4 阶段 1 用户能力（Phase 1b / 2 / 5）

```
f24656a feat(chip): close the loop — action buttons on TerminalReasonChip (Phase 1b)
cc9be72 feat(rate-limit): surface subscription quota banner on chat page (Phase 2)
17b721c feat(context): upgrade indicator to SDK snapshot when fresh (Phase 5)
b65c6ac fix(context): remove Phase 5 getContextUsage call — control API can't run from inside iterator
```

### 2.5 POC 脚手架

```
ec03c6e test(sdk-poc): scaffold Phase 0 POC integration tests
8d544b9 test(sdk-poc): persist POC results so go/no-go evidence outlives the terminal
```

### 2.6 文档

```
54bda78 docs(exec-plans): add Opus 4.7 upgrade and Agent SDK 0.2.111 adoption plans
a3c1c0a docs(exec-plans): add Phase 1b (chip action buttons) + user-facing roadmap
```

---

## 3. 关键架构决策（按"为什么这么做"排列）

### 3.1 模型 catalog 三表分流

- **`ANTHROPIC_FIRST_PARTY_MODELS`**（only `anthropic-official` preset）—— opus 带 `upstreamModelId: 'claude-opus-4-7'`，xhigh available
- **`ANTHROPIC_DEFAULT_MODELS`**（anthropic-thirdparty / openrouter / ollama / litellm）—— alias-only，无 upstream pin
- **`BEDROCK_VERTEX_DEFAULT_MODELS`**（bedrock / vertex）—— opus 显示 "Opus 4.6 (alias)"，无 xhigh

**依据**：Bedrock/Vertex 的 `opus` alias 官方仍指 4.6；OpenRouter 走 OpenAI SDK，不一定接受 Anthropic first-party model id；通用代理/LiteLLM 常需用户自己的 upstream 名称。

### 3.2 `getEffectiveProviderProtocol(providerType, protocol, baseUrl)`

集中处理"raw protocol vs inferred protocol"。所有写入路径（POST/PUT）、resolver、models route、doctor 统一用这个 helper。

**依据**：legacy DB 有 `protocol=''` 或 `protocol='random-garbage'` 的 row，不归一化会导致不同代码路径得出不同 protocol 结论，capability 分流错乱。

### 3.3 anthropic-protocol 写路径强制非空 baseUrl

POST `/api/providers` 和 PUT `/api/providers/[id]` 对 `effectiveProtocol === 'anthropic' && !base_url` 直接 400（`ANTHROPIC_BASE_URL_REQUIRED`）。Test connection 同样 reject。

**依据**：`base_url=''` 在 anthropic 协议下有歧义（legacy 迁移 vs 三方漏填），不在输入层堵住就会让三方 provider 悄悄跑成官方 api.anthropic.com 并继承 first-party 能力。

### 3.4 `sanitizeClaudeModelOptions` 共享给 SDK 和 native 两条 runtime

SDK 路径 `claude-client.ts` 和 native 路径 `agent-loop.ts` 共用 Opus 4.7 的 thinking/context1m 迁移规则：
- `thinking.type === 'enabled'` → `{ type: 'adaptive', display: 'summarized' }`
- 1M context beta header 跳过（4.7 默认 1M）

**依据**：两条 runtime 不能在 4.7 迁移规则上漂移。SDK subprocess 可能会自己处理也可能不，native 路径 @ai-sdk/anthropic 3.0.70 已知会发 400（manual extended thinking 被拒）。两边都 sanitize 保安全。

### 3.5 Opus 4.7 native path effort 被硬 drop

`agent-loop.ts` 在 `isOpus47 && !isThirdPartyProxy` 时直接不发 effort，通过 `RUNTIME_EFFORT_IGNORED` SSE status 事件 + toast 告知用户。

**依据**：@ai-sdk/anthropic 3.0.70 仍会附加废弃的 `effort-2025-11-24` beta header；Opus 4.7 migration checklist 明确要移除该 header。暂时 gate 效应参数直到 provider 发干净请求。第三方代理 native 路径也有同样 drop + toast 机制（`2bd51e9`）。

### 3.6 Phase 5 没调 `getContextUsage`，复用 `SDKResultMessage.usage`

`b65c6ac` 移除了 `conversation.getContextUsage()` 调用。

**依据**：getContextUsage 是 control API，从 for-await-of 循环内 await 会阻塞 iterator，control response 无法到达，Query 随 result close 后 promise reject（`Query closed before response received`）。SDK 目前没暴露适合的生命周期 hook。

**替代**：Indicator 直接用 `SDKResultMessage.usage.input_tokens + cache_read + cache_creation` 算 used——SDK-authoritative，<5% 偏差。SSE 事件类型、snapshot 字段、hook 参数保留作为未来 categories 分类扩展点。

### 3.7 Auto effort 状态（非"伪 UI"）

`MessageInput` 的 effort selector 初始值从 `'high'` 改为 `'auto'`（sentinel），发送时 `'auto'` 被过滤掉不发 effort，让 Claude Code CLI 应用 per-model 默认（Opus 4.7 → xhigh）。

**依据**：之前按钮显示 "High" 但实际发送 `undefined`，UI 和请求不一致——按 UX 原则是"暴露内部状态不是用户价值"的典型反模式。

### 3.8 Phase 1b 按钮化，所有"重试"类经显式确认 + draft 保留

`prompt_too_long` / `blocking_limit` / `model_error` 等触发的 chip 按钮：
- 「压缩并重试」「开启 1M 并重试」「切换到 Sonnet」「重试」都弹 AlertDialog 二次确认
- 非破坏性（「仅压缩」「继续」「查看 Hook 配置」）直接跑
- 压缩重试通过监听 `context-compressed` window event + `pendingRetryAfterCompactRef` ref 在压缩后自动 replay

**依据**：feedback memory 里 `feedback_no_silent_auto_irreversible` —— 自动重发/外部导航/跨模型切换必须显式确认；上一轮可能已有工具副作用。

### 3.9 订阅限流 banner 只在订阅路径显示

`SDKRateLimitEvent` 只由 claude.ai subscription paths 发；API key / 三方代理根本不会收到。Banner 条件化渲染 `streamSnapshot.rateLimitInfo.status !== 'allowed'`，可关闭（`rateLimitDismissed` state 按 sessionId 重置）。

**依据**：SDK typings 明文「Rate limit information for claude.ai subscription users.」。原 error-classifier 的 429 正则保留为所有非订阅路径的主干。

---

## 4. 已知 out-of-scope（别重复提）

以下**已知**未做，不是疏忽：

| 项目 | 原因 |
|-----|------|
| `@ai-sdk/anthropic` 的 `effort-2025-11-24` beta header 清理 | 上游 SDK 还没给关闭选项，绕过（Opus 4.7 native 不发 effort） |
| Sonnet/Haiku upstream full name 统一 | 历史不一致（env 表 `4-20250514` vs ai-provider `4-5-20250929`），未扩大 scope |
| Tokenizer 1.0-1.35× 膨胀的长对话校准 | 需真实会话数据 |
| 4.6 vs 4.7 prompt 字面化行为回归测试 | 需 10 个代表性会话对比 |
| Phase 3 WarmQuery | 需先跑 POC 证明首字延迟 p50 ≥30% 下降 |
| Phase 4 Session fork | 独立大工程（DB migration + 3 API + UI），下一版 |
| Phase 6 新 hooks (PostCompact/CwdChanged/PermissionDenied/WorktreeCreate) | 依赖 hooks-poc 结论，且用户本轮明确不做 |
| Phase 7a Elicitation + 7b Deferred tools | 用户本轮明确不做 |
| Phase 1b chip 按钮的 **draft preservation on cancel** | v1 未做；取消后 chip 保留、上条消息仍在聊天流可见，用户可复制。Draft 机制需要和 MessageInput 的 autosave 协同，独立 PR。 |
| TerminalReasonChip / RateLimitBanner / Phase 1b action 的 **单元测试** | chip 逻辑简单+强类型，ChatView 的 action handler 薄。手动 CDP 覆盖集成点。若回归风险出现再补。 |
| Phase 5 快照的 **snapshot age 1 秒级 tick** | 60s 粗粒度够用，频繁 re-render 成本不值 |

---

## 5. 测试状态

- **单元测试**：`npm run test` → 1069/1069 pass（新增 ~22 个单测，主要 pin `getEffectiveProviderProtocol` / `isValidProtocol` / `getContextWindow` upstream 分流 / BEDROCK_VERTEX catalog 隔离 / 无效 protocol 辅助 fallback 不 crash）
- **typecheck**：严格模式零错
- **CDP 实测**：
  - 模型下拉显示 Claude Code 组（`env`）的 Opus 4.7，其他 preset 显示 alias-only `Opus`
  - Effort 下拉 6 项（默认/低/中/高/极高/最大），按钮文案与 parent state 一致
  - 发消息 `/api/chat` SSE 事件序列：`status, text, rate_limit, result, done`（rate_limit 管道通；text 正常流式；无 warn）
  - Opus 4.7 模型名显示 `Opus 4.7 (1M context)`
  - Console 零 error / warn
- **POC 未跑**：`test:sdk-poc` 三个 integration test 需要真实 Anthropic 凭据，留给用户自行决策（Phase 3/6/7 的 go/no-go 阻塞项）

---

## 6. 希望 Codex 重点审的几处

1. **Phase 1b 的 `runTerminalAction` 调度**（`ChatView.tsx`）
   - `sendMessageRef.current?.('/compact')` + `setTimeout(() => sendMessageRef.current?.(lastUserMessage), 100)` 这种时序是否可靠？若 100ms 不够、sendMessage 尚未 register 下一次，会怎样？
   - `switch_to_sonnet` 用 `setCurrentModel('sonnet') + setTimeout(50) + sendMessage`——`setCurrentModel` 是 setState，下次 render 才生效；`sendMessage` 里读 currentModel 的闭包是否拿到旧值？
   - `pendingRetryAfterCompactRef.current` 如果用户在压缩过程中手动发了消息，会不会 double-send？

2. **Phase 2 banner 的 `onRequestSwitchToSonnet` 共用 `pendingTerminalAction` 机制**
   - banner 触发 `setPendingTerminalAction({ actionId: 'switch_to_sonnet', ... })` → 弹 AlertDialog。这和 chip 的 switch_to_sonnet 共享同一 dialog state，有无冲突？

3. **`claude-client.ts` 的 `controlQuery` 引用保留逻辑**
   - resume 失败 fallback 时，`conversation = query({...})` + `controlQuery = conversation`——有没有遗漏的分支？
   - 虽然 Phase 5 最终没用 controlQuery（commit `b65c6ac`），但 `controlQuery` 变量还保留着，指向"尚未开始迭代的新 Query"——是否会被后续代码误用？

4. **`useSSEStream.ts` 的 callback 代理**
   - 新增 `onRateLimit` / `onContextUsage` 都走 ref-proxy 模式。三条独立 callback 是否存在顺序依赖或 race？
   - `maybeShowStatusToast` 是纯副作用函数，两处 parser 都用它，toast 重复触发风险？

5. **`anthropicBeta` header 的绕过策略**
   - `agent-loop.ts` 为了回避 `effort-2025-11-24` 给 Opus 4.7 native 路径 drop effort。但 `@ai-sdk/anthropic` 3.0.70 内部有没有可能在别的 ai-sdk option 上也偷偷加这个 header？
   - 相关绕过是否应在 package.json 加 override / resolutions 强制版本？

6. **前端 effort 'auto' sentinel 的生命周期**
   - 初始 `localEffort='auto'`；用户选其他值后再也无法回"auto"（下拉里有 auto 选项，但测试时没试 switch back）。是否可靠？
   - sessionStorage / localStorage 的 last-effort 持久化（如果有）对 'auto' 的处理？

7. **Provider 空 base_url 的 legacy 分流条件**
   - `getDefaultModelsForProvider('anthropic', '', 'anthropic')` 返回 first-party catalog——这是**读路径**的 legacy 兼容；**写路径**已经 reject 新增的 empty URL。已有 legacy row 的处理策略完备吗？
   - 如果用户把一个已有 legacy anthropic 的 `provider_type` 改为其他值会怎样？

---

## 7. 推送状态

- `git log` 到 `7323a55` 已经 push 到 `origin/main`（23 个 commit）
- `2870eb5` 至 `b65c6ac`（9 个 commit，包括 Phase 1b / 2 / 5）**未 push**，本地独有
- 未 tag，未触发发版

---

## 8. 文档交叉引用

- `docs/exec-plans/superseded/opus-4-7-upgrade.md` — Opus 4.7 升级计划（Codex round 1 审过）
- `docs/exec-plans/superseded/agent-sdk-0-2-111-adoption.md` — SDK 新能力采纳计划（Codex rounds 2-10 审过）
- `docs/research/opus-4-7-verify-effort-dropdown.png` — CDP 验证 effort 下拉
- `docs/research/opus-4-7-verify-auto-effort.png` — CDP 验证 Auto 默认状态

---

*Generated for Codex review session 2026-04-18.*
