# Refactor Phase 1 — 模型同步与渠道扩展（已完成归档）

> 历史归档。本文件由 [active/refactor-closeout.md](refactor-closeout.md) 在 2026-05-09 拆出，对应 Phase 0（计划收敛）+ Phase 1（模型同步与渠道扩展）的全部计划文本与决策日志。
> 完成时间：2026-05-06（Phase 0 ✅ + Phase 1 主路径 ✅；catalog 主动核准纳入 tech-debt #16 长期跟进）
> 当前总控板：[active/refactor-closeout.md](refactor-closeout.md)

## Phase 1 用户结果（最终交付）

- 添加套餐型服务商（火山 / 百炼 / GLM / MiniMax / Kimi / 小米 MiMo / DeepSeek 等）后不再被上百个非套餐模型污染列表。
- OpenRouter 改为搜索添加路径，本地列表只保留已添加模型；不再全量物化 300+ 模型。
- 默认模型契约一致：Auto / Pinned 状态在 Models 页 / Chat 新会话 / Run 面板共用同一 resolver；刷新或切 Runtime 不再悄悄换默认。
- 旧 SKU / 非当前推荐目录的行有"已不在当前推荐目录"轻徽章，但用户手动数据从不静默删除。
- 自定义模型入口按 provider 类型分两套文案：套餐型 → "为 X 补充 SKU"，非套餐型 → "为 X 手动添加模型"。

## 计划文本

## Phase 0：计划收敛

### 用户会看到什么

用户不会直接看到 UI 变化，但会看到后续交付变得更可预期：每次只推进一条主线，每条主线都能说明产品结果，而不是不断出现新的设置页、按钮和半成品入口。

### 要做什么

- 把旧 active 计划分成三类：
  - **已完成**：移到 `completed/`。
  - **被本计划接管**：保留原文件作为参考，但顶部标注 `Superseded by refactor-closeout.md`。
  - **暂缓**：保留但从 README 的优先 Active 表中降级。
- 后续 ClaudeCode / Codex 只从本计划领取任务，不再从旧 active 计划里自行开支线。
- 每个新任务都必须补“用户视角结果”和“验收路径”。

### 验收

- `docs/exec-plans/README.md` 里能一眼看到本计划是当前重构总控。
- 旧计划不会再制造互相冲突的优先级。

## Phase 1：模型同步与渠道扩展

### 用户会看到什么

- 添加一个套餐型服务商（火山、百炼、GLM、MiniMax、Kimi 等）后，不会突然出现上百个并不属于套餐的模型。
- OpenRouter 这类大目录渠道不会把 300+ 模型塞进本地列表；用户通过搜索添加自己要用的模型。
- 默认模型有明确模式：Auto 或固定。刷新页面、刷新模型、切 Runtime 后，不会悄悄换成另一个模型。
- 用户可以手动添加自定义模型，并能看出它是“手动添加”的，不会被自动刷新覆盖。

### 工程要做什么

- 完成 OpenRouter search-and-add 的真实 smoke，保留回归测试。
- 对所有套餐型 preset 做官方白名单复核，过期模型打“已不在当前推荐目录”提示，不静默删除。
- 补齐授权登录渠道的产品路径：哪些支持 OAuth，哪些只能填 Key，哪些需要套餐白名单。
- 梳理 `Provider`、`Models`、`Runtime` 三者的数据契约，默认模型只由一套 resolver 解释。

### 不做什么

- 不做全渠道余额 / 用量 API。
- 不做自动定时同步所有模型。
- 不为了“看起来完整”展示不可用模型。

### 验收路径

- Settings → Providers：新增服务商后 toast 和模型来源清楚。
- Settings → Models：套餐服务商刷新按钮不会报失败；OpenRouter 搜索添加 / validate / cleanup 可用。
- Chat 新会话：默认模型和 Settings 里的解释一致。

### Phase 1 细化方案（执行中，主路径已收口）

