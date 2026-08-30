# Phase 5d Phase 2 — Context Compiler

> 创建：2026-05-16
> 最后更新：2026-05-19
> 父计划：[phase-5d-harness-capability-contract.md](./phase-5d-harness-capability-contract.md) `Phase 2 — Context Compiler 边界`
> 前置：[phase-5d-harness-capability-contract.md](./phase-5d-harness-capability-contract.md) Phase 0+1 已落地（slice 7b 后），`src/lib/harness/capability-contract.ts` + `harness-capability-contract.test.ts` 是本计划的真值底座
> 状态：✅ 已完成并归档；实现已进入 `src/lib/harness/context-compiler.ts` 与 runtime adapter facade，后续只按 Harness Capability Contract 增量演进。

## 状态

| Slice | 内容 | 状态 | 备注 |
|---|---|---|---|
| 2a | Compiler 接口 + Input/Output 类型 + 纯函数 `compileContext(input)` + 单测 | ✅ 2026-05-17 | `src/lib/harness/context-compiler.ts`；23 pins 在 `harness-context-compiler.test.ts` |
| 2b | 等价测试 harness | ✅ 2026-05-17 | `src/lib/harness/expected-differences.ts` ledger + 9 pins 在 `harness-context-compiler-equivalence.test.ts` |
| 2c | ClaudeCode SDK Runtime 切到 compiler 输出 | ✅ 2026-05-17 | claude-client.ts 收集 `enabledCapabilities` Set，所有 MCP 注册完后调 `compileContext({ runtimeId: 'claude_code', ... })`，用 `compiled.systemPromptText` 作单一 `queryOptions.systemPrompt.append`；所有 per-capability `+ _SYSTEM_PROMPT` 内联拼接删除 |
| 2d | Native Runtime 切到 compiler 输出 | ✅ 2026-05-17 | `getBuiltinTools()` 用 `capabilityIdForGroup` 把 group 映射成 capability id，末尾调 `compileContext({ runtimeId: 'codepilot_runtime', ... })`；`compiled.systemPromptText` 作 `systemPrompts[0]` 返回；非 capability group (session-search / ask-user-question) 仍在 array 后续条目按原样透传 |
| 2e | Codex Runtime（bridge）切到 compiler 输出 | ✅ 2026-05-17 | builtin-bridge.ts 移除四个 _PROMPT 标量；unified-adapter.ts 按 **bridge mount → compileContext → bodyWithBridgePrompt → buildMessages(bodyWithBridgePrompt)** 顺序跑（P0 修：compileContext 必须在 buildMessages 前面，否则编译输出只能走 `providerOptions.openai.instructions`，Anthropic-compat / CodePlan / chat-completions 路径丢内容） |

所有 slice 一次性交付（用户调整：内部按顺序做，外部单次交付）；`npm run test` 全绿（2576/2576）。

## 用户价值

| Form | 价值 | 衡量 |
|---|---|---|
| C — Infrastructure | 后续 Phase 3 / 4 / 5 都需要稳定的 compiled context 作为输入；没有 Phase 2 就没法做 Runtime Capability Adapter 抽象 / Artifact Contract 校验 / 新 Runtime Playbook | 编译层稳定为后三段的输入 |
| B — 静默改善（量化） | 同一能力在三个 Runtime 下的模型行为一致性提升 | (1) Cross-runtime prompt fragment 内容 100% 同源（drift test 0 hits）；(2) Phase 5c smoke matrix 复跑通过率 ≥ 6/6；(3) 新 Runtime 接入流程从"slice driven by smoke"变成"plan driven by contract" |

**显式不承诺 Form A**：本 Phase 0 UI 改动。任何"用户看到的变化"都来自 Phase 3+ 或 Phase 5c 后续的 smoke 修复，不属于本 Phase 的交付。

## 上下文 — 为什么需要 Compiler

slice 7 + 7b 已经把 capability 抽成单一目录 + drift 测试。但是 **how the model actually sees the capability** 仍然散在三处：

