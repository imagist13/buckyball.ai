# buckyball.ai 设计方案

> CodePilot 二开（fork）+ 改名为 buckyball.ai，核心魔改 = 为三种 Runtime 注入 skill 与提示词。

## 1. 项目定位

**buckyball.ai** 是 CodePilot 的二开 fork：保留 CodePilot 全部通用多模型 Agent 能力（含通用 Runtime 切换、Chat、Provider、Workspace、Plugins），在此之上魔改三件套——

1. **改名与品牌**：应用元数据（productName / 包名 / 图标 / 关于页）从 `codepilot` 改为 `buckyball.ai`。
2. **持久化路径切换**：所有用户数据从 `~/.codepilot/` 切到 `~/.buckyball/`；旧路径自动迁移一次后再也不写。
3. **Runtime 注入层（核心魔改点）**：在三 Runtime（Native / Claude Code / Codex）启动 / sendMessage / system prompt 拼装 / Skill 发现四个时点，注入 BB-specific 内容——
   - bbdev MCP server（local stdio / remote SSE）——硬件开发工具链；
   - 动态生成的 `bbdev` Skill Definition（写入 `.claude/skills/` 与 `.agents/skills/`）——让 Claude Code / Codex fork 时拿到受限工具集；
   - BB system prompt fragment（chip context + bbdev 工具概览 + 工作流约定）——Native 路径下拼到 `agent-loop.ts` 的 system prompt。

通用聊天是底层能力，不是产品定位：buckyball.ai 不再自居"通用 AI 助手"，但 Runtime 切换、Claude / Codex / Native / OpenAI-compatible / Grok 等通道全部保留，旧用户换皮即用。

### 核心边界

| 类别 | CodePilot（上游） | buckyball.ai（fork） |
|------|-------------------|----------------------|
| 通用多模型 Agent | ✅ 完整保留 | ✅ 同上，不动 |
| Runtime 切换（Native / Claude / Codex） | ✅ | ✅ |
| 通用聊天 UI / Workspace / Bridge / Plugins | ✅ | ✅ |
| 用户数据目录 | `~/.codepilot/` | `~/.buckyball/`（新装直接用；旧装一次性迁移） |
| 品牌 / 应用名 / productName | `codepilot` | `buckyball.ai` |
| bbdev MCP 注入 Native Runtime | ❌ | ✅ |
| 动态 bbdev Skill（fork 模式） | ❌ | ✅ |
| BB system prompt fragment | ❌ | ✅ |
| 图像生成（Gemini / GPT-image / Grok Imagine） | ✅ | ❌ 二开默认下线（feature flag off，路由入口隐藏，旧数据保留） |
| 个人助手（AssistantWorkspace / Buddy / Heartbeat） | ✅ | ❌ 二开默认下线（feature flag off，侧栏入口隐藏，旧数据保留） |
| 默认助理工作区（`~/.buckyball/.assistant/`） | 默认种子 | 不再自动 seed |

