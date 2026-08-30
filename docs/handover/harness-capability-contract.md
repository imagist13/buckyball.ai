# Harness Capability Contract

> 产品思考见 [docs/insights/harness-capability-contract.md](../insights/harness-capability-contract.md)
> 执行计划：[docs/exec-plans/completed/phase-5d-harness-capability-contract.md](../exec-plans/completed/phase-5d-harness-capability-contract.md)
> 相关：[docs/handover/codex-tool-bridge.md](./codex-tool-bridge.md)（Phase 5c Codex bridge 实现）/ [docs/handover/provider-proxy-bridge.md](./provider-proxy-bridge.md)（Codex Responses proxy 协议层）

## 这层做什么

把 CodePilot 自有能力（Memory / Tasks / Widget / Media / Notify / Dashboard / CLI tools）的**跨 Runtime 行为契约**钉死成单一来源，让 ClaudeCode SDK Runtime / Native Runtime / Codex Runtime 看到的同一个 CodePilot 能力是真的同一个能力，不是三份漂移的实现。

不替换现有 MCP 服务器、AI SDK tools 或 Codex bridge factory；只声明它们必须满足的契约 + 用测试守住。

## Context Compiler（Phase 5d Phase 2，2026-05-17）

`src/lib/harness/context-compiler.ts` 是单一纯函数 `compileContext(input): CompiledContext`，三个 Runtime 都通过它读取本轮应该注入什么。

**输入**：`{ sessionId, workingDirectory, runtimeId, providerId, model, userPrompt, enabledCapabilities, assistantMemory?, permissionProfile?, tokenBudget, flags? }`。Compiler 不做 IO；assistantMemory 等动态内容由调用方预取后传入。

**输出**：`{ basePrompt, capabilityFragments, artifactContracts, memoryFragments, workspaceFragments, toolDescriptors, runtimeHints, budget, systemPromptText, diagnostics }`。

**硬约束**：
- artifactContract 在 capabilityFragments **之前**（避免长 prompt 末尾丢失 wire format）
- 每个 `fragmentId` 在 CompiledContext 中只能出现一次
- 同一 `fragmentId` 在不同 RuntimeId 下编出来的 `text` 严格相等
- 若 capability fragment 的 text 内含 artifact contract 的 `canonicalJson`，编译失败（防止 wire-format 在 final prompt 中出现两次 — slice 2c 已经 strip 了 `WIDGET_SYSTEM_PROMPT` 的内嵌 spec，artifactContract 是唯一 wire-format 持有者）
- `runtimeHints` 只放 IDs / refs / 适配器选项，禁止 prose / tool schema paraphrase

**三 Runtime 怎么消费（全部通过 `compileContext`）**：

- **ClaudeCode SDK Runtime** (`src/lib/claude-client.ts`)：MCP server 注册（transport 层）按既有 gating 逻辑跑（workspace / keyword / always）；每命中一类，capability id 加入 `enabledCapabilities` Set。所有 MCP server 注册完之后调一次 `compileContext({ runtimeId: 'claude_code', enabledCapabilities, ... })`，把 `compiled.systemPromptText` 追加到 `queryOptions.systemPrompt.append`。**slice 2c 后再无 per-capability `+ _SYSTEM_PROMPT` 内联拼接**。
- **CodePilot Native Runtime** (`src/lib/builtin-tools/index.ts getBuiltinTools()`)：per-group condition（always / workspace / { keywords }）仍由该函数决定；命中后通过 `capabilityIdForGroup(group.name)` 映射到 capability id 进 `enabledCapabilities`；末尾调 `compileContext({ runtimeId: 'codepilot_runtime', enabledCapabilities, ... })`，`compiled.systemPromptText` 作为 `systemPrompts[0]` 返回。session-search / ask-user-question 等未入 capability contract 的 group 仍按 raw `group.systemPrompt` 进入后续 entries。
- **Codex Runtime bridge** (`src/lib/codex/proxy/unified-adapter.ts` + `builtin-bridge.ts`)：bridge 自身不持有 `_PROMPT` 标量（slice 2e 删除）。`createCodePilotBuiltinTools().systemPrompt` 恒为 `''`。`unified-adapter` 按 **bridge mount → translateResponsesTools → compileContext → bodyWithBridgePrompt → buildMessages(bodyWithBridgePrompt)** 这个顺序跑，让 `compiled.systemPromptText` 通过 `body.instructions` 进入 `messages[]` 的 role:system 槽位（这样 Anthropic-compat / CodePlan / chat-completions 路径也能看到 capability prompt，不再只走 OpenAI Responses 的 `providerOptions.openai.instructions`）。`enabledCapabilities` 由 `capabilitiesFromBridgeToolNames(bridge.toolNames)` 反推，跟 bridge 真实 mount 的工具集对齐。

