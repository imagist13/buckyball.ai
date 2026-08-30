# 服务商架构全景

> 产品思考见 [docs/insights/user-audience-analysis.md](../insights/user-audience-analysis.md)
> 数据采集日期：2026-04-04
> 数据来源：18 个服务商官方文档 + Claude Code 真实源码（/资料/src） + CodePilot 代码库

---

## 一、架构总览

CodePilot 通过 **Provider Catalog → Provider Resolver → Claude Code SDK subprocess** 三层架构连接 AI 服务商：

```
用户配置 Provider → DB (api_providers 表)
                          ↓
                  resolveProvider() 统一解析
                          ↓
              ┌───────────────────────┐
              │  toClaudeCodeEnv()    │  → 构建环境变量 → Claude Code SDK 子进程
              │  toAiSdkConfig()     │  → 构建 AI SDK 配置 → Vercel AI SDK 直接调用
              └───────────────────────┘
```

### 关键文件

| 用途 | 文件 |
|------|------|
| Provider 预设定义（28+ 个） | `src/lib/provider-catalog.ts` |
| 统一解析 + 环境变量构建 | `src/lib/provider-resolver.ts` |
| Provider 快捷连接 UI | `src/components/settings/provider-presets.tsx` |
| SDK 流式调用 | `src/lib/claude-client.ts` |
| 能力缓存（模型/命令/MCP 状态） | `src/lib/agent-sdk-capabilities.ts` |
| 错误分类 | `src/lib/error-classifier.ts` |
| 诊断修复 | `src/lib/provider-doctor.ts` |
| DB schema（api_providers 表） | `src/lib/db.ts` |
| 模型列表 API | `src/app/api/providers/models/route.ts` |
| Provider CRUD API | `src/app/api/providers/route.ts` |
| Provider 类型定义 | `src/types/index.ts` |

---

## 二、Claude Code 真实架构（源码分析）

> 以下基于 Claude Code CLI 真实源码分析，非 DeepWiki 推断。

### 核心设计：扁平架构，无多态

Claude Code 的 Provider 架构**极其简单**——没有 Provider 抽象类、没有接口、没有注册表模式。就是一个返回字符串的函数 + if/else 分支。

**Provider 类型**（`utils/model/providers.ts`）：
```typescript
type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry'
```

**Provider 选择**（`getAPIProvider()`）：
```
CLAUDE_CODE_USE_BEDROCK → 'bedrock'
CLAUDE_CODE_USE_VERTEX  → 'vertex'
CLAUDE_CODE_USE_FOUNDRY → 'foundry'
否则                     → 'firstParty'
```

### API 客户端创建（`services/api/client.ts`）

`getAnthropicClient()` 是唯一入口，用 if/else 按 Provider 实例化不同 SDK：

| Provider | SDK | 认证方式 |
|----------|-----|---------|
| firstParty | `new Anthropic()` | `ANTHROPIC_API_KEY` / keychain / OAuth Token |
| bedrock | `new AnthropicBedrock()` | AWS IAM / Bearer Token / 跳过认证 |
| vertex | `new AnthropicVertex()` | Google Auth / 跳过认证 |
| foundry | `new AnthropicFoundry()` | Azure API Key / Azure AD / 跳过认证 |

**关键设计决策**：所有 Provider SDK 最终被 `as unknown as Anthropic` 强制转型。代码注释说 *"we have always been lying about the return type"*。这意味着下游代码统一通过 Anthropic SDK 接口调用，完全不感知具体 Provider。

### 模型 ID 的 Provider 映射（`utils/model/configs.ts`）

每个模型有一个 per-provider 配置对象：

```typescript
const CLAUDE_OPUS_4_6_CONFIG = {
  firstParty: 'claude-opus-4-6',
  bedrock: 'us.anthropic.claude-opus-4-6-v1',
  vertex: 'claude-opus-4-6',
  foundry: 'claude-opus-4-6',
}
```

Bedrock 模型 ID 有特殊处理：运行时通过 `getBedrockInferenceProfiles()` 异步查询推理配置文件，匹配自定义 ARN。

### 模型选择优先级（`utils/model/model.ts`）

