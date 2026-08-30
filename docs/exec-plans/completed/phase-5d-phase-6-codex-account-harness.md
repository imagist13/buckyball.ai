# Phase 5d Phase 6 — Codex Account native path 接 Harness + Dashboard Codex bridge

> 创建：2026-05-17
> **状态变更（2026-05-18）**：本子计划的 6a-6e slice **已正式归入 [Phase 5e](./phase-5e-runtime-harness-architecture.md) Phase 3 实施 slice，并随 Phase 5e 一并归档**。本文保留作为历史 backlog（具体技术 slice + 风险矩阵），但状态汇报、产品决策、跨 Runtime 视角统一看 Phase 5e 归档。
> 父计划：[phase-5d-harness-capability-contract.md](./phase-5d-harness-capability-contract.md) `Phase 6`（保留行，但 Phase 5e 是更高层视角）
> 触发 review：Codex review 在 Phase 3/4 review fix 之后 smoke 验证发现 P0 缺口
> 范围：仅计划，不立刻动 Codex Account 主路径（按 [new-runtime-playbook.md](../../handover/new-runtime-playbook.md) 的 schema-first 硬流程走）

## 为什么需要 Phase 6

Phase 5d Phase 1-5 把 Harness Capability + Context Compiler + Runtime Capability Adapter + Artifact Contract + New Runtime Playbook 落地。Phase 3/4 review 之后 Codex review 跑了一轮 GPT-5.5 / Codex Account smoke，发现 **现在最多是 "Codex 基础聊天 + 部分 proxy bridge 能跑"**，还不是完整 Harness Runtime：

| 事实 | 证据 | 原因 |
|---|---|---|
| Codex Account 用户调 widget 失败（malformed show-widget + 非预期 rg/sed/ls + fileChange 申请） | smoke 复现 | `provider-proxy.ts:180` `if (providerId === 'codex_account') return base;` 直接绕过 codepilot_proxy 注入，连带绕过 unified-adapter.ts 的 `adaptForCodexProxy` 调用，模型从未见过 capability prompt + 不知道 `show-widget` wire format |
| 调"把 widget 固定到看板"失败 | smoke 复现 | `dashboard` capability `status: 'deferred'` + `codex_proxy.kind: 'unsupported'`（`capability-contract.ts:436`），bridge 从未挂 `codepilot_dashboard_pin/list/update/remove`；模型没工具可调，靠 fileChange 编辑文件兜底 |
| Deny patch 后 `/api/chat/permission` 返回 409 | smoke 复现 | 已在 Phase 3 review fix #3 修复（approval-bridge 现在 idempotent，详见 phase-5d-harness-capability-contract.md 决策日志） |

**产品底线**（用户原话）：任何 Runtime 的任何 provider 路径，只要显示为 CodePilot Chat，就必须经过同一套 Harness capability manifest；如果某条 native path 不能挂载某能力，UI 和模型上下文都必须显式说不可用。

Codex Account 现在不满足这条底线——既没经过 Harness（capability prompt 没注入），也没在 UI 明确说不可用（看上去和 Codex Runtime+proxy 一样能用）。

## 状态

| Slice | 内容 | 状态 | 备注 |
|---|---|---|---|
| 6a | Codex app-server 协议 schema snapshot | ✅ 由 Phase 5e 吸收 | 结论落在 Codex Account partial / Settings 诚实降级，不再作为 Phase 5 阻塞。 |
| 6b | Capability matrix 拆 `codex_account` 维度 | ✅ 由 Phase 5e 吸收 | 已由 provider-aware capability matrix 表达 codex_account 下 perception-only / unavailable 能力。 |
| 6c | Codex Account 注入入口设计（三选一）| ✅ 由 Phase 5e 吸收 | 用户决策采用 Settings 能力清单诚实降级，而不是强行绕过 Codex Account 协议边界。 |
| 6d | Dashboard Codex bridge（proxy 路径优先） | ✅ 由 Phase 5e 吸收 | Dashboard / CLI / assistant_buddy 不再作为 Phase 5 必须可执行能力；后续要执行化需新开 Harness slice。 |
| 6e | UI 可见性（用户能看到 capability 在 codex_account 下不可用） | ✅ 由 Phase 5e 吸收 | Settings Runtime 能力清单已落地，展示支持 / 不支持 / trust boundary / 替代路径。 |