不做的事：
- **不复刻 CodePilot 的整条产品线**：二开只关心注入层和命名切换；不重写 Chat composer、不重做 Settings、不重做 Provider 治理。
- **不回改上游主线**：所有 fork 改动放在 `src/lib/bbagent/` 与少量根级元数据点，避免与 upstream drift 灾难。

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                buckyball.ai Desktop App                          │
│              (CodePilot fork, Electron + Next.js)               │
├─────────────────────────────────────────────────────────────────┤
│  Meta Layer                                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ productName: "buckyball.ai"  appId: buckyball.ai.*     │    │
│  │ env: BUCKYBALL_DATA_DIR (overrides ~/.buckyball)       │    │
│  └─────────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  bbagent Injection Layer (核心魔改)                              │
│  ┌───────────────┬──────────────────┬─────────────────────────┐  │
│  │ MCP Injector  │ Skill Injector   │ Prompt Injector         │  │
│  │ bbdev stdio/  │ bbdev SKILL.md   │ BB chip context +       │  │
│  │ SSE 服务注入  │ 写到 .claude/    │ bbdev 工具概览 +        │  │
│  │ Native agent  │ skills/ 与       │ 工作流 fragment         │  │
│  │ loop          │ .agents/skills/  │ Native system prompt    │  │
│  └───────────────┴──────────────────┴─────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  CodePilot 上游能力（保留）                                      │
│  ┌──────────────┬──────────────┬──────────────┬────────────┐    │
│  │ Chat UI      │ Workspace    │ Runtime      │ Provider   │    │
│  │ (通用聊天)   │ Sidebar      │ Selector     │ Manager    │    │
│  └──────────────┴──────────────┴──────────────┴────────────┘    │
│  ┌──────────────┬──────────────┬──────────────┬────────────┐    │
│  │ Native       │ Claude Code  │ Codex        │ Bridge     │    │
│  │ Runtime      │ Runtime      │ Runtime      │ (Telegram) │    │
│  └──────────────┴──────────────┴──────────────┴────────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  Persistence                                                       │
│  ~/.buckyball/                                                    │
│   ├── db.sqlite (CodePilot schema, 路径迁移)                      │
│   ├── .buckyball-media/                                           │
│   ├── .buckyball-logs/                                            │
│   ├── .assistant/ (存在但不再 seed；个人助手下线)                  │
│   └── media/  (历史图片资产保留但入口隐藏)                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Runtime 注入层（核心魔改）

### 3.1 三 Runtime × 三注入点

| 注入点 | Native Runtime | Claude Code Runtime | Codex Runtime |
|--------|----------------|---------------------|---------------|
| MCP 服务（bbdev） | `agent-loop.ts` 在 `syncMcpConnections` 前注入 bbdev stdio/SSE | `claude-client.ts` 启动时把 bbdev MCP 写入该会话的 `mcpServers` | `codex/runtime.ts` 通过 `config.mcp_servers` per-thread 注入 |
| Skill（bbdev） | Native 不读 SKILL.md，由 Prompt Injector 承担 | fork 模式 + `allowed-tools: [bbdev_*, validate]`（写到 `.claude/skills/bbdev/SKILL.md`） | 同上，复制到 `.agents/skills/bbdev/SKILL.md`，Codex 原生读取 |
| Prompt fragment | system prompt 拼接（`agent-loop.ts` buildMessages） | Claude SDK 接 system 字段 + 自定义 bbdev prefix | Codex `turn/start` 注入 `<bbdev_context>` 块（`instructions` / `config`） |

### 3.2 注入时点

| 时点 | 触发器 | 注入器 | 失败语义 |
|------|--------|--------|----------|
| App 启动 | `bootstrap()` | Skill Injector 写 SKILL.md + 触发 `invalidateSkillCache()` | 写失败 → 警告但不阻塞（fork 路径降级为 prompt-only） |
| 用户创建会话 / Runtime 选择 | `runtime-changed` | Prompt Injector 拼装 chip context | 拼装失败 → 普通 chat 模式（BB context 为空） |
| Native Runtime `agent-loop` 启动 | `syncMcpConnections` | MCP Injector 注册 bbdev 服务 | stdio 失败 → UI 顶部 banner "bbdev 离线"，不影响 chat |
| Claude Code Runtime 启动 | `claude-client.ts` 启动 fork | MCP Injector 把 bbdev 写入 session `mcpServers` | 失败 → 退化为无 bbdev MCP 的普通 Claude Code |
| Codex Runtime `turn/start` | `codex/runtime.ts` | MCP Injector per-thread `config.mcp_servers` | 失败 → Codex 原生 mcp-status 通知，不阻塞 turn |

### 3.3 注入内容契约

**BB chip context（最小 schema）**
```ts
interface BbContext {
  chip: string;             // 当前 chip 名（toy / pebble / ...）
  balldomain?: string;      // 可选
  repoRoot: string;         // buckyball 仓库根
  remoteUrl?: string;       // 远程 bbdev 服务（SSE 时存在）
}
```

