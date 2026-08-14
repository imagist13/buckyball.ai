# buckyball.ai

> 今天想琢磨哪个 Ball？

![bb.ai Web](docs/images/bb-ai.png)

[🇬🇧 English version](./README.md)

## 它是什么

**buckyball.ai**（下称 **bb.ai**）是面向 [Buckyball](https://github.com/DangoSys/buckyball) 项目的 **外部 AI Meta Harness**。

Buckyball 是一个面向 **DSA（Domain-Specific Architecture）** 的开源硬件加速器框架，包含 bebop 仿真器、bbdev 编译/验证工具链、MLIR 编译器、Verilator / BEMU / P2E / FireSim 多种仿真后端，以及覆盖 compiler / workload / kernel / yosys / firesim 的完整工作流。bb.ai 自身不重新实现任何硬件工具链，它做的事情是：

- **发现**本地或远程的 Buckyball 项目根（同时包含 `.claude/skills/` 与 `.mcp.json`）；
- **加载**该项目里所有 `SKILL.md`（如 `/ball`、`/bbdev`、`/verify`、`/waveform`）作为 Agent 可调用的 Skill；
- **挂载**该项目 `.mcp.json` 中声明的 MCP Server（默认 33 个 `bbdev_*` 工具 + waveform-mcp）；
- **在 Web UI** 里把这个 Agent 暴露给用户，让用户用自然语言驱动整个 DSA 流程 —— 写 Ball、编 MLIR、综合、跑波形、上 FPGA，全部由对话完成。

简而言之：

> **Buckyball = 工具链 + 仿真器 + 编译器**
> **bb.ai = 让 AI Agent 读懂工具链、把工具链交给人聊的那一层**

bb.ai 的运行时基于 [Omnigent](https://github.com/databricks/omnigent) 框架；其核心注册逻辑见 [`omnigent/skills/buckyball/`](omnigent/skills/buckyball/)，它把 buckyball 项目的 filesystem marker（`.claude/skills/` + `.mcp.json`）转换成 `AgentSpec` 上的 `SkillSpec` + `MCPServerConfig`。

---

## 仓库组成

```
buckyball.ai/
├── omnigent/                    # 底层 Agent 运行时（fork 自 omnigent）
│   ├── skills/
│   │   └── buckyball/           # ★ bb.ai 的核心
│   │       ├── discovery.py     #   扫描 .claude/skills/ + .mcp.json
│   │       ├── loader.py        #   SKILL.md → SkillSpec
│   │       │                    #   .mcp.json  → MCPServerConfig
│   │       └── tests/           #   全 UTF-8 鲁棒 + env-var 展开
│   ├── server/                  # FastAPI 服务 /v1/agents, /v1/sessions
│   ├── runtime/                 # 推理循环、工具调度
│   ├── repl/                    # 终端 REPL
│   └── tools/                   # 本地 / MCP 工具
├── web/                         # React + Vite + Tailwind v4 + shadcn/ui
│                               # （即上方截图的 Web 端）
├── deploy/                      # 多种部署目标（Docker / Fly / K8s / Cloudflare / Databricks…）
├── docs/
│   └── images/bb-ai.png         # README 顶图
├── examples/                    # 预置 Agent 示例
└── sdks/                        # Python Client & UI SDK
```

它要消费的对象在另一个仓库：[DangoSys/buckyball](https://github.com/DangoSys/buckyball)，结构上至少需要这两份标记文件：

```
<your-buckyball-project>/
├── .mcp.json                    # 注册 buckyball-dev 等 MCP server
└── .claude/
    └── skills/<name>/SKILL.md   # 注册可被 Agent 调用的 Skill
```

bb.ai 启动时会沿 cwd 向上 8 层自动发现这样的根。

---

## 快速部署 & 使用

下面给出最常见的两种使用方式：本地开发模式（推荐起步）以及远程部署模式。

### 0. 前置依赖

- Python ≥ 3.12
- Node.js ≥ 20，pnpm
- 一个 **buckyball 项目根**（带 `.mcp.json` 与 `.claude/skills/`），或自己 clone [DangoSys/buckyball](https://github.com/DangoSys/buckyball) 之后 `nix develop` 起来
- 可选：`uv`、`just`、`pre-commit`

### 1. 本地开发模式（推荐）

```bash
# 1. 克隆 bb.ai
git clone https://github.com/your-org/buckyball.ai.git
cd buckyball.ai

# 2. 安装 Python 依赖
uv sync --extra all --extra dev

# 3. 安装 Web 依赖
cd web && pnpm install && cd ..

# 4. 准备一份 buckyball 项目（如果还没有）
#    bb.ai 会在 Agent 的 cwd 中向上 8 层搜索 .claude/skills/ + .mcp.json
git clone https://github.com/DangoSys/buckyball.git ~/bb-work/buckyball
cd ~/bb-work/buckyball
nix develop            # 让 buckyball-dev MCP server 在 stdio 后端跑起来
```

启动后端 + 前端（两个终端）：

```bash
# 终端 A：omnigent server（默认 6767）
.venv/bin/omnigent server

# 终端 B：Vite dev server（默认 5173）
cd buckyball.ai/web
pnpm run dev
```

打开 <http://localhost:5173> —— 你会看到上方那张图。

**试着说一句**："用 toy 芯片跑一下 vecunit matmul 仿真"，Agent 会自动调用 `bbdev_bebop_verilator_run` 等 MCP 工具，把整个 build → sim 跑完再回你。

### 2. 远程 / 多人部署模式

bb.ai 内置了多种部署配置（`deploy/`），推荐生产场景使用 Docker：

```bash
cd deploy/docker
cp .env.example .env
# 编辑 .env：填 BUCKYBALL_ROOT 指向你真实的 buckyball 项目根

# 启服务（omnigent server + 反代 + 健康检查）
docker compose up -d
```

其他已就绪的目标：

| 平台        | 路径                       |
|-------------|----------------------------|
| Docker      | `deploy/docker/`           |
| Kubernetes  | `deploy/kubernetes/`       |
| Fly.io      | `deploy/fly/`              |
| Railway     | `deploy/railway/`          |
| Render      | `deploy/render/`           |
| Cloudflare  | `deploy/cloudflare/`       |
| HF Spaces   | `deploy/hf-spaces/`        |
| Databricks  | `deploy/databricks/`       |

每个子目录都有自己的 `README.md` 与平台 manifest，遵循同一份契约：

> **环境变量 `BUCKYBALL_ROOT` 指向一个或多个已就绪的 buckyball 项目根，bb.ai 启动时自动加载。**

### 3. 给自己的 buckyball 项目加 bb.ai 接入

仅需两步：

1. 在项目根写一份 `.mcp.json`（参考 bb.ai 注册的 buckyball 模板）：

   ```json
   {
     "mcpServers": {
       "buckyball-dev": {
         "command": "bash",
         "args": ["${BUCKYBALL_ROOT}/scripts/claude/run_mcp_server.sh"],
         "env": { "NIX_QUIET": "1" },
         "description": "Buckyball 编译/验证工具链（33 个 bbdev_* MCP 工具）",
         "cwd": "${BUCKYBALL_ROOT}"
       }
     }
   }
   ```

2. 把 skill 写到 `.claude/skills/<name>/SKILL.md`，frontmatter 形如：

   ```yaml
   ---
   name: my-skill
   description: 简短描述，Agent 用来决定何时调用
   user-invocable: true
   ---

   # Markdown 正文
   ```

启动 bb.ai 后，它会沿 cwd 向上扫描到你的项目根，把所有 `SKILL.md` 注入 `AgentSpec.skills`、把 `.mcp.json` 里的 server 注入 `AgentSpec.mcp_servers`（同名去重，bb.ai 自带 skill 优先）。整个流程无需重启 —— `find_buckyball_roots` 在每次 spec 构建时执行。

### 4. 编程式接入

bb.ai 同时提供 Python SDK 与 UI SDK：

```bash
pip install omnigent-client==0.9.0.dev0
```

```python
from omnigent_client import Omnigent

client = Omnigent(server_url="http://localhost:6767")

# 列出已注册的 Agent
agents = client.agents.list()

# 开一个会话，Agent 会自动挂上 cwd 上方最近一个 buckyball 根的 skills + MCP
session = client.sessions.create(agent=agents[0].name)
session.send("帮我用 toy 跑一次 matmul 仿真并出波形")
for chunk in session.stream():
    print(chunk.text, end="")
```

---

## 工作原理（一句话版）

[`omnigent/skills/buckyball/discovery.py`](omnigent/skills/buckyball/discovery.py) 沿 cwd 向上 8 层查找同时拥有 `.claude/skills/<x>/SKILL.md` 与 `.mcp.json` 的目录；[`omnigent/skills/buckyball/loader.py`](omnigent/skills/buckyball/loader.py) 把它们解析成 `SkillSpec` + `MCPServerConfig`，对 `.mcp.json` 做 `${VAR}` 展开（自动注入 `BUCKYBALL_ROOT`），最后由 [`attach_buckyball_to_spec`](omnigent/skills/buckyball/loader.py) 合并进 `AgentSpec`。Omnigent runtime 启动时按 spec 拉起 MCP 子进程，UI 端就拿到了一份"懂 buckyball 工具链"的 Agent。

详细说明见：

- [`omnigent/skills/buckyball/__init__.py`](omnigent/skills/buckyball/__init__.py) — 模块导出
- [`omnigent/skills/buckyball/discovery.py`](omnigent/skills/buckyball/discovery.py) — 根目录识别规则
- [`omnigent/skills/buckyball/loader.py`](omnigent/skills/buckyball/loader.py) — SKILL.md / .mcp.json 解析

---

## 文档

- 运行时：[omnigent/runtime/README.md](omnigent/runtime/README.md)
- 服务端 API：[omnigent/server/API.md](omnigent/server/API.md)
- 数据库模型：[omnigent/server/DBSPEC.md](omnigent/server/DBSPEC.md)
- Agent 规范：[omnigent/spec/AGENTSPEC.md](omnigent/spec/AGENTSPEC.md)
- 策略层：[docs/POLICIES.md](docs/POLICIES.md)

## 贡献

请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 与 [AGENTS.md](./AGENTS.md)；提交前跑一遍 `pre-commit run --all-files`。

## 安全

详见 [SECURITY.md](./SECURITY.md)。

## 许可证

[Apache License 2.0](./LICENSE)
