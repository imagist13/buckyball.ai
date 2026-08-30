# OpenRouter 搜索并添加 — 取消全量目录物化

> 创建时间：2026-05-06
> 最后更新：2026-05-06
> 关闭：tech-debt #13（详见 `tech-debt-tracker.md`），更新 `docs/research/provider-model-discovery.md`「类别 A 中的特例：OpenRouter」小节。

## 现状

OpenRouter 走类别 A（probe = `api`），`/api/providers/[id]/discover-models` 调用 `/v1/models` 拿到 300+ 个上游模型，前端把这堆全部 INSERT 进 `provider_models`。具体后果：

- 用户首次点 Add Service 连接 OpenRouter，`runAutoDiscoverForProvider` 立刻把 300+ 行写库；Models 页该 provider section 直接被淹没。
- "刷新模型" / "刷新全部" 也跑同一条路径 — 用户每次刷新一次目录，本地清单里又会冒出新增的 100+ 行（OpenRouter 上游本身在持续扩）。
- Models 页的过滤、搜索、启用/隐藏切换默认都按"全量"工作，体验是用户在做反向裁剪："300 个里挑 5 个我用的"，而不是正向选择："我要加 X 模型"。

OpenRouter 的官方定位是"按需聚合 300+ 模型"。它的问题不是"非合法 SKU"（这是套餐型的问题，已有专门 gate），而是**数量级**：每个模型理论可用，但用户从来不会真用 300 个。正确的 UX 是"搜索并添加几个"，而不是"全量物化、用户反向裁剪"。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 设计冻结 + 决策日志（本文档） | ✅ 已完成 | 经两轮 review 修正后开工 |
| Phase 1 | 后端：新增 `/search-models` 与 `/validate-models` 两条独立路由 + `isOpenRouterProviderRecord` record-aware helper + OpenRouter `/v1/models` 服务端 5 分钟缓存 + `/discover-models` 对 OpenRouter 返回 `unsupported` + Add Service 路径绕开 auto-discover | ✅ 已完成 | 不改 schema；不复用现有路由的响应 shape |
| Phase 2 | UI：OpenRouter 专用「搜索并添加」dialog（替代 OpenRouter 的"添加模型"按钮目标）；刷新按钮改 validate-only 语义；missing-upstream 行加 component-state 徽章 | ✅ 已完成 | 复用通用「添加模型」按钮，按 protocol 切换 dialog |
| Phase 3 | 历史数据收口：OpenRouter section header 增加「整理早期导入的目录」入口；preview/commit 两段，仅命中 `enable_source='recommended' AND user_edited=0` 的行 | ✅ 已完成 | manual_* 行被 WHERE 子句直接排除 |
| Phase 4 | 回归测试 + 文档：9 类单测、`docs/research/provider-model-discovery.md` 状态切换、tech-debt #13 转 已解决 | ✅ 已完成 | 1438 / 1438 通过 |

## 决策日志

- **2026-05-06** — 不复用 `/discover-models`，新建 `/api/providers/[id]/search-models`。
  - 复用方案需要在 discover-models 输出里塞 `candidates` discriminated union 或用 `?q=` 切换响应形状，路由复杂度爆炸；apply 逻辑也得分裂（discover-models 的 apply 走 diff，search 走单条 add）。
  - 分开两条路径让 contract 清晰：discover-models = "上游有什么 + 与本地的 diff"；search-models = "按词匹配候选、不写库、用户挑选后逐条 add"。回归测试也能各管一段。
  - 备选方案（rejected）：在 discover-models 上加 `mode: 'search' | 'diff'` 参数。响应 shape 不一致，调用点要分支判断，长期维护成本更高。

- **2026-05-06** — search 端点不接受 `q` 参数；服务端只返回 cached candidates（5 分钟 TTL），过滤完全在客户端做。
  - OpenRouter `/v1/models` 不接 `?q=`，所谓"远程搜索"本来就是先取全量再筛。客户端过滤即时反馈，省一次 round-trip。
  - 全量 payload ~150–300 KB / ~300 行短字符串，对 Electron 渲染进程没问题。
  - 服务端 5 分钟 cache 避免多用户 / 多次开 dialog 时反复打 OpenRouter。
  - 这条决策与 API 设计一致：`/search-models` 请求体为空，响应固定为完整 candidates 数组。dialog 内的 `<input>` 直接对内存数组做 substring 匹配。这意味着回归测试不需要为不同 `q` 值跑多 case；一次拿全量就够。

