# New Agent Runtime Onboarding Playbook

> 产品思考见 [docs/insights/new-runtime-playbook.md](../insights/new-runtime-playbook.md)
>
> 真值底座（Phase 5e 扩充）：
> - `src/lib/harness/capability-contract.ts` — 能力清单（Built-in Harness）
> - `src/lib/harness/harness-bundle.ts` — **每 turn 单一输入信封**（三层 Harness + 不可用能力 + 诊断）
> - `src/lib/harness/capability-matrix.ts` — Runtime × Provider × Capability 派生矩阵（Settings UI 数据源）
> - `src/lib/harness/user-codepilot-extensions.ts` — User CodePilot Harness 扫描器
> - `src/lib/harness/external-framework-harness.ts` — External Framework Harness 只读扫描器（含 auth token 禁读列表）
> - `src/lib/harness/mutation-level.ts` — tool 安全分级（替代旧前缀 allowlist）
> - `src/lib/harness/context-compiler.ts` — 系统提示编译
> - `src/lib/harness/runtime-adapter.ts` — Runtime 适配 facade
> - `src/lib/harness/artifact-contract.ts` — 渲染端协议

> 创建：2026-05-17（Phase 5d Phase 5）
> Phase 5e 扩充：2026-05-18（HarnessBundle 三层 / mutationLevel / Settings 能力清单 / Codex Account 降级）
> 适用：接入下一个 Agent Runtime（Hermes、Gemini Live、OpenClaw 等）

---

## 这份文档解决什么问题

Codex Runtime 接入持续三天才稳定。结构性根因是：

1. CodePilot 自己的 Harness 能力（widget / memory / tasks / image_generation / media_import / dashboard / cli_tools）散落在三处——MCP 工厂、Native AI SDK ToolSet、Codex 桥接器。每接一个 Runtime 都要在三处重新对齐。
2. 渲染端协议（show-widget fence、MediaBlock、PreviewSource）没有统一注册表，新 Runtime 不知道"必须发哪种格式给前端"。
3. 修复习惯是"live smoke 跑挂 → 局部补字段"。补完一个还会缺另一个，验证又走真实凭据轮询。

Phase 5d Phase 1 → Phase 4 已经把这些底座补齐：

- **Phase 1**：`HARNESS_CAPABILITIES` 单一能力目录。
- **Phase 2**：`compileContext()` 纯函数把能力集合编译为系统提示 + 工具描述 + Runtime hints。
- **Phase 3**：`adaptForClaudeCode / adaptForNative / adaptForCodexProxy` facade 把 Runtime 入口和编译器隔离。
- **Phase 4**：`ARTIFACT_CONTRACTS` 渲染端协议 + 防漂移测试。

本 playbook 是接第四个 Runtime 时**硬性**走的流程。任何跳步都会让下次接入又退化成 live-smoke-driven patching。

---

## 硬性顺序（不可跳步）

### Step 0 — 决定是否真的需要新 Runtime

新增 Runtime 不是"加一个 provider"。它是新增**整套** agent 协议（请求格式、流事件、工具协议、permission 模型）。

如果新 Agent 只需要换一个 OpenAI-compat / Anthropic-compat endpoint，请走 **Provider** 路径（`src/lib/provider-*.ts`），不要走 Runtime 路径。

判断准则：

- 走 Provider：底层仍是 OpenAI / Anthropic / 兼容协议；只是 endpoint / 模型不同。
- 走 Runtime：协议根本不同，例如自带的 app-server / WebSocket 双工协议 / 自家 tool 协议；或它的能力边界需要 CodePilot 适配（permission 协议、多步 tool loop 形态、特殊事件流）。

不确定时先走 Provider，再升级到 Runtime。Runtime 是最重的接入面。

---

### Step 1 — Schema Snapshot（事实抓取）

**目标**：把目标 Agent 的协议固化到 fixture，**不**先写代码。

操作：