```
/model 命令覆盖 → --model 启动参数 → ANTHROPIC_MODEL 环境变量 → 配置文件 → 内置默认值
```

默认模型**按用户等级不同**：
- Anthropic 员工：Opus 4.6 (1M context)
- Max/Team Premium 订阅：Opus 4.6
- 其他（PAYG、Enterprise、Pro）：Sonnet 4.6

**3P Provider 滞后处理**：非 firstParty Provider 的默认模型可能是旧版（如 Sonnet 4.5 而非 4.6），因为第三方可用性滞后。

**模型别名**（`aliases.ts`）：支持 `'sonnet'`、`'opus'`、`'haiku'`、`'best'`、`'opusplan'`，以及 `[1m]` 变体。

**旧模型重映射**：Opus 4.0/4.1 在 firstParty 上静默重映射到当前 Opus 默认值。

### 流式实现

**只有一个流式实现**，不是 per-provider 的（`services/api/claude.ts`）：
1. `getAnthropicClient()` 创建客户端
2. 调用 `anthropic.beta.messages.stream()` — 所有 Provider 走同一 API
3. 通过 `withStreamingVCR()` 包装（调试录制/回放）
4. 非流式回退：`executeNonStreamingRequest()` + `withRetry()`

### 重试和错误处理（`services/api/withRetry.ts`）

- 默认 10 次重试 + 指数退避
- 529（过载）：最多 3 次连续，然后切换到 `fallbackModel`
- 429（限流）：提取 `retry-after` 头
- 401：刷新 OAuth token 重新获取客户端
- Bedrock 认证错误：清除 AWS 凭证缓存重试
- Vertex 认证错误：清除 GCP 凭证缓存重试
- ECONNRESET/EPIPE：禁用 HTTP keep-alive 重连
- 无人值守模式（`CLAUDE_CODE_UNATTENDED_RETRY`）：429/529 无限重试

错误分类（`services/api/errors.ts`）：20+ 种分类，包括 `'invalid_api_key'`、`'bedrock_model_access'`、`'credit_balance_low'`、`'token_revoked'` 等。

### Beta 头和 Provider 特殊处理（`constants/betas.ts`）

- Bedrock 只能通过 `extraBodyParams` 传递部分 beta（不是 header）
- Vertex 的 `countTokens` API 只允许特定 beta
- `isFirstPartyAnthropicBaseUrl()` 判断是否发送 firstParty-only 的 beta 头
- 工具搜索 beta 不同：1P/Foundry 用 `advanced-tool-use-2025-11-20`，Vertex/Bedrock 用 `tool-search-tool-2025-10-19`

### 完整环境变量表

