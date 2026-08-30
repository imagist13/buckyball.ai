# 服务商治理系统

> 产品思考见 [docs/insights/user-audience-analysis.md](../insights/user-audience-analysis.md)
> 架构全景见 [provider-architecture.md](./provider-architecture.md)
> 执行计划见 [docs/exec-plans/completed/provider-governance.md](../exec-plans/completed/provider-governance.md)

---

## 一、改动概览

6 Phase 服务商治理方案的完整实施。目标：从根本上提升服务商配置的稳定性、灵活性和用户体验。

---

## 二、Preset 声明式防护（Phase 1）

### Zod Schema 校验

**文件**：`src/lib/provider-catalog.ts`

所有 `VENDOR_PRESETS` 在模块加载时经过 `PresetSchema.parse()` 校验。不合法的 preset 在 `npm run test` 阶段直接崩溃。

Schema refinement 规则：
- `auth_token` preset 禁止 `defaultEnvOverrides` 含 `ANTHROPIC_API_KEY`
- `api_key` preset 禁止 `defaultEnvOverrides` 含 `ANTHROPIC_AUTH_TOKEN`

### Meta 元信息

每个 preset 新增 `meta` 字段：

```typescript
meta?: {
  apiKeyUrl?: string;      // 用户获取 Key 的页面
  docsUrl?: string;        // 官方配置文档
  pricingUrl?: string;     // 定价页
  billingModel: 'pay_as_you_go' | 'coding_plan' | 'token_plan' | 'free' | 'self_hosted';
  notes?: string[];        // 配置时显示的注意事项
}
```

18 个 chat/media preset 均已填充 meta。新增服务商时必须同时填写 meta。

### 测试覆盖

**文件**：`src/__tests__/unit/provider-preset.test.ts`（61 个测试）

- 遍历所有 preset 逐个 Zod schema 校验
- authStyle 与 envOverrides 冲突检测
- 6 个 authStyle 回归测试

---

## 三、authStyle 修正（Phase 2）

### 修正的 preset

| preset | 改动 | 原因 |
|--------|------|------|
| openrouter | `api_key` → `auth_token` | 官方要求 Bearer + 清空 API_KEY |
| glm-cn | `api_key` → `auth_token` | 官方要求 ANTHROPIC_AUTH_TOKEN |
| glm-global | `api_key` → `auth_token` | 同上 |
| moonshot | `api_key` → `auth_token` + `ENABLE_TOOL_SEARCH: 'false'` | 官方要求 |
| kimi | `auth_token` → `api_key` + `ENABLE_TOOL_SEARCH: 'false'` | 官方用 ANTHROPIC_API_KEY |
| bailian | `api_key` → `auth_token` | 官方要求 ANTHROPIC_AUTH_TOKEN |

### api_key 模式不再双注入

**文件**：`src/lib/provider-resolver.ts`

`toClaudeCodeEnv()` 的 `api_key` 分支只设 `ANTHROPIC_API_KEY`，不再同时设 `ANTHROPIC_AUTH_TOKEN`。防止上游 Claude Code 添加 Bearer 头与 API-key-only 服务商冲突。

### ~~宿主接管~~（已用 shadow HOME 替代）

> **2026-04-15 更正 + 修复** — 原方案在 `toClaudeCodeEnv()` 末尾注入 `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1` 是死代码（SDK 0.2.62 不识别）。当前实现：`src/lib/claude-home-shadow.ts` 在 DB provider 请求里建剥离 `ANTHROPIC_*` 的临时 `~/.claude/`，user-level MCP/plugins/hooks 全部保留。详见 `docs/exec-plans/active/cc-switch-credential-bridge.md`。

### authStyle 单一真相源

| 位置 | 之前 | 之后 |
|------|------|------|
| PresetConnectDialog 创建态 | 从 extra_env JSON 推断 | 读 `preset.authStyle` |
| PresetConnectDialog 编辑态 | 从 extra_env 推断 | 读 `preset.authStyle`（thirdparty 除外） |
| ProviderManager badge | 从 `extra_env` 检查 | 读 `findMatchingPreset().authStyle` |
| provider-doctor 修复建议 | 从 extra_env 推断 | 通过 `findPresetForLegacy()` 查 preset |

Legacy fallback `inferAuthStyleFromLegacy()` 仅作用于无法匹配 preset 的自建 provider。

---

## 四、连通性验证（Phase 3）

### API 端点

**文件**：`src/app/api/providers/test/route.ts`

`POST /api/providers/test` — 接受 provider 配置（不需要先保存到 DB），直接发 HTTP 请求验证。

