# Provider 注册表对比分析 — Hermes vs CodePilot

> 分析日期：2026-04-09

## 为什么这个问题重要

CodePilot 的 provider 系统频繁出问题：新增 provider 时忘记更新多处代码、auth 方式判断散落在多个文件、模型能力（thinking/vision/tool use）靠硬编码猜测、第三方代理兼容性需要逐个调试。根本原因是**数据源和判断逻辑没有统一**。

## 两套系统的核心区别

### CodePilot 现状：一切硬编码在 VENDOR_PRESETS

```
provider-catalog.ts (VENDOR_PRESETS, 28 个 preset)
        ↓
provider-resolver.ts (inferProtocolFromLegacy, toAiSdkConfig)
        ↓
ai-provider.ts (createLanguageModel switch/case)
        ↓
provider-transport.ts (detectTransport)
```

**问题：** 每新增一个 provider 至少要改 4 个文件。模型列表、协议类型、auth 方式、SDK 类型全部硬编码在 `VENDOR_PRESETS` 数组里，代码更新是唯一的数据来源。

### Hermes：三层合并 + 动态数据源

```
models.dev API（109+ providers，动态）
        ↓
HERMES_OVERLAYS（130+ 条，补充 transport/auth）
        ↓
用户 config.yaml（自定义 provider）
        ↓
resolve_provider_full() → ProviderDef
```

**优势：** models.dev 是外部维护的动态目录，Hermes 只需补充 models.dev 没有的信息（传输协议、auth 类型）。新 provider 在 models.dev 上线后，Hermes 可能不需要改任何代码就能支持。

## 逐项对比

### 1. 数据源

| 维度 | CodePilot | Hermes |
|------|-----------|--------|
| Provider 列表来源 | 硬编码 `VENDOR_PRESETS` (28 个) | models.dev API (109+) + 本地缓存 |
| 模型列表来源 | 硬编码 `defaultModels` | models.dev 动态 + `/models` 端点探测 |
| 更新机制 | 需要发版 | 1 小时自动刷新，离线有磁盘缓存 |
| 自定义 Provider | DB `api_providers` 表 + UI | config.yaml `providers:` section |

**Hermes 优势：** 不依赖代码发版来获取新 provider/model 信息。models.dev 作为社区维护的目录，覆盖面远超手工维护。

**CodePilot 优势：** Zod schema 验证 preset 完整性；UI 引导式配置；DB 持久化。

### 2. 传输协议（Wire Protocol）

| 维度 | CodePilot | Hermes |
|------|-----------|--------|
| 协议类型 | 7 种 Protocol enum | 3 种 transport |
| 定义位置 | `provider-catalog.ts` Protocol type | `providers.py` HermesOverlay.transport |
| 判断逻辑 | `inferProtocolFromLegacy()` 按 URL/type 推断 | 查表：`HERMES_OVERLAYS[provider_id].transport` |

**CodePilot 的 7 种协议：**
```
anthropic | openai-compatible | openrouter | bedrock | vertex | google | gemini-image
```

**Hermes 的 3 种传输：**
```
openai_chat | anthropic_messages | codex_responses
```

**Hermes 优势：** 更简洁。不把 bedrock/vertex/openrouter 当独立协议，而是当做 `openai_chat` 的变体（通过 auth 和 base_url 区分）。减少了协议判断的复杂度。

**CodePilot 优势：** bedrock/vertex 确实有特殊的 SDK（@ai-sdk/amazon-bedrock 等），需要独立处理，不能简单归入 openai_chat。

### 3. 认证系统

| 维度 | CodePilot | Hermes |
|------|-----------|--------|
| Auth 类型 | 4 种 AuthStyle | 4 种 auth_type |
| 定义位置 | `provider-catalog.ts` 每个 preset | `auth.py` ProviderConfig 注册表 |
| OAuth 支持 | OpenAI PKCE（自建） | Nous + Qwen + Copilot（多种 OAuth 流） |
| 凭据存储 | DB settings 表 | `auth.json` + 文件锁 |
| Claude Code 检测 | 手动检查 env vars | 自动读 `~/.claude/.credentials.json` + 刷新 |