| 变量 | 作用 |
|------|------|
| `ANTHROPIC_API_KEY` | 直连 API Key |
| `ANTHROPIC_AUTH_TOKEN` | Bearer Token（代理认证通用） |
| `ANTHROPIC_BASE_URL` | 自定义 API 端点 |
| `ANTHROPIC_CUSTOM_HEADERS` | 自定义 HTTP 头 |
| `CLAUDE_CODE_EXTRA_BODY` | 额外 JSON body 参数 |
| `ANTHROPIC_MODEL` | 覆盖默认模型 |
| `ANTHROPIC_SMALL_FAST_MODEL` | 覆盖 Haiku 模型 |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | 覆盖 Opus |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | 覆盖 Sonnet |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 覆盖 Haiku |
| `ANTHROPIC_REASONING_MODEL` | 覆盖推理模型 |
| `ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES` | 3P 模型能力声明 |
| `CLAUDE_CODE_USE_BEDROCK` | 启用 Bedrock |
| `CLAUDE_CODE_USE_VERTEX` | 启用 Vertex |
| `CLAUDE_CODE_USE_FOUNDRY` | 启用 Foundry (Azure) |
| `CLAUDE_CODE_SKIP_BEDROCK_AUTH` | 跳过 Bedrock 认证 |
| `CLAUDE_CODE_SKIP_VERTEX_AUTH` | 跳过 Vertex 认证 |
| `CLAUDE_CODE_SKIP_FOUNDRY_AUTH` | 跳过 Foundry 认证 |
| `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Bedrock 凭证 |
| `ANTHROPIC_BEDROCK_BASE_URL` | Bedrock 端点覆盖 |
| `CLOUD_ML_REGION` | Vertex 默认区域 |
| `ANTHROPIC_VERTEX_PROJECT_ID` | Vertex 项目 |
| `VERTEX_REGION_CLAUDE_*` | Vertex 按模型区域 |
| `ANTHROPIC_FOUNDRY_RESOURCE` | Azure 资源名 |
| `ANTHROPIC_FOUNDRY_BASE_URL` | Azure 端点 |
| `ANTHROPIC_FOUNDRY_API_KEY` | Azure API Key |
| `API_TIMEOUT_MS` | 请求超时 |
| `DISABLE_PROMPT_CACHING` | 禁用 prompt 缓存 |
| `ENABLE_TOOL_SEARCH` | 工具搜索开关 |
| `CLAUDE_CODE_UNATTENDED_RETRY` | 无人值守无限重试 |
| `CLAUDE_CODE_DISABLE_LEGACY_MODEL_REMAP` | 禁用旧模型重映射 |

---

## 三、CodePilot 如何桥接 Claude Code

### 桥接核心：`toClaudeCodeEnv()`

`toClaudeCodeEnv()`（`provider-resolver.ts`）把 CodePilot DB 里的 Provider 配置翻译成 Claude Code 期望的环境变量，注入给 SDK 子进程：

1. **凭证注入**：
   - `authStyle === 'api_key'` → 同时设置 `ANTHROPIC_API_KEY` + `ANTHROPIC_AUTH_TOKEN`
   - `authStyle === 'auth_token'` → 设置 `ANTHROPIC_AUTH_TOKEN` + 清空 `ANTHROPIC_API_KEY`
   - `authStyle === 'env_only'` → 不注入 key（Bedrock/Vertex 走系统凭证）

2. **环境清洗**：切换 Provider 时显式清除旧凭证（防止 Bedrock → Anthropic 时 AWS 凭证泄漏）

3. **角色模型映射**：把 `roleModels.default/reasoning/small` 翻译成 `ANTHROPIC_MODEL/ANTHROPIC_REASONING_MODEL/ANTHROPIC_SMALL_FAST_MODEL`

4. **上游模型 ID**：`upstreamModelId` 与 `modelId` 分离——UI 显示 "sonnet"，实际发 "GLM-4.7" 到智谱 API

### 与 Claude Code 的差异

| 方面 | Claude Code CLI | CodePilot |
|------|----------------|-----------|
| 架构风格 | 扁平 if/else，无多态 | Catalog + Resolver + DB，分层抽象 |
| Provider 数量 | 4 个（firstParty/bedrock/vertex/foundry） | 28+ 个预设 |
| Provider 选择 | 环境变量，单一 Provider | DB 存储，多 Provider 动态切换 |
| 协议支持 | anthropic / bedrock / vertex / foundry | + openai-compatible / openrouter / google / gemini-image（7 种） |
| 认证方式 | API Key / Bearer / IAM / Azure AD | + custom_header（4 种 authStyle） |
| 模型管理 | 静态 per-provider 配置 + 环境变量覆盖 | Catalog 预设 + DB 自定义 + SDK 运行时发现 |
| 模型 ID 映射 | 内置 `configs.ts` 精确映射（firstParty/bedrock/vertex/foundry） | `upstreamModelId` 别名系统 |
| 默认模型 | 按用户等级分层（员工/Max/PAYG） | 统一默认，用户可覆盖 |
| 3P 模型滞后 | 非 firstParty 默认旧版模型 | 无此区分 |
| 旧模型重映射 | Opus 4.0/4.1 → 当前默认 | 无 |
| 重试机制 | 10 次 + 指数退避 + 529 自动切模型 + 凭证刷新 | 依赖 SDK 内部重试 |
| 错误分类 | 20+ 种细分（含 bedrock_model_access 等） | 16 种分类 |
| Beta 头处理 | 精细的 per-provider beta 分流 | 依赖 SDK 处理 |
| Foundry (Azure) | ✅ 已支持 | ❌ **未支持** |
| 凭证轮换 | SDK 支持 ApiKeySetter + OAuth 刷新 | ❌ **未支持** |
| 模型能力声明 | `*_SUPPORTED_CAPABILITIES` 环境变量 | ❌ **未支持** |
| 无人值守重试 | `CLAUDE_CODE_UNATTENDED_RETRY` 无限重试 | ❌ **未支持** |

### 我们应该从 Claude Code 学习的

1. **529 自动切模型**：Claude Code 连续 3 次 529 后自动切换到 `fallbackModel`，我们没有这个机制
2. **凭证刷新**：Bedrock/Vertex 认证失败时自动清缓存重试，我们直接报错
3. **3P 模型能力声明**：`ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES=effort,thinking` 让第三方模型声明自己支持哪些能力
4. **旧模型重映射**：用户配置里的旧模型名自动映射到新版，减少用户困惑
5. **Beta 头分流**：Bedrock 需要通过 `extraBodyParams` 传 beta 而非 header，Vertex 的 `countTokens` 有白名单——这些细节我们目前依赖 SDK 但可能不够
6. ~~**宿主接管机制**（`CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`）~~：**2026-04-15 更正** — 该变量在 SDK `0.2.62` 中不存在（全文 grep 0 hit），从引入起就是死代码。相关 bleed 问题改列为已知限制，见 issue-tracker B-001 follow-up 和 `docs/exec-plans/active/cc-switch-credential-bridge.md`

---

## 三、服务商配置对比矩阵（官方要求 vs 当前实现）

> 下表分两列：**官方文档推荐配置** vs **CodePilot 当前 preset 实际行为**。标 ⚠️ 的表示两者不一致。

### 高频服务商对齐状态

| 服务商 | 官方要求的认证方式 | CodePilot preset authStyle | 状态 | 差异说明 |
|--------|------------------|---------------------------|------|---------|
| Anthropic 官方 | `ANTHROPIC_API_KEY` | `api_key` | ✅ | 一致 |
| OpenRouter | `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_API_KEY=""` | `api_key` | ⚠️ | preset 用 `api_key` 会同时设两个变量；`defaultEnvOverrides` 中的 `ANTHROPIC_API_KEY: ''` 被 AUTH_ENV_KEYS 跳过机制阻止生效 |
| 智谱 GLM（国内） | `ANTHROPIC_AUTH_TOKEN` | `api_key` | ⚠️ | 同上，`ANTHROPIC_API_KEY: ''` 不生效 |
| 智谱 GLM（海外） | `ANTHROPIC_AUTH_TOKEN` | `api_key` | ⚠️ | 同上 |
| Kimi | `ANTHROPIC_API_KEY` | `auth_token` | ⚠️ | 反了——官方用 API_KEY，preset 用 auth_token |
| Moonshot | `ANTHROPIC_AUTH_TOKEN` + `ENABLE_TOOL_SEARCH=false` | `api_key` | ⚠️ | authStyle 错 + 缺少 `ENABLE_TOOL_SEARCH=false` |
| MiniMax（国内） | `ANTHROPIC_AUTH_TOKEN` | `auth_token` | ✅ | 一致 |
| MiniMax（海外） | `ANTHROPIC_AUTH_TOKEN` | `auth_token` | ✅ | 一致 |
| 火山引擎 | `ANTHROPIC_AUTH_TOKEN` | `auth_token` | ✅ | 一致 |
| 小米 MiMo | `ANTHROPIC_AUTH_TOKEN` | `auth_token` | ✅ | 一致 |
| 阿里云百炼 | `ANTHROPIC_AUTH_TOKEN`（sk-sp-xxx） | `auth_token` | ✅ | 一致 |
| Ollama | `ANTHROPIC_AUTH_TOKEN=ollama` + `ANTHROPIC_API_KEY=""` | `auth_token` | ✅ | 一致 |
| AWS Bedrock | IAM / Bearer Token | `env_only` | ✅ | 一致 |
| Google AI Studio | `GEMINI_API_KEY` | `api_key`（media category） | ✅ | 一致；注：CodePilot 选择 AI Studio 路线，不跟随上游 Vertex 方案 |

### Issue 归因：服务商配置问题不全是 CodePilot 的责任

GitHub 上 100+ 个服务商相关 Issue 的归因分三类：

1. **~1/3 CodePilot preset 错误**（上表 ⚠️ 标注的项）— 修 preset authStyle 即可解决（历史版本也提 `PROVIDER_MANAGED_BY_HOST` 但已确认是死代码，见下方第四节 P0.1）
2. **~1/3 用户认知差**（以为终端 settings.json 配置能被 CodePilot 继承）— 需在配置引导中明确说明两套系统独立
3. **~1/3 用户在服务商侧操作错误**（拿错 Key、未激活 endpoint 等）— 需配置向导放正确的 Key 获取链接 + 配置时立即验证

> 产品侧分析见 [docs/insights/user-audience-analysis.md](../insights/user-audience-analysis.md) 第八节

### 根因分析：为什么 `defaultEnvOverrides` 中的 `ANTHROPIC_API_KEY: ''` 不生效

`toClaudeCodeEnv()`（provider-resolver.ts:228-238）在注入 envOverrides 时，显式跳过 `AUTH_ENV_KEYS`（`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`）。这是为了防止遗留 `extra_env` 中的占位符覆盖新注入的凭证。但副作用是：OpenRouter、GLM 等 preset 中想通过 `defaultEnvOverrides` 清空 `ANTHROPIC_API_KEY` 的意图**被静默忽略**。

### 按计费模式分组

| 模式 | 服务商 |
|------|--------|
| **Coding/Token Plan（订阅制）** | 火山引擎、阿里云百炼、小米 MiMo、智谱 GLM（积分制）、MiniMax |
| **按量付费** | Anthropic、OpenRouter、AWS Bedrock、Kimi/Moonshot、Google AI Studio |
| **免费 / 自托管** | Ollama、LiteLLM |
| **第三方代理（定价不一）** | Aiberm、PipeLLM |

### Google 路线说明

CodePilot 的 Google 支持选择 **AI Studio (Gemini API)** 路线，不跟随上游 Claude Code 的 Vertex AI 方案。原因：Vertex 需要 GCP OAuth + 项目配置，门槛过高；AI Studio 只需一个 API Key。上游 Claude Code 原生支持 Vertex（`CLAUDE_CODE_USE_VERTEX`），这是上游能力，CodePilot 当前不实现。

### 按计费模式分组

| 模式 | 服务商 |
|------|--------|
| **Coding/Token Plan（订阅制）** | 火山引擎、阿里云百炼、小米 MiMo、智谱 GLM（积分制）、MiniMax |
| **按量付费** | Anthropic、OpenRouter、AWS Bedrock、Google Vertex、Kimi/Moonshot、Google Gemini |
| **免费 / 自托管** | Ollama、LiteLLM |
| **第三方代理（定价不一）** | Aiberm、PipeLLM |

---

## 四、已发现的架构问题

### P0：直接导致用户配置失败

#### 1. ~~未设置 `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`~~（废弃，已用 shadow HOME 替代）

> **2026-04-15 更正 + 修复** — 最初文档根据上游未公开/已移除的设计稿提出该方案。实测 `@anthropic-ai/claude-agent-sdk@0.2.62` **全文搜索 0 hit**：既没有 `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` 变量识别，也没有 `withoutHostManagedProviderVars()` / `managedEnv.ts` / `managedEnvConstants.ts` 这些文件。v0.47.0 `commit 6324490` 注入的 `env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1'` 属于死代码，已移除。