- ClaudeCode SDK Runtime: `claude-client.ts` 拼装 system prompt + 注册 MCP servers + 关键词 gate（~200 行决策代码）
- Native Runtime: `src/lib/builtin-tools/index.ts getBuiltinTools()` + `src/lib/agent/native-runtime.ts` 调用链
- Codex Runtime bridge: `src/lib/codex/proxy/unified-adapter.ts createUnifiedAdapter()` 调 `createCodePilotBuiltinTools()` + `combineInstructions()`

三处各自决定：

- base prompt 是什么
- 哪些 capability fragments 拼进来、顺序、是否 paraphrase
- assistant memory 怎么读、怎么截
- workspace hooks / rules 怎么拼
- 哪些 artifact contract 提示 / 例子嵌入
- 预算（token budget）怎么切

Phase 5d slice 6 暴露的根因不是某个 Runtime 错，是三处对"该注入什么"无法保持同步。Phase 2 Compiler 把这三处决策合并成一个**纯函数**，让三个 Runtime 只做 adapter（怎么把 compiled context 喂给自己的 SDK / app-server），不再各自重新做 compilation 决策。

## 输入 — `CompilerInput`

```
sessionId: string
workingDirectory?: string
runtimeId: RuntimeId       // 'claude_code' | 'codepilot_runtime' | 'codex_runtime'
providerId: string
model: string
userPrompt: string         // 用于 keyword-gated capability 决策
enabledCapabilities: ReadonlySet<string> | null   // null = 使用 catalog 默认（status === 'live' 且 gating 通过）
assistantMemory?: AssistantMemorySnapshot         // 调用方预取的最近记忆条目（compiler 不做 IO）
permissionProfile?: PermissionProfile             // 影响哪些写类工具进入 tool descriptor 列表
tokenBudget: { systemPromptMax: number; contextMax: number }
flags?: Record<string, boolean>                   // 兼容 feature flag，留给未来扩展
```

**关键边界**：
- `assistantMemory` 是 pre-fetched snapshot，compiler 不读磁盘、不查 DB。`workspace-retrieval.searchWorkspace()` / `loadManifest()` 之类的 IO 全部在调用方做，compiler 只消费快照。
- `permissionProfile` 是 hint，影响 tool descriptors 的 `unsupported` 标记；compiler 不做 permission 决策。
- `userPrompt` 用于关键词 gating（image / widget keyword 触发），不参与最终 prompt 拼接（拼接走 conversation message，不走 system prompt）。

## 输出 — `CompiledContext`

```
basePrompt: string                                  // CodePilot runtime-agnostic 基础提示
capabilityFragments: readonly CapabilityFragment[]  // 按 catalog 顺序
toolDescriptors: readonly ToolDescriptor[]          // 能调用的工具列表
memoryFragments: readonly MemoryFragment[]          // recent / workspace / session 三类
workspaceFragments: readonly WorkspaceFragment[]    // hook / rule / context 三类
artifactContracts: readonly ArtifactContractFragment[]  // widget / media / markdown / html 等
runtimeHints: {
  claudecode_sdk?: ClaudeCodeHints                  // 例如 MCP server 注册列表 + allowedTools
  native?: NativeHints                              // 例如 ToolSet keys + system prompt segments
  codex_proxy?: CodexProxyHints                     // 例如 stopWhen + builtinToolNames + namespace passthrough
}
budget: BudgetReport                                // { used, max, perCategory }
diagnostics: {
  droppedFragments: readonly DroppedFragment[]      // 超预算被裁掉的（每条带 reason + tokens）
  dedupedFragments: readonly string[]               // fragment id 被去重的
  capabilityDecisions: readonly CapabilityDecision[]  // 每个 capability 为何 in/out + 为何使用哪个 fragment 源
}
```

每个 fragment 都有：

```
fragmentId: string         // 稳定 id，drift test 用它锁定唯一来源
sourceCapability?: string  // 引用 capability-contract.ts 里的 capability.id
sourceFile: string         // 来源文件路径（drift test 验证）
sourceExport: string       // 来源 export 名（drift test 验证）
text: string               // fragment 内容
tokens: number             // 估算
```