**CodePilot AuthStyle：**
```
api_key | auth_token | env_only | custom_header
```

**Hermes auth_type：**
```
api_key | oauth_device_code | oauth_external | external_process
```

**Hermes 优势：**
- **Provider 特定的 auth 探测**：Z.AI 自动探测 4 个候选端点，Kimi 根据 key 前缀路由，Copilot 自动调 `gh auth token`
- **OAuth token 自动刷新**：启动时检查过期，自动 refresh
- **跨进程文件锁**：防止并发写 auth.json

**CodePilot 问题：** auth 判断散落在 `inferAuthStyleFromLegacy()`、`resolveAnthropicAuth()`、`toClaudeCodeEnv()` 多处，新增 auth 方式需要改多个函数。

### 4. 模型能力检测

| 维度 | CodePilot | Hermes |
|------|-----------|--------|
| Thinking/Reasoning | 前端 `supportsEffort` 字段 | models.dev `reasoning` bool + 模型名匹配 |
| Vision | 无标记 | `attachment` bool + `input_modalities` |
| Tool Use | 默认所有模型支持 | `tool_call` bool，`list_agentic_models()` 过滤 |
| Context Window | `getContextWindow()` 硬编码 map | models.dev + API 探测 + 5 级降级 |
| Structured Output | 无标记 | `structured_output` bool |
| 定价信息 | 无 | 完整的 input/output/cache 价格 |

**Hermes 优势：** 能力是结构化数据（`ModelInfo` dataclass 有 15+ 字段），而非散落在各处的 if/else。新增能力维度只需加一个字段，不需要改判断逻辑。

**CodePilot 问题：** `getContextWindow()` 是一个巨大的 switch/case，每次新模型都要手动加。`supportsEffort` 只在 models route 里某些模型手动标记。没有 vision/tool_call/structured_output 的统一标记。

### 5. 错误处理和降级

| 维度 | CodePilot | Hermes |
|------|-----------|--------|
| 错误分类 | `error-classifier.ts` (21 类) | `error_classifier.py` (类似) |
| Provider 降级 | 无 fallback chain | `fallback_providers` 配置 |
| 上下文降级 | 无 | 5 级 context probe：128K→64K→32K→16K→8K |
| 离线支持 | 无 | 磁盘缓存 models.dev 数据 |

**Hermes 优势：** 完整的降级链条。API 失败不会导致功能不可用——有缓存、有 fallback、有 probe。

## Hermes 的核心设计模式

### 模式 1：三层合并（Primary + Overlay + User）

```python
def resolve_provider_full(name):
    # Layer 1: models.dev (dynamic, community-maintained)
    mdev = get_provider_info(name)
    
    # Layer 2: Hermes overlay (static, fills models.dev gaps)
    overlay = HERMES_OVERLAYS.get(name)
    
    # Layer 3: User config (user-defined custom providers)
    user_def = resolve_user_provider(name, config)
    
    # Merge: user > overlay > models.dev
    return merge(mdev, overlay, user_def)
```

### 模式 2：Transport 与 Provider 解耦

Provider 定义只存数据，不含任何行为逻辑：
```python
ProviderDef(
    id="kimi-for-coding",
    transport="openai_chat",  # 用哪种 API 协议
    api_key_env_vars=("KIMI_API_KEY",),
    base_url="https://api.kimi.com/coding/v1",
)
```

Transport 决定请求格式，但和 provider 身份无关：
```python
TRANSPORT_TO_API_MODE = {
    "openai_chat": "chat_completions",
    "anthropic_messages": "anthropic_messages",
    "codex_responses": "codex_responses",
}
```

### 模式 3：能力即数据