**Expected Differences Ledger**（`src/lib/harness/expected-differences.ts`）：

是 2b 等价测试的白名单，登记 Compiler 输出与某 Runtime 当前 implementation 之间的合理差异。slice 7b 引入时初始 4 条；slice 2d 消化掉三条 Native paraphrase 后只剩 1 条 `image_generation` MediaBlock 的 `follow_up`（Native 的 image_generation 还返回 text，没构造 MediaBlock；属于 tool-result shape 问题，不是 prompt drift，slice 后续 follow_up）。

**测试覆盖**：

- `harness-context-compiler.test.ts`（23 pins）：catalog hygiene、widget wire-format 单源（#10）、ordering、budget、cross-runtime fragment text identity、tool descriptors、runtimeHints boundary（#11 — 类型层 + 运行时层 + source-grep）、ledger 一致性（#12）
- `harness-context-compiler-equivalence.test.ts`（9 pins）：compilerSource / runtimeSource 文件可读 + export 可静态发现、capability_fragment_replaced 真有 drift、ledger ↔ slice ownership 对齐
- `harness-capability-contract.test.ts` 增量：bridge 不再持有 _PROMPT 标量、Native 三文件 re-export canonical、ClaudeCode source-pin

## Runtime Capability Adapter（Phase 5d Phase 3，2026-05-17）

`src/lib/harness/runtime-adapter.ts` 是三个 Runtime 入口的**唯一**编译器消费通道。把 Phase 2 留在三处的 "构造 CompilerInput → 调 compileContext → 解包 runtimeHints / systemPromptText" 模板代码合并成三个 facade：

| Facade | 用于 | 输出关键字段 |
|---|---|---|
| `adaptForClaudeCode(input)` | `claude-client.ts` MCP 注册分支末尾 | `systemPromptAppend` / `mcpServerNames` / `allowedToolNames` / `compiled` |
| `adaptForNative(input)` | `builtin-tools/index.ts getBuiltinTools()` 末尾 | `systemPromptText` / `toolSetKeys` / `compiled` |
| `adaptForCodexProxy(input)` | `codex/proxy/unified-adapter.ts` bridge mount 之后 | `systemPromptInstructions` / `builtinToolNames` / `stopWhen` / `stepCount` / `compiled` |

**结构性不变量**（由 `harness-runtime-adapter.test.ts` + `harness-capability-contract.test.ts` source-grep 守护）：

