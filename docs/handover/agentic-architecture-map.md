# CodePilot Agentic Architecture Map

> 产品思考见 [docs/insights/agentic-architecture-map.md](../insights/agentic-architecture-map.md)
> 来源：用户提供的 Agentic AI System reference diagram + CodePilot 2026-04/05 重构现状

这份文档不是新功能计划，而是**架构边界说明**。目的：后续改 Settings、Plugins、Chat、Runtime、Provider、Memory 时，先判断某个能力属于哪一层，避免把工具包装成 Agent、把半成品包装成稳定功能、或把 provider/model 配置暴露成用户主流程。

## 一、分层映射

| Reference layer | CodePilot 对应模块 | 当前产品入口 | 边界说明 |
|---|---|---|---|
| User / Client | Chat 页面、远程桥接、API/SDK 入口 | `/chat`、Settings > Bridge | 用户发起任务的入口。Bridge 是外部入口，不是 Agent 本身。 |
| Orchestration / Control Plane | Runtime 解析、Provider resolver、RunCheckpoint、MessageInput submit pipeline、session state | Chat composer、Settings > Runtime | 决定“这次怎么跑”。这里负责解释、拦截、路由，不应该堆用户工具按钮。 |
| Agent Layer | Claude Code Runtime、Native AI SDK Runtime、未来 Codex / OpenClaw / local agents | Settings > Runtime；未来 Run Cockpit | Agent 是执行引擎或专业执行体。不要把 Skills/MCP/CLI 误叫 Agent。 |
| Tools & Integrations | Skills、MCP、CLI、Git、Widget、File tree、Gallery actions | `/plugins`、Workspace Sidebar、File tree | 工具层给 Agent 调用。用户可管理，但不应被包装成“必须手动开关的 Agent”。 |
| Memory & Knowledge | Context chips、Context usage、Memory V3、workspace docs、session history | Chat composer、未来 Health/Memory 状态 | Context 已产品化；Memory/Tasks/Heartbeat 仍需事实核准后再显性打稳定标签。 |
| Monitoring & Observability | Health、sanitized persistent logs、doctor export、Sentry、runtime events | Settings > Health/About | 日常看状态、出问题拿证据。不要承诺“万能诊断/自动修复”。 |
| Reliability & Failure Management | retry/fallback、RunCheckpoint、PermissionPrompt、rate-limit/terminal banners | Chat inline banners | 只在需要用户理解或确认时出现；常态不常驻。 |
| Governance & Security | permission mode、tool permission requests、provider credential handling、log sanitization | Chat permission selector、Settings | 权限是确定性控制，必须清楚；不要为了“按钮少”隐藏安全边界。 |
| Foundation / Infrastructure | Provider catalog、model discovery、DB、Electron main/preload、secrets、cache、filesystem | Settings internals | 地基必须事实准确。Provider/model 错误会向上污染 Chat、Runtime、Default model。 |

## 二、当前模块定位

### Provider / Models

Provider 和 Models 是 **Foundation + Model Gateway**，不是用户任务层。

不变量：
- Coding Plan / Token Plan provider 的模型列表以官方套餐白名单为准，不等于 `/v1/models` 大目录。
- OpenRouter 这类聚合 provider 是远程搜索目录，不适合全量落库成本地 inventory。
- 默认模型是 Runtime 解析链的一部分；Pinned invalid 必须可解释，不允许静默替换。
- Provider factual baseline 要优先于“探测成功”。probe 成功只说明 endpoint 有返回，不说明模型能走套餐额度。

相关文档：
- [provider-architecture.md](./provider-architecture.md)
- [provider-governance.md](./provider-governance.md)
- [../guardrails/ProviderManagement.md](../guardrails/ProviderManagement.md)
- [../guardrails/ModelDiscovery.md](../guardrails/ModelDiscovery.md)

### Plugins: Skills / MCP / CLI

Plugins 是 **Tools & Integrations**。

设计边界：
- Skills 是可被 Agent 调用的能力/提示词/工作流，不是 Agent。
- MCP 是工具 server / 内置能力，不是常驻 Agent。
- CLI 是本地工具入口；如果 AI 能处理安装/配置边界，优先走 Chat prefill/skill 调用，不必把所有表单 UI 化。
- 内置 MCP 应展示“触发条件/能力说明”，但不要假装知道“当前消息已经注入”。

当前入口：
- `/plugins#skills`
- `/plugins#mcp`
- `/plugins#cli`

### Runtime / Agent

Runtime 是 **Agent Layer + Control Plane 的交界**。

当前 Runtime：
- Claude Code Runtime
- Native AI SDK Runtime

未来候选：
- Codex local agent
- OpenClaw
- 其它本地 agent framework

边界：
- Runtime 页解释“默认会用谁”，但当前会话每条新消息仍会重新解析。
- 支持多个 Agent 以后，主 Agent `@` 其它 Agent 更像 orchestration 能力，不应塞进 Plugins。
- `runtime.selected` / session event 应与 Run Cockpit 同期落地，避免先建无法消费的事件。