- **2026-05-06** — 不放进类别 D（Coding/Token Plan）gate，单独建 OpenRouter 判定。
  - 套餐型 gate 的语义是"白名单 ≠ 上游目录"；OpenRouter 的语义是"全量目录数量级失控"，不是同一种问题。
  - 共用同一开关以后改 gate 条件容易把两边都搞坏。

- **2026-05-06（review 后修正）** — 新增 `isOpenRouterProviderRecord(record)` record-aware helper，**不**直接用 `provider.protocol === 'openrouter'` 判定。
  - 旧 DB / migrate 上来的 provider 行可能只有 `provider_type='openrouter'`，`protocol` 字段为空或未回填；初版按 protocol 判定会让旧 OpenRouter 行漏过新行为，继续走 discover-models + apply 全量写库路径。
  - 实现走 `findMatchingPresetForRecord({provider_type, base_url}).key === 'openrouter'`，与 `isCatalogOnlyPlanProviderRecord` 同源。两边用同一个 record-aware 入口，UI、search route、validate route、discover-models 的 OpenRouter 分支都通过这个 helper，不会出现"protocol 字段缺失 → gate 失效"。

- **2026-05-06（实现后第二轮 review — 4 处真 bug，全部修正）** —
  1. **search dialog HTTP verb 错位**：原代码用 `PUT` 调 `/api/providers/[id]/models`，路由只暴露 `GET/POST/PATCH/DELETE`，按钮直接 405。改成 `POST`，body 精简为 `{ model_id, upstream_model_id, display_name }`（route 已 hardcode `source='manual'`、`enable_source='manual_enabled'`、`user_edited=1`，不需要前端再传）。
  2. **Refresh All 漏分流**：单个 provider 刷新已通过 `handleValidateOpenRouter` 走 `/validate-models`，但页面顶部「刷新全部」的批量循环按 `isSyncableProvider().ok` 收集 targets 后统一调 `probeAndApplyProvider()`，OpenRouter 因此被送进 `/discover-models` → 命中 `unsupported` 短路 → 计入 failure summary。批量循环加 OpenRouter 分支：调 `/validate-models`，把 `{ verified, missing }` 映射回 `AutoDiscoverResult`（`verified → recommendedEnabled`），`missing` 写本地 state 给 per-row 徽章用，**不计入 failures**（健康的 validate 完成 ≠ 失败）。
  3. **base_url `/v1` 重复**：`openrouter-catalog.ts:fetchUpstream` 无条件拼 `${baseUrl}/v1/models`。OpenRouter 旧记录 / 官方文档示例的 base_url 形如 `https://openrouter.ai/api/v1`（已带 `/v1` 后缀），原代码会变成 `/api/v1/v1/models`。增加末尾 `/v1` 检测：有就 `${base}/models`，没有就 `${base}/v1/models`。
  4. **default alias 误判 missing**：eager seed 把本地 sonnet/opus/haiku 别名写进 `provider_models`（`source='catalog'`、`upstream_model_id='sonnet'/...`），但 OpenRouter `/v1/models` 返回的是完整形如 `anthropic/claude-3.5-sonnet` 的 ID。原 validate 用 `row.model_id` 跟 upstream id 集合比对，三个别名永远 miss → 用户刚添加 OpenRouter 第一次刷新就看到 `0 verified / 3 missing` 并把默认 alias 全部标成「已不在上游」。修法：validate 在比对前 `localModels.filter(r => r.source !== 'catalog')`，catalog 别名行不参与 validate（它们走 Claude Code 角色映射，不是 OpenRouter SKU）。OpenRouter 官方 Claude Code 文档示例确认用户应配置 `anthropic/claude-...` 完整 ID，不是短 alias，所以 validate 只校验 manual/api 行是正确边界。

  4 处都加了回归测试：搜索按钮 add → DB 出现 manual_enabled 行；legacy `/api/v1` base_url 实际打到 `/api/v1/models` 而不是 `/api/v1/v1/models`；validate 跳过 catalog alias 但仍命中真实失踪 SKU；批量刷新对 OpenRouter 走 validate 路径。最终 1442 / 1442 通过。

