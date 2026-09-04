# bbagent 注入层产品思考

> 技术实现见 [docs/handover/bb-agent-injection.md](../handover/bb-agent-injection.md)

## 1. 为什么 buckyball.ai 是"CodePilot 二开 fork"而不是"CodePilot 垂直定制版"

第一版 `chatnpu-design-proposal.md` 把 buckyball 定位为"CodePilot 的垂直领域定制版本"+ 新增独立 `bbdev_runtime`。这条路有两个根本问题：

1. **重复实现**：bbdev Runtime 要重写 Runtime 适配层、Provider 模型、Sessions、MCP、Permissions……大量 CodePilot 已有的能力被复刻。
2. **升级灾难**：fork 一旦走上独立 Runtime 路线，每次上游 CodePilot 升级都得做 runtime 抽象层适配，n 个 release 之后必然 drift 到无法合并。

第二版（当前）把 buckyball.ai 定位成 **CodePilot fork + 改名 + 在已有 Runtime 上挂注入层**：

- **完整复用** CodePilot 上游全部通用多模型 Agent 能力（Runtime 切换、Provider、Workspace、Plugins、Bridge、Markdown、Artifact、Dashboard、Widget、Sentry、自动更新、CLI maintenance）。
- **集中魔改**在 `src/lib/bbagent/`：MCP / Skill / Prompt 三注入点。
- **Runtime 改造点**只有一行 `applyBbInjection(...)`，不侵入 Runtime 内部。
- **砍掉两个不相关能力**：图像生成、个人助手，用 feature flag 隐藏（不删代码）。

这等于把"buckyball.ai"做成了 CodePilot 的一个**窄 fork**：用户拿到的就是 CodePilot 换皮版，但硬件开发场景下多了 BB 工具集 + chip context + 工作流约定。

## 2. 为什么"为 Runtime 注入"是核心

CodePilot 是通用 AI Agent 桌面客户端。它给了 buckyball.ai 三件最值钱的基础设施：

1. **三 Runtime 抽象**：Native（自建 AI SDK loop）/ Claude Code（Anthropic SDK fork）/ Codex（OpenAI app-server）。buckyball.ai 不需要选边，每条 Runtime 路径都能挂 BB 注入。
2. **Skill 系统**：Claude Code 原生读 `~/.claude/skills/`，Codex 原生读 `.agents/skills/`，fork 模式 + allowed-tools 限制可避免子 Agent 误用其他工具。这意味着"给硬件开发提供受限工具集"是上游已经支持的语义，buckyball.ai 只需要写一份 SKILL.md。
3. **MCP 连接管理**：`McpConnectionManager` 已经会管 stdio / SSE 生命周期，bbdev 复用即可。

"为 Runtime 注入"的本质是把 BB 能力**寄生**到上游 Runtime 抽象上，而不是与之竞争。**核心价值 = 寄生点的设计**：哪些时点注入、注入什么、失败如何降级。这一段决定了 fork 是否能持续跟上上游升级。

## 3. 为什么改名 `buckyball.ai` 而不是保留 `codepilot`

- 二开用户对"应用叫什么"有明确预期（chip 开发者看到自己的工具名）。
- 改名是廉价但关键的 brand 动作：About 页、productName、env var 全部用 buckyball，避免误安装到 CodePilot 正版用户的环境。
- 包名 `buckyball` 而非 `buckyball-ai`，避免与官网域名冲突。

但**不改上游内部标识符**（如内部变量名、注释、git commit 历史），因为这些不是用户可见层，重写成本高而收益极低。

## 4. 为什么 `~/.codepilot/` → `~/.buckyball/` 必须做

- **品牌一致性**：目录名是 OS 可见的强信号；保留 `~/.codepilot/` 会让用户怀疑自己装错了应用。
- **冲突避免**：CodePilot 正版用户与 buckyball.ai fork 用户在同台机器共存时（开发 / 验证场景），目录名错开能彻底隔离两者数据。
- **迁移而非复制**：旧 `~/.codepilot/` 一次性迁移到新目录，旧 env `CLAUDE_GUI_DATA_DIR` 兼容两个 release 再删，避免破坏旧用户的脚本与文档。

## 5. 为什么图像生成 / 个人助手下线而不是删代码

**删代码 = 高风险 + 难回滚**：

- 图像生成牵连 `image-generator.ts` / `image-gen-mcp.ts` / `xai-imagine.ts` / `/api/media/generate` 路由 / Composer 按钮 / Chat 消息 action / Settings 媒体项；任何一处残留引用都可能在 fork 升级时炸。
- 个人助手牵连 AssistantWorkspace / Heartbeat / Buddy / Settings / Onboarding / 左侧栏；同样是一张大网。

**Feature flag 默认 false = 零回归 + 可回滚**：

- 路由入口 410 Gone；UI 入口隐藏；数据保留。
- 用户从 CodePilot 正版升级过来，旧的生成图片、Assistant 配置还在；他们想用时可以通过高级开关重开（实验性）。
- 上游如果某天删了某个 API 路径，buckyball.ai 的 feature flag 路由直接 410，对用户是"已知下线"而非"诡异崩溃"。

后续真的确认没用户用、再把代码删掉。这是 **defer 决策，不 defer 工作**。

## 6. 已知局限与未来方向

### 6.1 fork drift

CodePilot 上游节奏不可控；bbagent 集中改动降低风险，但**长期看应该与上游约定 backport 通道**——bbagent 注入层有可能被上游采纳为"第三方 Runtime 接入点"的标准形态。

### 6.2 三 Runtime 不对齐

- Native：full control（MCP + prompt fragment）
- Claude Code：MCP + Skill
- Codex：per-thread mcp + Skill

三者的"BB context"传递粒度不同：Claude Code 通过 system 字段；Codex 通过 `instructions`；Native 通过 system prompt 拼接。**接受这种不对齐，不强求统一**——三 Runtime 的语义本来就不同。

### 6.3 远程 bbdev 暂缓

v0 阶段只支持本地 stdio；远程 SSE / OAuth / SSH 隧道留给后续 Phase。bbdev 的远程服务器本身是 bbdev 子项目的责任，buckyball.ai 只是消费方。

### 6.4 二开定位的"窄"

buckyball.ai 当前只挂 bbdev。如果未来要做"第二个 fork 用户"（比如 CodePilot × 别的垂直工具集），bbagent 注入层结构可以复用——把 `bbdev` 换成 `bb<other>` 即可。这是**为后续 fork 用户预留的扩展点**。

## 7. 反模式与拒绝的方案

- **复制 CodePilot 上游 Runtime 抽象层**：增加维护成本，无用户收益。
- **新增独立 `bbdev_runtime` Runtime**：与 Native Runtime 重复；fork 升级灾难。
- **直接修改 agent-loop.ts 内部**：侵入 Runtime，黑盒扩散，无法集中。
- **删除图像生成 / 个人助手代码**：删干净很容易，但回滚极难；feature flag 隐藏已经满足产品定位。
- **保留 `~/.codepilot/` 路径**：品牌冲突，用户误装混淆。
- **换包名到 `buckyball-ai`**：与官网域名混淆。