相关文档：
- [decouple-native-runtime.md](./decouple-native-runtime.md)
- [chat-run-checkpoint.md](./chat-run-checkpoint.md)
- [../guardrails/Runtime.md](../guardrails/Runtime.md)

### Chat Composer / RunCheckpoint

Chat 是用户主入口。Composer 只保留用户当下要表达任务所需的最少控制。

不变量：
- 输入框是主入口，按钮越少越好。
- 状态聚合到 Run 面板解释，不散成多个 chip 让用户自己拼。
- RunCheckpoint 是发送前信任层：inline、单点、不可持久关闭。
- 权限控制不能被隐藏；危险或权限提升场景要清楚。
- Context chips 必须可见、可移除、可估算成本。

相关文档：
- [chat-composer-redesign.md](./chat-composer-redesign.md)
- [chat-run-checkpoint.md](./chat-run-checkpoint.md)
- [../insights/chat-composer-redesign.md](../insights/chat-composer-redesign.md)

### Health / Logs / Diagnostics

Health 是 **Observability**，不是“自动修复中心”。

不变量：
- 日志要先脱敏再鼓励用户上传。
- About 入口应提供打开日志文件夹/导出诊断包这类取证动作。
- Doctor/Setup Center 可作为设置向导或辅助探针，不要承诺能诊断真实根因。
- UI 文案避免“深度诊断与修复”这类过度承诺。

相关文档：
- [provider-error-doctor.md](./provider-error-doctor.md)
- [bridge-system.md](./bridge-system.md)

### Memory / Tasks / Heartbeat / Assistant

这些属于 **Memory & Knowledge / Reliability**，但当前成熟度不一致。

边界：
- Context usage 和 context chips 已经是稳定用户路径。
- Memory infrastructure 存在，但自动抽取/管理闭环需要事实核准后再放到用户主导航。
- Scheduled Tasks / Heartbeat / Buddy / Assistant 若代码和计划文档漂移，先 audit，再决定 badge 和入口。
- 不要因为架构图里有 Memory/Task 层，就把半成品功能提前包装成稳定系统功能。

相关文档：
- [memory-system-v3.md](./memory-system-v3.md)
- [context-management.md](./context-management.md)
- [buddy-gamification.md](./buddy-gamification.md)
- [assistant-workspace.md](./assistant-workspace.md)

## 三、改动前判断流程

新增或重构一个能力时，按顺序问：

1. **它是用户入口、执行引擎、工具，还是基础设施？**
   - 用户入口：Chat / Bridge / API
   - 执行引擎：Runtime / Agent
   - 工具：Skills / MCP / CLI / Git / Files
   - 基础设施：Provider / Models / DB / secrets

2. **它是否需要用户每次发送前主动管理？**
   - 不需要：默认隐藏或放进解释面板。
   - 需要：放在 composer 附近，但视觉权重要低于输入框。
   - 只有异常才需要：用 RunCheckpoint / Health 状态。

3. **它能否被 AI 自然调度？**
   - 能：优先作为 skill/MCP/CLI capability，减少常驻按钮。
   - 不能：保留明确 UI 控制。

4. **它是否已经有稳定证据？**
   - 有测试、smoke、日志、真实路径：可以进入主 UI。
   - 只有代码痕迹或计划：先标 preview / audit，不打 stable。

5. **它会不会污染上层心智？**
   - Provider/model 错会污染 Runtime 和 Chat。
   - 插件叫 Agent 会污染 Agent 架构。
   - 假诊断会污染用户信任。

## 四、Do / Don't

Do:
- 把 Provider / Models 当作事实地基维护。
- 把 Skills / MCP / CLI 统一成扩展能力，但保持各自语义。
- 把 Runtime / Agent 作为执行层，不和工具层混名。
- 把 Health / Logs 当作证据和状态，不承诺万能修复。
- 给半成品能力明确 preview/audit 状态。

Don't:
- 不要把 `/v1/models` 大目录当套餐可用模型清单。
- 不要把 MCP/Skill/CLI 包装成 Agent。
- 不要为了减少按钮隐藏权限、安全、上下文成本这类确定性控制。
- 不要把 Memory/Tasks/Heartbeat 的基础设施痕迹直接展示成稳定产品。
- 不要让设置页变成每个内部模块的“入口堆放处”。

## 五、近期重构影响

这份映射直接约束以下正在进行或刚完成的重构：

- **Provider factual baseline**：火山/百炼/DeepSeek/OpenRouter 等模型策略必须回到官方事实。
- **Plugins 整合**：Skills/MCP/CLI 是 Tools & Integrations，不是 Agent。
- **Chat 稳定化**：Composer 保持任务入口，Run 状态只解释，异常才出 checkpoint。
- **Settings cleanup**：Health/About/Runtime/Providers/Models 各自归位，避免重复诊断入口。
- **Future local agents**：Codex/OpenClaw 属于 Agent/Runtime 层，不能塞进 CLI tools 当普通工具看待。