1. **Entry-point cleanliness**：`claude-client.ts` / `builtin-tools/index.ts` / `unified-adapter.ts` 三个入口文件 grep `from '@/lib/harness/context-compiler'` 必须返回 0 行；只能通过 `runtime-adapter` 进入编译器。
2. **String-always shape**：facade 输出的 systemPrompt 字段恒为 string（空集时为 `''`，非空集时为完整文本）。这把 Phase 2 review 暴露的 "capability prompt 仅在 caller 有 base systemPrompt 时才注入" 漂洞钉死成类型层约束——caller 只能 `length > 0` 判断后注入，不能再走 `&& queryOptions.systemPrompt` 之类的隐式 short-circuit。
3. **Native codepilot-media 双 capability**：`builtin-tools/index.ts` `capabilityIdsForGroup('codepilot-media')` 必须返回 `['media_import', 'image_generation']`；source-grep + runtime check 双重 pin（slice 2d P1 修复点）。
4. **Codex 步骤上限单源**（Phase 3 review fix #1）：`unified-adapter.ts` 不准声明本地 `BUILTIN_BRIDGE_STEP_LIMIT` 常量；`PathInput.stopWhen / stepCount` 由 `adapted.stopWhen / stepCount` 喂入。Runtime catalog 的 suppression hint 仍用 `adapted.builtinToolNames`；此外必须合并 adapter 内真实执行的 `bridge.toolNames` / hosted tool names，避免未进入 capability catalog 的 spawn 等调用泄漏回 app-server。常量本身搬到 `context-compiler.ts` 的 `CODEX_BRIDGE_STEP_LIMIT`。

**Phase 3 测试覆盖**（`harness-runtime-adapter.test.ts`，34 pins，含 Phase 3 review fix #1 单源 pin）：

- 三 facade 的 shape contract（每个字段类型 + 非空集 → 非空 / 空集 → empty）
- Phase 2 review invariant 重测（string-always + Native 双 capability mapping）
- 跨 Runtime fragment text identity（widget + 所有 live cross-runtime-supported capability 字节相等）
- Entry-point cleanliness source-grep（compileContext 直引必须为 0）
- **Codex 步骤上限单源 pin**（Phase 3 review fix #1）：`unified-adapter.ts` 无本地 `BUILTIN_BRIDGE_STEP_LIMIT`；`streamPath` / `nonStreamPath` 接 `adapted.stopWhen / stepCount / builtinToolNames`；adapter 内执行工具通过独立 `providerExecutedToolNames` 传入并与 catalog hint 合并；`context-compiler.ts` 持有唯一常量 `CODEX_BRIDGE_STEP_LIMIT = 8`

## Artifact Contract（Phase 5d Phase 4，2026-05-17）

`src/lib/harness/artifact-contract.ts` 把"前端能渲染哪些产物"声明成单一 registry。每个 artifact 列出 source（fence / SSE / PreviewSource）+ parser 模块 + renderer 模块 + canonical example。这一层和 `capability-contract.ts` 的 `artifactContract` 字段**正交但补充**：

- `capability.artifactContract`：模型 prompt 端 — model 怎么 emit。仅 widget 使用。
- `ARTIFACT_CONTRACTS`：渲染端 — 前端怎么 parse + render。覆盖 9 种产物。

**当前 artifact 矩阵**（`HARNESS_CAPABILITIES` 之外的渲染面统一登记 — 11 条；Phase 3 review fix 把 diff 拆成 sse / preview_source 两条，补回缺失的 inline_jsx）：

| Artifact | Source | Source descriptor | Parser 模块 | Renderer | Related capabilities |
|---|---|---|---|---|---|
| widget | fence | `show-widget` | `MessageItem.tsx parseAllShowWidgets` | `WidgetRenderer.tsx` | `[widget]` |
| malformed_widget | fence | `show-widget`（解析失败分支） | 同上 parser | `MessageItem.tsx MalformedWidgetNotice` | `[widget]` |
| media | sse_event | `tool_result.media` | `useSSEStream.ts case 'tool_result'`（inline） | `MediaPreview.tsx` | `[image_generation, media_import]` |
| file_diff_summary | sse_event | `file_changed` | `useSSEStream.ts case 'file_changed'`（inline） | `DiffSummary.tsx` | `[]` |
| inline_diff | preview_source | `inline-diff` | `usePanel.ts PreviewSource` | `DiffViewer.tsx` | `[]` |
| inline_jsx | preview_source | `inline-jsx` | 同上 | `SandpackPreview.tsx`（PreviewPanel inline-jsx arm 内 mount） | `[]` |
| markdown | preview_source | `inline-markdown` | 同上 | `PreviewPanel.tsx` | `[]` |
| html | preview_source | `inline-html` | 同上 | `PreviewPanel.tsx`（+ `injectInlineHtmlCsp`） | `[]` |
| json | preview_source | `inline-json` | 同上 | `JsonTreeViewer.tsx` | `[]` |
| table | preview_source | `inline-datatable` | 同上 | `PreviewPanel.tsx` 内联 arm | `[]` |
| error | component | `<component>` | `error-banner.tsx`（组件驱动） | `ErrorBanner` | `[]` |

