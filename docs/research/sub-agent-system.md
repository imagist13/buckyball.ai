# 子 Agent 系统深度调研

> 调研目标：了解 Claude Code、OpenCode、Codex、Craft Agents 的子 Agent 实现，为 CodePilot 脱离 SDK 后自建子 Agent 系统提供方案。

## 1. Claude Code AgentTool 完整实现细节

### 1.1 Agent 定义格式

Claude Code 的 Agent 定义有三种来源：

**BuiltInAgentDefinition（内置）：**
```typescript
interface BuiltInAgentDefinition {
  agentType: string            // 唯一标识，如 "Explore"、"Plan"
  whenToUse: string            // 描述何时使用（作为 tool description 的一部分）
  tools?: string[]             // 允许的工具列表，undefined 或 ['*'] 表示全部
  disallowedTools?: string[]   // 禁止的工具列表
  source: 'built-in'
  baseDir: 'built-in'
  model?: string               // 'inherit' 或具体模型名，如 'haiku'
  effort?: EffortValue         // 推理努力等级
  permissionMode?: PermissionMode  // 权限模式
  maxTurns?: number            // 最大对话轮数
  mcpServers?: AgentMcpServerSpec[]  // Agent 专属 MCP 服务器
  hooks?: HooksSettings        // Agent 专属 hooks
  skills?: string[]            // 预加载的 skill
  background?: boolean         // 是否默认后台运行
  memory?: 'user' | 'project' | 'local'  // 持久记忆范围
  isolation?: 'worktree' | 'remote'      // 隔离模式
  omitClaudeMd?: boolean       // 是否省略 CLAUDE.md
  getSystemPrompt: (params) => string    // 动态系统提示词
}
```

**CustomAgentDefinition（用户自定义，来自 Markdown frontmatter）：**
- 来自 `.claude/agents/*.md` 文件
- frontmatter 包含 name、description、tools、model、permissionMode 等
- markdown body 作为 system prompt
- source 可以是 userSettings / projectSettings / policySettings / flagSettings

**PluginAgentDefinition（插件提供）：**
- 来自 plugin 系统
- source: 'plugin'

### 1.2 内置 Agent 列表

| Agent | 用途 | 模型 | 关键工具限制 |
|-------|------|------|-------------|
| General Purpose | 通用多步骤任务 | inherit | 全部工具 |
| Explore | 代码搜索 | haiku | 只读，禁止编辑/写入/Agent |
| Plan | 规划模式 | inherit | 禁止编辑（仅.claude/plans可写） |
| Verification | 验证工具 | inherit | 实验性功能 |
| Claude Code Guide | 帮助引导 | inherit | 非 SDK 环境才加载 |
| Statusline Setup | 状态栏设置 | inherit | 仅非交互模式 |

### 1.3 AgentTool 调用机制

AgentTool 作为一个 LLM tool，暴露给父 Agent。输入参数：

```typescript
{
  description: string      // 3-5 词任务描述
  prompt: string           // 任务指令
  subagent_type?: string   // Agent 类型名（可选，fork 模式下省略）
  model?: 'sonnet' | 'opus' | 'haiku'  // 模型覆盖
  run_in_background?: boolean  // 后台运行
  isolation?: 'worktree' | 'remote'    // 隔离模式
  cwd?: string             // 工作目录覆盖
}
```

### 1.4 Context 隔离机制

**独立上下文：** 每个子 Agent 有完全独立的消息历史。父 Agent 的上下文不会传递给子 Agent（fork 模式除外）。

**System Prompt 构建：** 子 Agent 获得自己的 system prompt，包含：
- Agent 定义中的 systemPrompt
- 环境上下文（enhanceSystemPromptWithEnvDetails）
- 可选的 agent memory（持久记忆）
- 可选省略 CLAUDE.md（如 Explore agent）

**AsyncLocalStorage 隔离：** 使用 Node.js AsyncLocalStorage 隔离每个子 Agent 的上下文（agentId、subagentName 等），避免并发 Agent 之间的状态污染。