1. 从目标 Agent 的官方文档 / SDK 抓取以下样本，存入 `docs/research/<runtime>-protocol-fixtures/`：
   - 入站请求 JSON（一个最小有效请求 + 一个带 tools 的请求 + 一个 resume 请求）
   - 出站事件流（普通文本回复、tool_call、tool_result、error 各一个完整序列）
   - 工具协议（tool schema 字段、传递方式、suppression 规则）
   - Permission / approval 协议（如有）
   - 资源/媒体协议（如何返回图片 / 文件 / structured artifact）
2. 写 `docs/research/<runtime>-protocol-fixtures.md`：列出每个 fixture 的来源 URL + 抓取日期 + 字段含义（external-fact vs inferred 严格分层，见 `feedback_research_doc_discipline`）。
3. 在 `docs/exec-plans/active/phase-5d-<runtime>.md` 写执行计划，先只到"已抓取 schema"为止。**不要在 plan 里写假定的 mapping**。

**禁止**：

- 不要边读边写代码。snapshot 阶段只读。
- 不要靠 ChatGPT / Claude 推测协议字段；以官方文档 / SDK 源码 / 真实 HTTP 流量为准。
- 不要把"capability X 应该这样接"写进计划——那是 Step 3 的产物。

**完成准则**：fixture 文件能 `JSON.parse` / 能被 grep 出关键字段；可以让另一个工程师/Agent 仅靠 fixture 复现一次请求。

---

### Step 2 — Capability Inventory（在 catalog 加 RuntimeExposure）

**目标**：声明这个新 Runtime 对 CodePilot 现有能力的支持矩阵。

操作：

1. 打开 `src/lib/harness/capability-contract.ts`。
2. 给每个 `CapabilityContract.exposure` 字段添加新 Runtime 的 key（如 `gemini_runtime: RuntimeExposure`）。需要同步扩展 `CapabilityStatus` 的判定逻辑——目前 `exposure` 是固定三键 `claudecode_sdk / native / codex_proxy`，新 Runtime 需要把它扩成可索引的 record。
3. 对每个能力，根据 Step 1 fixture 中实际能不能调用，标 `'live'` / `'partial'` / `'deferred'` / `'unsupported'`：
   - `live` 严格定义：**所有声明的 toolNames 在该 Runtime 下都能注册并被模型调到**。
   - 缺一个工具就降到 `deferred` + 写 `deferredReason`。不要为了让矩阵好看而强行 `live`。
4. 给 catalog 测试 `harness-capability-contract.test.ts` 加新 Runtime 的 drift 断言：
   - 工具名一致性（fixture 中的 tool schema 名字 vs catalog 声明）
   - 系统提示来源（仍以 `systemPromptFragment` 为准；新 Runtime 不准 paraphrase）

**禁止**：

- 不要给新 Runtime 加 `notes`-based 例外。`live` 要么严格满足要么降级，**不允许"notes 说部分可用"**。
- 不要为了让某能力 live 而暴露不打算长期支持的工具。先 `deferred` 起步是诚实的。

**完成准则**：catalog drift 测试在新 Runtime 下全绿；deferred 列表里的每条都有具体 `deferredReason` + 计划。

---

### Step 3 — Runtime Adapter Facade

**目标**：在 `runtime-adapter.ts` 加 `adaptForXxx` facade；新 Runtime 入口**只**消费 facade 输出。

操作：

1. 给 `context-compiler.ts` 的 `runtimeHints` 加新 Runtime 的 hint 类型（参考 `ClaudeCodeHints` / `NativeHints` / `CodexProxyHints`）。**严格遵守**：
   - 只能放 IDs / refs / 适配器选项。
   - 禁止 prose、template literal、tool schema paraphrase。
   - 跑 `harness-context-compiler.test.ts` 的 runtimeHints 边界测试确认。
2. 在 `runtime-adapter.ts` 加 `adaptForXxx(input: RuntimeAdapterInput): XxxAdapterOutput`：
   - 输出**必须**包含一个 string 字段（系统提示），即使空也用 `''`，不要 `undefined`。
   - 输出**必须**含 toolNames / suppression set / step ceiling 等 Runtime-specific 适配选项。
