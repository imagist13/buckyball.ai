# MiMo UltraSpeed + OpenAI-Compatible Provider

> 创建时间：2026-06-09
> 最后更新：2026-06-09

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 调研小米 UltraSpeed 文档、OpenAI 三方 API 形态、现有 Provider / Runtime 链路 | ✅ 已完成 | Codex 仅做调研与计划，不改产品实现代码 |
| Phase 1 | 小米 MiMo API 渠道补 `mimo-v2.5-pro-ultraspeed` 模型 | ✅ 已实现（代码+单测绿） | PAYG preset 加可选模型，默认仍 `mimo-v2.5-pro`，未进 Token Plan；上架后建议用审批 key 跑一轮 smoke |
| Phase 2 | 恢复并产品化 OpenAI-compatible 三方 API 渠道 | ✅ 已实现（代码+单测绿） | 分类 / 迁移 / 入口 / chat-completions 路径全部接好；真实第三方渠道 live smoke 待测试渠道 |
| Phase 3 | UI 语义、Runtime 标识、模型发现与真实来源校验 | 🔶 部分 | `codepilot_only` label/tooltip/类型注释已改为 CodePilot + Codex（Codex round 2）；模型发现的"实测/手填"来源标识仍待做 |
| Phase 4 | 单测、smoke、真实凭据验证登记 | 🔶 单测已绿；真实 smoke 待凭据 | 需小米审批 key 和一个 OpenAI-compatible 测试渠道 |

## 用户结果与边界

用户会看到：

- Settings 添加 / 编辑小米 MiMo API provider 时，可以选择或手动填入 `mimo-v2.5-pro-ultraspeed`。
- Settings 可以新增一个通用 OpenAI-compatible 三方 API provider，输入 base URL、API key、模型名后在 CodePilot Runtime 和 Codex Runtime 使用。
- Claude Code Runtime 下不会承诺 OpenAI-compatible 三方 API 可用；模型选择和能力文案要明确降级。

本计划明确不做：

- 不把 `mimo-v2.5-pro-ultraspeed` 设为小米默认模型，除非用户后续明确要求。小米文档说明资源有限且需审批，默认仍保守留在 `mimo-v2.5-pro`。
- 不把 UltraSpeed 加到 `xiaomi-mimo-token-plan`。当前用户说“只有小米的 API 渠道可用”，且官方示例走 `api.xiaomimimo.com`。
- 不把 OpenAI-compatible 三方 API 扩成图片、音频、embedding、Responses-only 能力。第一阶段只做聊天模型渠道。
- 不重命名内部 compat tier `codepilot_only`。先修正用户可见 label / tooltip / 类型注释；枚举改名留作后续技术债评估。

## 决策日志

- 2026-06-09: UltraSpeed 官方模型名为 `mimo-v2.5-pro-ultraspeed`；同一模型页“接入方式”明确列出 OpenAI 协议与 Anthropic 协议，并给出 OpenAI-compatible `base_url="https://api.xiaomimimo.com/v1"` 示例。CodePilot 现有小米 PAYG preset 走同一小米 API 渠道，因此先作为 `xiaomi-mimo` preset 的可选模型接入。
- 2026-06-09: 小米同时提供 OpenAI-compatible 和 Anthropic-compatible API 文档，现有 app 的小米 preset 是 Anthropic-compatible。UltraSpeed 文档本身已经列出 Anthropic 协议支持；真实 smoke 的目的改为验证账号审批、端到端 runtime 链路和错误文案，而不是证明协议存在。
- 2026-06-09: OpenAI 三方 API 按通用 OpenAI-compatible provider 处理。它只能走 CodePilot Runtime / Codex Runtime，不能进入 Claude Code Runtime。
- 2026-06-09: `codepilot_only` 当前实际支持 `codepilot_runtime` + `codex_runtime`，但 label 仍写“仅 CodePilot Runtime”。本次必须修文案，否则会造成语义验收失败。
- 2026-06-09: 仓库里有历史 DB migration 会删除 `protocol = 'openai-compatible'` 的 provider。恢复 OpenAI-compatible 前必须先处理这个 P0 阻断，否则用户新建渠道可能在重启后被删。
- 2026-06-09: OpenAI-compatible 聊天 provider 必须和 GPT Image / media preset 分开，不能继承图片模型目录，也不能把 image catalog 暴露到聊天模型 picker。

