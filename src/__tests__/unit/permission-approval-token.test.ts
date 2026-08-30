/**
 * permission-approval-token.test.ts — AI SDK 7 Phase 4 ② security targeted
 * tests for the approval-token hardening of /api/chat/permission.
 *
 * Attack surfaces pinned (one describe block each, per the phase's required
 * check "approval token 过期、篡改、重复使用三类攻击面均被拒绝"):
 *   1. tamper/forge — bit-flipped token, token bound to another id, token
 *      bound to a different expiry, missing token → 403, waiter untouched.
 *   2. expiry — persisted expires_at in the past → 410 even with a token
 *      that verifies (HMAC signs the stored expiry, so the client cannot
 *      extend it); unparseable expiry fails closed.
 *   3. replay — a captured VALID token replayed after the first successful
 *      resolution → 409 ALREADY_RESOLVED (single-use anchored in the DB
 *      status flip, not in token state).
 *
 * Plus the legitimate path: valid token + pending + unexpired → 200 and the
 * in-memory waiter resolves with the user's decision.
 *
 * These tests drive the REAL route handler (POST import) against the REAL
 * isolated DB (db-isolation.setup) and the REAL permission registry — no
 * mocks on the verification path.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';

import { POST } from '../../app/api/chat/permission/route';
import {
  issueApprovalToken,
  verifyApprovalToken,
  isPermissionRequestExpired,
} from '@/lib/permission-approval-token';
import { registerPendingPermission } from '@/lib/permission-registry';
import { createPermissionRequest, getPermissionRequest, createSession } from '@/lib/db';
import type { NativePermissionResult } from '@/lib/types/agent-types';

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/chat/permission', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Create a session + pending permission row + live in-memory waiter. */
function setupPending(opts?: { expiresInMs?: number; expiresAtRaw?: string }) {
  const session = createSession('perm-token-test', 'native');
  const id = `permtok-${crypto.randomBytes(6).toString('hex')}`;
  const expiresAt =
    opts?.expiresAtRaw ?? new Date(Date.now() + (opts?.expiresInMs ?? 5 * 60 * 1000)).toISOString();
  createPermissionRequest({
    id,
    sessionId: session.id,
    toolName: 'Bash',
    toolInput: JSON.stringify({ command: 'ls' }),
    expiresAt,
  });
  const waiter = registerPendingPermission(id, { command: 'ls' });
  return { id, expiresAt, waiter };
}

const ALLOW_DECISION = { behavior: 'allow' as const };

describe('permission-approval-token unit', () => {
  it('round-trips issue → verify for the exact (id, expiresAt) pair', () => {
    const token = issueApprovalToken('abc', '2026-07-03T00:00:00.000Z');
    assert.equal(verifyApprovalToken('abc', '2026-07-03T00:00:00.000Z', token), true);
  });

  it('rejects a token bound to a different id or expiry, and malformed tokens', () => {
    const token = issueApprovalToken('abc', '2026-07-03T00:00:00.000Z');
    assert.equal(verifyApprovalToken('abd', '2026-07-03T00:00:00.000Z', token), false);
    assert.equal(verifyApprovalToken('abc', '2026-07-03T00:00:01.000Z', token), false);
    assert.equal(verifyApprovalToken('abc', '2026-07-03T00:00:00.000Z', undefined), false);
    assert.equal(verifyApprovalToken('abc', '2026-07-03T00:00:00.000Z', ''), false);
    assert.equal(verifyApprovalToken('abc', '2026-07-03T00:00:00.000Z', token.slice(0, -2)), false);
  });

  it('parses both persisted expires_at formats and fails closed on garbage', () => {
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);
    // Full ISO (agent-tools / codex bridge / elicitation format)
    assert.equal(isPermissionRequestExpired(future.toISOString()), false);
    assert.equal(isPermissionRequestExpired(past.toISOString()), true);
    // SQL-ish UTC (claude-client format: "YYYY-MM-DD HH:MM:SS")
    const sqlish = (d: Date) => d.toISOString().replace('T', ' ').split('.')[0];
    assert.equal(isPermissionRequestExpired(sqlish(future)), false);
    assert.equal(isPermissionRequestExpired(sqlish(past)), true);
    // Fail closed
    assert.equal(isPermissionRequestExpired(''), true);
    assert.equal(isPermissionRequestExpired('not-a-date'), true);
  });
});