3. 写 Runtime 实际 SDK adapter（如果新 Runtime 是 stream-based，类似 `sdk-runtime.ts` / `native-runtime.ts`）。它**只**调 `adaptForXxx`，**不**直接调 `compileContext`。
4. 在 `harness-runtime-adapter.test.ts` 加新 facade 的 4 项 pin：
   - 空 enabled 集合 → 空 prompt + 空 hint 集合
   - 单个能力 enabled → prompt 非空 + 对应 toolNames 出现
   - 跨 Runtime fragment text 同源（与现有三个 facade 字节相等）
   - **Entry-point cleanliness**：新 Runtime 入口文件 `grep compileContext` 应当返回 0 行（必须经过 facade）

**禁止**：

- 不允许在 Runtime 入口直接 `import { compileContext }`。Facade 是单一通道。
- 不允许新 Runtime 自己维护 `WIDGET_PROMPT` / `MEDIA_PROMPT` 这类标量。Phase 2 review 拆了 Codex bridge 的四个 _PROMPT 标量，是结构性禁忌不可再犯。
- 不允许新 Runtime 自己拼 system prompt。所有 capability 文本必须来自 facade。

**完成准则**：`harness-runtime-adapter.test.ts` 全绿；新 Runtime 入口源 grep 无 `compileContext`。

---

### Step 4 — Artifact Contract（如果新 Runtime 产新 artifact）

**目标**：每种"前端能渲染的产物"在 `ARTIFACT_CONTRACTS` 里都有一条登记。

判断方向：

- 新 Runtime 只产现有 artifact（widget / media / markdown / html / diff / json / table / error）？→ 不用加新 entry，确认 fixture 里产的 fence/SSE/PreviewSource 格式和现有协议一致。
- 新 Runtime 产新类型 artifact（例如 Gemini Live 的实时音频流）？→ 必须先加 `ARTIFACT_CONTRACTS` entry + parser/renderer 模块路径 + canonicalExample。**先有 contract，再写 parser**，不能反过来。

操作：

1. 打开 `src/lib/harness/artifact-contract.ts`。
2. 加 `ArtifactContract` entry：
   - `source` / `sourceDescriptor`（fence / sse_event / preview_source）
   - `parser` + `renderer` 模块路径
   - `canonicalExample`：能被 parser round-trip
3. 加测试 `harness-artifact-contract.test.ts` 项：
   - 解析 canonicalExample 不报错
   - 渲染组件 export 名能 grep 到
   - 跨 capability 一致性（如果新 artifact 关联到 capability）

**禁止**：

- 不要让新 Runtime "自己定义" widget JSON 形状的变种。`show-widget` 的 JSON wire 是系统级单源，不可分叉。
- 不要在新 Runtime 入口直接 emit 没登记的 fence 语言。

**完成准则**：`harness-artifact-contract.test.ts` 全绿；renderer 在前端真实可达（grep PreviewPanel.tsx / MessageItem.tsx 的 switch arm）。

---

### Step 5 — Contract Tests Gate（在跑真实凭据之前）

**目标**：在跑任何 live smoke 之前，先把 contract 全部跑过。

跑这一组（不需要任何凭据）：

```bash
CODEX_DISABLED=1 npx tsx --test \
  src/__tests__/unit/harness-capability-contract.test.ts \
  src/__tests__/unit/harness-context-compiler.test.ts \
  src/__tests__/unit/harness-context-compiler-equivalence.test.ts \
  src/__tests__/unit/harness-runtime-adapter.test.ts \
  src/__tests__/unit/harness-artifact-contract.test.ts
```

全绿才允许进入 Step 6。

**禁止**：

- 不要因为"smoke 反正没跑"就跳 contract。Phase 5c 的三天连环救火就是因为先跑 smoke 才发现 capability 没声明全。
- 不要把 contract 测试加 expected-differences ledger 来"放过" `unsupported` 的能力。`live` 意味着每个声明的 toolName 都能调通，零例外。

**完成准则**：以上 5 个 test 文件全绿；`npm run test` 总体全绿。

---

### Step 6 — Smoke Matrix（固定 9 项，零自由发挥）