## 调研依据

### 外部文档

- 小米 UltraSpeed 文档：模型名 `MiMo-V2.5-Pro-UltraSpeed`，模型 ID `mimo-v2.5-pro-ultraspeed`，文档说明其为 MiMo-V2.5-Pro 的超高速体验模式，资源有限并按日审批；能力包含深度思考、工具调用、流式输出；接入方式明确列出 OpenAI 协议与 Anthropic 协议。参考：<https://platform.xiaomimimo.com/docs/zh-CN/model-intro/mimo-v2.5-pro-ultraspeed>
- 小米 OpenAI-compatible API：请求 URL 为 `https://api.xiaomimimo.com/v1/chat/completions`，header 支持 `api-key` 或 `Authorization: Bearer`。参考：<https://platform.xiaomimimo.com/docs/zh-CN/user-manual/openai-api>
- 小米 Anthropic-compatible API：请求 URL 为 `https://api.xiaomimimo.com/anthropic/v1/messages`，header 同样支持 `api-key` 或 `Authorization: Bearer`。参考：<https://platform.xiaomimimo.com/docs/zh-CN/user-manual/anthropic-api>
- OpenAI 官方 API 文档：`GET /v1/models` 返回可用模型列表，Chat Completions / Responses 是 OpenAI 当前主要聊天接口形态。参考：<https://developers.openai.com/api/reference/models/list>、<https://developers.openai.com/api/reference/responses/create>
- Vercel AI SDK 文档：`@ai-sdk/openai-compatible` 面向实现 OpenAI API 的第三方 provider；`@ai-sdk/openai` 也支持 `baseURL`，但新版默认可能使用 Responses API，需要显式评估三方网关是否支持。参考：<https://ai-sdk.dev/providers/openai-compatible-providers>、<https://ai-sdk.dev/providers/ai-sdk-providers/openai>

### 本地代码现状

- Provider preset 单一事实源在 `src/lib/provider-catalog.ts`。已有 `xiaomi-mimo` 和 `xiaomi-mimo-token-plan`，都默认 `mimo-v2.5-pro`；PAYG preset 暴露 `model_names` 以避免旧 `mimo-v2-pro` fallback。
- `src/lib/provider-resolver.ts` 已能把 `protocol: 'openai-compatible'` 转成 OpenAI SDK config；`src/lib/ai-provider.ts` 已使用 `createOpenAI({ baseURL })`。
- `src/lib/runtime-compat.ts` 中 `codepilot_only` 的支持运行时已经包含 CodePilot Runtime 和 Codex Runtime，并排除 Claude Code Runtime；但 label / tooltip 仍有过期文案。
- `src/lib/codex/proxy/provider-parity.ts` 把 `codepilot_only` 视为 Codex proxy ready，因此 OpenAI-compatible provider 只要 compat 分类正确，就应能进入 Codex Runtime provider proxy。
- `src/components/settings/provider-presets.tsx` 当前 preset 保存逻辑没有为 `openai-compatible` 映射 `provider_type`，会落到 `anthropic`，这是新增通用 OpenAI-compatible preset 前必须补的入口。
- `src/lib/db.ts` 里存在“remove explicitly openai-compatible providers”的历史迁移，会删除 `protocol = 'openai-compatible'` 的 provider。这个迁移必须停止伤害新数据。

## 详细设计

### Phase 1：小米 UltraSpeed 模型

目标：

