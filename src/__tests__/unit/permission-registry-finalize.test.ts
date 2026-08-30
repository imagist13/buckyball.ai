/**
 * permission-registry — single finalize exit + DB persistence
 * (codebase-health A5 Step 1).
 *
 * The refactor routed allow / deny / timeout / abort through one
 * `finalizePermission` exit. These BEHAVIOURAL tests pin that EVERY path:
 *   1. resolves the in-memory waiter (so the blocked agent turn unblocks), and
 *   2. persists the matching terminal status to the permission_requests row.
 *
 * Pre-refactor the paths re-implemented the teardown and had already drifted
 * in DB-write ordering. A regression that dropped persistence on a single path
 * would silently lose the audit row while the in-memory resolve still worked —
 * exactly the kind of "pipe still flows but the stored state isn't what the
 * user thinks" bug a source pin wouldn't catch — so we assert the real DB row.
 *
 * DB hits the per-worker isolated temp DB (db-isolation.setup.ts), not the
 * user's real codepilot.db.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerPendingPermission,
  resolvePendingPermission,
} from '@/lib/permission-registry';
import { createPermissionRequest, createSession, getPermissionRequest } from '@/lib/db';

const TIMEOUT_MS = 5 * 60 * 1000; // mirrors permission-registry TIMEOUT_MS

let seq = 0;
/**
 * Insert a fresh `pending` permission row (with its owning chat_session, since
 * permission_requests.session_id is an FK → chat_sessions(id)) and return the
 * permission request's unique id.
 */
function seedPendingRow(): string {
  const session = createSession('A5 test session');
  const id = `perm-a5-${process.pid}-${seq++}`;
  createPermissionRequest({
    id,
    sessionId: session.id,
    toolName: 'Bash',
    toolInput: JSON.stringify({ command: 'ls' }),
    expiresAt: '2099-01-01 00:00:00',
  });
  return id;
}

describe('permission-registry finalize exit — DB persistence (A5 Step 1)', () => {
  it('allow path persists status=allow and resolves allow with the original toolInput defaulted in', async () => {
    const id = seedPendingRow();
    const toolInput = { command: 'ls' };
    const pending = registerPendingPermission(id, toolInput);

    const ok = resolvePendingPermission(id, { behavior: 'allow' });
    assert.equal(ok, true);

    const result = await pending;
    assert.equal(result.behavior, 'allow');
    // updatedInput is defaulted to the originally-requested input on allow.
    assert.deepEqual(result.updatedInput, toolInput);
    assert.equal(getPermissionRequest(id)?.status, 'allow');
  });

  it('deny path persists status=deny and the deny message', async () => {
    const id = seedPendingRow();
    const pending = registerPendingPermission(id, { command: 'ls' });

    const ok = resolvePendingPermission(id, { behavior: 'deny', message: 'nope' });
    assert.equal(ok, true);

    const result = await pending;
    assert.equal(result.behavior, 'deny');
    const row = getPermissionRequest(id);
    assert.equal(row?.status, 'deny');
    assert.equal(row?.message, 'nope');
  });

  it('timeout path persists status=timeout and resolves with the timeout reason (not a bare deny)', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const id = seedPendingRow();
      const pending = registerPendingPermission(id, { command: 'ls' });

      // Advance past the 5-minute window without burning wall-clock.
      mock.timers.tick(TIMEOUT_MS + 1);

      const result = await pending;
      assert.equal(result.behavior, 'deny');
      assert.match(
        result.message ?? '',
        /timed out/i,
        'timeout deny must say it timed out so the UI can tell the user it was auto-denied, not something they clicked (A5 semantic acceptance)',
      );
      assert.equal(getPermissionRequest(id)?.status, 'timeout');
    } finally {
      mock.timers.reset();
    }
  });

  it('abort path persists status=aborted and resolves deny', async () => {
    const id = seedPendingRow();
    const ac = new AbortController();
    const pending = registerPendingPermission(id, { command: 'ls' }, ac.signal);

    ac.abort();

    const result = await pending;
    assert.equal(result.behavior, 'deny');
    assert.equal(getPermissionRequest(id)?.status, 'aborted');
  });

  it('double-resolve is idempotent — second call returns false and does not clobber the stored status', async () => {
    const id = seedPendingRow();
    const pending = registerPendingPermission(id, { command: 'ls' });

    assert.equal(resolvePendingPermission(id, { behavior: 'allow' }), true);
    await pending;

    // Entry already finalized + removed → the second resolve no-ops.
    assert.equal(resolvePendingPermission(id, { behavior: 'deny', message: 'x' }), false);
    assert.equal(getPermissionRequest(id)?.status, 'allow');
  });
});

describe('permission-registry onTimeout callback — UI notify contract (A5 Step 2)', () => {
  it('fires onTimeout exactly once when the request times out', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const id = seedPendingRow();
      const onTimeout = mock.fn();
      const pending = registerPendingPermission(id, { command: 'ls' }, undefined, onTimeout);

      mock.timers.tick(TIMEOUT_MS + 1);
      await pending;

      assert.equal(onTimeout.mock.calls.length, 1, 'timeout must notify the caller exactly once');
    } finally {
      mock.timers.reset();
    }
  });

  it('does NOT fire onTimeout when the user resolves before the timeout', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const id = seedPendingRow();
      const onTimeout = mock.fn();
      const pending = registerPendingPermission(id, { command: 'ls' }, undefined, onTimeout);

      resolvePendingPermission(id, { behavior: 'allow' });
      await pending;
      // Even after the clock would have fired, the entry is gone so the timer no-ops.
      mock.timers.tick(TIMEOUT_MS + 1);

      assert.equal(onTimeout.mock.calls.length, 0, 'a user-answered request must never emit a timeout event');
    } finally {
      mock.timers.reset();
    }
  });

  it('does NOT fire onTimeout when the request is aborted before the timeout', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const id = seedPendingRow();
      const onTimeout = mock.fn();
      const ac = new AbortController();
      const pending = registerPendingPermission(id, { command: 'ls' }, ac.signal, onTimeout);

      ac.abort();
      await pending;
      mock.timers.tick(TIMEOUT_MS + 1);

      assert.equal(onTimeout.mock.calls.length, 0, 'abort is the user’s own Stop — no timeout event');
      assert.equal(getPermissionRequest(id)?.status, 'aborted');
    } finally {
      mock.timers.reset();
    }
  });

  it('an onTimeout that throws (stream already closing) still applies the deny + persists timeout', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const id = seedPendingRow();
      const onTimeout = mock.fn(() => {
        throw new Error('controller closed');
      });
      const pending = registerPendingPermission(id, { command: 'ls' }, undefined, onTimeout);

      mock.timers.tick(TIMEOUT_MS + 1);
      const result = await pending;

      assert.equal(result.behavior, 'deny', 'a throwing notify callback must not block the deny that unblocks the turn');
      assert.equal(getPermissionRequest(id)?.status, 'timeout');
    } finally {
      mock.timers.reset();
    }
  });
});
