/**
 * codex-stop-recovery Phase 3 — createSessionLockSettler invariants.
 *
 * Behavioral (DI) tests, not source-pins: the settler is the shared seam
 * between the normal collect-completion path and the Stop/abort watchdog, so
 * its three invariants must actually hold at runtime:
 *   1. idempotent — only the first call runs side effects;
 *   2. always stops the renewal interval;
 *   3. writes runtime status ONLY when releaseLock() reports we still owned the
 *      lock (lockId-scoped release vs session-scoped status — otherwise the
 *      watchdog would clobber a newer same-session request's 'running' state).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createSessionLockSettler } from '../../lib/session-lock-settle';

function makeHarness(opts: { owned: boolean }) {
  const calls = { clearRenewal: 0, releaseLock: 0, status: [] as string[] };
  const settle = createSessionLockSettler({
    clearRenewal: () => { calls.clearRenewal += 1; },
    releaseLock: () => { calls.releaseLock += 1; return opts.owned; },
    setStatus: (s) => { calls.status.push(s); },
  });
  return { calls, settle };
}

describe('createSessionLockSettler', () => {
  it('owned lock: clears renewal, releases, and writes the given status', () => {
    const { calls, settle } = makeHarness({ owned: true });
    settle('idle');
    assert.equal(calls.clearRenewal, 1);
    assert.equal(calls.releaseLock, 1);
    assert.deepEqual(calls.status, ['idle']);
  });

  it('is idempotent — a second settle (e.g. natural completion after the watchdog) is a no-op', () => {
    const { calls, settle } = makeHarness({ owned: true });
    settle('interrupted');
    settle('idle'); // late natural completion must NOT release again or flip status
    assert.equal(calls.clearRenewal, 1);
    assert.equal(calls.releaseLock, 1);
    assert.deepEqual(calls.status, ['interrupted']);
  });

  it('lost ownership: still clears renewal + attempts release, but does NOT write status', () => {
    // A newer same-session request already took over the lock. releaseLock()
    // returns false (our stale lockId matched no row); we must not clobber the
    // new request's status.
    const { calls, settle } = makeHarness({ owned: false });
    settle('interrupted');
    assert.equal(calls.clearRenewal, 1, 'renewal interval must always be cleared');
    assert.equal(calls.releaseLock, 1, 'release is attempted (lockId-scoped, safe no-op)');
    assert.deepEqual(calls.status, [], 'status must NOT be written when we no longer own the lock');
  });

  it('passes the terminal status through verbatim (idle vs interrupted)', () => {
    const a = makeHarness({ owned: true });
    a.settle('idle');
    assert.deepEqual(a.calls.status, ['idle']);
    const b = makeHarness({ owned: true });
    b.settle('interrupted');
    assert.deepEqual(b.calls.status, ['interrupted']);
  });
});
