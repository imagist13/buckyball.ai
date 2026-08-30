# Chat Latency Investigation (2026-03-20)

## 结论

这次“所有模型都要等十几秒才开始回”的问题，主因不是前端渲染，也不是 assistant workspace 的索引逻辑，而是聊天请求在真正进入模型生成前，继承了过重的 Claude Code 运行环境：

1. **CodePilot 对所有 provider 都加载用户级 Claude 设置**，当前机器的 `~/.claude/settings.json` 开着：
   - `alwaysThinkingEnabled: true`
   - `effortLevel: "high"`
2. **每次请求还会带上 MCP / plugin / hook 生态**，其中项目级 `.mcp.json` 里有：
   - `chrome-devtools`: `npx -y chrome-devtools-mcp@latest`
3. **resume 路径在发出任何可见 SSE 之前就会阻塞等待第一条 SDK 消息**，导致用户体感是“完全没反应”。

综合判断：

- **最高优先级根因**：用户级 Claude 设置泄漏进 CodePilot，会把所有 provider 都拉进高 effort / always-thinking 路径。
- **第二优先级放大器**：MCP server 初始化过重，尤其是 `npx -y ...@latest` 这种每次可能触发包解析/网络探测的配置。
- **第三优先级体感问题**：resume / init 阶段没有尽早给 UI 可见状态，放大了“卡住”的感觉。

## 证据

### 1. 所有 provider 都会加载用户级 Claude 设置

代码里对已配置 provider 的 `settingSources` 固定返回：

- `['user', 'project', 'local']`

位置：

- [`src/lib/provider-resolver.ts`](/Users/guohao/Documents/code/codepilot/CodePilot/src/lib/provider-resolver.ts)

同时 SDK 只在显式传入时才追加 `--effort`：

- [`src/lib/claude-client.ts`](/Users/guohao/Documents/code/codepilot/CodePilot/src/lib/claude-client.ts)
- [`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`](/Users/guohao/Documents/code/codepilot/CodePilot/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs)

本机实际用户设置：

- `~/.claude/settings.json`
  - `alwaysThinkingEnabled: true`
  - `effortLevel: "high"`
  - `enabledPlugins.code-simplifier@claude-plugins-official: true`
  - 多个 hooks（`SessionStart` / `UserPromptSubmit` / `Stop` / `PreCompact`）
  - `statusLine.command: "npx -y ccstatusline@latest"`

这意味着：

- 即使 CodePilot UI 没主动把 effort 选到 high，只要没有显式覆盖，SDK 很可能仍继承用户级默认值。
- 这是**跨模型、跨 provider**都成立的统一慢路径。

### 2. assistant workspace 不是主要瓶颈

当前活跃 assistant workspace：

- `/Users/guohao/Documents/op7418的仓库`

我对这条链路做了本机拆分测量，结果如下：

- `walkDir`: 12.6ms
- `read manifest`: 1.8ms
- `parse manifest`: 2.1ms
- `read chunks`: 54.8ms
- `parse chunks`: 40.6ms
- `build manifest map`: 0.3ms
- `build chunks map`: 4.5ms
- `stat compare`: 3.1ms

总量级大约 **120ms**。

另外：

- workspace 总文件数：915
- 可索引的 `.md/.txt/.markdown` 文件：592
- `.assistant/index/chunks.jsonl` 大小：21MB

结论：

- assistant workspace 的增量索引和检索确实有成本，但**远远不够解释“十几秒”**。

相关位置：

- [`src/app/api/chat/route.ts`](/Users/guohao/Documents/code/codepilot/CodePilot/src/app/api/chat/route.ts)
- [`src/lib/assistant-workspace.ts`](/Users/guohao/Documents/code/codepilot/CodePilot/src/lib/assistant-workspace.ts)
- [`src/lib/workspace-indexer.ts`](/Users/guohao/Documents/code/codepilot/CodePilot/src/lib/workspace-indexer.ts)
- [`src/lib/workspace-retrieval.ts`](/Users/guohao/Documents/code/codepilot/CodePilot/src/lib/workspace-retrieval.ts)

### 3. CLI 工具探测也不是主要瓶颈

`buildCliToolsContext()` 最终依赖 `detectAllCliTools()`；我按当前 catalog 和 extra bins 做了本机近似测量：

- 总耗时：**427.7ms**

这也不是十几秒级。

相关位置：

- [`src/lib/cli-tools-context.ts`](/Users/guohao/Documents/code/codepilot/CodePilot/src/lib/cli-tools-context.ts)
- [`src/lib/cli-tools-detect.ts`](/Users/guohao/Documents/code/codepilot/CodePilot/src/lib/cli-tools-detect.ts)

### 4. MCP 配置明显存在重启动风险

当前项目 `.mcp.json`：

- `chrome-devtools`
  - `command: "npx"`
  - `args: ["-y", "chrome-devtools-mcp@latest"]`

当前用户全局 `~/.claude.json`：

- 全局 `mcpServers.deepwiki`

当前 `~/.claude.json` 项目配置（`/Users/guohao`）里还有：

