/**
 * Phase 8 Phase 1 — Codex MCP config builder.
 *
 * Run: npx tsx --test src/__tests__/unit/codex-mcp-config.test.ts
 *
 * Covers the acceptance criteria: stdio / http / unsupported(sse + missing
 * fields) / disabled-skip / env+header redaction / fingerprint stability /
 * Memory MCP entry shape (carries no secrets).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MCPServerConfig } from '../../types';
import {
  buildCodexMcpServersConfig,
  buildCodexMemoryMcpConfig,
  buildCodexWidgetMcpConfig,
  fingerprintCodexMcpConfig,
  redactCodexMcpConfigForLog,
  isStdioEntry,
  sameRealPath,
  CODEX_MEMORY_MCP_SERVER_NAME,
  CODEX_WIDGET_MCP_SERVER_NAME,
  MEMORY_MCP_WORKSPACE_HEADER,
  type CodexMcpServersConfig,
} from '../../lib/codex/mcp-config';

describe('buildCodexMcpServersConfig', () => {
  it('maps stdio with command/args/env', () => {
    const input: Record<string, MCPServerConfig> = {
      'my-stdio': { type: 'stdio', command: 'node', args: ['s.js'], env: { K: 'v' } },
    };
    const { servers, unsupported } = buildCodexMcpServersConfig(input);
    assert.deepEqual(servers['my-stdio'], { command: 'node', args: ['s.js'], env: { K: 'v' } });
    assert.equal(unsupported.length, 0);
  });

  it('defaults to stdio when type omitted', () => {
    const { servers } = buildCodexMcpServersConfig({ s: { command: 'python', args: ['x.py'] } });
    assert.deepEqual(servers['s'], { command: 'python', args: ['x.py'] });
  });

  it('maps http → streamable_http { url, http_headers } (NO type discriminator)', () => {
    const { servers } = buildCodexMcpServersConfig({
      remote: { type: 'http', url: 'http://localhost:9090/mcp', headers: { Authorization: 'Bearer x' } },
    });
    assert.deepEqual(servers['remote'], {
      url: 'http://localhost:9090/mcp',
      http_headers: { Authorization: 'Bearer x' },
    });
    // Codex selects transport by shape — must NOT emit a `type` field.
    assert.equal('type' in servers['remote'], false);
  });

  it('marks sse as unsupported (Codex has no native SSE)', () => {
    const { servers, unsupported } = buildCodexMcpServersConfig({
      legacy: { type: 'sse', url: 'http://x/sse' },
    });
    assert.equal(servers['legacy'], undefined);
    assert.equal(unsupported.length, 1);
    assert.equal(unsupported[0].name, 'legacy');
    assert.match(unsupported[0].reason, /SSE/);
  });

  it('marks stdio without command + http without url as unsupported (not silently dropped)', () => {
    const { servers, unsupported } = buildCodexMcpServersConfig({
      'bad-stdio': { type: 'stdio', command: '' },
      'bad-http': { type: 'http' },
    });
    assert.equal(Object.keys(servers).length, 0);
    assert.deepEqual(unsupported.map((u) => u.name).sort(), ['bad-http', 'bad-stdio']);
  });

  it('skips disabled servers silently', () => {
    const { servers, unsupported } = buildCodexMcpServersConfig({
      off: { command: 'node', enabled: false },
      on: { command: 'node' },
    });
    assert.deepEqual(Object.keys(servers), ['on']);
    assert.equal(unsupported.length, 0);
  });

  it('handles mixed transports together', () => {
    const { servers, unsupported } = buildCodexMcpServersConfig({
      a: { command: 'node', args: ['a.js'] },
      b: { type: 'http', url: 'http://h/mcp' },
      c: { type: 'sse', url: 'http://h/sse' },
    });
    assert.deepEqual(Object.keys(servers).sort(), ['a', 'b']);
    assert.ok(isStdioEntry(servers['a']));
    assert.equal(isStdioEntry(servers['b']), false);
    assert.deepEqual(unsupported.map((u) => u.name), ['c']);
  });
});

describe('buildCodexMemoryMcpConfig', () => {
  it('builds a streamable_http entry pointing at the Next route with a workspace header', () => {
    const { name, entry } = buildCodexMemoryMcpConfig({
      baseUrl: 'http://127.0.0.1:3000/',
      workspacePath: '/ws/assistant',
      sessionId: 'sess-1',
    });
    assert.equal(name, CODEX_MEMORY_MCP_SERVER_NAME);
    assert.equal(entry.url, 'http://127.0.0.1:3000/api/codex/mcp/codepilot_memory');
    assert.equal(entry.http_headers?.[MEMORY_MCP_WORKSPACE_HEADER], '/ws/assistant');
  });

  it('carries no secrets — only workspace path + session id in headers', () => {
    const { entry } = buildCodexMemoryMcpConfig({ baseUrl: 'http://x:3000', workspacePath: '/ws' });
    const headerValues = Object.values(entry.http_headers ?? {});
    for (const v of headerValues) {
      assert.doesNotMatch(v, /token|secret|key|bearer|password/i);
    }
    assert.equal('bearer_token_env_var' in entry, false);
  });
});

describe('buildCodexWidgetMcpConfig', () => {
  it('points at the widget route with NO workspace header (static guidelines, not scoped)', () => {
    const { name, entry } = buildCodexWidgetMcpConfig({ baseUrl: 'http://127.0.0.1:3000', sessionId: 'sess-1' });
    assert.equal(name, CODEX_WIDGET_MCP_SERVER_NAME);
    assert.equal(entry.url, 'http://127.0.0.1:3000/api/codex/mcp/codepilot_widget');
    assert.equal(entry.http_headers?.[MEMORY_MCP_WORKSPACE_HEADER], undefined);
  });

  it('omits http_headers entirely when no session id', () => {
    const { entry } = buildCodexWidgetMcpConfig({ baseUrl: 'http://x:3000' });
    assert.equal(entry.http_headers, undefined);
  });
});

describe('fingerprintCodexMcpConfig', () => {
  it('is stable regardless of key order', () => {
    const a: CodexMcpServersConfig = { x: { command: 'a' }, y: { url: 'http://h', http_headers: { A: '1', B: '2' } } };
    const b: CodexMcpServersConfig = { y: { http_headers: { B: '2', A: '1' }, url: 'http://h' }, x: { command: 'a' } };
    assert.equal(fingerprintCodexMcpConfig(a), fingerprintCodexMcpConfig(b));
  });

  it('changes when config changes', () => {
    const a: CodexMcpServersConfig = { x: { command: 'a' } };
    const b: CodexMcpServersConfig = { x: { command: 'b' } };
    assert.notEqual(fingerprintCodexMcpConfig(a), fingerprintCodexMcpConfig(b));
  });

  it('returns "none" for empty/undefined', () => {
    assert.equal(fingerprintCodexMcpConfig(undefined), 'none');
    assert.equal(fingerprintCodexMcpConfig({}), 'none');
  });
});

describe('sameRealPath (runtime gate ↔ route authorization)', () => {
  it('equal paths → true; trailing slash normalized → true', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srp-'));
    try {
      assert.equal(sameRealPath(dir, dir), true);
      assert.equal(sameRealPath(dir, dir + path.sep), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('symlink resolves to the same real path → true (e.g. /tmp → /private/tmp class)', () => {
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'srp-real-'));
    const link = path.join(os.tmpdir(), `srp-link-${Date.now()}`);
    try {
      fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : undefined);
      assert.equal(sameRealPath(link, real), true);
    } finally {
      fs.rmSync(link, { force: true });
      fs.rmSync(real, { recursive: true, force: true });
    }
  });

  it('different dirs → false; non-existent path → false', () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'srp-a-'));
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'srp-b-'));
    try {
      assert.equal(sameRealPath(a, b), false);
      assert.equal(sameRealPath(a, path.join(a, 'does-not-exist')), false);
    } finally {
      fs.rmSync(a, { recursive: true, force: true });
      fs.rmSync(b, { recursive: true, force: true });
    }
  });
});

describe('redactCodexMcpConfigForLog', () => {
  it('redacts stdio env values and http_headers values, keeps keys/structure', () => {
    const config: CodexMcpServersConfig = {
      s: { command: 'node', env: { SECRET: 'shh', API_KEY: 'abc' } },
      h: { url: 'http://h/mcp', http_headers: { Authorization: 'Bearer xyz' } },
    };
    const red = redactCodexMcpConfigForLog(config);
    assert.deepEqual((red['s'] as { env: Record<string, string> }).env, { SECRET: '[redacted]', API_KEY: '[redacted]' });
    assert.deepEqual((red['h'] as { http_headers: Record<string, string> }).http_headers, { Authorization: '[redacted]' });
    // command / url (non-secret) survive
    assert.equal((red['s'] as { command: string }).command, 'node');
    assert.equal((red['h'] as { url: string }).url, 'http://h/mcp');
    // original is untouched (redaction returns a copy)
    assert.equal((config['s'] as { env: Record<string, string> }).env.SECRET, 'shh');
  });
});