**Fork 模式（实验性）：** 
- 省略 subagent_type 时触发
- 子 Agent 继承父 Agent 的完整对话上下文和系统提示词
- 通过构造 byte-identical 的消息前缀实现 prompt cache 共享
- 防递归：检测 `<fork-boilerplate>` 标签防止子 fork 继续 fork

### 1.5 工具过滤

子 Agent 的工具经过多层过滤：

1. **ALL_AGENT_DISALLOWED_TOOLS** — 所有子 Agent 都不能用的工具（如自身不能再创建 Agent）
2. **CUSTOM_AGENT_DISALLOWED_TOOLS** — 仅自定义 Agent 不能用的额外工具
3. **ASYNC_AGENT_ALLOWED_TOOLS** — 异步 Agent 使用白名单模式
4. **Agent 定义中的 tools/disallowedTools** — 每个 Agent 自己的限制
5. MCP 工具始终对所有 Agent 可用

### 1.6 结果返回格式

```typescript
interface AgentToolResult {
  agentId: string
  agentType?: string
  content: Array<{ type: 'text'; text: string }>
  totalToolUseCount: number
  totalDurationMs: number
  totalTokens: number
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number | null
    cache_read_input_tokens: number | null
    // ...
  }
}
```

### 1.7 runAgent 核心流程

1. 初始化 Agent 专属 MCP 服务器
2. 解析 Agent 可用工具（resolveAgentTools）
3. 构建系统提示词
4. 创建独立的 agentId 和 AsyncLocalStorage 上下文
5. 调用 `query()` 发起 LLM 对话循环
6. 每个消息 yield 出去（async generator）
7. 完成后清理 MCP 服务器、hooks、shell tasks

## 2. OpenCode Agent 系统设计

### 2.1 Agent 定义

OpenCode 使用 Zod schema 定义 Agent：

```typescript
const Info = z.object({
  name: z.string(),
  description: z.string().optional(),
  mode: z.enum(["subagent", "primary", "all"]),
  native: z.boolean().optional(),
  hidden: z.boolean().optional(),
  topP: z.number().optional(),
  temperature: z.number().optional(),
  color: z.string().optional(),
  permission: PermissionNext.Ruleset,  // 权限规则集
  model: z.object({ modelID: string, providerID: string }).optional(),
  variant: z.string().optional(),
  prompt: z.string().optional(),
  options: z.record(z.string(), z.any()),
  steps: z.number().int().positive().optional(),
})
```

### 2.2 五种内置 Agent

| Agent | mode | 用途 | 权限特点 |
|-------|------|------|---------|
| build | primary | 默认执行 Agent | question/plan_enter 允许 |
| plan | primary | 规划模式 | 编辑受限，仅 plans 目录可写 |
| general | subagent | 通用研究/并行执行 | 禁用 todoread/todowrite |
| explore | subagent | 代码搜索 | 仅允许 grep/glob/list/bash/read/websearch |
| compaction | primary (hidden) | 上下文压缩 | 禁用所有工具 |

还有 title、summary 两个隐藏 Agent 用于辅助任务。

### 2.3 关键设计模式

**权限绑定：** 每个 Agent 有独立的 `PermissionNext.Ruleset`，通过 merge 链组合默认权限、Agent 级权限和用户自定义权限。

**用户自定义覆盖：** 通过 config 的 `agent` 字段，用户可以：
- 覆盖任何内置 Agent 的 model、prompt、温度等
- 禁用内置 Agent (`disable: true`)
- 添加自定义 Agent
- 自定义 Agent 可以指定 mode 为 subagent/primary/all

**TaskTool 实现子 Agent 调用：**
- TaskTool 是暴露给 LLM 的工具
- 创建独立 Session（parentID 指向父 Session）
- 使用 `SessionPrompt.prompt()` 发起子 Agent 对话
- 可以通过 task_id 恢复之前的子 Agent 会话
- 返回 `<task_result>` 格式的文本结果

### 2.4 子 Agent 调用流程

```
父 Agent 调用 TaskTool
  → 权限检查（permission: "task"）
  → 创建子 Session（parentID = 父 sessionID）
  → 配置权限规则（禁止 todo、限制嵌套 task）
  → 选择模型（Agent 定义 > 父 Agent 模型）
  → SessionPrompt.prompt() 执行完整对话循环
  → 返回最终文本结果
```