**当前方案：per-request shadow `~/.claude/`**

实现：`src/lib/claude-home-shadow.ts`。当显式选中 DB provider 时：
- 建临时 HOME 目录
- `.claude/settings.json` 写入剥离 `ANTHROPIC_*` keys 的副本（保留 mcpServers / hooks / enabledPlugins / permissions / apiKeyHelper / 非认证 env 等所有非认证字段）
- 其余 `~/.claude/<entry>` 通过 symlink（Unix）/ junction（Windows 目录）/ copy（Windows 文件 fallback）镜像到 shadow 中
- SDK 子进程的 HOME / USERPROFILE 指向 shadow root → SDK 的 `qZq()` 读到剥离版 settings.json → 不再覆盖 CodePilot 注入的 provider auth
- env 模式 / 未指定 provider 时 pass-through，cc-switch 路径完全不变

效果：cc-switch 用户用 Claude Code group 时一切如旧；显式选 Kimi/GLM/OpenRouter 时 settings.json 的 ANTHROPIC_* 不再越权覆盖；user-level MCP / plugins / hooks / CLAUDE.md 仍然完整可用。

详细分析见 `docs/exec-plans/active/cc-switch-credential-bridge.md`。

#### 2. 多个高频 preset 的 authStyle 与官方文档不一致