## 6a — Codex app-server 协议 schema snapshot（fixture-first）

按 [new-runtime-playbook.md](../../handover/new-runtime-playbook.md) Step 1 的硬约束：**不写代码，先抓 fixture**。

需要确认的协议事实：

1. `thread/start` 是否接受 `instructions` / `systemPrompt` / `metadata` 类字段承载 CodePilot capability prompt？
   - 来源：`资料/codex/codex-rs/.../v2/ThreadStartParams.ts`
   - 现状（runtime.ts:350）只用 `{ cwd, model, modelProvider, config }`
2. `turn/start.input` 数组是否接受 `type: 'system'` item？
   - 来源：`资料/codex/codex-rs/.../v2/UserInputItem.ts` 之类的 union 定义
   - 现状（runtime.ts:502）只用 `[{ type: 'text', text: ... }]`
3. Codex Account OAuth 是否允许下游修改请求体（即让 codepilot_proxy 截获）？
   - ToS / auth header 限制？
   - codex.openai.com `/backend-api/codex/responses` 是否能接受非默认 model_provider 路由？
4. Codex 自带的 instructions（Codex 系统 agent prompt）是否能 override 或 append？
   - 来源：codex-rs/.../config 默认 `system_prompt` / `default_instructions`
5. Codex 自带的 tool surface（`shell` / `tool_search` / `namespace`）有没有"插入第三方 tool"的扩展点？
   - 类似 ClaudeCode SDK 的 MCP

**产物**：

- `docs/research/codex-app-server-protocol-fixtures.md`（按 playbook Step 1 的 external-fact / repo-fact / inference 三层分层）
- 至少 3 个 fixture：thread/start request + turn/start request + 一个 server→client approval RPC（含 system prompt 注入实验结果，如果协议层允许）
- 给 6c 决策提供"哪种注入方式真实可行"的事实底座

**禁止**：

- 不要靠"应该这样"推测 Codex 行为。所有判断必须有 repo `资料/codex/` 源码 + 真实 HTTP 流量支撑。
- 不要因为某条注入"看起来能行"就直接在主路径试。fixture 阶段只读。

## 6b — Capability matrix 拆 `codex_account` 维度

**问题**：`capability-contract.ts` 的 `exposure.codex_proxy` 字段实际只覆盖 "Codex Runtime + non-codex_account provider"。`codex_runtime + codex_account` 这条路径是**事实上的 unsupported**，但 catalog 没显式说明，所以 UI / drift test 都看不到。

**设计**：在 `RuntimeExposure` 上加 `codexAccountAvailability` 子字段（命名待定），明确每个 capability 在 codex_account provider 下的真实可用性。先全部标 `unsupported`，6c 落地后再升级到 `available`。

```ts
interface RuntimeExposure {
  readonly kind: RuntimeExposureKind;
  readonly module?: string;
  readonly factory?: string;
  readonly notes?: string;
  /** Phase 6 — codex_account provider sub-matrix. Codex Runtime
   *  bridge mounts CodePilot built-in tools only when the upstream
   *  provider is NOT `codex_account`. Codex Account paths bypass
   *  the proxy entirely (`buildCodexThreadParams` returns base
   *  without `codepilot_proxy`), so even capabilities flagged
   *  `bridge_executable` here are not callable under codex_account
   *  until Phase 6 ships an alternative injection path. */
  readonly codexAccountAvailability?: 'available' | 'unsupported';
}
```

**完成准则**：

- Catalog 每条 `live` / `deferred` capability 的 `codex_proxy.codexAccountAvailability` 显式声明
- Drift test 加 pin：catalog 中标 `available` 的 codex_account capability 必须能在 runtime.ts / proxy 路径真实命中（不能 notes-only）
- UI 在用户选了 codex_account provider 时显式展示 "X 个 CodePilot 能力当前不可用 → 切换到 \<其他 provider\> 启用"

**禁止**：

- 不允许在 catalog 用 notes 含糊说"部分可用"。`available` / `unsupported` 二选一，跟 `status` 的严格语义对齐。

