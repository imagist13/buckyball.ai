/**
 * Phase 5 Phase 4 Slice 2 — Codex approval bridge.
 *
 * Pins the PermissionResult → Codex response-shape mapping. The
 * mapping has FOUR axes:
 *
 *   - allow vs deny (behavior)
 *   - session-scope flag (updatedPermissions populated)
 *   - canonical method (item/commandExecution/... → 'accept'/'decline')
 *     vs legacy (execCommandApproval / applyPatchApproval →
 *     'approved'/'denied')
 *
 * The schema files in `资料/codex/.../v2/` defining these unions:
 *   CommandExecutionApprovalDecision = 'accept' | 'acceptForSession' |
 *                                       'decline' | 'cancel' | ...amendments
 *   FileChangeApprovalDecision = 'accept' | 'acceptForSession' |
 *                                 'decline' | 'cancel'
 *   ReviewDecision (legacy) = 'approved' | 'approved_for_session' |
 *                              'denied' | 'timed_out' | 'abort' | ...
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  resultToCodexResponse,
  resultToCodexPermissionsResponse,
  makeCodexPermissionRequestId,
  decodeStoredPermission,
} from '@/lib/codex/approval-bridge';

const allow = { behavior: 'allow' as const };
const allowSession = {
  behavior: 'allow' as const,
  updatedPermissions: [{ type: 'addRule' }] as unknown[],
};
const deny = { behavior: 'deny' as const, message: 'user denied' };

describe('resultToCodexResponse — canonical methods (accept/decline)', () => {
  for (const method of [
    'item/commandExecution/requestApproval',
    'item/fileChange/requestApproval',
  ]) {
    it(`${method}: allow → { decision: 'accept' }`, () => {
      assert.deepEqual(resultToCodexResponse(allow, method), { decision: 'accept' });
    });
    it(`${method}: allow + session scope → { decision: 'acceptForSession' }`, () => {
      assert.deepEqual(resultToCodexResponse(allowSession, method), {
        decision: 'acceptForSession',
      });
    });
    it(`${method}: deny → { decision: 'decline' }`, () => {
      assert.deepEqual(resultToCodexResponse(deny, method), { decision: 'decline' });
    });
  }
});

describe('resultToCodexResponse — legacy methods (approved/denied)', () => {
  for (const method of ['execCommandApproval', 'applyPatchApproval']) {
    it(`${method}: allow → { decision: 'approved' } (legacy verb)`, () => {
      assert.deepEqual(resultToCodexResponse(allow, method), { decision: 'approved' });
    });
    it(`${method}: allow + session scope → { decision: 'approved_for_session' }`, () => {
      assert.deepEqual(resultToCodexResponse(allowSession, method), {
        decision: 'approved_for_session',
      });
    });
    it(`${method}: deny → { decision: 'denied' }`, () => {
      assert.deepEqual(resultToCodexResponse(deny, method), { decision: 'denied' });
    });
  }
});

describe('resultToCodexPermissionsResponse — current app-server permission profile wire', () => {
  const params = {
    permissions: {
      network: { enabled: true },
      fileSystem: {
        read: ['/workspace'],
        write: ['/workspace/output'],
        entries: [{ path: '/workspace/output', access: 'write' }],
      },
    },
  };

  it('allow once grants only the originally requested subset for this turn', () => {
    assert.deepEqual(resultToCodexPermissionsResponse(allow, params), {
      permissions: params.permissions,
      scope: 'turn',
    });
    assert.deepEqual(
      resultToCodexResponse(allow, 'item/permissions/requestApproval', params),
      { permissions: params.permissions, scope: 'turn' },
    );
  });

  it('allow for session changes scope without trusting renderer hints as permissions', () => {
    assert.deepEqual(
      resultToCodexPermissionsResponse({
        behavior: 'allow',
        updatedPermissions: [{
          type: 'maliciousRendererWideningAttempt',
          network: { enabled: true },
          fileSystem: { write: ['/'] },
        }],
      }, params),
      { permissions: params.permissions, scope: 'session' },
    );
  });

  it('deny returns an empty granted profile, which the app-server treats as denial', () => {
    assert.deepEqual(resultToCodexPermissionsResponse(deny, params), {
      permissions: {},
      scope: 'turn',
    });
  });
});

describe('makeCodexPermissionRequestId — stable prefix', () => {
  it('prepends "codex:" to the JSON-RPC id', () => {
    assert.equal(makeCodexPermissionRequestId(42), 'codex:42');
    assert.equal(makeCodexPermissionRequestId('abc'), 'codex:abc');
  });

  it('lets log scrapers and tests distinguish Codex requests at a glance', () => {
    const id = makeCodexPermissionRequestId(123);
    assert.ok(id.startsWith('codex:'));
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase 5d Phase 3 review fix #3 (P1, 2026-05-17) — duplicate approval
// RPCs for the same `codex:${jsonRpcId}` must be idempotent. Pre-fix
// the bridge always INSERTed and let the UNIQUE constraint failure
// fall into a `console.warn` while still emitting a duplicate SSE
// prompt + overwriting the in-memory waiter. The user's Deny on one
// prompt then triggered 409 ALREADY_RESOLVED on the OTHER prompt.
// ─────────────────────────────────────────────────────────────────────

describe('decodeStoredPermission — replay stored decision for duplicate RPCs', () => {
  it('status=allow with updatedPermissions JSON decodes to behavior:allow + array', () => {
    const result = decodeStoredPermission({
      status: 'allow',
      updated_permissions: JSON.stringify([{ type: 'addRule' }]),
      updated_input: null,
      message: '',
    });
    assert.equal(result.behavior, 'allow');
    if (result.behavior !== 'allow') throw new Error('type narrowing');
    assert.deepEqual(result.updatedPermissions, [{ type: 'addRule' }]);
  });

  it('status=allow with updatedInput JSON decodes to behavior:allow + object', () => {
    const result = decodeStoredPermission({
      status: 'allow',
      updated_permissions: '[]',
      updated_input: JSON.stringify({ foo: 'bar' }),
      message: '',
    });
    assert.equal(result.behavior, 'allow');
    if (result.behavior !== 'allow') throw new Error('type narrowing');
    assert.deepEqual(result.updatedInput, { foo: 'bar' });
  });

  it('status=deny decodes to behavior:deny with stored message', () => {
    const result = decodeStoredPermission({
      status: 'deny',
      updated_permissions: '',
      updated_input: null,
      message: 'user said no',
    });
    assert.equal(result.behavior, 'deny');
    if (result.behavior !== 'deny') throw new Error('type narrowing');
    assert.equal(result.message, 'user said no');
  });

  it('status=timeout decodes to behavior:deny (Codex sees decline either way)', () => {
    const result = decodeStoredPermission({
      status: 'timeout',
      updated_permissions: '',
      updated_input: null,
      message: 'expired',
    });
    assert.equal(result.behavior, 'deny');
    if (result.behavior !== 'deny') throw new Error('type narrowing');
    assert.equal(result.message, 'expired');
  });

  it('status=aborted decodes to behavior:deny with fallback message when row.message is empty', () => {
    const result = decodeStoredPermission({
      status: 'aborted',
      updated_permissions: '',
      updated_input: null,
      message: '',
    });
    assert.equal(result.behavior, 'deny');
    if (result.behavior !== 'deny') throw new Error('type narrowing');
    assert.match(result.message ?? '', /Already resolved/);
  });

  it('malformed updated_permissions JSON falls back to empty array, not throw', () => {
    const result = decodeStoredPermission({
      status: 'allow',
      updated_permissions: '{not valid json',
      updated_input: null,
      message: '',
    });
    assert.equal(result.behavior, 'allow');
    if (result.behavior !== 'allow') throw new Error('type narrowing');
    assert.deepEqual(result.updatedPermissions, []);
  });
});

describe('handleCodexApprovalRequest — source pin (idempotent short-circuit shape)', () => {
  // Source-grep pin: the bridge MUST call getPermissionRequest BEFORE
  // createPermissionRequest so duplicate RPCs short-circuit cleanly.
  // Pre-fix the order was reversed and a UNIQUE constraint failure
  // would fire instead.
  const SRC = fs.readFileSync(
    path.resolve(__dirname, '../../lib/codex/approval-bridge.ts'),
    'utf-8',
  );
  // Strip JSDoc / comments so the source-pin doesn't trip on the
  // explanatory blocks (which intentionally mention the pre-fix
  // shape `console.warn` for context).
  function strip(src: string): string {
    const out: string[] = [];
    let inBlock = false;
    for (const raw of src.split('\n')) {
      const trimmed = raw.trimStart();
      if (inBlock) {
        if (trimmed.includes('*/')) inBlock = false;
        continue;
      }
      if (trimmed.startsWith('/*')) {
        if (!trimmed.includes('*/')) inBlock = true;
        continue;
      }
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      const idx = raw.indexOf('//');
      out.push(idx >= 0 ? raw.slice(0, idx) : raw);
    }
    return out.join('\n');
  }
  const CODE = strip(SRC);

  it('bridge imports getPermissionRequest (idempotency check helper)', () => {
    assert.match(
      SRC,
      /import\s*\{[^}]*\bgetPermissionRequest\b[^}]*\}\s*from\s*'@\/lib\/db'/,
      'approval-bridge must import getPermissionRequest to check for duplicate RPCs',
    );
  });

  it('getPermissionRequest call appears BEFORE createPermissionRequest in handleCodexApprovalRequest', () => {
    const getIdx = CODE.indexOf('getPermissionRequest(requestId)');
    const createIdx = CODE.indexOf('createPermissionRequest({');
    assert.ok(getIdx > 0, 'getPermissionRequest(requestId) must exist');
    assert.ok(createIdx > 0, 'createPermissionRequest({...}) must exist');
    assert.ok(
      getIdx < createIdx,
      `getPermissionRequest (idx=${getIdx}) must run before createPermissionRequest (idx=${createIdx}) so duplicate RPCs short-circuit instead of tripping UNIQUE constraint`,
    );
  });

  it('duplicate path short-circuits via resultToCodexResponse (no SSE emit + no DB write reachable)', () => {
    // Between the existing-row branch and the createPermissionRequest
    // call there must be a `return resultToCodexResponse(...)` so the
    // short-circuit can't fall through to the normal flow.
    const sliceStart = CODE.indexOf('const existing = getPermissionRequest(requestId)');
    const sliceEnd = CODE.indexOf('const canonical = translateCodexApproval');
    assert.ok(sliceStart > 0 && sliceEnd > sliceStart);
    const block = CODE.slice(sliceStart, sliceEnd);
    // Both branches (already resolved + still pending) must return.
    const returnCount = (block.match(/return\s+resultToCodexResponse/g) || []).length;
    assert.ok(
      returnCount >= 2,
      `duplicate-RPC block must return resultToCodexResponse for BOTH "already resolved" and "still pending" cases (got ${returnCount} returns)`,
    );
  });
});
