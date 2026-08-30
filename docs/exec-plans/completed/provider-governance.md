# 服务商系统治理方案

> 创建时间：2026-04-04
> 最后更新：2026-04-04
> 前置文档：[handover/provider-architecture.md](../../handover/provider-architecture.md)
> 参考项目：Claude Code CLI 源码、OpenCode、Craft Agents

## 问题本质

当前服务商系统的脆弱性不是某个 bug，而是**架构上缺少防护层**：

1. **Preset 是一堆手写的对象，没有任何机制验证它们是否正确。** 改一个 authStyle、加一个 envOverride，没有测试告诉你"这组配置跑不通"。
2. **配置和逻辑互相打架。** Preset 的 `defaultEnvOverrides` 试图清空 `ANTHROPIC_API_KEY`，但 `toClaudeCodeEnv()` 的 AUTH_ENV_KEYS 跳过机制把这个意图静默吞掉了。两层各自有道理，合在一起就出 bug。
3. **用户在配置时得不到任何反馈。** 填完 Key 没有验证，等发消息才发现不对，报错信息还是技术性的。
4. **服务商信息散落在代码各处。** 名称在 catalog、URL 在 preset、获取 Key 的链接不存在、报错提示不知道是哪家的问题。

## 目标

改完之后应该是这样的：

1. **加一个新服务商** = 写一个声明式配置文件 + 跑通自动化测试 → 就能上线
2. **改一个模型名** = 改配置文件 → 测试自动告诉你有没有破坏别的服务商
3. **用户配置服务商** = 选服务商 → 看到"去这里买/获取 Key" → 填 Key → 立即验证 → 成功/明确告知哪里错了
4. **运行时出错** = 用户看到"智谱 GLM 返回了 401，可能是 API Key 过期，点这里重新获取" → 不是一个技术性的 stack trace

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 架构设计 + 参考项目调研 | ✅ 已完成 | 本文档 |
| Phase 1 | Preset 声明式改造 + Schema 校验 | ✅ 已完成 | Zod PresetSchema + meta 字段 + 61 个新测试 |
| Phase 2 | 宿主接管 + authStyle 修正 | ⚠️ 部分完成（见 2.1 更正） | 6 个 authStyle 修正已落；~~PROVIDER_MANAGED_BY_HOST 注入~~ 于 2026-04-15 确认是死代码并回滚 |
| Phase 3 | 配置时连通性验证 | ✅ 已完成 | POST /api/providers/test + testProviderConnection() |
| Phase 4 | 用户引导 UX（服务商信息面板） | ✅ 已完成 | QUICK_PRESETS 去重（-181 行），meta 流通到前端 |
| Phase 5 | 运行时错误治理 | ✅ 已完成 | RecoveryAction + providerMeta → 分类错误码 + 恢复按钮 |
| Phase 6 | 模型目录动态化 | ✅ 已完成 | per-provider model CRUD API（GET/POST/DELETE） |

## 决策日志

- 2026-04-04: 参考了三个项目的架构：
  - **OpenCode** — Registry + Lazy Factory + Plugin，用 models.dev 做外部模型目录，Zod schema 校验所有配置，10+ 种错误模式匹配
  - **Craft Agents** — Driver 模式，连接模板，CredentialManager 多后端，ModelRefreshService 回退链，配置时连通性测试 + RecoveryAction
  - **Claude Code CLI** — 扁平 if/else，~~`PROVIDER_MANAGED_BY_HOST` 宿主接管~~（此机制来自上游设计稿，实测 SDK 0.2.62 未实现，已于 2026-04-15 回滚注入逻辑），per-provider 模型 ID 映射，529 自动切模型
- 2026-04-04: 决策不做 Google Vertex，只走 AI Studio (Gemini API) 路线
- 2026-04-04: 决策会话切换 provider 做软约束（提示开新会话），不硬锁

---

## Phase 1：Preset 声明式改造 + Schema 校验

### 设计思路

**学习 Craft Agents 的 Connection Template + OpenCode 的 Zod Schema。**

