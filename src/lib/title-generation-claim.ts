/**
 * Per-session single-flight + commit gate for semantic title generation.
 *
 * Phase 1 infrastructure. Phase 2 (the actual model call) is NOT implemented
 * yet — this module exists now so the write path is provably safe BEFORE
 * anything asynchronous is allowed to race with the user. The invariant it
 * enforces, stated once:
 *
 *   A generated title may only ever replace a `fallback` title, at most once,
 *   and only if the generation that produced it is still the current one.
 *
 * Three independent no-op paths, each closing a real race:
 *   1. `claimTitleGeneration` returns null when a generation is already in
 *      flight for that session → single-flight (no duplicate provider calls).
 *   2. `commitGeneratedTitle` rejects a token that is no longer current →
 *      a stale/expired claim (session was reset, a newer claim superseded it)
 *      cannot write.
 *   3. The DB write is a compare-and-swap on `title_origin = 'fallback'` →
 *      a manual rename that landed mid-flight wins permanently, a second
 *      result finds `generated` and no-ops, and a deleted session matches
 *      zero rows.
 *
 * In-memory by design: generation is a single-process, best-effort background
 * task. A server restart drops in-flight claims, which is correct — the CAS in
 * the DB, not this map, is what actually protects the user's title.
 */

import { updateSessionTitle } from '@/lib/db';
import { deriveConversationTitle } from '@/lib/conversation-title';

/** sessionId → the token of the generation currently allowed to commit. */
const inFlight = new Map<string, number>();

/**
 * Sessions that have already spent their one generation attempt.
 *
 * Single-flight alone is not "at most once": it only stops CONCURRENT calls, so
 * a duplicate completion event arriving after the first call finished would open
 * a second one, and only the DB CAS would stop the write — after the provider
 * had already been paid and the user's text had already been sent again. This
 * set is the actual once-per-session gate, and it is
 * recorded BEFORE the call, so a failed or empty generation burns the attempt
 * too. That is deliberate: a title is worth one try, never a retry loop.
 */
const attempted = new Set<string>();

let nextToken = 0;

/**
 * Try to become the one generation for this session.
 * @returns an opaque token to pass back to `commitGeneratedTitle`, or `null`
 *          if a generation is already in flight (caller must not proceed).
 */
export function claimTitleGeneration(sessionId: string): number | null {
  if (inFlight.has(sessionId)) return null;
  nextToken += 1;
  inFlight.set(sessionId, nextToken);
  return nextToken;
}

/**
 * Atomically spend this session's single generation attempt.
 *
 * Call it immediately before the first provider call, never after — the whole
 * point is that a call that was started but never returned still counts.
 *
 * @returns true if the caller may proceed, false if the attempt was already
 *          spent (by an earlier call, however it ended).
 */
export function markTitleGenerationAttempt(sessionId: string): boolean {
  if (attempted.has(sessionId)) return false;
  attempted.add(sessionId);
  return true;
}

/** True if this session has already spent its one attempt. */
export function hasAttemptedTitleGeneration(sessionId: string): boolean {
  return attempted.has(sessionId);
}

/** True while `token` is still the session's current claim. */
export function isCurrentClaim(sessionId: string, token: number): boolean {
  return inFlight.get(sessionId) === token;
}

/** Drop the claim (only if `token` still owns it) — safe to call twice. */
export function releaseTitleGeneration(sessionId: string, token: number): void {
  if (inFlight.get(sessionId) === token) inFlight.delete(sessionId);
}

/**
 * Commit a generated title, honoring both the claim and the DB CAS.
 * Always releases the claim when the token owns it, success or not, so a
 * failed generation doesn't wedge the session's single-flight slot forever.
 *
 * @returns true only if the title was actually written.
 */
export function commitGeneratedTitle(
  sessionId: string,
  token: number,
  rawTitle: string,
): boolean {
  if (!isCurrentClaim(sessionId, token)) return false;
  try {
    const title = deriveConversationTitle(rawTitle);
    // Empty / junk model output → keep the fallback rather than write garbage.
    if (!title) return false;
    return updateSessionTitle(sessionId, title, 'generated', {
      expectOrigin: ['fallback'],
    });
  } finally {
    releaseTitleGeneration(sessionId, token);
  }
}

/** Test-only reset so suites don't leak claims or attempts across cases. */
export function __resetTitleClaimsForTest(): void {
  inFlight.clear();
  attempted.clear();
}
