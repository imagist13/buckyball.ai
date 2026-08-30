import { NextRequest } from 'next/server';
import { resolvePendingPermission } from '@/lib/permission-registry';
import { getPermissionRequest } from '@/lib/db';
import { verifyApprovalToken, isPermissionRequestExpired } from '@/lib/permission-approval-token';
import type { PermissionResponseRequest } from '@/types';
import type { NativePermissionResult } from '@/lib/types/agent-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body: PermissionResponseRequest = await request.json();
    const { permissionRequestId, decision, approvalToken } = body;

    if (!permissionRequestId || !decision) {
      return new Response(
        JSON.stringify({ error: 'permissionRequestId and decision are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Validate against DB before resolving in-memory
    const dbRecord = getPermissionRequest(permissionRequestId);
    if (!dbRecord) {
      return new Response(
        JSON.stringify({ error: 'Permission request not found', code: 'NOT_FOUND' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // AI SDK 7 Phase 4 ② — HMAC approval-token hardening. The token was
    // issued at request-creation time and delivered only via the
    // `permission_request` SSE event, so a caller that merely knows/guessed
    // the id cannot resolve it. Checked BEFORE status/expiry so probing with
    // a bad token learns nothing about the request's state.
    if (!verifyApprovalToken(permissionRequestId, dbRecord.expires_at, approvalToken)) {
      return new Response(
        JSON.stringify({ error: 'Invalid or missing approval token', code: 'INVALID_APPROVAL_TOKEN' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Enforce the persisted expires_at. Previously only the in-memory
    // registry timer expired requests — after a process restart (timer gone)
    // a stale-but-pending row could still be approved. The token signs
    // expires_at, so this window cannot be extended by the client.
    if (isPermissionRequestExpired(dbRecord.expires_at)) {
      return new Response(
        JSON.stringify({ error: 'Permission request expired', code: 'EXPIRED' }),
        { status: 410, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (dbRecord.status !== 'pending') {
      return new Response(
        JSON.stringify({ error: `Permission request already resolved (status: ${dbRecord.status})`, code: 'ALREADY_RESOLVED' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      );
    }

    let result: NativePermissionResult;
    if (decision.behavior === 'allow') {
      result = {
        behavior: 'allow',
        updatedPermissions: decision.updatedPermissions as unknown[],
        ...(decision.updatedInput ? { updatedInput: decision.updatedInput } : {}),
      };
    } else {
      result = {
        behavior: 'deny',
        message: decision.message || 'User denied permission',
      };
    }

    const found = resolvePendingPermission(permissionRequestId, result);

    if (!found) {
      return new Response(
        JSON.stringify({
          error: 'Permission request exists in DB but the in-memory waiter is gone (process may have restarted)',
          code: 'WAITER_GONE',
        }),
        { status: 410, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
