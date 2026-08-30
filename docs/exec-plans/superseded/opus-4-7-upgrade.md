> **Archive note（2026-06-05，document-system-governance）**：本计划已移出 `active/`，归入 `superseded/`——被 refactor-closeout 接管，仅作历史参考。**不是当前任务入口**；当前工作入口见 [exec-plans README](../README.md)，重启方式见 [superseded/README.md](README.md)。

# Opus 4.7 模型升级

> ⚠️ **Superseded by [refactor-closeout.md](../completed/refactor-closeout.md)** — 不再单独推进，保留作历史参考。模型 ID 切换 / `xhigh` effort / tokenizer 复核 / 字面化回归测试并入 refactor-closeout 的 **Phase 1（模型同步与渠道扩展）**。

> 创建时间：2026-04-16
> 最后更新：2026-04-16（Claude Code 2.1.111 / SDK 0.2.111 发布后复核）
> 来源：https://www.anthropic.com/news/claude-opus-4-7

## 背景

2026-04-16 Anthropic 发布 Claude Opus 4.7，相对 4.6 的关键变化：

- 新模型 ID：**`claude-opus-4-7`**（无日期后缀；价格不变 $5/M 输入 / $25/M 输出）
- 新增 **`xhigh`** effort level（Opus 4.7 独有，其他模型自动回退到 `high`；与 `max` 并列而非别名）
- Tokenizer 更新：相同输入约产生 **1.0–1.35× token**，高 effort 下输出 token 也更多
- 指令遵循更「字面化」，需重新调参 prompt 与 harness
- Vision 提升（长边 2,576px / ~3.75MP）
- 文件系统 memory 的多会话利用更好

**当前工具链状态（2026-04-16/17 复核）：**

| 组件 | 本地版本 | 最新版本 | 4.7 支持 |
|------|----------|----------|----------|
| `@anthropic-ai/claude-agent-sdk` | **0.2.62** | **0.2.111**（2026-04-16 发布） | ❌ 本地 → ✅ 0.2.111 typings 含 `claude-opus-4-7` / `xhigh` |
| `@ai-sdk/anthropic` | **^3.0.47** | **3.0.70**（2026-04-16 发布） | ❌ 本地 → ✅ 3.0.70 支持 `xhigh` 和 `thinking.display` |
| Claude Code CLI | 2.1.111 | 2.1.111 | ✅ 已支持 `claude-opus-4-7[1m]` |

> ⚠️ **双 SDK 都要升**：`@anthropic-ai/claude-agent-sdk` 走 Claude Code SDK 路径，`@ai-sdk/anthropic` 走 native/API 路径，两条路径各自的 4.7 要求不同。
> ⚠️ 本计划仅覆盖 Opus 模型侧；环境确认 Sonnet 仍是 4.6、Haiku 仍是 4.5，若后续同步发布 4.7 另起计划。

## Runtime 双轨说明

CodePilot 调用模型有两条运行时路径，**4.7 迁移要求各不相同**，必须分别处理，不能只动一条：

| 路径 | 入口 | 关键文件 | 4.7 迁移要点 |
|------|------|----------|--------------|
| **Claude Code SDK 路径** | `@anthropic-ai/claude-agent-sdk` subprocess | `src/lib/runtime/sdk-runtime.ts`、`src/lib/claude-client.ts` | 升 SDK 到 0.2.111；保留 CLI 默认 effort/能力发现语义（effort 允许 `undefined` 让 CLI 走 4.7 默认 `xhigh`） |
| **Native / Direct Anthropic 路径** | `@ai-sdk/anthropic` + `claude-code-compat` | `src/lib/runtime/native-runtime.ts`、`src/lib/claude-code-compat/request-builder.ts`、`src/lib/bridge/conversation-engine.ts` | 升 `@ai-sdk/anthropic` 到 3.0.70；按官方 Opus 4.7 migration guide **移除 manual `thinking`、sampling 参数、assistant prefill**；展示 reasoning 时显式设 `thinking.display='summarized'`；核对旧 `effort-2025-11-24` beta header 是否还在发送（effort 已 GA，该 header 应移除） |