> 体验前置门槛：继续做 Step 3 之前，先按 [Models / Providers 体验收敛](../../insights/models-provider-experience.md) 审核当前页面。Phase 1 不能继续在 Models 页堆 badge / 按钮 / 兼容说明；必须先把主路径压回“默认模型 / 可用模型 / 添加模型”三段式。折叠“刷新全部 / 按推荐整理”不算完成，必须同时砍掉行级来源标签、让 Auto 显示实际解析模型、把迁移清理工具移出主路径。

> 验证分工：ClaudeCode 只执行代码改动与单元测试；所有页面样式、交互走查、截图、console 检查由 Codex 负责。UI 改动交付后，未经过 Codex 使用 Browser Use / 浏览器实际验证，不标记为完成。若浏览器调试实例被占用，由 Codex 处理占用并重新打开验证环境。

#### 1. 用户结果

本阶段做完后，用户应该能明显感受到：

- **添加服务商更可信**：新增火山、百炼、GLM、MiniMax、Kimi、DeepSeek、OpenRouter 等渠道后，页面不会把“看起来很多但实际不可用”的模型塞给用户。
- **模型列表更少但更准**：套餐型服务商只显示官方套餐支持 / 我们已确认的白名单模型；过期或不在当前推荐目录的旧模型会保留，但会有提示。
- **OpenRouter 从“全量目录”变成“搜索添加”**：用户想用某个 OpenRouter 模型时，搜索、查看价格 / 上下文、点添加；本地列表只保留已添加模型和必要别名。
- **默认模型稳定**：用户选 Auto 就是自动，选固定就是固定；刷新页面、刷新模型、切 Runtime 不会悄悄把默认模型换掉。
- **自定义模型路径清楚**：如果服务商官方套餐之外还有用户自己的 SKU，用户能通过“添加模型”补充，并看出这是手动添加，刷新不会覆盖。

#### 2. 当前问题清单

| 优先级 | 问题 | 用户看到的坏结果 | 处理方向 |
|--------|------|------------------|----------|
| P0 | 默认模型契约仍是最容易伤信任的点 | 用户刚设好默认，刷新或切换后又变成 Auto / 其它模型 | 统一 resolver 契约；Auto / Pinned 状态和 Chat 初始化共用同一解释 |
| P0 | 套餐型服务商和大目录服务商模型来源不同 | 火山这类服务商会被误认为支持大目录里的所有模型 | 套餐型走 catalog whitelist / custom add；大目录走 search-and-add |
| P1 | Catalog 漂移后旧模型仍显示但缺少解释 | 例如旧 DeepSeek SKU 仍在列表里，用户不知道还能不能用 | 加“已不在当前推荐目录”轻提示，不静默删除手动行 |
| P1 | OpenRouter search-and-add 还需要最终产品化验收 | 功能已通，但要确认添加、validate、cleanup、Refresh All 文案稳定 | Browser smoke + 回归测试作为完成条件 |
| P1 | 授权登录 / API Key / 套餐白名单入口分散 | 用户不知道某渠道该登录、填 Key，还是填套餐模型名 | Provider preset 卡片和表单文案统一说明接入方式 |
| P2 | Refresh All summary 仍有 copy polish | “启用 0 / 隐藏 0”读起来像 bug | 最小文案优化，不改变数据逻辑 |
| P2 | 自定义模型入口对不同 provider 语义不完全一致 | 有的服务商是补 SKU，有的是新增任意远程模型 | Add Model dialog 按 provider 类型显示对应说明 |

#### 3. 本阶段具体做什么

##### 1.1 默认模型契约收口

- 明确 `global_default_mode = auto | pinned` 是唯一用户语义。
- Chat 新会话、Settings → Runtime 解释块、Settings → Models 默认卡片必须共用同一个解析函数。
- Pinned invalid 时，用户看到的是“固定模型当前不可用”，而不是系统静默 fallback。
- Auto 模式允许 fallback，但 UI 要说明当前解析到哪个 provider/model。

