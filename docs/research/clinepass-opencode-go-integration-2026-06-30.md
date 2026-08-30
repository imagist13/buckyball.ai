# ClinePass / OpenCode Go 接入调研

> 日期：2026-06-30
> 角色边界：Codex 只做调研、复现和执行计划，不改产品代码。
> 目标：判断 ClinePass 与 OpenCode Go 这两类订阅 / Code Plan 服务如何接入 CodePilot 的 Provider / Runtime / Model Discovery 体系。

> 2026-07-20 更新：两个套餐均加入 Kimi K3。OpenCode Go 官方 endpoint
> 表明确给出显示名 `Kimi K3`、直连模型 ID `kimi-k3` 和
> OpenAI-compatible `/chat/completions` 路径；ClinePass 的公共静态模型页尚未
> 同步，但按 Cline 官方 `provider/model-name` 合同使用
> `cline-pass/kimi-k3`，并用本机已配置凭据做 4-output-token 最小请求，HTTP
> 200，响应确认上游模型为 `moonshotai/kimi-k3`。两项都只更新各自
> catalog-only 白名单，不改变协议或 discovery 策略。Kimi 官方虽确认 K3
> 支持 low/high/max，但这不能证明两个聚合网关接受同一 effort 请求字段；
> 在各网关 wire 未验证前，不给这两个条目声明 `supportsEffort`，避免 UI
> 出现“可选择但未发送”的假能力。

## 结论先行

建议分两步接入：

1. **先做 catalog-only 预设**，禁用自动全量刷新。
   - `cline-pass`：OpenAI-compatible Chat Completions。
   - `opencode-go-openai`：OpenCode Go 的 OpenAI-compatible 模型。
   - `opencode-go-anthropic`：OpenCode Go 的 Anthropic Messages 模型。
2. **后做 filtered discovery**，不要复用当前通用 `/v1/models` 自动写库逻辑。
   - Cline API 官方定位是通过单一 endpoint 访问多个 provider 的模型，不等同于 ClinePass 白名单；需要只接收 `cline-pass/*`。
   - OpenCode Go 的 `/zen/go/v1/models` 返回混合目录；同一个列表里既有 OpenAI-compatible 模型，也有 Anthropic Messages 模型。必须按 preset 过滤，否则会把只能走 `/messages` 的 Qwen / MiniMax 写进 OpenAI provider，或把只能走 `/chat/completions` 的 GLM / Kimi 写进 Anthropic provider。

不要为了命中现有 `isCatalogOnlyPlanProvider()` gate 而把这些 preset 硬标成 `sdkProxyOnly`。`sdkProxyOnly` 当前语义是“只能走 Claude Code SDK wire protocol，Native Runtime 不应直连”，而 ClinePass 和 OpenCode Go OpenAI 都是 OpenAI-compatible；OpenCode Go Anthropic 也是标准 Anthropic Messages 形状。更合适的是增加显式的 discovery policy 或对这些 preset 做定向过滤。

## 复核结论（Claude Code 核对 · 2026-06-30）

> 复核范围：外部事实（对 live 源核验）+ 本文档对仓库代码的全部断言（逐文件核对）。
> 结论：**方向成立，可进入执行计划**；外部事实全部属实；有一处架构成本被低估，另有少量符号/措辞需更正。下方 `file:line` 指向代码，可直接定位。

### 外部事实 — 全部 CONFIRMED
- OpenCode Go `GET /zen/go/v1/models` 实测返回 200，20 个 id 与「外部事实 › OpenCode Go › 本机只读探测」列表逐一致（含顺序）。
- OpenCode Go 双协议拆分（`/chat/completions` vs `/messages`）与「官方 endpoint 表」的模型归属，与官方文档完全一致；定价（首月 $5、之后 $10/月）属实。
- ClinePass：$9.99/月、「官方 ClinePass 模型白名单」10 个 `cline-pass/*`、OpenAI 兼容 Chat Completions、`api.cline.bot/api/v1/chat/completions`、Bearer 认证 —— 全部属实。

