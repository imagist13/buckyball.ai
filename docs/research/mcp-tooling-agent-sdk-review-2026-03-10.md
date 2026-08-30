# MCP 与工具调用审查报告（项目 vs Claude Agent SDK）

日期：2026-03-10

本报告已对照 Anthropic 官方文档复核：

- [MCP](https://platform.claude.com/docs/en/agent-sdk/mcp)
- [Custom Tools](https://platform.claude.com/docs/en/agent-sdk/custom-tools)

## 结论

项目当前对 Agent SDK 的 MCP 支持，已经接上了基础路径：

- 可以把 `stdio / sse / http` MCP 配置传给 SDK。
- 已接入 `canUseTool` 权限回调。
- 已接入 `mcpServerStatus()`、`reconnectMcpServer()`、`toggleMcpServer()`。

但和官方文档相比，仍有四个关键问题：

1. 远程 `sse/http` MCP server 新增流程有明显 bug，实际可能根本加不进去。
2. MCP 管理页展示的是“合并后的用户配置视图”，但编辑/删除只写一个文件，状态会漂移。
3. 官方 `custom tools` 路径还没有真正实现；当前架构只支持可序列化的外部 MCP server，不支持 `createSdkMcpServer()` 这类 in-process custom tools。
4. MCP 认证、状态和工具调用 UI 只实现了基础层，缺少官方文档里更完整的 runtime/auth/tooling 语义。

## 主要发现

### [P0] 新增 `sse/http` MCP server 的流程是坏的

证据：

- [src/app/api/plugins/mcp/route.ts](/Users/op7418/Documents/code/opus-4.6-test/src/app/api/plugins/mcp/route.ts#L81)
- [src/components/plugins/McpServerEditor.tsx](/Users/op7418/Documents/code/opus-4.6-test/src/components/plugins/McpServerEditor.tsx#L158)
- [src/components/plugins/McpManager.tsx](/Users/op7418/Documents/code/opus-4.6-test/src/components/plugins/McpManager.tsx#L144)

当前实现：

- `McpServerEditor` 在 `sse/http` 模式下构造的对象是：
  - `command: ''`
  - `type: 'sse' | 'http'`
  - `url`, `headers`, `env`
- 新增时 `McpManager` 走 `POST /api/plugins/mcp`
- 但后端 `POST` 仍然强制要求 `server.command`

结果：

- 新增远程 MCP server 时，表单层看起来合法，但 API 会直接拒绝。
- 这和官方文档里明确支持的 remote MCP server 配置不一致。

这是执行级 bug，优先级最高。

### [P1] MCP 管理页把多个配置来源合并展示，但写操作只落到 `~/.claude/settings.json`

证据：

- [src/app/api/plugins/mcp/route.ts](/Users/op7418/Documents/code/opus-4.6-test/src/app/api/plugins/mcp/route.ts#L43)
- [src/app/api/plugins/mcp/route.ts](/Users/op7418/Documents/code/opus-4.6-test/src/app/api/plugins/mcp/route.ts#L61)
- [src/app/api/plugins/mcp/%5Bname%5D/route.ts](/Users/op7418/Documents/code/opus-4.6-test/src/app/api/plugins/mcp/%5Bname%5D/route.ts#L30)

当前实现：

- `GET /api/plugins/mcp` 会把：
  - `~/.claude.json`
  - `~/.claude/settings.json`
  合并后返回。
- 但 `PUT /api/plugins/mcp` 和 `DELETE /api/plugins/mcp/[name]` 只操作 `~/.claude/settings.json`。

结果：

- 某些来自 `~/.claude.json` 的 server 会“看得见但删不掉”。
- 一旦编辑/保存，容易把原本只存在于 `~/.claude.json` 的条目 shadow copy 到 `settings.json`。
- UI 显示的“配置状态”和实际文件来源不一致。

这会造成配置漂移，也会让用户误判 MCP 的真实来源。

### [P1] MCP 管理 UI 没有 project/local scope 概念，和官方文档的配置模型不一致

证据：

- [src/app/api/plugins/mcp/route.ts](/Users/op7418/Documents/code/opus-4.6-test/src/app/api/plugins/mcp/route.ts#L12)
- [src/app/api/plugins/mcp/%5Bname%5D/route.ts](/Users/op7418/Documents/code/opus-4.6-test/src/app/api/plugins/mcp/%5Bname%5D/route.ts#L7)

当前实现只读写：

- `~/.claude.json`
- `~/.claude/settings.json`

没有 UI 层的 project/local scope，也没有对 project-local MCP 配置文件的管理入口。

而官方 MCP 文档支持：

- 从 config file 加载
- user / project / local 等不同来源
- 以及运行时程序化配置

结果：

- 项目里的 MCP 管理页只能覆盖一部分官方配置面。
- 某些真实参与 SDK session 的 project/local MCP server，UI 不一定能看到。
- UI 里的 MCP 列表，不一定等于当前 session 真正可用的 MCP server 集合。

### [P1] 官方 `custom tools` 路径目前没有实现

证据：

- [src/types/index.ts](/Users/op7418/Documents/code/opus-4.6-test/src/types/index.ts#L454)
- [src/lib/claude-client.ts](/Users/op7418/Documents/code/opus-4.6-test/src/lib/claude-client.ts#L97)
- [src/lib/claude-client.ts](/Users/op7418/Documents/code/opus-4.6-test/src/lib/claude-client.ts#L400)
- [src/lib/claude-client.ts](/Users/op7418/Documents/code/opus-4.6-test/src/lib/claude-client.ts#L541)
- [node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts](/Users/op7418/Documents/code/opus-4.6-test/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L252)
- [node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts](/Users/op7418/Documents/code/opus-4.6-test/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L1580)

官方 custom tools 文档描述的是：

- 用 `createSdkMcpServer()` 创建 in-process MCP server
- 用 `tool()` / handler 注册自定义 tool
- 并在 custom-tools 场景下使用 streaming input / async iterable prompt

但当前项目架构是：

- 本地 `MCPServerConfig` 只支持 `stdio | sse | http`
- `toSdkMcpConfig()` 也只会转换这三类可序列化配置
- `queryOptions.mcpServers` 来自 JSON 化配置对象
- `query()` 的 `prompt` 大多数情况下仍然是普通字符串；只有图片输入时才临时走 async iterable

这意味着：

- 当前项目并没有真正支持官方 custom tools 这条 SDK 路径。
- 就算后续想把某个 JS handler 直接注册为 tool，当前数据模型和调用模型也不够。
- 现在支持的是“外部 MCP server”，不是“SDK in-process custom tools”。

这不是小缺口，而是能力边界本身还没对齐官方文档。

### [P1] `needs-auth` MCP 只显示 badge，没有完成官方文档里的认证闭环

证据：

- [src/components/plugins/McpServerList.tsx](/Users/op7418/Documents/code/opus-4.6-test/src/components/plugins/McpServerList.tsx#L41)
- [src/components/plugins/McpServerList.tsx](/Users/op7418/Documents/code/opus-4.6-test/src/components/plugins/McpServerList.tsx#L163)
- [src/app/api/plugins/mcp/status/route.ts](/Users/op7418/Documents/code/opus-4.6-test/src/app/api/plugins/mcp/status/route.ts#L8)

当前实现：

- UI 能显示 `needs-auth` 状态。
- 但交互按钮只覆盖：
  - `failed -> reconnect`
  - `disabled -> enable`
- 没有单独的 auth CTA，也没有明显的认证恢复流。

而官方 MCP 文档明确讨论了：

- remote server headers
- OAuth2 authentication
- `needs-auth` / auth-required 这类运行时状态

结果：

- 用户能看到“需要认证”，但 UI 不告诉他下一步怎么完成。
- 这会让远程 MCP 的诊断停在半路。

### [P1] MCP 运行态状态是“会话相关”的，但管理页取的是任意一个 active session

证据：

- [src/components/plugins/McpManager.tsx](/Users/op7418/Documents/code/opus-4.6-test/src/components/plugins/McpManager.tsx#L53)
- [src/app/api/plugins/mcp/status/route.ts](/Users/op7418/Documents/code/opus-4.6-test/src/app/api/plugins/mcp/status/route.ts#L8)
- [src/components/plugins/McpServerList.tsx](/Users/op7418/Documents/code/opus-4.6-test/src/components/plugins/McpServerList.tsx#L163)

当前实现：

- `McpManager` 会先请求 `/api/chat/sessions?status=active&limit=1`
- 然后拿“第一条 active session”去查 MCP runtime status
- reconnect/toggle 也作用在这个 session 上

结果：

- 如果用户同时开了多个会话，MCP 页面的状态可能对应错会话。
- reconnect / enable 动作也可能打到并非当前用户关注的那条 Query 上。

这是 runtime status 维度的错绑问题。

### [P2] `system:init` 里的 `mcp_servers` 被丢掉了，工具与 MCP 事件流也只消费了一部分

证据：

- [src/lib/claude-client.ts](/Users/op7418/Documents/code/opus-4.6-test/src/lib/claude-client.ts#L797)
- [src/types/index.ts](/Users/op7418/Documents/code/opus-4.6-test/src/types/index.ts#L389)
- [node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts](/Users/op7418/Documents/code/opus-4.6-test/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L1593)

当前实现：

- `system:init` 只被转成：
  - `session_id`
  - `model`
  - `requested_model`
  - `tools`
- SDK 里还有更多与 MCP / tooling 相关的 message / field，但当前链路没有透传出来：
  - `mcp_servers`
  - `tool_use_summary`
  - `hook_started / hook_progress / hook_response`
  - `prompt_suggestion`
  - `auth_status`

结果：

- Chat UI 和 MCP UI 能拿到的 runtime 诊断信息偏少。
- 一旦遇到“为什么某个 tool 没触发 / 某个 MCP 没连上 / 某个 auth 卡住”，排障信息不够完整。

### [P2] 工具调用 UI 基本只针对内建工具做了优化，MCP/custom tool 会退化成 generic block

证据：

- [src/components/chat/ToolCallBlock.tsx](/Users/op7418/Documents/code/opus-4.6-test/src/components/chat/ToolCallBlock.tsx#L32)
- [src/components/chat/ToolCallBlock.tsx](/Users/op7418/Documents/code/opus-4.6-test/src/components/chat/ToolCallBlock.tsx#L57)

当前实现里，工具分类只针对：

- `Read / Write / Edit`
- `Bash`
- `Search / Glob / Grep`

其他工具，包括大多数 MCP tool / custom tool，都会落到 `other`。

结果：

- MCP tool 名称不会被拆成 server/tool 维度展示。
- 也没有针对 MCP/custom tool 的输入摘要和结果可视化。
- 工具调用虽然能显示，但可读性和诊断价值偏弱。

## 已经对齐的部分

下面这些点，项目是和官方 Agent SDK 能力对齐的：

- 通过 `queryOptions.mcpServers` 向 SDK 传入 MCP 配置。
- 支持 `stdio / sse / http` 三种 transport。
- 已使用 `canUseTool` 做权限审批。
- 已支持 `mcpServerStatus()` runtime 查询。
- 已暴露 `reconnectMcpServer()` 和 `toggleMcpServer()`。

这些基础能力说明当前并不是“完全没接 MCP”，而是已经接了第一层，但还没有把官方文档里的完整模型吃透。

## 建议的修复顺序

### 1. 先修新增远程 MCP server 的 bug

优先改：

- [src/app/api/plugins/mcp/route.ts](/Users/op7418/Documents/code/opus-4.6-test/src/app/api/plugins/mcp/route.ts)
- [src/components/plugins/McpServerEditor.tsx](/Users/op7418/Documents/code/opus-4.6-test/src/components/plugins/McpServerEditor.tsx)

要求：

- `sse/http` 新增时不再强制要求 `command`
- 后端校验应按 transport 分支

### 2. 把 MCP 配置来源做成显式 scope，而不是 merge 后假装同一来源

优先改：

- [src/app/api/plugins/mcp/route.ts](/Users/op7418/Documents/code/opus-4.6-test/src/app/api/plugins/mcp/route.ts)
- [src/app/api/plugins/mcp/%5Bname%5D/route.ts](/Users/op7418/Documents/code/opus-4.6-test/src/app/api/plugins/mcp/%5Bname%5D/route.ts)
- [src/components/plugins/McpManager.tsx](/Users/op7418/Documents/code/opus-4.6-test/src/components/plugins/McpManager.tsx)

建议：

- 明确区分 user / project / local / dynamic
- 至少不要把两个 home 文件 merge 后再只写一个
- UI 上标出来源，避免“看得见但删不掉”

### 3. 明确声明当前只支持“外部 MCP server”，还是补上官方 custom tools

如果要补上 custom tools，需要改的不只是 UI：

- 引入 `createSdkMcpServer()`
- 引入 `tool()` / in-process handler
- `MCPServerConfig` 类型要扩展，不能只剩 JSON 可序列化配置
- Query 输入模型要支持官方文档要求的 streaming input / async iterable

这是一条单独的能力线，建议不要和当前 MCP 设置页混着做。

### 4. 补齐 auth / status / init 事件的 runtime 语义

建议至少补这些：

- `system:init.mcp_servers`
- `auth_status`
- `needs-auth` 的可操作 UI
- 更明确的 reconnect/auth failure 反馈

### 5. MCP runtime status 不要绑定“第一条 active session”

建议：

- 让用户显式选择目标 session
- 或绑定当前 chat session
- 或明确展示“这是哪个 session 的 runtime status”

### 6. 单独优化 MCP/custom tool 的工具调用 UI

建议：

- 识别 `mcp__server__tool` 命名
- 展示 server 名和 tool 名
- 对 MCP/custom tool 的 input/result 做更好的摘要

## 最终判断

项目当前的 MCP 集成已经覆盖了 Agent SDK 的基础外部 server 能力，但还没有覆盖官方文档里的完整模型：

- 配置 scope 还不对齐
- 远程 server 新增有 bug
- custom tools 还没实现
- auth/runtime/tooling 事件只接了基础层

如果目标是“尽量接近 Claude Code / Agent SDK 官方行为”，下一步应该先修配置与 transport bug，再决定是否正式支持 custom tools。