**关键不变量**：
- 每个 `fragmentId` 在 `CompiledContext` 中只能出现一次（去重发生在编译期，调用方拿到的不会有重复）。
- 同一 `fragmentId` 在不同 RuntimeId 下编出来的 `text` 必须相同（drift test 在 2b harness 中跨 runtime 比对）。
- `sourceFile + sourceExport` 与 `capability-contract.ts` 中对应 capability 的 `systemPromptFragment` 来源一致。

### runtimeHints 边界（review 修订 #3）

`runtimeHints` **是 Compiler 给特定 Runtime 的可执行配置**，不是第四个 prompt 拼装入口。**类型层和测试层都禁止 prose**。

**允许字段**：

- ID 类（`mcpServerNames: readonly string[]` 给 ClaudeCode；`toolSetKeys: readonly string[]` 给 Native；`builtinToolNames: ReadonlySet<string>` 给 Codex bridge）
- 引用类（`fragmentIds: readonly string[]` 指向 CompiledContext 已有 fragment 的稳定 id）
- 适配器选项（`stopWhen: 'stepCountIs' | 'never'` + `stepCount: number`；`passthroughToolTypes: readonly string[]`）

**禁止字段**：

- ❌ 任何 prompt / 文案字符串（template literal、长 string 字面值）
- ❌ Tool description / 参数 schema paraphrase（tool schemas 必须从 `toolDescriptors` 走）
- ❌ 重新定义 capability 文案
- ❌ 任何"如果 model 看到这个会变化行为"的内容（那些必须以 fragment 形式进入 CompiledContext）

**类型示例**：

```ts
export interface ClaudeCodeHints {
  readonly mcpServerNames: readonly string[];
  readonly allowedToolNames: readonly string[];
  // 反例：禁止 systemPromptExtra: string
}

export interface NativeHints {
  readonly toolSetKeys: readonly string[];
  // 反例：禁止 promptOverride: string
}

export interface CodexProxyHints {
  readonly builtinToolNames: ReadonlySet<string>;
  readonly stopWhen: 'stepCountIs' | 'never';
  readonly stepCount: number;
  readonly passthroughToolTypes: readonly string[];
  // 反例：禁止 widgetPromptExtra / namespacePromptHint: string
}
```

**测试约束（防回归测试 #11）**：

- 类型层：上面三个 Hints type 的所有 `string` 字段必须是 enum-like 集合或 ID（运行时长度 ≤ 64 字符；不含换行、不含 Markdown 标记 `\`\`\`` / `**` / `# ` 等明显 prose 标识）
- 运行时层：编译完成后扫描每个 runtimeHints field，超长字符串 / 含 prose 标记 → FAIL
- Source-level：grep `runtimeHints\.<field>\s*=` 赋值，禁止右侧出现 multi-line template literal
- 跨引用一致性：runtimeHints 中所有 `fragmentIds` 引用必须能在 CompiledContext 的 capabilityFragments / workspaceFragments / artifactContracts 中找到对应 fragmentId（指 dangling 也算 FAIL）

## 边界

**Compiler 只做**：

1. 决定**注入什么**（基于 capability catalog + enabledCapabilities + gating）
2. 决定**顺序**（catalog 顺序 + memory before workspace before artifact contract 等明确规则）
3. 决定**预算怎么切**（base + capability 优先，memory / workspace 可裁剪，artifact contract 不可裁剪）
4. 决定**如何去重**（fragmentId 唯一）

**Compiler 不做**：

1. ❌ 执行工具（execute 留给 MCP / AI SDK / bridge factory）
2. ❌ 处理 SSE / event stream
3. ❌ 渲染 UI / 操作 DOM
4. ❌ 直接调用 provider / 模型
5. ❌ 读磁盘 / DB（IO 都在调用方）
6. ❌ Permission 决策（消费 hint，不做 round-trip）
7. ❌ Mutate session state（纯函数，input → output）