**验收**：

- Settings → Models 固定一个模型，刷新页面后仍固定。
- 切 Runtime 后，如果固定模型不兼容，页面显示 invalid，而不是悄悄换。
- 改回 Auto 后，ProviderManager / Models / Chat 都不残留旧 pinned 值。

##### 1.2 套餐型服务商白名单复核

> 状态：✅ UI / 契约已完成；catalog 来源主动核准待补。Step 1 已把默认模型契约锁住；Step 2 只处理“套餐型 / 白名单型服务商的模型来源可信度”，不碰 OpenRouter 搜索添加的深水区，不扩 Runtime。

###### 用户结果

用户做完以下操作时，应该感受到的是“列表可信、解释清楚”，而不是“模型很多但不知道哪个能用”：

- 新增火山、百炼、GLM、MiniMax、Kimi、DeepSeek、小米 MiMo 这类套餐型 / 白名单型渠道后，Models 页只展示我们确认属于当前套餐或官方推荐路径的模型。
- 如果用户以前已经被旧版本同步进了大量目录模型，它们不会被静默删除；但不在当前白名单 / 推荐目录里的行会有轻提示，告诉用户“这是旧导入或手动项，不保证属于当前套餐”。
- “刷新模型 / 刷新全部”不会把这类服务商当成失败项，也不会让用户误以为能从 `/v1/models` 自动同步完整目录。
- “添加模型”成为正常补充路径：用户有自己控制台里可用的模型名 / SKU 时，可以手动加，且刷新不会覆盖它。

###### 本轮处理范围

| 服务商类别 | 覆盖对象 | 用户侧处理 |
|------------|----------|------------|
| 套餐型 Coding / Token Plan | 火山、百炼、GLM、MiniMax、Kimi、小米 MiMo 等 `sdkProxyOnly + billingModel` preset | 用官方套餐白名单 / 推荐列表做 catalog；禁用自动 discovery；提供“添加模型”补 SKU |
| 固定推荐阵容 | DeepSeek 等官方推荐固定模型映射的渠道 | 更新 catalog 到当前官方推荐；旧 SKU 保留并提示 |
| 大目录聚合 | OpenRouter | 本 Step 只确认不被套餐逻辑误伤；搜索添加细节留 Step 3 |
| 普通 OpenAI-compatible / 本地服务 | Ollama、自定义 OpenAI-compatible、pay-as-you-go 第三方 | 不套用套餐白名单规则，保持原发现 / 手动添加逻辑 |

###### 数据来源要求

ClaudeCode 必须在交付说明里列出每个 provider 的事实来源，不允许只引用旧研究文档：

- 先读本地“服务商 API 文档”中的链接和历史记录。
- 再打开对应官方网页 / 官方文档 / 官方社区公告，确认截至本轮实现时的模型白名单或推荐模型。
- 对 JS 渲染导致无法稳定抓取的页面，要说明使用了哪个可访问来源作为旁证。
- 每个 provider 在计划或研究文档里沉淀一行：`provider / 来源 URL / 最后核对日期 / catalog 决策 / 是否允许 custom add`。

###### 工程拆分

1. **Catalog 复核与标注**
   - 复核 `src/lib/provider-catalog.ts` 中套餐型 provider 的 `defaultModels` / `roleModels` / `meta.billingModel`。
   - 对当前官方白名单中明确存在的模型，更新 catalog。
   - 对已不在当前官方推荐目录但用户可能还在用的模型，不删除用户数据；只调整推荐状态或显示提示。
   - GLM 默认升级到高阶模型的产品决策保持不变；本轮只避免“把非套餐大目录模型当成默认可用”。

