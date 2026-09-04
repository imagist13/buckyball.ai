# ChatNPU 设计方案

> **Archive note（2026-09-03）**：本文档已被 [buckyball-ai-design.md](./buckyball-ai-design.md) 取代。旧方案错把 buckyball 当作"CodePilot 的垂直领域定制版"，并提出新增独立 `bbdev_runtime`。新方案定位为 **CodePilot 二开 fork + 改名 + 在 Runtime 上注入 skill/提示词**，bbdev 不再是独立 Runtime，而是通过 `src/lib/bbagent/` 注入层挂到 Native Runtime。保留为历史参考。

---

# ChatNPU 设计方案

> 基于 CodePilot 的 Buckyball 专用 Agent 桌面客户端

## 1. 项目定位

**ChatNPU** 是 CodePilot 的垂直领域定制版本，专为 Buckyball DSA 开发框架设计。它将 CodePilot 的通用多模型 Agent 能力与 Buckyball 的硬件工具链深度集成，为芯片架构师和 DSA 开发者提供一站式 AI 辅助开发环境。

### 核心价值

| 维度 | CodePilot (通用) | ChatNPU (垂直) |
|------|------------------|----------------|
| 目标用户 | 各类 AI 开发者 | DSA/芯片开发者 |
| 工具链 | 通用开发工具 | Verilator/Yosys/编译器/仿真器 |
| 工作流 | 通用代码生成 | 硬件设计→仿真→验证 |
| 会话上下文 | 代码仓库 | Chip/Ball/Workload 上下文 |

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        ChatNPU Desktop App                       │
│                    (Electron + Next.js 16)                      │
├─────────────────────────────────────────────────────────────────┤
│  UI Layer (React 19 + Tailwind CSS 4)                          │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐    │
│  │ Chat     │ Workspace │ Chip     │ Ball      │ Settings │    │
│  │ (对话)   │ (文件树)  │ Browser  │ Editor    │ (配置)   │    │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘    │
├─────────────────────────────────────────────────────────────────┤
│  Runtime Layer (新增 bbdev_runtime)                             │
│  ┌──────────────┬──────────────┬──────────────┬────────────┐ │
│  │ claude_code  │ native       │ codex_proxy  │ bbdev ★NEW │ │
│  │ (保留)       │ (保留)        │ (保留)        │            │ │
│  └──────────────┴──────────────┴──────────────┴────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  MCP Integration Layer                                          │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ buckyball-dev MCP Server (Python)                         │  │
│  │  ├── validate         - Chip 校验                         │  │
│  │  ├── bbdev_*          - 编译/仿真/验证工具                 │  │
│  │  └── task_status      - 异步任务追踪                       │  │
│  └──────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────┤
│  bbdev API Layer (HTTP Client)                                  │
│  ┌──────────────┬──────────────┬──────────────┬────────────┐ │
│  │ /compiler/*  │ /workload/*  │ /bebop/*     │ /verilator │ │
│  └──────────────┴──────────────┴──────────────┴────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│  Motia Workflow Engine (Backend)                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ bbdev/api/  (当前作为 git submodule)                      │  │
│  │  - Python FastAPI                                         │  │
│  │  - Motia 工作流引擎                                       │  │
│  │  - iii/Chisel 工具链                                      │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

> **现状（被取代的差异）**：
> - bbdev 不再独立 Runtime；通过 `src/lib/bbagent/mcp-injector.ts` 注入到现有 Native Runtime。
> - Native Runtime 是 Native Agent Runtime（自建），不是 Codex proxy；保留 Claude Code + Codex Runtime + Native 三条线。
> - Motia / FastAPI 等后端不在二开范围（保持外部独立项目）。

## 11. 下一步行动

1. ~~评审方案 → 确认架构方向~~（已 superseded，行动清单作废）
2. ~~创建执行计划 → 分阶段实现~~（新执行计划见 [active/bbdev-skill-integration.md](../exec-plans/active/bbdev-skill-integration.md)）
3. 起 `src/lib/bbagent/` 骨架；Runtime 注入层按新版 [buckyball-ai-design.md](./buckyball-ai-design.md) §3 落地

---

> 技术实现见 [docs/handover/bb-agent-injection.md](../handover/bb-agent-injection.md)
