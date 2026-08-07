"""Tests for `omnigent.skills.buckyball.discovery`."""

from __future__ import annotations

from pathlib import Path

import pytest

from omnigent.skills.buckyball.discovery import (
    find_buckyball_roots,
    is_buckyball_root,
)


class TestIsBuckyballRoot:
    def test_recognises_valid_root(self, fake_buckyball_root: Path) -> None:
        assert is_buckyball_root(fake_buckyball_root) is True

    def test_rejects_dir_without_mcp_json(self, tmp_path: Path) -> None:
        # .claude/skills present, .mcp.json missing → not a buckyball root.
        skills = tmp_path / ".claude" / "skills" / "foo"
        skills.mkdir(parents=True)
        (skills / "SKILL.md").write_text(
            "---\nname: foo\ndescription: d\n---\nbody\n",
            encoding="utf-8",
        )
        assert is_buckyball_root(tmp_path) is False

    def test_rejects_dir_without_skills(self, tmp_path: Path) -> None:
        # .mcp.json present, .claude/skills missing → not a buckyball root.
        (tmp_path / ".mcp.json").write_text("{}", encoding="utf-8")
        assert is_buckyball_root(tmp_path) is False

    def test_rejects_dir_with_skills_but_no_skill_md(self, tmp_path: Path) -> None:
        # Empty .claude/skills directory → not a buckyball root.
        (tmp_path / ".claude" / "skills").mkdir(parents=True)
        (tmp_path / ".mcp.json").write_text("{}", encoding="utf-8")
        assert is_buckyball_root(tmp_path) is False

    def test_rejects_non_existent_path(self, tmp_path: Path) -> None:
        assert is_buckyball_root(tmp_path / "does-not-exist") is False


class TestFindBuckyballRoots:
    def test_finds_root_when_starting_from_subproject(
        self, nested_project_root: Path
    ) -> None:
        roots = find_buckyball_roots(nested_project_root)
        # Walk up: subproject, buckyball (parent) → 1 root.
        assert len(roots) == 1
        assert roots[0].name == "buckyball"

    def test_returns_empty_for_non_buckyball_tree(self, empty_dir: Path) -> None:
        roots = find_buckyball_roots(empty_dir)
        assert roots == []

    def test_max_depth_zero_only_checks_start(self, nested_project_root: Path) -> None:
        # max_depth=0 means we only look at `start`, not its parents.
        roots = find_buckyball_roots(nested_project_root, max_depth=0)
        assert roots == []

    def test_max_depth_one_finds_parent(self, nested_project_root: Path) -> None:
        # max_depth=1 means we look at start + 1 parent level.
        roots = find_buckyball_roots(nested_project_root, max_depth=1)
        assert len(roots) == 1

    def test_innermost_first(self, tmp_path: Path) -> None:
        # Two buckyball roots nested: outer/inner/. We want inner first.
        outer = tmp_path / "outer"
        inner = outer / "inner"
        for root in (outer, inner):
            (root / ".claude" / "skills").mkdir(parents=True)
            (root / ".claude" / "skills" / "x").mkdir()
            (root / ".claude" / "skills" / "x" / "SKILL.md").write_text(
                "---\nname: x\ndescription: d\n---\nbody\n",
                encoding="utf-8",
            )
            (root / ".mcp.json").write_text("{}", encoding="utf-8")
        roots = find_buckyball_roots(inner)
        assert roots == [inner, outer]

    @pytest.mark.parametrize("bad_start", [None, 0, 42])
    def test_invalid_types_rejected(self, bad_start: object) -> None:
        # Should raise TypeError because `start` must be a Path-like.
        with pytest.raises((TypeError, AttributeError)):
            find_buckyball_roots(bad_start)  # type: ignore[arg-type]