**一致性原则：** 两条路径的 UI 体验必须一致（同一 effort 名称、同一模型列表），但底层传参要按各自 SDK 的新签名走。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 双 SDK 升级 + provider 兼容性调研 | 🔄 部分完成 | Anthropic 官方 ID 已确认；Bedrock/Vertex alias 策略需按 runtime 分拆；Foundry 移出范围 |
| Phase 1 | 代码层模型 ID & displayName 切换 | 📋 待开始 | 依赖 Phase 0 的双 SDK 升级 |
| Phase 2 | `xhigh` effort level 接入 + catalog 能力元数据回填 | 📋 待开始 | 需在 `ANTHROPIC_DEFAULT_MODELS` / `DEFAULT_MODELS` 上显式声明 `supportsEffort` / `supportedEffortLevels` |
| Phase 2b | Native 路径 `thinking` / `display` / beta header 清理 | 📋 待开始 | 对应官方 Opus 4.7 migration guide 的 breaking changes |
| Phase 3 | Tokenizer + vision + 压缩链路复核 | 📋 待开始 | 扩大到 context-estimator/compressor/chat route/前端 indicator + vision token 预算 |
| Phase 4 | i18n & 文档同步 | 📋 待开始 | |
| Phase 5 | Prompt 字面化回归测试 | 📋 待开始 | 必须在 release 前 |
| Phase 6 | 发版 & 用户沟通 | 📋 待开始 | 等用户明确指示 |

## 决策日志

- 2026-04-16：建立本计划；不在 Phase 0 之前改动任何代码，避免在未验证的 provider ID 上试错
- 2026-04-16：暂不删除 `claude-opus-4-6` 的引用，先并行保留两个模型，等 Phase 5 回归通过后再决定是否下线 4.6
- 2026-04-16（晚）：SDK 0.2.111 typings 确认 `EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'`。**`xhigh` 与 `max` 是独立级别，不是别名**：
  - `xhigh` 注释为「Deeper than high (Opus 4.7 only; falls back to `'high'` elsewhere)」
  - `max` 注释为「Maximum effort (Opus 4.6/4.7 only)」
  - Phase 2 按 5 级展示（`low/medium/high/xhigh/max`），UI fallback 列表也要同步扩展
- 2026-04-16（晚）：SDK 0.2.111 已通过 `ModelInfo.supportedEffortLevels` 字段声明每个模型支持的 effort 级别，管道（`/api/providers/models` → `MessageInput` → `EffortSelectorDropdown`）已存在，SDK 升级后 `xhigh` 会自动向前端流过，**无需新增过滤逻辑**
- 2026-04-16（晚）：Anthropic first-party API 的模型 ID 确认为 `claude-opus-4-7`（无日期后缀），Phase 0 的该项猜测落地
- 2026-04-17：Codex 复核指出（已核对代码确认成立）：
  - **Foundry 移出本计划范围**：`Protocol` union（`provider-catalog.ts:20-27`）没有 `foundry`，Azure AI Foundry 的验收要求凭空而来。本次只覆盖 Anthropic first-party + Bedrock + Vertex。
  - **Bedrock/Vertex 的 `opus` alias 按官方仍指向 4.6**，4.7 需用 full model name 或 `ANTHROPIC_DEFAULT_OPUS_MODEL` 显式覆盖。`provider-resolver.ts:674` 的 env 表不覆盖 Bedrock/Vertex preset；两者走 `provider-catalog.ts` 的 `ANTHROPIC_DEFAULT_MODELS`。
  - **`@ai-sdk/anthropic` 必须一并升级**（本地 ^3.0.47 → 3.0.70）。native/API 路径按 Opus 4.7 migration guide 还需移除 manual thinking、sampling、prefill，并按需设 `thinking.display='summarized'`；3.0.70 仍会给 effort 加 `effort-2025-11-24` beta header，但 effort 已 GA，需核查并移除该 header。
  - **默认 effort 策略要分 runtime**：官方 Claude Code 在 Opus 4.7 下 CLI 默认 `xhigh`，API 默认 `high`。`claude-client.ts:822` 现在统一 `effort || 'medium'` 会把两种默认都盖掉。应让 Claude Code SDK 路径保留 `undefined` 交给 CLI；Native 路径显式下发 `high` 或按模型默认。
  - **`supportedEffortLevels` 管道有洞**：`/api/providers/models/route.ts:75-79` 的 `DEFAULT_MODELS` 和 `provider-catalog.ts:189` 的 `ANTHROPIC_DEFAULT_MODELS` 都没有 `supportsEffort`/`supportedEffortLevels` 元数据，新装/Bedrock/Vertex preset 首次进入时 `xhigh` 不会出现；SDK 能力发现 (`getCachedModels('env')`) 只在运行过 query 之后才填。Phase 2 要在 catalog 上补元数据或加启动能力预热。
  - **Phase 3 的压缩范围**：实际压缩触发点在 `context-estimator`、`context-compressor`、`src/app/api/chat/route.ts`、前端 context indicator；Vision 部分 Opus 4.7 高分图自动启用、单图 token 约 4784（3× 原上限），需要纳入预算复核，不能排除在外。