- **2026-05-06（实现后第三轮 review — 1 处 UX 语义）** —
  「刷新全部」summary 把 OpenRouter validate 的 `verified` 计入 `recommendedEnabled` → 最终 toast 读作「启用 N」，会让用户误以为刷新动了模型开关。validate 实际上只校验"是否仍在上游"，从不改 enabled 状态。
  - 拆出独立计数器 `validatedProviders / validatedTotal / validatedMissingTotal`，OpenRouter 分支不再走 `recommendedEnabled` 映射。
  - 新增 i18n keys `models.refreshAll.summaryValidated` 与 `summaryValidatedSomeMissing`，文案改为「已校验」「仍在上游」「不再可用」，不再出现「启用」字眼。
  - 当批量目标全是 OpenRouter（即 `okCount == validatedProviders`），跳过原 `summaryOk` 行 — 否则会显示「N updated · 0 enabled · 0 hidden」，"0 enabled" 读起来像 bug。混合批次（OpenRouter + 普通 catalog provider）两条都展示，各自只记自己的 provider 数。

- **2026-05-06（review 后修正）** — `discover-models` 不为 OpenRouter 加 `validate-only` 分支；新建独立 `/api/providers/[id]/validate-models` 路由。
  - 初版方案让 `discover-models` 对 OpenRouter 切到 `{ verified, missing, cachedAt }`，又把 discriminated-union 响应契约塞回了同一条路由，自相矛盾（恰是不复用搜索路由的同一条理由）。
  - 现在 `discover-models` 对 OpenRouter 直接走 `unsupported` 分支（与 OAuth / Coding Plan 的 unsupported 同语义，文案不同），不返回非常规 shape；refresh 真正承担校验语义的是新路由 `/validate-models`，前端 OpenRouter section 的"刷新"按钮明确指向它。
  - `discover-models/apply` 对 OpenRouter 仍直接 400（防御纵深）；既然 `discover-models` 已经返回 unsupported，正常路径根本不该到 apply，但留住 400 防止旧前端 / 脚本误调。
  - 三条路由各管一段：`discover-models`（diff 语义、对 OpenRouter unsupported）／`validate-models`（OpenRouter 专用、verified+missing）／`search-models`（OpenRouter 专用、candidates+alreadyAdded）。回归测试也对应三条。

- **2026-05-06** — 历史 300+ 行不静默清理，提供 opt-in "整理"。
  - 直接 DELETE 用户数据违反 `feedback_db_migration_safety` 与 `applyDiscoveryDiff` 的 manual_* 守卫语义。
  - "整理" 入口走预览 + 批量隐藏（`enabled=0`），用户随时能反悔。Hide 而不是 delete 也保留了"我之前用过这个"的状态，未来再用 search-models 添加也能复用同一行。

## 详细设计

### 1. API 设计

**Record-aware helper（`provider-catalog.ts`）**

与 `isCatalogOnlyPlanProviderRecord` 同源，复用 `findMatchingPresetForRecord` 推 preset key，避免依赖 `protocol` 字段（旧行可能为空）：

```ts
export function isOpenRouterProviderRecord(record: {
  provider_type: string;
  base_url: string;
}): boolean {
  return findMatchingPresetForRecord(record)?.key === 'openrouter';
}
```

UI、search 路由、validate 路由、`discover-models` 的 OpenRouter unsupported 分支、apply 路由的 400 拒绝都通过这个 helper 判定，不允许绕过去裸读 `provider.protocol`。

**新建 `POST /api/providers/[id]/search-models`** — 候选列表，不写库

```ts
// 请求体：空（dialog 打开时调用一次即够；客户端做过滤）
// 响应
{
  candidates: Array<{
    modelId: string;            // 上游 model id（OpenRouter 的形如 "anthropic/claude-3.5-sonnet"）
    displayName: string;
    contextWindow?: number;
    pricing?: { promptPerMillion?: number; completionPerMillion?: number };
    alreadyAdded: boolean;      // provider_models 已存在该 modelId（前端禁用 add 按钮）
  }>;
  total: number;                // 候选总数 = candidates.length，留作前端展示「共 X 个」
  cachedAt: string;             // ISO timestamp
}
```