2. **旧 SKU / 非当前白名单提示**
   - 在 Models 行级增加轻提示状态：`catalog-current` / `manual` / `legacy-or-not-recommended`。
   - 文案避免吓人，不写“错误 / 不可用”；建议语义是“未在当前推荐目录中，保留以兼容已有配置”。
   - 手动添加、用户编辑过、用户隐藏过的行不被自动改动。

3. **刷新与新增路径**
   - 套餐型 provider 的单卡刷新按钮继续解释为“模型由套餐白名单定义”，不触发 discovery。
   - Refresh All 跳过套餐型 provider，summary 里可以显示“跳过 N 个套餐型服务商”，但不能计入失败。
   - Add Service 成功 toast 说明“模型来自套餐白名单；如需补充控制台里的模型名，请到 Models → 添加模型”。
   - Add Model dialog 根据 provider 类型显示不同说明：套餐型是“补充 SKU / 模型名”，普通 provider 是“添加自定义模型”。

4. **文档和防回归**
   - 更新 `docs/research/provider-model-discovery.md`：明确“probe 成功 ≠ 可自动物化”，并记录本轮每个 provider 的来源。
   - 更新 tech-debt：如果某个 provider 无法确定当前白名单，记录为待核准，不用猜。
   - 单测锁住：
     - 套餐型 record 形态（`provider_type='anthropic' + base_url`）也必须被识别为 catalog-only。
     - 套餐型 provider 不进入 discovery / apply / Refresh All failure path。
     - legacy / manual / user_edited 行不会被自动删除或覆盖。

###### 验收路径

- **Settings → Providers**：新增一个套餐型 provider，成功 toast 不出现“无法发现模型”类 warning，而是解释模型来自白名单。
- **Settings → Models**：
  - 套餐型 provider 的模型列表数量合理，不出现 100+ 上游目录模型。
  - 单卡刷新按钮 disabled 或变成解释型状态，hover / tooltip 能看懂原因。
  - “添加模型”能打开手动补充入口，说明文字与套餐型服务商匹配。
  - 旧 SKU / 非当前推荐目录行显示轻提示，但没有被静默删掉。
- **Refresh All**：套餐型 provider 不进入失败 summary；若有跳过提示，文案说“套餐白名单”而不是“失败”。
- **Chat 新会话**：默认模型仍遵守 Step 1 的 Auto / Pinned 契约；本 Step 不引入新的 silent fallback。

###### 明确不做

- 不做 OpenRouter 的批量导入 / 分类浏览 / 价格排序；OpenRouter 只在 Step 3 做最终 smoke 和尾巴。
- 不做全渠道余额、用量、套餐剩余额度检测。
- 不做自动从 provider 官网定时抓模型。
- 不删除用户手动添加、用户编辑、用户隐藏过的模型行。
- 不改 Runtime session-level 行为。

###### 给 ClaudeCode 的执行口径

> 进入 refactor-closeout Phase 1 Step 2：套餐型服务商白名单与旧 SKU 提示。只做模型来源可信度收口，不碰 Runtime、多 Agent、视觉系统，也不要扩 OpenRouter 功能。交付必须先写“用户结果”，再列改动；每个套餐型 provider 都要给出官方来源 / 最后核对日期 / catalog 决策。验收重点是 Settings → Providers / Models：新增套餐型服务商不再提示 discovery 失败，Models 列表不出现大目录污染，旧 SKU 只轻提示不静默删除，Refresh All 不把套餐型 provider 计入失败。完成后先汇报，不要继续 Step 3。

##### 1.3 OpenRouter 搜索添加收口

> 状态：✅ 基础实现已落地，失败时退回手动添加也已接通；仍需后续用真实 API key 做一次添加成功路径 smoke。

- 保持当前方向：不再全量物化 300+ 模型。
- `添加模型` 打开搜索弹窗；搜索结果展示模型名、ID、上下文长度、价格。
- 添加后写入手动行，标记为手动添加 / 手动启用。
- Validate 刷新只检查手动 / 非 catalog 行是否仍在上游，不验证本地 alias。
- Cleanup 只作为 opt-in 整理，不自动隐藏旧行。