见上方第三节对齐状态表。具体错配：

| 服务商 | 官方要求 | 当前 preset | 错配后果 |
|--------|---------|------------|---------|
| OpenRouter | `auth_token` + 清空 `api_key` | `api_key`（同时注入两个变量） | `ANTHROPIC_API_KEY` 不为空，OpenRouter 可能用错认证头 |
| 智谱 GLM (CN/Global) | `auth_token` | `api_key`（同时注入两个变量） | 同上 |
| Moonshot | `auth_token` + `ENABLE_TOOL_SEARCH=false` | `api_key`（缺少 ENABLE_TOOL_SEARCH） | tool_search 调用导致 400 错误 |
| Kimi | `api_key`（`ANTHROPIC_API_KEY`） | `auth_token`（清空了 API_KEY） | 认证头方式反了 |

**根因**：`toClaudeCodeEnv()` 的 AUTH_ENV_KEYS 跳过机制阻止了 `defaultEnvOverrides` 中清空 `ANTHROPIC_API_KEY` 的意图。

- **位置**：`provider-catalog.ts:162-244` — preset 定义，`provider-resolver.ts:228-238` — AUTH_ENV_KEYS 跳过
- **修复方向**：把错配的 preset authStyle 改正，而非依赖 envOverrides 间接清空

