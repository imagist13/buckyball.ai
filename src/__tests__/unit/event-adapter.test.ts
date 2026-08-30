/**
 * Phase 0.5 Slice E — Event adapter translators.
 *
 * Pins:
 *   1. Constructor helpers produce the canonical RuntimeRunEvent
 *      shapes correctly (each of the 9 event types).
 *   2. SDK SSEEventType → canonical mapping table is exhaustive
 *      over the SDK's 17 event types. Each maps to one of the 8
 *      canonical types, `unknown_item`, or null (transport-only).
 *   3. `permission_request` SSE event is NOT in the canonical
 *      RuntimeRunEvent mapping — it flows through RuntimePermissionEvent
 *      (separate union, see permission-adapter.ts).
 *   4. `unknown_item` is the only fallback channel — never silently
 *      dropped at the adapter layer.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeAssistantDelta,
  makeToolStarted,
  makeToolCompleted,
  makeCommandStarted,
  makeFileChanged,
  makeUsageUpdated,
  makeRunCompleted,
  makeRunFailed,
  makeUnknownItem,
  mapSdkSseToCanonicalType,
  translateUnknownSdkEvent,
} from '@/lib/runtime/event-adapter';

describe('RuntimeRunEvent constructor helpers', () => {
  const base = { runtimeId: 'claude_code' as const, sessionId: 's' };

  it('makeAssistantDelta produces assistant_delta', () => {
    const e = makeAssistantDelta(base, 'hello');
    assert.equal(e.type, 'assistant_delta');
    assert.equal(e.text, 'hello');
  });

  it('makeToolStarted produces tool_started with toolId + name', () => {
    const e = makeToolStarted(base, { toolId: 't1', name: 'Bash', input: { cmd: 'ls' } });
    assert.equal(e.type, 'tool_started');
    assert.equal(e.toolId, 't1');
    assert.equal(e.name, 'Bash');
    assert.deepEqual(e.input, { cmd: 'ls' });
  });

  it('makeToolCompleted carries either output OR error', () => {
    const ok = makeToolCompleted(base, { toolId: 't1', output: 'ok' });
    const fail = makeToolCompleted(base, { toolId: 't1', error: 'timeout' });
    assert.equal(ok.type, 'tool_completed');
    assert.equal(ok.output, 'ok');
    assert.equal(fail.error, 'timeout');
  });

  it('makeCommandStarted carries command + optional cwd', () => {
    const e = makeCommandStarted(base, { commandId: 'c1', command: 'pwd', cwd: '/tmp' });
    assert.equal(e.type, 'command_started');
    assert.equal(e.command, 'pwd');
    assert.equal(e.cwd, '/tmp');
  });

  it('makeFileChanged accepts readonly paths + optional operation', () => {
    const e = makeFileChanged(base, { paths: ['/a', '/b'], operation: 'modified' });
    assert.equal(e.type, 'file_changed');
    assert.deepEqual([...e.paths], ['/a', '/b']);
    assert.equal(e.operation, 'modified');
  });

  it('makeUsageUpdated carries token counts + optional contextWindow', () => {
    const e = makeUsageUpdated(base, { inputTokens: 100, outputTokens: 50, contextWindow: 200000 });
    assert.equal(e.type, 'usage_updated');
    assert.equal(e.inputTokens, 100);
    assert.equal(e.contextWindow, 200000);
  });

  it('makeRunCompleted accepts optional finishReason', () => {
    const bare = makeRunCompleted(base);
    const reasoned = makeRunCompleted(base, { finishReason: 'end_turn' });
    assert.equal(bare.type, 'run_completed');
    assert.equal((bare as { finishReason?: string }).finishReason, undefined);
    assert.equal(reasoned.type, 'run_completed');
    assert.equal((reasoned as { finishReason?: string }).finishReason, 'end_turn');
  });

  it('makeRunFailed requires code + message', () => {
    const e = makeRunFailed(base, { code: 'auth_failed', message: 'token expired' });
    assert.equal(e.type, 'run_failed');
    assert.equal(e.code, 'auth_failed');
    assert.equal(e.message, 'token expired');
  });

  it('makeUnknownItem is the mandatory fallback channel', () => {
    const e = makeUnknownItem(base, { sourceType: 'sdk.mode_changed', payload: { mode: 'plan' } });
    assert.equal(e.type, 'unknown_item');
    assert.equal(e.sourceType, 'sdk.mode_changed');
    assert.deepEqual(e.payload, { mode: 'plan' });
  });
});

describe('mapSdkSseToCanonicalType — SDK SSE → canonical mapping', () => {
  // The 17 SSE types known to the adapter. Three return categories:
  // canonical type | null (known transport-only) | 'unknown_item' (drift fallback).
  const cases: Array<[string, string | null]> = [
    ['text', 'assistant_delta'],
    ['thinking', 'assistant_delta'],
    ['tool_use', 'tool_started'],
    ['tool_result', 'tool_completed'],
    ['tool_output', 'tool_started'],
    ['tool_timeout', 'tool_completed'],
    ['status', 'unknown_item'],
    ['result', 'run_completed'],
    ['error', 'run_failed'],
    ['permission_request', null], // handled by permission-adapter
    ['mode_changed', 'unknown_item'],
    ['task_update', 'unknown_item'],
    ['keep_alive', null], // transport-only heartbeat
    ['rewind_point', 'unknown_item'],
    ['rate_limit', 'unknown_item'],
    ['context_usage', 'usage_updated'],
    ['done', 'run_completed'],
  ];

  for (const [sdkType, expected] of cases) {
    it(`maps SDK '${sdkType}' → ${expected ?? 'null (transport-only)'}`, () => {
      assert.equal(mapSdkSseToCanonicalType(sdkType), expected);
    });
  }

  it('unknown SDK type falls into unknown_item fallback (P2 fix)', () => {
    // Earlier revision returned null for both transport-only and
    // unknown — that conflation lost new SDK / Codex items silently.
    // Now unknown types route to unknown_item so the adapter MUST
    // surface them via makeUnknownItem / translateUnknownSdkEvent.
    assert.equal(mapSdkSseToCanonicalType('completely_unknown_sdk_event'), 'unknown_item');
    assert.equal(mapSdkSseToCanonicalType('codex_future_plugin_item'), 'unknown_item');
  });

  it('null is reserved for known transport-only types only', () => {
    // After P2 fix, the only null returns are explicit entries in
    // the mapping table — keep_alive (heartbeat) and permission_request
    // (routed elsewhere). Adapters can confidently ignore null
    // because nothing has been dropped silently.
    assert.equal(mapSdkSseToCanonicalType('keep_alive'), null);
    assert.equal(mapSdkSseToCanonicalType('permission_request'), null);
  });
});

describe('translateUnknownSdkEvent — drift fallback helper', () => {
  it('wraps an unknown SDK event as canonical unknown_item with sdk.<type> sourceType', () => {
    const event = translateUnknownSdkEvent(
      { runtimeId: 'claude_code', sessionId: 's' },
      { sdkType: 'codex_future_plugin_item', payload: { foo: 1 } },
    );
    assert.equal(event.type, 'unknown_item');
    assert.equal(event.sourceType, 'sdk.codex_future_plugin_item');
    assert.deepEqual(event.payload, { foo: 1 });
  });

  it('preserves opaque payload — UI renders generically', () => {
    const event = translateUnknownSdkEvent(
      { runtimeId: 'codepilot_runtime', sessionId: 's' },
      { sdkType: 'mystery' },
    );
    assert.equal(event.sourceType, 'sdk.mystery');
    assert.equal(event.payload, undefined);
  });
});