## 详细设计

### Phase 0 — 双 SDK 升级 + provider 兼容性调研

**目标：** 升级两条路径的 SDK，确认 `claude-opus-4-7` 在 Anthropic first-party / Bedrock / Vertex 上的真实可用 ID，以及 1M context beta header 是否仍适用。

**已确认（2026-04-16/17 复核）：**
- ✅ Anthropic first-party API ID：`claude-opus-4-7`（SDK 0.2.111 typings `sdk.d.ts:1261` 样例）
- ✅ `xhigh` 在 Claude Code SDK 中定义为独立级别（`sdk.d.ts:443` `EffortLevel`）
- ✅ `@ai-sdk/anthropic@3.0.70` 支持 `xhigh` 和 `thinking.display`（Codex 核实）
- ✅ Claude Code CLI 2.1.111 已支持 `claude-opus-4-7[1m]`
- ✅ `supportedEffortLevels` 字段已在 SDK 中存在（`sdk.d.ts:923`），前后端管道已打通（`/api/providers/models/route.ts:96`、`EffortSelectorDropdown.tsx:30`）—— 但**只覆盖 env provider 且依赖 `getCachedModels` 被填过**，见 Phase 2b
- ✅ `Protocol` union（`provider-catalog.ts:20-27`）含 `anthropic | openai-compatible | openrouter | bedrock | vertex | google | gemini-image`，**没有 foundry**

**剩余任务：**

1. **Claude Code SDK 升级（阻塞 Phase 1）：**
   - `npm install @anthropic-ai/claude-agent-sdk@0.2.111`（当前 0.2.62，落后 49 个版本）
   - 跑完整 `npm run test` + `npm run test:smoke`，确认没有 breaking changes
   - 重点关注 `agentSdkTypes.d.ts`、`sdk.d.ts` 的导出变化（捕获 `claude-client.ts` / `agent-sdk-capabilities.ts` 里用到的旧类型别名）

2. **AI SDK Anthropic 升级（阻塞 Phase 2b）：**
   - `npm install @ai-sdk/anthropic@3.0.70`（当前 ^3.0.47）
   - 跑 `src/__tests__/unit/native-runtime.test.ts`、compat 路径相关测试
   - 核查 3.0.70 是否仍下发 `effort-2025-11-24` beta header（effort 已 GA，应移除）；若 SDK 无法关闭，记录为 tech-debt

3. **Provider ID 实测（范围仅 Anthropic first-party + Bedrock + Vertex）：**
   - Bedrock region-prefixed ID（预期 `us.anthropic.claude-opus-4-7-v1:0`，待实测）；注意 Bedrock 的 `opus` alias 官方仍指向 4.6，4.7 需 full model name 或 `ANTHROPIC_DEFAULT_OPUS_MODEL` 显式覆盖
   - Vertex AI ID（预期 `claude-opus-4-7@...`，待实测）；alias 同上
   - 每个 provider 上 `xhigh` 是否被接受或下沉
   - `context-1m-2025-08-07` beta header 是否仍返回 1M 上下文

4. 输出 `docs/research/opus-4-7-provider-compat.md`，包含每个 provider 的 ID、alias 行为、响应样例、踩坑点

**验收标准：**
- 两个 SDK 升级后 `npm run test` / `test:smoke` 无回归
- Anthropic + Bedrock + Vertex 的可用 ID 有实测证据（Foundry 不在本次范围）
- 1M context 是否继续支持的结论明确
- `effort-2025-11-24` beta header 在 native 路径的去留有定论

