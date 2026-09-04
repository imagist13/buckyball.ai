# bbagent 注入层与 bbdev Skill 集成

> 创建时间：2026-08-31
> 最后更新：2026-09-03

## 背景与目标

`docs/research/buckyball-ai-design.md` §3 把"为三种 Runtime 注入 skill 与提示词"定为 buckyball.ai 的**核心魔改点**。本计划负责把这条注入层落成可交付的代码：

- 三 Runtime（Native / Claude Code / Codex）的 MCP 注入。
- bbdev Skill 的 fork-style 写入（`.claude/skills/` 与 `.agents/skills/`）。
- Native 路径下 system prompt fragment 拼装。
- 持久化路径从 `~/.codepilot/` 切到 `~/.buckyball/`。
- 图像生成与个人助手的 feature flag 隐藏。

定位变化（2026-09-03）：
- 旧方案把 bbdev 当作 CodePilot 的"垂直领域定制版"；
- 新方案把 buckyball.ai 定位为 **CodePilot 二开 fork**，核心魔改集中在 `src/lib/bbagent/` 注入层，bbdev 不再独立 Runtime。详见 [docs/research/buckyball-ai-design.md](../research/buckyball-ai-design.md)。

## 用户能看到什么

**Phase 1 完成后：**
- Native Runtime 上下文执行 bbdev 操作（编译器、仿真、校验、综合），UI 显示在 bbdev 工具卡片。
- 在 Claude Code / Codex 会话中输入 `/bbdev` 或 `use bbdev skill`，AI 启动 fork 子 Agent 调 bbdev 工具。
- 用 `package.json` `productName: "buckyball.ai"` 启动后，应用名 / 关于页显示 buckyball.ai。

**Phase 2 完成后：**
- 用户数据目录迁移到 `~/.buckyball/`，旧 `~/.codepilot/` 自动迁移并保留 INFO 日志。
- 图像生成 / 个人助手入口在 UI 默认隐藏，但旧数据保留。

**明确不做的：**
- Waveform Viewer（VCD 可视化）—— 后续 Phase
- bbdev 远程服务器（v0 阶段只支持本地 stdio）
- 多芯片并行仿真
- 删除图像生成 / 个人助手代码（仅 feature flag 隐藏）

## 状态总览

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 1 | bbdev MCP 工具封装层 + Native Runtime 集成 + 工具卡片 | ✅ 已完成 | 本次实施 |
| Phase 2 | bbdev Skill 生成器 + Skill 注册 | ✅ 已完成 | 本次实施 |
| Phase 3 | Claude Code / Codex fork 模式接入 + 工具限制 | ✅ 已完成 | 本次实施 |
| Phase 4 | bbagent 注入层骨架（MCP / Skill / Prompt 三注入点合一） | 📋 待开始 | 新增，本计划主线 |
| Phase 5 | bbdev Panel UI + 设置页面 | 📋 待开始 | 后续 |
| Phase 6 | 持久化路径迁移 `~/.codepilot/` → `~/.buckyball/` | 📋 待开始 | 新增 |
| Phase 7 | 图像生成 / 个人助手 flag 隐藏入口 | ✅ 已完成 | 仅 UI 入口 / 路由 410 / seed 关闭；代码 / 测试 / 文案全清分别由 [image-generation-cleanup.md](./image-generation-cleanup.md) 与 [assistant-merge-into-bbagent.md](./assistant-merge-into-bbagent.md) 接管 |
| Phase 8 | 验证与文档 | 🔄 部分 | 待续 |

## 执行清单

### Phase 1 — Native MCP 集成（已完成）