服务端流程：
1. 验证 provider 存在且 `isOpenRouterProviderRecord(provider)` 为真，否则 400。
2. 从 5 分钟 cache 读取（cacheKey: `openrouter-models:{providerId}`）。Miss 则用 base_url + api_key 拉 `/v1/models`，规范化字段，写 cache。
3. 与 `provider_models` 当前行做 set 比较，标 `alreadyAdded`。
4. 返回完整 candidates 数组（不做关键字过滤）。
5. **永远不写库**。

> **过滤位置**：dialog 内的 `<input>` 直接对返回的 `candidates` 数组做大小写不敏感 substring 匹配（modelId + displayName）。打字时不发请求。打开 dialog → 一次 fetch → 客户端即时过滤。

**新建 `POST /api/providers/[id]/validate-models`** — refresh 校验，不写业务字段

```ts
// 请求体：空
// 响应
{
  verified: number;             // 本地存在且上游仍可见的行数
  missing: string[];             // 本地有但上游未返回的 modelId 列表
  cachedAt: string;              // 本次 refetch 的时间（不是更早的 cache 时间）
}
```

服务端流程：
1. 验证 `isOpenRouterProviderRecord(provider)` 为真，否则 400。
2. **强制 refetch** OpenRouter `/v1/models`（绕过 cache 的 TTL 检查，写回同一 cache 槽位）。这是「刷新」按钮要兑现的承诺，不能复用旧 cache。
3. 把本地 `provider_models` 与新拿到的上游候选求差集：present → `verified++`，absent → 进 `missing`。
4. 仅更新本 provider 所有行的 `last_refreshed_at = now()`（单条 UPDATE，不动 enable_source / source / enabled / display_name 等任何业务字段）。
5. **不调用 `applyDiscoveryDiff`**，不存在 INSERT 路径。

**Cache helper 契约**

两条路由共用一份内存 cache，但读 / 写策略不同：

```ts
async function getOpenRouterCatalog(provider: ApiProvider, opts?: { force?: boolean }): Promise<Candidates>
```

- `force: false`（search-models 默认）：cache hit 在 TTL 内 → 直接返回；miss 或过期 → fetch + 写回。
- `force: true`（validate-models 强制）：忽略 TTL，必 fetch + 写回；返回的就是最新结果，`cachedAt` 反映本次 refetch 时间。

这避免了"用户点了刷新但 cache 还在 TTL 内 → 实际上没真正刷新"的语义陷阱。

**`POST /api/providers/[id]/discover-models` 改动** — OpenRouter 直接 unsupported

- 在 `classifyProvider` 之前增加一条早返回：`if (isOpenRouterProviderRecord(provider)) return { classification: 'unsupported', notes: 'OpenRouter — use /validate-models for refresh and /search-models for adding new models.', suggestedFallback: '...' }`。
- 走的是已有的 `unsupported` 分支，**没有新返回 shape**。前端现有 `runAutoDiscoverForProvider` 的 `unsupported` 处理仍生效（toast 默认会讲"不支持"），但 OpenRouter 在 ProviderManager 与 ModelsSection 都被 `isOpenRouterProviderRecord` 提前 short-circuit，永远不会走到 discover-models — 这条 unsupported 分支只是防御纵深。

**`POST /api/providers/[id]/discover-models/apply`** — OpenRouter 直接 400

- 既然 discover-models 对 OpenRouter 已 unsupported，正常路径不会到 apply。但保留 400 防止旧前端 / 自动化脚本绕过 discover-models 直接调 apply（错误信息提示 `Use /search-models for OpenRouter`）。

**Add Service 成功路径绕开 auto-discover + 主动 seed catalog**

> **现状校验（2026-05-06）**：`db.ts:createProvider()` 只 INSERT provider 行，不 seed `provider_models`。catalog seed 当前只在 `GET /api/providers/[id]/models` 路由内通过 `seedCatalogModelsIfEmpty()` 懒触发。因此初版计划里「createProvider 已经 seed 了 sonnet/opus/haiku」的描述与代码不符 — 验收说"DB 仅 3 条 seed 行"在刚 POST 完 provider 的瞬间不成立。

修法：在 OpenRouter Add Service 流程里把 seed 改成主动触发，让"新增 OpenRouter 后立即查 DB 应有 3 条 seed 行"成为确定性的契约。

