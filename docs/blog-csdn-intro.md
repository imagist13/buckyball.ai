# buckyball.ai：让 AI Agent 真正学会操作你的硬件工具链

> **今天想琢磨哪个 Ball？** —— _"Which Ball do you want to tinker with today?"_

![bb-ai Web](docs/images/bb-ai.png)

> GitHub：<https://github.com/imagist13/buckyball.ai>

## 一、为什么做 buckyball.ai？

如果你做过 AI 芯片、做过 DSA（Domain-Specific Architecture），或者玩过 RISC-V + 自研加速器，那你大概率遇到过这种场景：

- 写好了一份 `Ball`（buckyball 项目里的一种核），下一步要做 **MLIR 编译 → 综合 → 仿真 → 波形分析 → 上 FPGA**，这一整条链路涉及一堆工具（`bebop`、`bbdev`、`yosys`、`firesim`、`verilator`……）。
- 这些工具各自有各自的 CLI、各自的参数、各自的输出格式。
- 你想用 AI Agent 帮你把这条链路跑起来，结果 Agent **压根不知道这些工具叫什么** —— 因为这些工具不在 Claude / GPT 训练数据里。

[Buckyball](https://github.com/DangoSys/buckyball) 项目本身已经做得非常完整：**bebop** 敏捷仿真器、**bbdev** 编译/验证工具链、MLIR 编译器、多种仿真后端（Verilator / BEMU / P2E / FireSim）、完整的工作流（compiler / workload / kernel / yosys / firesim …）。

问题在于：**buckyball 的工具链和 AI Agent 之间，隔着一堵墙。**

`buckyball.ai`（简称 **bb.ai**）就是来拆这堵墙的。它是一个 **架在 AI Agent 和 Buckyball 工具链之间的 meta-harness**，让任何能对话的大模型，都能立刻变成一个懂 buckyball 的"老司机"。

用一句话概括：

> **Buckyball = 工具链 + 仿真器 + 编译器**  
> **bb.ai    = 教 AI Agent 如何跟这套工具链对话的那一层**

---

## 二、bb.ai 到底干了什么？—— 四件事

bb.ai 不重新造任何轮子，它坐 [Omnigent](https://github.com/databricks/omnigent) 这个开源 Agent 运行时之上，专注于做四件事：

| 步骤 | 干什么 | 关键技术 |
| --- | --- | --- |
| **Discover** | 在本地磁盘上找 buckyball 项目根目录 | 找同时含 `.claude/skills/` 和 `.mcp.json` 的目录 |
| **Load** | 把每个 `SKILL.md` 加载为 Agent 可调用的 skill | UTF-8 安全解析、YAML frontmatter |
| **Mount** | 把 `.mcp.json` 里声明的 MCP 服务器挂载到 Agent 上 | `${VAR}` 环境变量展开、`BUCKYBALL_ROOT` 自动注入 |
| **Expose** | 通过 Web UI 暴露"懂 buckyball 的 Agent" | React + Vite + Tailwind v4 + shadcn/ui |

四步全在 [`omnigent/skills/buckyball/`](https://github.com/imagist13/buckyball.ai/tree/main/omnigent/skills/buckyball) 这一个目录下，全部加起来不到 500 行代码：

```text
omnigent/skills/buckyball/
├── discovery.py     # 从 cwd 向上走 8 层找 buckyball 根
├── loader.py        # SKILL.md → SkillSpec / .mcp.json → MCPServerConfig
└── tests/           # UTF-8-safe 解析 + env-var 展开
```

**没有这个套壳的时候**，你要让 Agent 跑 buckyball 工作流，得自己写 tool calling 协议、注册 MCP server、管理 skill 上下文。**有这个套壳之后**，你只要在 buckyball 项目里照常写 `.claude/skills/ball/SKILL.md` 和 `.mcp.json`，bb.ai 启动的时候会自动发现、加载、挂载，**重启都不用**。

---

## 三、设计哲学：贴着 buckyball 的文件约定走

bb.ai 的核心信条是 **"用文件系统约定代替框架魔法"**。Buckyball 项目需要满足两个标记文件：

```text
<your-buckyball-project>/
├── .mcp.json                    # 声明 MCP 服务器（默认 buckyball-dev）
└── .claude/
    └── skills/<name>/SKILL.md   # 一个或多个 Agent 可调用的 skill
```

bb.ai 启动时会 **从 Agent 的当前工作目录向上走最多 8 层**，找这样的根。一旦找到，它就：

- 把每个解析出的 `SkillSpec` 追加到 `AgentSpec.skills`
- 把每个解析出的 `MCPServerConfig` 追加到 `AgentSpec.mcp_servers`
- 按名字去重，bb.ai 自带的 skill 在冲突时优先

这种设计的妙处在于：

1. **零迁移成本**：你已有的 buckyball 项目不用改一行代码。
2. **多项目并存**：你可以在同一台机器上同时打开多个 buckyball 项目，每个项目用自己的 skill 集。
3. **冷热可分离**：bb.ai 自带的 skill 永远是最新版本，项目里的 skill 可以随项目迭代。

---

## 四、快速上手：从 0 到跑通一次 vecunit matmul 仿真

> 前置条件：Python ≥ 3.12、Node.js ≥ 20 + pnpm、一个 buckyball 项目根目录（带 `.mcp.json` 和 `.claude/skills/`）、可选的 `uv` / `just` / `pre-commit`。

```bash
# 1. 拉 bb.ai
git clone https://github.com/imagist13/buckyball.ai.git
cd buckyball.ai

# 2. 装 Python 依赖
uv sync --extra all --extra dev

# 3. 装 web 依赖
cd web && pnpm install && cd ..

# 4. 准备 buckyball 项目（如果你还没有）
git clone https://github.com/DangoSys/buckyball.git ~/bb-work/buckyball
cd ~/bb-work/buckyball
nix develop            # 把 buckyball-dev MCP server (stdio) 拉起来
```

起两个终端，分别跑后端和前端：

```bash
# Terminal A — omnigent 后端（默认端口 6767）
.venv/bin/omnigent server

# Terminal B — Vite 开发服务器（默认端口 5173）
cd buckyball.ai/web
pnpm run dev
```

打开 <http://localhost:5173>，就能看到上图那个 Web UI 了。

试试输入：

> _"Run a vecunit matmul simulation on the toy chip."_

Agent 会在后台依次调用 `bbdev_bebop_verilator_run` 之类的工具，把 `build → sim` 整条链路跑起来，最后把结果返回给你。

---

## 五、怎么把 bb.ai 接到自己的 buckyball 项目？

两步：

### 1. 在项目根放一个 `.mcp.json`

模板直接抄 buckyball 参考项目：

```json
{
  "mcpServers": {
    "buckyball-dev": {
      "command": "bash",
      "args": ["${BUCKYBALL_ROOT}/scripts/claude/run_mcp_server.sh"],
      "env": { "NIX_QUIET": "1" },
      "description": "Buckyball compile/verify toolchain (33 bbdev_* MCP tools)",
      "cwd": "${BUCKYBALL_ROOT}"
    }
  }
}
```

注意 `${BUCKYBALL_ROOT}` 这种写法 —— bb.ai 在解析 `.mcp.json` 的时候会 **自动把它展开为当前项目的绝对路径**，并把现有进程环境覆盖在它上面。漏写一个变量会立刻报 `KeyError`，不会留下静默的烂摊子。

### 2. 在 `.claude/skills/<name>/SKILL.md` 里写 skill

```yaml
---
name: my-skill
description: 短描述 —— Agent 用它来决定什么场景下调用
user-invocable: true
---

# Markdown 正文
```

启动 bb.ai 时，它会走完上述"发现 → 加载 → 挂载 → 暴露"四步。每次新建 `AgentSpec` 都会重新跑 `find_buckyball_roots`，所以 **不用重启就能加载新 skill**。

---

## 六、程序化访问：Python SDK

不想点 Web UI？直接用 SDK：

```python
from omnigent_client import Omnigent

client = Omnigent(server_url="http://localhost:6767")

# 列出已注册的 agent
agents = client.agents.list()

# 开一个会话 —— Agent 会自动捡到 cwd 上面的 buckyball 项目根
session = client.sessions.create(agent=agents[0].name)
session.send("Run a matmul sim on toy and dump the waveform")
for chunk in session.stream():
    print(chunk.text, end="")
```

`pip install omnigent-client==0.9.0.dev0` 就能装上。

---

## 七、部署：从本地到生产

bb.ai 自带一堆现成的部署配置，全在 [`deploy/`](https://github.com/imagist13/buckyball.ai/tree/main/deploy) 下：

| 平台        | 路径                       |
| ----------- | -------------------------- |
| Docker      | `deploy/docker/`           |
| Kubernetes  | `deploy/kubernetes/`       |
| Railway     | `deploy/railway/`          |
| Render      | `deploy/render/`           |
| Databricks  | `deploy/databricks/`       |
| Tailscale   | `deploy/tailscale/`        |

每个子目录都有自己的 README 和平台清单，但都遵守同一份契约：

> **设一个 `BUCKYBALL_ROOT` 环境变量，指向一个或多个已经准备好的 buckyball 项目根。bb.ai 启动时会自动加载。**

Docker 是生产推荐路径：

```bash
cd deploy/docker
cp .env.example .env
# 编辑 .env，把 BUCKYBALL_ROOT 指向你真实的 buckyball 项目根

docker compose up -d
```

就这一条命令，后端、反向代理、健康检查全拉起来。

---

## 八、它解决了什么真实痛点？

把它当成工具栏来对比一下：

| 场景                       | 没有 bb.ai                       | 有 bb.ai                          |
| -------------------------- | -------------------------------- | --------------------------------- |
| 让 Agent 跑 buckyball 仿真 | 自己写 MCP server 注册 + tool 描述 | 写好 `.mcp.json` 就行            |
| 切换 buckyball 项目        | 改代码、改配置、重启             | 切个目录就行，自动发现            |
| 给 Agent 加新能力           | 改 Python 代码                   | 加一个 `SKILL.md`                  |
| 团队共享一套 Agent 配置    | 文档/Slack/口头传达              | `.claude/skills/` 目录进 git      |
| 跨平台协作                 | "在我机器上能跑"                | 文件系统约定，Windows / Linux 都能跑 |

最让我个人满意的一点是 **UTF-8 安全性**：在中文 / 日文 / 韩文 Windows 机器上，默认的 `Path.read_text()` 编码是系统代码页（cp936 / cp1252），会**静默地损坏** UTF-8 文件。bb.ai 的 `loader.py` 强制用 `encoding="utf-8"` 读取 SKILL.md，第一次用就不会踩坑。

---

## 九、写在最后

`buckyball.ai` 不是要替代 buckyball，也不是要替代 Omnigent。它就是薄薄一层适配，把 AI Agent 和 buckyball 工具链连起来。如果你已经在用 buckyball 做 DSA，今天就能 5 分钟接上；如果还没试过，也可以拿 bb.ai 当一个 **"看得见的 Agent demo"** 来感受一下未来 AI + 硬件协同开发的形态。

仓库地址：<https://github.com/imagist13/buckyball.ai>

欢迎提 Issue、PR、或者在评论区聊聊你用 AI Agent 跑硬件工具链的经验。

> "今天想琢磨哪个 Ball？"