- [x] 1.1 创建 `src/lib/bbdev/connection.ts`（local stdio + 远程 SSE 占位）
- [x] 1.2 创建 `src/lib/bbdev/task-tracker.ts`（trace_id 轮询、状态持久化）
- [x] 1.3 创建 `src/lib/bbdev/types.ts`（BbdevToolName / BbdevArgs / BbdevResult）
- [x] 1.4 创建 `src/lib/bbdev/mcp-bridge.ts`（MCP 协议封装 + 任务分发）
- [x] 1.5 扩展 `McpConnectionManager` 注册 bbdev 连接（`getBbdevMcpServerConfig()` + agent-loop 注入）
- [x] 1.6 扩展 Native Runtime 注入 bbdev 工具到 agent loop（`agent-loop.ts` 在 `syncMcpConnections` 前注入 bbdev 服务）

### Phase 2 — Skill 生成器（已完成）

- [x] 2.1 创建 `src/lib/bbdev/skill-generator.ts`（生成 bbdev SkillDefinition）
- [x] 2.2 创建 `src/lib/bbdev/skill-registry.ts`（注册/反注册）
- [x] 2.3 写入临时 SKILL.md 到 `<repoRoot>/.claude/skills/bbdev/SKILL.md`（同时写 `.agents/skills/` 兼容 Codex）
- [x] 2.4 调用 `invalidateSkillCache()` 触发重新扫描

### Phase 3 — Fork 模式接入（已完成）

- [x] 3.1 扩展 `skill-executor.ts` 支持 bbdev Skill（structured fork envelope + trace_id hint）
- [x] 3.2 Claude Code Runtime 检测 bbdev Skill 并 fork 子 Agent（依赖 SKILL.md frontmatter，零运行时代码）
- [x] 3.3 Codex Runtime 透传 bbdev Skill（`.agents/skills/` 路径由 Codex 原生读取，零运行时代码）

### Phase 4 — bbagent 注入层（新增，本计划主线）

- [ ] 4.1 创建 `src/lib/bbagent/types.ts`（BbContext / BbRuntimeKind / BbInjectConfig）
- [ ] 4.2 创建 `src/lib/bbagent/context-store.ts`（chip 选择 / 远程 URL 全局单例）
- [ ] 4.3 创建 `src/lib/bbagent/mcp-injector.ts`（按 runtime 调用不同注入函数）
  - [ ] 4.3.1 `injectIntoNative(agent-loop)`：在 `syncMcpConnections` 前注册 bbdev
  - [ ] 4.3.2 `injectIntoClaude(client)`：启动时把 bbdev MCP 写入 session `mcpServers`
  - [ ] 4.3.3 `injectIntoCodex(runtime)`：per-thread `config.mcp_servers` 注入
- [ ] 4.4 创建 `src/lib/bbagent/skill-injector.ts`：把现有 `bbdev/skill-registry.ts` 逻辑搬入，加 `applyToRuntimes()` 顶层调用
- [ ] 4.5 创建 `src/lib/bbagent/prompt-injector.ts`：拼 BB system prompt fragment，注入 Native agent-loop `buildMessages`
- [ ] 4.6 创建 `src/lib/bbagent/features.ts`（BB_FEATURES 单例 feature flag）
- [ ] 4.7 在三 Runtime 文件调一行 `applyBbInjection(...)`，不侵入 Runtime 内部

### Phase 5 — bbdev Panel UI

- [ ] 5.1 创建 `src/components/bbdev/BbdevPanel.tsx`
- [ ] 5.2 创建 `src/components/bbdev/ChipSelector.tsx`
- [ ] 5.3 创建 `src/components/bbdev/TaskList.tsx`
- [ ] 5.4 创建 `src/components/chat/BbdevToolCard.tsx`
- [ ] 5.5 创建 `src/components/settings/BbdevSettings.tsx`
- [ ] 5.6 扩展 `WorkspaceSidebar` 接入 bbdev Panel
- [ ] 5.7 扩展 `SettingsPanel` 接入 bbdev 设置
- [ ] 5.8 i18n 同步 en.ts + zh.ts

### Phase 6 — 持久化路径迁移

