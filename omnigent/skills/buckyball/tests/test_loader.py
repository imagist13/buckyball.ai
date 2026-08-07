"""Tests for `omnigent.skills.buckyball.loader`."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from omnigent.skills.buckyball.loader import (
    _expand_env,
    attach_buckyball_to_spec,
    load_buckyball_mcp_servers,
    load_buckyball_skills,
)
from omnigent.spec.types import MCPServerConfig, SkillSpec


class _FakeSpec:
    """Minimal AgentSpec duck-type for testing `attach_buckyball_to_spec`."""

    def __init__(self) -> None:
        self.skills: list[SkillSpec] = []
        self.mcp_servers: list[MCPServerConfig] = []


class TestExpandEnv:
    def test_expands_braced_reference(self) -> None:
        assert _expand_env("${FOO}/bar", {"FOO": "x"}) == "x/bar"

    def test_expands_bare_reference(self) -> None:
        assert _expand_env("$FOO/bar", {"FOO": "x"}) == "x/bar"

    def test_missing_variable_raises(self) -> None:
        with pytest.raises(KeyError):
            _expand_env("${MISSING}/x", {})

    def test_no_reference_passes_through(self) -> None:
        assert _expand_env("plain/path", {"FOO": "x"}) == "plain/path"


class TestLoadBuckyballSkills:
    def test_loads_all_skill_mds(self, fake_buckyball_root: Path) -> None:
        loaded = load_buckyball_skills([fake_buckyball_root])
        names = {ls.skill.name for ls in loaded}
        assert names == {"bbdev", "check"}

    def test_returns_empty_for_root_without_skills_dir(
        self, tmp_path: Path
    ) -> None:
        # tmp_path has no .claude/skills → empty list.
        assert load_buckyball_skills([tmp_path]) == []

    def test_skill_dir_is_set(self, fake_buckyball_root: Path) -> None:
        loaded = load_buckyball_skills([fake_buckyball_root])
        for ls in loaded:
            assert ls.skill.skill_dir is not None
            assert ls.skill.skill_dir.name in {"bbdev", "check"}


class TestLoadBuckyballMcpServers:
    def test_parses_stdio_server_with_env_expansion(
        self, fake_buckyball_root: Path
    ) -> None:
        loaded = load_buckyball_mcp_servers([fake_buckyball_root])
        assert len(loaded) == 1
        server = loaded[0].server
        assert server.name == "buckyball-dev"
        assert server.transport == "stdio"
        assert server.command == "bash"
        assert server.args is not None
        # ${BUCKYBALL_ROOT} was expanded to the root's absolute path.
        assert server.args[0].startswith(str(fake_buckyball_root.resolve()))
        assert server.args[0].endswith("scripts/claude/run_mcp_server.sh")
        # env should be passed through.
        assert server.env == {"NIX_QUIET": "1"}

    def test_handles_empty_mcp_json(self, tmp_path: Path) -> None:
        (tmp_path / ".mcp.json").write_text("{}", encoding="utf-8")
        assert load_buckyball_mcp_servers([tmp_path]) == []

    def test_raises_on_invalid_json(self, tmp_path: Path) -> None:
        (tmp_path / ".mcp.json").write_text("not json", encoding="utf-8")
        with pytest.raises(ValueError):
            load_buckyball_mcp_servers([tmp_path])

    def test_unsupported_transport_raises(self, tmp_path: Path) -> None:
        (tmp_path / ".mcp.json").write_text(
            json.dumps(
                {
                    "mcpServers": {
                        "weird": {"transport": "carrier-pigeon"},
                    },
                }
            ),
            encoding="utf-8",
        )
        with pytest.raises(ValueError, match="unsupported MCP transport"):
            load_buckyball_mcp_servers([tmp_path])


class TestAttachBuckyballToSpec:
    def test_attaches_skills_and_servers(self, fake_buckyball_root: Path) -> None:
        spec = _FakeSpec()
        result = attach_buckyball_to_spec(spec, [fake_buckyball_root])
        assert {s.name for s in spec.skills} == {"bbdev", "check"}
        assert {s.name for s in spec.mcp_servers} == {"buckyball-dev"}
        assert result.roots == [fake_buckyball_root]

    def test_dedupe_by_name_skips_existing(self, fake_buckyball_root: Path) -> None:
        # Pre-populate the spec with a "bbdev" skill — should NOT be re-added.
        spec = _FakeSpec()
        existing = SkillSpec(
            name="bbdev",
            description="bundled",
            content="x",
            skill_dir=None,
        )
        spec.skills.append(existing)
        attach_buckyball_to_spec(spec, [fake_buckyball_root])
        # Still only one bbdev.
        assert len([s for s in spec.skills if s.name == "bbdev"]) == 1
        assert spec.skills[0].description == "bundled"

    def test_no_dedupe_keeps_duplicates(self, fake_buckyball_root: Path) -> None:
        spec = _FakeSpec()
        existing = SkillSpec(
            name="bbdev",
            description="bundled",
            content="x",
            skill_dir=None,
        )
        spec.skills.append(existing)
        attach_buckyball_to_spec(spec, [fake_buckyball_root], dedupe_by_name=False)
        # Now we have 2 bbdevs.
        assert len([s for s in spec.skills if s.name == "bbdev"]) == 2

    def test_records_buckyball_roots_on_spec(self, fake_buckyball_root: Path) -> None:
        spec = _FakeSpec()
        attach_buckyball_to_spec(spec, [fake_buckyball_root])
        assert getattr(spec, "buckyball_roots", None) == [fake_buckyball_root]

    def test_multiple_roots_attached_in_order(
        self, fake_buckyball_root: Path, tmp_path: Path
    ) -> None:
        # Build a second fake root.
        second = tmp_path / "second_buckyball"
        (second / ".claude" / "skills" / "only").mkdir(parents=True)
        (second / ".claude" / "skills" / "only" / "SKILL.md").write_text(
            "---\nname: only\ndescription: d\n---\nbody\n",
            encoding="utf-8",
        )
        (second / ".mcp.json").write_text(
            json.dumps(
                {
                    "mcpServers": {
                        "second-dev": {"command": "echo", "args": []},
                    },
                }
            ),
            encoding="utf-8",
        )
        spec = _FakeSpec()
        attach_buckyball_to_spec(spec, [fake_buckyball_root, second])
        # Roots preserve input order.
        assert getattr(spec, "buckyball_roots") == [fake_buckyball_root, second]
        # Skills from both roots present.
        assert {s.name for s in spec.skills} == {"bbdev", "check", "only"}
        # MCP servers from both roots present.
        assert {s.name for s in spec.mcp_servers} == {"buckyball-dev", "second-dev"}