describe('/api/chat/permission — attack surface: tamper/forge', () => {
  it('rejects a missing token with 403 and leaves the waiter pending', async () => {
    const { id } = setupPending();
    const res = await POST(postReq({ permissionRequestId: id, decision: ALLOW_DECISION }));
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.code, 'INVALID_APPROVAL_TOKEN');
    // Waiter untouched: DB row still pending (registry map still owns it).
    assert.equal(getPermissionRequest(id)?.status, 'pending');
  });

  it('rejects a bit-flipped token with 403', async () => {
    const { id, expiresAt } = setupPending();
    const valid = issueApprovalToken(id, expiresAt);
    const flipped = (valid[0] === 'a' ? 'b' : 'a') + valid.slice(1);
    const res = await POST(
      postReq({ permissionRequestId: id, approvalToken: flipped, decision: ALLOW_DECISION }),
    );
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, 'INVALID_APPROVAL_TOKEN');
    assert.equal(getPermissionRequest(id)?.status, 'pending');
  });

  it('rejects a valid token replayed against a DIFFERENT pending request (no cross-request reuse)', async () => {
    const a = setupPending();
    const b = setupPending();
    const tokenForA = issueApprovalToken(a.id, a.expiresAt);
    const res = await POST(
      postReq({ permissionRequestId: b.id, approvalToken: tokenForA, decision: ALLOW_DECISION }),
    );
    assert.equal(res.status, 403);
    assert.equal(getPermissionRequest(b.id)?.status, 'pending');
  });
});

describe('/api/chat/permission — attack surface: expiry', () => {
  it('rejects an expired request with 410 even when the token itself verifies', async () => {
    const { id, expiresAt } = setupPending({ expiresInMs: -60_000 }); // already past
    const token = issueApprovalToken(id, expiresAt); // token DOES verify…
    assert.equal(verifyApprovalToken(id, expiresAt, token), true);
    const res = await POST(
      postReq({ permissionRequestId: id, approvalToken: token, decision: ALLOW_DECISION }),
    );
    assert.equal(res.status, 410); // …but the signed expiry has passed
    assert.equal((await res.json()).code, 'EXPIRED');
    assert.equal(getPermissionRequest(id)?.status, 'pending'); // registry timer still owns final state
  });

  it('a client cannot extend expiry: token re-bound to a later expiresAt fails the HMAC (403)', async () => {
    const { id, expiresAt } = setupPending({ expiresInMs: -60_000 });
    // Attacker computes nothing — they only HOLD the original token but claim
    // a fresh expiry. Verification recomputes against the STORED expires_at,
    // so the original token is the only one that can verify, and it is 410.
    const forgedForLater = issueApprovalToken(id, new Date(Date.now() + 3_600_000).toISOString());
    void expiresAt;
    const res = await POST(
      postReq({ permissionRequestId: id, approvalToken: forgedForLater, decision: ALLOW_DECISION }),
    );
    assert.equal(res.status, 403);
  });

  it('fails closed on an unparseable persisted expiry', async () => {
    const { id, expiresAt } = setupPending({ expiresAtRaw: 'corrupted-expiry' });
    const token = issueApprovalToken(id, expiresAt);
    const res = await POST(
      postReq({ permissionRequestId: id, approvalToken: token, decision: ALLOW_DECISION }),
    );
    assert.equal(res.status, 410);
  });
});

describe('/api/chat/permission — attack surface: replay (single-use)', () => {
  it('accepts the first valid approval, rejects the identical replay with 409', async () => {
    const { id, expiresAt, waiter } = setupPending();
    const token = issueApprovalToken(id, expiresAt);
    const body = { permissionRequestId: id, approvalToken: token, decision: ALLOW_DECISION };

    const first = await POST(postReq(body));
    assert.equal(first.status, 200);
    const resolved: NativePermissionResult = await waiter;
    assert.equal(resolved.behavior, 'allow');
    assert.equal(getPermissionRequest(id)?.status, 'allow');

    // Byte-identical replay of the captured request → rejected.
    const replay = await POST(postReq(body));
    assert.equal(replay.status, 409);
    assert.equal((await replay.json()).code, 'ALREADY_RESOLVED');
  });

  it('replay of a valid token after a DENY is also rejected (status flip is the anchor)', async () => {
    const { id, expiresAt, waiter } = setupPending();
    const token = issueApprovalToken(id, expiresAt);
    const denyBody = {
      permissionRequestId: id,
      approvalToken: token,
      decision: { behavior: 'deny' as const, message: 'no' },
    };
    const first = await POST(postReq(denyBody));
    assert.equal(first.status, 200);
    assert.equal((await waiter).behavior, 'deny');

    const replayAllow = await POST(
      postReq({ permissionRequestId: id, approvalToken: token, decision: ALLOW_DECISION }),
    );
    assert.equal(replayAllow.status, 409);
    assert.equal(getPermissionRequest(id)?.status, 'deny'); // decision NOT overturned
  });
});

describe('/api/chat/permission — legitimate path stays green', () => {
  it('valid token + pending + unexpired resolves the waiter with the decision', async () => {
    const { id, expiresAt, waiter } = setupPending();
    const res = await POST(
      postReq({
        permissionRequestId: id,
        approvalToken: issueApprovalToken(id, expiresAt),
        decision: { behavior: 'deny' as const, message: 'user said no' },
      }),
    );
    assert.equal(res.status, 200);
    const result = await waiter;
    assert.equal(result.behavior, 'deny');
    assert.equal(result.behavior === 'deny' ? result.message : '', 'user said no');
    assert.equal(getPermissionRequest(id)?.status, 'deny');
  });
});