**结构性不变量**（由 `harness-artifact-contract.test.ts` 守护）：

1. 每条 contract 的 parser/renderer 模块文件在磁盘真实存在；非 inline export 名能 grep 到。
2. fence-source artifact 的 `fenceLanguage` 必须在 parser 模块文件里 mention（防止 fence 名漂走 parser 仍然指旧名）。
3. SSE-source artifact 的 `eventType` 必须在 parser 模块的 `case 'xxx':` arm 出现。
4. preview_source artifact 的 `previewKind` 必须是 `usePanel.ts` `PreviewSource` 联合类型声明过的 kind。
5. **PreviewSource union 完整性**（Phase 3 review fix）：`usePanel.ts` `PreviewSource` 中声明的**每个** `inline-*` kind 都必须有 ARTIFACT_CONTRACTS entry。下次有人加 `inline-foo` arm 但忘记登记，测试会先于用户看到失败。
6. canonical example 能 round-trip：widget 解析得到 `widget` segment、malformed_widget 解析得到 `malformed_widget` segment、json JSON.parse 成功、markdown 非空、html 含 HTML tag、inline_diff 含 `---/+++/@@` unified-diff 标记、inline_jsx 含 JSX 标签。
7. widget 的 `canonicalExample`（剥掉 fence 包装后）字节等于 capability contract 的 `CANONICAL_SHOW_WIDGET_JSON`。
8. capability.artifactContract 中声明的 fenceLanguage 必须能在 ARTIFACT_CONTRACTS 找到对应 entry。
9. **多 capability artifact**（Phase 3 review fix P2）：`relatedCapabilities` 是数组；`artifactsForCapability(id)` 用 `.includes(id)` 检索，所以 `media` 在 `image_generation` 和 `media_import` 两个 capability 下都能解析。

**Phase 4 测试覆盖**（`harness-artifact-contract.test.ts`，22 pins）：catalog hygiene、fence/SSE/preview source descriptor 静态对齐、PreviewSource union 完整性、canonical example round-trip（含 inline_diff / inline_jsx）、widget 跨表 byte-identical、capability ↔ artifact 一致性（含 media 双 capability 解析）、`isFileChangedDetail` 实际可调用。

## New Runtime Playbook（Phase 5d Phase 5，2026-05-17）

接入下一个 Agent Runtime（Hermes / Gemini Live / OpenClaw / 其他）的**硬性流程**写在 [docs/handover/new-runtime-playbook.md](./new-runtime-playbook.md)。要点：

- Step 0 决定走 Provider 还是 Runtime（GLM / Kimi 这种无 agent loop 的不应该当 Runtime）
- Step 1 Schema snapshot 抓 fixture 入 repo，禁止 speculation-driven
- Step 2 Capability inventory 加 `RuntimeExposure`，严格 live 定义
- Step 3 Runtime Capability Adapter facade（新 Runtime 入口禁止直引 compileContext）
- Step 4 Artifact Contract（如有新 artifact）
- Step 5 **Contract Tests Gate**：5 个 harness-*.test.ts 全绿才允许进 Step 6
- Step 6 固定 9 项 Smoke Matrix（不允许自由发挥）
- Step 7 UI 可见性收口