**目标**：覆盖 CodePilot 所有 Harness 能力面的真实凭据 smoke。

固定矩阵——少一项即视为新 Runtime 未发布资格：

| # | 场景 | 验证点 |
|---|---|---|
| S1 | 普通一轮聊天 | 文本回复 + canonical event 序列正常 |
| S2 | 两轮 resume | session/thread token 持续 + 上下文未截断 |
| S3 | 文件读写 / file_changed | tool_started → tool_completed → file_changed SSE 顺序 |
| S4 | 权限请求 | permission_request SSE 在 UI 可交互 |
| S5 | 图片生成 / media render | `tool_result.media` MediaBlock → MediaPreview 渲染 |
| S6 | Widget | `show-widget` fence → parseAllShowWidgets → WidgetRenderer 渲染（不进 malformed） |
| S7 | Memory | `codepilot_memory_recent` 首轮触发 + 结果接着推理 |
| S8 | Tasks / notification | `codepilot_schedule_task` 创建 + tick 后实际触发通知 |
| S9 | Agent native tool passthrough | Runtime 自带的 tool（如 Codex 的 shell / namespace）能从 UI 看到结果（passthrough，不是 CodePilot 桥接） |

**禁止**：

- 不要"为了通过 S6 而调整 parseAllShowWidgets"。Parser 是固定的；调整必须是新 Runtime 入口 emit 正确的 fence。
- 不要把 smoke 失败原因总结成"模型行为不一致"。如果模型确实不一致，记录在 expected-differences ledger 里并 `plannedResolution: 'follow_up'`，不掩盖。
- 不要在 smoke 失败后立刻改代码。先回头看：是 contract 没覆盖？是 fixture 抓错？只有原因明确才改。

**完成准则**：9/9 全绿。失败的一项要么修到通过、要么明确 deferred（capability 矩阵改为 `deferred`，并附 `deferredReason`）。

---

### Step 7 — UI 可见性收口

**目标**：Runtime Selector + Settings 必须**真实**反映新 Runtime 的能力矩阵。

操作：

1. 在 `src/lib/runtime/registry.ts` 注册新 Runtime（参考 `sdkRuntime` / `nativeRuntime` 接入方式）。
2. 在 Settings → Runtime / Models 卡片更新展示：新 Runtime 列出哪些 capability `live` / `deferred` / `unsupported`，每条 deferred 显示 `deferredReason`。
3. 不允许在 UI 上说"能用"而真实是 deferred。

**完成准则**：用户选了新 Runtime，UI 显示的能力清单和 catalog 字节一致。

---

## 必须避免的反模式

下面这些是 Phase 5c 救火期间真实发生过的——请确保不再发生：

1. **Live-smoke-driven patching**：smoke 报错就补字段。新 Runtime 接入禁止这条路径。失败必须先映射到 contract / catalog / fixture 的具体缺口，再修。
2. **Speculation 当 source-of-truth**：根据"应该这样"写实现，没有 fixture 支撑。Step 1 强制 fixture-first。
3. **同概念三份独立实现**：`WIDGET_PROMPT` 在 MCP / Native / bridge 三份各自漂移。新 Runtime 不准维护自己的 prompt 标量；走 Adapter facade。
4. **机器读不通的人写示例**：widget canonicalJson 用 `\\\"` 双重转义模型抄不通——已修。新 artifact 的 canonicalExample 必须 `JSON.parse` 通过 + 通过 parser。
5. **错误静默掉**：parser 收到 malformed fence 静默丢弃。Phase 5d 之后必须显式渲染 `malformed_*` 块。
6. **catalog 用 notes 含糊"部分支持"**：`live` 必须所有 toolName 全活；想表达"部分"用 `deferred`，**不**用 `live + notes`。
7. **越级改 provider proxy translator**：Phase 5d 不再扩 provider proxy 主逻辑。如果新 Runtime 需要 Anthropic-compat 但有微调，先看是否能在 adapter facade 解决；只有翻译层真的差异才碰 provider proxy。

---

## 文件改动清单（参考）