现在 `provider-catalog.ts` 里的 preset 是一个巨大的数组，字段之间有隐式约束但没有显式校验。比如 `authStyle: 'auth_token'` 的 preset 不应该在 `defaultEnvOverrides` 里出现 `ANTHROPIC_API_KEY`，但没有任何东西阻止你这么写。

### 改动

#### 1.1 新增 Preset Schema（Zod）

```typescript
// provider-catalog.ts 顶部新增
const PresetSchema = z.object({
  key: z.string(),
  name: z.string(),
  protocol: ProtocolSchema,
  authStyle: AuthStyleSchema,
  baseUrl: z.string().url().optional(),
  defaultEnvOverrides: z.record(z.string()).optional(),
  defaultModels: z.array(CatalogModelSchema),
  fields: z.array(z.string()),
  sdkProxyOnly: z.boolean().optional(),
  // --- 新增：服务商元信息 ---
  meta: z.object({
    apiKeyUrl: z.string().url(),           // 去哪获取 Key
    docsUrl: z.string().url(),             // 官方配置文档
    pricingUrl: z.string().url().optional(), // 定价页
    statusPageUrl: z.string().url().optional(), // 服务状态页
    billingModel: z.enum(['pay_as_you_go', 'coding_plan', 'token_plan', 'free', 'self_hosted']),
    notes: z.array(z.string()).optional(),  // 配置时显示的注意事项
  }),
}).refine(data => {
  // 约束：auth_token 模式不应该在 envOverrides 里出现 ANTHROPIC_API_KEY
  if (data.authStyle === 'auth_token' && data.defaultEnvOverrides?.ANTHROPIC_API_KEY !== undefined) {
    return false;
  }
  // 约束：api_key 模式不应该在 envOverrides 里出现 ANTHROPIC_AUTH_TOKEN
  if (data.authStyle === 'api_key' && data.defaultEnvOverrides?.ANTHROPIC_AUTH_TOKEN !== undefined) {
    return false;
  }
  return true;
}, { message: 'authStyle 和 defaultEnvOverrides 中的 auth 变量冲突' });
```

#### 1.2 编译期校验

在 `provider-catalog.ts` 末尾加一行：

```typescript
// 编译期校验所有 preset
VENDOR_PRESETS.forEach(p => PresetSchema.parse(p));
```

这样任何不合法的 preset 都会在 `npm run test`（typecheck）阶段直接报错，而不是等用户来报。

#### 1.3 Preset 单元测试

新增 `src/__tests__/unit/provider-preset.test.ts`：

```typescript
for (const preset of VENDOR_PRESETS) {
  test(`preset ${preset.key}: schema valid`, () => {
    expect(() => PresetSchema.parse(preset)).not.toThrow();
  });
  
  test(`preset ${preset.key}: meta has valid URLs`, () => {
    // 验证 apiKeyUrl、docsUrl 格式正确
  });
  
  test(`preset ${preset.key}: authStyle 和 envOverrides 不冲突`, () => {
    // 具体校验逻辑
  });
  
  test(`preset ${preset.key}: defaultModels 至少有一个`, () => {
    expect(preset.defaultModels.length).toBeGreaterThan(0);
  });
}
```

### 每个 Preset 新增的 meta 字段内容

> 数据来源：用户提供的服务商配置文档

