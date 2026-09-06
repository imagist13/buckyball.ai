/**
 * stream-phase-reconcile.ts — pure runtime_status → client phase mapping.
 *
 * Interrupt/phase reconcile. The client stream state machine
 * (`stream-session-manager.ts` snapshot `phase`) and the authoritative backend
 * runtime_status (`chat_sessions.runtime_status`, written by the chat route /
 * settler) are two independent stores. When they drift — a client snapshot
 * stuck `'active'` after the backend already went terminal, or a fresh context
 * that never saw the turn — the composer's `isStreaming` gate (≡ phase ===
 * 'active', GitHub #578) can lock the user out or mislead them.
 *
 * This is the single shared mapping used by BOTH reconcile sites:
 *   - `stopStreamWith` (stream-session-manager): converge the client phase to a
 *     terminal phase when the interrupt response reports the backend is already
 *     terminal, without waiting for the reader to reject (I4).
 *   - `/chat/[id]` page mount: correct a stuck-active client snapshot against
 *     the freshly-loaded session's runtime_status (I2).
 *
 * Pure + total so the truth table is unit-testable with no DB / stream. The
 * caller decides how to APPLY a returned phase — notably, neither site
 * fabricates a reader-less `'active'` snapshot (that is exactly the #578
 * strand), so both act only on terminal results.
 */

/** Terminal + streaming phases the client snapshot can hold. Mirrors the phase
 *  literals set across stream-session-manager.ts. */
export type ClientPhase = 'active' | 'completed' | 'stopped' | 'error';

/**
 * Canonical client phase for an authoritative backend runtime_status.
 *
 * Values are the ones actually written to `chat_sessions.runtime_status`
 * (see setSessionRuntimeStatus call sites in chat/route.ts, claude-client.ts
 * and conversation-engine.ts):
 *   - 'running' / 'waiting_permission' → 'active'   (backend still busy)
 *   - 'idle'                          → 'completed' (terminal — turn finished)
 *   - 'interrupted'                   → 'stopped'   (terminal — Stop/abort settled)
 *   - 'error'                         → 'error'     (terminal — failure)
 *
 * Returns null for any unrecognized status so callers never "correct" toward a
 * phase we can't justify from a real backend value.
 */
export function runtimeStatusToPhase(
  runtimeStatus: string | null | undefined,
): ClientPhase | null {
  switch (runtimeStatus) {
    case 'running':
    case 'waiting_permission':
      return 'active';
    case 'idle':
      return 'completed';
    case 'interrupted':
      return 'stopped';
    case 'error':
      return 'error';
    default:
      return null;
  }
}

/**
 * Reconcile a client phase against the authoritative backend runtime_status.
 * Returns the phase the client SHOULD be in, or null when no correction is
 * warranted:
 *   - unrecognized runtime_status → null (nothing authoritative to act on);
 *   - already consistent (target === current) → null (leave it alone).
 *
 * A non-null result is a genuine drift correction. It MAY be 'active' (backend
 * running while the client shows a terminal/absent phase); callers that cannot
 * attach a live reader must NOT apply that as a fabricated 'active' snapshot
 * (GitHub #578) — they act on terminal results only.
 */
export function reconcilePhase(
  runtimeStatus: string | null | undefined,
  currentPhase: string | null | undefined,
): ClientPhase | null {
  const target = runtimeStatusToPhase(runtimeStatus);
  if (target === null) return null;
  if (target === currentPhase) return null;
  return target;
}