**涉及文件（只读，不改动）：**
- `src/lib/provider-resolver.ts:674` — env 映射
- `src/lib/provider-catalog.ts:189` — Anthropic 默认模型（Bedrock/Vertex preset 走这里）
- `docs/handover/provider-architecture.md:82-99` — 现有 provider ID 表

---

### Phase 1 — 模型 ID & displayName 切换

**前置：** Phase 0 完成

**改动文件：**

| 文件 | 当前 | 目标 |
|------|------|------|
| `src/lib/ai-provider.ts:97` | `opus: 'claude-opus-4-6'` | `claude-opus-4-7`（保留 4.6 作 fallback 选项） |
| `src/lib/provider-catalog.ts:191` | displayName `'Opus 4.6'` | `'Opus 4.7'` |
| `src/lib/provider-resolver.ts:674` | `upstreamModelId: 'claude-opus-4-20250514'` | 按 Phase 0 调研结果填入 |
| `src/lib/model-context.ts:6` | `'claude-opus-4-20250514': 200000` | 新增 `'claude-opus-4-7': 200000`（1M beta 仍走 options 分支） |
| `src/hooks/useProviderModels.ts:7` | `{ value: 'opus', label: 'Opus 4.6' }` | `'Opus 4.7'` |
| `src/app/api/providers/models/route.ts:21` | `{ value: 'opus', label: 'Opus 4.6' }` | `'Opus 4.7'` |
| `src/components/settings/PresetConnectDialog.tsx:681` | placeholder `"claude-opus-4-6"` | `"claude-opus-4-7"` |

**设计决策：**
- **保留 4.6 选项还是整体替换？** 倾向「保留」：在 `provider-catalog.ts` 里把 opus 角色的 default 改成 4.7，但在 preset 层面仍允许用户手动输入 `claude-opus-4-6`。避免一夜之间所有用户被强制迁移到新 tokenizer（行为差异可能引起 context 溢出）。
- **upstreamModelId 策略：** `provider-resolver.ts` 里的 Bedrock/Vertex ARN 目前写死 4.6 的 20250514 版本字符串，Phase 0 确认实际值后再统一改。**注意 Bedrock/Vertex 的 `opus` alias 官方仍指向 4.6**，不能简单改 alias 去指 4.7 —— 要么留 alias = 4.6、用 full model name 暴露 4.7；要么通过 `ANTHROPIC_DEFAULT_OPUS_MODEL` env var 在 Claude Code SDK 路径下覆盖。

**验收标准：**
- 新装应用默认模型显示为 "Opus 4.7"
- 现有用户升级后，已选模型保持不变（兼容）
- Anthropic first-party + Bedrock + Vertex 三个 provider 都能走通一次 4.7 聊天（通过 full model name 或 env 覆盖）

---

### Phase 2 — `xhigh` effort level 接入 + catalog 能力元数据回填

**前置已确认：** `xhigh` 与 `max` 是独立 effort 级别（见决策日志），UI 应展示 5 级。

**关键修正（2026-04-17 Codex 核实）：**
> 「SDK 升级后 `xhigh` 自动流过」**只在 SDK 跑过一次 query 后**成立。`/api/providers/models/route.ts:75-79` 的 `DEFAULT_MODELS`、`provider-catalog.ts:189` 的 `ANTHROPIC_DEFAULT_MODELS` 都没有 `supportsEffort` 元数据。新装应用、未运行过查询时、Bedrock/Vertex preset 首次进入，`xhigh` 都不会出现。

**改动文件：**

1. **前端 fallback 扩展：**
   - `src/components/chat/EffortSelectorDropdown.tsx:30`
     ```ts
     const levels = supportedEffortLevels || ['low', 'medium', 'high', 'xhigh', 'max'];
     ```

2. **Catalog 能力元数据回填（关键补漏）：**
   - `src/lib/provider-catalog.ts:189-193` `ANTHROPIC_DEFAULT_MODELS`：为 `opus` 条目加 `capabilities: { supportsEffort: true, supportedEffortLevels: ['low','medium','high','xhigh','max'] }`；`sonnet` / `haiku` 按 SDK 对应能力填
   - `src/app/api/providers/models/route.ts:19-23` `DEFAULT_MODELS`：同步加上 `supportsEffort` / `supportedEffortLevels`
   - `src/types/index.ts:218` 的 `ModelMeta` 类型若缺 `supportsEffort`，需补上
   - 决定：要不要在应用启动时触发一次轻量 `captureCapabilities()` 预热？（memory 提到 `agent-sdk-capabilities.ts` 已用 Map 按 providerId 缓存）

