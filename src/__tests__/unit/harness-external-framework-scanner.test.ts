/**
 * Phase 5e Phase 1 (2026-05-18) — External Framework scanner safety
 * + behaviour tests.
 *
 * Critical pins:
 *   1. **Auth token filenames are NEVER read.** The forbidden-pattern
 *      filter rejects `auth.json`, `*.token`, `*credentials*`,
 *      `*.key`, etc. This is the safety boundary that protects the
 *      user's Codex / ClaudeCode OAuth from being surfaced through
 *      the bundle / Settings UI.
 *   2. ClaudeCode + Codex configs detected when present.
 *   3. Active-framework heuristic: extensions belonging to the same
 *      framework as the active Runtime get `executable: true`; others
 *      get `executable: false` + `perceptionHint`.
 *   4. No-config tolerance: scanner returns `[]` when ~/.claude /
 *      ~/.codex don't exist (clean test env or first-run user).
 *   5. Malformed JSON tolerance: bad `~/.claude/mcp.json` is skipped
 *      silently (no throw, no partial state).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  scanExternalFrameworkExtensions,
  __TEST_isFilenameSafe,
  __TEST_FORBIDDEN_PATTERNS,
} from '@/lib/harness/external-framework-harness';

describe('External scanner — auth token forbidden filenames', () => {
  it('rejects auth.json', () => {
    assert.equal(__TEST_isFilenameSafe('/home/user/.codex/auth.json'), false);
  });

  it('rejects .token files', () => {
    assert.equal(__TEST_isFilenameSafe('/home/x/foo.token'), false);
  });

  it('rejects *credentials* files', () => {
    assert.equal(__TEST_isFilenameSafe('/home/x/my-credentials.json'), false);
    assert.equal(__TEST_isFilenameSafe('/home/x/cred_credentials.toml'), false);
  });

  it('rejects .pem / .crt / .key files', () => {
    assert.equal(__TEST_isFilenameSafe('/home/x/cert.pem'), false);
    assert.equal(__TEST_isFilenameSafe('/home/x/api.key'), false);
    assert.equal(__TEST_isFilenameSafe('/home/x/cert.crt'), false);
  });

  it('rejects auth_anything prefix', () => {
    assert.equal(__TEST_isFilenameSafe('/home/x/auth_session.json'), false);
  });

  it('accepts known-safe config filenames', () => {
    assert.equal(__TEST_isFilenameSafe('/home/x/.claude/mcp.json'), true);
    assert.equal(__TEST_isFilenameSafe('/home/x/.claude/CLAUDE.md'), true);
    assert.equal(__TEST_isFilenameSafe('/home/x/.codex/config.toml'), true);
  });

  it('forbidden pattern list is non-empty (sanity)', () => {
    assert.ok(__TEST_FORBIDDEN_PATTERNS.length >= 5);
  });
});

describe('External scanner — empty homedir tolerance', () => {
  it('returns [] when ~/.claude and ~/.codex do not exist', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-ext-test-'));
    try {
      const out = scanExternalFrameworkExtensions({ homeDir: tmp });
      assert.deepEqual(out, []);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('External scanner — ClaudeCode detection', () => {
  it('detects user mcp.json + CLAUDE.md + skills + commands', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-claude-'));
    try {
      const claudeDir = path.join(tmp, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, 'mcp.json'),
        JSON.stringify({ mcpServers: { weather: { command: 'mcp-weather' }, jira: { command: 'mcp-jira' } } }),
        'utf-8',
      );
      fs.writeFileSync(path.join(claudeDir, 'CLAUDE.md'), '# My memory\nFoo bar.', 'utf-8');
      fs.mkdirSync(path.join(claudeDir, 'skills', 'review'), { recursive: true });
      fs.mkdirSync(path.join(claudeDir, 'commands'), { recursive: true });
      fs.writeFileSync(path.join(claudeDir, 'commands', 'plan.md'), '# /plan', 'utf-8');

      const out = scanExternalFrameworkExtensions({ homeDir: tmp });
      const ids = out.map((e) => e.id);
      assert.ok(ids.includes('claude:mcp:weather'));
      assert.ok(ids.includes('claude:mcp:jira'));
      assert.ok(ids.includes('claude:CLAUDE.md'));
      assert.ok(ids.includes('claude:skill:review'));
      assert.ok(ids.includes('claude:cmd:plan'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('External scanner — active-framework executable flag', () => {
  it('marks executable=true when activeFramework matches', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-active-'));
    try {
      const claudeDir = path.join(tmp, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(
        path.join(claudeDir, 'mcp.json'),
        JSON.stringify({ mcpServers: { x: { command: 'mcp-x' } } }),
        'utf-8',
      );

      const claudeActive = scanExternalFrameworkExtensions({
        homeDir: tmp,
        activeFramework: 'claude_code',
      });
      const x = claudeActive.find((e) => e.id === 'claude:mcp:x');
      assert.ok(x);
      assert.equal(x!.executable, true);
      assert.equal(x!.perceptionHint, undefined);

      const codexActive = scanExternalFrameworkExtensions({
        homeDir: tmp,
        activeFramework: 'codex',
      });
      const xCodex = codexActive.find((e) => e.id === 'claude:mcp:x');
      assert.ok(xCodex);
      assert.equal(xCodex!.executable, false);
      assert.ok(
        xCodex!.perceptionHint,
        'when active framework differs, perceptionHint must be populated',
      );
      assert.match(xCodex!.perceptionHint!, /ClaudeCode/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('External scanner — Codex detection', () => {
  it('detects ~/.codex/config.toml + plugins/ + prompts/', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-codex-'));
    try {
      const codexDir = path.join(tmp, '.codex');
      fs.mkdirSync(codexDir, { recursive: true });
      fs.writeFileSync(path.join(codexDir, 'config.toml'), '[providers]\n', 'utf-8');
      fs.mkdirSync(path.join(codexDir, 'plugins', 'my-plugin'), { recursive: true });
      fs.mkdirSync(path.join(codexDir, 'prompts'), { recursive: true });
      fs.writeFileSync(
        path.join(codexDir, 'prompts', 'review-prompt.md'),
        '# review',
        'utf-8',
      );

      const out = scanExternalFrameworkExtensions({ homeDir: tmp });
      const ids = out.map((e) => e.id);
      assert.ok(ids.includes('codex:config.toml'));
      assert.ok(ids.includes('codex:plugin:my-plugin'));
      assert.ok(ids.includes('codex:prompt:review-prompt'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('SKIPS ~/.codex/auth.json (forbidden filename)', () => {
    // Critical safety pin — even if user's Codex auth.json is in
    // ~/.codex, the scanner must NEVER surface it. Adding an
    // auth.json to the tmpdir and confirming the scanner doesn't
    // emit anything from it.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-codex-auth-'));
    try {
      const codexDir = path.join(tmp, '.codex');
      fs.mkdirSync(codexDir, { recursive: true });
      fs.writeFileSync(
        path.join(codexDir, 'auth.json'),
        JSON.stringify({ access_token: 'secret-xxx' }),
        'utf-8',
      );

      const out = scanExternalFrameworkExtensions({ homeDir: tmp });
      // No entries that mention auth.json
      for (const e of out) {
        assert.ok(
          !e.origin.endsWith('auth.json'),
          `scanner leaked auth.json into externalExtensions: ${JSON.stringify(e)}`,
        );
        assert.ok(
          !e.id.includes('auth'),
          `scanner leaked auth-named id: ${e.id}`,
        );
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('External scanner — malformed config tolerance', () => {
  it('skips invalid JSON in ~/.claude/mcp.json without throwing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-malformed-'));
    try {
      const claudeDir = path.join(tmp, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });
      fs.writeFileSync(path.join(claudeDir, 'mcp.json'), '{ not valid json', 'utf-8');

      // Must not throw
      const out = scanExternalFrameworkExtensions({ homeDir: tmp });
      // mcp entries should not be present (malformed) but other
      // entries may still appear if CLAUDE.md exists etc.
      const mcpEntries = out.filter((e) => e.id.startsWith('claude:mcp:'));
      assert.equal(mcpEntries.length, 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
