"""Pytest fixtures for the buckyball skill registration tests.

These fixtures build ephemeral buckyball project trees on disk so tests
can exercise discovery, MCP parsing, skill parsing, and AgentSpec
attachment without touching the real `d:\\桌面\\buckyball.ai\\buckyball`
repo.
"""

from __future__ import annotations

import json
from collections.abc import Generator
from pathlib import Path

import pytest


def _write_skill_md(skills_dir: Path, name: str, description: str = "test skill") -> Path:
    """Create `<skills_dir>/<name>/SKILL.md` with minimal valid frontmatter."""
    skill_dir = skills_dir / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    skill_md = skill_dir / "SKILL.md"
    skill_md.write_text(
        "---\n"
        f"name: {name}\n"
        f"description: {description}\n"
        "---\n\n"
        f"# {name}\n\nBody for {name}.\n",
        encoding="utf-8",
    )
    return skill_md


def _write_mcp_json(root: Path, servers: dict) -> Path:
    """Create `<root>/.mcp.json` with the given mcpServers mapping."""
    mcp_json = root / ".mcp.json"
    mcp_json.write_text(
        json.dumps({"mcpServers": servers}, indent=2),
        encoding="utf-8",
    )
    return mcp_json


@pytest.fixture
def fake_buckyball_root(tmp_path: Path) -> Generator[Path, None, None]:
    """Yield a synthetic buckyball root with two skills and one stdio MCP.

    Layout:
        <tmp>/buckyball/.claude/skills/bbdev/SKILL.md
        <tmp>/buckyball/.claude/skills/check/SKILL.md
        <tmp>/buckyball/.mcp.json
    """
    root = tmp_path / "buckyball"
    (root / ".claude" / "skills").mkdir(parents=True)
    _write_skill_md(root / ".claude" / "skills", "bbdev", "buckyball compiler tools")
    _write_skill_md(root / ".claude" / "skills", "check", "registration consistency")
    _write_mcp_json(
        root,
        {
            "buckyball-dev": {
                "command": "bash",
                "args": ["${BUCKYBALL_ROOT}/scripts/claude/run_mcp_server.sh"],
                "env": {"NIX_QUIET": "1"},
            },
        },
    )
    yield root


@pytest.fixture
def nested_project_root(tmp_path: Path) -> Generator[Path, None, None]:
    """Yield a directory inside a fake buckyball root (testing walk-up).

    Layout:
        <tmp>/buckyball/.claude/skills/bbdev/SKILL.md
        <tmp>/buckyball/.mcp.json
        <tmp>/buckyball/subproject/   <- returned
    """
    root = tmp_path / "buckyball"
    (root / ".claude" / "skills").mkdir(parents=True)
    _write_skill_md(root / ".claude" / "skills", "bbdev", "buckyball compiler tools")
    _write_mcp_json(root, {"buckyball-dev": {"command": "echo", "args": []}})
    subproject = root / "subproject"
    subproject.mkdir()
    yield subproject


@pytest.fixture
def empty_dir(tmp_path: Path) -> Generator[Path, None, None]:
    """Yield a directory with no buckyball markers (negative case)."""
    empty = tmp_path / "not_buckyball"
    empty.mkdir()
    yield empty