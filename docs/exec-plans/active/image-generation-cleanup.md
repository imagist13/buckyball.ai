# 图像生成代码清理

> 创建时间：2026-09-04
> 最后更新：2026-09-04

## 背景与目标

`docs/exec-plans/active/bbdev-skill-integration.md` Phase 7 已把图像生成 flag 隐藏（`imageGeneration:false`，入口 410 / UI 隐藏 / 旧数据保留），但**代码、provider catalog、API 路由、UI 组件、tests、i18n 全留在主分支**，跟"二开 fork 只保留 buckyball 所需"定位不符。

用户决策："**图像生成全删**"——不是隐藏，是把实现、调用、UI、provider 类型、tests、文案一并清掉。

## 用户能看到什么

**完成后：**
- 仓库已无 `src/lib/image-generator.ts` / `src/lib/image-gen-mcp.ts`；无 `/api/media/generate` 与 `/api/providers/active-image` 路由；无 `ImageGenConfirmation` 与 `imageGenerator` widget 渲染；无 `provider-catalog.ts` 里的 `gemini-image` / `openai-image` 类型与图标。
- Provider 设置页 / 模型目录不再出现 image provider（用户也不会再被诱导添加）。
- i18n `media.*` / `image.*` / `imageGen.*` 全部移除；中文/英文一致清空。
- 旧的 `~/.codepilot-media/` / `~/.buckyball-media/` 文件不被删除（CLAUDE.md "旧数据保留"）；`media_generations` 表行不删（兼容回滚）。
- 现有 `/api/media/*` 其它端点（serve、gallery、tags、jobs、favorite、items、progress 等）**保留**——它们是 Gallery 体系，不只是图像生成。

**明确不做的：**
- 不删 `media_generations` 表 schema / DB 行（保留历史）。
- 不删 `/api/media/serve` / `/api/media/gallery` / `/api/media/jobs/*` / `/api/media/[id]/*` / `/api/media/tags/*`（属于 Gallery 通用 API，不是图像生成专属）。
- 不动 `src/lib/job-executor.ts` 里非图像生成段的代码（仅剥离图像段，job-executor 自身保留）。
- 不影响 Codex builtin-bridge / media MCP 列表（按需处理，但仅限生成相关）。
- 不删 `Sentry` 上报（保留 breadcrumb 渠道以观察清理后无报错）。

## 状态总览

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase I0 | 计划文档 + 在 bbdev-skill-integration Phase 7 拆段 | ✅ 已完成 | 本次先写 |
| Phase I1 | 删除 `src/lib/image-generator.ts` + `src/lib/image-gen-mcp.ts` | 📋 待开始 | |
| Phase I2 | 删除图像专属 API + UI | 📋 待开始 | |
| Phase I3 | `provider-catalog.ts` 与 `lib/db.ts` 图像 provider 类型清理 | 📋 待开始 | |
| Phase I4 | 测试 / i18n / harness 引用清点 | 📋 待开始 | |
| Phase I5 | 验证（typecheck + 单元测试 + dev server smoke） | 📋 待开始 | |

## 执行清单

### Phase I0 — 计划与索引

- [x] I0.1 创建 `active/image-generation-cleanup.md`（本文）
- [x] I0.2 `active/bbdev-skill-integration.md` Phase 7 拆段：M7.1（feature flag）保留、M7.2（路由 410）改为 `route.ts` 直接删除、M7.3–M7.4 UI 隐藏改为 UI 删除，新增 cross-link 到本计划
- [x] I0.3 `docs/exec-plans/README.md` 索引表新增本计划

### Phase I1 — 核心库删除

- [ ] I1.1 删除 `src/lib/image-generator.ts`
- [ ] I1.2 拆 `src/lib/image-gen-mcp.ts` → **删 `codepilot_generate_image` 工具 + `MEDIA_RESULT_MARKER` + `extractMcpAbortSignal` 全部仅图像段**；**视频段（`codepilot_generate_video`）保留并重命名为 `src/lib/xai-video-mcp.ts`**，新文件只导出 `createVideoGenMcpServer`；`image-gen-mcp.ts` 文件本体删除
- [ ] I1.3 删 `src/types/index.ts` 中 `image-gen-mcp` / `imageGenerator` 相关类型导出（保留 video 相关导出）
- [ ] I1.4 删 `src/lib/harness/capability-matrix.ts` / `capability-contract.ts` / `capability-display-text.ts` / `context-compiler.ts` / `runtime-adapter.ts` / `mutation-level.ts` 中所有 `image-generation` / `imageGeneration` capability 字段与描述段（含对应 i18n key 引用）；**保留** `video-generation` 段