服务端：`POST /api/providers` 路由在 `createProvider(body)` 之后，若 `isOpenRouterProviderRecord(provider)`，立即 `seedCatalogModelsIfEmpty(provider.id, getCatalogDefaultModelsForRecord(provider))`（同事务 / 同请求生命周期内）。其他 provider 类型保持懒触发现状不动 — 本轮不扩散到无关 provider，也避免改动行为对其他流程的影响。

前端：`ProviderManager.tsx:382` 在现有 catalog-only 分支之后增加 OpenRouter 分支：

```ts
if (isCatalogOnlyPlanProviderRecord({ provider_type, base_url })) { ... return; }
if (isOpenRouterProviderRecord({ provider_type: newProvider.provider_type, base_url: newProvider.base_url })) {
  // 此时服务端已经 seed 完 sonnet/opus/haiku 三条，前端 toast 的承诺与 DB 一致。
  showToast({ type: 'success', message: t('provider.autoDiscover.openrouterAddOnly', { name: newProvider.name }) });
  return;
}
// 原有 runAutoDiscoverForProvider 继续给其他 provider 用
```

i18n key 新增：
- `provider.autoDiscover.openrouterAddOnly` — 「已添加 {name}：默认包含 sonnet/opus/haiku 别名。打开 Models 页用「添加模型」搜索更多。」（英文同义版）

> 为什么不把所有预设 provider 都改成 eager seed：blast radius 太大；catalog-only 等其他流程现在的"打开 Models 页时再 seed"已经覆盖用户感知（用户必然先开 Models 才看得到行数），无需改动。OpenRouter 之所以特别，是因为它的成功 toast 把"sonnet/opus/haiku 别名"写明了 — 文案承诺需要 DB 状态匹配。

### 2. UI 组织

**OpenRouter provider section 的按钮结构（仍然 2 个按钮，不增加视觉负担）**

```
[provider 名称 + status pill]    [刷新]  [角色映射]  [搜索 / 添加模型]
```

- **刷新**：保留按钮，点击调用 `POST /api/providers/[id]/validate-models`。
  - Toast 文案：success 时「已校验 N 个模型，全部仍可用」；有 missing 时 warning「已校验 N 个，X 个不再上游可用 — 已在卡片上标注」。
  - 不再发起任何 INSERT / UPDATE 启用状态的请求；只有 validate route 在底层做单条 `last_refreshed_at` UPDATE。
  - 路由判定经 `isOpenRouterProviderRecord(provider)` — UI 不裸读 `provider.protocol`。
- **搜索 / 添加模型**（替代旧的「添加模型」按钮）：点击打开扩展后的 Add Model dialog。
  - **OpenRouter 时**：dialog 顶部是搜索框 + 候选列表。点击候选行触发"添加"，调用 `POST /api/providers/[id]/models`（已有路由）写一行 `source='manual'`、`enable_source='manual_enabled'`。底部折叠区一行链接「或手动输入 model ID」展开旧表单，覆盖 OpenRouter 偶尔有未列出 SKU 的边缘情况。【2026-05-06 校正：原文写的是 `PUT`；这条旧契约导致过 OpenRouter 添加按钮 405 dead-button bug，实际路由从未实现 PUT，只有 POST。下一次复制粘贴这段文档前请先看 `src/app/api/providers/[id]/models/route.ts` 确认路由 verb。】
  - **其他 provider 时**：dialog 内容不变，仍然是手动输入 modelId + displayName 的旧表单。
  - 文案：按钮 i18n 不区分 provider — 都是「添加模型 / Add model」；dialog 内容按 protocol 切换。

**已不在上游的行的提示**（让 `/validate-models` 返回的 `missing` 数组可见）

- 每行右侧增加可选的小徽章：「已不在上游」。tone = `bg-status-warning-muted text-status-warning-foreground`。
- 数据来源：刷新返回 `missing` 数组写入前端 component state（不入库）；下次刷新覆盖。
- 鼠标悬停 tooltip：「OpenRouter 上次同步未返回此模型 — 你之前已添加，所以保留；如果确认不再需要可隐藏。」

**「整理已导入的全量目录」入口**（Phase 3，不在 Phase 2 ship）