### 🔴 被低估的架构成本：`openai-compatible` + `coding_plan` 是本仓库不存在的新类别
- 现仓库**所有** `coding_plan`/`token_plan` preset 均为 `protocol:'anthropic'` + `sdkProxyOnly:true`（`src/lib/provider-catalog.ts:547`/`567`/`594`/`753`/`871`）；唯一的 `openai-compatible` preset 是通用网关，且为 `pay_as_you_go`、无 `sdkProxyOnly`（`src/lib/provider-catalog.ts:502-517`）。本文档提议的 `cline-pass` / `opencode-go-openai` 是 `openai-compatible` + `coding_plan`，**仓库内无先例**。
- 现有「catalog-only 保护」全部绑定 `sdkProxyOnly`：`isCatalogOnlyPlanProvider()` 定义为 `sdkProxyOnly && billingModel ∈ {coding_plan, token_plan}`（`src/lib/provider-catalog.ts:1208-1215`），且 `src/__tests__/unit/coding-plan-discovery-gate.test.ts` 已把该不变量钉死。
- 本文档（正确地）主张不设 `sdkProxyOnly`，但**直接后果**是：`isCatalogOnlyPlanProvider()` 对新 preset 返回 false → 既有 plan 保护全部不生效 → 新 preset 掉进通用 `openai-compatible` 的 `/models` 自动写库路径（`src/lib/model-discovery.ts:447`），正是「为什么不能直接自动应用 `/models`」要避免的污染。
- 因此「Claude Code 执行清单」里「`canReliablyFetchModels()` 返回 false / `classifyProvider()` 返回 unsupported」不是顺手数行，而是要在 **3 个 gate**（`canReliablyFetchModels` `provider-catalog.ts:1451` / `canSearchUpstreamModels` `provider-catalog.ts:1570` / `classifyProvider` `model-discovery.ts:132`）**+ 各自测试**里为该新类别新增判定。
- **建议**：优先采用本文档「推荐新增一个显式 discovery policy」一节的 `modelDiscoveryMode` 显式 schema，而非把 preset key 硬编码进 3 个 gate —— 后者脆弱且背离现有「数据驱动（按 `sdkProxyOnly` + `billingModel` 判定）」写法。把「新增 openai-compatible + coding_plan catalog-only 类别」作为显式设计决策写进执行计划，并列出要改的 gate 函数与要新增/扩展的测试（含 `coding-plan-discovery-gate.test.ts` 覆盖扩展）。

### 🟡 符号 / 措辞更正
- `ClaudeCodeCompatAdapter` 实际类名为 **`ClaudeCodeCompatModel`**（`src/lib/claude-code-compat/claude-code-compat-model.ts:41`，工厂 `createClaudeCodeCompatModel`，`index.ts:19`）；仓库内无 `ClaudeCodeCompatAdapter` 符号。本文档「本仓库接入判断」与「推荐预设形状 › OpenCode Go - Anthropic Messages › Runtime」两处原文已据此更正。后续实现复测又发现跨 runtime 更稳的 OpenCode Go Anthropic base 是不带 `/v1` 的 `https://opencode.ai/zen/go`，最终统一拼到 `/zen/go/v1/messages`。
- 「为什么 OpenCode Go 不能做成一个 provider」一节的 `ApiProvider` 措辞需注意：preset 类型是 `VendorPreset`（`src/lib/provider-catalog.ts:87`）；`ApiProvider`（`src/types/index.ts:279`）是**存库的 provider 记录**，不含 `protocol`/`defaultModels` 等 preset 字段。「protocol 在 provider 层而非 model 层」论点成立，但不应把二者并列为 preset 类型。

### 🟢 已核实属实
- `VendorPreset` 字段（`key`/`protocol`/`authStyle`/`baseUrl`/`defaultModels`/`fields`/`iconKey`/`meta`）齐全；`defaultModels` 必须是 `CatalogModel[]` 对象（`provider-catalog.ts:105`，Zod 强校验），`CatalogModel = { modelId, upstreamModelId?, displayName, role?, capabilities? }`（`provider-catalog.ts:47`）。
- `meta.billingModel:'coding_plan'` 为合法值（`provider-catalog.ts:133`）。
- `codepilot_only` 语义属实：`codepilot_runtime` + `codex_runtime` 支持、`claude_code` 不支持（`src/lib/runtime-compat.ts:212-234`）。
- `provider-resolver.ts` 同时处理 `protocol:'openai-compatible'`（`:764`）与 `'anthropic'`（`:689`）；第三方 Anthropic host 路由到 `sdkType:'claude-code-compat'`（`:706`）。`openai.chat(modelId)`（非 Responses API）在 `src/lib/ai-provider.ts:300`。
- `CODING_PLAN_KEYS`（`src/components/settings/ProviderManager.tsx:70`）用于 Add Service 分桶；`provider-presets.tsx` 的 `QUICK_PRESETS` 由 `VENDOR_PRESETS` 派生，非第二真相源。