### Phase I2 — 路由与 UI 删除

- [ ] I2.1 删除 `src/app/api/media/generate/route.ts`
- [ ] I2.2 删除 `src/app/api/providers/active-image/route.ts`
- [ ] I2.3 删除 `src/app/api/providers/[id]/route.ts` 中关于 image provider 的分支（GET 时不返回、DELETE 时清空 `active_image_provider_id` setting）
- [ ] I2.4 删除 `src/components/chat/ImageGenConfirmation.tsx`
- [ ] I2.5 删 `src/components/settings/ProviderManager.tsx` 中 image provider 卡片 / 添加按钮 / `active_image_provider_id` 选择器
- [ ] I2.6 删 `/api/chat/route.ts` / `src/lib/agent-loop.ts` / `src/lib/chat-collect-stream-response.ts` / `src/lib/codex/proxy/builtin-bridge.ts` / `src/lib/builtin-tools/media.ts` 中图像生成相关代码段（含 tool call / widget / type guard）
- [ ] I2.7 删 `src/lib/job-executor.ts` 中图像段（仅图像，其余 job 段保留）

### Phase I3 — provider 类型 + DB

- [ ] I3.1 `src/lib/provider-catalog.ts`：删 `gemini-image` / `openai-image` 的定义 + icon + 字段；adjust `ProviderType` union
- [ ] I3.2 `src/lib/db.ts`：删 `media_generations` 相关 insert / query 中**仅图像生成使用**字段的 helper（`registerMediaGenerationAsset` 等保留——属于 Gallery 通用）；保留表 schema 不动
- [ ] I3.3 删 `src/lib/xai-imagine.ts` / `src/lib/xai-oauth-manager.ts` 中 `image-generation` 路径分支；`requestGrokImagineImage` 整段删（若还有别处引用则一起改）；`generateGrokVideo` / `XAI_IMAGINE_VIDEO_MODEL` / `readGrokReferenceImages` 全部保留
- [ ] I3.4 启动时清理旧 `active_image_provider_id` setting（写一次性 migration：发现键存在则 delete；连续 2 个版本后正式移除键）

### Phase I4 — 测试 / i18n / 守卫

- [ ] I4.1 删除测试（与被删代码一一对应）：
  - `src/__tests__/unit/media-provider-routes.test.ts` 中关于 `/api/media/generate` / `/api/providers/active-image` 的 case
  - `src/__tests__/unit/openai-image-size.test.ts`
  - `src/__tests__/unit/native-media-block-side-channel.test.ts` 中关于图像 block side-channel 的 case
  - `src/__tests__/unit/provider-resolver.test.ts` 中关于 image provider 选择器分支（保留非图像段）
  - `src/__tests__/fixtures/toolloop-poc-parity/sse-golden-tool-turn.json` 中图像相关 fixture（grep 后按 case 切割）
- [ ] I4.2 `src/i18n/en.ts` / `src/i18n/zh.ts`：删 `media.*` / `imageGen.*` / `image.*` / `provider.catalogue.geminiImage*` / `provider.catalogue.openaiImage*` / `widget.imageGen*` 全部 key
- [ ] I4.3 grep 复扫（按 I1–I3 路径全清）：
  - 全仓 `from '@/lib/image-generator'`
  - 全仓 `from '@/lib/image-gen-mcp'`
  - 全仓 `ImageGenConfirmation`
  - 全仓 `provider_type === 'gemini-image'` / `'openai-image'`
  - 全仓 `active_image_provider_id`
- [ ] I4.4 守卫：新增 `scripts/image-gen-import-guard.mjs`（CI hook + pre-commit），拦截上述 5 类新增引用
- [ ] I4.5 `package.json`：清 `@ai-sdk/google` / `@ai-sdk/openai` 中只为图像生成引进的子导入（如确认无别处使用，则一并移除 dep；否则保留；本 Phase 仅 grep，不必移除 dep）