| 服务商 | apiKeyUrl | docsUrl | billingModel |
|--------|-----------|---------|-------------|
| Anthropic | platform.claude.com/settings/keys | platform.claude.com/docs/en/api/overview | pay_as_you_go |
| OpenRouter | openrouter.ai/workspaces/default/keys | openrouter.ai/docs/guides/coding-agents/claude-code-integration | pay_as_you_go |
| 智谱 GLM (CN) | bigmodel.cn/usercenter/proj-mgmt/apikeys | docs.bigmodel.cn/cn/coding-plan/tool/claude | coding_plan |
| 智谱 GLM (Global) | z.ai/manage-apikey/apikey-list | docs.z.ai/devpack/tool/claude | coding_plan |
| Kimi | kimi.com/code/console | kimi.com/code/docs/more/third-party-agents.html | pay_as_you_go |
| Moonshot | platform.moonshot.cn/console/api-keys | platform.moonshot.cn/docs/guide/agent-support | pay_as_you_go |
| MiniMax (CN) | platform.minimaxi.com/user-center/payment/token-plan | platform.minimaxi.com/docs/token-plan/claude-code | token_plan |
| MiniMax (Global) | platform.minimax.io/user-center/payment/token-plan | platform.minimax.io/docs/token-plan/opencode | token_plan |
| 火山引擎 | console.volcengine.com/ark (openManagement) | volcengine.com/docs/82379/1928262 | coding_plan |
| 小米 MiMo (按量) | platform.xiaomimimo.com/#/console/api-keys | platform.xiaomimimo.com/#/docs/integration/claudecode | pay_as_you_go |
| 小米 MiMo (套餐) | platform.xiaomimimo.com/#/console/plan-manage | platform.xiaomimimo.com/#/docs/integration/claudecode | token_plan |
| 阿里云百炼 | bailian.console.aliyun.com (Coding Plan) | help.aliyun.com/zh/model-studio/coding-plan | coding_plan |
| AWS Bedrock | console.aws.amazon.com (IAM) | aws.amazon.com/cn/bedrock/anthropic/ | pay_as_you_go |
| Google AI Studio | aistudio.google.com/api-keys | ai.google.dev/gemini-api/docs/gemini-3 | pay_as_you_go |
| Ollama | (无需) | docs.ollama.com/integrations/claude-code | free |
| LiteLLM | (无需) | docs.litellm.ai/docs/ | self_hosted |

每个 preset 的 `meta.notes` 示例：

```typescript
// 智谱 GLM
notes: ['高峰时段（14:00-18:00 UTC+8）消耗 3 倍积分', '需设置 API_TIMEOUT_MS=3000000']

// Kimi
notes: ['必须关闭 tool_search，否则会触发 400 错误']

// 小米 MiMo
notes: ['不支持 Thinking 模式，请在设置中关闭']

// 阿里云百炼
notes: ['必须使用 Coding Plan 专用 Key（以 sk-sp- 开头）', '普通 DashScope Key 无法使用', '禁止用于自动化脚本']

// 火山引擎
notes: ['需先在控制台激活 Endpoint', 'API Key 为临时凭证']
```

---

## Phase 2：宿主接管 + authStyle 修正

### 2.1 ~~注入 `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`~~（已用 shadow HOME 替代）

> **2026-04-15 更正 + 修复** — 本节原方案基于上游设计稿（`managedEnv.ts` / `withoutHostManagedProviderVars()`），但实测 `@anthropic-ai/claude-agent-sdk@0.2.62` 全文 0 hit，该 flag 从未被 SDK 识别。死代码已移除。
>
> **当前实现：per-request shadow `~/.claude/`**（`src/lib/claude-home-shadow.ts`）
>
> 按 provider group 决定凭据归属：env group 完全尊重 settings.json/cc-switch；DB provider 请求时建剥离 `ANTHROPIC_*` 的临时 `~/.claude/`，其余文件/目录通过 symlink 镜像，user-level MCP/plugins/hooks/CLAUDE.md 全部保留。
>
> 详细决策日志见 `docs/exec-plans/active/cc-switch-credential-bridge.md`。

### 2.2 修正 5 个 preset 的 authStyle

| preset key | 改动 |
|-----------|------|
| `openrouter` | `authStyle: 'api_key'` → `'auth_token'`，移除 `defaultEnvOverrides.ANTHROPIC_API_KEY` |
| `glm-cn` | `authStyle: 'api_key'` → `'auth_token'`，移除 `defaultEnvOverrides.ANTHROPIC_API_KEY` |
| `glm-global` | 同上 |
| `moonshot` | `authStyle: 'api_key'` → `'auth_token'`，移除 `defaultEnvOverrides.ANTHROPIC_API_KEY`，新增 `ENABLE_TOOL_SEARCH: 'false'` |
| `kimi` | `authStyle: 'auth_token'` → `'api_key'`，移除 `defaultEnvOverrides.ANTHROPIC_AUTH_TOKEN`，新增 `ENABLE_TOOL_SEARCH: 'false'` |

