# 个人助手合并入 bbagent

> 创建时间：2026-09-04
> 最后更新：2026-09-04

## 背景与目标

`docs/exec-plans/active/bbdev-skill-integration.md` Phase 7 已经把个人助手的入口隐藏（flag = false，UI 入口 / 路由 410），但代码、`OnboardingWizard`、`AssistantWorkspaceSection`、`buddy.ts`、`heartbeat.ts`、相关 API、tests、i18n 全留在主分支里——这跟 `assistant-workspace.md`（completed）的产物仍有用户可见路径不一致。

同时，新定位 `docs/research/buckyball-ai-design.md` 已经把 `bbagent/` 作为 CodePilot 二开 fork 的核心魔改点。**「专门为 bb 打造的 agent 助手了，再增加一个个人助手挺别扭」**——把个人助手整个合并进 `bbagent/`，让 BB Agent 接管其产物（HEARTBEAT.md / daily memory / `instructions.md` ↔ `CLAUDE.md`/`AGENTS.md` 镜像 / `shouldRunHeartbeat` / Evolution Buddy / Hatch Buddy 任务）。

## 用户能看到什么

**完成后：**
- 主分支已无 `src/lib/assistant-workspace.ts` / `src/lib/buddy.ts` / `src/lib/heartbeat.ts` / `src/lib/assistant-heartbeat.ts` / `src/lib/assistant-default-workspace.ts` / `src/components/assistant/` / `src/app/settings/assistant/` / `src/app/api/workspace/{hatch-buddy,evolve-buddy,wizard,summary,session}/` / Settings 入口 "Assistant" / 侧栏 "个人助手"。
- 同样的产物（HEARTBEAT.md、daily memory、Hatch Buddy、Evolution Buddy、`lastHeartbeatDate`）由 `src/lib/bbagent/assistant/` 接管，重新启用 flag `personalAssistant:true` 时也能工作（flag 默认仍为 false，UI 入口保持隐藏）。
- 旧的 `.assistant/` 目录、`state.json.buddy`、Hatch/Evolution DB 行不会被删除，可读但不写入新数据。

**明确不做的：**
- 不删 `.assistant/` 数据磁盘目录（CLAUDE.md 用户明确指示"旧数据暂时保留"）。
- 不动 `bbagent/prompt-injector.ts` 已落地的 system-prompt fragment 逻辑（保留作为 BB Agent 的扩展点）。
- 不动 `bbagent/features.ts` 的 flag 默认值（保持 false = 入口隐藏、可回滚）。
- 不做跨 workspace 迁移（旧的 `getSetting('assistant_workspace_path')` 用户升级后仍是只读）。
- 不拆 buckyball.ai 与上游 CodePilot 的同步线（CLAUDE.md "PR 审查安全"——上游继续保留这些文件不会冲突，删除属于 fork 内决策）。

## 状态总览

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase M0 | 计划文档 + 索引回写 + 在 bbdev-skill-integration 计划里同步状态 | ✅ 已完成 | 本次先写 |
| Phase M1 | 把 4 个核心模块搬进 `src/lib/bbagent/assistant/`，路径 / 命名重整 | 📋 待开始 | |
| Phase M2 | API 路由（wizard / hatch-buddy / evolve-buddy / summary / session）合并到 BB Agent 名称空间 | 📋 待开始 | |
| Phase M3 | UI 端：迁入 `src/components/bbagent/AssistantWorkspaceSection.tsx`，Settings 入口改名 | 📋 待开始 | |
| Phase M4 | 测试搬迁 + i18n 整理 + provider/permission/lib 引用清点 | 📋 待开始 | |
| Phase M5 | 验证（typecheck + 单元测试 + 启动 Electron 跑 flag=true 烟雾） | 📋 待开始 | |

## 执行清单

### Phase M0 — 计划与索引

- [x] M0.1 创建 `active/assistant-merge-into-bbagent.md`（本文）
- [x] M0.2 在 `active/bbdev-skill-integration.md` 决策日志新增 "2026-09-04: 个人助手合并入 bbagent，新增本计划接管 Phase 7 中"个人助手"段"
- [x] M0.3 在 `active/bbdev-skill-integration.md` Phase 7 拆成两个 cross-link：`image-generation-cleanup.md` + `assistant-merge-into-bbagent.md`，移除原 M7.4–M7.6 / 7.5「不再自动 seed」条款（已默认由 flag 关闭），改为引用本计划
- [x] M0.4 `docs/exec-plans/README.md` 索引表新增本计划 + image-generation-cleanup 行