### Phase I5 — 验证

- [ ] I5.1 `npm run test`（typecheck + 全量单元测试）
- [ ] I5.2 `node scripts/image-gen-import-guard.mjs` 自检通过
- [ ] I5.3 `npm run dev` 启动 dev server，curl `/api/media/generate` → 404；curl `/api/providers/active-image` → 404
- [ ] I5.4 Provider 设置页加载，确认图像 provider 卡片消失、模型目录无 image provider
- [ ] I5.5 旧 `~/.codepilot-media/` / `~/.buckyball-media/` 文件不被删除（保留）；media_generations 表 schema 不动
- [ ] I5.6 把本计划移到 `completed/`

## 决策日志

- 2026-09-04: 用户决策"图像生成全删"——直接清代码，不是再隐藏一层 flag。
- 2026-09-04: 与"个人助手"不同：助手是"合并"（保留 BB Agent 接管），图像是"删除"（不留实现）。理由：图像生成不被 BB Agent 业务链路使用，与 buckyball 域无关。
- 2026-09-04: `media_generations` 表 + 旧磁盘目录不删——属于 Gallery 通用资产链路，迁移 / 回滚期需要保留。
- 2026-09-04: `/api/media/*` 其它端点（serve / gallery / jobs / tags）保留——是 Gallery 通用 API，不只服务于图像生成。
- 2026-09-04: 守卫脚本与"个人助手合并"计划同一类（`scripts/bbagent-assistant-import-guard.mjs` / `scripts/image-gen-import-guard.mjs`），后续可合并成一个 `scripts/feature-removal-guards.mjs`——本 Phase 不做合并，留作 tech-debt。
- 2026-09-04: 不删 `@ai-sdk/google` / `@ai-sdk/openai` dep，仅 grep 清除引用——因为这些 SDK 同时用于文本模型；移除 dep 留给后续清理 PR。
- 2026-09-04: **用户决策：保留 Grok 视频生成**。`image-gen-mcp.ts` 里的 `codepilot_generate_video` 走 `xai-imagine`（视频），与 `generateSingleImage`（图像）无依赖。I1.2 改为"拆出视频段 → 新文件 `xai-video-mcp.ts`"；`generateGrokVideo` / `XAI_IMAGINE_VIDEO_MODEL` / `readGrokReferenceImages` 全部保留（I3.3 / I1.4 video 段保留）；`requestGrokImagineImage` 整段删。

## Smoke Ledger

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _示例_ | n/a | n/a | n/a | n/a | curl `/api/media/generate` → 404 | 📋 | _Phase I5.3 后补_ |
| _示例_ | n/a | n/a | n/a | n/a | curl `/api/providers/active-image` → 404 | 📋 | _Phase I5.3 后补_ |
| _示例_ | n/a | n/a | n/a | n/a | Provider 设置页 → 无 image provider | 📋 | _Phase I5.4 后补_ |

## 风险与开放问题

| 风险 | 缓解 |
|------|------|
| `image-generator.ts` 内部 import `@ai-sdk/google` / `@ai-sdk/openai` / `xai-imagine` —— 多文件联动删除易漏 | I1.1 + I4.3 grep 兜底 |
| Codex builtin-bridge / image-gen-mcp 在 Codex Runtime 路径上是否有别处依赖 | I1.2 删除前 grep |
| `media_generations` 表 schema 与旧行若不删，新代码可能仍误访问 | I5.1 typecheck 兜底 |
| Provider 设置页 `provider-catalog.ts` 删除后是否引发跨页崩溃 | I5.4 启动真实 dev server 验证 |
| 旧用户可能仍有名为 `gemini-image` / `openai-image` 的 provider DB 行——I3.4 migration 仅清 setting，不清表行，保留兼容 | I3.4 一次性 migration；后续 PR 可加清理 |

## 文档反向链接

- 上游计划：[active/bbdev-skill-integration.md](./bbdev-skill-integration.md)
- 关联计划：[active/assistant-merge-into-bbagent.md](./assistant-merge-into-bbagent.md)