### 仍需在实施前定义
1. `defaultModels` 的 `CatalogModel` 必填字段未列全 —— context window / 价格 / 能力（tool use / vision）缺失会命中「语义验收与反假数据」（上下文用量、token badge、能力清单显示假值）。实施前需为每个模型明确这些字段来源，或显式标「估算 / 未知」。
2. 两个 OpenCode Go preset 共用一个 API key 的 UX 未交代 —— 当前凭据按 provider 存储，拆两个 provider 意味着用户填两遍、轮换改两处。需决策是否复用 / 联动。

## 外部事实

### ClinePass

官方文档：
- ClinePass 是独立 provider，月费 9.99 美元，提供一组面向 coding agent 的开源模型与 2-5x API rate limits。
- ClinePass 可在 Cline 外通过 Cline API 调用；Cline API 使用 OpenAI-compatible Chat Completions。
- 认证方式是 `Authorization: Bearer <token>`。
- Chat Completions endpoint 是 `POST https://api.cline.bot/api/v1/chat/completions`。
- Cline API model id 使用 `provider/model-name` 形式。

ClinePass 模型白名单（2026-06-30 官方静态目录 + 2026-07-20 K3 真实 wire 补充）：

| Display | Model ID |
|---|---|
| GLM-5.2 | `cline-pass/glm-5.2` |
| Kimi K3 | `cline-pass/kimi-k3` |
| Kimi K2.7 Code | `cline-pass/kimi-k2.7-code` |
| Kimi K2.6 | `cline-pass/kimi-k2.6` |
| DeepSeek V4 Pro | `cline-pass/deepseek-v4-pro` |
| DeepSeek V4 Flash | `cline-pass/deepseek-v4-flash` |
| MiMo-V2.5 | `cline-pass/mimo-v2.5` |
| MiMo-V2.5-Pro | `cline-pass/mimo-v2.5-pro` |
| MiniMax M3 | `cline-pass/minimax-m3` |
| Qwen3.7 Max | `cline-pass/qwen3.7-max` |
| Qwen3.7 Plus | `cline-pass/qwen3.7-plus` |

本机只读探测：
- `GET https://api.cline.bot/api/v1/models` 无 key 返回 401。
- `GET https://api.cline.bot/api/v1/chat/completions` 无 key 返回 401。
- 这说明发现 / 验证都需要用户保存 Cline API key 后再做；不能把无 key 401 当服务不可用。
- 2026-07-20 用已保存 key 重试 `/api/v1/models` 返回 404；当前公开 API 文档也只
  描述模型目录能力字段，没有公布可调用的 models endpoint。因此仍保持
  catalog-only，不把这个 404 解读成 K3 不可用。
- 同日对 `POST /api/v1/chat/completions` 发送 `model=cline-pass/kimi-k3`、
  `max_tokens=4` 的最小非流式请求，HTTP 200；响应 `model` 为
  `moonshotai/kimi-k3`。这条真实 wire 证据确认了 ClinePass K3 的精确 ID。

### OpenCode Go

官方文档：
- OpenCode Go 是 OpenCode Zen 的订阅服务，首月 5 美元，之后每月 10 美元。
- 用户订阅后获得 API key。
- 官方说明模型托管在 US / EU / Singapore。
- 官方 endpoint 表把模型分成两种 wire protocol：
  - OpenAI-compatible Chat Completions：`https://opencode.ai/zen/go/v1/chat/completions`
  - Anthropic Messages：`https://opencode.ai/zen/go/v1/messages`
- OpenCode 配置中的模型 id 使用 `opencode-go/<model-id>`，但直接调用 API endpoint 时 model 字段使用裸模型 id。
- 官方给出完整模型列表 endpoint：`https://opencode.ai/zen/go/v1/models`。

官方 endpoint 表：

| Protocol | Models | CodePilot preset base URL |
|---|---|---|
| OpenAI-compatible | `glm-5.2`, `glm-5.1`, `kimi-k3`, `kimi-k2.7-code`, `kimi-k2.6`, `deepseek-v4-pro`, `deepseek-v4-flash`, `mimo-v2.5`, `mimo-v2.5-pro` | `https://opencode.ai/zen/go/v1` |
| Anthropic Messages | `minimax-m3`, `minimax-m2.7`, `minimax-m2.5`, `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus` | `https://opencode.ai/zen/go` |