- [ ] 6.1 创建 `src/lib/bbagent/paths.ts` 暴露 `resolveBuckyballDataDir()`，env var `BUCKYBALL_DATA_DIR` 优先
- [ ] 6.2 `src/lib/codepilot-data-dir.ts` 改为薄壳，内部调新函数（保留旧 API 两个 release）
- [ ] 6.3 `src/lib/image-generator.ts` 的 `MEDIA_DIR` 常量改 `.buckyball-media`
- [ ] 6.4 `package.json` `productName: "buckyball.ai"`，`name: "buckyball"`
- [ ] 6.5 启动时 `~/.codepilot/` → `~/.buckyball/` 一次性迁移（双写双读 Phase 1 → 只读新路径 Phase 2）
- [ ] 6.6 迁移日志写 Sentry breadcrumb

### Phase 7 — 图像生成 / 个人助手 feature flag 隐藏

- [x] 7.1 `src/lib/bbagent/features.ts` 加 `BB_FEATURES.imageGeneration / personalAssistant = false`
- [x] 7.2 `/api/media/generate/route.ts` 入口校验 false → 410 Gone
- [x] 7.3 `src/components/chat/*` 隐藏图像生成按钮（按 flag）
- [x] 7.4 `src/components/settings/*` 隐藏个人助手入口（按 flag）
- [x] 7.5 `src/lib/assistant-workspace.ts` 不再自动 seed
- [x] 7.6 i18n 加 `media.disabledNotice` / `assistant.disabledNotice` 文案

> Phase 7 仅做"隐藏"。"图像生成代码清理"由 [active/image-generation-cleanup.md](./image-generation-cleanup.md) 接管（路由 / 实现 / UI / provider catalog 全删）；"个人助手合并入 bbagent"由 [active/assistant-merge-into-bbagent.md](./assistant-merge-into-bbagent.md) 接管（迁入 `bbagent/assistant/`，由 BB Agent 接管产物）。

### Phase 8 — 验证与文档

- [x] 8.1 单元测试：connection / task-tracker / skill-generator / skill-registry（35 通过 + 2 Windows-skip）
- [ ] 8.2 单元测试：bbagent 各注入器（mock 三 Runtime）
- [ ] 8.3 集成测试：Native → bbagent → bbdev MCP → mock 服务
- [ ] 8.4 Smoke：本地 toy chip 全链路 build/sim/verify
- [ ] 8.5 迁移 smoke：旧 `~/.codepilot/` → `~/.buckyball/` 数据完整性
- [ ] 8.6 UI 验证：bbdev Panel + 图像生成 / 个人助手隐藏后无 UI 残留
- [ ] 8.7 编写 `docs/handover/bb-agent-injection.md`（已建）
- [ ] 8.8 编写 `docs/insights/bb-agent-injection.md`（已建）

## 决策日志