### Phase M1 — 核心模块搬到 `bbagent/assistant/`

- [ ] M1.1 新建 `src/lib/bbagent/assistant/paths.ts` 暴露 `resolveAssistantWorkspacePath()`（取代旧的 `getSetting('assistant_workspace_path')` 散落引用；不强制改所有调用方，留允许旧 key 兜底）
- [ ] M1.2 把 `src/lib/assistant-workspace.ts` 整文件迁入 `src/lib/bbagent/assistant/workspace.ts`，导出重命名 `BbAssistantWorkspace*`；保留未导出的同义别名 1 release 双轨
- [ ] M1.3 把 `src/lib/buddy.ts` 迁入 `src/lib/bbagent/assistant/buddy.ts`，导出 `BbBuddy*` / `BbSpecies` / `BbRarity` / `BbBuddyData`
- [ ] M1.4 把 `src/lib/heartbeat.ts` 迁入 `src/lib/bbagent/assistant/heartbeat.ts`，导出 `BbHeartbeat*`
- [ ] M1.5 把 `src/lib/assistant-heartbeat.ts` 迁入 `src/lib/bbagent/assistant/reconcile.ts`（包含 `readAssistantHeartbeatDesiredState` → `readBbAssistantHeartbeatDesiredState`）
- [ ] M1.6 把 `src/lib/assistant-default-workspace.ts` 迁入 `src/lib/bbagent/assistant/bootstrap.ts`
- [ ] M1.7 在 `src/lib/bbagent/features.ts` 增 `isBbAssistantEnabled()`（基于 flag），但**flag 默认值保持 false**——本 Phase 不改默认

### Phase M2 — API 路由合并

- [ ] M2.1 `src/app/api/workspace/wizard/route.ts` → `src/app/api/bbagent/assistant/wizard/route.ts`，所有 `import { ... } from '@/lib/assistant-workspace'` / `@/lib/buddy` 改为新路径
- [ ] M2.2 `src/app/api/workspace/hatch-buddy/route.ts` → `src/app/api/bbagent/assistant/hatch-buddy/route.ts`
- [ ] M2.3 `src/app/api/workspace/evolve-buddy/route.ts` → `src/app/api/bbagent/assistant/evolve-buddy/route.ts`
- [ ] M2.4 `src/app/api/workspace/summary/route.ts` → `src/app/api/bbagent/assistant/summary/route.ts`
- [ ] M2.5 `src/app/api/workspace/session/route.ts` → `src/app/api/bbagent/assistant/session/route.ts`
- [ ] M2.6 `/api/settings/workspace` 内 `assistant_workspace_path` 相关 PATCH 迁到 `/api/bbagent/assistant/workspace`，旧路由删除
- [ ] M2.7 旧路径保留 1 release 的 Next.js `rewrite` 转发到新路径（让上游仍在文档/外部链接指向时优雅降级）

### Phase M3 — UI 端迁移

- [ ] M3.1 `src/components/settings/AssistantWorkspaceSection.tsx` → `src/components/bbagent/AssistantWorkspaceSection.tsx`，imports 指向 `bbagent/assistant/*`
- [ ] M3.2 `src/components/assistant/OnboardingWizard.tsx` → `src/components/bbagent/AssistantOnboardingWizard.tsx`，`props` 名 / 引用重命名
- [ ] M3.3 `src/components/ui/AssistantAvatar.tsx`：迁名 `BbAssistantAvatar.tsx` 或保留旧名（按引用量决定，本计划选保留 + 内部 `use Bb` 注记）
- [ ] M3.4 `src/app/settings/assistant/page.tsx` 删除（Settings 入口消失）
- [ ] M3.5 `src/components/layout/AppShell.tsx` / `UnifiedTopBar.tsx` / `ChatListPanel.tsx` / `ProjectGroupHeader.tsx` / `DashboardPanel.tsx` / `MessageList.tsx` / `ChatView.tsx` / `ChatEmptyState.tsx` 中 "个人助手" 相关 CTA / icon / 文案：
  - 入口隐藏（保留代码 + i18n key，UI 隐藏由 `isBbAssistantEnabled()` 决定）
  - 不删除代码（避免大 diff），仅按 flag gate