- 在现有 `xiaomi-mimo` API preset 中加入 `mimo-v2.5-pro-ultraspeed` 可选模型。
- 保持 `mimo-v2.5-pro` 为默认模型，避免把审批受限模型设为默认。
- `xiaomi-mimo-token-plan` 暂不加入 UltraSpeed，除非后续有小米 Token Plan 文档或真实 smoke 证明。

建议改动：

- `src/lib/provider-catalog.ts`
  - 在 `xiaomi-mimo.defaultModels` 追加：
    - `modelId: 'mimo-v2.5-pro-ultraspeed'`
    - `displayName: 'MiMo-V2.5-Pro-UltraSpeed'`
    - `upstreamModelId: 'mimo-v2.5-pro-ultraspeed'`
    - capabilities 只标注文档明确支持的 tool use / reasoning / streaming；不要填无来源的 context window。
  - `defaultRoleModels` 继续指向 `mimo-v2.5-pro`。
- `src/__tests__/unit/mimo-model-mapping.test.ts`
  - 新增断言：PAYG preset 包含 UltraSpeed，Token Plan preset 不包含 UltraSpeed。
  - 新增断言：用户配置 `role_models_json.default = 'mimo-v2.5-pro-ultraspeed'` 时 resolver 保持该模型，不回退到默认。
- `src/__tests__/unit/coding-plan-discovery-gate.test.ts`
  - 如 discovery 文案受影响，补充 PAYG API provider 的搜索 / 手动模型行为；Token Plan gate 仍保持 unsupported。

验收：

- 用户在小米 MiMo API provider 的模型输入 / picker 中能选择 UltraSpeed。
- 发送请求时实际传给 provider 的 model ID 是 `mimo-v2.5-pro-ultraspeed`。
- 未配置 UltraSpeed 的既有小米 provider 不发生默认模型变化。

### Phase 2：OpenAI-compatible 三方 API 渠道

目标：

- 新增通用 OpenAI-compatible provider preset，面向用户自己的第三方 OpenAI API base URL。
- 该 provider 只在 CodePilot Runtime 和 Codex Runtime 暴露；Claude Code Runtime 下禁用或不显示。
- 支持手动模型名，支持可靠的 `/v1/models` 发现时再展示搜索结果。

建议改动：

- `src/lib/provider-catalog.ts`
  - 新增通用 chat preset，例如 `openai-compatible` 或 `openai-compatible-third-party`。
  - `protocol: 'openai-compatible'`，`authStyle: 'api_key'`，`fields` 至少包含 `name`、`api_key`、`base_url`、`model_names`。
  - 不预置模型目录，除非用户指定目标渠道；避免把任意三方 API 伪装成官方 OpenAI 或展示假模型。
- `src/components/settings/provider-presets.tsx`
  - quick preset 保存时，`protocol === 'openai-compatible'` 必须写入 `provider_type: 'openai-compatible'` 或等价可识别类型，不能落到 `anthropic`。
  - UI copy 明确这是“OpenAI-compatible / 三方 API”，不是 OpenAI OAuth，也不是 GPT Image。
- `src/app/api/providers/route.ts`
  - POST / PUT 校验 `openai-compatible` provider 必须有非空 base URL。否则 `createOpenAI` 可能默认打到官方 OpenAI `https://api.openai.com/v1`，语义和安全都不对。
- `src/lib/provider-catalog.ts` / `src/lib/runtime-compat.ts`
  - `findMatchingPresetForRecord`、`findPresetForLegacy` 或 `getProviderCompat` 必须能识别 `provider_type = 'openai-compatible'` 的 DB row。
  - compat 保持内部 `codepilot_only` tier，但 supported runtimes 必须是 CodePilot Runtime + Codex Runtime。
- `src/lib/db.ts`
  - 移除或改造历史迁移中的 `DELETE FROM api_providers WHERE protocol = 'openai-compatible'`。
  - 若担心旧错误数据，可改成仅标记 / 迁移 malformed rows，不再删除用户新建的有效三方 API provider。
