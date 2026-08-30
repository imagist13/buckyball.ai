# Skills / MCP / Completion 系统修复

**状态：** 已完成
**日期：** 2026-03-10
**关联调研：** `docs/research/skills-agent-sdk-review-2026-03-10.md`

## 问题概述

三个子系统存在多处 bug，部分为 P0（功能不可用）级别：

### 1. Skills 系统：Agent Skills 与 Slash Commands 混淆

**根因：** `CommandBadge.isSkill: boolean` 只区分"内置 vs 非内置"，无法区分 agent_skill / slash_command / sdk_command / codepilot_command 四种执行语义。

**症状：**
- Agent Skill 的 SKILL.md 被展开为用户消息发送，绕过 SDK 原生加载
- 用户补充上下文后 `/command` 本体丢失
- Popover 中无法区分不同类型的命令

### 2. MCP 管理：远程服务器创建失败 + 双文件读写不一致

**根因：**
- POST 校验要求 `command` 字段，但 SSE/HTTP 服务器用 `url` 字段
- GET 合并读取两个配置文件但 PUT 只写 settings.json
- DELETE 只检查 settings.json

### 3. Completion 处理：前端+后端双重执行 + 硬编码 localhost

**根因：**
- ChatView.tsx 和 route.ts 都处理 onboarding/checkin completion
- 后端通过 `fetch("http://localhost:${PORT}")` 回调自身 API

## 修改清单

### Phase 1: SkillKind 类型系统

| 文件 | 改动 |
|------|------|
| `src/types/index.ts` | 新增 `SkillKind` 类型；`MCPServerConfig.command` 改为可选 |
| `src/app/api/skills/route.ts` | `SkillFile` 增加 `kind` 字段，各扫描函数返回正确 kind |
| `src/app/api/skills/[name]/route.ts` | GET/PUT 响应包含 `kind` |

### Phase 2: MessageInput 核心修复

| 文件 | 改动 |
|------|------|
| `src/components/chat/MessageInput.tsx` | `isSkill` → `kind: SkillKind`；`handleSubmit` 按 kind 分流；Popover 分三组 |

分流逻辑：
- `agent_skill`: 发送 `Use the {name} skill. User context: {text}`，displayOverride 显示 `/name`
- `slash_command` / `sdk_command`: 发送 `/{command} {text}` 原样给 SDK
- `codepilot_command`: 展开 COMMAND_PROMPTS，displayOverride 显示 `/command`

### Phase 3: displayOverride 持久化链路

| 文件 | 改动 |
|------|------|
| `src/app/chat/page.tsx` | `sendFirstMessage` 接受 displayOverride 参数 |
| `src/app/api/chat/route.ts` | 提取 displayOverride，DB 存储用 displayOverride |
| `src/components/chat/ChatView.tsx` | 传递 displayOverride 到 startStream |
| `src/lib/stream-session-manager.ts` | StartStreamParams 增加 displayOverride |

### Phase 4: MCP 双文件管理

| 文件 | 改动 |
|------|------|
| `src/app/api/plugins/mcp/route.ts` | POST 支持 SSE/HTTP；PUT 按 `_source` 分流写入；POST 检查双文件同名 |
| `src/app/api/plugins/mcp/[name]/route.ts` | DELETE 检查双文件 |
| `src/components/plugins/McpManager.tsx` | `MCPServerWithSource` 类型；保留 `_source` 标记 |
| `src/components/plugins/McpServerEditor.tsx` | 远程服务器不生成空 command |

### Phase 5: SDK Init 元数据转发

| 文件 | 改动 |
|------|------|
| `src/lib/claude-client.ts` | system:init 转发 slash_commands/skills |
| `src/hooks/useSSEStream.ts` | 新增 `onInitMeta` 回调 |
| `src/lib/provider-resolver.ts` | `settingSources` 始终包含 `'user'` |

### Phase 6: Completion 去重 + 去 localhost

| 文件 | 改动 |
|------|------|
| `src/lib/onboarding-processor.ts` | **新增** — 从 onboarding route 提取核心逻辑 |
| `src/lib/checkin-processor.ts` | **新增** — 从 checkin route 提取核心逻辑 |
| `src/app/api/workspace/onboarding/route.ts` | 委托给 processOnboarding() |
| `src/app/api/workspace/checkin/route.ts` | 委托给 processCheckin() |
| `src/app/api/chat/route.ts` | processCompletionServerSide 直接调用处理函数，不走 HTTP |
| `src/components/chat/ChatView.tsx` | 删除 detectAssistantCompletion — 仅保留服务端路径 |

## 架构决策

1. **Completion 单路径**：仅在服务端 `collectStreamResponse` 的 `finally` 块中处理，前端不再参与。理由：服务端路径在所有场景下都会执行（包括页面刷新、解析失败），前端路径是多余的且引入竞态。

2. **处理函数直接导入**：`processOnboarding/processCheckin` 作为 lib 函数导出，route handler 和 completion detector 都直接调用，消除 HTTP 回调。

3. **幂等保护**：`processOnboarding` 检查 `state.onboardingComplete`，`processCheckin` 检查 `state.lastCheckInDate === today`，即使意外多次调用也不会产生副作用。

## 测试

- 289 个单元测试全部通过
- TypeScript 编译无错误
- CDP 验证：Popover 三组分类正确，MCP 远程服务器创建/删除正常，Console 无 error
