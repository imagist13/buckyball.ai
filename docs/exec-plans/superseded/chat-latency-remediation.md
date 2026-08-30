> **Archive note（2026-06-05，document-system-governance）**：本计划已移出 `active/`，归入 `superseded/`——被 refactor-closeout 接管，仅作历史参考。**不是当前任务入口**；当前工作入口见 [exec-plans README](../README.md)，重启方式见 [superseded/README.md](README.md)。

# Chat Latency Remediation

> ⚠️ **Superseded by [refactor-closeout.md](../completed/refactor-closeout.md)** — 不再单独推进，保留作历史参考。模式入口收敛 / MCP 持久开关 / 首包延迟优化按需并入 refactor-closeout 的 **Phase 2（Runtime 与会话执行）** 与 **Phase 3（助理、定时任务、心跳通知）**。

> 创建时间：2026-03-21
> 最后更新：2026-03-21

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 范围确认与基线 | ✅ 已完成 | 用户已确认删模式入口、MCP 持久开关、resume 可见状态、capability 延后 |
| Phase 1 | 聊天模式入口收敛 | 📋 待开始 | 先删前台入口并统一走 `code`，后台兼容先保留 |
| Phase 2 | MCP 持久启停开关 | 📋 待开始 | 默认开启，用户可在 MCP 页面关闭单个 server |
| Phase 3 | 首包延迟优化 | 📋 待开始 | effort/thinking 默认值、resume 可见状态、能力抓取延后 |
| Phase 4 | 观测与验证 | 📋 待开始 | 时序埋点、回归验证、CDP 检查 |

## 决策日志

- 2026-03-21: 聊天界面的模式选择（如 CodePilot / Ask）可以删除，计划模式后续重做时再引入。
- 2026-03-21: 本轮不做 `mode` 字段和桥接 `/mode` 命令的彻底清理，先删除桌面主聊天入口并把桌面聊天统一收敛到 `code`，以控制范围和回归风险。
- 2026-03-21: MCP 需要做成持久启停开关，默认开启，用户可以在 MCP 页面关闭某个 server。
- 2026-03-21: 恢复旧会话时允许增加可见状态提示，优先解决“空白等待像卡死”的体感问题。
- 2026-03-21: `supportedModels` / `supportedCommands` / `accountInfo` / `mcpServerStatus` 可以移出首包关键路径。
- 2026-03-21: 不采用“全局关闭 MCP”或“强制所有模型 low effort”这类以阉割功能换速度的方案。

## 目标

- 降低普通聊天的首个可见事件时间和首 token 时间。
- 删除当前已经失去产品意义的模式入口，避免无效交互。
- 保留工具、MCP、技能、恢复旧会话等能力，不靠砍功能提速。
- 让 MCP 的启停变成用户可控且持久生效的配置。

## 非目标

- 不在本轮重做计划模式。
- 不在本轮彻底移除数据库 `mode` 字段、桥接 `/mode` 命令和所有旧兼容分支。
- 不在本轮重构 provider 体系或 assistant workspace。
- 不通过全局禁用用户本机 Claude 配置来一次性解决所有延迟问题。

## 交互与功能变化

- 删除主聊天界面的模式选择入口；桌面聊天统一按 `code` 路径执行。
- MCP 页面增加“持久启用/停用”开关；默认开启，关闭后该 server 不再注入新的聊天会话和桥接会话。
- 恢复旧会话时显示显式状态文案，如“正在恢复上下文…”或“正在连接工具…”。
- 除以上三点外，不新增额外交互，不减少模型、附件、工具和 MCP 的现有能力。

## 详细设计

### Phase 1: 聊天模式入口收敛

**目标**

- 去掉无效的 UI 模式切换，减少用户误解和无意义状态分支。

**实现**

- `src/components/chat/ChatView.tsx`
  - 删除主聊天的 mode 状态、切换 UI、相关请求。
  - 发消息时不再从前端传 `ask` / `plan`。
- `src/app/chat/[id]/page.tsx`
  - 页面加载时不再把 `session.mode` 作为主聊天 UI 状态源。
- `src/components/layout/SplitColumn.tsx`
  - 移除传递给聊天视图的 mode UI 状态，避免顶部状态和实际执行路径不一致。
- `src/app/api/chat/route.ts`
  - 主聊天路径把 `effectiveMode` 收敛到 `code`。
  - 保留兼容注释，说明这是桌面主聊天的产品决策，不等于全系统彻底移除 `mode`。
- `src/app/api/chat/mode/route.ts`
  - 桌面 UI 不再调用。
  - 可先保留接口以兼容旧版本客户端和桥接路径，后续再统一清理。
- `src/i18n/en.ts` 与 `src/i18n/zh.ts`
  - 清理主聊天里不再使用的模式文案。

**风险控制**

- 不建议本轮直接删除 DB schema、TypeScript union、bridge `/mode` 命令，否则会把“延迟治理”扩成“跨桌面 + 桥接 + 数据兼容”的大重构。
- 旧 session 若仍带 `ask` / `plan`，桌面主聊天读取时统一按 `code` 执行；桥接路径暂不动。

### Phase 2: MCP 持久启停开关

**目标**

- 把 MCP 开关从“当前活动会话里的临时 runtime toggle”升级为“配置层的持久开关”。

**现状问题**