## 3. Codex 多 Agent 系统

### 3.1 Collaboration Tool Surface

Codex 使用 5 个 function tools 构成完整的多 Agent API：

| Tool | 功能 |
|------|------|
| spawn_agent | 创建新子 Agent（独立 thread） |
| send_input | 向已有 Agent 发送消息 |
| resume_agent | 恢复已关闭的 Agent |
| wait | 等待 Agent 完成 |
| close_agent | 关闭 Agent |

### 3.2 Spawn 机制

- 每次 spawn 创建独立的 thread（类似独立会话）
- 继承父 Agent 的 config，然后叠加 role-specific 配置
- 支持 `agent_type` 指定角色（通过 `apply_role_to_config`）
- 支持 `fork_context: true` 继承父 Agent 上下文
- 有深度限制（`agent_max_depth`），防止无限递归

### 3.3 深度限制

```rust
fn exceeds_thread_spawn_depth_limit(child_depth: i32, max_depth: i32) -> bool
```

- 每次 spawn 时 depth + 1
- 超过 max_depth 时返回错误："Agent depth limit reached. Solve the task yourself."

### 3.4 Agent 生命周期管理

- Agent 有状态机：NotFound / Running / Waiting / Done / Error
- 支持 interrupt（打断正在运行的 Agent）
- 支持 resume（恢复已关闭的 Agent，从 rollout 恢复）
- wait tool 有超时限制（MIN: 10s, DEFAULT: 30s, MAX: 3600s）

## 4. Craft Agents 的子 Agent 设计

### 4.1 架构特点

Craft Agents 使用 BaseAgent 抽象类，支持多种后端：
- ClaudeAgent — 基于 Claude Agent SDK（@anthropic-ai/claude-agent-sdk）
- PiAgent — 基于 Codex/OpenAI
- 通过 BackendConfig 统一配置

### 4.2 Mini Agent 模式

```typescript
interface MiniAgentConfig {
  enabled: boolean
  tools: readonly string[]          // 受限工具集
  mcpServerKeys: readonly string[]  // 受限 MCP 服务器
  minimizeThinking: boolean         // 最小化推理
}
```

轻量级子 Agent 模式，使用受限工具集和最小化推理。

### 4.3 Spawn Session Tool

Craft Agents 提供 `spawn_session` 工具创建独立子 Session：

```typescript
spawn_session({
  prompt: string           // 必须
  name?: string
  llmConnection?: string   // 连接配置（可切换后端）
  model?: string
  enabledSourceSlugs?: string[]
  permissionMode?: 'safe' | 'ask' | 'allow-all'
  labels?: string[]
  workingDirectory?: string
  attachments?: Array<{ path: string; name?: string }>
})
```

特点：
- **Fire-and-forget** — 创建后不等待完成
- **跨后端** — 子 Session 可以使用不同的 LLM 连接（Anthropic、Codex 等）
- **help 模式** — `help=true` 返回可用的连接、模型、sources
- 子 Session 出现在 Session 列表中

## 5. 自建子 Agent 方案

### 5.1 核心架构：基于 Vercel AI SDK streamText 的子 Agent

CodePilot 当前使用 Vercel AI SDK 的 `streamText` 进行 LLM 调用。子 Agent 本质上是：
1. 一个独立的 `streamText` 调用循环（agentic loop）
2. 使用不同的 system prompt
3. 使用受限的 tool 集
4. 可以使用不同的模型/provider
5. 结果返回给父 Agent

### 5.2 推荐方案：Tool-as-Agent

将每个子 Agent 实现为一个 Vercel AI SDK tool，在 tool 的 execute 函数中启动独立的 agent loop。

```
父 Agent (streamText + tools)
  ├── 普通 tools (Bash, Read, Write...)
  └── Agent tool (description + prompt → 子 Agent)
        └── 独立 streamText loop
              ├── 受限 tools
              ├── 独立 system prompt
              ├── 可不同 model/provider
              └── 返回文本结果给父 Agent
```