Playbook 禁止 live-smoke-driven patching 作为开发主流程；Step 5 是结构性卡口。

## 三层模型

每个能力按三层定义：

| 层 | 内容 | 如何固定 |
|---|---|---|
| Tool schema | 工具名、参数 schema、描述 | 各 Runtime 的 factory 函数（MCP / AI SDK tool / bridge tool）继续保留实现；契约声明 `toolNames`，drift 测试断言这些名字真的注册了 |
| Context instruction | system prompt fragment（capability 文本提示） | 单一权威文件持有完整 fragment；另外两个 Runtime 通过 TS import 引用同一常量，禁止改写 |
| UI artifact contract | tool 结果格式 + canonical 事件 + 前端渲染路径 | 契约声明 `toolResultShape` / `canonicalEventTypes` / `uiRenderPath` / 可选 `artifactContract`；renderer 与契约由 contract test 校验 |

Widget 的 `show-widget` JSON 示例需要 round-trip 校验：契约持有 `canonicalJson`，测试用 `JSON.parse` 解开，再喂给 `parseAllShowWidgets` 必须返回一个 `widget` segment（不是 `malformed_widget`）。

## 文件总览

| 文件 | 角色 |
|---|---|
| `src/lib/harness/capability-contract.ts` | 唯一目录。每个能力一个 `CapabilityContract` 条目，导入并暴露权威 prompt fragment + 三 Runtime 暴露方式。 |
| `src/lib/widget-guidelines.ts` | Widget 权威源。`WIDGET_SYSTEM_PROMPT` / `WIDGET_WIRE_FORMAT_SPEC` / `CANONICAL_SHOW_WIDGET_JSON` 在这里；Native + Codex bridge 通过 import 消费。 |
| `src/lib/memory-search-mcp.ts` | Memory 权威源 (`MEMORY_SEARCH_SYSTEM_PROMPT`)。 |
| `src/lib/notification-mcp.ts` | Tasks + Notify 权威源 (`NOTIFICATION_MCP_SYSTEM_PROMPT`)。 |
| `src/lib/builtin-tools/media.ts` | 媒体（image gen + import）权威源 (`MEDIA_SYSTEM_PROMPT`)。MCP 端没有等价文件 — tech-debt：未来补 `media-mcp.ts` 让它和其它能力同形。 |
| `src/lib/dashboard-mcp.ts` | Dashboard 权威源 (`DASHBOARD_MCP_SYSTEM_PROMPT`)。Codex bridge 未实现，状态 `deferred`。 |
| `src/lib/builtin-tools/widget-guidelines.ts` | Native Runtime widget。re-export 权威 prompt，不再持有 abridged 副本。 |
| `src/lib/codex/proxy/builtin-bridge.ts` | Codex Runtime bridge。`WIDGET_PROMPT = CANONICAL_WIDGET_SYSTEM_PROMPT`（slice 7 修过的最小漂移点）。 |
| `src/__tests__/unit/harness-capability-contract.test.ts` | 契约测试套。catalog 完整性 / 工具名一致性 / drift 检测 / Widget JSON round-trip / 媒体 render path / 状态分类。 |

## 当前能力矩阵

由 `HARNESS_CAPABILITIES` 数组持有；如下表是 2026-05-16 slice 7 状态。任何更新先改契约 + 跑测试，不要直接改 MCP / Native / bridge。