## 顺序 / 去重 / 预算规则

**顺序**：

```
basePrompt
↓
artifactContracts        (短、关键、不可裁剪)
↓
capabilityFragments      (按 catalog 顺序)
↓
workspaceFragments       (hook / rule 优先于 context)
↓
memoryFragments          (recent 优先于 workspace 优先于 session)
```

为什么 artifactContracts 在前：Phase 5c slice 6 经验，模型在长 system prompt 末尾容易丢失 wire format 约束。把 Widget JSON 例子 / show-widget fence 规则前置。

**去重**：

- 一个 `fragmentId` 只输出一次。
- 当多个 capability 引用同一 fragment（例如 image_generation 和 media_import 都引用 `MEDIA_*_SYSTEM_PROMPT`）时，按 capability 顺序取第一个。

**预算**：

```
1. base + artifactContracts + live capabilityFragments → 必须全部进入 systemPromptMax
   如果超出：FAIL（应触发 contract 警告而不是裁剪关键内容）
2. workspaceFragments → 按声明顺序进入剩余预算
3. memoryFragments → 按声明顺序进入剩余预算
4. 超预算的 memory/workspace 进入 droppedFragments，diagnostics 记录 reason='budget'
```

**Token 估算**：第一版用字符 / 4 简易估算（OpenAI 经验值），第二版按 model family 调用 `gpt-tokenizer` / `anthropic-tokenizer`。先不引入新依赖，估算误差 ±20% 可接受。

### Widget wire-format 单一来源（review 修订 #1）

slice 7 之后 `WIDGET_SYSTEM_PROMPT`（widget-guidelines.ts）通过模板字符串内嵌 `WIDGET_WIRE_FORMAT_SPEC` + `CANONICAL_SHOW_WIDGET_JSON`。Compiler 同时把 widget 的 artifactContract（持有同一 wire spec + canonical JSON）插在 capabilityFragments **之前**。**未做处理会让 wire format 在最终 system prompt 中出现两次**（artifactContract 一次 + capability fragment 末尾一次）。

**硬约束**：最终 compiled system prompt 中

- `CANONICAL_SHOW_WIDGET_JSON` 字面值出现次数 = **1**
- `FINAL OUTPUT FORMAT — non-negotiable` 标题出现次数 = **1**
- `WIDGET_WIRE_FORMAT_SPEC` 完整文本出现次数 = **1**

> 1 → 编译 FAIL，不是 warning。

**实现方向（slice 2c 顺带做的小重构）**：

- `WIDGET_SYSTEM_PROMPT` 重构为不嵌入 `WIDGET_WIRE_FORMAT_SPEC`，仅保留 capability 自身的"何时调用 / 何时禁止"等工作规则
- artifactContract 成为 wire-format spec + canonical JSON 的**唯一持有者**
- 最终 prompt 拼接顺序仍是 artifactContract → capability fragment，但内容不再重叠
- Compiler 额外加 sanity check：编译期扫描每个 capabilityFragment 的 text，如果包含任何 artifactContract.canonicalJson 子串，**FAIL**（防止有人改回旧形式而 wire-format 单源约束被绕过）

**联动**：`codex-widget-format-contract.test.ts` 中的 "the canonical example appears inside WIDGET_WIRE_FORMAT_SPEC, which appears inside WIDGET_SYSTEM_PROMPT" pin 需要在 slice 2c 同步更新为 "appears inside the compiled artifactContract for widget"。

## 迁移路径（5 slice）

### 2a — 接口与基础设施

新建 `src/lib/harness/context-compiler.ts`：

- 导出 `compileContext(input: CompilerInput): CompiledContext`
- 导出全部输入 / 输出类型
- 实现去重 + 顺序 + 预算逻辑
- 单测 `harness-context-compiler.test.ts`：
  - 输入 → 输出 类型 round-trip
  - 顺序规则（artifact contracts 在 capability 前）
  - 去重规则（同 fragmentId 不重复）
  - 预算规则（超预算时 droppedFragments 正确分类）
  - 与 capability-contract.ts 同步（live capabilities 默认全部进入；deferred 不进入）

