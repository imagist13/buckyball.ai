"""Buckyball skill & MCP server registration for omnigent.

Discovers buckyball project roots (those containing `.claude/skills/` and
`.mcp.json`), parses their skill manifests, and converts the project's MCP
config into omnigent's `MCPServerConfig` + `SkillSpec` shape so they can be
attached to an `AgentSpec` at session start.

Public API (re-exported):

- `find_buckyball_roots(start, max_depth)` — locate buckyball project roots.
- `load_buckyball_skills(roots)` — parse their `.claude/skills/*/SKILL.md`.
- `load_buckyball_mcp_servers(roots)` — parse their `.mcp.json`.
- `attach_buckyball_to_spec(spec, roots)` — attach both to an `AgentSpec`.

Design notes
------------
- We piggy-back on `discover_host_skills()` for parsing, so YAML
  frontmatter handling stays identical to omnigent's bundled skills.
- We deliberately do **not** modify `AgentSpec` — `MCPServerConfig` and
  `SkillSpec` are both already part of the public spec.
- Per AGENTS.md "Framework-owned instructions" guidance: the policy text
  for "agents must invoke bbdev via MCP" lives in the SKILL.md itself,
  not in framework code. This module only attaches the spec objects.
"""

from __future__ import annotations

from omnigent.skills.buckyball.discovery import (
    BUCKYBALL_MARKERS,
    find_buckyball_roots,
)
from omnigent.skills.buckyball.loader import (
    attach_buckyball_to_spec,
    load_buckyball_mcp_servers,
    load_buckyball_skills,
)

__all__ = [
    "BUCKYBALL_MARKERS",
    "attach_buckyball_to_spec",
    "find_buckyball_roots",
    "load_buckyball_mcp_servers",
    "load_buckyball_skills",
]