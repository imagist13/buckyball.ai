# Skills 调用审查报告（项目 vs Claude Agent SDK）

日期：2026-03-10

本报告已对照 Anthropic 官方文档复核：

- [Agent Skills](https://platform.claude.com/docs/en/agent-sdk/skills)
- [Slash Commands](https://platform.claude.com/docs/en/agent-sdk/slash-commands)

## 结论

当前项目把两套本来不同的官方机制混成了一个“Skills”功能：

1. Agent Skills：官方文档定义为 `.claude/skills/*/SKILL.md` 这类 filesystem-based skills，由 SDK/Claude Code 加载后，Claude 在相关时机自主决定是否使用。
2. Slash Commands：官方文档定义为 `.claude/commands/*.md` 这类 `/command` 命令，用户通过显式输入 `/command` 调用。

而项目当前的主问题是：

1. 前端把 Agent Skills、filesystem slash commands、SDK slash commands 混成一个列表和一套 badge 逻辑。
2. 提交时没有区分官方原生路径，而是统一走“读取 markdown -> 展开正文 -> 作为普通用户消息发送”。
3. SDK 返回的 slash commands 在补充上下文时还可能直接丢失 `/command` 本体。

这三点可以直接解释你观察到的现象：

- 同样模型、同样 Skills，效果不如 Claude Code。
- 聊天窗口里没有“技能调用”UI，而是直接出现 `SKILL.md` 文案。

## 主要发现

### [P0] Agent Skills 和 Slash Commands 被混成了一套 UI / 数据模型

证据：

- [src/app/api/skills/route.ts](/Users/op7418/Documents/code/opus-4.6-test/src/app/api/skills/route.ts#L320)
- [src/components/chat/MessageInput.tsx](/Users/op7418/Documents/code/opus-4.6-test/src/components/chat/MessageInput.tsx#L483)
- [src/components/chat/MessageInput.tsx](/Users/op7418/Documents/code/opus-4.6-test/src/components/chat/MessageInput.tsx#L551)

当前实现：

- `/api/skills` 同时扫描：
  - `.claude/commands`
  - `.claude/skills`
  - `~/.claude/skills`
  - `~/.agents/skills`
  - 再合并 SDK 的 `supportedCommands()`
- MessageInput 把这些项目统一当成一种“skill badge”来处理。

但官方文档里，这至少是两套不同机制：

- Agent Skills：来自 `.claude/skills`，由 Claude 自主调用。
- Slash Commands：来自 `.claude/commands`，由用户显式发送 `/command` 调用。

影响：

- UI 展示的“Skills”本身就不是官方语义。
- 后续提交、渲染、状态展示都无法做正确分流。
- 项目从概念层已经和 Claude Code 本体偏离。

### [P0] `.claude/skills/*/SKILL.md` 没有走官方 Agent Skills 路径，而是被前端展开成普通 prompt 文本

证据：

- [src/components/chat/MessageInput.tsx](/Users/op7418/Documents/code/opus-4.6-test/src/components/chat/MessageInput.tsx#L685)
- [src/components/chat/MessageInput.tsx](/Users/op7418/Documents/code/opus-4.6-test/src/components/chat/MessageInput.tsx#L711)
- [src/lib/provider-resolver.ts](/Users/op7418/Documents/code/opus-4.6-test/src/lib/provider-resolver.ts#L488)

当前实现：

- 选中 `.claude/skills/*/SKILL.md` 项目后，前端请求 `/api/skills/:name` 读取 `SKILL.md` 全文。
- 然后把它拼成：
  - `expandedPrompt`
  - 或 `expandedPrompt + "\n\nUser context: ..."`
- 最后直接作为 `content` 发给 `/api/chat`。

但官方 Skills 文档描述的是另一条路径：

- Skills 是 filesystem-based。
- 通过 `settingSources` 从 `~/.claude/skills` / `project/.claude/skills` 加载。
- Claude 会在相关时机自主决定是否使用 Skill。
- SDK 没有和 subagent 对等的“程序化注册 Skills API”。

所以 `.claude/skills` 这条线，不应该在前端被展开成一段普通用户消息；那已经不是 SDK-native Agent Skill 调用了。

影响：

- Claude 对 Agent Skill 的原生选择和上下文组织被绕开。
- `SKILL.md` 的说明文本退化成普通用户输入，提示词污染更重。
- 当前实现更像“把技能文档贴给模型”，而不是“让 Claude 使用 skill”。

### [P0] Slash Command 可以在 UI 里看到，但提交时经常不会真正执行

证据：

- [src/app/api/skills/route.ts](/Users/op7418/Documents/code/opus-4.6-test/src/app/api/skills/route.ts#L323)
- [src/components/chat/MessageInput.tsx](/Users/op7418/Documents/code/opus-4.6-test/src/components/chat/MessageInput.tsx#L551)
- [src/components/chat/MessageInput.tsx](/Users/op7418/Documents/code/opus-4.6-test/src/components/chat/MessageInput.tsx#L689)
- [src/components/chat/MessageInput.tsx](/Users/op7418/Documents/code/opus-4.6-test/src/components/chat/MessageInput.tsx#L711)
- [src/app/api/skills/[name]/route.ts](/Users/op7418/Documents/code/opus-4.6-test/src/app/api/skills/%5Bname%5D/route.ts#L154)
- [src/app/api/skills/[name]/route.ts](/Users/op7418/Documents/code/opus-4.6-test/src/app/api/skills/%5Bname%5D/route.ts#L267)

当前实现：

- `/api/skills` 会把 SDK 的 `supportedCommands()` 结果合并进列表。
- 但选中后，MessageInput 统一走“拉取 skill 文件内容”的路径。
- `/api/skills/[name]` 实际只认识 project/global/installed skill 文件，不认识 SDK command。

所以当用户选中一个 SDK command：

- 如果用户还补了上下文，`expandedPrompt` 取不到内容，最终发送的是 `"\n\nUser context: xxx"`。
- 真正的 `/command` 本体丢了。
- 如果没有补上下文，才会退化成发 `badge.command`。

这属于执行级 bug，不只是体验问题。

### [P1] 聊天 UI 没有“技能调用”状态，是因为显示层拿到的就是展开后的正文

证据：

- [src/components/chat/ChatView.tsx](/Users/op7418/Documents/code/opus-4.6-test/src/components/chat/ChatView.tsx#L532)
- [src/components/chat/MessageInput.tsx](/Users/op7418/Documents/code/opus-4.6-test/src/components/chat/MessageInput.tsx#L718)

`ChatView.sendMessage()` 会把传入的 `content` 直接 optimistic render 成用户消息。  
而 skill / command 提交时传进去的就是展开后的 `finalPrompt`，不是“已选 Agent Skill”或“/command + 参数”的结构化调用信息。

因此前端不可能渲染出“技能胶囊 / 技能调用卡片 / slash command 状态”，因为从数据层开始，这次调用已经被降级成一段普通文本了。

### [P1] 前端的技能来源和 SDK 当前会话的真实可用项并不一致

证据：

- [src/lib/agent-sdk-capabilities.ts](/Users/op7418/Documents/code/opus-4.6-test/src/lib/agent-sdk-capabilities.ts#L100)
- [src/lib/claude-client.ts](/Users/op7418/Documents/code/opus-4.6-test/src/lib/claude-client.ts#L797)
- [src/types/index.ts](/Users/op7418/Documents/code/opus-4.6-test/src/types/index.ts#L389)
- [node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts](/Users/op7418/Documents/code/opus-4.6-test/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L1798)

SDK 在 `system:init` 和 `supportedCommands()` 里都能返回当前会话的 commands / skills 信息。  
但项目目前的处理是：

- `claude-client.ts` 收到 `system:init` 后，只转发了 `session_id/model/tools`。
- SSE 类型里也没有承载 init skills/commands 的事件。
- UI 主要依赖手工扫描文件系统，再补一份 capability cache。

这意味着：

- UI 展示的列表不一定等于当前 SDK session 真实可用的 commands / skills。
- 插件、settings source、provider scope、会话初始化状态变化，前端都可能感知不全。

### [P1] `~/.claude/skills` 的显示结果，和 SDK 实际加载结果很可能不一致

证据：

- [src/app/api/skills/route.ts](/Users/op7418/Documents/code/opus-4.6-test/src/app/api/skills/route.ts#L320)
- [src/lib/provider-resolver.ts](/Users/op7418/Documents/code/opus-4.6-test/src/lib/provider-resolver.ts#L488)

当前前端列表会直接扫描：

- `~/.claude/commands`
- `project/.claude/commands`
- `project/.claude/skills`
- `~/.agents/skills`
- `~/.claude/skills`

但官方 Skills 文档明确要求：要从 filesystem 加载 skills，需要把 `settingSources` 设成包含 `user` / `project`。  
而项目当前在 provider 有凭证时会把 `settingSources` 设成 `['project', 'local']`，跳过 `'user'` source。

基于官方文档，这里可以做出较强推断：

- UI 扫描到了 `~/.claude/skills`，不代表 SDK session 真的加载到了这些 Agent Skills。
- 当前 provider 配置下，user-level Agent Skills 很可能根本没有进入 Claude 的真实技能上下文。

另外，官方文档里我没有看到 `~/.agents/skills` 这个路径；这说明它至少不是 Anthropic 文档里的标准 Skills 路径。

### [P2] 项目里有 Agent SDK 原生 agent/skill preload 入口，但聊天主链路没有用到

证据：

- [node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts](/Users/op7418/Documents/code/opus-4.6-test/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts#L33)
- [src/lib/agent-sdk-agents.ts](/Users/op7418/Documents/code/opus-4.6-test/src/lib/agent-sdk-agents.ts#L1)
- [src/lib/claude-client.ts](/Users/op7418/Documents/code/opus-4.6-test/src/lib/claude-client.ts#L414)

SDK 的 `AgentDefinition` 原生支持：

- `prompt`
- `tools`
- `disallowedTools`
- `skills?: string[]`

项目里也有 `agent-sdk-agents.ts` registry，但只是“未来集成”的壳，聊天主链路没有把这套能力真正接起来。

这不是当前 UI 泄漏的直接原因，但说明项目现在并没有充分使用 SDK-native agent/skill orchestration。

## 项目当前实现 vs Agent SDK 原生语义

| 维度 | 当前项目 | Claude Agent SDK / Claude Code |
|---|---|---|
| Agent Skills (`.claude/skills`) | 扫描后把 `SKILL.md` 展开成用户 prompt | SDK 从 filesystem 加载，Claude 自主决定是否使用 |
| Slash Commands (`.claude/commands`) | 也混在同一列表里，且可能被展开或丢失 `/command` | 用户显式发送 `/command ...`，Claude Code 解析执行 |
| UI 数据模型 | 两套机制混成一个“Skills” | Skills 和 Commands 是不同概念 |
| 列表来源 | 手工扫文件 + 缓存 commands | SDK session 自身可报告当前支持的 commands / skills |
| `~/.claude/skills` 加载 | UI 扫到就显示 | 需要 `settingSources` 包含 `user` |
| `~/.agents/skills` | 当成 installed skills 暴露给 UI | 官方 Skills 文档未见该标准路径 |

## 为什么现在效果会比 Claude Code 差

核心不是模型差，而是调用协议变了。

一旦把 Agent Skills 和 Slash Commands 都降级成“展开 markdown 后发普通用户消息”，至少会丢掉这些东西：

- Agent Skill 的原生加载和自主调用语义。
- Slash Command 的显式命令语义。
- `SKILL.md` / `/command` 和用户补充上下文之间的边界。
- 会话级真实 command inventory。
- 前端对“这是一次技能/命令调用”的识别能力。
- Agent Skills 和 Slash Commands 的区分。

结果就是：

- 模型读到更多噪声文本。
- 同一份技能/命令在 Claude Code 里表现更稳定，在这里更像“临时拼 prompt”。
- UI 和真实执行状态脱节。

## 建议的修复顺序

### 1. 先把 Agent Skills 和 Slash Commands 拆成两条执行链路

目标：

- `.claude/skills` 走 Agent Skills 语义。
- `.claude/commands` / SDK commands 走 Slash Commands 语义。
- 不再共用“选中条目 -> 拉详情 -> 展开 markdown -> 发送”的逻辑。

### 2. 不要再在前端展开 `SKILL.md`

目标：

- 对于 Agent Skills，不要读取 `SKILL.md` 全文再拼成用户消息。
- 应优先依赖 SDK-native filesystem loading + official skills path。

不要再把 `data.skill.content` 塞进 `content`。

### 3. Slash Command 必须原样提交 `/command`

建议把当前 badge/item 拆成至少四类：

- `builtin_prompt_command`
- `agent_skill`
- `filesystem_slash_command`
- `sdk_slash_command`

其中 slash command 的提交目标应该是：

- `/review`
- `/review src/foo.ts`
- `/foo-bar 用户补充参数`

而不是 command markdown 正文。

### 4. 调用的显示和真实 prompt 分离

利用已有的 `displayOverride` 或新增结构化 message metadata：

- UI 显示：`/command`、用户参数、或“已选择 Agent Skill”
- 实际发送：对应的原生调用形式

不要把展开后的系统说明显示到聊天气泡里。

### 5. 让 SDK session 成为可用 commands / skills 的真源

更合理的来源优先级：

1. 当前活跃 SDK session 的 `supportedCommands()` / init metadata
2. 会话未建立前，再考虑本地扫描做 fallback

不要让“手工扫描文件系统”长期作为主真源。

### 6. 给 `system:init` 增加专门事件，把 skills / commands 下发给前端

当前 `system:init` 被截断得太狠。建议至少把这些字段透出：

- `slash_commands`
- `skills`
- `plugins`
- `output_style`

这样 UI 才能知道当前 session 真正有哪些条目可用。

### 7. 修正 `settingSources`，保证 user-level Agent Skills 能真正进入 SDK session

至少在需要加载 `~/.claude/skills` 时，要和官方 Skills 文档对齐：

- `settingSources` 需要包含 `user`
- 否则 UI 看得到，Claude 实际用不到

### 8. 如果后续要做 SDK-native agent，别再继续用“系统 prompt 注入”模拟

现在 `agent-sdk-agents.ts` 已经有骨架。  
如果产品目标是接近 Claude Code 本体，后续应该优先使用：

- `agent`
- `agents`
- `AgentDefinition.skills`

而不是继续叠更多 markdown prompt 片段。

## 建议 ClaudeCode 直接改的点

建议先按下面顺序改：

1. 改 [src/components/chat/MessageInput.tsx](/Users/op7418/Documents/code/opus-4.6-test/src/components/chat/MessageInput.tsx)
   - 先区分 `agent_skill`、`filesystem_slash_command`、`sdk_slash_command`。
   - slash command 选择后，提交 `/command` 本体。
   - Agent Skill 不再请求详情并展开正文。
2. 改 [src/app/api/skills/route.ts](/Users/op7418/Documents/code/opus-4.6-test/src/app/api/skills/route.ts)
   - 列表返回明确的 `kind/source`，区分 Agent Skill、Slash Command、SDK command。
3. 改 [src/app/api/skills/[name]/route.ts](/Users/op7418/Documents/code/opus-4.6-test/src/app/api/skills/%5Bname%5D/route.ts)
   - 只为“真的需要查看文件正文”的条目提供详情；SDK command 和 Agent Skill 都不应依赖这里展开执行。
4. 改 [src/lib/claude-client.ts](/Users/op7418/Documents/code/opus-4.6-test/src/lib/claude-client.ts)
   - 转发 `system:init` 的 commands/skills 元数据。
5. 改 [src/lib/provider-resolver.ts](/Users/op7418/Documents/code/opus-4.6-test/src/lib/provider-resolver.ts)
   - 结合官方 Skills 文档重新审视 `settingSources`，不要把 user-level Agent Skills 扫出来但又不加载到 SDK session。
6. 改 [src/types/index.ts](/Users/op7418/Documents/code/opus-4.6-test/src/types/index.ts) 和 [src/hooks/useSSEStream.ts](/Users/op7418/Documents/code/opus-4.6-test/src/hooks/useSSEStream.ts)
   - 增加对应 SSE event/type。
7. 补测试
   - “选中 Agent Skill”不再把 `SKILL.md` 文本显示进聊天窗口。
   - “选中 filesystem slash command + 输入上下文”实际发送的仍然是 `/command ...`。
   - “选中 SDK command + 输入上下文”实际发送的仍然是 `/command ...`。
   - `/api/skills` 返回 SDK command 时，不会再被 `/api/skills/[name]` 错误处理。

## 最终判断

这不是“Claude Code 比你们模型调得更好”这么简单。  
更准确地说，是你们现在把 Anthropic 官方文档里两套不同的机制混在一起，并统一降级成了 markdown prompt 注入。

只要这一层不改，同模型同技能/命令的效果很难对齐 Claude Code 本体。