**这一步不改任何现有调用点**。

### Expected Differences Ledger（review 修订 #2）

**问题**：2b 等价测试和 2c-2e canonicalization 之间存在不可避免的冲突。现有 Runtime 实际拼出来的 prompt 含有已经被 slice 7b 列为 tech-debt 的 paraphrase（Native memory / notify / media 的简化版 system prompt）。如果 2b 严格要求"compiler 输出 === Runtime 当前 prompt"，反而**会锁死旧 drift**，让 2d 后续的 canonicalization 无法落地。

**解决方案**：引入 `src/lib/harness/expected-differences.ts` 作为白名单。每条 entry：

```ts
export interface ExpectedDifference {
  runtimeId: RuntimeId;
  capability: string;             // 必须存在于 HARNESS_CAPABILITIES
  diff: 'capability_fragment_replaced'
      | 'capability_fragment_added'
      | 'capability_fragment_removed'
      | 'tool_schema_canonicalized'
      | 'tool_result_shape_canonicalized';
  description: string;            // 人话：差异是什么
  justification: string;          // 为什么这条差异合理（drift fix / canonicalization）
  plannedResolution: 'slice_2c' | 'slice_2d' | 'slice_2e' | 'follow_up';
  // 验证锚点：
  compilerSource: { sourceFile: string; sourceExport: string };  // canonical 端
  runtimeSource?: { sourceFile: string; sourceExport: string };  // 当前 Runtime 端（被替换）
}
```

**2b harness 使用规则**：

1. 跑 compiler 输出 vs Runtime 当前 prompt fragment diff
2. 每条差异查 ledger：
   - 在 ledger → 标 expected，不 fail
   - 不在 ledger → **未注册回归**，fail；开发者必须 either 把 diff 列入 ledger 或修 compiler
3. ledger 中 `plannedResolution === 'slice_2X'` 的 entry：对应 slice 完成后期望从 ledger 移除（因为 Runtime 已经 canonical 化，diff 不再存在）
4. 长期看，ledger 应趋向空：剩余 entry 都是显式 `follow_up` 项

**初始 ledger（slice 7b 已知 drift，slice 2d 计划消化）**：

| Runtime | Capability | Diff | Compiler source | Runtime source | 计划 |
|---|---|---|---|---|---|
| `codepilot_runtime` (Native) | `memory` | capability_fragment_replaced | `memory-search-mcp.ts: MEMORY_SEARCH_SYSTEM_PROMPT` | `builtin-tools/memory-search.ts: MEMORY_SEARCH_SYSTEM_PROMPT` (5-line abridged) | slice_2d |
| `codepilot_runtime` (Native) | `tasks_and_notify` | capability_fragment_replaced | `notification-mcp.ts: NOTIFICATION_MCP_SYSTEM_PROMPT` | `builtin-tools/notification.ts: NOTIFICATION_SYSTEM_PROMPT` | slice_2d |
| `codepilot_runtime` (Native) | `media_import` | capability_fragment_replaced | `media-import-mcp.ts: MEDIA_MCP_SYSTEM_PROMPT` | `builtin-tools/media.ts: MEDIA_SYSTEM_PROMPT` (共享 image_generation) | slice_2d |
| `codepilot_runtime` (Native) | `image_generation` | tool_result_shape_canonicalized | MediaBlock 直接返回 | builtin-tools/media.ts 当前只返回 text，不构造 MediaBlock | follow_up（不属于 prompt 差异，slice 2 不强求） |

**ledger 自身的契约测试（防回归测试 #12）**：

- 每个 entry 引用的 `capability` 必须在 `HARNESS_CAPABILITIES` 中存在
- 每个 entry 的 `compilerSource` 必须 resolve（文件存在 + export 存在）
- `plannedResolution` 指向的 slice 必须在状态表中
- slice 2d 完成时，CI 应**手动** review 哪些 entry 已实际消除（手动移除，不自动清理以保留审计痕迹）

