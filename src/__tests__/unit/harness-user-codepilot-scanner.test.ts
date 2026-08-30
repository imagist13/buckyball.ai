/**
 * Phase 5e review fix P1/P2 #4 (2026-05-18) — User CodePilot Harness
 * scanner skills + slash command coverage.
 *
 * Pre-fix `scanUserCodePilotExtensions` only surfaced MCP servers
 * (Settings + project) and workspace CLAUDE.md, even though the
 * documentation promised skills and slash commands. These tests pin
 * the now-complete coverage:
 *
 *   - project `.claude/skills/<name>/` directories → kind: 'skill'
 *   - project `.claude/commands/*.md` files → kind: 'slash_command'
 *   - project `.claude/CLAUDE.md` (override layer) → kind: 'workspace_rule'
 *
 * Tests build a tmpdir workspace, call the scanner with workspacePath
 * set, then assert the right entries come back.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scanUserCodePilotExtensions } from '@/lib/harness/user-codepilot-extensions';

describe('User CodePilot scanner — empty workspace', () => {
  it('returns no project entries when workspace path is undefined', () => {
    const out = scanUserCodePilotExtensions({});
    // Note: settings-level MCP entries may exist depending on the
    // running config DB — we don't assert against them here. The
    // project_file entries are what's scoped to workspacePath, and
    // those should be empty without a path.
    const projectEntries = out.filter((e) => e.origin === 'project_file');
    assert.deepEqual(projectEntries, []);
  });

  it('returns no entries when workspace exists but has no .mcp.json / CLAUDE.md / .claude/', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'user-scanner-empty-'));
    try {
      const out = scanUserCodePilotExtensions({ workspacePath: tmp, runtimeId: 'claude_code' });
      const projectEntries = out.filter((e) => e.origin === 'project_file');
      assert.deepEqual(projectEntries, []);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('User CodePilot scanner — project workspace_rule (CLAUDE.md)', () => {
  it('surfaces workspace-root CLAUDE.md', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'user-scanner-claudemd-'));
    try {
      fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), '# Project guidance', 'utf-8');
      const out = scanUserCodePilotExtensions({ workspacePath: tmp, runtimeId: 'claude_code' });
      const claudeMd = out.find((e) => e.id === 'workspace:CLAUDE.md');
      assert.ok(claudeMd, 'CLAUDE.md must surface as workspace_rule');
      assert.equal(claudeMd!.kind, 'workspace_rule');
      assert.equal(claudeMd!.executable, true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('surfaces nested .claude/CLAUDE.md as a separate override layer', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'user-scanner-nested-'));
    try {
      fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), '# root', 'utf-8');
      fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.claude', 'CLAUDE.md'), '# override', 'utf-8');

      const out = scanUserCodePilotExtensions({ workspacePath: tmp, runtimeId: 'claude_code' });
      const root = out.find((e) => e.id === 'workspace:CLAUDE.md');
      const nested = out.find((e) => e.id === 'workspace:.claude/CLAUDE.md');
      assert.ok(root, 'workspace-root CLAUDE.md must be present');
      assert.ok(nested, 'nested .claude/CLAUDE.md must be present as override');
      assert.notEqual(root, nested, 'two distinct entries');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('User CodePilot scanner — .claude/skills/', () => {
  it('surfaces each subdirectory in .claude/skills/ as a skill extension', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'user-scanner-skills-'));
    try {
      const skillsDir = path.join(tmp, '.claude', 'skills');
      fs.mkdirSync(path.join(skillsDir, 'code-review'), { recursive: true });
      fs.mkdirSync(path.join(skillsDir, 'doc-writer'), { recursive: true });
      fs.writeFileSync(
        path.join(skillsDir, 'code-review', 'SKILL.md'),
        '# code-review skill body',
        'utf-8',
      );

      const out = scanUserCodePilotExtensions({ workspacePath: tmp, runtimeId: 'claude_code' });
      const skills = out.filter((e) => e.kind === 'skill');
      const ids = skills.map((s) => s.id);
      assert.ok(ids.includes('skill:project:code-review'));
      assert.ok(ids.includes('skill:project:doc-writer'));
      assert.equal(skills.every((s) => s.executable), true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('skips hidden directories under .claude/skills/', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'user-scanner-skills-hidden-'));
    try {
      const skillsDir = path.join(tmp, '.claude', 'skills');
      fs.mkdirSync(path.join(skillsDir, '.git'), { recursive: true });
      fs.mkdirSync(path.join(skillsDir, 'visible-skill'), { recursive: true });

      const out = scanUserCodePilotExtensions({ workspacePath: tmp, runtimeId: 'claude_code' });
      const skillIds = out.filter((e) => e.kind === 'skill').map((s) => s.id);
      assert.ok(skillIds.includes('skill:project:visible-skill'));
      assert.equal(
        skillIds.includes('skill:project:.git'),
        false,
        'hidden directories like .git must not surface as skills',
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('User CodePilot scanner — .claude/commands/', () => {
  it('surfaces each .md file in .claude/commands/ as a slash_command', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'user-scanner-slash-'));
    try {
      const commandsDir = path.join(tmp, '.claude', 'commands');
      fs.mkdirSync(commandsDir, { recursive: true });
      fs.writeFileSync(path.join(commandsDir, 'plan.md'), '/plan body', 'utf-8');
      fs.writeFileSync(path.join(commandsDir, 'ship-it.md'), '/ship-it body', 'utf-8');

      const out = scanUserCodePilotExtensions({ workspacePath: tmp, runtimeId: 'claude_code' });
      const slashes = out.filter((e) => e.kind === 'slash_command');
      const ids = slashes.map((s) => s.id);
      assert.ok(ids.includes('slash:project:plan'));
      assert.ok(ids.includes('slash:project:ship-it'));
      // displayName strips the .md extension and prefixes with /
      const plan = slashes.find((s) => s.id === 'slash:project:plan');
      assert.match(plan!.displayName, /^\/plan/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('skips non-.md files in .claude/commands/', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'user-scanner-slash-ext-'));
    try {
      const commandsDir = path.join(tmp, '.claude', 'commands');
      fs.mkdirSync(commandsDir, { recursive: true });
      fs.writeFileSync(path.join(commandsDir, 'real.md'), '/real', 'utf-8');
      fs.writeFileSync(path.join(commandsDir, 'README.txt'), 'not a command', 'utf-8');
      fs.writeFileSync(path.join(commandsDir, 'script.sh'), '#!/bin/bash', 'utf-8');

      const out = scanUserCodePilotExtensions({ workspacePath: tmp, runtimeId: 'claude_code' });
      const ids = out.filter((e) => e.kind === 'slash_command').map((s) => s.id);
      assert.deepEqual(ids, ['slash:project:real']);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase 5e review round 3 fix P2 #C — runtime-aware executable
// ─────────────────────────────────────────────────────────────────────

describe('User CodePilot scanner — runtime-aware executable classification', () => {
  function buildWorkspace(tmp: string) {
    fs.mkdirSync(path.join(tmp, '.claude', 'skills', 'review'), { recursive: true });
    fs.mkdirSync(path.join(tmp, '.claude', 'commands'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.claude', 'commands', 'plan.md'), '/plan', 'utf-8');
    fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), '# root', 'utf-8');
    fs.writeFileSync(
      path.join(tmp, '.mcp.json'),
      JSON.stringify({ mcpServers: { weather: { command: 'mcp-weather' } } }),
      'utf-8',
    );
  }

  it('runtimeId="claude_code": every kind is executable (Skills + slash supported natively)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'user-scanner-rt-claude-'));
    try {
      buildWorkspace(tmp);
      const out = scanUserCodePilotExtensions({ workspacePath: tmp, runtimeId: 'claude_code' });
      const projectEntries = out.filter((e) => e.origin === 'project_file');
      for (const e of projectEntries) {
        assert.equal(e.executable, true, `${e.id} should be executable on claude_code`);
        assert.equal(e.perceptionHint, undefined);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('runtimeId="codepilot_runtime": skills + slash commands are perception_only with switch-to-ClaudeCode hint', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'user-scanner-rt-native-'));
    try {
      buildWorkspace(tmp);
      const out = scanUserCodePilotExtensions({ workspacePath: tmp, runtimeId: 'codepilot_runtime' });
      const skill = out.find((e) => e.kind === 'skill');
      const slash = out.find((e) => e.kind === 'slash_command');
      const workspaceRule = out.find((e) => e.kind === 'workspace_rule');
      const mcp = out.find((e) => e.kind === 'mcp_server');

      assert.ok(skill);
      assert.equal(skill!.executable, false, 'skill is ClaudeCode-only — must be perception_only on Native');
      assert.match(skill!.perceptionHint ?? '', /ClaudeCode/);

      assert.ok(slash);
      assert.equal(slash!.executable, false, 'slash command is ClaudeCode-only — must be perception_only on Native');
      assert.match(slash!.perceptionHint ?? '', /ClaudeCode/);

      // workspace_rule and mcp_server remain cross-Runtime executable.
      assert.equal(workspaceRule!.executable, true);
      assert.equal(mcp!.executable, true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('runtimeId="codex_runtime": skills + slash commands are perception_only with switch-to-ClaudeCode hint', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'user-scanner-rt-codex-'));
    try {
      buildWorkspace(tmp);
      const out = scanUserCodePilotExtensions({ workspacePath: tmp, runtimeId: 'codex_runtime' });
      const skill = out.find((e) => e.kind === 'skill');
      const slash = out.find((e) => e.kind === 'slash_command');
      assert.equal(skill!.executable, false);
      assert.equal(slash!.executable, false);
      assert.match(skill!.perceptionHint ?? '', /ClaudeCode/);
      assert.match(slash!.perceptionHint ?? '', /ClaudeCode/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Phase 5e review round 4 fix P1 (2026-05-18) — Codex Runtime
  // does NOT mount user MCP servers. The pre-fix scanner marked
  // mcp_server as executable=true across every Runtime, which would
  // let the model see "weather (user mcp_server)" in the Callable
  // section while the Codex proxy actually had no wire-up for it.
  // grep verified: `src/lib/codex/` contains no
  // buildMcpToolSet / loadCodePilotMcpServers / loadAllMcpServers
  // call. Pin the demotion + perception hint so a future Codex
  // contributor who wires user MCP must also flip this case back to
  // executable=true (instead of silently letting the model fabricate
  // calls).
  it('runtimeId="codex_runtime": user mcp_server entries are perception_only with switch-to-ClaudeCode/Native hint', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'user-scanner-rt-codex-mcp-'));
    try {
      buildWorkspace(tmp);
      const out = scanUserCodePilotExtensions({ workspacePath: tmp, runtimeId: 'codex_runtime' });
      const mcp = out.find((e) => e.kind === 'mcp_server');
      assert.ok(mcp, 'project .mcp.json must surface as mcp_server entry');
      assert.equal(
        mcp!.executable,
        false,
        'Codex Runtime proxy does not mount user MCP servers — entry must be perception_only',
      );
      assert.match(
        mcp!.perceptionHint ?? '',
        /ClaudeCode SDK or CodePilot Native/i,
        'perceptionHint must point the user to a Runtime that actually mounts user MCP',
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('runtimeId="claude_code" / "codepilot_runtime": user mcp_server entries remain executable (real wire-up)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'user-scanner-rt-mcp-active-'));
    try {
      buildWorkspace(tmp);
      const claudeOut = scanUserCodePilotExtensions({ workspacePath: tmp, runtimeId: 'claude_code' });
      const nativeOut = scanUserCodePilotExtensions({ workspacePath: tmp, runtimeId: 'codepilot_runtime' });
      const claudeMcp = claudeOut.find((e) => e.kind === 'mcp_server');
      const nativeMcp = nativeOut.find((e) => e.kind === 'mcp_server');
      assert.equal(claudeMcp!.executable, true, 'ClaudeCode SDK mounts user MCPs via mcp-loader');
      assert.equal(nativeMcp!.executable, true, 'CodePilot Native mounts user MCPs via buildMcpToolSet');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('runtimeId=undefined (defensive default): skills + slash get perception_only', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'user-scanner-rt-default-'));
    try {
      buildWorkspace(tmp);
      // Conservative default — unmigrated callers must not leak skill /
      // slash as "Callable" by accident.
      const out = scanUserCodePilotExtensions({ workspacePath: tmp });
      const skill = out.find((e) => e.kind === 'skill');
      const slash = out.find((e) => e.kind === 'slash_command');
      assert.equal(skill!.executable, false);
      assert.equal(slash!.executable, false);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('User CodePilot scanner — all layers combined', () => {
  it('returns MCP + CLAUDE.md + skills + slash commands together for a fully-configured workspace', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'user-scanner-all-'));
    try {
      // Project .mcp.json
      fs.writeFileSync(
        path.join(tmp, '.mcp.json'),
        JSON.stringify({ mcpServers: { weather: { command: 'mcp-weather' } } }),
        'utf-8',
      );
      // Root CLAUDE.md
      fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), '# root', 'utf-8');
      // .claude/skills + .claude/commands
      fs.mkdirSync(path.join(tmp, '.claude', 'skills', 'review'), { recursive: true });
      fs.mkdirSync(path.join(tmp, '.claude', 'commands'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.claude', 'commands', 'plan.md'), '/plan', 'utf-8');

      const out = scanUserCodePilotExtensions({ workspacePath: tmp, runtimeId: 'claude_code' });
      const kinds = new Set(out.map((e) => e.kind));
      assert.ok(kinds.has('mcp_server'));
      assert.ok(kinds.has('workspace_rule'));
      assert.ok(kinds.has('skill'));
      assert.ok(kinds.has('slash_command'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('every project_file entry has a sourcePath the scanner can later display', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'user-scanner-srcpath-'));
    try {
      fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), '#', 'utf-8');
      fs.mkdirSync(path.join(tmp, '.claude', 'skills', 's'), { recursive: true });
      fs.mkdirSync(path.join(tmp, '.claude', 'commands'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '.claude', 'commands', 'c.md'), '/c', 'utf-8');

      const out = scanUserCodePilotExtensions({ workspacePath: tmp, runtimeId: 'claude_code' });
      const projectEntries = out.filter((e) => e.origin === 'project_file');
      assert.ok(projectEntries.length > 0);
      for (const e of projectEntries) {
        assert.ok(
          e.sourcePath && e.sourcePath.startsWith(tmp),
          `${e.id} project_file entry missing sourcePath inside workspace`,
        );
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
