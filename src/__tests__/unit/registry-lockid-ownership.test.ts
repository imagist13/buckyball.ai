/**
 * Session ownership — lockId ownership gate.
 *
 * Behavioral (DI) tests, not source-pins. Two seams that Phase 3's I1
 * invariant depends on:
 *
 *   1. conversation-registry: unregister must be gated on the SAME lockId that
 *      registered the Query. A late unregister carrying a SUPERSEDED turn's old
 *      lockId must be a no-op — otherwise it evicts the Query registered by the
 *      turn that took over, and interrupt()/getConversation stops finding the
 *      live stream (violates I1).
 *
 *   2. db.isLockOwner: pure read of "does this lockId still own the row",
 *      independent of TTL. Ownership (who holds it) is separate from liveness
 *      (TTL). Verified with a real acquire→own→release→not-own round-trip
 *      against the per-worker temp DB (db-isolation.setup.ts).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Query } from '@anthropic-ai/claude-agent-sdk';

import {
  abortConversation,
  registerConversation,
  unregisterConversation,
  getConversation,
} from '../../lib/conversation-registry';
import {
  acquireSessionLock,
  releaseSessionLock,
  isLockOwner,
  createSession,
} from '../../lib/db';

// Two distinct sentinel Query handles. We only need reference identity — the
// registry never calls into them — so a bare cast is enough (no real SDK).
function makeSentinelQuery(tag: string): Query {
  return { __tag: tag } as unknown as Query;
}

describe('conversation-registry lockId ownership gate', () => {
  it('late unregister from a superseded turn (old lockId) is a no-op; new owner survives', () => {
    const sid = 'reg-ownership-stale-unregister';
    const qA = makeSentinelQuery('A');
    const qB = makeSentinelQuery('B');

    // Turn A registers under lockA, then turn B takes over and registers qB
    // under lockB (overwriting the map entry, as a real takeover would).
    registerConversation(sid, qA, 'lockA');
    registerConversation(sid, qB, 'lockB');
    assert.equal(getConversation(sid), qB, 'B should own the slot after takeover');

    // Turn A's teardown fires LATE carrying its OLD lockId. It must NOT evict
    // qB — the whole point of the gate.
    unregisterConversation(sid, 'lockA');
    assert.equal(
      getConversation(sid),
      qB,
      'stale unregister (lockA) must not evict the new owner qB',
    );

    // The true owner (lockB) unregisters → slot clears.
    unregisterConversation(sid, 'lockB');
    assert.equal(
      getConversation(sid),
      undefined,
      'owner unregister (lockB) should clear the slot',
    );
  });

  it('unregister with a non-matching lockId leaves the entry intact', () => {
    const sid = 'reg-ownership-nonmatch';
    const q = makeSentinelQuery('solo');
    registerConversation(sid, q, 'lockX');

    unregisterConversation(sid, 'someone-elses-lock');
    assert.equal(getConversation(sid), q, 'wrong lockId must not delete');

    unregisterConversation(sid, 'lockX');
    assert.equal(getConversation(sid), undefined, 'matching lockId deletes');
  });

  it('unregister on an unknown session is a safe no-op (no throw)', () => {
    assert.doesNotThrow(() => unregisterConversation('reg-ownership-missing', 'whatever'));
  });

  it('aborts only the application-owned controller registered with the active turn', () => {
    const sid = 'reg-ownership-abort-controller';
    const q = makeSentinelQuery('abortable');
    const controller = new AbortController();
    registerConversation(sid, q, 'lock-abort', controller);

    assert.equal(abortConversation(sid, new Error('stop-smoke')), true);
    assert.equal(controller.signal.aborted, true);
    assert.match(String(controller.signal.reason), /stop-smoke/);
    assert.equal(getConversation(sid), q, 'aborting must not evict the live Query handle');

    unregisterConversation(sid, 'lock-abort');
    assert.equal(abortConversation(sid), false);
  });
});

describe('db.isLockOwner ownership round-trip', () => {
  it('reports ownership only while THIS lockId holds the row', () => {
    // Real session row — session_runtime_locks.session_id FK-references
    // chat_sessions(id) with foreign_keys=ON, so acquire needs a live session.
    const sid = createSession('islockowner-roundtrip').id;
    const lockId = 'owner-token-abc';

    // Not held yet.
    assert.equal(isLockOwner(sid, lockId), false, 'no row → not owner');

    const acquired = acquireSessionLock(sid, lockId, 'test-owner', 600);
    assert.equal(acquired, true, 'acquire should succeed on a free session');
    assert.equal(isLockOwner(sid, lockId), true, 'after acquire → owner');

    // A different token never owned it.
    assert.equal(
      isLockOwner(sid, 'some-other-token'),
      false,
      'a different lockId is not the owner',
    );

    const released = releaseSessionLock(sid, lockId);
    assert.equal(released, true, 'release should delete our row');
    assert.equal(isLockOwner(sid, lockId), false, 'after release → not owner');
  });
});