- [ ] M3.6 `/api/chat/route.ts` / `src/lib/agent-loop.ts` / `src/lib/claude-client.ts` / `src/lib/agent-task-runner.ts` / `src/lib/codex/runtime.ts` / `src/lib/runtime/sdk-runtime.ts` / `src/lib/runtime/types.ts` 内对 `assistant-workspace.ts` / `buddy.ts` / `heartbeat.ts` 的 import 改写指向 `bbagent/assistant/*`
- [ ] M3.7 `src/lib/task-scheduler.ts` / `src/lib/notification-mcp.ts` / `src/hooks/useAssistantTrigger.ts` / `src/hooks/useAssistantWorkspace.ts` / `src/hooks/usePanel.ts` 同步改写
- [ ] M3.8 i18n `src/i18n/en.ts` / `zh.ts` 中 `assistant.*` / `buddy.*` / `wizard.*` / `heartbeat.*` 加命名空间前缀 `bbagent.assistant.*`（保留旧 key 别名 1 release，供可能的旧 UI 引用，最终在 M4.6 移除）

### Phase M4 — 测试 + 引用清点 + 守卫

- [ ] M4.1 单元测试迁移：
  - `assistant-workspace-path-ui.test.ts` → `bbagent-assistant-workspace-path-ui.test.ts`
  - `default-assistant-bootstrap.test.ts` → `bbagent-default-assistant-bootstrap.test.ts`
  - `heartbeat-copy-honesty.test.ts` / `heartbeat-notify.test.ts` / `heartbeat-reconcile.test.ts` / `heartbeat-trigger-discipline.test.ts` → `bbagent-heartbeat-*`
  - `assistant-tasks-link-only.test.ts` → `bbagent-assistant-tasks-link-only.test.ts`
  - 删除线上的 `prompt-dialog-replacement.test.ts`（与本计划无关，跟随 i18n 整理）
  - 旧 `prompt-dialog-replacement.test.ts` 不在清单上但出现在 grep 中，确认是否需要迁移：结论是改名而非删除，按 i18n 整理走
- [ ] M4.2 引用 grep 复扫：`src/lib/db.ts` / `src/lib/permission/profile.ts` / `src/lib/context-assembler.ts` / `src/lib/harness/*` / `src/lib/codex/builtin-mcp-servers.ts` / `src/lib/codex/proxy/builtin-bridge.ts` / `src/lib/builtin-mcp-catalog.ts` / `src/lib/builtin-tools/index.ts` / `src/lib/builtin-tools/notification.ts` / `src/lib/widget-guidelines.ts` / `src/lib/memory-extractor.ts` / `src/lib/workspace-indexer.ts` / `src/lib/workspace-config.ts` / `src/lib/harness/runtime-adapter.ts` / `src/lib/harness/capability-contract.ts` / `src/lib/harness/capability-matrix.ts` / `src/lib/harness/mutation-level.ts` / `src/lib/harness/context-compiler.ts` / `src/lib/harness/capability-display-text.ts` 中 `BuddyData` / `STAT_NAMES` / `AssistantWorkspaceSection` / `assistant_workspace_path` 等引用，逐个改写到 bbagent 命名空间
- [ ] M4.3 Bridge adapter（`src/lib/bridge/adapters/qq-adapter.ts` / `qq-api.ts`）中的 assistant 触发 import 改写
- [ ] M4.4 `src/app/api/settings/workspace/route.ts` 中关于 `assistant_workspace_path` 的 PATCH/GET 移除（如未在 M2.6 完成）
- [ ] M4.5 `src/components/chat/MessageList.tsx` / `MessageItem.tsx` / `WidgetRenderer.tsx` / `TaskRunMarker.tsx` / `ChatView.tsx` / `ChatEmptyState.tsx` 中 show-widget buddy card 渲染 → 改 `import { ... } from '@/components/bbagent/AssistantOnboardingWizard'` 或保持 widget HTML 不动
- [ ] M4.6 旧的兼容 re-export / 旧 key alias 在 M4 末尾删除（不沿留 1 release——CLAUDE.md 强调"提交前必须详尽测试"，多保留一份兼容桥就多一份漂移风险；保留仅在 M2.7 路由层做 1 release rewrite）
- [ ] M4.7 静态守卫：新增 `scripts/bbagent-assistant-import-guard.mjs`（CI hook），拦截对 `@/lib/assistant-workspace` / `@/lib/buddy` / `@/lib/heartbeat` / `@/lib/assistant-heartbeat` / `@/lib/assistant-default-workspace` 的新引用，错误信息指向 bbagent 命名空间