- `src/lib/ai-provider.ts`
  - 先做 POC：现有 `createOpenAI({ baseURL })` 是否对目标三方渠道调用 Chat Completions，而不是默认 Responses。
  - 若三方渠道不支持 Responses API，OpenAI-compatible provider 应显式使用 chat-completions 路径，例如 `openai.chat(modelId)`，或引入 `@ai-sdk/openai-compatible`。
  - 如需新依赖，按发版纪律执行 `npm install` 同步 lock，并补依赖兼容说明。
- `src/lib/model-discovery.ts`
  - 复用 `/v1/models` 探测，但结果只能作为真实来源展示。
  - 探测失败时允许手动输入模型名；不要展示假 0 或固定 placeholder。

验收：

- 用户能从 Settings 新建 OpenAI-compatible 三方 API provider，保存后重启不丢失。
- provider 出现在 CodePilot Runtime 和 Codex Runtime 的模型选择 / provider 列表中。
- Claude Code Runtime 下不承诺可用；若展示，必须是禁用态且 reason 清楚。
- 该 provider 不继承 GPT Image catalog，不进入 image / media preset 逻辑。

### Phase 3：语义、文案与 Guardrail

建议改动：

- `src/lib/runtime-compat.ts`
  - `compatLabel('codepilot_only')` 从“仅 CodePilot Runtime”改为能表达 CodePilot + Codex 的文案。
  - tooltip 同步说明：该类 provider 走 CodePilot/AI SDK provider proxy，Claude Code 不支持。
- `src/types/index.ts`
  - 更新 `ModelCompatibility.codepilot_only` 注释，避免后续开发者按旧语义误判。
- Settings / Models 页：
  - OpenAI-compatible provider 能力 badge 不要写“Claude Code verified”。
  - 若模型列表来自 `/v1/models`，展示为 discovered；若来自用户手填，展示为 manual / custom。
- Guardrail：
  - 新增或扩展测试，保证 `codepilot_only` 支持 runtime 集合保持 `['codepilot_runtime', 'codex_runtime']`。
  - 新增测试，保证 DB migration 不会删除合法 `openai-compatible` provider。

## 测试计划

单测：

- `src/__tests__/unit/mimo-model-mapping.test.ts`
  - PAYG 小米 preset 包含 `mimo-v2.5-pro-ultraspeed`。
  - Token Plan 小米 preset 不包含 UltraSpeed。
  - resolver 保留用户手动选择的 UltraSpeed。
- `src/__tests__/unit/provider-preset.test.ts`
  - OpenAI-compatible chat preset 存在，协议有效，且不继承 GPT Image catalog。
- `src/__tests__/unit/provider-resolver.test.ts`
  - OpenAI-compatible provider 转成 OpenAI-compatible / OpenAI SDK config 时保留 base URL、model ID、headers。
  - 空 base URL 被 API 层拒绝，不会默认打官方 OpenAI。
- `src/__tests__/unit/runtime-compat-supported-runtimes.test.ts`
  - `codepilot_only` 继续只暴露 CodePilot Runtime + Codex Runtime。
  - Claude Code Runtime 对 OpenAI-compatible provider 保持 gated。
- `src/__tests__/unit/codex-proxy-virtual-providers.test.ts`
  - Codex Runtime 下暴露的 OpenAI-compatible provider 都能被 proxy resolver 解析。
- 新增 migration / DB 测试
  - 合法 `protocol = 'openai-compatible'` provider 在启动 / 迁移后不会被删除。

命令：

- `npm run test`
- 涉及 Settings UI / picker 后，再跑 `npm run test:smoke`
- 若有新依赖或 SDK 调整，再跑 `npx next build`

轻量 UI 验证：

- 用 Browser 打开 dev server 的 Settings Providers。
- 新建小米 MiMo API provider，确认 UltraSpeed 模型可见。
- 新建 OpenAI-compatible provider，确认 base URL / model_names 表单、保存、刷新、编辑均正常。
- 切换 CodePilot / Codex / Claude Code Runtime，确认 OpenAI-compatible provider 的可用性和禁用文案符合预期。