- 现有 `src/app/api/plugins/mcp/toggle/route.ts` 只对当前活动 conversation 做 runtime toggle。
- 主聊天和桥接加载 MCP 时，`src/app/api/chat/route.ts` 与 `src/lib/bridge/conversation-engine.ts` 会直接读取配置文件并全部注入，没有“持久禁用”的过滤层。

**实现**

- `src/types/index.ts`
  - 给 `MCPServerConfig` 增加 `enabled?: boolean`，默认按 `true` 解释。
- `src/app/api/plugins/mcp/route.ts`
  - GET/PUT/POST 保留并透传 `enabled` 字段。
  - 读取 `~/.claude.json` 和 `~/.claude/settings.json` 时合并 `_source`，但不丢失 `enabled`。
- `src/components/plugins/McpServerList.tsx`
  - 把“仅在 runtime disabled 时显示 Enable 按钮”的逻辑改成常驻开关。
  - 配置禁用状态要和 runtime status 分开展示，避免“配置关掉”和“运行中失败”混为一谈。
- `src/components/plugins/McpManager.tsx`
  - 保存开关改为走配置更新，而不是仅调用 runtime toggle。
- `src/app/api/chat/route.ts`
  - `loadMcpServers()` 过滤 `enabled === false` 的 server。
- `src/lib/bridge/conversation-engine.ts`
  - 同步过滤 `enabled === false` 的 server，保证桌面和桥接行为一致。
- `src/app/api/plugins/mcp/toggle/route.ts`
  - 保留给“活动会话临时 reconnect / runtime toggle”使用，或者标记为仅 runtime 语义；不要拿它承载持久配置。

**用户可见行为**

- 默认不变，所有 server 仍然开启。
- 用户手动关闭某个 server 后，它不会参与新的聊天初始化；这属于明确的用户控制，不是功能被系统静默阉割。

### Phase 3: 首包延迟优化

**目标**

- 优先解决“所有模型都慢”和“恢复旧会话时长时间空白”这两个体感问题。

**实现 A：runtime profile 显式默认值**

- `src/lib/claude-client.ts`
  - 当请求没有显式传 `thinking/effort` 时，由 CodePilot 统一设默认值，而不是继续继承用户本机 Claude 的高强度偏好。
  - 推荐默认 `effort: 'medium'`；是否显式关闭 thinking 取决于当前 UI 有没有独立的 thinking 控制，避免引入额外行为分叉。
- `src/app/api/chat/route.ts`
  - 明确桌面主聊天的默认 runtime profile。
  - 若未来需要区分“显式用户选择”和“应用默认值”，在请求体里增加来源标记，避免统计混淆。

**实现 B：resume 可见状态**

- `src/lib/claude-client.ts`
  - 在执行 resume 校验前，先发一条前端可见的 status 事件。
  - resume 失败时继续保留 fresh fallback，但不要让用户先经历整段静默等待。
- `src/hooks/useSSEStream.ts`
  - 接受新的可见状态消息并展示，不再把这类初始化状态都当作 internal-only 噪音过滤掉。

**实现 C：能力抓取延后**

- `src/lib/agent-sdk-capabilities.ts`
  - 增加 TTL / freshness 判断，已有缓存时不在每轮 query 初始化后立即抓全套。
- `src/lib/claude-client.ts`
  - `captureCapabilities()` 改到首个 `system init` 之后、或首个文本事件之后执行，避免与首轮初始化竞争资源。

**实现 D：项目自带 MCP 冷启动减负**

- 项目级 [`.mcp.json`](/Users/guohao/Documents/code/codepilot/CodePilot/.mcp.json)
  - 对项目自带的重型 server 避免使用 `npx -y ...@latest` 这类每次解析版本的冷启动方式。
  - 优先固定版本；若条件允许，改为本地已安装命令或更轻的启动路径。
- 保留现有 generative UI 的按需挂载策略，不把 widget MCP 重新拉回所有会话的默认初始化路径。

## 验收标准

- 主聊天界面不再出现 CodePilot / Ask 模式切换。
- 新建或继续聊天时，桌面主聊天统一按 `code` 权限路径工作。
- MCP 页面可以对单个 server 做持久启停，刷新页面后状态仍然正确。
- 被关闭的 MCP server 不会出现在新聊天的初始化注入列表中。
- 恢复旧会话时，用户能在模型首 token 前看到明确状态提示。
- 普通文本聊天的首个可见状态时间明显早于当前版本，且不依赖关闭功能来实现。

## 验证计划

- `npm run test`
  - 覆盖类型、单元测试、基础回归。
- `npm run test:smoke`
  - 验证主聊天发送、MCP 设置页、持久开关基本流程。
- UI 变更必须跑开发环境并用 CDP 验证
  - 启动 `npm run dev`
  - 验证主聊天无模式切换入口
  - 验证 MCP 页面开关可切换且刷新后保持
  - 验证恢复旧会话时状态文案可见
  - 检查 console 无新增报错

## 建议实施顺序

1. 先做 Phase 1，去掉无效模式入口并把桌面主聊天统一到 `code`。
2. 再做 Phase 2，把 MCP 开关改成持久配置，并同步过滤聊天/桥接注入。
3. 然后做 Phase 3 的三项低风险优化：显式 runtime 默认值、resume 可见状态、capability 延后。
4. 最后补齐时序日志和回归验证，确认延迟改善是否达到预期。