### 2b — 等价测试 harness

新建 `harness-context-compiler-equivalence.test.ts`：

- 对每个 Runtime 构造一组真实形状的 `CompilerInput`
- 调用现有 Runtime 的 prompt 构造代码（snapshot 现有输出）
- 调用 `compileContext` 并展开为 prompt + tool descriptors
- 对照 Expected Differences Ledger 过滤已登记差异
- 断言剩余 fragments / tool names 在两边集合等价（位置允许不同）

如果 2b 发现 compiler 与 Runtime 不一致但 ledger 里没有：

- 是 compiler 漏了 fragment → 修 compiler
- 是 Runtime 在 paraphrase / 多写 → 列入 ledger（slice 2c-2e 消化），不在本 slice 修
- 是 Runtime 有 runtime-specific 内容（例如 Codex bridge 的 stopWhen）→ 走 `runtimeHints.*`

**这一步仍不改 Runtime 行为**。

### 2c — ClaudeCode SDK Runtime 切到 compiler

- `claude-client.ts` 的 system prompt 拼装 + MCP server 列表生成 + allowedTools 计算改成调 `compileContext` + 消费 `runtimeHints.claudecode_sdk`
- Smoke + 单测都通过（等价测试 2b 已经覆盖）

最孤立选择：ClaudeCode 路径是真值底座（capability prompt 来源大部分在 MCP 文件里），切过去最不容易踩坑。

### 2d — Native Runtime 切到 compiler

- `getBuiltinTools()` + Native 调用链改成 compiler-driven
- 顺带消化 slice 7b tech-debt 中的 Native prompt drift（memory / notify / image media block）

### 2e — Codex Runtime（bridge）切到 compiler

- `unified-adapter.ts` 的 `combineInstructions` / `mergeToolSets` 改成 compiler 输出
- `builtin-bridge.ts` 的 `WIDGET_PROMPT` / `MEDIA_PROMPT` / `MEMORY_PROMPT` / `NOTIFY_PROMPT` 全部从 compiler 拿，不在 bridge 本地存
- Codex-specific 信息（`stopWhen: stepCountIs(8)`、`builtinToolNames` 抑制集合、`passthroughTools` 列表）走 `runtimeHints.codex_proxy`

至此三个 Runtime 都只是 compiler 的 adapter。

## 防回归测试（用户列表 + 扩展）

来自用户必须满足的 6 条：

1. **media_import fragment 来源稳定** — 编译结果中 `media_import` 的 `CapabilityFragment` 必须 `sourceFile === 'src/lib/media-import-mcp.ts'` 且 `sourceExport === 'MEDIA_MCP_SYSTEM_PROMPT'`。漂移到 builtin-tools/media.ts 的 paraphrase 触发 fail。
2. **assistant_buddy 仍 deferred** — `enabledCapabilities = null` + Codex Runtime 编译时，`assistant_buddy` 不能出现在 `capabilityFragments` 也不能出现在 `toolDescriptors`；`diagnostics.capabilityDecisions` 必须有一条 `{id: 'assistant_buddy', decision: 'excluded', reason: 'status=deferred, codex_proxy=unsupported'}`。
3. **Widget wire format 单一来源** — 编译结果的 widget artifact contract 必须 `canonicalJson === CANONICAL_SHOW_WIDGET_JSON`（从 widget-guidelines.ts 导入），且 `JSON.parse` + `parseAllShowWidgets` round-trip 成功。
4. **live capability prompt 全部进入** — 对每个 live capability（widget / memory / tasks_and_notify / image_generation / media_import），编译结果都至少有一个 `CapabilityFragment` 引用它的 `systemPromptFragment` 源。
5. **无 paraphrase 重复** — 整个 `CompiledContext` 中没有任何两个 `CapabilityFragment` 的 `text` 是相似不同（编辑距离 < 5%）的；同一 `fragmentId` 只出现一次。
6. **Runtime 只 adapt 不 redefine** — 测试在 2e 完成后检查 `builtin-bridge.ts` 不再持有 `const WIDGET_PROMPT = ...` 这类标量；所有 prompt 文本必须能溯源到 compiler 调用结果。