**bbdev Skill frontmatter（写到 SKILL.md）**
```yaml
---
name: bbdev
description: Buckyball DSA 硬件开发工具
allowed-tools:
  - bbdev_compiler_*
  - bbdev_workload_*
  - bbdev_bemu_*
  - bbdev_bebop_verilator_*
  - bbdev_yosys_*
  - bbdev_dc_*
  - bbdev_uvm_*
  - bbdev_task_status
  - validate
context: fork
---
```

**BB system prompt fragment（Native 拼接）**
```
[BB CONTEXT]
当前 chip: ${chip}（${balldomain ?? '未选 balldomain'}）
仓库根: ${repoRoot}
远程模式: ${remoteUrl ?? 'local stdio'}

[可用工具]
bbdev_* —— 见上文 bbdev Skill 工具集；validate(chip, balldomain?) 用于快速设计校验。

[工作流约定]
1. 改 Ball 代码 → validate → compiler_build
2. 仿真优先 BEMU（10–100× 快于 Verilator）
3. 长任务用 bbdev_task_status(trace_id) 轮询，不要阻塞
```

### 3.4 注入器源码骨架（`src/lib/bbagent/`）

```
src/lib/bbagent/
├── types.ts            # BbContext / BbInjectConfig / BbRuntimeKind
├── mcp-injector.ts     # 三 Runtime 的 MCP 服务注入（Native / Claude / Codex 各自一个 inject 函数）
├── skill-injector.ts   # 写 SKILL.md 到 .claude/skills/ 与 .agents/skills/，触发 cache invalidate
├── prompt-injector.ts  # Native 拼 system prompt；Claude/Codex 注入 instructions/config 字段
├── context-store.ts    # 全局单例 BbContext（chip 选择 / 远程 URL）
├── features.ts         # feature flag：图像生成 / 个人助手的开关（默认 false）
└── paths.ts            # ~/.buckyball/ 解析（替代 codepilot-data-dir.ts）
```

各注入器只依赖 `BB_INJECTION_INTERFACE`（即 bbagent 内导出），与 Runtime 实现解耦；Runtime 改造点在各自文件（如 `src/lib/agent-loop.ts`、`src/lib/claude-client.ts`、`src/lib/codex/runtime.ts`）调一行 `applyBbInjection(...)`，不在 Runtime 内部硬编码 BB 细节。

---

## 4. 持久化路径迁移

### 4.1 单一来源（替换 `src/lib/codepilot-data-dir.ts`）

```ts
// src/lib/bbagent/paths.ts —— 替代旧 codepilot-data-dir.ts
export function resolveBuckyballDataDir(
  env: { BUCKYBALL_DATA_DIR?: string } = process.env as any,
  homeDirectory = os.homedir(),
): string {
  const configured = env.BUCKYBALL_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(homeDirectory, '.buckyball');
}
```

旧函数 `resolveCodePilotDataDir` 保留为内部 alias，**内部全部改调 `resolveBuckyballDataDir`**。保留 env override 但改名 `CLAUDE_GUI_DATA_DIR` → `BUCKYBALL_DATA_DIR`（旧变量继续生效两个版本，再删除）。

### 4.2 子目录命名同步

| 旧 | 新 |
|----|----|
| `~/.codepilot/.codepilot-media/` | `~/.buckyball/.buckyball-media/` |
| `~/.codepilot/logs/` | `~/.buckyball/.buckyball-logs/` |
| `~/.codepilot/.assistant/`（仍存在但不再 seed） | `~/.buckyball/.assistant/` |

media dir 命名同步切换（`image-generator.ts` 的 `MEDIA_DIR` 常量）；旧路径在启动时一次性迁移到新路径，迁移日志写 Sentry breadcrumb。

### 4.3 旧 `codepilot-data-dir.ts` 路径处理