本机只读探测：
- `GET https://opencode.ai/zen/go/v1/models` 无 key 返回 200，OpenAI-style `{ object: "list", data: [...] }`。
- 2026-06-30 实测返回 20 个 id：`minimax-m3`, `minimax-m2.7`, `minimax-m2.5`, `kimi-k2.7-code`, `kimi-k2.6`, `kimi-k2.5`, `glm-5.2`, `glm-5.1`, `glm-5`, `deepseek-v4-pro`, `deepseek-v4-flash`, `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus`, `qwen3.5-plus`, `mimo-v2-pro`, `mimo-v2-omni`, `mimo-v2.5-pro`, `mimo-v2.5`, `hy3-preview`。
- `POST /zen/go/v1/chat/completions` 无 key 返回 401 `Missing API key`；伪 `Authorization: Bearer bogus` 返回 401 `Invalid API key`。
- `POST /zen/go/v1/messages` 无 key 返回 401 `Missing API key`；伪 `x-api-key: bogus` 返回 401 `Invalid API key`；伪 `Authorization: Bearer bogus` 仍是 `Missing API key`。因此 Anthropic Messages preset 应使用 `authStyle: api_key`，不是 `auth_token`。
- `POST /zen/go/v1/v1/messages` 返回 404 HTML。Anthropic preset 的存储 base 必须去掉尾部 `/v1`，让各 runtime 统一拼出 `https://opencode.ai/zen/go/v1/messages`。
- 2026-07-20 对 `POST /zen/go/v1/chat/completions` 发送 `model=kimi-k3`、
  `max_tokens=4` 的最小非流式请求，HTTP 200，响应 `model=kimi-k3`。这条
  真实 wire 证据与当天官方 endpoint 表一致。

## 本仓库接入判断

### 现有结构

关键出口：

| 关注点 | 当前位置 |
|---|---|
| preset truth source | `src/lib/provider-catalog.ts` |
| Provider Add Service UI quick presets | `src/components/settings/provider-presets.tsx` |
| Add Service 分桶 | `src/components/settings/ProviderManager.tsx` 的 `CODING_PLAN_KEYS` |
| Native Runtime model factory | `src/lib/ai-provider.ts` |
| OpenAI-compatible resolver | `src/lib/provider-resolver.ts` 的 `protocol: 'openai-compatible'` |
| Anthropic third-party resolver | `src/lib/provider-resolver.ts` + `src/lib/claude-code-compat/` |
| Runtime compatibility badge / picker gate | `src/lib/runtime-compat.ts` |
| model discovery 分类与 probe | `src/lib/model-discovery.ts` |
| “刷新模型”按钮 gate | `canReliablyFetchModels()` in `src/lib/provider-catalog.ts` |
| “添加模型”搜索 gate | `canSearchUpstreamModels()` in `src/lib/provider-catalog.ts` |

现有 `openai-compatible` 预设已经支持任意 OpenAI Chat Completions 网关，且单元测试明确要求：
- `base_url` 不可为空。
- Runtime compat 是 `codepilot_only`，实际表示 CodePilot Runtime + Codex Runtime 支持，Claude Code Runtime 不支持。
- AI SDK 路径必须用 `openai.chat(modelId)`，不是 Responses API。

OpenCode Go Anthropic 端点应走 `protocol: 'anthropic'`，preset `baseUrl: 'https://opencode.ai/zen/go'`。官方真实 endpoint 仍是 `https://opencode.ai/zen/go/v1/messages`；base 存成不带 `/v1` 是为了兼容 Claude Code SDK / provider proxy / `ClaudeCodeCompatModel` 的统一拼接契约，避免写成 `.../zen/go/v1/v1/messages`。

### 为什么 OpenCode Go 不能做成一个 provider

当前运行时只会给一个服务入口选择一种 wire protocol；仓库里的 preset 是这个入口的配置来源，存库 provider 记录则保存用户实际创建出来的服务。无论从哪个层面看，协议都不是 model-level 配置。一个 provider 无法让一部分模型走 OpenAI Chat Completions，另一部分模型走 Anthropic Messages。

