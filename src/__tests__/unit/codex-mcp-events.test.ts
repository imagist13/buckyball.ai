/**
 * Phase 8 Phase 3 — Codex MCP event bridge.
 *
 * Run: npx tsx --test src/__tests__/unit/codex-mcp-events.test.ts
 *
 * Covers: MCP server startup success/failure surfacing (no longer silent),
 * MCP tool start + completed(success/error) → canonical tool events, and a
 * source pin on the runtime's safe-decline elicitation handler.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { translateCodexNotification } from '../../lib/codex/event-mapper';
import {
  codexElicitationPolicy,
  handleCodexMcpElicitationApproval,
} from '../../lib/codex/mcp-elicitation';
import { resolvePendingPermission } from '../../lib/permission-registry';
import {
  handleSSEEvent,
  resolveInternalRuntimeStatus,
  resolveSafeStatusFallback,
} from '../../hooks/useSSEStream';
import { setActiveLocale } from '../../i18n';

const ctx = { sessionId: 'sess-1' } as const;

describe('mcpServer/startupStatus/updated — user-safe lifecycle display', () => {
  it('failed → structured diagnostic plus localized human copy', () => {
    const ev = translateCodexNotification(
      'mcpServer/startupStatus/updated',
      { name: 'codepilot_memory', status: 'failed', error: 'handshake failed' },
      ctx,
    );
    assert.ok(ev);
    assert.equal(ev!.type, 'unknown_item');
    const e = ev as { type: 'unknown_item'; sourceType: string; payload: { server: string; error: string } };
    assert.equal(e.sourceType, 'codex.mcpServerStartupFailed');
    assert.equal(e.payload.server, 'codepilot_memory');
    assert.equal(e.payload.error, 'handshake failed');

    setActiveLocale('zh');
    try {
      const display = resolveInternalRuntimeStatus({ kind: e.sourceType, payload: e.payload });
      assert.equal(display.handled, true);
      assert.equal(display.text, '一个工具连接失败，部分功能可能暂时不可用。');
      assert.doesNotMatch(display.text ?? '', /codepilot_memory|handshake|\{|\}/);
    } finally {
      setActiveLocale('en');
    }
  });

  it('ready → silent, including defensive handling of an older server envelope', () => {
    const ev = translateCodexNotification(
      'mcpServer/startupStatus/updated',
      { name: 'codepilot_memory', status: 'ready', error: null },
      ctx,
    );
    assert.equal(ev, null);
    assert.deepEqual(
      resolveInternalRuntimeStatus({
        kind: 'codex.mcpServerReady',
        payload: { server: 'openaiDeveloperDocs' },
      }),
      { handled: true },
    );
  });

  it('starting (transient) → no event (avoid noise)', () => {
    const ev = translateCodexNotification(
      'mcpServer/startupStatus/updated',
      { name: 'codepilot_memory', status: 'starting', error: null },
      ctx,
    );
    assert.equal(ev, null);
  });

  it('both chat entry points consume internal Runtime statuses before generic display', () => {
    const hookSrc = fs.readFileSync(path.resolve(__dirname, '../../hooks/useSSEStream.ts'), 'utf-8');
    const firstTurnSrc = fs.readFileSync(path.resolve(__dirname, '../../app/chat/page.tsx'), 'utf-8');
    assert.match(hookSrc, /resolveInternalRuntimeStatus\(statusData\)/);
    assert.match(firstTurnSrc, /resolveInternalRuntimeStatus\(statusData\)/);
  });

  it('unknown Codex lifecycle kinds degrade to human copy, while non-Codex status stays generic', () => {
    setActiveLocale('zh');
    try {
      assert.deepEqual(
        resolveInternalRuntimeStatus({ kind: 'codex.futureLifecycle', payload: { raw: true } }),
        { handled: true, text: '运行状态已更新。' },
      );
      assert.deepEqual(
        resolveInternalRuntimeStatus({ kind: 'codex_retry', payload: { willRetry: true } }),
        { handled: true, text: '正在重新连接...' },
      );
      assert.deepEqual(
        resolveInternalRuntimeStatus({ kind: 'claude.userFacingStatus' }),
        { handled: false },
      );
    } finally {
      setActiveLocale('en');
    }
  });

  it('generic fallback never renders structured or truncated JSON, and result clears status', () => {
    const statusTexts: Array<string | undefined> = [];
    const callbacks: Parameters<typeof handleSSEEvent>[2] = {
      onText: () => {},
      onToolUse: () => {},
      onToolResult: () => {},
      onToolOutput: () => {},
      onToolProgress: () => {},
      onStatus: (text) => statusTexts.push(text),
      onResult: () => {},
      onPermissionRequest: () => {},
      onToolTimeout: () => {},
      onModeChanged: () => {},
      onTaskUpdate: () => {},
      onRewindPoint: () => {},
      onKeepAlive: () => {},
      onError: () => {},
    };

    setActiveLocale('zh');
    try {
      handleSSEEvent(
        { type: 'status', data: JSON.stringify({ kind: 'native.futureLifecycle', payload: { raw: true } }) },
        '',
        callbacks,
      );
      handleSSEEvent(
        { type: 'status', data: '{"kind":"native.partial"' },
        '',
        callbacks,
      );
      handleSSEEvent(
        { type: 'status', data: 'Indexing workspace...' },
        '',
        callbacks,
      );
      handleSSEEvent({ type: 'result', data: '{}' }, '', callbacks);
    } finally {
      setActiveLocale('en');
    }

    assert.deepEqual(statusTexts, [
      '运行状态已更新。',
      '运行状态已更新。',
      'Indexing workspace...',
      undefined,
    ]);
    assert.equal(
      resolveSafeStatusFallback('{"kind":"native.partial"'),
      'Runtime status updated.',
    );
  });
});

describe('mcpToolCall → canonical tool events', () => {
  it('item/started mcpToolCall → tool_started named server.tool', () => {
    const ev = translateCodexNotification(
      'item/started',
      { item: { id: 'i1', type: 'mcpToolCall', server: 'codepilot_memory', tool: 'memory_search', arguments: { query: 'x' } } },
      ctx,
    );
    assert.equal(ev?.type, 'tool_started');
    const e = ev as { type: 'tool_started'; toolId: string; name: string };
    assert.equal(e.name, 'codepilot_memory.memory_search');
    assert.equal(e.toolId, 'i1');
  });

  it('item/completed mcpToolCall failed → tool_completed WITH canonical error', () => {
    const ev = translateCodexNotification(
      'item/completed',
      { item: { id: 'i1', type: 'mcpToolCall', status: 'failed', error: { message: 'tool blew up' } } },
      ctx,
    );
    assert.equal(ev?.type, 'tool_completed');
    const e = ev as { type: 'tool_completed'; toolId: string; error?: string };
    assert.equal(e.error, 'tool blew up');
  });

  it('item/completed mcpToolCall success → tool_completed, no error', () => {
    const ev = translateCodexNotification(
      'item/completed',
      { item: { id: 'i1', type: 'mcpToolCall', status: 'completed', result: { content: [] } } },
      ctx,
    );
    assert.equal(ev?.type, 'tool_completed');
    assert.equal((ev as { error?: string }).error, undefined);
  });
});

describe('runtime elicitation handler (source pin)', () => {
  const runtimeSrc = fs.readFileSync(path.resolve(__dirname, '../../lib/codex/runtime.ts'), 'utf-8');

  it('registers mcpServer/elicitation/request and routes by policy', () => {
    assert.ok(runtimeSrc.includes("'mcpServer/elicitation/request'"), 'must register elicitation handler');
    assert.ok(runtimeSrc.includes('codexElicitationPolicy'), 'handler must classify via the unit-tested policy');
    // mutating servers must route to user approval, not auto-accept
    assert.ok(runtimeSrc.includes('handleCodexMcpElicitationApproval'), 'user_approval must route to the approval flow');
  });
});

describe('codexElicitationPolicy — built-in MCP tool-call approval classification', () => {
  it('safe-read built-ins (memory, widget) → auto_accept', () => {
    assert.equal(codexElicitationPolicy('codepilot_memory'), 'auto_accept');
    assert.equal(codexElicitationPolicy('codepilot_widget'), 'auto_accept');
  });

  it('mutating / side-effecting built-ins (tasks) → user_approval (never auto-accepted)', () => {
    assert.equal(codexElicitationPolicy('codepilot_tasks'), 'user_approval');
  });

  it('mutation-level split — read MCPs (dashboard_read / cli_tools_read) → auto_accept', () => {
    // Codex review next slice (2026-05-28): read-only halves of the
    // Dashboard / CLI split. list / refresh / check_updates are safe-read,
    // so their elicitation auto-accepts.
    assert.equal(codexElicitationPolicy('codepilot_dashboard_read'), 'auto_accept');
    assert.equal(codexElicitationPolicy('codepilot_cli_tools_read'), 'auto_accept');
  });

  it('mutation-level split — write MCPs (dashboard_write / cli_tools_write) → user_approval', () => {
    // Mutating halves: pin / update / remove (dashboard) and install / add /
    // remove / update (cli). The model's call MUST hit the user's approval
    // card before anything runs; never auto-accepted.
    assert.equal(codexElicitationPolicy('codepilot_dashboard_write'), 'user_approval');
    assert.equal(codexElicitationPolicy('codepilot_cli_tools_write'), 'user_approval');
  });

  it('unknown server / null / undefined → decline (never blanket-accept)', () => {
    for (const s of ['user_weather', 'chrome-devtools', 'some_mutating_server']) {
      assert.equal(codexElicitationPolicy(s), 'decline', `${s} must decline`);
    }
    assert.equal(codexElicitationPolicy(null), 'decline');
    assert.equal(codexElicitationPolicy(undefined), 'decline');
  });
});

describe('handleCodexMcpElicitationApproval — user-approval round-trip', () => {
  it('emits a permission_request SSE (with mode + schema for judgeability) and ACCEPTS iff the user approves', async () => {
    const lines: string[] = [];
    const sessionId = 'sess-approval';
    const jsonRpcId = `accept-${Date.now()}`;
    const pending = handleCodexMcpElicitationApproval({
      sessionId,
      jsonRpcId,
      serverName: 'codepilot_tasks',
      message: 'schedule a follow-up',
      mode: 'tool_call',
      requestedSchema: { type: 'object', properties: { confirm: { type: 'boolean' } } },
      emitSse: (l) => lines.push(l),
    });
    // Let it emit the prompt + register the pending permission, then approve.
    await new Promise((r) => setTimeout(r, 10));
    const emitted = lines.find((l) => l.includes('"type":"permission_request"'));
    assert.ok(emitted, 'must emit a permission_request SSE for the user');
    assert.match(emitted!, /codepilot_tasks/, 'prompt must name the originating server');
    // Audit/judgeability enrichment: mode + requestedSchema reach the prompt.
    assert.match(emitted!, /tool_call/, 'prompt must carry the elicitation mode');
    assert.match(emitted!, /requestedSchema/, 'prompt must carry the requested schema');
    assert.match(emitted!, /confirm/, 'requested schema fields must survive into the prompt');
    // sessionId-scoped id — resolving an unscoped id must NOT match.
    assert.equal(resolvePendingPermission(`codex-mcp-elicit:${jsonRpcId}`, { behavior: 'allow' }), false);
    assert.equal(resolvePendingPermission(`codex-mcp-elicit:${sessionId}:${jsonRpcId}`, { behavior: 'allow' }), true);
    const res = await pending;
    assert.equal(res.action, 'accept');
  });

  it('DECLINES when the user denies (never auto-runs a mutating tool)', async () => {
    const sessionId = 'sess-approval';
    const jsonRpcId = `deny-${Date.now()}`;
    const pending = handleCodexMcpElicitationApproval({
      sessionId,
      jsonRpcId,
      serverName: 'codepilot_tasks',
      message: 'send a notification',
      emitSse: () => {},
    });
    await new Promise((r) => setTimeout(r, 10));
    resolvePendingPermission(`codex-mcp-elicit:${sessionId}:${jsonRpcId}`, { behavior: 'deny', message: 'no' });
    const res = await pending;
    assert.equal(res.action, 'decline');
  });
});
