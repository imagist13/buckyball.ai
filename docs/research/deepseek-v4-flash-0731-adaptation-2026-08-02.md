# DeepSeek V4 Flash 0731 适配核验

> **2026-08-13 更新**：本文的 Flash 结论仍保留；V4 Pro 已滚动到 0813，并明确支持第一方 Responses。Pro 能力与 wire 的当前真源见 [Grok 4.6、Grok Build OAuth 与 DeepSeek V4 Pro 0813 适配核验](./grok-4-6-deepseek-v4-pro-0813-adaptation-2026-08-13.md)，下文“Pro 不支持 Responses/仅 High-Max”只代表 2026-08-02 快照。

> 核验日期：2026-08-02
> 范围：DeepSeek 官方 API、Claude Code、Codex、CodePilot Runtime；ClinePass / OpenCode Go 只核验是否需要跟随声明能力。

## 结论

- `DeepSeek-V4-Flash-0731` 是 2026-07-31 发布的 Flash 更新，但 API 模型名仍是 `deepseek-v4-flash`；CodePilot 不新增带日期的模型 ID。
- DeepSeek 官方为 Flash 新增原生 Responses API 并单独给出 Codex 配置。只有 Flash 当前进入该路径；V4 Pro 继续使用现有 Anthropic-compatible 适配，直到官方明确开放对应 Responses 能力。
- DeepSeek 有真实推理强度合同。Flash 支持 Low / High / Max，默认 High；`xhigh` 在官方说明中折算为 High。当前 Pro 的有效档位收敛为 High / Max。
- Claude Code 的官方配置使用 Anthropic-compatible endpoint，并推荐 Flash 作为 Sub-agent 模型。CodePilot 继续让 Auto 表示“不显式指定”，不额外强写全局 `CLAUDE_CODE_EFFORT_LEVEL=max`，避免 preset 默认值覆盖用户在 composer 的选择。
- ClinePass 和 OpenCode Go 虽已列出新版 DeepSeek，但其网关是否接受同一 effort 字段没有独立证据；继续只声明 tool use，不继承 DeepSeek 第一方的 Responses/effort 合同。

## 官方事实源

| 事实 | 来源 |
|---|---|
| 2026-07-31 发布 V4 Flash 更新；模型名不变；新增 Responses API 与 Codex 优化；只更新 Flash API | [DeepSeek 更新日志](https://api-docs.deepseek.com/zh-cn/updates/) |
| Codex 使用 `wire_api="responses"`；当前只有 `deepseek-v4-flash` 支持；1,048,576 context；Low/High/Max，默认 High | [Codex 集成](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/codex/) |
| Responses 当前为无状态；支持 function tools、web search、`reasoning.effort`；不支持 images/files；custom tool 仅 apply_patch | [Responses API 指南](https://api-docs.deepseek.com/zh-cn/guides/responses_api/) |
| Flash 的 Low/High/Max 映射与默认 High；`xhigh → high`；Anthropic 格式 effort 使用 `output_config.effort` | [思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode/) |
| Claude Code 使用 `/anthropic`，Flash 作为 Sub-agent 模型，官方示例推荐 effort max | [Claude Code 集成](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code/) |
| Anthropic-compatible API 支持 thinking blocks、tool choice 与 `output_config.effort` | [Anthropic API 兼容说明](https://api-docs.deepseek.com/zh-cn/guides/anthropic_api/) |

## 仓库落地

1. `provider-catalog.ts` 的 DeepSeek preset 保持原模型 ID，补模型能力与带来源的 `wireCapabilities`：
   - Anthropic effort：V4 Flash = Low/High/Max；V4 Pro = High/Max。
   - Codex Responses：仅 V4 Flash，base URL 为 `https://api.deepseek.com`。
2. `provider-resolver.ts` 通过 preset identity + exact model 解析 verified wire；不以 hostname 或模型名猜测。legacy DeepSeek DB 行可解析；聚合网关不会继承。
3. CodePilot Runtime 的 compat adapter 把已验证 effort 写入 `output_config.effort`，未知第三方代理仍 fail closed。
4. Codex Runtime 对 Flash 使用 API-key Responses transport；显式 `forceReasoning` 绕过 AI SDK 对未知模型的错误推理分类，并移除 DeepSeek 未声明支持的 `reasoning.summary`。
5. preset 默认 env 以“catalog 默认 < 用户存量 override”合并，已存在的 DeepSeek 配置也能获得 `CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flash`，无需删除重加。

## 已验证边界

- 合成 wire：Responses 请求真实到 `/responses`，Bearer auth，`reasoning.effort=max`；Anthropic compat 真实生成 `output_config.effort=max`。
- 真实 API：同一现有 DeepSeek API Key 下，Codex Runtime 原生 Responses + High 返回预期 marker；CodePilot Runtime Anthropic thinking + High 返回预期 marker。
- 未验证/不承诺：ClinePass / OpenCode Go effort；DeepSeek Pro 原生 Responses；packaged Electron UI；Claude Code 子进程完整 turn。
