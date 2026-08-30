# GLM-5.3 CodePlan 适配核验

> **历史基线**：本文记录 2026-08-14 的 5.3 / 5-Turbo / 4.7 阵容。2026-08-26 当前目录与 Flash 合同见 [GLM-5.3-Flash Coding Plan 适配核验](glm-5-3-flash-codeplan-adaptation-2026-08-26.md)。

> 核验日期：2026-08-14
> 范围：智谱 Coding Plan 中国区 / 国际区、Claude Code、Codex、CodePilot 模型目录与请求链路。

## 结论

- GLM-5.3 已在 Coding Plan 全量开放；通用 API 仍标注“即将上线”。本轮只更新已有 `glm-cn` / `glm-global` CodePlan，不虚构尚未开放的 PAYG API 入口。
- 当前 CodePlan 主目录是 `GLM-5.3`、`GLM-5-Turbo`、`GLM-4.7`。GLM-5.2 / 5.1 请求会由上游自动路由到 5.3，但 CodePilot 目录直接展示当前官方名称，不继续把旧别名当成当前模型。
- GLM-5.3 是文本输入/文本输出模型，官方标称 1M context、最大输出 131,072，支持 function calling、streaming、caching、structured output 与 MCP。2026-08-26 引用精度复核后，产品按官方配置值使用 1,000,000，不再把 1M 擅自解释为 1,048,576。图片能力来自套餐附带的 GLM-4.6V Vision MCP，不应把 GLM-5.3 本体标成 vision model。
- Claude 与 Codex 的模型 ID 不同：Claude 配置使用 `glm-5.3[1m]`，Codex 的原生 Responses 使用裸 `glm-5.3`。CodePilot 保留一个用户可见的 GLM-5.3 行，在 transport capability 中做精确 ID 改写，避免重复模型。
- GLM-5.3 的实际推理档位为 Low / High / Max，默认 Max。CodePlan 兼容层把 `minimal/light/low → low`、`medium/high → high`、`xhigh/max/ultra → max`；显式 effort 优先于 thinking toggle。本轮把兼容别名建模在 first-party Responses wire 上，不把 `medium` / `xhigh` 展示成额外真实档位。
- 官方 Codex 配置为原生 OpenAI Responses：CN `https://open.bigmodel.cn/api/v1`，Global `https://api.z.ai/api/v1`。GLM-5.3 支持 reasoning summaries、parallel tool calls 与 freeform apply_patch；不支持 verbosity，input modality 仅 text。
- GLM-5-Turbo 也在官方 Codex 目录，context 204,800；官方没有给它可选 effort allowlist，所以 CodePilot 不展示推理档位，但 Codex Runtime 仍走原生 Responses。
- 当前积分表中 GLM-5.3 的输入 / 缓存输入 / 输出倍率为 6.9 / 1.7 / 24；非高峰按表列积分的 50% 消耗，高峰为工作日 14:00–18:00（UTC+8）。仓库旧的“高峰 3 倍”提示已删除。

## 第一方事实源

| 事实 | 中国区 | 国际区 |
|---|---|---|
| GLM-5.3 能力、1M/128K、文本 modality | [GLM-5.3 模型页](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3) | 同一产品合同 |
| 当前 CodePlan 模型、三档 effort 与兼容映射 | [最新模型切换](https://docs.bigmodel.cn/cn/coding-plan/latest-model) | [Latest model](https://docs.z.ai/devpack/latest-model) |
| 当前目录、旧版本自动路由、积分与高峰规则 | [Coding Plan 概览](https://docs.bigmodel.cn/cn/coding-plan/overview) | [Coding Plan overview](https://docs.z.ai/devpack/overview) |
| Codex Responses endpoint、模型 ID 与 capability | [Codex 集成](https://docs.bigmodel.cn/cn/coding-plan/tool/codex) | [Codex integration](https://docs.z.ai/devpack/tool/codex) |
| Claude 的 `[1m]` ID 与 compact window | [Claude Code 集成](https://docs.bigmodel.cn/cn/coding-plan/tool/claude) | [Claude Code integration](https://docs.z.ai/devpack/tool/claude) |

## 仓库落地

1. `provider-catalog.ts`
   - `sonnet` 稳定 UI/DB alias → `glm-5.3[1m]`，展示 `GLM-5.3`；
   - 新增独立 `glm-5-turbo`；
   - `haiku` 稳定 alias → `glm-4.7`；
   - CN/Global 都补 `defaultRoleModels`、`CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000` 与当前积分提示；
   - first-party `wireCapabilities` 精确声明 Anthropic effort、Responses endpoint、模型 ID override 与 effort aliases。
2. `provider-resolver.ts`
   - Codex Runtime 使用 capability 给出的 Responses 模型 ID，而不是复用 Anthropic upstream；
   - catalog 管理的旧 DB 行在 read path 使用当前 catalog metadata，确保 picker 与实际 wire 同时更新；manual / user-edited 行继续 DB-wins；
   - verified Responses transport 与 effort allowlist 分离；GLM-5-Turbo 即使没有可选 effort 档位，仍建立原生 Responses context；
   - compact-window 环境变量进入 managed cleanup，切换服务商时不会泄漏。
3. `unified-adapter.ts`
   - Responses effort aliases 由 preset 声明；删除“所有 first-party 都把 xhigh 折成 high”的隐式 DeepSeek 特判。DeepSeek 自己显式保留 `xhigh → high`，GLM 显式使用 `xhigh → max`。
   - GLM-5-Turbo 保留 reasoning summary，但不发送供应商未声明的 `reasoning.effort`。
4. `codex/runtime.ts` + `codex/effort.ts`
   - CodePilot Provider 的 effort 合同来自精确 catalog，而不是 Codex Account 的 per-model cache；
   - GLM-5.3 显式 Max 和 Auto→catalog 默认 Max 均原样进入 `turn/start`；
   - `max/xhigh` 优先使用当前 app-server `model/list` vocabulary 证明 binary 能接受；Codex Account 未登录或目录冷缓存时，改用已经初始化的本机 app-server 版本，稳定版 `0.144.2+` 是本仓库实际验证过同时接受两种 token 的保守下限。版本判断复用严格、prerelease-aware 的 `codex --version` 解析器，`0.144.2-alpha.*` 与夹带在 user-agent 中的无关三元组不会误放行；旧/未知 binary 继续可见失败，不静默夹成 High，也不误导用户刷新 Codex Account 模型。

## 验证边界

- 已验证：catalog/schema、CN/Global endpoint、Claude `[1m]` 与 Codex bare ID 分流、存量 catalog 行 read-through + 持久化对齐、Low/High/Max Anthropic body、六档 Codex compatibility 映射、CodePilot catalog→Codex effort contract 的显式 Max / Auto→Max / Codex Account 无目录缓存时的 `0.144.2+` 本机 binary gate / 旧 binary fail-visible，以及 production Responses factory 的 URL / Bearer / model / reasoning body。Turbo 的 production outbound body 已证明使用原生 Responses、保留 summary 且不含 effort。
- 未验证：真实 CodePlan 凭据的 Claude Code 完整 turn、Codex Runtime 完整 turn、账号套餐 entitlement 与实际积分。没有真实凭据前只记 `Tests pass`，不记 `Smoke passed`。
