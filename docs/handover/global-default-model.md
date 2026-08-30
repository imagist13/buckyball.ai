# 全局默认模型

## 概述
v0.38.4 引入全局默认模型机制，替代了之前的"默认服务商"概念。用户在设置页选择一个模型（自带所属 provider），新对话自动使用该模型。已有对话不受影响。

## 数据存储
- `global_default_model` — settings 表，存储默认模型 ID（如 'kimi-k2.5'）
- `global_default_model_provider` — settings 表，存储默认模型所属的 provider ID
- `default_provider_id` — settings 表，legacy 兼容字段，由 setDefaultProviderId() 同步写入

## 读写函数
- `getDefaultProviderId()` — 优先读 global_default_model_provider，fallback 到 legacy default_provider_id
- `setDefaultProviderId(id)` — 三写：default_provider_id + global_default_model_provider + 清空 global_default_model
- `getProviderOptions('__global__')` / `setProviderOptions('__global__')` — 读写全局默认模型设置

## 新对话模型选择优先级
1. 全局默认模型（global_default_model + global_default_model_provider 都有效）
2. 全局默认 provider 但 model 被清空（如 doctor repair 后）→ 该 provider 的第一个可用模型
3. localStorage 的 last-model / last-provider-id
4. groups[0] 的第一个模型

## 已有对话
- 已有对话始终使用 session 自己存储的 model 和 provider_id
- MessageInput 的自动纠正逻辑只 fallback 到 modelOptions[0]，不使用全局默认模型
- 全局默认模型变化不会影响已有对话

## provider-resolver 中的归属校验
- env 分支和 DB provider 分支都会检查 global_default_model_provider 是否与当前 provider ID 一致
- 不一致时忽略全局默认模型，防止 A 服务商的模型串到 B 服务商

## 竞态防护
- 新对话页 currentModel/currentProviderId 初始为空
- modelReady 状态门控：fetch 完成前禁止发送
- provider-changed 事件触发时先 setModelReady(false)，fetch 完成后所有分支都 setModelReady(true)

## UI
- 设置页：连接诊断卡片内，分割线下方，左边标题+描述，右边 select（w-[160px]）
- 聊天输入框：当前模型是默认模型时显示"默认"/"Default" tag
- 模型选择下拉框：默认模型旁标"默认"/"Default" tag

## 关键文件
- src/lib/db.ts — getDefaultProviderId, setDefaultProviderId, getProviderOptions('__global__'), setProviderOptions('__global__')
- src/lib/provider-resolver.ts — 模型解析优先级链中的归属校验
- src/app/chat/page.tsx — 新对话初始化 + checkProvider + modelReady 门控
- src/components/settings/ProviderManager.tsx — 全局默认模型 select UI + handleGlobalDefaultModelChange
- src/components/chat/ModelSelectorDropdown.tsx — "默认" tag 显示
- src/hooks/useProviderModels.ts — globalDefaultModel / globalDefaultProvider
- src/components/chat/MessageInput.tsx — 自动纠正逻辑（不使用全局默认）

## 与 Bridge 系统的关系
Bridge 系统使用独立的 bridge_default_provider_id，与全局默认模型分离。

## 测试覆盖
- src/__tests__/unit/provider-resolver.test.ts — Global Default Model describe block（7 条测试）
  - env provider 归属正确/不正确
  - DB provider 归属正确/不正确
  - explicit model / session model 覆盖
- src/__tests__/unit/stale-default-provider.test.ts — stale default 清理（隔离 global_default_model_provider）