如果只做一个 OpenAI-compatible provider：
- MiniMax / Qwen 会被送到 `/chat/completions`，与官方 endpoint 表不符。

如果只做一个 Anthropic provider：
- GLM / Kimi / DeepSeek / MiMo 会被送到 `/messages`，与官方 endpoint 表不符。

所以最小可落地方案是拆成两个 OpenCode Go preset，共用同一个 API key 和同一个 base host，但协议不同、模型列表不同。

### 为什么不能直接自动应用 `/models`

当前 `model-discovery.ts` 对 `openai-compatible` 的默认行为是探测 `${baseUrl}/v1/models`，再由 apply 层保守写入 DB。这个通用行为对 OpenCode Go 和 ClinePass 都有风险：

- OpenCode Go `/models` 是混合目录，不告诉每个模型该走 `/chat/completions` 还是 `/messages`。直接写入任一拆分 preset 都会污染模型列表。
- Cline API 文档把 Cline API 定位为通过单一 endpoint 访问多个 provider 的模型；ClinePass 只是其中的 `cline-pass/*` 子集。直接写入会把非 ClinePass 模型混进 ClinePass provider。

推荐新增一个显式 discovery policy，而不是复用 `sdkProxyOnly`：

```ts
meta: {
  billingModel: 'coding_plan',
  modelDiscoveryMode: 'catalog_only' | 'filtered_models_endpoint',
  discoveryModelIdAllowlist?: string[],
  discoveryModelIdPrefix?: string,
}
```

这不是只在 preset 里多写几个字段：现有 `VendorPreset.meta` / `PresetMetaSchema` 还不认识这些字段，实施时必须同步扩类型、Zod schema、3 个 discovery gate 和测试。否则这些字段会被静态校验挡住，或者写了也不会生效。

如果不想扩 schema，短期可以先在 `classifyProvider()` / `canReliablyFetchModels()` / `canSearchUpstreamModels()` 里按 preset key 特判为不可靠，并用测试钉住。这个方案能先上线，但后续新增同类套餐时会继续累积特判。

## 推荐预设形状

以下片段只是接入形状示意，不是可直接复制的完整 preset。实际实现里需要补齐 `description`、`descriptionZh` 等必填字段，并把 `defaultModels` 写成 `CatalogModel[]` 对象。

每个 `CatalogModel` 至少需要：
- `modelId`：CodePilot 内显示 / 选择的模型 id。
- `displayName`：用户可读名称，优先照官方文档。
- `upstreamModelId`：只有当用户看到的 id 与真实请求 id 不同时才填。
- `role` / `capabilities`：只有在有来源依据时才填；不要为了凑 UI badge 伪造 context window、vision、tool use 或价格信息。

### ClinePass

```ts
{
  key: 'cline-pass',
  name: 'ClinePass',
  protocol: 'openai-compatible',
  authStyle: 'api_key',
  baseUrl: 'https://api.cline.bot/api/v1',
  defaultEnvOverrides: {},
  defaultModels: [
    /* CatalogModel objects for the 11 cline-pass/* ids above */
  ],
  fields: ['api_key'],
  iconKey: 'cline',
  meta: {
    apiKeyUrl: 'https://app.cline.bot',
    docsUrl: 'https://docs.cline.bot/getting-started/clinepass',
    billingModel: 'coding_plan',
    notes: ['ClinePass models use cline-pass/<model-id> slugs.'],
  },
}
```

Runtime:
- CodePilot Runtime：支持。
- Codex Runtime：支持，走 provider proxy 的 OpenAI-compatible path。
- Claude Code Runtime：不支持，按 `codepilot_only` gate 隐藏。

Discovery:
- Phase 1：catalog-only，不显示“刷新模型”。
- Phase 2：若实现 filtered discovery，仅允许 `id.startsWith('cline-pass/')`。

### OpenCode Go - OpenAI-compatible

```ts
{
  key: 'opencode-go-openai',
  name: 'OpenCode Go (OpenAI)',
  protocol: 'openai-compatible',
  authStyle: 'api_key',
  baseUrl: 'https://opencode.ai/zen/go/v1',
  defaultEnvOverrides: {},
  defaultModels: [
    /* CatalogModel objects for:
       glm-5.2, glm-5.1, kimi-k3, kimi-k2.7-code, kimi-k2.6,
       deepseek-v4-pro, deepseek-v4-flash,
       mimo-v2.5, mimo-v2.5-pro */
  ],
  fields: ['api_key'],
  iconKey: 'opencode',
  meta: {
    apiKeyUrl: 'https://opencode.ai/auth',
    docsUrl: 'https://opencode.ai/docs/zh-cn/go/',
    billingModel: 'coding_plan',
  },
}
```