### Phase M5 — 验证

- [ ] M5.1 `npm run test`（typecheck + 全量单元测试）
- [ ] M5.2 `node scripts/bbagent-assistant-import-guard.mjs` 自检通过
- [ ] M5.3 起一次 `npm run dev`，手动设 flag `personalAssistant:true`（仅内存级 flag；测试完毕不提交）→ 确认 wizard / hatch-buddy / heartbeat reconcile / evolution 仍能工作（Tier 2 smoke）
- [ ] M5.4 flag 默认 false，确认 Settings 不再出现 assistant 页、侧栏无入口、所有 wizard/buddy UI 隐藏（无残留）
- [ ] M5.5 修改 README 索引：handover 新增 `docs/handover/bb-agent-assistant-workspace.md` 与 insight `docs/insights/bb-agent-assistant-workspace.md`，互相反向链接到 `docs/research/buckyball-ai-design.md`
- [ ] M5.6 把本计划移到 `completed/`

## 决策日志

- 2026-09-04: 用户决策——"专门为 bb 打造的 agent 助手了，再增加一个个人助手挺别扭"。把整个个人助手栈合并入 `bbagent/assistant/`，由 BB Agent 接管。
- 2026-09-04: 旧 `.assistant/` 数据保留（用户明确指示），flag `personalAssistant:false` 不改默认；目的是回收代码、统一接口、便于回滚。
- 2026-09-04: 重命名原则——迁入 `bbagent/assistant/*` 后，前缀全部 `BbAssistant*` / `BbBuddy*` / `BbHeartbeat*`；旧路径仅在 M2.7 路由层保留 1 release rewrite，不在 lib 层留 alias（避免双轨漂移）。
- 2026-09-04: 旧 i18n key 全部加 `bbagent.assistant.*` 命名空间，**M4.6 末尾统一切换并删旧 key**——不做 1 release 双轨，与决策一致。
- 2026-09-04: 守卫选用 `scripts/bbagent-assistant-import-guard.mjs`（不引入 lint plugin），用 CI hook + pre-commit 拦截旧路径新增引用。
- 2026-09-04: 不动 `bbagent/prompt-injector.ts` / `bbagent/mcp-injector.ts` / `bbagent/skill-injector.ts` 已落地的三注入点；本计划是"迁助手，不重做注入"。
- 2026-09-04: Bridge `qq-adapter.ts` 触发 assistant 部分暂时指向 `bbagent/assistant/*`——但保留下游调用的兼容（QQ 场景不验证 wizard 端到端，只保证 import 不报错）。

## Smoke Ledger

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _示例_ | native_runtime | OpenRouter | claude-haiku-4.5 | API key | 临时开 flag=true → wizard → hatch-buddy → heartbeat reconcile | 📋 | _Phase M5.3 后补_ |
| _示例_ | n/a | n/a | n/a | n/a | flag=false → Settings / 侧栏入口检查 | 📋 | _Phase M5.4 后补_ |

## 风险与开放问题

| 风险 | 缓解 |
|------|------|
| 大量引用 grep 漏改（30+ files） | M4.2 一次性 grep 出全表，每条 commit PR；M4.7 守卫拦截新增；M5.1 typecheck 全量回归 |
| `OnboardingWizard` 的 3 步表单 + buddy reveal UI 复杂，迁移极易回归 | M3.2 单独 PR；M5.3 真实浏览器走查 |
| 旧 i18n key 多语言切换（zh / en）不一致 | M3.8 一次性切换 + M5.1 typecheck 失败兜底 |
| `AssistantAvatar` 全工程 30+ 引用，原地保留名字可能让团队误以为是上游组件 | M3.3 迁名 + 注记 |
| CodePilot 上游 master 仍然保留这些文件（fork 隔离问题） | 上游对齐可在未来 PR 中按需 cherry-pick；本计划只动本 fork |

## 文档反向链接

- 设计文档：[docs/research/buckyball-ai-design.md](../research/buckyball-ai-design.md)
- 上游计划：[active/bbdev-skill-integration.md](./bbdev-skill-integration.md)
- 关联计划：[active/image-generation-cleanup.md](./image-generation-cleanup.md)
- 旧计划（completed）：[completed/assistant-workspace.md](../completed/assistant-workspace.md) — 历史执行日志，新决策不与它对齐
