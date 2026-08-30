/**
 * Phase 0.5 Slice A guardrail — Runtime run-event union must cover
 * the 8 canonical types + the mandatory `unknown_item` fallback.
 *
 * Adapters translate their native events into this union. Items the
 * adapter doesn't recognize MUST land in `unknown_item` — never be
 * silently dropped. UI renders `unknown_item` as a generic block so
 * future Codex plugins / extensions stay visible even before
 * CodePilot has bespoke renderers for them.
 *
 * Slice E migrates the actual translators + SSE layer; Slice A
 * locks the type definitions + exhaustive list + the fallback path.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUNTIME_RUN_EVENT_TYPES,
  type RuntimeRunEvent,
  type RuntimeRunEventType,
} from '@/lib/runtime/contract';

describe('RuntimeRunEvent contract', () => {
  it('exposes exactly 8 canonical event types + unknown_item fallback', () => {
    const sorted = [...RUNTIME_RUN_EVENT_TYPES].sort();
    assert.deepEqual(sorted, [
      'assistant_delta',
      'command_started',
      'file_changed',
      'run_completed',
      'run_failed',
      'tool_completed',
      'tool_started',
      'unknown_item',
      'usage_updated',
    ]);
    assert.equal(RUNTIME_RUN_EVENT_TYPES.length, 9);
  });

  it('includes the unknown_item fallback as a first-class member', () => {
    assert.ok(
      RUNTIME_RUN_EVENT_TYPES.includes('unknown_item'),
      'unknown_item must be in the canonical list — it is the mandatory ' +
        'fallback channel for adapter-side payloads that do not fit the 8 main types.',
    );
  });

  it('union is exhaustive — assertNever guards future drift', () => {
    function visit(t: RuntimeRunEventType): string {
      switch (t) {
        case 'assistant_delta':
        case 'tool_started':
        case 'tool_completed':
        case 'command_started':
        case 'file_changed':
        case 'usage_updated':
        case 'run_completed':
        case 'run_failed':
        case 'unknown_item':
          return t;
        default: {
          const _: never = t;
          throw new Error(`unhandled run event type: ${String(_)}`);
        }
      }
    }
    for (const t of RUNTIME_RUN_EVENT_TYPES) {
      assert.equal(visit(t), t);
    }
  });

  it('unknown_item event carries adapter sourceType + opaque payload', () => {
    // Adapters use this to surface plugin / extension items they
    // don't have a canonical mapping for. `sourceType` is a short
    // adapter-defined string; `payload` is opaque to UI.
    const event: RuntimeRunEvent = {
      type: 'unknown_item',
      runtimeId: 'claude_code',
      sessionId: 's',
      sourceType: 'codex.plugin.unknown',
      payload: { foo: 'bar' },
    };
    assert.equal(event.type, 'unknown_item');
    assert.equal(typeof event.sourceType, 'string');
    assert.ok(event.sourceType.length > 0);
  });

  it('every event carries runtimeId + sessionId base fields', () => {
    const delta: RuntimeRunEvent = {
      type: 'assistant_delta',
      runtimeId: 'claude_code',
      sessionId: 's',
      text: 'hello',
    };
    const usage: RuntimeRunEvent = {
      type: 'usage_updated',
      runtimeId: 'codepilot_runtime',
      sessionId: 's',
      inputTokens: 100,
      outputTokens: 50,
      contextWindow: 200_000,
    };
    for (const e of [delta, usage]) {
      assert.equal(typeof e.runtimeId, 'string');
      assert.equal(typeof e.sessionId, 'string');
    }
  });
});
