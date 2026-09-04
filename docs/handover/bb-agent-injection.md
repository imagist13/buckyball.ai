# bbagent 注入层技术交接

> 产品思考见 [docs/insights/bb-agent-injection.md](../insights/bb-agent-injection.md)

> 定位：**CodePilot 二开 fork** 的核心魔改点——`src/lib/bbagent/` 注入层。所有 BB-specific 改动集中在此目录，Runtime 改造点用一行函数调用，不侵入 Runtime 内部。

## 1. 目录结构

```
src/lib/bbagent/
├── types.ts            # BbContext / BbRuntimeKind / BbInjectConfig
├── paths.ts            # ~/.buckyball/ 路径解析（替代 codepilot-data-dir.ts 的实际工作）
├── features.ts         # BB_FEATURES 单例 feature flag（bbdev / image / assistant）
├── context-store.ts    # 全局单例 BbContext（chip 选择 / 远程 URL）
├── mcp-injector.ts     # 三 Runtime 的 MCP 服务注入（Native / Claude / Codex）
├── skill-injector.ts   # bbdev Skill 写入 .claude/skills/ 与 .agents/skills/
└── prompt-injector.ts  # Native 路径 system prompt fragment 拼装
```

`src/lib/bbdev/` 已有 connection / task-tracker / skill-generator / skill-registry / mcp-bridge / types 等工具实现；bbagent 不重复造轮子，只在 bbdev 之上做"按 runtime 注入"。

## 2. 关键类型

```ts
// src/lib/bbagent/types.ts
export type BbRuntimeKind = 'native' | 'claude_code' | 'codex';

export interface BbContext {
  chip: string;
  balldomain?: string;
  repoRoot: string;
  remoteUrl?: string; // SSE 模式存在
}

export interface BbInjectConfig {
  runtime: BbRuntimeKind;
  context: BbContext;
}
```

## 3. 三 Runtime 注入点

### 3.1 Native Runtime

文件：`src/lib/agent-loop.ts`

```ts
import { applyBbInjection } from '@/lib/bbagent';

// 在 syncMcpConnections 前
await applyBbInjection({ runtime: 'native', context: bbCtx });
```

- `mcp-injector.ts` 注册 bbdev stdio/SSE 到 `McpConnectionManager`。
- `prompt-injector.ts` 在 `buildMessages` 拼 system prompt fragment。

### 3.2 Claude Code Runtime

文件：`src/lib/claude-client.ts`

```ts
await applyBbInjection({ runtime: 'claude_code', context: bbCtx });
```

- `mcp-injector.ts` 启动 fork 时把 bbdev MCP 写入 session `mcpServers`。

### 3.3 Codex Runtime

文件：`src/lib/codex/runtime.ts`

```ts
await applyBbInjection({ runtime: 'codex', context: bbCtx });
```

- `mcp-injector.ts` 在 `turn/start` 通过 per-thread `config.mcp_servers` 注入。
- 失败语义：Codex 原生 `mcpServerStatus` 通知，不阻塞 turn。

## 4. 注入失败语义（详细）

| 时点 | 失败原因 | 处理 |
|------|----------|------|
| App 启动 | SKILL.md 写失败 | 警告但不阻塞，fork 路径降级为 prompt-only |
| 用户选 Runtime | chip context 拼装失败 | 普通 chat 模式（BB context 为空） |
| Native `syncMcpConnections` | stdio spawn 失败 | UI 顶部 banner "bbdev 离线"，不影响 chat |
| Claude fork 启动 | mcpServers 注入失败 | 退化为无 bbdev MCP 的普通 Claude Code |
| Codex `turn/start` | per-thread 注入失败 | Codex 原生 mcp-status 通知，不阻塞 turn |

## 5. Skill 注入细节

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

- 写到 `<repoRoot>/.claude/skills/bbdev/SKILL.md`（Claude Code fork 读取）。
- 同时写到 `<repoRoot>/.agents/skills/bbdev/SKILL.md`（Codex 原生读取）。
- 调 `invalidateSkillCache()` 触发重新扫描。