## 6c — Codex Account 注入入口（三选一，依赖 6a）

按 6a fixture 结果，三个候选方案：

### 方案 A — 让 codex_account 也走 codepilot_proxy

让 `buildCodexThreadParams` 不再对 `codex_account` 短路；改成构造一个 codex_account 专用的 modelProvider injection，把 OAuth token 透传给 codex 远端。

**前提**：6a 调研确认 codex.openai.com 端点接受 CodePilot proxy 的 forwarded request（不被 ToS / origin check / auth flow 拒绝）。

**优点**：一次性把 Codex Account 接进 unified-adapter + adapter facade + Context Compiler，结构与现有 Codex Runtime+proxy 路径完全一致。

**风险**：
- ToS：OAuth token 经过 CodePilot proxy 可能违反 ChatGPT 用户协议
- 延迟：多一跳 hop
- Codex 端可能用 origin header 验证

### 方案 B — turn/start input 注入 system-shaped item

按 6a 的 `UserInputItem` 联合类型，看 Codex 是否接受 system-role 项；如果接受，把 `compileContext(...).systemPromptText` 包成 system item 前置。

**前提**：6a 调研确认 input 数组支持 system role。

**优点**：完全本地，不动 model provider 注入。

**风险**：
- 模型可能把它当用户消息处理
- 视觉上：不能让用户看到这条注入 → 需要 hide_from_user 标记
- Codex 自己的 instructions 可能与之冲突 / 重复

### 方案 C — thread/start instructions 注入

按 6a 的 `ThreadStartParams` schema，看是否暴露 `instructions` / `systemPrompt` 字段。

**前提**：6a 调研确认该字段存在且 Codex 远端会把它纳入 prompt。

**优点**：thread-level 而非 turn-level，只需注入一次；语义清晰。

**风险**：
- 字段可能不存在 / 是 deprecated
- resume 时需要重新注入吗？（参考 Phase 5b 的 thread params re-attach 教训）

**Built-in tools 承载**（A/B/C 都需要回答）：

Codex app-server 没有 MCP-style "应用层 mount tool" 扩展点（截至当前 `资料/codex/` 快照）。即使 system prompt 能注入，**模型也调不到 `codepilot_load_widget_guidelines / codepilot_generate_image / ...`，因为这些 tool 不在 Codex 的 tool surface 上**。

候选：

- A → 走 proxy 时 `unified-adapter.ts` 的 `bridge` 也对 codex_account 生效（前提 A 落地）
- B → 在 system prompt 里用文字告诉模型"调用 codepilot_xxx 时，把 args 包成 \`call:\` 标记，CodePilot 会拦截"——但这是 protocol-level hack，需要 turn/completed 后台扫描；可能性极低，仅作 fallback
- C → 同样不解决工具承载问题

**最可能的真实结论**：Codex Account 路径**没有干净的 built-in tools 承载方式**，除非走方案 A（代价：ToS + 延迟）。其他方案可能只能解决 system prompt 注入（让 widget JSON 至少格式对），但不能让 `codepilot_dashboard_pin` 实际可调。

这种情况下，Phase 6 必须诚实地：
- **要么** 接受 Codex Account 在底线上只能 partial（system prompt yes，built-in tools no），在 UI 明确告诉用户"切到其他 provider 可用完整能力"
- **要么** 选方案 A 承担 ToS / 延迟代价

最终决策需要 6a 事实 + 用户产品取舍，**Phase 6 计划不预先收口**。

## 6d — Dashboard Codex bridge（与 6c 正交）

`dashboard` capability 现在是 `status: 'deferred'` + `codex_proxy.kind: 'unsupported'`。把它推到 `live` 在 Codex Runtime + non-codex_account provider 路径下：

操作：

1. 在 `src/lib/codex/proxy/builtin-bridge.ts` 加 `buildDashboardPinTool / buildDashboardListTool / buildDashboardUpdateTool / buildDashboardRemoveTool / buildDashboardRefreshTool`
2. 在 `createCodePilotBuiltinTools` 把这五个 mount 进 `result.tools`
3. `CODEPILOT_BUILTIN_TOOL_NAMES` 加这五个名字
4. `capabilitiesFromBridgeToolNames` 加映射 dashboard
5. `capability-contract.ts` 把 `dashboard.status` 从 `deferred` → `live`（如果 Native + ClaudeCode 都已 live）
6. `dashboard.exposure.codex_proxy` 从 `unsupported` → `bridge_executable`
7. 加 capability drift test pin（drift test 已经覆盖 `live` capability 必须全 mount，所以 catalog 改后会自动验证）