Runtime:
- CodePilot Runtime：支持。
- Codex Runtime：支持。
- Claude Code Runtime：不支持。

Discovery:
- Phase 1：catalog-only。
- Phase 2：可读 `https://opencode.ai/zen/go/v1/models`，但只保留官方 OpenAI-compatible allowlist。

### OpenCode Go - Anthropic Messages

```ts
{
  key: 'opencode-go-anthropic',
  name: 'OpenCode Go (Anthropic)',
  protocol: 'anthropic',
  authStyle: 'api_key',
  baseUrl: 'https://opencode.ai/zen/go',
  defaultEnvOverrides: {},
  defaultModels: [
    /* CatalogModel objects for:
       minimax-m3, minimax-m2.7, minimax-m2.5,
       qwen3.7-max, qwen3.7-plus, qwen3.6-plus */
  ],
  fields: ['api_key'],
  iconKey: 'opencode',
  meta: {
    apiKeyUrl: 'https://opencode.ai/auth',
    docsUrl: 'https://opencode.ai/docs/zh-cn/go/',
    billingModel: 'coding_plan',
    claudeCodeVerified: false,
  },
}
```

Runtime:
- CodePilot Runtime：应支持，走 `ClaudeCodeCompatModel`。
- Codex Runtime：应支持，走 provider proxy Anthropic path。
- Claude Code Runtime：可能支持，但不能在无真实 key smoke 前标 `claudeCodeVerified: true`。先以 experimental tone 上线更诚实。

Discovery:
- Phase 1：catalog-only。
- Phase 2：可读 `https://opencode.ai/zen/go/v1/models`，但只保留官方 Anthropic Messages allowlist。

## Claude Code 执行清单

先写判断过程，再执行改动：

1. 用户问题和争议
   - 用户希望接入 ClinePass / OpenCode Go 这类竞品订阅 Code Plan。
   - 争议点不是“能不能调用”，而是模型目录、协议路由和刷新语义是否会误导用户。
   - OpenCode Go 是混合 wire protocol；ClinePass 是 Cline API 的子集，不等同于整个 Cline API。

2. 取舍理由
   - 不做单一 OpenCode Go provider，因为当前 provider 层协议无法 per-model dispatch。
   - 不直接开启 `/models` 自动刷新，因为会把套餐外或错协议模型写进 DB。
   - 不滥用 `sdkProxyOnly` 触发 plan gate，因为会污染 runtime / doctor 语义。
   - 先 catalog-only 上线最安全；filtered discovery 可作为后续增强。

3. 实施清单
   - discovery policy 前置设计
     - 首选：扩展 preset meta 的显式 discovery policy，并把它接到 `canReliablyFetchModels()`、`canSearchUpstreamModels()`、`classifyProvider()`。
     - 备选：不扩 schema 时，必须在上述 3 个 gate 里对 3 个新 preset 做同一组 catalog-only 判定。
     - 不允许只新增 preset 后依赖现有 `sdkProxyOnly && billingModel` gate；这会漏掉 `openai-compatible + coding_plan`。
   - `src/lib/provider-catalog.ts`
     - 新增 3 个 preset：`cline-pass`, `opencode-go-openai`, `opencode-go-anthropic`。
     - 为新 preset 增加 `CatalogModel[]` 形式的 defaultModels，displayName 与官方文档一致；未知能力不要伪造。
     - 设置 `meta.billingModel: 'coding_plan'` 以显示“套餐 Token”接入方式。
     - 不设置 `sdkProxyOnly`，除非代码注释同步改掉其语义。
     - 如果采用显式 discovery policy，同步更新 `VendorPreset.meta` 与 `PresetMetaSchema`。
   - `src/components/settings/provider-presets.tsx`
     - 同步 quick presets。
     - 增加 icon 映射；没有品牌图标时先用通用 code / server icon，避免破图。
   - `src/components/settings/ProviderManager.tsx`
     - 把新 key 放入 Add Service 的 Coding Plan / subscription 类分桶。
     - 先决策 OpenCode Go 两个 preset 共用 API key 的体验：若继续按 provider 独立保存，要在文案里说明需要配置两次；若要联动复用，需要单独设计凭据复用机制。
   - `src/lib/provider-catalog.ts` discovery gates
     - `canReliablyFetchModels()` 对 3 个新 preset 返回 false，文案说明“使用套餐白名单，暂不做全量刷新”。
     - `canSearchUpstreamModels()` 初版也返回 false 或只对 filtered read path 返回 true。
   - `src/lib/model-discovery.ts`
     - 初版可只在 `classifyProvider()` 对这些 preset 返回 `unsupported`。
     - 后续 filtered discovery 时，给 ClinePass prefix filter，给 OpenCode Go 两个 allowlist filter。
   - `src/i18n/en.ts` / `src/i18n/zh.ts`
     - 若新增用户可见说明文案，双语同步。

