# omnigent.skills.buckyball

Buckyball 工具链注册子包。让 `omnigent` / `omni` 在 buckyball 项目根目录（或其子目录）下启动会话时，自动发现并挂载：

1. `.claude/skills/*/SKILL.md` —— 转为 `SkillSpec`，注入到 system prompt
2. `.mcp.json` 的 `mcpServers` —— 转为 `MCPServerConfig`，作为 stdio MCP 子进程拉起（其中 `buckyball-dev` 提供 33 个 `bbdev_*` 工具）

零侵入：不修改 `AgentSpec`，不修改 prompt builder，不修改 MCP manager。复用现有的 `discover_host_skills()` + `LoadSkillTool` + `RunnerMcpManager` 三件套。

## 公共 API

```python
from omnigent.skills.buckyball import (
    find_buckyball_roots,         # 向上找 buckyball 项目根
    load_buckyball_skills,        # 解析 SKILL.md
    load_buckyball_mcp_servers,   # 解析 .mcp.json
    attach_buckyball_to_spec,     # 挂到 AgentSpec
)
```

### `find_buckyball_roots(start, max_depth=8) -> list[Path]`

从 `start`（通常是 agent 的 cwd 或 workspace）向上走，找到所有同时含有 `.claude/skills/<x>/SKILL.md` 和 `.mcp.json` 的目录。返回的列表**内层在前**（更近的项目优先）。

### `load_buckyball_skills(roots) -> list[LoadedBuckyballSkill]`

为每个 root 调 `discover_host_skills()`，仅保留物理上位于该 root 下的 skill。

### `load_buckyball_mcp_servers(roots) -> list[LoadedMcpServer]`

解析 `<root>/.mcp.json`，展开 `${VAR}` 引用（`BUCKYBALL_ROOT` 自动注入为 root 绝对路径），转成 `MCPServerConfig`。当前仅支持 `stdio` transport（HTTP transport 留待未来扩展）。

### `attach_buckyball_to_spec(spec, roots, *, dedupe_by_name=True) -> BuckyballLoadResult`

挂到 `AgentSpec`：

- `spec.skills` —— 追加解析出的 `SkillSpec`（默认按 name 去重，bundled 优先）
- `spec.mcp_servers` —— 追加 `MCPServerConfig`
- `spec.buckyball_roots` —— 记录 root 列表（动态属性）

返回的 `BuckyballLoadResult` 包含本次实际挂上的内容，供调用方写日志 / 反馈给用户。

## 用法（典型 hook 点）

在 `omnigent/chat.py:run_chat()` 中、session spec 解析完之后、传给 runner 之前加：

```python
from omnigent.skills.buckyball import (
    find_buckyball_roots,
    attach_buckyball_to_spec,
)

# inside run_chat, after spec is resolved
cwd = Path(target).resolve() if Path(target).exists() else Path.cwd()
roots = find_buckyball_roots(cwd)
if roots:
    result = attach_buckyball_to_spec(spec, roots)
    _log.info(
        "buckyball: attached %d skill(s) + %d MCP server(s) from %d root(s)",
        len(result.skills), len(result.mcp_servers), len(result.roots),
    )
```

## 设计决策

### 为什么不直接用 `discover_host_skills()` 一把梭？

`discover_host_skills()` 已经能扫 `.claude/skills/`，但有两点不够：

1. 它**不会**触发 `.mcp.json` 的 MCP server 注册 —— MCP 注册要走 `MCPServerConfig` 路径，与 skill 路径独立。
2. 它不知道哪些 `.claude/skills/` 属于 buckyball 项目（vs 其他项目）。我们用"必须有 `.mcp.json`"作为 buckyball 项目的标识，避免污染非 buckyball 项目的 skill 列表。

### 为什么不修改 `AgentSpec`？

AGENTS.md 的"Framework-owned instructions"章节明确指出：避免在 spec 类型上加 lifecycle metadata。我们用 `setattr` 动态挂 `buckyball_roots`，frozen dataclass 不会报错（Python 允许给实例加属性），同时不污染类型定义。

### 为什么不是 integration 包而是 subpackage？

参考了 `omnigent/spec/`、`omnigent/runtime/` 的组织方式 —— 核心能力放 `omnigent/<name>.py` 子包，`integrations/<name>/` 留给可选的、subprocess 启动的外部工具（如 slack）。buckyball 是 omnigent 的一等公民工具链，不是可选 addon。

## 测试

```bash
cd d:/桌面/buckyball.ai/omnigent
.venv/bin/python -m pytest omnigent/skills/buckyball/tests/ -v
```

测试在 `omnigent/skills/buckyball/tests/`，独立于 `tests/` 目录以避免污染主 conftest 的 fixture 命名空间（主 conftest 里有大量 omnigent 运行时 fixture）。

## 验证步骤（用户视角）

1. **静态校验**：在 `buckyball/.mcp.json` 和 `buckyball/.claude/skills/bbdev/SKILL.md` 上跑 `python -c "import json; json.load(open('d:/桌面/buckyball.ai/buckyball/.mcp.json'))"` 和 YAML 前言校验。
2. **Loader 单元测试**：`pytest omnigent/skills/buckyball/tests/ -v`
3. **端到端 MCP 拉起**（需要 nix 环境）：在 `buckyball/` 根目录跑 `bash scripts/claude/run_mcp_server.sh`，确认 stdio MCP handshake 成功 + `tools/list` 返回 33 个 `bbdev_*`。
4. **omnigent 集成**：`cd buckyball && omni run examples/chips/toy/configs/...` 启动会话，确认 system prompt 含 `bbdev` skill + 工具列表含 33 个 `bbdev_*` MCP 工具。