- Phase 1：**双写 + 双读**——同时检查新路径与旧路径；新写只写新路径；读取命中旧路径则复制到新路径后返回。
- Phase 2：**只读新路径**——启动时若新路径不存在且旧路径存在，自动迁移整个目录并打 INFO 日志。
- Phase N：删除旧 alias；`CLAUDE_GUI_DATA_DIR` env var 不再兼容。

---

## 5. 砍掉的功能（图像生成 / 个人助手）

### 5.1 图像生成（`src/lib/image-generator.ts` + `src/lib/image-gen-mcp.ts` + `src/lib/xai-imagine.ts` + `src/app/api/media/generate/route.ts`）

- **不删代码**：保留完整实现，避免破坏旧数据与回归测试。
- **路由默认 404**：在 `src/lib/bbagent/features.ts` 加 `BUCKYBALL_FEATURE_IMAGE_GEN = false`；`/api/media/generate` 路由入口处校验，false 直接返回 410 Gone。
- **UI 入口隐藏**：图像生成按钮（Composer / Chat message action / Settings 媒体项）按 feature flag 隐藏。
- **数据保留**：旧 `~/.buckyball/.buckyball-media/` 文件保留，但 UI Gallery 不再展示。
- **i18n**：增加 `media.disabledNotice` 文案，避免出现"按钮消失但无解释"。

### 5.2 个人助手（`src/lib/assistant-workspace.ts` + `src/lib/assistant-default-workspace.ts` + `src/lib/assistant-heartbeat.ts` + Buddy / Heartbeat 全部）

- **不删代码**：保留实现以维持旧数据兼容（用户已有 assistant 目录不丢）。
- **入口全部隐藏**：Onboarding Setup Center 的 assistant 卡片、左侧栏 Assistant Tab、Settings 的 assistant 入口都按 feature flag 隐藏。
- **Heartbeat 关停**：默认 assistant 不再被自动 seed；`assistant-workspace.ts` 启动时若 `~/.buckyball/.assistant/` 不存在则不创建。
- **保留只读访问**：用户从旧 CodePilot 迁移过来的 assistant 目录仍可通过"高级 → 个人助手（实验）"开关打开（feature flag override），但不进入默认体验。

### 5.3 Feature flag 出口

`src/lib/bbagent/features.ts` 是所有"二开 vs 上游"差异的单一开关入口：
```ts
export const BB_FEATURES = {
  bbdev: true,            // 二开默认开启
  imageGeneration: false, // 二开默认关闭
  personalAssistant: false,// 二开默认关闭
} as const;
```

---

## 6. 保留的旧功能（不删，仅确认不再扩展）

- **多 Runtime 切换**（Native / Claude Code / Codex）——通用聊天能力的核心。
- **Provider 管理** —— GLM / Kimi / GPT / Claude / DeepSeek / Grok / OpenAI-compatible 全保留。
- **Workspace Sidebar** —— 文件 / Git / Browser / Surface 全保留。
- **Plugins（Skill / MCP / CLI）** —— 用户自行加载的能力保留；bbdev 作为预置 fork-style Skill 注入。
- **Bridge（Telegram）** —— 远程控制通用会话。
- **Markdown Live Preview / Artifact / Dashboard / Widget** —— 全部保留。
- **Sentry 匿名遥测 / 自动更新 / CLI maintenance** —— 全部保留。

旧版通用聊天定位 = 上面的"保留集合"，二开版只负责"在保留集合上挂 BB 注入层 + 改名 + 砍两个非核心能力"。

---

## 7. 文件改动清单（本轮范围内）

### 新增

```
src/lib/bbagent/                     # 注入层核心
  ├── types.ts
  ├── paths.ts                       # 替代 codepilot-data-dir.ts
  ├── features.ts                    # feature flag
  ├── context-store.ts
  ├── mcp-injector.ts
  ├── skill-injector.ts
  └── prompt-injector.ts

src/lib/bbdev/                       # 已有（连接 / task / skill / mcp-bridge）
```

### 修改