#### 3. 无配置时验证

- 用户可以填入任意 base_url、任意格式的 api_key
- 验证只在实际 API 调用时才发生
- **影响**：用户配置错误后看到模糊报错（"Invalid API key"），不知道是 URL 错了还是 Key 错了还是协议选错了

### P1：影响维护性和可靠性

#### 4. 模型目录主要来自静态 preset，但已有多种补充路径

模型列表**不全是硬编码**——`providers/models/route.ts` 会合并以下来源：
1. `provider_models` 表（用户自定义）
2. `VendorPreset.defaultModels`（静态预设）
3. `role_models_json`（角色映射额外条目）
4. `env_overrides_json` 中的遗留 `ANTHROPIC_MODEL`

但 preset 静态列表仍是大多数用户看到的来源，服务商出新模型后需要等 CodePilot 发版。

- **优化方向**：优先复用现有 `provider_models` / `role_models_json` 路径改善 UI，不要先起独立的远程模型系统

#### 5. 已删除 Provider 的会话恢复

- 用户在 Provider X 下创建会话，之后删除 Provider X
- 恢复会话时 `resolveProvider()` 找不到 Provider，回退到默认
- 但 `sdk_session_id` 属于旧 Provider 的 conversation
- **已有缓解**：provider/model 变化时会清掉旧 `sdk_session_id`（chat session route:44），删除默认 provider 时 API 路径会做自愈（providers/[id]/route.ts:86）
- **建议**：做软约束——切换 provider 时提示"将开启新 SDK 会话"，而不是硬锁禁止切换

#### 6. 默认 Provider 指向已删除记录

- `default_provider_id` 可能指向已删除的 Provider
- 只在 `/api/doctor/repair` 和少数路径自动修复
- **影响**：其他路径解析到不存在的 Provider

### P2：代码整洁度

#### 7. Chat 流程中重复 Provider 构建

- Chat route 调用 `resolveProviderUnified()`（route.ts:157），传给 `streamClaude()`
- `streamClaude()` 内部调用 `resolveForClaudeCode()`（claude-client.ts:445）
- **实际风险较低**：`resolveForClaudeCode()` 在拿到显式 provider 时直接返回（provider-resolver.ts:122），不会二次查 DB
- **本质**：重复构建 resolution 对象，代码整洁度问题，非竞态根因

#### 8. 角色模型环境变量注入时序