## 验证清单

### 单元测试

- `provider-preset.test.ts`
  - 新 preset 通过 `PresetSchema`。
  - 如果新增 discovery policy 字段，`PresetMetaSchema` 接受这些字段，且缺省 preset 行为不变。
  - ClinePass / OpenCode Go OpenAI：`protocol === 'openai-compatible'`, `authStyle === 'api_key'`, baseUrl 以 `/v1` 结尾。
  - OpenCode Go Anthropic：`protocol === 'anthropic'`, `authStyle === 'api_key'`, baseUrl 不以 `/v1` 结尾；最终 messages URL 必须是 `/zen/go/v1/messages`，不能出现双 `/v1`。
- `runtime-compat` 相关测试
  - ClinePass / OpenCode Go OpenAI -> `codepilot_only`，supported runtimes 包含 `codepilot_runtime` 和 `codex_runtime`，不包含 `claude_code`。
  - OpenCode Go Anthropic -> `claude_code_experimental` 或未验证态，直到真实 smoke 后再升 verified。
- `model-discovery` / `canReliablyFetchModels`
  - 3 个新 preset 初版都不显示普通“刷新模型”。
  - `canSearchUpstreamModels()` 与 `classifyProvider()` 对同一组 preset 给出一致的 catalog-only / unsupported 结果。
  - 覆盖 `coding-plan-discovery-gate.test.ts`：新类型不是 `sdkProxyOnly`，但仍不会进入自动探测写库路径。
  - 如果做 filtered discovery，断言 OpenCode 两个 preset 不会互相导入对方协议的模型。
- resolver / URL
  - OpenCode Go OpenAI 最终 chat URL 应由 AI SDK 形成 `/zen/go/v1/chat/completions`。
  - OpenCode Go Anthropic 最终 messages URL 应为 `/zen/go/v1/messages`。
- Provider UI 分桶
  - Add Service modal 中新 preset 出现在套餐 / Code Plan 类分桶，而不是第三方中继。

### 真实 key smoke

需要用户提供真实 Cline / OpenCode key 或由本机已有账号完成：

- ClinePass
  - `stream: false` 调用 `cline-pass/kimi-k3` 或用户指定模型。
  - `stream: true` 验证 SSE 能被 CodePilot 消费。
  - tool calling 用 OpenAI function schema 做最小工具调用。
- OpenCode Go OpenAI
  - `POST /zen/go/v1/chat/completions`，至少选一个低成本模型做非流式和流式。
- OpenCode Go Anthropic
  - `POST /zen/go/v1/messages`，验证 `x-api-key`、流式、tool use；当前探测显示 OpenCode Go 不要求 `anthropic-version`。
  - CodePilot Runtime smoke 通过后再考虑 `claudeCodeVerified`；Claude Code Runtime 也要单独跑一次，因为它的 wire / env 注入路径不同。

## Sources

- ClinePass docs: https://docs.cline.bot/getting-started/clinepass
- Cline API overview: https://docs.cline.bot/api/overview
- Cline API authentication: https://docs.cline.bot/api/authentication
- Cline Chat Completions reference: https://docs.cline.bot/api/chat-completions
- Cline models reference: https://docs.cline.bot/api/models
- Cline public model directory: https://cline.bot/models
- OpenCode Go docs: https://dev.opencode.ai/docs/go/
- OpenCode Go model endpoint: https://opencode.ai/zen/go/v1/models
- Kimi K3 release and effort levels: https://www.kimi.com/code/docs/kimi-code/whats-new.html
