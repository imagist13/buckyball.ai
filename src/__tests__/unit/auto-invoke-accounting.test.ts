/**
 * Phase 7.0 — Runtime-agnostic Auto-Invoke Context Accounting contract tests.
 *
 * Pins:
 *   - ToolInvocationAccumulator record/drain semantics
 *   - classifyToolUse three-bucket split (Skill / mcp__ / built-in)
 *   - collectAutoInvokeSnapshot:
 *       * skills aggregation via discoverSkills lookup
 *       * mcp aggregation per-server with call counts
 *       * tools aggregation per-name with call counts
 *       * unsupported list passthrough
 *       * producedBy enum + providerBackend passthrough
 *       * empty records → no entries (no fabrication)
 *       * badge selectedSkills merge + dedup with auto-invoke
 *   - Widget message golden fixture round-trip
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ToolInvocationAccumulator,
  canonicalizeSkillName,
  classifyToolUse,
  collectAutoInvokeSnapshot,
  resolveWorkspaceClaudeMdRules,
  type ToolInvocationRecord,
} from '../../lib/harness/auto-invoke-accounting';

function mkdtemp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function setupWorkspace(opts: {
  claudeMdContent?: string;
  skills?: Record<string, string>;
}): string {
  const ws = mkdtemp('phase7-ws-');
  if (opts.claudeMdContent !== undefined) {
    fs.writeFileSync(path.join(ws, 'CLAUDE.md'), opts.claudeMdContent);
  }
  if (opts.skills) {
    const skillsDir = path.join(ws, '.claude', 'skills');
    for (const [name, body] of Object.entries(opts.skills)) {
      const dir = path.join(skillsDir, name);
      fs.mkdirSync(dir, { recursive: true });
      const skillMd = `---\nname: ${name}\ndescription: test\n---\n${body}`;
      fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMd);
    }
  }
  return ws;
}

describe('canonicalizeSkillName', () => {
  it('strips leading slashes + trims whitespace', () => {
    assert.equal(canonicalizeSkillName('humanizer-zh'), 'humanizer-zh');
    assert.equal(canonicalizeSkillName('/humanizer-zh'), 'humanizer-zh');
    assert.equal(canonicalizeSkillName('//humanizer-zh'), 'humanizer-zh');
    assert.equal(canonicalizeSkillName('  /humanizer-zh  '), 'humanizer-zh');
    assert.equal(canonicalizeSkillName(''), '');
    assert.equal(canonicalizeSkillName('/'), '');
    assert.equal(canonicalizeSkillName('   '), '');
  });
});

describe('ToolInvocationAccumulator', () => {
  it('records tool_use + tool_result and drains in insertion order', () => {
    const acc = new ToolInvocationAccumulator();
    acc.recordToolUse('id1', 'Bash', { command: 'ls' });
    acc.recordToolUse('id2', 'Skill', { skill: 'humanizer-zh' });
    acc.recordToolResult('id1', 'file output');
    acc.recordToolResult('id2', 'skill output');

    const records = acc.drain();
    assert.equal(records.length, 2);
    assert.equal(records[0].toolUseId, 'id1');
    assert.equal(records[0].resultContent, 'file output');
    assert.equal(records[1].toolUseId, 'id2');
    assert.equal(records[1].resultContent, 'skill output');
  });

  it('ignores tool_result with no matching tool_use (stream anomaly)', () => {
    const acc = new ToolInvocationAccumulator();
    acc.recordToolResult('orphan-id', 'whatever');
    assert.equal(acc.size(), 0);
    assert.equal(acc.drain().length, 0);
  });

  it('records tool_use without tool_result (turn ended early): resultContent undefined', () => {
    const acc = new ToolInvocationAccumulator();
    acc.recordToolUse('id1', 'Bash', { command: 'ls' });
    const records = acc.drain();
    assert.equal(records[0].resultContent, undefined);
  });
});

describe('classifyToolUse', () => {
  it("'Skill' name → category=skill, detail=input.skill", () => {
    const cls = classifyToolUse({
      toolUseId: 'x',
      toolName: 'Skill',
      input: { skill: 'humanizer-zh', args: '...' },
    });
    assert.deepEqual(cls, { category: 'skill', detail: 'humanizer-zh', fullName: 'Skill' });
  });

  it("'mcp__server__tool' → category=mcp, detail=server, fullName=full", () => {
    const cls = classifyToolUse({
      toolUseId: 'x',
      toolName: 'mcp__codepilot-widget__codepilot_load_widget_guidelines',
      input: {},
    });
    assert.deepEqual(cls, {
      category: 'mcp',
      detail: 'codepilot-widget',
      fullName: 'mcp__codepilot-widget__codepilot_load_widget_guidelines',
    });
  });

  it("built-in tool name → category=tool, detail=name", () => {
    const cls = classifyToolUse({
      toolUseId: 'x',
      toolName: 'Bash',
      input: { command: 'ls' },
    });
    assert.deepEqual(cls, { category: 'tool', detail: 'Bash', fullName: 'Bash' });
  });

  it('Skill with missing/non-string input.skill → null (drop, no guess)', () => {
    assert.equal(
      classifyToolUse({ toolUseId: 'x', toolName: 'Skill', input: {} }),
      null,
    );
    assert.equal(
      classifyToolUse({ toolUseId: 'x', toolName: 'Skill', input: { skill: '' } }),
      null,
    );
    assert.equal(
      classifyToolUse({ toolUseId: 'x', toolName: 'Skill', input: null }),
      null,
    );
  });
});

describe('collectAutoInvokeSnapshot', () => {
  it('empty records → no entries (no fabrication)', () => {
    const ws = setupWorkspace({});
    const snap = collectAutoInvokeSnapshot({
      workspacePath: ws,
      records: [],
      producedBy: 'claude_code',
      unsupported: ['system_prompt', 'memory', 'files_attachments'],
    });
    assert.deepEqual(snap.entries, {});
    assert.equal(snap.producedBy, 'claude_code');
    assert.deepEqual([...snap.unsupported].sort(), ['files_attachments', 'memory', 'system_prompt']);
  });

  it('Skill auto-invoke → entries.skills with SKILL.md filesize', () => {
    const skillBody = 'Humanizer skill body for testing';
    const ws = setupWorkspace({ skills: { 'humanizer-zh': skillBody } });
    const snap = collectAutoInvokeSnapshot({
      workspacePath: ws,
      records: [
        { toolUseId: 'x', toolName: 'Skill', input: { skill: 'humanizer-zh', args: 'a' } },
      ],
      producedBy: 'claude_code',
      unsupported: [],
    });
    assert.ok(snap.entries.skills);
    assert.ok(snap.entries.skills.tokens > 0);
    assert.ok(snap.entries.skills.source.includes('.claude/skills/humanizer-zh/SKILL.md'));
    assert.equal(snap.entries.skills.detail, 'humanizer-zh');
  });

  it('MCP × 2 servers aggregates per server with call counts', () => {
    const ws = setupWorkspace({});
    const snap = collectAutoInvokeSnapshot({
      workspacePath: ws,
      records: [
        {
          toolUseId: 'a',
          toolName: 'mcp__widget__load_template',
          input: { module: 'diagram' },
          resultContent: 'AAAAAAAA',  // 8 chars
        },
        {
          toolUseId: 'b',
          toolName: 'mcp__widget__load_template',
          input: { module: 'flow' },
          resultContent: 'BBBBBBBB',  // 8 chars
        },
        {
          toolUseId: 'c',
          toolName: 'mcp__memory__recent',
          input: {},
          resultContent: 'CCCC',
        },
      ],
      producedBy: 'claude_code',
      unsupported: [],
    });
    assert.ok(snap.entries.mcp);
    assert.ok(snap.entries.mcp.tokens > 0);
    // detail must include both servers with call counts
    assert.ok(snap.entries.mcp!.detail!.includes('widget × 2'));
    assert.ok(snap.entries.mcp!.detail!.includes('memory × 1'));
    // source must reference both servers
    assert.ok(snap.entries.mcp.source.includes('widget'));
    assert.ok(snap.entries.mcp.source.includes('memory'));
  });

  it('built-in tool aggregation: Bash × 3 + Read × 1', () => {
    const ws = setupWorkspace({});
    const snap = collectAutoInvokeSnapshot({
      workspacePath: ws,
      records: [
        { toolUseId: 'a', toolName: 'Bash', input: { command: 'ls' }, resultContent: 'a.txt' },
        { toolUseId: 'b', toolName: 'Bash', input: { command: 'pwd' }, resultContent: '/tmp' },
        { toolUseId: 'c', toolName: 'Bash', input: { command: 'whoami' }, resultContent: 'me' },
        { toolUseId: 'd', toolName: 'Read', input: { file: 'a' }, resultContent: 'content' },
      ],
      producedBy: 'claude_code',
      unsupported: [],
    });
    assert.ok(snap.entries.tools);
    assert.ok(snap.entries.tools.tokens > 0);
    assert.ok(snap.entries.tools!.detail!.includes('Bash × 3'));
    assert.ok(snap.entries.tools!.detail!.includes('Read × 1'));
  });

  it('badge selectedSkills + auto-invoke Skill same name → dedup, single entries.skills', () => {
    const ws = setupWorkspace({ skills: { 'humanizer-zh': 'body' } });
    const snap = collectAutoInvokeSnapshot({
      workspacePath: ws,
      records: [
        { toolUseId: 'x', toolName: 'Skill', input: { skill: 'humanizer-zh' } },
      ],
      selectedSkills: ['/humanizer-zh'],  // slash + same name from badge picker
      producedBy: 'claude_code',
      unsupported: [],
    });
    assert.ok(snap.entries.skills);
    // detail should be 'humanizer-zh' ONCE, not duplicated
    assert.equal(snap.entries.skills.detail, 'humanizer-zh');
  });

  it('selectedSkills alone (no Skill tool_use) → entries.skills via badge merge', () => {
    const ws = setupWorkspace({ skills: { 'humanizer-zh': 'body' } });
    const snap = collectAutoInvokeSnapshot({
      workspacePath: ws,
      records: [],
      selectedSkills: ['humanizer-zh'],
      producedBy: 'claude_code',
      unsupported: [],
    });
    assert.ok(snap.entries.skills);
    assert.equal(snap.entries.skills.detail, 'humanizer-zh');
  });

  it('resolveRulesEntry injection → entries.rules populated from helper', () => {
    const ws = setupWorkspace({ claudeMdContent: 'project rules content' });
    const snap = collectAutoInvokeSnapshot({
      workspacePath: ws,
      records: [],
      producedBy: 'codepilot_runtime',
      unsupported: [],
      resolveRulesEntry: resolveWorkspaceClaudeMdRules,
    });
    assert.ok(snap.entries.rules);
    assert.equal(snap.entries.rules.source, 'workspace/CLAUDE.md');
    assert.ok(snap.entries.rules.tokens > 0);
  });

  it('producedBy + providerBackend passthrough', () => {
    const ws = setupWorkspace({});
    const snap = collectAutoInvokeSnapshot({
      workspacePath: ws,
      records: [],
      producedBy: 'codex_runtime',
      providerBackend: 'codepilot_proxy',
      unsupported: [],
    });
    assert.equal(snap.producedBy, 'codex_runtime');
    assert.equal(snap.providerBackend, 'codepilot_proxy');
  });

  // ──────────────────────────────────────────────────────────────────────
  // Golden fixture round-trip — Widget message (DB row 487c190a)
  // Reproduces v6 user-reported bug. Validates collectAutoInvokeSnapshot
  // produces non-empty entries.skills + entries.mcp + entries.tools from
  // the same input that previously produced only rules.
  // ──────────────────────────────────────────────────────────────────────
  it('Widget message golden fixture: 5 tool_use → skills (humanizer-zh) + mcp (×2 server) + tools (Bash×2)', () => {
    const fixturePath = path.join(__dirname, '..', 'fixtures', 'widget-message-tool-uses.json');
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));

    const ws = setupWorkspace({
      claudeMdContent: 'CodePilot project rules.',
      skills: { 'humanizer-zh': 'Real humanizer skill body (length matters for token estimate).' },
    });

    const records: ToolInvocationRecord[] = fixture.tool_uses.map(
      (tu: { id: string; name: string; input: unknown }) => {
        const tr = fixture.tool_results.find(
          (r: { tool_use_id: string }) => r.tool_use_id === tu.id,
        );
        return {
          toolUseId: tu.id,
          toolName: tu.name,
          input: tu.input,
          resultContent: tr?.content,
        };
      },
    );

    const snap = collectAutoInvokeSnapshot({
      workspacePath: ws,
      records,
      producedBy: 'claude_code',
      unsupported: ['system_prompt', 'memory', 'files_attachments'],
      resolveRulesEntry: resolveWorkspaceClaudeMdRules,
    });

    // skills: humanizer-zh resolved via discoverSkills
    assert.ok(snap.entries.skills, 'expected entries.skills (auto-invoke Skill humanizer-zh)');
    assert.equal(snap.entries.skills.detail, 'humanizer-zh');

    // mcp: 2 servers (codepilot-widget + codepilot-memory)
    assert.ok(snap.entries.mcp, 'expected entries.mcp (auto-invoke MCP calls)');
    assert.ok(snap.entries.mcp!.detail!.includes('codepilot-widget'));
    assert.ok(snap.entries.mcp!.detail!.includes('codepilot-memory'));

    // tools: Bash × 2
    assert.ok(snap.entries.tools, 'expected entries.tools (auto-invoke Bash)');
    assert.ok(snap.entries.tools!.detail!.includes('Bash × 2'));

    // rules: workspace CLAUDE.md
    assert.ok(snap.entries.rules);
    assert.equal(snap.entries.rules.source, 'workspace/CLAUDE.md');

    // unsupported list intact
    assert.deepEqual([...snap.unsupported].sort(), [
      'files_attachments',
      'memory',
      'system_prompt',
    ]);
    assert.equal(snap.producedBy, 'claude_code');
  });
});