- 用户显式选择模型时，`roleModels.default` 被覆盖为 upstream ID
- 但 `roleModels.reasoning` / `roleModels.small` 仍指向旧值
- **影响**：多角色场景下可能发错模型（概率低，大多数请求不使用多角色）

#### 9. Base URL 标准化不一致

- `toAiSdkConfig()` 补全缺失的 `/v1`
- `toClaudeCodeEnv()` 不标准化——直接传原始 URL
- **已缓解**：SDK 内部有自己的标准化逻辑

---

## 五、服务商配置快速参考

### 每个服务商的 API Key 获取地址

| 服务商 | API Key 获取 |
|--------|-------------|
| Anthropic 官方 | https://platform.claude.com/settings/keys |
| OpenRouter | https://openrouter.ai/workspaces/default/keys |
| 智谱 GLM（国内） | https://bigmodel.cn/usercenter/proj-mgmt/apikeys |
| 智谱 GLM（海外） | https://z.ai/manage-apikey/apikey-list |
| Kimi | https://www.kimi.com/code/console |
| Moonshot | https://platform.moonshot.cn/console/api-keys |
| MiniMax（国内） | https://platform.minimaxi.com/user-center/payment/token-plan |
| MiniMax（海外） | https://platform.minimax.io/user-center/payment/token-plan |
| 火山引擎 | https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement |
| 小米 MiMo（按量） | https://platform.xiaomimimo.com/#/console/api-keys |
| 小米 MiMo（套餐） | https://platform.xiaomimimo.com/#/console/plan-manage |
| 阿里云百炼 | https://bailian.console.aliyun.com (Coding Plan 页) |
| AWS Bedrock | https://console.aws.amazon.com (IAM) |
| Google AI Studio | https://aistudio.google.com/api-keys |
| Ollama | 无需（本地） |
| LiteLLM | 无需（自托管） |
| Google Gemini | https://aistudio.google.com/api-keys |

### 每个服务商的官方配置文档

| 服务商 | 文档链接 |
|--------|---------|
| Anthropic | https://platform.claude.com/docs/en/api/overview |
| OpenRouter | https://openrouter.ai/docs/guides/coding-agents/claude-code-integration |
| 智谱 GLM（国内） | https://docs.bigmodel.cn/cn/coding-plan/tool/claude |
| 智谱 GLM（海外） | https://docs.z.ai/devpack/tool/claude |
| Kimi | https://www.kimi.com/code/docs/more/third-party-agents.html |
| Moonshot | https://platform.moonshot.cn/docs/guide/agent-support |
| MiniMax（国内） | https://platform.minimaxi.com/docs/token-plan/claude-code |
| MiniMax（海外） | https://platform.minimax.io/docs/token-plan/opencode |
| 火山引擎 | https://www.volcengine.com/docs/82379/1928262 |
| 小米 MiMo | https://platform.xiaomimimo.com/#/docs/integration/claudecode |
| 阿里云百炼 | https://help.aliyun.com/zh/model-studio/coding-plan |
| AWS Bedrock | https://aws.amazon.com/cn/bedrock/anthropic/ |
| Google AI Studio | https://ai.google.dev/gemini-api/docs/gemini-3 |
| Ollama | https://docs.ollama.com/integrations/claude-code |
| LiteLLM | https://docs.litellm.ai/docs/ |
| Google Gemini（图片） | https://ai.google.dev/gemini-api/docs/image-generation |

### 第三方 Anthropic 代理参考（不推荐，不透出到引导）

| 服务商 | 参考文档 |
|--------|---------|
| Aiberm | https://aiberm.com/docs/zh/claude-code/ |
| PipeLLM | https://code.pipellm.ai/docs/cc-switch |

---

## 六、架构优化建议

### P0：立即修复（直接影响用户配置成功率）

#### 1. ~~接入 `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`~~（已废弃，用 shadow HOME 替代）

> **2026-04-15 更正 + 修复** — 见本文件第四节 P0.1 的最新方案：通过 `src/lib/claude-home-shadow.ts` 在 DB provider 请求里建剥离 `ANTHROPIC_*` 的临时 `~/.claude/`，既屏蔽 settings.json 的 auth env 越权，又保留 user-level MCP/plugins/hooks/CLAUDE.md。

