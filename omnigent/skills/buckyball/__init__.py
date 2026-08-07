"""Buckyball skill & MCP registration subpackage.

Public surface (re-exported from `omnigent.skills`):

- `find_buckyball_roots(start, max_depth)` — locate buckyball project roots.
- `load_buckyball_skills(roots)` — parse their `.claude/skills/*/SKILL.md`.
- `load_buckyball_mcp_servers(roots)` — parse their `.mcp.json`.
- `attach_buckyball_to_spec(spec, roots)` — attach both to an `AgentSpec`.

See `loader.py` for the conversion logic and `discovery.py` for the root
walker.
"""

from __future__ import annotations

from omnigent.skills.buckyball.discovery import (
    BUCKYBALL_MARKERS,
    find_buckyball_roots,
    is_buckyball_root,
)
from omnigent.skills.buckyball.loader import (
    BuckyballLoadResult,
    LoadedBuckyballSkill,
    LoadedMcpServer,
    attach_buckyball_to_spec,
    load_buckyball_mcp_servers,
    load_buckyball_skills,
)

__all__ = [
    "BUCKYBALL_MARKERS",
    "BuckyballLoadResult",
    "LoadedBuckyballSkill",
    "LoadedMcpServer",
    "attach_buckyball_to_spec",
    "find_buckyball_roots",
    "is_buckyball_root",
    "load_buckyball_mcp_servers",
    "load_buckyball_skills",
]