真实 smoke：

- 小米：使用已获 UltraSpeed 审批的小米 API key，跑一轮 streaming chat，记录 provider id、runtime、model、时间和证据。
- OpenAI-compatible：选一个真实三方渠道，跑 CodePilot Runtime streaming chat，再跑 Codex Runtime provider proxy chat。
- Claude Code：只验证禁用 / 不暴露，不需要真实请求。

## Smoke Ledger（真实凭据 / UI / E2E 验证记录）

> 跑了真实 smoke 后必须在这里登记一行：Runtime / Provider / Model / 凭据形态 / 场景 / 结果 / 证据。不要把这类信息只留在聊天里，下次切回这个 Phase 时翻不到。

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _待执行_ | codepilot_runtime | Xiaomi MiMo API | mimo-v2.5-pro-ultraspeed | MIMO API key，需 UltraSpeed 审批 | one-turn streaming chat | ⏸ | 等待真实凭据 |
| _待执行_ | codepilot_runtime | OpenAI-compatible third-party | 用户手填模型 | API key + base URL | one-turn streaming chat | ⏸ | 等待测试渠道 |
| _待执行_ | codex_runtime | OpenAI-compatible third-party | 用户手填模型 | API key + base URL | Codex provider proxy one-turn chat | ⏸ | 等待测试渠道 |
| _待执行_ | claude_code | OpenAI-compatible third-party | 用户手填模型 | 不发请求 | picker gated / disabled reason | ⏸ | 等待 UI smoke |

## Claude Code 审查补充（2026-06-09）

> 这些是执行前必须补进实现清单的 review findings。结论：原计划方向成立，但 OpenAI-compatible runtime 归类链路若只加 preset 会“跑反”，必须先补认领分支和入口。

### P0：OpenAI-compatible 若未被 preset matcher 认领，会变成 `unknown`

代码事实：

- `getProviderCompat()` 只接收 `{ provider_type, base_url }`，再通过 `findMatchingPresetForRecord()` 认领 preset。
- `findMatchingPresetForRecord()` 当前只对 `bedrock`、`vertex`、`openrouter`、`gemini-image`、`openai-image`、`anthropic` 有分支，没有 `openai-compatible`。
- 认领失败会返回 `unknown`；`unknown` tier 当前支持 `claude_code` + `codepilot_runtime`，并 gated `codex_runtime`。

风险：

- 这会把目标行为完全判反：OpenAI-compatible 三方 API 本应 CodePilot + Codex 可用、Claude Code 禁用；若落入 `unknown`，UI 会把它暴露给 Claude Code，并把 Codex 挡掉。

执行要求：

- 在 `src/lib/provider-catalog.ts` 的 `findMatchingPresetForRecord()` 增加 `provider_type === 'openai-compatible'` 认领分支，参考 `gemini-image` / `openai-image` 第三方 preset 的写法。
- 同步 renderer 侧 `src/components/settings/provider-presets.tsx::findMatchingPreset()`，否则服务端和设置页会出现不同判断。
- 新增单测锁死：`provider_type = 'openai-compatible'` + 任意非空 base URL 必须归到 `codepilot_only`，supported runtimes 必须是 `['codepilot_runtime', 'codex_runtime']`，Claude Code 必须 gated。

### P1：添加 provider 入口不止 quick preset

代码事实：

- 原计划只提了 `src/components/settings/provider-presets.tsx`。
- 但 fallback / 完整表单 `src/components/settings/ProviderForm.tsx` 内部也有 `PROVIDER_PRESETS` 和 `PROVIDER_TYPES`。
- 当前 `custom` 在该表单里写死为 `protocol: 'anthropic'`，且列表没有 OpenAI-compatible 选项。

执行要求：

- `ProviderForm.tsx` 也要新增 OpenAI-compatible 选项，或者确保所有新增三方 OpenAI 入口都走统一 quick preset dialog，不会落回 custom-as-anthropic。
- POST / PUT 后端校验要覆盖两个入口，不能只覆盖 quick preset 提交流程。