模型能力不是代码里的 if/else，而是查表：
```python
model_info = get_model_info("anthropic", "claude-opus-4-6")
model_info.reasoning     # True
model_info.tool_call     # True
model_info.attachment    # True（支持视觉）
model_info.context_window  # 1_000_000
model_info.cost_input    # 15.0（美元/百万 token）
```

## 对 CodePilot 的改进建议

### 阶段 1：引入 models.dev 作为辅助数据源

不替换 VENDOR_PRESETS，而是**用 models.dev 数据增强现有系统**：

```typescript
// 新增 models-dev.ts
export async function fetchModelsDev(): Promise<ModelsDevData> {
  // 1. 检查内存缓存（1hr TTL）
  // 2. 检查磁盘缓存（~/.codepilot/models-dev-cache.json）
  // 3. 网络获取 https://models.dev/api.json
  // 4. 失败时用打包的 snapshot
}

// 在 provider-catalog.ts 中
export function getModelCapabilities(providerId: string, modelId: string): ModelCapabilities {
  // 1. 查 VENDOR_PRESETS 硬编码（精确匹配）
  // 2. 查 models.dev 动态数据（宽泛匹配）
  // 3. fallback 默认值
}
```

这样做的好处：
- **不破坏现有系统**——VENDOR_PRESETS 仍是主要数据源
- **模型能力不再全靠硬编码**——context window、vision、reasoning 等从 models.dev 自动获取
- **离线也能工作**——打包 snapshot + 磁盘缓存

### 阶段 2：统一能力结构体

把散落的能力标记收敛到一个结构：

```typescript
interface ModelCapabilities {
  reasoning: boolean;
  toolUse: boolean;
  vision: boolean;
  structuredOutput: boolean;
  contextWindow: number;
  maxOutput: number;
  costInput?: number;    // 美元/百万 token
  costOutput?: number;
}
```

当前这些信息分散在：
- `getContextWindow()` — 硬编码 map
- `supportsEffort` — models route 手动标记
- `sdkProxyOnly` — preset 字段
- 无 vision/structuredOutput 标记

### 阶段 3：Transport 抽象简化

参考 Hermes 把 7 种 Protocol 简化为 3 种 Transport：

```typescript
type Transport = 'openai' | 'anthropic' | 'codex';
// bedrock/vertex → openai（通过 SDK 包装，auth 不同）
// openrouter → openai（base_url 不同）
// google/gemini → 独立（或 openai 兼容）
```

好处：减少 `switch(protocol)` 的分支数，减少新增 provider 时的改动点。

### 阶段 4：Provider 特定的 Auth 探测

参考 Hermes 的 Z.AI 端点探测、Kimi key 前缀路由：

```typescript
// 目前的问题：用户配错 base_url 或 auth_style 只能靠 Doctor 诊断
// Hermes 的做法：在配置时就自动探测正确的端点和 auth 方式

async function probeProvider(apiKey: string, baseUrl: string): Promise<{
  transport: Transport;
  actualBaseUrl: string;
  modelList: string[];
}> {
  // 尝试 /models 端点
  // 根据响应格式判断 transport
  // 返回实际可用的端点和模型列表
}
```

## 总结

| 维度 | CodePilot 问题 | Hermes 解法 | 建议优先级 |
|------|---------------|------------|-----------|
| 数据源 | 全靠硬编码，发版才能更新 | models.dev 动态 + 本地缓存 | P0 |
| 能力检测 | 散落多处的 if/else | 结构化 ModelCapabilities | P0 |
| Auth 判断 | 3+ 个文件的推断逻辑 | 集中的 ProviderConfig 注册表 | P1 |
| 协议类型 | 7 种，每种需要独立处理 | 3 种 Transport，解耦于 Provider | P1 |
| 错误降级 | 无 fallback chain | fallback_providers + 上下文 probe | P2 |
| 自定义 Provider | DB + UI（可用但复杂） | config.yaml 一行搞定 | P2 |