- `figma-dev-mode-mcp-server`
- `context7`

所以真实聊天环境里，SDK 可能同时面对多组 MCP 来源：

1. CodePilot 显式注入的 `loadMcpServers()`
2. SDK 通过 `settingSources: ['user','project','local']` 自己再读到的用户/项目配置

尤其危险的是：

- `chrome-devtools-mcp@latest` 不是固定版本
- 它通过 `npx -y` 启动，天然可能触发 npm 解析/校验/联网

本地探针里，执行：

```bash
npx -y chrome-devtools-mcp@latest --help
```

在 10 秒以上仍没有返回结果，说明这个启动路径本身就非常可疑。

相关位置：

- [`src/app/api/chat/route.ts`](/Users/guohao/Documents/code/codepilot/CodePilot/src/app/api/chat/route.ts)
- [`.mcp.json`](/Users/guohao/Documents/code/codepilot/CodePilot/.mcp.json)

### 5. resume 路径会放大“没反应”的体感

在 resume 分支里，代码会先：

1. `query(...)`
2. 立即 `await iter.next()`
3. 拿到第一条消息后才继续往前走

也就是说：

- 在 SDK 第一条消息回来之前，前端收不到任何可见 SSE
- 如果 resume 初始化、MCP handshake、plugin/hook 处理慢，UI 会表现为“发送后长时间完全静止”

而且内部 resume fallback status 又被 `_internal` 过滤掉，用户无感知：

- [`src/lib/claude-client.ts`](/Users/guohao/Documents/code/codepilot/CodePilot/src/lib/claude-client.ts)
- [`src/hooks/useSSEStream.ts`](/Users/guohao/Documents/code/codepilot/CodePilot/src/hooks/useSSEStream.ts)
- [`docs/handover/provider-error-doctor.md`](/Users/guohao/Documents/code/codepilot/CodePilot/docs/handover/provider-error-doctor.md)

### 6. 数据库里的真实会话也符合“统一变慢”

我抽了几条最近的简单会话看消息落库时间：

- `e4528e...`：`你好` -> 助手消息落库，约 9 秒
- `624de8...`：`你好` -> 助手消息落库，约 14 秒
- `a2d0cb...`：`妹有，结束` -> 助手消息落库，约 23 秒

这些会话分布在不同 provider / 不同目录下，不是单一模型或单一 workspace 才会慢。

说明：

- 问题更像**统一的 SDK 启动/配置层**，不是某个模型本身。

## 排查结论排序

### P0

**用户级 Claude 设置泄漏到 CodePilot**

- 症状匹配度最高
- 影响范围最广
- 和“所有模型都慢”完全一致

### P1

**MCP 初始化过重，特别是 `chrome-devtools-mcp@latest`**

- 会统一拖慢首个可见响应
- 和当前项目配置直接相关

### P2

**resume 逻辑在首条消息前阻塞，放大感知延迟**

- 不一定是根因
- 但会显著恶化体感，并隐藏内部 fallback

### P3

**启动后立刻 `captureCapabilities()`**

- 会额外打 SDK 控制请求：
  - `supportedModels()`
  - `supportedCommands()`
  - `accountInfo()`
  - `mcpServerStatus()`
- 更像放大器，不像唯一根因

## 建议修复

### 方案 A：先止血

1. **不要让 CodePilot 默认继承 `~/.claude/settings.json` 的 thinking / effort**
   - 最稳妥：对 provider 会话去掉 `user` setting source
   - 或者在 CodePilot 里显式传默认值，例如：
     - `thinking: { type: 'disabled' }` 或明确的 UI 默认
     - `effort: 'low'` / `'medium'`
2. **把项目 `.mcp.json` 的 `chrome-devtools-mcp@latest` 改成固定版本**
   - 避免每次走 `@latest`
3. **先临时关闭聊天自动注入的 MCP**
   - 至少给 plain chat 一个“无 MCP 快速路径”

### 方案 B：改善体感

1. 在 `streamClaude()` 一开始就先发一个本地 `status`
   - 比如 `Connecting...`
2. resume 分支不要在 UI 完全无反馈的情况下等待 `iter.next()`
3. 不要把 resume fallback 全部标成 `_internal`
   - 至少在 debug 模式或状态栏里可见

### 方案 C：进一步优化

1. 把 `captureCapabilities()` 延后到首个 assistant event 之后
2. 给 `/api/chat` 增加服务端耗时日志
   - `preflight_ms`
   - `sdk_init_ms`
   - `first_event_ms`
   - `first_text_ms`
   - `complete_ms`

## 我这次没有做的事

- 没有直接对真实 provider 发线上请求测“首 token 时间”，因为当前沙箱环境不适合安全地跑外部网络压测。
- 所以这份报告里的“主因”是基于：
  - 代码链路
  - 本机配置
  - 本地耗时拆分
  - 数据库中的真实会话时间

但证据已经足够把范围缩到：**不是前端，不是 assistant workspace，不是 CLI tools context，而是 SDK 继承设置 + MCP 启动 + resume 可见性**。