OpenRouter section 标题右侧增加一个低权重链接「整理早期导入的目录」。仅当 `provider_models` 中存在 `enable_source='recommended' AND user_edited=0` 的行时显示（旧自动物化的痕迹）。点击打开预览对话框：
- 列出会被处理的行（modelId + displayName）
- 一次性 hide-all（`enabled=0`，保留行）
- 显式说明「manual_enabled / 已编辑的行不会被处理」
- 用户可在预览里逐行取消勾选

完成后，链接消失（条件不再满足）。

### 3. 数据保护

OpenRouter 这一轮的写库点收敛到三处：

| 触发 | 写入内容 | manual_* 是否被影响 |
|------|----------|---------------------|
| Add Service 创建 OpenRouter provider | catalog seed（sonnet/opus/haiku 别名，`source='catalog'`、`enable_source='recommended'`） | n/a — 新行 |
| 用户在 search dialog 点添加 | 单行 `source='manual'`、`enable_source='manual_enabled'`、`user_edited=1` | 无 — 新行 |
| 「整理」入口确认 | 批量 `enabled=0`，仅作用于 `enable_source='recommended' AND user_edited=0` | 受保护 — WHERE 子句直接排除 manual_* 行 |

**永远不会触发的写法（防回归）**：
- `runAutoDiscoverForProvider` 对 OpenRouter 不再被前端调用（ProviderManager 与 ModelsSection 都通过 `isOpenRouterProviderRecord` 提前 short-circuit）
- 即便绕过前端直调 `/discover-models`，对 OpenRouter 也直接返回 `unsupported`，永不进入 `applyDiscoveryDiff`
- 即便再绕过到 `/discover-models/apply`，路由对 OpenRouter 直接 400
- `/validate-models` 自身没有 INSERT 路径，源代码层禁掉

### 4. 回归测试

新增单测，全部放 `src/__tests__/unit/openrouter-search-and-add.test.ts`：

1. **Add Service 主动 seed + 不 materialize**：调用 `POST /api/providers` 创建 OpenRouter provider；断言路由返回前 `provider_models` 已写入恰好 3 条 catalog seed 行（sonnet/opus/haiku，`source='catalog'`、`enable_source='recommended'`）；同时断言 `/v1/models` fetch 没有被调用（`runAutoDiscoverForProvider` 在 OpenRouter 分支被 skip，eager seed 走的是本地 catalog defaults，不打上游）。

2. **Refresh 不 materialize**：现有 OpenRouter provider 含 5 条 `provider_models`（含 1 条 manual_enabled、1 条 manual_hidden、3 条 recommended）；mock `/v1/models` 返回 300 条（与本地 5 条不重叠）；调用 `/validate-models` 路由；断言 `provider_models` 行数仍是 5、enabled / hidden / source / display_name 全部不变、`last_refreshed_at` 已更新；响应 `{ verified: 5 - missing.length, missing: [...] }` 形状正确。

3. **Search 不写库**：调用 `/search-models` 不带 `q`；断言响应包含 candidates 且 `provider_models` 行数前后不变。

4. **Search 标记 alreadyAdded**：本地存在 `anthropic/claude-3.5-sonnet` 一行；调用 search；断言对应 candidate 的 `alreadyAdded === true`，其他为 false。

5. **discover-models 对 OpenRouter 返回 unsupported**：`POST /discover-models` 给 OpenRouter provider；断言 `classification === 'unsupported'`、`ok` 未声明为 true、`fullModelIds` 未返回；断言 fetch 没有被调用（与 catalog-only gate 同形）。

6. **Apply 路由对 OpenRouter 拒绝**：直接 `POST /discover-models/apply` 给 OpenRouter provider；断言 400 + 错误信息提到「Use /search-models for OpenRouter」。

7. **`isOpenRouterProviderRecord` legacy-shape 命中**：构造 `{ provider_type: 'openrouter', base_url: 'https://openrouter.ai/api', protocol: '' }` 与 `{ provider_type: 'openrouter', base_url: 'https://openrouter.ai/api' }`（无 protocol 字段）两种历史形态；断言 helper 都返回 `true`，并断言用 `protocol === 'openrouter'` 的裸判定会漏掉前者（明确反向证据，避免再有人去掉 helper 走捷径）。