接入一个新 Runtime 大致触及：

```
src/lib/harness/capability-contract.ts       # Step 2 — RuntimeExposure 新增
src/lib/harness/harness-bundle.ts            # Step 3 — runtime 通过 buildHarnessBundle 消费
src/lib/harness/capability-matrix.ts         # Step 7 — Settings 派生（新 RuntimeId 进 ALL_RUNTIMES）
src/lib/harness/mutation-level.ts            # Step 5 — 新 capability 工具加 mutationLevel
src/lib/harness/context-compiler.ts          # Step 3 — runtimeHints 新增
src/lib/harness/runtime-adapter.ts           # Step 3 — adaptForXxx facade
src/lib/harness/artifact-contract.ts         # Step 4 — 新 artifact（如有）
src/lib/runtime/<xxx>-runtime.ts             # Step 3 — AgentRuntime adapter
src/lib/runtime/registry.ts                  # Step 7 — 注册
src/components/settings/RuntimeCapabilityList.tsx  # Step 7 — 新 RuntimeId 自动派生
src/__tests__/unit/harness-*.test.ts         # Step 5 — pin
docs/research/<xxx>-protocol-fixtures.md     # Step 1 — schema snapshot
docs/exec-plans/active/phase-5d-<xxx>.md     # Step 0/1 — 计划
docs/handover/<xxx>-runtime.md               # 接完后写
docs/insights/<xxx>-runtime.md               # 接完后写
```

---

## Phase 5e Harness Architecture checklist（接入前必填）

Phase 5e 把 Harness 分成三层（Built-in / User CodePilot / External Framework）+ 引入 `HarnessBundle` 单一输入信封 + mutationLevel tool 分级 + Settings 能力清单。接入新 Runtime 前必须能回答下面每一条：

### 1. HarnessBundle mapping

- 新 Runtime 是否消费 `buildHarnessBundle()` 作为 turn 输入？（不允许各自再拼一份 prompt + tool surface）
- `BuiltinCapabilityMount.exposureKind` 在新 Runtime 下是 `mcp_server` / `ai_sdk_tool` / `bridge_executable` 中哪一个？
- 哪些能力是 `executable=false` + `perceptionHint`？每条 perceptionHint 必须告知用户切到哪个 Runtime 可执行。
- User CodePilot Harness（Settings MCP / Skills / project CLAUDE.md）在新 Runtime 下是否真实可调用？不能调用就 `executable=false` + hint。
- External Framework Harness 至少要**感知**——即便不能跨框架执行 ClaudeCode 的 MCP，Settings + 模型必须能列出它存在 + 提示切到 ClaudeCode Runtime。

### 2. Capability matrix derivation

- 新 RuntimeId 加入 `ALL_RUNTIMES`（capability-matrix.ts）；`exposureKey()` switch 加一行。
- 每条 capability 在 capability-contract 的 `exposure` 加新 RuntimeId 字段；live 必须真实 mount 工具，否则降级 deferred + `deferredReason`。
- 跑 `harness-capability-matrix.test.ts` — 测试自动覆盖每条 cell 的 statusLine / toolNames / suggestedRuntime / 反向 deferred 不可执行不变量。
- Settings UI（`RuntimeCapabilityList.tsx`）会自动渲染新 Runtime 卡片，无需额外改 UI。

### 3. Permission mapping (mutationLevel)

- 新 Runtime 的每个 CodePilot tool 必须在 `CODEPILOT_TOOL_MUTATION_LEVELS` 表里有分级：`safe_read` / `mutating_local` / `mutating_external` / `side_effect`。
- 未分级的 tool 默认走 ask（fail-safe）；`mutation-level-contract.test.ts` 会自动断言完整性。
- 新 Runtime 的 permission UI 路径必须能接 `permission_request` SSE event（参考 ClaudeCode SDK / Native / Codex bridge 的实现）。
- approval idempotency：重复 RPC 同 id 不能创建双 UI prompt（参考 `approval-bridge.ts` 的 short-circuit 模式）。

### 4. Artifact contract