3. **effort 枚举校验链路：**
   - `src/lib/claude-client.ts:822` — 见 Phase 2b（默认 effort 策略）
   - `src/lib/runtime/sdk-runtime.ts`、`src/lib/runtime/native-runtime.ts`
   - `src/app/api/chat/route.ts`（请求体校验 schema，如果有 effort 白名单）
   - `src/components/chat/MessageInput.tsx`、`ChatView.tsx`、`src/app/chat/page.tsx`
   - `src/lib/agent-loop.ts`

4. **i18n：** 新增 `effort.xhigh`（中英，`src/i18n/zh.ts` + `src/i18n/en.ts`）

**破坏性考量：**
- **不需要 DB migration**：现有 `effort: 'max'` 值继续有效（4.6 和 4.7 都保留 `max`）
- 注意 SDK typings 里 `effortLevel?: 'low' | 'medium' | 'high' | 'xhigh'`（`sdk.d.ts:4292`，用于持久化的 agent 配置）**不包含 `'max'`** — 需单独核对 agent 配置持久化路径是否受影响

**验收标准：**
- 全新安装应用（清掉 cache），Opus 4.7 模型卡片的 effort 下拉能看到 `xhigh`
- Bedrock/Vertex preset 选到 Opus 4.7 时（若该 provider 已上线 4.7）也能看到 `xhigh`
- 其他模型（Sonnet/Haiku/Opus 4.6）不出现 `xhigh`

---

### Phase 2b — Native 路径 `thinking` / `display` / beta header 清理

**背景：** 官方 Opus 4.7 migration guide 对 native/API 路径有一批 breaking changes。Claude Code SDK 路径由 CLI 内部处理，不用管；但 `claude-code-compat` / `native-runtime` 路径是我们自己拼的请求，必须改。

**审查范围：**

- `src/app/chat/page.tsx:502-519` — 当前会根据 `thinkingMode` 组 `{ type: thinkingMode }` 并透传到 `/api/chat`
- `src/lib/claude-code-compat/request-builder.ts` — compat 路径的请求构造
- `src/lib/claude-code-compat/claude-code-compat-model.ts`
- `src/lib/runtime/native-runtime.ts`
- `src/lib/bridge/conversation-engine.ts`（IM 桥接）

**动作（按官方迁移清单）：**

1. **移除 manual `thinking` 配置**：Opus 4.7 不再接受 Opus 4.6 那种 `thinking: { type: 'enabled', budget_tokens: N }`。`chat/page.tsx` 的 `thinking` 透传要改为仅在 4.6/Sonnet 时保留，4.7 下删除或转换为 `thinking.display`。
2. **显式 `thinking.display='summarized'`**：当 UI 需要展示 reasoning（thinking block）时，在 4.7 请求里显式设置。
3. **移除 assistant prefill**：如 compat builder 有 prefill 逻辑，对 4.7 关闭。
4. **移除 sampling 参数**：4.7 不接受旧的 sampling 相关字段，request-builder 需按模型过滤。
5. **核查 `effort-2025-11-24` beta header**：若 `@ai-sdk/anthropic@3.0.70` 自动附加，尝试关闭；关不掉则记 tech-debt。
6. **core `model` 字段**：native 路径下，Bedrock/Vertex 的 `opus` alias 指向 4.6，要走 `ANTHROPIC_DEFAULT_OPUS_MODEL` 或 full model name。

**验收标准：**
- Native 路径下用 4.7 发一次带思考的消息，返回 200 且 reasoning 可展示
- Bedrock/Vertex（若已上线 4.7）native 路径下通过 full model name 能调 4.7

---

### Phase 3 — Tokenizer + vision + 压缩链路复核

**背景：** 4.7 相同输入产生 1.0–1.35× token；Opus 4.7 高分图自动启用，单图 token 约 **4784（约为此前 3×）**。若代码里有「按字符估算 token」或「按 token 总数裁剪/压缩」的逻辑，可能提前触发或溢出 200K。

