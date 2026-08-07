"""Convert buckyball project files into omnigent spec objects.

Two responsibilities:

1. Parse `<root>/.claude/skills/*/SKILL.md` files into `SkillSpec`
   objects. We parse SKILL.md **directly** here with explicit UTF-8
   rather than delegating to omnigent's `discover_host_skills()`,
   because on Windows the default `Path.read_text()` encoding is the
   system code page (cp936 / cp1252 / etc.), which silently corrupts
   UTF-8 SKILL.md files written from modern editors. The frontmatter
   format we accept mirrors omnigent's bundled-skill format (YAML
   frontmatter with `name` + `description` + optional
   `user-invocable`).

2. Parse `<root>/.mcp.json` into `MCPServerConfig` objects, expanding
   `${VAR}` / `$VAR` references against the buckyball root so the
   resulting `command` / `args` paths resolve correctly at MCP spawn
   time. Both functions return immutable lists; callers merge them
   into an `AgentSpec` via `attach_buckyball_to_spec`.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from omnigent.errors import ErrorCode, OmnigentError
from omnigent.spec.types import MCPServerConfig, SkillSpec

# ---------------------------------------------------------------------------
# Regexes
# ---------------------------------------------------------------------------

#: YAML frontmatter delimiter — `\A` anchors to the start of the file
#: because omnigent's SKILL.md format requires frontmatter on line 1.
_FRONTMATTER_RE = re.compile(
    r"\A---[ \t]*\n(?P<frontmatter>.*?)\n---[ \t]*\n(?P<body>.*)",
    re.DOTALL,
)

#: Skill name validation — lowercase kebab-case per omnigent convention.
_SKILL_NAME_RE = re.compile(r"^[a-z0-9-]+$")

#: Quoted-string spellings of boolean false in YAML frontmatter flags.
#: PyYAML already maps the bare words to a real `bool`; this set only
#: catches quoted variants that arrive as a `str`.
_FALSEY_STRINGS = frozenset({"false", "no", "off", "0"})

#: `$VAR` / `${VAR}` references in `.mcp.json` values.
_ENV_VAR_RE = re.compile(
    r"\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))"
)


# ---------------------------------------------------------------------------
# Exceptions + result types
# ---------------------------------------------------------------------------


class BuckyballSkillParseError(OmnigentError):
    """Raised when a SKILL.md file cannot be parsed into a SkillSpec.

    Distinct exception so callers can decide whether to log-and-skip or
    abort, without conflating with file I/O errors.
    """


@dataclass(frozen=True)
class LoadedBuckyballSkill:
    """A SkillSpec plus the buckyball root it came from."""

    skill: SkillSpec
    root: Path


@dataclass(frozen=True)
class LoadedMcpServer:
    """An MCPServerConfig plus the buckyball root it came from."""

    server: MCPServerConfig
    root: Path


@dataclass(frozen=True)
class BuckyballLoadResult:
    """Aggregate result of loading skills + MCP servers from one or more
    buckyball project roots."""

    skills: list[LoadedBuckyballSkill] = field(default_factory=list)
    mcp_servers: list[LoadedMcpServer] = field(default_factory=list)
    roots: list[Path] = field(default_factory=list)


# ---------------------------------------------------------------------------
# .mcp.json helpers
# ---------------------------------------------------------------------------


def _expand_env(value: str, env: dict[str, str]) -> str:
    """Expand `$VAR` / `${VAR}` references in `value`.

    Missing variables raise `KeyError` — matches omnigent's
    `expand_env_vars` behaviour in `spec/parser.py` and surfaces typos
    at parse time rather than silently producing broken MCP commands.
    """

    def _replace(match: re.Match[str]) -> str:
        name = match.group(1) or match.group(2)
        if name not in env:
            raise KeyError(f"unresolved env var in .mcp.json: ${{{name}}}")
        return env[name]

    return _ENV_VAR_RE.sub(_replace, value)


def _expand_env_mapping(
    mapping: dict[str, Any],
    env: dict[str, str],
) -> dict[str, Any]:
    """Recursively expand env refs in string leaves of a mapping."""
    out: dict[str, Any] = {}
    for k, v in mapping.items():
        if isinstance(v, str):
            out[k] = _expand_env(v, env)
        elif isinstance(v, dict):
            out[k] = _expand_env_mapping(v, env)
        elif isinstance(v, list):
            out[k] = [
                _expand_env(item, env) if isinstance(item, str) else item
                for item in v
            ]
        else:
            out[k] = v
    return out


def _make_env(root: Path) -> dict[str, str]:
    """Build the env-var namespace used for `.mcp.json` expansion.

    `BUCKYBALL_ROOT` is the project's absolute path; existing process
    environment is layered on top so callers can override e.g. `PATH`.
    """
    env = dict(os.environ)
    env["BUCKYBALL_ROOT"] = str(root.resolve())
    return env


# ---------------------------------------------------------------------------
# SKILL.md parsing (local — bypasses omnigent's `_parse_skill` for
# UTF-8 robustness under non-UTF-8 Windows code pages)
# ---------------------------------------------------------------------------


def _falsey_flag(raw: object) -> bool:
    """Return whether a YAML frontmatter flag reads as boolean false.

    Mirrors omnigent's `_falsey_flag` in `spec/parser.py`: a genuine
    YAML bool or one of the quoted strings in `_FALSEY_STRINGS`
    (case-insensitive, surrounding whitespace ignored). Everything else
    (absent ⇒ caller's default, `true`, other strings) is not falsey.
    """
    if raw is False:
        return True
    return isinstance(raw, str) and raw.strip().lower() in _FALSEY_STRINGS


def _parse_skill_md(skill_md: Path) -> SkillSpec:
    """Parse a single SKILL.md file into a `SkillSpec`.

    Reads with explicit UTF-8 (NOT the system code page) so files
    authored on Chinese / Japanese / Korean Windows machines survive.
    Raises `BuckyballSkillParseError` on bad frontmatter so callers can
    distinguish parse errors from filesystem errors.
    """
    try:
        text = skill_md.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise BuckyballSkillParseError(
            f"SKILL.md could not be read as UTF-8: {skill_md}: {exc}",
            code=ErrorCode.INVALID_INPUT,
        ) from exc

    match = _FRONTMATTER_RE.match(text)
    if not match:
        raise BuckyballSkillParseError(
            f"SKILL.md missing YAML frontmatter: {skill_md}",
            code=ErrorCode.INVALID_INPUT,
        )
    frontmatter_str, content = match.group("frontmatter"), match.group("body")

    try:
        frontmatter = yaml.safe_load(frontmatter_str)
    except yaml.YAMLError as exc:
        raise BuckyballSkillParseError(
            f"SKILL.md has invalid YAML frontmatter: {skill_md}: {exc}",
            code=ErrorCode.INVALID_INPUT,
        ) from exc

    if not isinstance(frontmatter, dict):
        raise BuckyballSkillParseError(
            f"SKILL.md frontmatter must be a YAML mapping: {skill_md}",
            code=ErrorCode.INVALID_INPUT,
        )

    name = frontmatter.get("name")
    if name is None:
        raise BuckyballSkillParseError(
            f"SKILL.md frontmatter missing required field 'name': {skill_md}",
            code=ErrorCode.INVALID_INPUT,
        )
    if not isinstance(name, str) or not _SKILL_NAME_RE.match(name):
        raise BuckyballSkillParseError(
            f"SKILL.md frontmatter 'name' must match [a-z0-9-]+: {skill_md}: {name!r}",
            code=ErrorCode.INVALID_INPUT,
        )

    description = frontmatter.get("description")
    if description is None:
        raise BuckyballSkillParseError(
            f"SKILL.md frontmatter missing required field 'description': {skill_md}",
            code=ErrorCode.INVALID_INPUT,
        )
    if not isinstance(description, str):
        raise BuckyballSkillParseError(
            f"SKILL.md frontmatter 'description' must be a string: {skill_md}",
            code=ErrorCode.INVALID_INPUT,
        )
    if len(description) > 1024:
        raise BuckyballSkillParseError(
            f"SKILL.md frontmatter 'description' exceeds 1024 chars: {skill_md}",
            code=ErrorCode.INVALID_INPUT,
        )

    user_invocable = not _falsey_flag(frontmatter.get("user-invocable", True))

    return SkillSpec(
        name=str(name),
        description=str(description),
        content=content.strip(),
        skill_dir=skill_md.parent,
        user_invocable=user_invocable,
    )


# ---------------------------------------------------------------------------
# Public loaders
# ---------------------------------------------------------------------------


def load_buckyball_skills(roots: list[Path]) -> list[LoadedBuckyballSkill]:
    """Parse SKILL.md files under each buckyball root's `.claude/skills/`.

    :param roots: Buckyball project roots (typically from
        `find_buckyball_roots`).
    :returns: Flat list of `LoadedBuckyballSkill`, one entry per root
        per skill discovered. Innermost root first.

    :raises BuckyballSkillParseError: If any SKILL.md has bad
        frontmatter. Callers may want to log-and-skip rather than abort;
        the exception is raised per-file so the caller can wrap each
        `parse` call in its own try/except if it wants lenient scanning.
    """
    out: list[LoadedBuckyballSkill] = []
    for root in roots:
        skills_dir = root / ".claude" / "skills"
        if not skills_dir.is_dir():
            continue
        for skill_dir in sorted(skills_dir.iterdir()):
            if not skill_dir.is_dir():
                continue
            skill_md = skill_dir / "SKILL.md"
            if not skill_md.is_file():
                continue
            skill = _parse_skill_md(skill_md)
            out.append(LoadedBuckyballSkill(skill=skill, root=root))
    return out


def load_buckyball_mcp_servers(roots: list[Path]) -> list[LoadedMcpServer]:
    """Parse `<root>/.mcp.json` into `MCPServerConfig` objects.

    Supported shape (Claude Code / Codex standard):

        {
          "mcpServers": {
            "<name>": {
              "command": "bash",
              "args": ["${BUCKYBALL_ROOT}/scripts/claude/run_mcp_server.sh"],
              "env": {"NIX_QUIET": "1"},
              "description": "..."
            }
          }
        }

    `${VAR}` / `$VAR` references in `command`, `args`, and `env` are
    expanded against the parent root (`BUCKYBALL_ROOT` is auto-injected).

    Only `stdio` transport is supported today — buckyball's MCP server
    runs as a local subprocess. HTTP-transport entries in `.mcp.json`
    raise a clear error rather than being silently ignored, so user
    config mistakes surface immediately.

    :param roots: Buckyball project roots.
    :returns: Flat list of `LoadedMcpServer`, innermost root first.
    """
    out: list[LoadedMcpServer] = []
    for root in roots:
        mcp_json = root / ".mcp.json"
        if not mcp_json.is_file():
            continue
        env = _make_env(root)
        try:
            raw_text = mcp_json.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            raise ValueError(f"failed to read {mcp_json}: {exc}") from exc
        try:
            data = json.loads(raw_text)
        except json.JSONDecodeError as exc:
            raise ValueError(f"failed to parse {mcp_json}: {exc}") from exc

        servers = data.get("mcpServers")
        if not isinstance(servers, dict):
            continue
        for name, raw in servers.items():
            if not isinstance(raw, dict):
                raise ValueError(f"{mcp_json}: server {name!r} must be an object")
            cfg = _expand_env_mapping(raw, env)
            transport = cfg.get("transport", "stdio")
            server = _build_mcp_server_config(name=name, cfg=cfg, transport=transport)
            out.append(LoadedMcpServer(server=server, root=root))
    return out


def _build_mcp_server_config(
    *,
    name: str,
    cfg: dict[str, Any],
    transport: str,
) -> MCPServerConfig:
    """Convert a single `.mcp.json` server entry into `MCPServerConfig`.

    Introspects the dataclass's `__init__` parameters to remain
    forward-compatible with new optional fields added to
    `MCPServerConfig` over time.
    """
    import inspect

    sig = inspect.signature(MCPServerConfig)
    allowed = {p.name for p in sig.parameters.values()}
    payload: dict[str, Any] = {"name": name, "transport": transport}
    if transport == "http":
        for field_name in ("url", "headers", "databricks_profile"):
            if field_name in cfg and field_name in allowed:
                payload[field_name] = cfg[field_name]
    elif transport == "stdio":
        for field_name in ("command", "args", "env"):
            if field_name in cfg and field_name in allowed:
                payload[field_name] = cfg[field_name]
    else:
        raise ValueError(
            f"unsupported MCP transport {transport!r} for server {name!r}"
        )
    # Filter to only fields the dataclass accepts; ignore .mcp.json keys
    # like "description" or "cwd" that aren't part of MCPServerConfig.
    payload = {k: v for k, v in payload.items() if k in allowed}
    return MCPServerConfig(**payload)


# ---------------------------------------------------------------------------
# AgentSpec attachment
# ---------------------------------------------------------------------------


def attach_buckyball_to_spec(
    spec: Any,
    roots: list[Path],
    *,
    dedupe_by_name: bool = True,
) -> BuckyballLoadResult:
    """Mutate `spec` in place to include buckyball skills and MCP servers.

    - Appends each parsed `SkillSpec` to `spec.skills`.
    - Appends each parsed `MCPServerConfig` to `spec.mcp_servers`.
    - Records the buckyball roots in `spec.buckyball_roots` (new
      attribute set dynamically via `setattr` — works on regular and
      frozen dataclasses alike).

    :param spec: An `AgentSpec` (or duck-typed equivalent). Must have
        `skills: list[SkillSpec]` and `mcp_servers: list[MCPServerConfig]`.
    :param roots: Buckyball project roots.
    :param dedupe_by_name: If True (default), skip skills/servers whose
        `name` already exists in the spec. Useful so omnigent's bundled
        skills win over project skills of the same name.
    :returns: A `BuckyballLoadResult` summarising what was attached.
    """
    skills = load_buckyball_skills(roots)
    servers = load_buckyball_mcp_servers(roots)

    existing_skill_names = (
        {s.name for s in getattr(spec, "skills", [])} if dedupe_by_name else set()
    )
    existing_server_names = (
        {s.name for s in getattr(spec, "mcp_servers", [])} if dedupe_by_name else set()
    )

    attached_skills: list[LoadedBuckyballSkill] = []
    for ls in skills:
        if ls.skill.name in existing_skill_names:
            continue
        spec.skills.append(ls.skill)
        existing_skill_names.add(ls.skill.name)
        attached_skills.append(ls)

    attached_servers: list[LoadedMcpServer] = []
    for ls in servers:
        if ls.server.name in existing_server_names:
            continue
        spec.mcp_servers.append(ls.server)
        existing_server_names.add(ls.server.name)
        attached_servers.append(ls)

    # Record roots for diagnostics; tolerate AgentSpecs that don't have
    # this attribute by setting it dynamically.
    current_roots = list(getattr(spec, "buckyball_roots", []) or [])
    for root in roots:
        if root not in current_roots:
            current_roots.append(root)
    try:
        setattr(spec, "buckyball_roots", current_roots)
    except (AttributeError, TypeError):
        # Frozen dataclass without this field — skip silently; the
        # return value still carries the roots for the caller.
        pass

    return BuckyballLoadResult(
        skills=attached_skills,
        mcp_servers=attached_servers,
        roots=roots,
    )