### 5.3 Agent 配置格式设计

建议采用类 Claude Code 的 Markdown + frontmatter 格式，同时支持 JSON 配置：

**Markdown 格式（`.codepilot/agents/explore.md`）：**

```markdown
---
name: explore
description: 快速代码搜索和探索代码库
model: haiku                    # 可选：inherit | 具体模型名
tools:                          # 允许的工具列表
  - Glob
  - Grep
  - Read
  - Bash
disallowedTools:                # 禁止的工具列表
  - Write
  - Edit
maxTurns: 20                    # 最大轮数
permissionMode: readonly        # 权限模式
---

你是一个代码搜索专家。你的任务是...
（Markdown body 作为 system prompt）
```

**JSON 配置（settings 中注册）：**

```typescript
interface SubAgentConfig {
  name: string
  description: string           // 用于 tool description
  systemPrompt: string
  model?: string                // 'inherit' | 模型ID
  providerId?: string           // 可指定不同 provider
  tools?: string[]              // 工具白名单
  disallowedTools?: string[]    // 工具黑名单
  maxTurns?: number             // 最大轮数（防死循环）
  temperature?: number
  topP?: number
}
```

### 5.4 内置 Agent 建议

| Agent | 用途 | 模型 | 工具 |
|-------|------|------|------|
| explore | 代码搜索 | haiku / 小模型 | Glob, Grep, Read, Bash(只读) |
| plan | 规划模式 | inherit | Read, Glob, Grep（禁止编辑） |
| general | 通用子任务 | inherit | 大部分工具（禁止再嵌套 Agent） |

### 5.5 实现层次

**Layer 1: AgentRegistry（Agent 注册中心）**

```typescript
class AgentRegistry {
  private agents: Map<string, SubAgentConfig>
  
  registerBuiltIn(config: SubAgentConfig): void
  registerCustom(config: SubAgentConfig): void   // 从 markdown 或 JSON 加载
  get(name: string): SubAgentConfig | undefined
  list(): SubAgentConfig[]
  listForTool(): Array<{ name: string; description: string }>  // 生成 tool schema
}
```

**Layer 2: AgentTool（暴露给 LLM 的 tool）**

```typescript
// 注册为 Vercel AI SDK tool
const agentTool = tool({
  description: `Delegate tasks to specialized sub-agents:\n${registry.listForTool().map(a => `- ${a.name}: ${a.description}`).join('\n')}`,
  parameters: z.object({
    description: z.string(),
    prompt: z.string(),
    agentType: z.string(),
    model: z.string().optional(),
  }),
  execute: async ({ description, prompt, agentType, model }) => {
    return await runSubAgent({ agentType, prompt, model, parentContext })
  }
})
```

**Layer 3: runSubAgent（子 Agent 执行引擎）**

```typescript
async function runSubAgent(params: {
  agentType: string
  prompt: string
  model?: string
  parentProviderId: string
  abortSignal?: AbortSignal
}): Promise<SubAgentResult> {
  const config = registry.get(params.agentType)
  
  // 1. 解析模型和 provider
  const resolvedModel = config.model === 'inherit' ? parentModel : config.model
  const resolvedProvider = config.providerId ?? params.parentProviderId
  
  // 2. 过滤工具
  const tools = filterToolsForAgent(allTools, config.tools, config.disallowedTools)
  
  // 3. 构建 system prompt
  const system = config.systemPrompt + envContext
  
  // 4. 执行 agentic loop
  let messages = [{ role: 'user', content: prompt }]
  let turns = 0
  
  while (turns < (config.maxTurns ?? 50)) {
    const result = await streamText({
      model: getModel(resolvedProvider, resolvedModel),
      system,
      messages,
      tools,
      maxSteps: 1,
      abortSignal,
    })
    
    // 处理 tool calls
    if (result.toolCalls.length === 0) break  // 没有 tool call 则完成
    
    messages.push(assistantMessage, toolResultMessages)
    turns++
  }
  
  // 5. 提取最终文本
  return { content: extractFinalText(messages), turns, tokens }
}
```

**Layer 4: SubAgentSession（可选 — 子 Agent 会话持久化）**

