"""Integration test for the `_merge_host_skills` + `_attach_buckyball`
hook in `omnigent/chat.py`.

Runs only when `omnigent/chat.py` is importable — exercises the
end-to-end skill + MCP server attachment when chat.py is given a
spec path that lives inside a synthetic buckyball project root.
"""

from __future__ import annotations

from pathlib import Path

import pytest


@pytest.fixture
def agent_bundle_with_buckyball_parent(tmp_path: Path) -> Path:
    """Create an agent bundle nested inside a fake buckyball project.

    Layout:
        <tmp>/buckyball/.claude/skills/bbdev/SKILL.md
        <tmp>/buckyball/.mcp.json
        <tmp>/buckyball/agent/agent.yaml
    """
    root = tmp_path / "buckyball"
    agent = root / "agent"
    (root / ".claude" / "skills" / "bbdev").mkdir(parents=True)
    (root / ".claude" / "skills" / "bbdev" / "SKILL.md").write_text(
        "---\nname: bbdev\ndescription: tools\n---\nbody\n",
        encoding="utf-8",
    )
    (root / ".mcp.json").write_text(
        '{"mcpServers":{"buckyball-dev":{"command":"echo","args":[]}}}\n',
        encoding="utf-8",
    )
    agent.mkdir()
    (agent / "agent.yaml").write_text(
        "name: test-agent\ninstructions: hi\n",
        encoding="utf-8",
    )
    return agent


def test_merge_host_skills_attaches_buckyball(
    agent_bundle_with_buckyball_parent: Path,
) -> None:
    """Smoke: `_merge_host_skills` finds buckyball parent and attaches it.

    We don't construct a full AgentSpec (it requires too many fields);
    instead we monkeypatch `AgentSpec` to a minimal shim so we can
    assert the helper mutates it.
    """
    from omnigent import chat
    from omnigent.spec.types import MCPServerConfig, SkillSpec

    class _MiniSpec:
        def __init__(self) -> None:
            self.skills: list[SkillSpec] = []
            self.mcp_servers: list[MCPServerConfig] = []
            self.skills_filter: str = "all"

    spec = _MiniSpec()
    chat._merge_host_skills(spec, agent_bundle_with_buckyball_parent)
    # buckyball bbdev skill should now be attached.
    assert any(s.name == "bbdev" for s in spec.skills)
    # buckyball-dev MCP server should now be attached.
    assert any(s.name == "buckyball-dev" for s in spec.mcp_servers)


def test_merge_host_skills_no_buckyball_root_is_noop(tmp_path: Path) -> None:
    """When the agent lives outside any buckyball project, no attachment."""
    from omnigent import chat
    from omnigent.spec.types import MCPServerConfig, SkillSpec

    class _MiniSpec:
        def __init__(self) -> None:
            self.skills: list[SkillSpec] = []
            self.mcp_servers: list[MCPServerConfig] = []
            self.skills_filter: str = "all"

    agent = tmp_path / "lone_agent"
    agent.mkdir()
    (agent / "agent.yaml").write_text("name: x\ninstructions: y\n", encoding="utf-8")

    spec = _MiniSpec()
    chat._merge_host_skills(spec, agent)
    # No buckyball skills or servers should be added.
    assert spec.skills == []
    assert spec.mcp_servers == []