**审查清单（Codex 复核后扩大）：**

1. **Token 估算：**
   - `src/lib/context-pruner.ts` — 是否按固定 char:token 比例？对 4.7 加安全系数
   - `src/lib/context-estimator.ts`（`src/__tests__/unit/context-estimator.test.ts` 入口）— 估算函数本体
   - `src/lib/context-compressor.ts` — 压缩触发阈值
   - `src/lib/message-normalizer.ts` — 如果有按 token 截断消息的逻辑
2. **压缩触发：**
   - `src/app/api/chat/route.ts` — 调用 compressor / pruner 的编排逻辑
   - 前端 context indicator（MessageInput 或 ChatView 附近的剩余 token UI）— 显示值需与实际口径一致
3. **Vision 预算（新增）：**
   - 核查图片上传路径：4.7 高分图自动启用，单图 ~4784 token；历史会话里多图对话的 token 估算要重算
   - 是否要在前端提示用户「4.7 下图片 token 成本 × 3」
   - 压缩路径是否会把图片算漏（例如只按文本长度估）
4. **SDK 能力缓存：** `src/lib/agent-sdk-capabilities.ts` 的 `maxTokens` / context window 字段核对
5. **文档：** `ARCHITECTURE.md`、`docs/handover/decouple-native-runtime.md` 加 tokenizer + vision 差异说明

**长对话测试：** 跑一次 >100K token 的会话（含若干张图），验证 pruning/compression 时机合理。

**验收标准：**
- 长对话不会因 tokenizer 膨胀提前 20% 触发 pruning
- 也不会因低估 token 导致 API 返回 context-length-exceeded
- 多图会话的 token 显示与 API 返回 usage 一致（偏差 <10%）

---

### Phase 4 — i18n & 文档同步

**i18n：**

- `src/i18n/zh.ts:214` 和 `src/i18n/en.ts:218`
  - "Opus 4.6 和 Sonnet 4.6 启用 100 万 token" → 视 Phase 0 结论调整为 4.7（若 Sonnet 4.7 未同步发布则保留 4.6 表述）
- 新增 `effort.xhigh` 的中英文案（Phase 2 依赖）
- 搜索所有 `Opus 4.6` 字面量，逐处评估是否改

**文档：**

| 文件 | 动作 |
|------|------|
| `docs/handover/provider-architecture.md:82-99` | 更新 Anthropic + Bedrock + Vertex 三个 provider 的 modelId 映射 + alias 行为 + 订阅层级描述 |
| `docs/research/provider-registry-comparison.md:173` | 更新样例里的模型 ID |
| `docs/research/issue-analysis-2026-04-02.md:169` | #367 "OAuth 模式 Opus 4.6 消失" 如果仍未修复，标注是否也影响 4.7 |
| `docs/exec-plans/active/open-issues-2026-03-12.md:80` | 更新 1M context 描述 |
| `src/__tests__/test-report.md:113` | 测试报告里的模型 ID |
| `ARCHITECTURE.md` | 一句话说明默认模型已升级到 4.7，tokenizer 差异提示 |

**新增文档：**
- `docs/insights/opus-4-7-upgrade.md` — 产品思考：为什么选在哪个时间点切默认模型，如何给用户沟通 tokenizer 成本影响
- `docs/handover/opus-4-7-upgrade.md` — 技术交接：本次升级涉及的 provider ID 变更、effort 扩展、tokenizer 影响

两份文档互相反链（见 CLAUDE.md 规范）。

---

### Phase 5 — Prompt 字面化回归测试

**背景：** 官方说明 4.7 「更字面地遵循指令」，历史积累的 system prompt 和 agent prompt 里可能有依赖「模型自动推断」的模糊表述，会在 4.7 上产生行为回退。

**审查范围：**

- `src/lib/claude-client.ts` 的 system prompt 组装
- `src/lib/agent-loop.ts` 的 loop prompt
- `src/lib/bridge/conversation-engine.ts`
- `src/lib/skill-parser.ts`（skill 描述 → 模型理解）
- 所有 built-in tools 的描述（`src/lib/builtin-tools/*`）

**测试方式：**

1. 挑 10 个代表性会话（新建、带工具调用、长对话、文件编辑、skill 触发），分别用 4.6 和 4.7 跑一遍，对比：
   - 工具调用选择是否一致
   - 回答结构/长度是否回退
   - 是否多出无谓的澄清提问