如果需要支持恢复子 Agent（类似 OpenCode 的 task_id），可以将子 Agent 消息历史持久化到 DB。

## 6. 需要的改动点清单

### 6.1 新增文件

| 文件 | 职责 |
|------|------|
| `src/lib/sub-agent/registry.ts` | Agent 注册中心，管理内置和自定义 Agent 定义 |
| `src/lib/sub-agent/types.ts` | SubAgentConfig, SubAgentResult 等类型定义 |
| `src/lib/sub-agent/runner.ts` | runSubAgent 核心执行引擎（独立 streamText 循环） |
| `src/lib/sub-agent/tool.ts` | 生成 AgentTool（Vercel AI SDK tool 格式） |
| `src/lib/sub-agent/built-in/explore.ts` | 内置 Explore Agent 定义 |
| `src/lib/sub-agent/built-in/plan.ts` | 内置 Plan Agent 定义 |
| `src/lib/sub-agent/built-in/general.ts` | 内置 General Agent 定义 |
| `src/lib/sub-agent/tool-filter.ts` | 工具过滤逻辑（白名单/黑名单/嵌套禁止） |

### 6.2 修改文件

| 文件 | 改动 |
|------|------|
| `src/app/api/chat/route.ts` | 在 tools 列表中注入 AgentTool |
| `src/lib/cli-tools-catalog.ts` | 在 tool catalog 中注册 AgentTool |
| `src/types/index.ts` | 添加 SubAgentConfig 等类型 |
| `src/i18n/en.ts` + `zh.ts` | 添加子 Agent 相关 UI 文案 |
| `src/lib/db.ts` | 可选：添加 sub_agent_sessions 表（如需持久化） |

### 6.3 可删除文件

| 文件 | 原因 |
|------|------|
| `src/lib/agent-sdk-agents.ts` | 原 SDK agent 注册，用新的 registry 替代 |

### 6.4 实现优先级

1. **P0 — 核心子 Agent 引擎** (`runner.ts` + `tool.ts` + `registry.ts`)
   - 独立 streamText 循环
   - 工具过滤
   - 结果返回格式
   
2. **P0 — 内置 Agent** (explore + general)
   - Explore Agent（只读搜索，用小模型）
   - General Agent（通用任务代理）

3. **P1 — 深度限制和安全**
   - maxTurns 硬限制
   - 禁止子 Agent 嵌套调用 AgentTool（防递归）
   - AbortSignal 传递

4. **P2 — 自定义 Agent**
   - 支持从 Markdown frontmatter 加载
   - 支持从 settings UI 配置

5. **P3 — 高级功能**
   - 子 Agent 消息流式展示（SSE 嵌套流）
   - 后台运行模式
   - 子 Agent 会话持久化/恢复

## 7. 关键设计决策

### 7.1 同步 vs 异步

**推荐先实现同步模式：** 子 Agent 在 tool execute 中运行完毕后返回结果。这是最简单的实现，也是 OpenCode 和早期 Claude Code 的方式。

后台异步模式（Claude Code 的 run_in_background）复杂度高，涉及：
- 任务状态管理
- Notification 系统
- 部分结果提取
- UI 多面板展示

建议作为 P3 功能。

### 7.2 Context 隔离 vs 继承

**推荐默认隔离（Claude Code 默认模式）：** 子 Agent 不继承父 Agent 的对话历史，只接收 prompt 作为输入。

理由：
- 隔离模式 token 消耗低
- 子 Agent 的 system prompt 针对性更强
- 防止子 Agent 被父 Agent 的上下文干扰

Fork 模式（继承上下文）可以作为高级选项。

### 7.3 与 Agent Loop 的关系

子 Agent 的 runner 本质上就是一个简化版的 Agent Loop。它和主 Agent Loop 共享：
- Provider 解析逻辑（`provider-resolver.ts`）
- Tool 实例化逻辑
- streamText 调用方式

区别是子 Agent 的 loop 不需要：
- SSE 流式输出到前端（只需最终结果）
- Session 持久化
- Rewind 功能
- UI 状态管理

因此子 Agent runner 可以非常轻量。
