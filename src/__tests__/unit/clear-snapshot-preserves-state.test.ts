/**
 * 2026-06-10 — post-stream display loss after idle/remount.
 *
 * Root cause: clearSnapshot() reset `startedAt: 0`, and getSnapshot()
 * treats `startedAt === 0` as a stale placeholder and returns null. So the
 * moment useStreamSubscription consumed finalMessageContent, the WHOLE
 * snapshot (terminal reason, token usage, context usage) became invisible
 * to any later mount — the "output display bug after long idle".
 *
 * The fix narrows clearSnapshot to its real job: mark finalMessageContent
 * as consumed (it must never be appended twice) and leave the rest of the
 * snapshot readable until GC reclaims the entry. These tests pin that
 * contract.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  seedSnapshotPatch,
  getSnapshot,
  clearSnapshot,
} from '@/lib/stream-session-manager';

const STREAMS_KEY = '__streamSessionManager__';

beforeEach(() => {
  (globalThis as Record<string, unknown>)[STREAMS_KEY] = new Map();
});

describe('clearSnapshot — consumes finalMessageContent without hiding the snapshot', () => {
  it('keeps the snapshot readable after clear (the regression: getSnapshot returned null)', () => {
    seedSnapshotPatch('s1', {
      finalMessageContent: 'hello world',
      tokenUsage: { input_tokens: 10, output_tokens: 5 } as never,
    });

    clearSnapshot('s1');

    const snap = getSnapshot('s1');
    assert.ok(snap, 'snapshot must stay readable after clearSnapshot');
    assert.equal(snap.phase, 'completed');
  });

  it('nulls finalMessageContent so a remount cannot append the message twice', () => {
    seedSnapshotPatch('s2', { finalMessageContent: 'only once' });

    assert.equal(getSnapshot('s2')?.finalMessageContent, 'only once');
    clearSnapshot('s2');
    assert.equal(getSnapshot('s2')?.finalMessageContent, null);
  });

  it('preserves post-stream state (tokenUsage) through the clear', () => {
    seedSnapshotPatch('s3', {
      finalMessageContent: 'x',
      tokenUsage: { input_tokens: 42, output_tokens: 7 } as never,
    });

    clearSnapshot('s3');

    const snap = getSnapshot('s3');
    assert.deepEqual(snap?.tokenUsage, { input_tokens: 42, output_tokens: 7 });
  });

  it('does not touch an active stream', () => {
    seedSnapshotPatch('s4', { finalMessageContent: 'mid-stream' });
    const map = (globalThis as Record<string, unknown>)[STREAMS_KEY] as Map<
      string,
      { snapshot: { phase: string; finalMessageContent: string | null } }
    >;
    map.get('s4')!.snapshot.phase = 'active';

    clearSnapshot('s4');

    assert.equal(map.get('s4')!.snapshot.finalMessageContent, 'mid-stream');
  });
});