8. **整理入口只命中 recommended-not-edited**：DB 含 mixed 5 行（同上）；模拟 hide-all 流程；断言 manual_enabled 行 `enabled` 不变、recommended 行变 0、user_edited 行不变。

9. **Cache helper force 契约**：mock fetch；连续调用 `getOpenRouterCatalog(provider)` 两次（默认 force=false）→ 第二次应该 cache hit，fetch 仅触发 1 次；再调用一次 `getOpenRouterCatalog(provider, { force: true })` → fetch 触发第 2 次；最后默认调用一次 → cache hit（用 force=true 写回的新值），fetch 仍是 2 次。这条测试锁住"validate 必 refetch、search 复用 cache"的不对称约定。

## 不在范围

- **改 DB schema**：本轮坚决不动 `provider_models` 列。orphan 状态走前端组件 state；search 的 cache 走服务端内存。
- **批量 import / OPML 风格**：用户一次最多通过 search 添加 1 行；批量需求未见到。
- **OpenRouter 分类 / tag 浏览**：search dialog 暂不分类；纯模糊搜索匹配 modelId + displayName 已覆盖 95% 场景。
- **价格排序**：响应里带 pricing 字段供未来用，但本轮 dialog 仅展示，不做排序。
- **Coding/Token Plan gate 边界回测**：上一轮已做，本轮假设其稳定。

## 风险 / 回归

- **历史 DB 中 OpenRouter 已有 300+ 行**：Phase 3 提供 opt-in 整理；不在 Phase 1/2 触发任何破坏性动作。已在「现状」+「决策日志」中说明，避免被理解成"升级即清理"。
- **OpenRouter `/v1/models` 频率限制**：服务端 cache 5 分钟避免渲染进程重复打。Search dialog 的客户端 debounce 默认 200ms，不会在打字时打多次服务端。
- **Cache 与刷新的一致性**：`/validate-models` 与 `/search-models` 共用同一 cache key 与 cache helper，但调用约定不同 — search 走默认（读 cache，TTL 内复用），validate 走 `{ force: true }`（必 refetch、写回）。这避免"刷新没真正刷新"的语义陷阱，也确保 validate 写回后下次开 search dialog 直接命中新缓存。
- **i18n key 命名**：新增 keys 都进 `provider.autoDiscover.*` / `provider.search.*` / `provider.validate.*` 命名空间，避免 dialog 内部杂乱。
- **typecheck 风险**：新建 search-models / validate-models 路由时确保返回类型与前端 zod schema 对齐；现有 discover-models route 的响应 shape **完全不动**（只增加 OpenRouter unsupported 早返回分支）。
- **`protocol` 字段缺失隐患**：现有 DB 中可能存在 `provider_type='openrouter'` 但 `protocol` 字段为空的旧行（schema 升级前创建）。所有判定都走 `isOpenRouterProviderRecord({provider_type, base_url})`，不读 `protocol` 字段；测试 #7 显式断言两种形态都被命中。

## 验收标准

满足以下全部条件，Phase 4 才能把 tech-debt #13 翻 已解决、把研究文档中"类别 A 中的特例"改成"已实现 search-and-add"：

1. 新连一个 OpenRouter provider：`POST /api/providers` 返回后立即查 `provider_models`，应有恰好 3 条 catalog seed 行（sonnet/opus/haiku 别名，`source='catalog'`、`enable_source='recommended'`）；前端 toast 是绿色 success 文案，**不是** unsupported warning。
2. 点开「添加模型」：dialog 显示搜索框 + 上游候选；输入关键字过滤即时；点击行后 provider_models 多 1 条 manual_enabled，dialog 不关闭，候选行变灰显示「已添加」。
3. 点「刷新」：toast 仅汇报「已校验 N 个」/ missing 信息；DB 行数不变。
4. 启动前已有旧 300+ 行的 DB：不会自动清理；section 顶部出现「整理早期导入的目录」入口；点击预览，预览只列出 recommended-not-edited 行，manual_enabled 行不在列表里。
5. 全部新单测通过；现有 `apply-discovery-diff.test.ts`、`coding-plan-discovery-gate.test.ts` 不受影响。
6. CDP smoke：搜索响应、添加交互、刷新文案均符合上面的描述。