```
package.json                         # productName: "buckyball.ai", name: "buckyball"
electron/main.ts (or equivalent)     # 应用 ID / brand strings
src/lib/codepilot-data-dir.ts        # 改为薄壳，内部调 resolveBuckyballDataDir
src/lib/image-generator.ts           # MEDIA_DIR 常量改 .buckyball-media
src/lib/image-gen-mcp.ts             # feature flag gate
src/app/api/media/generate/route.ts  # feature flag 410
src/components/chat/*                # 隐藏图像生成按钮（按 flag）
src/components/settings/*            # 隐藏个人助手入口（按 flag）
src/lib/assistant-workspace.ts       # 不再自动 seed
src/lib/agent-loop.ts                # 调 applyBbInjection（mcp + prompt）
src/lib/claude-client.ts             # 调 applyBbInjection（mcp）
src/lib/codex/runtime.ts             # 调 applyBbInjection（mcp + instructions）
src/i18n/{en,zh}.ts                  # 增加 media.disabledNotice / assistant.disabledNotice
```

### 删除候选（本轮不做，留给后续清理）

- `~/.codepilot/` 旧 alias 与 `CLAUDE_GUI_DATA_DIR` 旧 env（Phase N）
- 上游未启用的图像生成 / 助理 UI 残留（feature flag 永久 false 后再删）

---

## 8. 风险与边界

| 风险 | 缓解 |
|------|------|
| fork 后上游 CodePilot 升级困难 | 所有改动集中 `src/lib/bbagent/`；Runtime 改造点用一行函数调用，不侵入 |
| 旧用户 `~/.codepilot/` 数据迁移 | 启动时一次性迁移 + INFO 日志 + Sentry breadcrumb |
| 图像生成 / 个人助手的隐藏 ≠ 删除 | feature flag 默认 false；旧数据保留；用户能通过 override 重新打开 |
| bbdev MCP 注入失败导致 Native 卡死 | MCP Injector 失败只 banner，不影响 chat（详见 §3.2 失败语义） |
| Codex Runtime per-thread mcp_servers 行为漂移 | 由 `codex-mcp-injection-poc` 验证后落地；不冒进 |
| 旧 `codepilot-data-dir.ts` 别名长期保留 | 两个 release 周期后删除；本轮不动 |

---

## 9. 与历史方案的边界

| 历史方案 | 现状 |
|----------|------|
| `chatnpu-design-proposal.md`（旧 ChatNPU 命名、bbdev_runtime 独立 Runtime） | 已 superseded：bbdev 不再是独立 Runtime，而是通过 bbagent 注入层挂到 Native Runtime |
| `buckyball-ai-design.md`（v0，buckyball = CodePilot 垂直定制版） | 由本版本（v1，buckyball = CodePilot 二开 fork）取代 |

旧方案错把 buckyball 当"CodePilot 的一个垂直产品"。本版本定位更窄：**buckyball.ai 就是一个改了名字 + 挂了 BB 注入层的 CodePilot**，不重写上游能力。

---

## 10. 待办（拆给后续）

1. `src/lib/bbagent/` 骨架与 feature flag 落定 → Tier 1
2. MCP Injector 接入三 Runtime → Tier 2
3. Skill Injector 写 SKILL.md（已在 `src/lib/bbdev/skill-registry.ts` 实现雏形，需要搬入 `bbagent/skill-injector.ts`）→ Tier 1
4. Prompt Injector 接入 Native agent-loop → Tier 1
5. `~/.codepilot/` → `~/.buckyball/` 双写双读迁移 → Tier 2
6. 图像生成 / 个人助手隐藏 → Tier 0/1
7. package.json / electron productName 改名 → Tier 0
8. 真实 bbdev smoke（Native build → BEMU → validate）→ Tier 2

每项的 Smoke Ledger 写到 [docs/exec-plans/active/bbdev-skill-integration.md](../exec-plans/active/bbdev-skill-integration.md)。

---

> 技术实现见 [docs/handover/bb-agent-injection.md](../handover/bb-agent-injection.md)
> 产品思考见 [docs/insights/bb-agent-injection.md](../insights/bb-agent-injection.md)