2. 发现 behavior regression → 修订对应 prompt，改为更显式的措辞

**验收标准：**
- 10 个代表性会话在 4.7 上行为与 4.6 相当或更好
- 无显著的「工具调用遗漏」或「过度澄清」回退

---

### Phase 6 — 发版 & 用户沟通

**前置：** Phase 1-5 全部完成

**动作：**

1. 更新 `RELEASE_NOTES.md`（遵循 CLAUDE.md 的 Release Notes 格式）
2. package.json version bump
3. `npm install` 同步 lock
4. 提交并**等用户明确指示**后再 `git push` + `git tag`
5. 在 insight 文档里写清楚：
   - 用户视角变化（默认模型变了、新增 xhigh effort）
   - 成本提示（tokenizer 膨胀 1.0-1.35×，token 账单可能小幅上涨）
   - 如何回退到 4.6（preset 手填）

**不做：**
- 不强制把所有老会话的模型从 4.6 改到 4.7
- 不自动发版（CLAUDE.md 铁律）

## 依赖与风险

| 风险 | 缓解 |
|------|------|
| SDK 0.2.62 → 0.2.111 跨 49 个版本，可能有 breaking changes | Phase 0 升级后跑完 `test` + `test:smoke`；必要时逐个 minor 升级对 diff 定位回归 |
| Phase 0 发现某个 provider 尚未上线 4.7 | 在 provider-catalog 里按 provider 区别暴露模型；Bedrock/Vertex 上架通常滞后官方数天 |
| Tokenizer 膨胀导致老用户账单异常 | Phase 4 insight 文档明确提示；Phase 3 完善 pruning 提醒 |
| `xhigh` 在 1M context + 工具调用下首字延迟显著增加 | **默认 effort 按 runtime 分策略**：Claude Code SDK 路径不下发显式 effort，让 CLI 走 4.7 默认（`xhigh`）；Native 路径显式 `high`；`xhigh` 由用户在 UI 主动选 |
| 指令字面化导致现有 prompt 回退 | Phase 5 必须卡在 release 前，发现回归立即修 prompt 而非回滚模型 |
| SDK 持久化类型 `effortLevel` 不含 `max`（`sdk.d.ts:4292`）与我们现有 DB 里的 `max` 冲突 | Phase 2 单独核对 agent 配置持久化路径，必要时拆 `persistedEffort` 与运行时 `effort` 两层类型 |
| `@ai-sdk/anthropic@3.0.70` 自动附加 `effort-2025-11-24` beta header，与 effort GA 后「移除旧 beta header」清单冲突 | Phase 0 task 2 核查能否关；关不掉记 tech-debt 到 `docs/exec-plans/tech-debt-tracker.md`，阻塞合格但不阻塞发版 |
| Native 路径仍发送 Opus 4.6 风格的 manual `thinking` 配置导致 4.7 返回 400 或 reasoning 空白 | Phase 2b 专项清理 `chat/page.tsx:519`、`claude-code-compat/request-builder.ts`、`native-runtime.ts` |
| Bedrock/Vertex 的 `opus` alias 仍指向 4.6，只升级 alias 不会切 4.7 | Phase 1 改为用 full model name 或 `ANTHROPIC_DEFAULT_OPUS_MODEL` 显式覆盖；按 provider 单独开关 4.7 可见性 |
| `DEFAULT_MODELS` / `ANTHROPIC_DEFAULT_MODELS` 缺 `supportsEffort` 元数据，新装或冷启动看不到 `xhigh` | Phase 2 第 2 点回填 catalog 元数据，必要时加启动预热 `captureCapabilities('env')` |

## 不在范围内

- Sonnet 4.7 / Haiku 4.7 的同步升级（若官方发布，另起计划）
- 重写 agent-loop 的效率优化（已在 `docs/exec-plans/active/decouple-claude-code.md` 覆盖）
- **Azure AI Foundry 的 4.7 适配**（`Protocol` union 无此协议，属于未落地协议，另起实现计划）
- ~~Vision 长边提升到 2576px 对应的前端上传限制调整~~ — **已移入 Phase 3**：image token ~4784 是实际压缩/预算影响，不能排除
