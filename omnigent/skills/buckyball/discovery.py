"""Discovery helpers for buckyball project roots.

A "buckyball root" is any directory that contains BOTH `.claude/skills/`
(with at least one `SKILL.md`) and `.mcp.json`. We walk up from a starting
path (typically the agent's cwd or workspace) and collect every such root.
"""

from __future__ import annotations

from pathlib import Path

#: Marker files / dirs that together identify a buckyball project root.
#: We require BOTH `.claude/skills/` and `.mcp.json` — the SKILL.md lives
#: under the former, the MCP server config under the latter. A directory
#: with only one of the two is not a buckyball root for our purposes.
BUCKYBALL_MARKERS: tuple[str, ...] = (
    ".claude/skills",
    ".mcp.json",
)


def _has_skill_md(skills_dir: Path) -> bool:
    """Return True iff `skills_dir` contains at least one SKILL.md.

    A directory with only subdirectories that lack SKILL.md is ignored —
    this prevents false positives on stray `.claude/skills/` directories
    that haven't been populated yet.
    """
    if not skills_dir.is_dir():
        return False
    try:
        for entry in skills_dir.iterdir():
            if entry.is_dir() and (entry / "SKILL.md").is_file():
                return True
    except OSError:
        return False
    return False


def is_buckyball_root(path: Path) -> bool:
    """Return True iff `path` looks like a buckyball project root.

    Both `.claude/skills/<something>/SKILL.md` and `.mcp.json` must exist.
    """
    if not path.is_dir():
        return False
    skills_dir = path / BUCKYBALL_MARKERS[0]
    mcp_json = path / BUCKYBALL_MARKERS[1]
    return _has_skill_md(skills_dir) and mcp_json.is_file()


def find_buckyball_roots(start: Path, *, max_depth: int = 8) -> list[Path]:
    """Walk up from `start` collecting buckyball project roots.

    Walks `start`, then `start.parent`, `start.parent.parent`, ..., up to
    `max_depth` levels OR until the filesystem root. Order is innermost
    first (matches omnigent's `.claude/skills/` walk convention so the
    closest project wins on collisions). Stops walking upward once we
    hit a directory that is itself a buckyball root's ancestor that
    contains a buckyball root — we don't search above the first match
    unless `max_depth` permits.

    :param start: The starting path (typically an agent's cwd or workspace).
    :param max_depth: Maximum number of parent levels to walk. 0 disables
        walking entirely; only `start` is checked.
    :returns: Deduplicated list of buckyball roots, innermost first.
    """
    seen: set[Path] = set()
    roots: list[Path] = []
    current = start.resolve()
    for _ in range(max_depth + 1):
        if current in seen:
            break
        seen.add(current)
        if is_buckyball_root(current):
            roots.append(current)
        parent = current.parent
        if parent == current:
            break
        current = parent
    return roots