| Capability | Status | Tool names | ClaudeCode SDK | Native | Codex Proxy | 备注 |
|---|---|---|---|---|---|---|
| widget | live | `codepilot_load_widget_guidelines` | MCP `createWidgetMcpServer` | AI SDK `createWidgetGuidelinesTools`（re-export 权威 prompt） | bridge `buildWidgetGuidelinesTool`，`WIDGET_PROMPT = canonical` | slice 7 de-drifted；artifact contract = `show-widget` fence，JSON.parse-safe 示例 |
| memory | live | `codepilot_memory_recent`、`codepilot_memory_search`、`codepilot_memory_get` | MCP `createMemorySearchMcpServer` | AI SDK `createMemorySearchTools`（仍有 prompt drift） | bridge `buildMemoryRecentTool` / `buildMemorySearchTool` / `buildMemoryGetTool` | workspace-gated；Native + bridge prompt 与 MCP 仍漂移，slice 8 tech-debt |
| tasks_and_notify | live | `codepilot_notify`、`codepilot_schedule_task`、`codepilot_list_tasks`、`codepilot_cancel_task` | MCP `createNotificationMcpServer` | AI SDK `createNotificationTools` | bridge `buildNotifyTool` / `buildScheduleTaskTool` / `buildListTasksTool` / `buildCancelTaskTool`（全部 4 个 mount） | slice 4 已修 durable / list / cancel parity；slice 7b 把 `codepilot_hatch_buddy` 拆到 `assistant_buddy` capability |
| assistant_buddy | deferred | `codepilot_hatch_buddy` | MCP `createNotificationMcpServer`（同源 MCP server） | AI SDK `createNotificationTools` | unsupported — bridge 未挂载；Codex Runtime 用户切到 ClaudeCode / Native 触发 hatch | slice 7b 新增；hatch buddy 在 bridge 的归属（Harness capability vs assistant workspace flow）待 Phase 2-3 拍板 |
| image_generation | live | `codepilot_generate_image` | MCP `createImageGenMcpServer`（通过 MEDIA_RESULT_MARKER 注入 SSE media） | AI SDK `createMediaTools` (image key)（仅返回文本，无 MediaBlock — drift tech-debt） | bridge `buildImageGenerationTool`（带 MediaBlock + materialize） | slice 2 + 4 已修 |
| media_import | live | `codepilot_import_media` | MCP `createMediaImportMcpServer`（owns MEDIA_MCP_SYSTEM_PROMPT；claude-client.ts 注册为 `codepilot-media`） | AI SDK `createMediaTools` (import key) | bridge `buildImportMediaTool`（slice 4 已按 mimeType 推断 type） | slice 7b 修正 — 早期把 ClaudeCode SDK 错标 unsupported，真实有 MCP 实现 |
| dashboard | deferred | `codepilot_dashboard_*` ×5 | MCP `createDashboardMcpServer` | AI SDK `createDashboardTools` | unsupported — 写操作需要 bridge permission round-trip 设计 | Phase 5d Phase 3 之后再开 |
| cli_tools | deferred | `codepilot_cli_tools_*` ×6 | MCP `createCliToolsMcpServer` | AI SDK `createCliToolsTools` | unsupported — install/update/remove 需要 permission 契约 | 同上 |

## 契约测试都测什么

`harness-capability-contract.test.ts` 锁定的不变量：

1. **Catalog hygiene** — 每个 entry 字段齐全；id 唯一；非 live 必须有 `deferredReason`。
2. **严格 live 语义（slice 7b）** — `status === 'live'` 必须**所有声明 runtime exposure 都不是 `unsupported`**。任何"live 但某 runtime unsupported"的混合口径都自动 fail；要么把 unsupported runtime 实现掉，要么把 status 改成 `deferred`，要么拆 capability。
3. **Tool-name agreement** — live capability 声明的工具名必须在至少一个 wired 文件源中出现。
4. **Bridge drift 严格检测** — bridge `WIDGET_PROMPT` 必须是 `CANONICAL_WIDGET_SYSTEM_PROMPT` 的 import + 直接赋值；Native widget 同样必须 re-export 权威。
5. **Widget JSON round-trip** — 契约里的 `canonicalJson` 走 `JSON.parse` 不抛；走 `parseAllShowWidgets` 必须返回 widget segment（不是 malformed）。
6. **Media render path** — `toolResultShape === 'media'` 的 capability，`uiRenderPath` 必须提到 `MediaPreview`。
7. **状态-暴露一致性** — deferred 必须至少一个 runtime 标 unsupported；unsupported 必须带 `notes` 解释。
8. **runtime 真实挂载（slice 7b 收紧）** — `createCodePilotBuiltinTools` 必须**真的 mount 每一个**`codex_proxy.kind === 'bridge_executable'` capability 的 `toolNames`，**不接受 notes 例外**。不挂载的工具要么改 bridge factory，要么把那个 runtime 标 `unsupported`，要么拆出 deferred capability（参考 `assistant_buddy`）。