- 新 Runtime 产生的 artifact（widget fence / MediaBlock / DiffSummary / inline-html / ...）必须能 round-trip 通过 `ARTIFACT_CONTRACTS` 的 parser/renderer pair。
- 新 artifact 类型必须先在 `artifact-contract.ts` 登记 + 加 `harness-artifact-contract.test.ts` pin，再写 parser。
- MediaBlock 走 `harness/builtin-event-bus.ts` side-channel（Codex bridge / Native 共用），不绕开。

### 5. Settings visibility

- 用户进 Settings → Runtime 卡片下方能看到新 Runtime 的能力清单（自动派生）。
- 不可执行能力必须显示 ✗ + 原因 + 替代 Runtime（B-Settings 变体；**不在** chat 主页打扰）。
- 切 provider 时如果某 provider 路径不能挂 CodePilot bridge（参考 Codex Account），必须通过 `capabilityMatrixForRuntimeProvider(runtimeId, providerId)` 显式降级，不能假装能用。

### 6. Smoke matrix（不可裁剪）

固定 9 项 + Phase 5e 新增 4 项（External Harness 跨框架感知 / Codex Account 降级 / Native MediaBlock side-channel / mutationLevel 拒绝静默 shell exec）。详见 `docs/exec-plans/completed/phase-5e-runtime-harness-architecture.md` Smoke Matrix 段。

---

## 反模式（5 条，必须避免）

下面这些是过往 Codex 救火期间真实发生过——Phase 5e 把它们正式禁止：

1. **live-smoke-driven patching** —— smoke 跑挂就补 prompt / 字段。任何接入失败必须先映射到 contract / catalog / fixture 缺口，再修。Phase 5e 加 `HarnessBundle` 类型层让"缺 perceptionHint"成为 builder throw，不再是 smoke 才发现。
2. **prompt-only 假装接入** —— 在 system prompt 里告诉模型"你能调 widget"但 Runtime 实际没 mount widget tool。Phase 5e 后这种状态不再可能：matrix 自动把 unsupported 暴露标 perception_only，工具名不再注入。
3. **parser 放宽掩盖工具没注入** —— 接受 malformed widget fence、放宽 JSON parser 让"看起来能渲染"。Phase 5e 后 capability-contract.canonicalJson + artifact-contract round-trip 测试不允许这样做。
4. **读取对方 auth/config 绕协议** —— 读 `~/.codex/auth.json` / `~/.claude/auth.json` 直接拿 OAuth token 绕开协议。Phase 5e `external-framework-harness.ts` 显式禁止 — `FORBIDDEN_FILENAME_PATTERNS` 拒绝 `auth.json` / `*.token` / `*credentials*` / `*.key`。
5. **每个 runtime 自己拼一套 prompt/tool copy** —— ClaudeCode 一份 widget prompt、Codex bridge 又一份、Native AI SDK 又一份。Phase 5d 已经收敛到 `context-compiler.ts` + `capability-contract.ts` 单一来源；Phase 5e `HarnessBundle` 把 user + external 也纳入同一信封。新 Runtime 接入禁止 fork 出第四份。

如果改了 provider proxy translator（`src/lib/codex/proxy/*` 或同等 `provider-proxy-bridge.md` 描述的 8 hook），请同步更新 `docs/handover/provider-proxy-bridge.md` 的 smoke 矩阵。

---

## 决策日志

- **2026-05-17**：Playbook 落地（Phase 5d Phase 5）。这之前没有显式 "fixture → catalog → adapter → contract → smoke" 顺序文档；Codex 接入时把顺序当成自由发挥的结果。后续接入按这份硬约束走。
- **2026-05-17**：选择写"硬性顺序"而不是"建议"。Phase 5c 已经证明软建议会被 smoke 压力倒推。playbook 措辞使用"禁止 / 必须"是有意的。
- **2026-05-17**：Step 5 "Contract Tests Gate" 在 Step 6 smoke 之前是结构性的——它锁定 `feedback_no_live_smoke_driven_patching` 反模式。任何把 contract 移到 smoke 之后的提案都需要明示推翻这条反模式记录。