#### 2. 修正高频 preset 的 authStyle

| 服务商 | 当前 authStyle | 应改为 | 额外改动 |
|--------|--------------|--------|---------|
| OpenRouter | `api_key` | `auth_token` | 无需 envOverrides 清空 API_KEY（auth_token 模式自动清空） |
| 智谱 GLM (CN) | `api_key` | `auth_token` | 移除 envOverrides 中的 `ANTHROPIC_API_KEY: ''` |
| 智谱 GLM (Global) | `api_key` | `auth_token` | 同上 |
| Moonshot | `api_key` | `auth_token` | 添加 `ENABLE_TOOL_SEARCH: 'false'` 到 envOverrides |
| Kimi | `auth_token` | `api_key` | 添加 `ENABLE_TOOL_SEARCH: 'false'` 到 envOverrides |

**改动范围**：`provider-catalog.ts` — 5 个 preset 的 authStyle 字段。
**风险**：中——需要确认已有用户的 DB 记录是否也需要迁移。

#### 3. 配置时连通性验证

在用户保存 Provider 配置时，立即发一个轻量请求验证：
- API Key 是否有效
- Base URL 是否可达
- 协议是否匹配
- 模型是否存在

返回明确的分类错误："Key 无效" / "URL 不通" / "协议不匹配" / "模型不存在"

#### 4. 服务商特定注意事项前置

在配置 UI 中，根据所选服务商动态显示：
- 智谱：高峰期 3 倍计费提醒
- Kimi：必须关闭 tool_search
- 小米 MiMo：不支持 Thinking 模式
- 阿里云百炼：必须用 Coding Plan Key（sk-sp-xxx），不要用普通 DashScope Key
- 火山引擎：需先激活 endpoint
- Moonshot：建议设置每日消费上限

### P1：近期优化

#### 5. 模型目录改善

优先复用现有 `provider_models` / `role_models_json` 路径，改善 UI 让用户更容易手动添加模型。不要先起独立的远程模型系统。

#### 6. Provider 健康检查

定期对已配置的 base_url 做连通性检测，在设置页显示状态（绿/红）。删除正在使用的 Provider 时弹出警告。

#### 7. 会话 Provider 软约束

切换 Provider 时提示"将开启新 SDK 会话"，而不是硬锁禁止切换。现有的 `sdk_session_id` 清除逻辑已经覆盖了大部分场景。

### P2：功能完整性

#### 8. Azure AI Foundry 支持

Claude Code 上游已支持 `@anthropic-ai/foundry-sdk`（`CLAUDE_CODE_USE_FOUNDRY`），CodePilot 缺少 `foundry` 协议。

#### 9. 3P 模型能力声明

上游支持通过 `ANTHROPIC_DEFAULT_*_MODEL_SUPPORTED_CAPABILITIES` 声明第三方模型能力。CodePilot 可以在 preset 中预设这些值，让 SDK 知道哪些第三方模型支持 thinking/effort 等功能。

---

## 七、配置模式统一性分析

### 核心发现：12/18 个服务商使用同一模式

```
ANTHROPIC_BASE_URL = https://<endpoint>/anthropic
ANTHROPIC_AUTH_TOKEN = <api-key>
ANTHROPIC_MODEL = <model-id>
API_TIMEOUT_MS = 3000000
```

这意味着**一个统一的配置表单就能覆盖 67% 的服务商**：选服务商 → 自动填 URL → 用户填 Key → 可选填模型 → 测试连通 → 完成。

### 需要特殊处理的服务商

| 服务商 | 特殊点 |
|--------|--------|
| OpenRouter | `auth_token` 模式 + 清空 `ANTHROPIC_API_KEY`，模型 ID 带前缀 `anthropic/` |
| Kimi | `api_key` 模式（非 auth_token），必须 `ENABLE_TOOL_SEARCH=false` |
| AWS Bedrock | 完全不同的认证流程（IAM），无 base_url |
| Ollama | 伪认证 `ollama`，本地 URL |
| Google AI Studio / Gemini（图片） | 独有 Gemini API 协议，不兼容 Anthropic/OpenAI |
| 阿里云百炼 | 必须用特殊格式 Key（sk-sp-xxx） |