额外（compiler 自身正确性）：

7. **顺序契约** — `compiledContext.capabilityFragments` 的顺序与 `HARNESS_CAPABILITIES` 数组顺序一致（去除 disabled / deferred）。
8. **预算契约** — 当 `systemPromptMax` 不够装 base + artifact contracts + live capability fragments 时，编译失败（不允许静默裁掉关键内容）。
9. **跨 Runtime fragment text 同源** — 对每个 live capability，三个 RuntimeId 下编出来的同一 `fragmentId` 的 `text` 必须严格相等。

review 修订追加：

10. **Widget wire-format 单源** — 最终 compiled system prompt 中 `CANONICAL_SHOW_WIDGET_JSON` 子串出现次数严格 = 1；`FINAL OUTPUT FORMAT — non-negotiable` 标题严格 = 1；`WIDGET_WIRE_FORMAT_SPEC` 完整文本严格 = 1。slice 2c 完成 `WIDGET_SYSTEM_PROMPT` 去内嵌重构后这条 pin 上线；compile-time sanity check（capability fragment text 不得包含 artifactContract.canonicalJson）独立 FAIL。

11. **runtimeHints 不含 prose** — `ClaudeCodeHints` / `NativeHints` / `CodexProxyHints` 所有 `string` 字段长度 ≤ 64 字符；不含 `\n` / `\`\`\`` / Markdown 标题标记；`fragmentIds` 引用必须在 CompiledContext 中找到对应 entry；Source-level grep 禁止 `runtimeHints\.<field>\s*=` 右侧出现 multi-line template literal。

12. **Expected Differences Ledger 一致性** — 每条 ledger entry 引用的 capability 必须在 `HARNESS_CAPABILITIES` 中存在；`compilerSource.sourceFile` + `sourceExport` 必须可 resolve（文件存在且 export 存在）；`plannedResolution` 指向的 slice 必须在状态表中；ledger entry 数量在 slice 2d 完成后必须减少（手动 review 时 CI 提示，不自动清理保留审计痕迹）。

## 接受标准

Phase 2 标 ✅ 的硬性条件：

- 2a 单测全绿（compiler 纯函数行为）
- 2b 等价测试全绿（compiler 输出 ⊇ 三个 Runtime 现有 prompt fragments，多余的内容必须有 `runtimeHints.*` 来源）
- 2c / 2d / 2e 各自的 Runtime 切到 compiler 后：
  - `npm run test` 全绿
  - `CODEX_DISABLED=1 npx tsx --test src/__tests__/unit/harness-*.test.ts` 全绿
  - Codex 路径要再跑 `codex-widget-format-contract.test.ts` 和 `codex-builtin-bridge.test.ts`，确保已有 contract 没破
- 上述 9 条防回归测试全绿
- handover 文档 `docs/handover/harness-capability-contract.md` 补充 Compiler 章节（输入 / 输出 / 边界 / 迁移现状）

## 不做

- ❌ 不在 Phase 2 改用户可见行为；如果 2c-2e 切换过程中发现 Runtime 行为有差异，差异本身不能由本计划解决（要么走 prompt drift 修复列入 slice 8，要么走 Phase 3 Runtime Capability Adapter）
- ❌ 不引入新的运行时依赖（不引 tiktoken / langchain；token 估算用简易实现）
- ❌ 不增加新 capability；catalog 由 capability-contract.ts 拥有，Compiler 只消费
- ❌ 不改 capability-contract.ts 的字段集（Phase 2 不重设计 contract；如果 compiler 需要 contract 添字段，单独 follow-up）
- ❌ 不动 SSE / artifact 渲染层（Phase 4 范围）

## 风险与开放问题

