/**
 * Tests for buildNativeErrorEventData (audit A3).
 *
 * Pure-function contract for the Native runtime `error` SSE event payload.
 * Asserts the normal error path (no snapshot → legacy shape) vs the tool-call
 * error path (snapshot present → context_accounting attached) — the
 * normal-vs-trigger difference required by the project's anti-fake-data rule.
 *
 * The agent-loop catch block that calls this can't be driven in a pure unit
 * context (agent-loop.ts depends on DB/streaming), so this locks the payload
 * shape; the drain+attach wiring in agent-loop.ts is exercised by smoke.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildNativeErrorEventData } from '@/lib/agent-loop-error-event';
import type { RuntimeContextAccountingSnapshot } from '@/types';

describe('buildNativeErrorEventData (audit A3)', () => {
  it('normal error path: omits context_accounting when no snapshot', () => {
    const data = buildNativeErrorEventData(new Error('boom'));
    assert.equal(data.category, 'AGENT_ERROR');
    assert.equal(data.userMessage, 'boom');
    assert.equal('context_accounting' in data, false);
  });

  it('tool-call error path: attaches the snapshot when present', () => {
    const snapshot = { sentinel: true } as unknown as RuntimeContextAccountingSnapshot;
    const data = buildNativeErrorEventData(new Error('boom'), snapshot);
    assert.equal(data.context_accounting, snapshot);
  });

  it('does not attach context_accounting for an explicit undefined snapshot', () => {
    const data = buildNativeErrorEventData(new Error('boom'), undefined);
    assert.equal('context_accounting' in data, false);
  });

  it('stringifies non-Error throws', () => {
    assert.equal(buildNativeErrorEventData('plain string').userMessage, 'plain string');
    assert.equal(buildNativeErrorEventData(42).userMessage, '42');
  });

  it('uses structured X Search failures only when the hosted capability was mounted', () => {
    const forbidden = Object.assign(new Error('forbidden'), { statusCode: 403 });
    assert.equal(
      buildNativeErrorEventData(forbidden, undefined, undefined, {
        xaiSearchEnabled: true,
      }).category,
      'XAI_X_SEARCH_FORBIDDEN',
    );
    assert.equal(
      buildNativeErrorEventData(forbidden).category,
      'AGENT_ERROR',
      'ordinary provider calls must not be mislabeled as X Search failures',
    );
  });
});