**验收**：

- 搜索 `gpt-5.5` 能过滤 OpenRouter 候选并添加。
- 单独刷新 OpenRouter 后，上次同步更新，手动模型不误报缺失。
- Refresh All toast 中 OpenRouter 只显示“已校验 / 仍在上游 / 不再可用”，不显示“启用 N”。
- Cleanup preview 不会处理 manual_enabled / user_edited 行。

##### 1.4 授权登录与自定义模型入口

- 梳理 provider preset 的“接入方式”：
  - OAuth 登录。
  - API Key。
  - 套餐型模型名。
  - OpenRouter 搜索添加。
  - 本地 / 无 Key 服务商。
- Provider 卡片、ProviderForm、Models “添加模型”弹窗要用同一套用户语言解释。
- 自定义模型入口不是高级隐藏功能，而是套餐型和大目录型 provider 的正常补充路径。

**验收**：

- Settings → Providers 添加服务商时，用户能知道下一步该填 Key、登录，还是补模型名。
- Settings → Models 添加模型时，OpenRouter 走搜索，其它 provider 走手动模型表单。
- 添加成功后的模型行能看出来源。

##### 1.5 回归测试与 Browser smoke

> 状态：✅ Codex 已跑一轮非破坏性 Browser smoke。主路径通过；“添加模型”弹窗的实际打开 / 添加成功路径仍需用户明确允许后再做，因为浏览器自动化点击 Add Model 被判定为可能修改设置。

- 单元测试覆盖：
  - 默认模型 Auto / Pinned / invalid。
  - 套餐型 provider 不走 discovery。
  - OpenRouter search / validate / cleanup。
  - 手动启用 / 隐藏不会被刷新覆盖。
- Browser smoke 覆盖：
  - Settings → Providers：服务商分组、OpenRouter / Xiaomi MiMo / Bailian 图标、OpenRouter Claude Code 兼容文案。
  - Settings → Models：刷新 / 排序 / 批量整理入口已移出主路径；每个 provider section 只剩“角色映射 / 添加模型”；OpenRouter 不再显示“当前执行引擎不可用”。
  - Settings → Models 搜索框：`id/name=models-search` 已补齐，Chrome issue 清零；过滤输入无 console error。
  - Chat 新会话：默认模型按钮显示 `glm-5-turbo · 默认`；Run 面板显示 Claude Code / GLM (CN) · `glm-5-turbo` / 已固定 / 默认权限；无裸 i18n key。
  - 测试基线：`npm run test -- --runInBand` 最终通过 1525/1525。第一次全量跑遇到一次 transient `SQLITE_BUSY`，单文件复跑和全量复跑均通过。
  - 边界：真实点击“添加模型”弹窗、真实添加候选模型仍未跑。Add Model click 被浏览器自动化风控判定为可能修改设置，本轮没有绕过。

#### 4. 本阶段不做什么

- 不做全渠道余额、额度、账单、用量 API。
- 不做模型自动定时刷新。
- 不做复杂价格排序 / 分类浏览 / 批量导入 OpenRouter。
- 不做 Runtime session-level 切换；这留给 Phase 2。
- 不做多 Agent adapter。
- 不做视觉系统 / HugeIcons 迁移。

#### 5. 交付顺序

| Step | 内容 | 用户收益 | 是否可独立验收 |
|------|------|----------|----------------|
| 1 | 默认模型契约复核 + 缺口修复 | 默认不乱跳 | 是 |
| 2 | 套餐型服务商白名单与旧 SKU 提示 | 模型列表更可信 | 是 |
| 3 | OpenRouter search-and-add 最终验收与小尾巴 | 大目录不再压垮列表 | 是 |
| 4 | 授权登录 / 自定义模型入口文案统一 | 添加渠道不迷路 | 是 |
| 5 | Tests + Browser smoke + 文档更新 | 后续不回归 | 是 |