| 问题 | 影响 | 解决方向 |
|---|---|---|
| Token 估算误差大可能让 budget 误判 | 边界场景下 memory fragment 被错误裁剪 | 第一版用简易估算 + 单测覆盖；如发现实际偏差超 30% 在 Phase 2 内补 |
| Runtime-specific hints 边界模糊 | 例如 Codex 的 stopWhen 算 hint 还是 capability 自身属性 | 默认走 `runtimeHints.codex_proxy`；任何能被多个 Runtime 共享的属性升级到 capability-contract.ts |
| Native Runtime 的关键词 gating 逻辑可能要重写 | claude-client.ts 当前的 gate 逻辑分散且 ad-hoc | 2c 切换时把 gate 决策合并进 `enabledCapabilities` 计算 + `userPrompt` 判定，集中在调用方 |
| assistant_buddy 在 ClaudeCode/Native 是 live capability 的一部分 | 但被 split 出 capability-contract.ts 后单独存在 | 编译时按 capability.id 决策；2c-2e 切换时需要确认现有 Runtime 没硬编码 hatch_buddy 工具名 |
| 现有 prompt 含有不在 capability-contract.ts 里的内容（例如 ClaudeCode 的 ToolHooks 提示） | 2b 等价测试可能 fail | 这些内容归入 `workspaceFragments` 或 `runtimeHints.*`，不强行塞进 capability fragments |

## 决策日志

- 2026-05-16：单独立 Phase 2 sub-plan。父计划 `phase-5d-harness-capability-contract.md` 的 `Phase 2 — Context Compiler 边界` 是顶层描述；本文件是可执行的设计文档。
- 2026-05-16：Compiler 是纯函数 + 不做 IO 的硬约束。理由：测试性、可在任何环境构造输入复现、为 Phase 3 Runtime Capability Adapter 提供可静态分析的输入。
- 2026-05-16：迁移顺序 ClaudeCode → Native → Codex。理由：ClaudeCode 路径的 prompt 源大部分已经是 capability-contract.ts 引用的 MCP 文件（authoritative），切换风险最小；Codex bridge 放最后是因为它的 prompt 现状已经在 slice 7 de-drift 到 canonical，2e 主要是抹去最后的 `WIDGET_PROMPT` 标量。
- 2026-05-16：Token 估算先简易实现。如果实际遇到 30% 以上偏差再引入 tokenizer 依赖；不在本 Phase 设计前预设。
- 2026-05-16：不解决 Native prompt drift（memory / notify / image MediaBlock）。它们记在 slice 7b tech-debt，2d 切换 Native 时**顺带消化但不强求**；硬目标是等价，不是把 drift 都修光。
- 2026-05-16（review 修订）：补三处硬约束，开工前必须落地在设计里：
  1. **Widget wire-format 单源**——slice 2c 把 `WIDGET_SYSTEM_PROMPT` 重构为不内嵌 `WIDGET_WIRE_FORMAT_SPEC`；artifactContract 成为 wire spec 唯一持有者；compile-time sanity check 防止 capability fragment 再吞回 wire spec。
  2. **Expected Differences Ledger**——2b 等价测试不再强求"compiler 输出 === Runtime 当前 prompt"，而是 "compiler 输出 vs Runtime diff ⊆ ledger"。slice 7b 已知 drift 进入初始 ledger；2d 完成对应 canonicalization 时手动清空对应 entry（不自动清理以保留审计痕迹）。
  3. **runtimeHints 严格类型**——`ClaudeCodeHints` / `NativeHints` / `CodexProxyHints` 只允许 ID / refs / 适配器选项；类型层 + 运行时层 + source-grep 三道防线阻止 prose / paraphrase / tool schema 重定义偷渡进 hints 字段。

## 反向链接

- 父：[phase-5d-harness-capability-contract.md](./phase-5d-harness-capability-contract.md)
- 真值底座：[../../handover/harness-capability-contract.md](../../handover/harness-capability-contract.md) + `src/lib/harness/capability-contract.ts`
- 防回归源：`harness-capability-contract.test.ts`、`codex-widget-format-contract.test.ts`
- Phase 5c context（背景痛点）：[phase-5c-codex-tool-bridge.md](./phase-5c-codex-tool-bridge.md)