## 接入新 Runtime 的硬性流程

> 唯一权威：**[docs/handover/new-runtime-playbook.md](./new-runtime-playbook.md)**（Phase 5d Phase 5 落地）。
>
> 本节早期 6 步精简版已替换为 playbook 的 7 步硬流程；playbook 增加了 Step 0 Provider/Runtime 边界判断 + Step 5 "Contract Tests Gate"（5 个 harness-*.test.ts 在 smoke 之前必须全绿）+ Step 7 UI 可见性收口 + 7 条反模式（来自 slice 1-6 真实事故）。新 Runtime 落地前必须按 playbook 走。

## 当前已知 tech-debt

| 项 | 影响 | 解决方向 |
|---|---|---|
| Native widget 早期有 abridged prompt，slice 7 已 re-export 权威 | 已修 | — |
| Native memory + tasks 仍有自己的 prompt（drift） | 模型在 Native Runtime 下读到的规则与 ClaudeCode/Codex 不同 | slice 8：让 builtin-tools/memory-search.ts + builtin-tools/notification.ts 从 MCP 文件 re-export |
| `image_generation` Native exposure 不返回 MediaBlock | Native Runtime 下用户看不到图片卡（要看 marker text） | slice 8：让 Native execute 也构造 MediaBlock 走 ai-sdk tool result |
| `media_import` 在 builtin-tools/media.ts 仍有自己的 Native prompt（drift from MCP-side MEDIA_MCP_SYSTEM_PROMPT） | Native 模型读到的导入工作流提示比 MCP 短 | slice 8：让 builtin-tools/media.ts 从 media-import-mcp.ts re-export，或为 import / generate 分别拆 prompt |
| `assistant_buddy` (codepilot_hatch_buddy) 未接 Codex bridge | Codex Runtime 用户无法直接 hatch buddy | Phase 5d Phase 2-3 阶段决策：是 Harness capability 还是 assistant workspace flow |
| Dashboard / CLI tools 无 Codex bridge | Codex Runtime 用户调不动这两族工具 | 需要先定 bridge 端 permission round-trip 协议 |
| `cli_tools` 没有独立 `_SYSTEM_PROMPT` export | 契约的 systemPromptFragment 暂为空字符串 | slice 8：从 MCP factory 提取 |

## 与既有契约的关系

- `RuntimeRunEvent` / `AgentRuntime`（`src/lib/runtime/contract.ts`） — 是输出面契约（runtime 发什么事件给 UI）。Harness Capability Contract 是**输入面 + 中间面**契约（UI 上看到的"一项能力"在每个 runtime 各自怎么挂、提示什么、产出什么）。两层互不替代，配合用。
- `Provider Proxy Bridge`（`docs/handover/provider-proxy-bridge.md`） — Codex Responses proxy 的协议层（八个 hook）。Capability Contract 是其上一层：proxy 让 Codex 能跑 CodePilot provider 的请求；bridge 是 proxy 上挂的 CodePilot 能力适配器。
- `Codex Tool Bridge`（`docs/handover/codex-tool-bridge.md`） — Phase 5c 的具体实现交付。Phase 5d 把 5c 的经验抽成契约。