**风险**：dashboard 涉及 write 操作（pin / remove / update），按 Phase 5d Phase 0 决策记录"Codex bridge 需要 permission round-trip 设计"。

permission 路径：dashboard tool execute() 在 bridge 内同步调用 dashboard CRUD API；如果用户期望"按 codex approval"流程批准，需要在 execute() 里发 permission_request SSE。当前 Codex bridge 工具是"server-side 自动执行 + 通过 builtin-event-bus 发 tool_started/tool_completed"，不走 approval。

**决策点**：dashboard write 是否需要 approval？

- 选 A：不需要。Dashboard 是用户主动看板，模型 pin/remove 是低风险元数据操作；execute() 直接执行就好。
- 选 B：需要。Pin/remove 影响用户主屏，应该和 fileChange 一样走 approval。

选 A 更轻；选 B 更严但需要扩展 bridge 的 approval 通道（builtin-event-bus 当前不支持 approval round-trip）。**初版选 A**，列入 follow_up 是否升级到 B。

**完成准则**：

- 6 个 bridge tools 全 mount，capabilities 加 dashboard 后，contract test 通过
- smoke: GPT-5.5 / non-codex_account provider 下"把 X widget pin 到 dashboard"实际成功
- catalog `dashboard.status` 升级到 `live`

## 6e — UI 可见性

依赖 6c 方案：

- 如果 6c 选 A 且 6a 协议允许：codex_account 接入 Harness 完整 → UI 不需要特殊提示
- 如果 6c 选 B/C 或 partial：UI 必须显式提示"当前 provider 不支持 X 个 CodePilot 能力"
- 如果 6c 接受 "Codex Account 路径不接 built-in tools"：UI 必须在 provider 切到 codex_account 时显示明确 banner / disabled state + tooltip "切到 \<其他 provider\> 启用 widget / dashboard / 图片生成"

UI 改动按 [docs/handover/feedback_visible_actions_after_consolidation](../../) 的"按钮可见性"原则：能力不可用时入口要可见但 disabled + tooltip 解释；不能完全隐藏。

## 用户价值

| Form | 价值 | 衡量 |
|---|---|---|
| A — visible UI | 用户在 Codex Account 下知道哪些能力不可用 + 怎么启用 | 6e 的 "切到其他 provider" 提示在 codex_account 切换时显示 |
| C — Infrastructure | Codex Account 接入 Harness 后，下次接 Hermes / OpenClaw 的 codex-account-like 路径有现成模板 | new-runtime-playbook 增加"OAuth-direct provider 接入"子段落 |

## 不做

- ❌ 不在 6a 调研前动 Codex Account 主路径
- ❌ 不为了让 smoke 通过而在 prompt 里 paraphrase capability 规则——这就是 live-smoke-driven patching
- ❌ 不悄悄关闭 codex_account 下的 widget / dashboard 按钮——按钮可见性原则要求 disabled + 解释，不能隐藏

## 决策日志

- 2026-05-17：Phase 6 单独立子计划。父计划 Phase 5 标记"Codex 基础聊天 + 部分 proxy bridge 能跑"，不能整体收口。
- 2026-05-17：6c 三方案预留，**不预先收口**。fixture-first 是硬约束；按 new-runtime-playbook Step 1 走。

## 反向链接

- 父：[phase-5d-harness-capability-contract.md](./phase-5d-harness-capability-contract.md)
- 接入流程：[../../handover/new-runtime-playbook.md](../../handover/new-runtime-playbook.md) — 本 Phase 6 实际上是把这套 playbook 应用到 codex_account 路径
- Codex provider proxy 协议层：[../../handover/provider-proxy-bridge.md](../../handover/provider-proxy-bridge.md)
- Codex Tool Bridge（Phase 5c）：[../../handover/codex-tool-bridge.md](../../handover/codex-tool-bridge.md)