### 2.3 已有用户 DB 迁移

已保存的 provider 记录里可能带着旧的 authStyle 推断出的 env_overrides_json。需要在 DB migration 中：

- **不删数据**（遵守 migration safety 规则）
- 如果 provider 的 base_url 匹配已知 preset，用新 preset 的 authStyle 更新记录
- 对于用户手动创建的自定义 provider，保持不变

---

## Phase 3：配置时连通性验证

### 设计思路

**学习 Craft Agents 的 `validateAnthropicConnection()`。** 用户填完 Key → 点"测试" → 发一个最小请求 → 立即告诉用户结果。

### 改动

#### 3.1 新增 `POST /api/providers/test` 路由

```typescript
// 输入：provider 配置（不需要先保存到 DB）
// 流程：
// 1. 用 PresetSchema 校验配置合法性
// 2. 用 toClaudeCodeEnv() 构建环境变量
// 3. 发一个最小 Claude Agent SDK 请求（maxTurns: 1, systemPrompt: 'Reply OK'）
// 4. 解析响应/错误
// 输出：{ success: true } 或 { success: false, code: 'invalid_api_key', message: '...', suggestion: '...' }
```

#### 3.2 错误码分类

学习 OpenCode 的错误模式匹配 + Craft Agents 的 RecoveryAction：

| 错误码 | 用户看到的提示 | 建议操作 |
|--------|-------------|---------|
| `invalid_api_key` | "API Key 无效，请检查是否复制完整" | 跳转到 apiKeyUrl |
| `endpoint_unreachable` | "无法连接到 {服务商名称}，请检查网络" | 检查代理设置 |
| `wrong_key_type` | "Key 格式不匹配，{服务商} 需要 {格式} 开头的 Key" | 跳转到 apiKeyUrl |
| `model_not_found` | "模型 {name} 在此服务商不可用" | 查看可用模型列表 |
| `rate_limited` | "连接成功，但当前被限流" | 等待或升级套餐 |
| `billing_required` | "账户余额不足或未开通计费" | 跳转到 pricingUrl |
| `endpoint_not_activated` | "Endpoint 未激活（火山引擎）" | 跳转到控制台 |
| `tool_search_error` | "tool_search 调用失败（Kimi/Moonshot）" | 自动关闭或提示 |

#### 3.3 UI 集成

配置表单底部加一个"测试连接"按钮：
- 点击后显示 loading
- 成功：绿色 ✓ "连接成功，检测到 {模型数} 个可用模型"
- 失败：红色 ✗ + 上述分类错误信息 + 建议操作按钮

---

## Phase 4：用户引导 UX（服务商信息面板）

### 设计思路

**配置页面应该像一个向导，不是一个表单。**

用户选择服务商后，应该看到：
1. 这家是谁（一句话描述 + 计费模式标签）
2. 去哪获取 Key（直接跳转按钮）
3. 注意事项（从 `meta.notes` 读取）
4. 填写区域（Key + 可选的模型选择）
5. 测试按钮

### 改动

#### 4.1 服务商选择卡片

每个服务商卡片显示：
- 图标 + 名称
- 计费模式标签（`pay_as_you_go` / `coding_plan` / `token_plan` / `free`）
- 一句话描述

#### 4.2 配置面板（选中服务商后展开）

```
┌──────────────────────────────────────────┐
│  [智谱 GLM 图标]  智谱 GLM（国内）        │
│  Coding Plan · 积分制                     │
│                                          │
│  ⚠️ 高峰时段（14:00-18:00）消耗 3 倍积分   │
│                                          │
│  [去获取 API Key →]  [查看配置文档 →]      │
│                                          │
│  API Key: [________________________]      │
│                                          │
│  [测试连接]                               │
│                                          │
│  ✓ 连接成功，检测到 3 个可用模型            │
└──────────────────────────────────────────┘
```