### P1：文案改动必须同步 i18n

代码事实：

- `compatLabel('codepilot_only')` 和 `compatTooltip('codepilot_only')` 目前在 `src/lib/runtime-compat.ts` 里写死为 “仅 CodePilot Runtime”。
- 但 Settings / provider / model 文案大量走 `src/i18n/en.ts` 与 `src/i18n/zh.ts`。

执行要求：

- 改 Runtime / provider / model 可见文案时，同步检查并更新 `src/i18n/en.ts`、`src/i18n/zh.ts`。
- 验收时切中英文各看一遍 Settings Providers、Models 和模型 picker，避免只修一边语言。

### P1：小米 UltraSpeed 协议支持已由官方文档确认，真实 smoke 只验证审批与集成

代码事实：

- UltraSpeed 官方模型页的“接入方式”明确列出 OpenAI 协议和 Anthropic 协议。
- 同页 OpenAI-compatible 代码示例使用 `model: mimo-v2.5-pro-ultraspeed`；官方 Anthropic-compatible API 文档给出了同一小米 API 渠道的 `/anthropic/v1/messages` 形态。
- CodePilot 现有 `xiaomi-mimo` preset 走 Anthropic-compatible base URL，属于小米 API 渠道，不是 Token Plan。

执行要求：

- 可以把 `mimo-v2.5-pro-ultraspeed` 加入现有 `xiaomi-mimo` PAYG/API preset 的可选模型列表；不需要另建小米 OpenAI-compatible preset 来承载它。
- 真实 smoke 仍然需要跑，但目的改为验证账号审批状态、端到端 runtime 链路、streaming、tool calling / thinking 行为和错误文案；不是协议支持的前置证明。
- Smoke Ledger 必须记录端点、runtime、model、响应 marker 或错误码。若因账号未获 UltraSpeed 审批失败，也应登记为权限/审批失败，而不是协议不支持。

### P2：删除迁移的风险表述要精确

补充判断：

- 现阶段由于 UI 还没有有效创建 OpenAI-compatible provider 的路径，这条 migration 多半只会删除历史遗留行。
- 真正风险是在 Phase 2 增加创建入口后，如果不先移除 / 改造该 migration，用户新建的合法 OpenAI-compatible provider 会在后续启动或迁移时被清掉。

执行要求：

- 仍然保持“实现创建入口前先拆 migration”的顺序。
- 测试要覆盖“新增合法 openai-compatible row 后迁移不删除”，而不是只验证当前库里有没有被删的数据。

### 实现进度（Claude Code，2026-06-09）

Phase 1 + Phase 2 已落地，`npm run test`（typecheck + 3307 单测）全绿。改动文件：

- `src/lib/provider-catalog.ts` — 新增通用 `openai-compatible` preset（空 catalog、非 sdkProxyOnly、不标 claudeCodeVerified）；`findMatchingPresetForRecord` + `inferProtocolFromLegacy` 加 openai-compatible 认领；`xiaomi-mimo` PAYG preset 加 `mimo-v2.5-pro-ultraspeed`（非默认）。
- `src/components/settings/provider-presets.tsx` — `toQuickPreset` 协议→`provider_type` 映射 + `findMatchingPreset` 加 openai-compatible 认领（与服务端 matcher 对齐，避免设置页/运行时判断分叉）。
- `src/components/settings/ProviderForm.tsx` — `PROVIDER_PRESETS` + `PROVIDER_TYPES` 加 OpenAI-Compatible 选项（protocol=`openai-compatible`，不再 custom-as-anthropic）。
- `src/lib/db.ts` — 移除 `DELETE FROM api_providers WHERE protocol = 'openai-compatible'` 破坏性迁移（backfill 保留）。
- `src/lib/ai-provider.ts` — 非 OAuth 的 openai 路径改 `openai.chat()`：`@ai-sdk/openai@3.0.34` 的裸 `openai(modelId)` 默认走 `/v1/responses`，第三方网关只认 `/v1/chat/completions`；Codex OAuth 的 `.responses()` 分支（`useResponsesApi`）不受影响。此改动同时修正 openrouter `/v1` 与 bedrock/vertex/google 带 base_url 的代理路径。
- `src/app/api/providers/route.ts` — openai-compatible 必须非空 base_url（否则 createOpenAI 默认打 `api.openai.com`，错服务 + key 泄露）。
- 单测：`openai-compatible-provider.test.ts`（新）端到端分类 = `codepilot_only`（CodePilot+Codex、Claude Code gated）+ 迁移不删 + 入口/路径源码 pin；`mimo-model-mapping.test.ts` + `provider-preset.test.ts` 补 UltraSpeed / preset 断言。

