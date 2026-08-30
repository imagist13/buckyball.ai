# GLM-5.3-Flash Coding Plan 适配核验

> 核验时间：2026-08-26
> 范围：智谱 Coding Plan 中国区与国际区；CodePilot 的 Claude Code / Codex Runtime 两条请求路径。
> 结论：目录、能力与 synthetic wire contract 已适配；未使用用户真实套餐凭据，因此不把模型 entitlement 或真实完整回答记为通过。

## 用户问题与争议

智谱新发布 GLM-5.3-Flash 后，旧内置目录仍显示 GLM-5.3 / GLM-5-Turbo / GLM-4.7。要适配的不只是模型名，还包括：当前套餐阵容、Claude 与 Codex 的不同模型 ID、1M 上下文、图片输入、推理强度、默认角色，以及存量数据库中旧模型行的处理方式。

有两个容易误判的点：

1. Flash 是当前 Coding Plan 模型，但这不等于应把旗舰默认模型静默换成 Flash。
2. 官方已将旧模型请求自动路由到新模型，但这不等于 CodePilot 可以在一次 Models GET 中删除用户数据库里的旧行。

## 官方事实

### 当前阵容与兼容路由

- 中国区 Coding Plan 当前模型页只列 GLM-5.3 与 GLM-5.3-Flash；两者支持常见 Coding Agents。[中国区最新模型](https://docs.bigmodel.cn/cn/coding-plan/latest-model)
- 旧 GLM-5.2 / GLM-5.1 请求会自动路由至 GLM-5.3；旧 GLM-5-Turbo / GLM-4.7 请求会自动路由至 GLM-5.3-Flash。[Coding Plan 概览](https://docs.bigmodel.cn/cn/coding-plan/overview)
- GLM-5.3-Flash 对 Coding Plan 全套餐开放；国际站同样明确其属于 GLM Coding Plan。[GLM-5.3-Flash 模型页](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)、[国际站模型页](https://docs.z.ai/guides/llm/glm-5.3-flash)

### 模型与能力合同

- API 模型码为 `glm-5.3-flash`；Claude Code 的 1M 写法为 `glm-5.3-flash[1m]`。[GLM-5.3-Flash 模型页](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)、[Claude Code 配置](https://docs.bigmodel.cn/cn/coding-plan/tool/claude)
- 官方标称支持 1M 上下文，配置示例使用 1,000,000；没有找到把 1M 精确写成 1,048,576 的第一方依据，因此 CodePilot 采用 1,000,000，避免在接近满窗时高估余量。模型同时支持原生图片理解；本轮只声明并验证自身已接线的图片输入，不把网页对其他输入类型的描述扩写成产品能力。[GLM-5.3-Flash 模型页](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)、[Coding Plan 最新模型](https://docs.bigmodel.cn/cn/coding-plan/latest-model)
- `thinking.type` 只能为 `enabled`，不能关闭；推理强度为 Low / High / Max，默认 Max。[GLM-5.3-Flash 模型页](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)
- 兼容档位映射与 GLM-5.3 相同：minimal/light/low → Low，medium/high → High，xhigh/max/ultra → Max。产品通用菜单只暴露 Low / High / Max；兼容别名仅在 wire 层折叠。[GLM-5.3-Flash 模型页](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)
- 积分倍率为输入 2.3、缓存输入 0.56、输出 8；官方称其相对 GLM-5.3 约有 3 倍可用额度。CodePilot 只展示倍率，不推算用户余额或承诺固定百分比。[Coding Plan 概览](https://docs.bigmodel.cn/cn/coding-plan/overview)、[GLM-5.3-Flash 模型页](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash)

### 协议与区域端点

| 路径 | 中国区 | 国际区 | Flash wire ID |
|---|---|---|---|
| Claude / Anthropic | `https://open.bigmodel.cn/api/anthropic` | `https://api.z.ai/api/anthropic` | `glm-5.3-flash[1m]` |
| Codex / Responses | `https://open.bigmodel.cn/api/v1` | `https://api.z.ai/api/v1` | `glm-5.3-flash` |

中国区 Codex 指南给出 `/api/v1`，Claude 指南给出 `/api/anthropic`；最新模型页确认 Flash 支持这些 Coding Agents。[Codex 配置](https://docs.bigmodel.cn/cn/coding-plan/tool/codex)、[Claude Code 配置](https://docs.bigmodel.cn/cn/coding-plan/tool/claude)、[最新模型](https://docs.bigmodel.cn/cn/coding-plan/latest-model)

说明：Codex 工具页的示例目录尚未同步展示 Flash，因此“Flash 走当前 Coding Plan Responses endpoint”的依据是最新模型页、Flash 精确模型页与既有 Codex endpoint 的组合推断。代码以 exact preset + exact model allowlist fail-closed，并已验证最终 outbound body；真实凭据 smoke 仍保留为待办。

## 产品取舍

1. 新建 GLM CN / Global Provider 只展示两个当前 SKU：`sonnet → GLM-5.3` 与 `haiku → GLM-5.3-Flash`。
2. `default` / `sonnet` / `opus` 继续指向 GLM-5.3；`haiku` 指向 Flash。这样获得稳定的快速档位，又不会把用户的旗舰默认选择静默换成 Flash。
3. 两个模型都声明 1M、always-thinking、Low / High / Max、default Max；只有 Flash 声明 vision。
4. Claude 使用 `[1m]` ID，Codex Responses 使用 bare ID；两种 ID 的转换只存在于该供应商精确 wire capability 中，聚合渠道不得继承。
5. Models GET 继续执行非破坏 merge：升级稳定 `haiku` 槽并补当前缺失行，但不删除或禁用已经持久化的 GLM-5-Turbo / GLM-4.7 等历史行。显式清理应走用户操作或另一个 preview-first 迁移，不把读操作变成 prune。

## 实现与验证边界

- `provider-catalog.ts`：CN / Global 共用两模型目录，更新角色 env、能力、积分注记和 Anthropic / Responses exact wire allowlist。
- `model-context.ts`：按官方标称和配置值加入 Flash 1,000,000 fallback；`[1m]` 通过最长 key 匹配解析。
- 合同测试覆盖：新目录、旧指纹升级、历史 Turbo 保留、auth/base URL/env、Claude `[1m]`、Codex bare ID、Auto/Max、兼容档位、production Responses body、Anthropic 与 Responses 图片输入、聚合渠道 fail-closed。
- synthetic 定向验证通过；没有调用真实 GLM Coding Plan API，不声明真实套餐 entitlement、图片识别质量或完整 turn 成功。

## 后续真实 Smoke

| Runtime | 模型 | 必验 |
|---|---|---|
| Claude Code | `glm-5.3-flash[1m]` | 文本 turn、图片 turn、Low/High/Max、默认 Max、1M 会话信息 |
| Codex Runtime | `glm-5.3-flash` | `/responses` 完整文本/图片 turn、bare ID、reasoning summary、Low/High/Max |
| Settings / Composer | stable `haiku` | 新 Provider 只显示两个当前模型；旧 Provider 的历史行保留且 Flash 可见可选 |