#### 4.3 数据来源

所有文案来自 preset 的 `meta` 字段——不需要额外维护，加新服务商时一起填。

---

## Phase 5：运行时错误治理

### 设计思路

**学习 Craft Agents 的 `AgentError` + `RecoveryAction` 模式。**

现在用户看到的报错是 "Error: 401 Unauthorized" 或者更糟——一个技术性的 JSON。应该是 "智谱 GLM 返回了认证失败，可能是 API Key 已过期。[重新获取 Key →] [查看诊断 →]"

### 改动

#### 5.1 错误信息携带服务商上下文

`error-classifier.ts` 的输出新增：

```typescript
interface ClassifiedError {
  code: ErrorCode;
  message: string;           // 用户看到的
  providerName: string;      // "智谱 GLM" 不是 "glm-cn"
  suggestion: string;        // "请检查 API Key 是否过期"
  actions: RecoveryAction[]; // [{ label: '重新获取 Key', url: apiKeyUrl }]
}
```

#### 5.2 学习 OpenCode 的错误模式匹配

```typescript
const OVERFLOW_PATTERNS = [
  /prompt is too long/i,              // Anthropic
  /input is too long/i,               // Bedrock
  /exceeds the context window/i,      // OpenAI compatible
  /maximum context length/i,          // OpenRouter/DeepSeek
];

const AUTH_PATTERNS = [
  /invalid.*api.*key/i,
  /unauthorized/i,
  /authentication.*failed/i,
];
```

不是按 HTTP status code 分类，而是按**错误消息模式**分类——因为不同服务商对同一种错误返回的 status code 不一样。

---

## Phase 6：模型目录动态化

### 设计思路

**不急于上独立的远程系统。** 先把现有的 `provider_models` + `role_models_json` 路径用好。

### 改动

#### 6.1 改善模型管理 UI

- 用户可以在 Provider 设置中看到当前可用模型列表
- 可以手动添加/删除模型（已有 `provider_models` 表支持）
- 手动添加的模型不会被 preset 更新覆盖

#### 6.2 模型发现（可选，学习 Craft Agents 的 ModelRefreshService）

```
回退链：
1. Provider API 发现（如果服务商提供 GET /models）
2. 用户自定义模型（provider_models 表）
3. Preset 默认模型列表
```

保留用户的选择——如果用户手动选了某个模型且仍然可用，自动刷新不应该覆盖它。

---

## 对比：改造前 vs 改造后

| 场景 | 改造前 | 改造后 |
|------|-------|-------|
| 加新服务商 | 手写 preset 对象，没有校验，上线后用户报 bug 才发现错 | 写声明式配置 + meta，Schema 校验不过则 test 失败，不可能带错上线 |
| 改模型名 | 改 catalog，不确定有没有破坏别的，祈祷 | 改配置，preset 测试自动验证所有服务商不受影响 |
| 用户配置 GLM | 填 Key → 发消息 → 报错 401 → 截图发 Issue | 填 Key → 点测试 → 立即成功/立即看到"Key 无效，去这里重新获取" |
| 终端 Claude Code 配了 Bedrock，打开 CodePilot 选 OpenRouter | 请求莫名跑到 Bedrock，用户完全无法理解 | ✅ 2026-04-15 通过 per-request shadow `~/.claude/` 实现真正隔离：DB provider 请求时自动剥离 settings.json 的 ANTHROPIC_*，其余 user-level MCP/plugins/hooks/CLAUDE.md 不受影响 |
| 运行时 API 报错 | "Error: 401 Unauthorized" | "智谱 GLM 认证失败，可能是 Key 过期。[重新获取 →]" |
| 百炼用户拿错 Key | 模糊报错，来回沟通 5 条 Issue 评论 | 配置时提示"请使用 sk-sp- 开头的 Coding Plan Key"，测试时立即检出 |