### Codex round 2 修复（2026-06-10）

Codex 复审提的 2 个 P1 + 1 个 P2 已修，`npm run test`（typecheck + 3313 单测）全绿：

- **[P1] Test 连接**（`claude-client.ts`）—— 新增 `testOpenAICompatibleConnection`：openai-compatible 走 GET `{base}/models` + Bearer 探针（对齐 openai-image 探针）；空 base URL 直接返回 `MISSING_BASE_URL`、不发请求，杜绝把 key 发到官方 Anthropic。原先所有非 anthropic/media 协议都落到 `/v1/messages` + x-api-key 的 fallback。
- **[P1] PUT 编辑守卫**（`providers/[id]/route.ts`）—— 把 POST 的 openai-compatible 空 base_url 拦截镜像到编辑路径，防止编辑清空 URL 后 createOpenAI 回落官方 OpenAI。
- **[P2] Runtime 文案**（`runtime-compat.ts` + `types/index.ts`）—— `codepilot_only` 的 label / tooltip / 类型注释从"仅 CodePilot Runtime"改为"CodePilot + Codex，不支持 Claude Code"，闭合本次交付的语义验收。
- 测试：`openai-compatible-provider.test.ts` 增 POST/PUT 守卫行为测试 + label/tooltip 断言 + test-connection 探针源码 pin（claude-client 静态 import 了 agent SDK，不宜在单测直接 import）。

收尾（2026-06-10）：
- 又清掉一条残留旧注释 `runtime-compat.ts:38`（OpenRouter `/v1` skin 仍写 "CodePilot Runtime only" → 改为 CodePilot + Codex）。
- **本地 UI smoke 已做**（dev server `localhost:3001`，Chrome 驱动）：Settings → 服务商 → 添加服务，"OpenAI-Compatible API" 预设出现在"第三方 / 中转兼容"组；连接弹窗字段为 名称 / 基础 URL / API Key / 模型名称 + 测试连接；**空 base URL 点测试连接返回 "Base URL is required for OpenAI-compatible providers"（P1 修复真实路径验证，未按 Anthropic 协议乱测、未发请求）**。截图：`screenshots/openai-compatible-test-empty-url.png`。

未做（等凭据）：真实发送链路 smoke —— 小米审批 key 跑 UltraSpeed、第三方 OpenAI 渠道 key 跑 CodePilot + Codex 一轮 streaming；以及 Phase 3 剩余的模型来源（实测 / 手填）标识。

## 待确认问题

- 用户说“一个渠道两个模型”时，除小米 UltraSpeed 外是否还有第二个明确模型需要加入。当前计划只把 OpenAI 三方 API 作为通用渠道，不预置具体模型。
- OpenAI-compatible 三方 API 第一批是否有指定目标渠道。如果有，应补一条 provider-specific smoke 记录，并确认该渠道是否支持 `/v1/models`、Chat Completions、Responses、tool calling、stream usage。
- 小米 UltraSpeed 是否需要在 UI 上展示“需审批 / 资源有限”提示。若展示，文案必须来自官方文档或真实错误码，不要臆测额度。
