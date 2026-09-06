import crypto from 'crypto';

/**
 * permission-approval-token — stateless HMAC hardening for the permission
 * approval channel (AI SDK 7 exec plan Phase 4 ②).
 *
 * Threat model: `/api/chat/permission` used to accept any POST that knew (or
 * guessed) a `permissionRequestId`. Ids were partially predictable
 * (claude-client used `Date.now()` + `Math.random()`, Codex uses a
 * deterministic auto-increment `codex:${jsonRpcId}`), and the route never
 * read `permission_requests.expires_at` — the only expiry was the in-memory
 * registry timer, which dies with the process. This module closes the three
 * attack surfaces without any DB schema change:
 *
 *   - tamper / forge — the approval token is
 *     HMAC-SHA256(processSecret, `${id}\n${expiresAt}`); a caller that did
 *     not receive the token via the `permission_request` SSE event cannot
 *     produce it, and cannot re-bind a token to another id or a different
 *     expiry. Verification is constant-time (`crypto.timingSafeEqual`).
 *   - expiry — the route now enforces the persisted
 *     `permission_requests.expires_at` (source breadcrumb: written by every
 *     `createPermissionRequest` call site at now+5min). Because the token
 *     signs the exact stored `expires_at` string, expiry cannot be extended
 *     by the client.
 *   - replay — a token is bound to a single id, and the id is single-use:
 *     the route's existing `status !== 'pending'` check (409
 *     ALREADY_RESOLVED) rejects any re-use after the first resolution. This
 *     module adds nothing mutable, so replay protection stays anchored in
 *     the DB status flip.
 *
 * The secret is per-process, generated lazily from `crypto.randomBytes(32)`
 * and kept on `globalThis` (same pattern as `permission-registry`'s pending
 * map — Next.js dev/Turbopack may load separate module instances per route,
 * and issuance + verification must share one secret). A process restart
 * rotates the secret, which is safe: startup recovery already aborts every
 * pending permission request (`db.ts` "Process restarted" sweep), so no
 * token issued by a previous process is ever expected to verify.
 *
 * Server-internal resolvers (bridge/permission-broker for Telegram/Discord,
 * registry timeout/abort) call `resolvePendingPermission()` directly and do
 * NOT go through the HTTP route, so they are intentionally outside this
 * token boundary — the token authenticates the *renderer→HTTP* hop only.
 */

const SECRET_KEY = '__approvalTokenSecret__' as const;

function getSecret(): Buffer {
  const g = globalThis as Record<string, unknown>;
  if (!(g[SECRET_KEY] instanceof Buffer)) {
    g[SECRET_KEY] = crypto.randomBytes(32);
  }
  return g[SECRET_KEY] as Buffer;
}

/**
 * Issue the approval token for a permission request. `expiresAt` MUST be the
 * exact string persisted to `permission_requests.expires_at` — the token
 * binds to it byte-for-byte.
 */
export function issueApprovalToken(permissionRequestId: string, expiresAt: string): string {
  return crypto
    .createHmac('sha256', getSecret())
    .update(`${permissionRequestId}\n${expiresAt}`)
    .digest('hex');
}

/**
 * Constant-time verification. Returns false for missing/malformed tokens,
 * wrong ids, or a tampered expiry — never throws.
 */
export function verifyApprovalToken(
  permissionRequestId: string,
  expiresAt: string,
  token: unknown,
): boolean {
  if (typeof token !== 'string' || token.length === 0) return false;
  const expected = issueApprovalToken(permissionRequestId, expiresAt);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(token, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

/**
 * Enforce the persisted `expires_at`. Handles both timestamp formats that
 * exist in the wild (see create sites):
 *   - full ISO with `T`/`Z` — agent-tools, codex approval-bridge, codex
 *     mcp-elicitation (`new Date(...).toISOString()`)
 *   - `YYYY-MM-DD HH:MM:SS` UTC — claude-client (ISO with `T` stripped)
 * Fail-closed: an unparseable value counts as expired, so a corrupted row
 * can never be approved.
 */
export function isPermissionRequestExpired(expiresAt: string, nowMs: number = Date.now()): boolean {
  if (!expiresAt) return true;
  const normalized = expiresAt.includes('T')
    ? expiresAt
    : `${expiresAt.replace(' ', 'T')}Z`;
  const ts = Date.parse(normalized);
  if (Number.isNaN(ts)) return true;
  return nowMs > ts;
}