## 6. Prompt fragment（Native）

拼接位置：`src/lib/agent-loop.ts` `buildMessages` 的 system 字段。

```
[BB CONTEXT]
当前 chip: ${chip}（${balldomain ?? '未选 balldomain'}）
仓库根: ${repoRoot}
远程模式: ${remoteUrl ?? 'local stdio'}

[可用工具]
bbdev_* —— 编译 / 仿真 / 校验 / 综合；validate(chip, balldomain?) 快速设计校验。

[工作流约定]
1. 改 Ball 代码 → validate → compiler_build
2. 仿真优先 BEMU（10–100× 快于 Verilator）
3. 长任务用 bbdev_task_status(trace_id) 轮询
```

## 7. 持久化路径迁移

### 7.1 单一来源（`src/lib/bbagent/paths.ts`）

```ts
export function resolveBuckyballDataDir(
  env: { BUCKYBALL_DATA_DIR?: string } = process.env as any,
  homeDirectory = os.homedir(),
): string {
  const configured = env.BUCKYBALL_DATA_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(homeDirectory, '.buckyball');
}
```

### 7.2 旧 `codepilot-data-dir.ts` 处理

旧函数保留为薄壳，内部调 `resolveBuckyballDataDir`。旧 env `CLAUDE_GUI_DATA_DIR` 兼容两个 release 再删。

### 7.3 迁移阶段

- Phase 1：双写双读（同时检查新旧路径，新写只写新）。
- Phase 2：只读新路径（启动时一次性迁移旧目录）。
- Phase N：删除旧 alias。

### 7.4 子目录同步

| 旧 | 新 |
|----|----|
| `~/.codepilot/.codepilot-media/` | `~/.buckyball/.buckyball-media/` |
| `~/.codepilot/logs/` | `~/.buckyball/.buckyball-logs/` |

## 8. Feature flag（图像生成 / 个人助手下线）

`src/lib/bbagent/features.ts`：

```ts
export const BB_FEATURES = {
  bbdev: true,             // 二开默认开启
  imageGeneration: false,  // 二开默认关闭
  personalAssistant: false,// 二开默认关闭
} as const;
```

### 8.1 图像生成（不删代码）

- `/api/media/generate/route.ts`：false 时 410 Gone。
- Composer / Chat message action：按 flag 隐藏按钮。
- i18n：`media.disabledNotice` 文案。
- 旧 `~/.buckyball/.buckyball-media/` 保留。

### 8.2 个人助手（不删代码）

- Assistant Tab、Onboarding 卡片、Settings 入口：按 flag 隐藏。
- `assistant-workspace.ts` 启动时若 `.assistant/` 不存在则不创建。
- Heartbeat 关停：默认 assistant 不再自动 seed。
- i18n：`assistant.disabledNotice` 文案。

## 9. package.json / electron 改动

- `productName: "buckyball.ai"`
- `name: "buckyball"`
- Electron `appId` / `appName` 同步。
- 关于页 / 应用图标（如需本轮外）后置。

## 10. 关键不变量

- 所有 bbagent 调用对外只暴露 `applyBbInjection(...)` 一个入口；Runtime 改造点不超过 5 行。
- bbagent 自身不允许 import `src/lib/runtime/*` 之外的 Runtime 内部；Runtime 调用 bbagent，方向不变。
- feature flag 默认 false 的能力，旧数据保留；用户可手动 override 重启打开（实验性）。

## 11. 测试与验证

- `src/__tests__/unit/bbagent-*.test.ts`：mock 三 Runtime，验证注入调用与失败语义。
- 集成：Native → bbagent → bbdev MCP → mock 服务（已有 bbdev mcp-bridge 测试可复用）。
- Smoke：本地 toy chip 全链路 build / sim / verify；写入 Smoke Ledger。

详细步骤见 [docs/exec-plans/active/bbdev-skill-integration.md](../exec-plans/active/bbdev-skill-integration.md)。