### 实现方式

**文件**：`src/lib/claude-client.ts` — `testProviderConnection()`

直接发 HTTP POST 到 `{baseUrl}/v1/messages`，不走 Claude Code SDK 子进程（SDK 有自己的 keychain/OAuth 凭证解析，会导致假阳性）。

- `auth_token` → `Authorization: Bearer` 头
- `api_key` → `x-api-key` 头
- 2xx = 成功，4xx/5xx = 通过 error-classifier 分类
- 网络错误（ECONNREFUSED/DNS/timeout）= 分类错误
- bedrock/vertex/env_only = 跳过 HTTP 测试（返回 SKIPPED 中性状态）
- 15 秒超时

### 前端

**文件**：`src/components/settings/PresetConnectDialog.tsx`

- "测试连接" 按钮，调用 POST /api/providers/test
- 三种结果状态：绿色成功 / 中性 SKIPPED / 红色失败
- 失败时显示分类错误 + recoveryAction 链接
- thirdparty preset 使用用户手选的 authStyle（不被 preset 固定值覆盖）
- 切换弹窗时自动清空上次测试结果

---

## 五、用户引导 UX（Phase 4）

### QUICK_PRESETS 去重

**文件**：`src/components/settings/provider-presets.tsx`

删除 295 行手写 `QUICK_PRESETS`，改为从 `VENDOR_PRESETS` 自动生成：

- `resolveIcon(iconKey)` — 映射 iconKey → React 组件
- `toQuickPreset(VendorPreset)` — 转换格式
- `QUICK_PRESETS = VENDOR_PRESETS.map(toQuickPreset)`

`QuickPreset` 接口保留（带 `icon: ReactNode` + `authStyle` + `meta`），下游组件无需改动。

新增服务商只需在 `provider-catalog.ts` 添加一个 preset 对象。

### Meta 引导面板

PresetConnectDialog 中显示：
- 计费标签（Pay-as-you-go / Coding Plan / Token Plan / Free / Self-hosted）
- "获取 API Key" 链接（指向 `meta.apiKeyUrl`）
- "配置指南" 链接（指向 CodePilot 官网文档）
- 注意事项警告（amber callout，来自 `meta.notes`）

---

## 六、错误恢复动作（Phase 5）

### 后端

**文件**：`src/lib/error-classifier.ts`

- `RecoveryAction` 接口：`{ label, url?, action? }`
- `ErrorContext` 新增 `providerMeta`（apiKeyUrl/docsUrl/pricingUrl）
- `ClassifiedError` 新增 `recoveryActions` 字段
- `buildRecoveryActions()` 按错误类别生成：AUTH → Get Key + Settings、RATE → Retry + Upgrade、SESSION → New Conversation
- 严重错误（PROCESS_CRASH/UNKNOWN/CLI_NOT_FOUND）自动上报 Sentry

### 前端

**文件**：`src/hooks/useSSEStream.ts`

SSE error 事件中渲染 recoveryActions：
- URL 动作 → markdown 外部链接
- `open_settings` → `/settings#providers`
- `new_conversation` → `/chat`

---

## 七、模型 CRUD API（Phase 6）

**文件**：`src/app/api/providers/[id]/models/route.ts`

- `GET` — 列出 provider 自定义模型
- `POST` — 添加/更新（upsert by provider_id + model_id）
- `DELETE` — 删除

使用现有 `provider_models` 表和 DB 函数。

---

## 八、关键文件清单

| 文件 | 职责 |
|------|------|
| `src/lib/provider-catalog.ts` | Preset 定义 + Zod Schema + Meta |
| `src/lib/provider-resolver.ts` | 统一解析 + env 构建 + 宿主接管 |
| `src/lib/error-classifier.ts` | 错误分类 + RecoveryAction + Sentry 上报 |
| `src/lib/claude-client.ts` | testProviderConnection() 直接 HTTP 验证 |
| `src/app/api/providers/test/route.ts` | 连通性测试 API |
| `src/app/api/providers/[id]/models/route.ts` | 模型 CRUD API |
| `src/components/settings/provider-presets.tsx` | VENDOR_PRESETS → QUICK_PRESETS 映射 |
| `src/components/settings/PresetConnectDialog.tsx` | 配置弹窗 + 测试按钮 + Meta 面板 |
| `src/components/settings/ProviderManager.tsx` | authStyle badge 从 preset 读取 |
| `src/lib/provider-doctor.ts` | 修复建议从 preset catalog 读 authStyle |
| `src/__tests__/unit/provider-preset.test.ts` | 61 个 preset 校验测试 |