#### 6. 批准后给 ClaudeCode 的执行口径

如果本方案通过，给 ClaudeCode 的第一句话应该是：

> 进入 refactor-closeout Phase 1。只做“模型同步与渠道扩展”，不要碰 Runtime session 切换、多 Agent、视觉系统。先按 Phase 1 细化方案做 Step 1：默认模型契约复核。交付必须包含用户结果、改动、验证和防回归。

## 决策日志

按时间倒序，最新在前。

- 2026-05-06：新增本收口计划。原因：原 active 计划过多且多从工程模块出发，用户难以审批；后续重构只按本计划 6 条主线推进。
- 2026-05-06：**Phase 0 完成**。Active 计划由 17 份压到 2 份（本计划 + `issue-tracker.md`）：10 份移入 `completed/`（已交付的工作）、7 份加 `Superseded by refactor-closeout.md` 标注（被本计划接管）、7 份加 ⏸ 暂缓标注（与"暂缓清单"对齐）。`docs/exec-plans/README.md` 索引按"Active / 被接管 / 暂缓 / Completed" 四段重写。后续 ClaudeCode / Codex 只从本计划领取任务。
- 2026-05-06：**Phase 1 Step 1（默认模型契约复核）完成**。审计结论：Phase 2C 契约在所有 5 个写入/读取面（`resolveNewChatDefault` resolver / Models 页 pin button / `setProviderOptions('__global__')` writer / chat 新会话页 / `MessageInput.handleSubmit` blocking gate）一致，无静默替换路径。grep 全仓 `setSetting.*global_default_*` / `setSetting.*default_provider_id` 仅命中 `db.ts`，无散落写入点；resolver 单元测试已覆盖 Auto / Pinned / invalid-default 三种状态 + 4 类 reason（pin-incomplete / provider-missing / model-missing / no-compatible）。**两个缺口已修复**：(a) `setProviderOptions('__global__', { default_mode: 'auto' })` 的 merge-then-write 防御没有直接测试 → 新增 `src/__tests__/unit/default-mode-atomic-write.test.ts`（4 个 case）锁定 DB 层原子清空 + 原子三件套写入；(b) **Codex review 抓到的 API 响应漂移**：`/api/providers/options` PUT 在 Pinned → Auto 时返回的是写入前 merged 出来的 blob，仍然带着旧 pinned 值，写入是对的、响应是旧的 → 改 `src/app/api/providers/options/route.ts` 在 `setProviderOptions` 后重新 `getProviderOptions(providerId)` 再返回，新增 `src/__tests__/unit/providers-options-route.test.ts`（3 个 case）锁定 PUT 响应永远反映 post-write DB 状态，不留 stale leak。`npm run test` 1449 passed（前为 1442，+7 新增 case）。CDP 浏览器烟雾测试与 Step 5 的整体回归一并跑，避免重复启停 dev server。
- 2026-05-06：**Phase 1 Step 2（套餐型服务商白名单与旧 SKU 提示）部分完成**。UI 工作落地，catalog 来源主动核准待补（tech-debt #16 已开）。
  - **完成的部分**：
    1. 新增 `isModelInCurrentCatalog(record, modelId)` 纯函数 helper + `shouldShowLegacyCatalogBadge(record, modelId)` 边界 helper（`provider-catalog.ts`）。徽章 gate 修订后只对**真正权威 catalog** 的 provider 生效——套餐型（`isCatalogOnlyPlanProviderRecord`）+ `meta.fixedCatalog: true` opt-in（目前只 DeepSeek）。Kimi / Moonshot / Xiaomi MiMo PAYG / anthropic-thirdparty 自定义网关 / OpenRouter 都不触发，避免把启动型 catalog 的用户手动加 SKU 误标为 drift。
    2. Models 页行级"已不在当前推荐目录"徽章 + 中性 tooltip — 关闭 tech-debt #14 (a)。
    3. Refresh All summary 末尾新增"已跳过 N 个套餐型服务商"行（`models.refreshAll.summarySkippedPlan`）。
    4. Add Model dialog 按 provider 类型分两套文案：套餐型 → "为 X 补充 SKU" + 套餐说明描述；非套餐型保持"为 X 手动添加模型"。`addDialog` state 加 `kind: 'plan' | 'manual'`，由 `isCatalogOnlyPlanProviderRecord(record)` 决定。
    5. `src/__tests__/unit/legacy-catalog-hint.test.ts` — 21 个 case：原 10 个（in-catalog / not-in-catalog / no-catalog 三类语义 + 6 个 dialog kind gate）+ 11 个新增 `shouldShowLegacyCatalogBadge` gate case（DeepSeek fixedCatalog opt-in + Volcengine 套餐型 + 4 个启动型 catalog 不触发 + OpenRouter / unknown 短路）。
    6. `docs/research/provider-model-discovery.md` 11-row 来源指针表 — **明确不再标"已核准"**，只列当前代码内置 `defaultModels` + preset.meta 中可访问的官方入口指针 + UI 徽章范围。
  - **未完成（待补）**：
    - **catalog 阵容的主动核准本身**。本轮没有逐 provider fetch 官方页面验证白名单变化（国内套餐型多为 JS 渲染中文页，无法稳定抓取）；catalog 阵容沿用 Round 215 状态。tech-debt #16 跟踪此事，触发条件：用户反馈某 SKU 不见了 / 不准了、或公告新模型超 30 天未跟进、或 release 前 catalog 收尾。
  - **修订 P2 review 抓到的两个问题**：(a) "本轮未复访却标 2026-05-06 已核准"会把沿用资料伪装成事实核准 — 修订为 honest 来源指针表 + 明确"待补"事项 + tech-debt #16；(b) 徽章 gate 过宽（任何非 OpenRouter row 不在 catalog 都打徽章，会误伤普通自定义网关 + 按量付费 PAYG 用户手动加的真实 SKU）— 修订为 `shouldShowLegacyCatalogBadge` 显式权威 catalog gate。
  - `npm run test` 1470 passed（修订前 1459，+11 新增 case）。**未做**（与 Step 2 plan 一致）：OpenRouter 任何细节、自动定时刷新、Runtime session-level 行为。CDP 浏览器烟雾测试留 Step 5。