- 2026-08-31: 创建执行计划。三 Runtime 通过 Skill 系统统一入口，避免各自实现工具桥接。
- 2026-08-31: bbdev Skill 用 fork 模式 + allowed-tools 限制，避免子 Agent 误用其他工具。
- 2026-08-31: v0 阶段只支持本地 stdio，远程 bbdev 服务器作为 Phase 2+ 留白。
- 2026-09-03: bbdev MCP 服务在 `agent-loop.ts` 中**总是注入**（不依赖用户传入 mcpServers），避免误把系统级 bbdev 当会话级 MCP 看待。
- 2026-09-03: Skill 同时写到 `.claude/skills/` 和 `.agents/skills/`，Codex Runtime 无需额外注册即可识别。
- 2026-09-03: Phase 3 三个子项均通过 SKILL.md frontmatter 完成（Claude Code / Codex 原生支持 `context: fork` + `allowed-tools`），不需要写新的运行时代码——这就是 Skill 系统的预期形态。
- 2026-09-03: 测试：35 通过 + 2 Windows-skip（bbdev-connection / bbdev-task-tracker / bbdev-skill-generator / bbdev-skill-registry 全套 + skill 回归 57 通过）。typecheck 通过（仅有 buckyball 子项目遗留 motia.config.ts 错误，与本次改动无关）。
- 2026-09-03: **定位重写**：buckyball.ai 从"CodePilot 垂直定制版"改为"CodePilot 二开 fork"，核心魔改为 bbagent 注入层（MCP / Skill / Prompt 三注入点），bbdev 不再独立 Runtime。新增 Phase 4（bbagent 注入层）/ 6（持久化迁移）/ 7（feature flag 隐藏）。新增交接文档 `docs/handover/bb-agent-injection.md` 与思考文档 `docs/insights/bb-agent-injection.md`，互相反向链接到设计文档。
- 2026-09-04: **用户决策：图像生成全删**。与个人助手"合并入 bbagent"不同——图像不被 BB Agent 业务使用，直接清代码。隐藏层（flag / 410）保留，代码清理由 [active/image-generation-cleanup.md](./image-generation-cleanup.md) 接管。本计划 Phase 7 状态由"待开始"改为"已完成（隐藏层）"。
- 2026-09-04: **用户决策：把个人助手合并入 bbagent**。"专门为 bb 打造的 agent 助手了，再增加一个个人助手挺别扭"——整个 `assistant-workspace.ts` / `buddy.ts` / `heartbeat.ts` / `OnboardingWizard` + 全部 API / UI / tests / i18n 迁入 `src/lib/bbagent/assistant/`，由 BB Agent 接管产物。旧 `.assistant/` 数据保留。合并工作由 [active/assistant-merge-into-bbagent.md](./assistant-merge-into-bbagent.md) 接管，本计划 Phase 7 中"个人助手隐藏"子项随之前移。
- 2026-09-04: 计划索引同步——`docs/exec-plans/README.md` 索引表新增两条 active 计划行；bbdev-skill-integration 计划 Phase 7 拆段、决策日志追加两条；与 assistant-merge / image-generation-cleanup 形成上游 ↔ 关联关系。

## Smoke Ledger

| Date | Runtime | Provider | Model | 凭据形态 | 场景 | Result | Evidence |
|------|---------|----------|-------|---------|------|--------|----------|
| _示例_ | native_runtime | OpenRouter | claude-haiku-4.5 | API key | bbdev compile toy | ✅ | trace_id / logs |
| _待补_ | native_runtime | OpenRouter | claude-haiku-4.5 | API key | bbagent 注入 + toy chip build | 📋 | Phase 4 后补 |
| _待补_ | claude_code | Claude API | sonnet-4.5 | API key | fork bbdev Skill + validate | 📋 | Phase 4 后补 |
| _待补_ | codex | ChatGPT OAuth | gpt-5-codex | OAuth | per-thread mcp + bbdev compile | 📋 | Phase 4 后补 |
| _待补_ | n/a | n/a | n/a | n/a | `~/.codepilot/` → `~/.buckyball/` 迁移一致性 | 📋 | Phase 6 后补 |

## 风险与开放问题

| 风险 | 缓解 |
|------|------|
| Codex 自身 Skill 机制未必与 fork 模式兼容 | Phase 3 验证后调整 |
| bbdev 工具超过 30 个，allowed-tools 列表较长 | 后续考虑通配符或动态注入 |
| MCP stdio 进程管理（生命周期、崩溃恢复） | 复用现有 McpConnectionManager |
| fork 后上游 CodePilot 升级困难 | bbagent 集中改动；Runtime 改造点用一行函数调用 |
| 图像生成 / 个人助手 feature flag 默认 false 时隐藏力度 | UI 入口 + 路由 410 双层 |
| 旧 `~/.codepilot/` 数据迁移一致性 | Phase 1 双写双读，Phase 2 只读新路径，日志写 Sentry |

## 文档反向链接

- 设计文档：[docs/research/buckyball-ai-design.md](../research/buckyball-ai-design.md)
- 交接文档：[docs/handover/bb-agent-injection.md](../handover/bb-agent-injection.md)
- 思考文档：[docs/insights/bb-agent-injection.md](../insights/bb-agent-injection.md)
- 旧方案（superseded）：[docs/research/chatnpu-design-proposal.md](../research/chatnpu-design-proposal.md)