- 2026-05-06：**Phase 1 Step 3 / Step 5 状态复核**。代码层面已确认 OpenRouter / 可搜索 provider 的 search-and-add 基础路径在位：`OpenRouterSearchDialog` 改为通用搜索添加弹窗，`POST /api/providers/[id]/search-models` 不带 `q`、前端内存过滤；添加候选走 `POST /api/providers/[id]/models`；上游拉取失败时通过 `onManualFallback` 回到同一个手动添加弹窗。Codex 用浏览器跑了一轮非破坏性 smoke：Providers 页 OpenRouter 显示为“OpenRouter · Claude Code 兼容”、Xiaomi MiMo / Bailian 图标正确；Models 页刷新 / 排序 / 批量整理入口已从主路径移除，section 右侧只剩“角色映射 / 添加模型”，OpenRouter 行不再重复“当前执行引擎不可用”；搜索框 `id/name=models-search` 生效且 console 无 error / warning；Chat 新会话默认按钮显示 `glm-5-turbo · 默认`，Run 面板显示 Claude Code / GLM (CN) · `glm-5-turbo` / 已固定 / 默认权限，且没有裸 i18n key。`npm run test -- --runInBand` 最终 1525/1525 通过（期间一次 transient `SQLITE_BUSY`，单文件复跑和全量复跑均通过）。**边界**：Add Model 按钮点击被自动化工具判定为可能修改设置，本轮没有绕过，因此真实弹窗打开与候选添加成功路径仍需后续在用户允许下单独 smoke。
