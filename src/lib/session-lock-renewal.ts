/**
 * session-lock-renewal.ts — pure per-tick decision for the lock-renewal interval.
 *
 * Session lock renewal (I3 / DP3). `POST /api/chat` renews its
 * session lock every 60s while a turn runs. Two failure modes must be bounded:
 *
 *   - DP3 (both turn types): if `renewSessionLock` returns false the lockId no
 *     longer owns the row (a newer same-session send took over, or the lock was
 *     already released). Continuing to spin the interval is pointless and racy —
 *     STOP renewing.
 *   - I3 (autoTrigger only): a background/heartbeat turn that never emits a
 *     terminal event would otherwise renew forever and beat the TTL, so the
 *     session can never be reclaimed. Cap the number of renewals; at the cap,
 *     settle the lock to a terminal state instead of renewing again. Foreground
 *     (non-autoTrigger) turns are intentionally uncapped here — they are bounded
 *     by the Stop/abort watchdog instead (see route.ts), which a background turn
 *     deliberately has no watchdog for.
 *
 * Extracted as a pure function so route.ts (not unit-importable — Electron ABI
 * deps via db.ts/better-sqlite3) can delegate the decision and the invariants
 * stay driveable by real inputs in a unit test. Mirrors createSessionLockSettler.
 *
 * The concrete cap value lives in route.ts (AUTO_TRIGGER_MAX_RENEWALS = 30) and
 * is passed in as `max` so this module stays a pure, value-agnostic decision.
 */

export type RenewalDecision =
  /** Lock still owned and under any applicable cap — wait for the next tick. */
  | 'continue'
  /** renewSessionLock returned false — lockId no longer owns the row (DP3). */
  | 'stop-renew-false'
  /** autoTrigger renewal count reached the cap — settle to terminal (I3). */
  | 'settle-cap';

export interface EvaluateRenewalParams {
  /** Whether this is an autoTrigger (background/heartbeat) turn. */
  autoTrigger: boolean;
  /**
   * Renewal count AFTER this tick's increment (only autoTrigger turns increment;
   * the caller increments only on a successful renew, so a renew-false tick does
   * not advance the count).
   */
  renewalCount: number;
  /** Return value of renewSessionLock this tick (true = still owned). */
  renewed: boolean;
  /** The cap to enforce for autoTrigger turns (route.ts AUTO_TRIGGER_MAX_RENEWALS). */
  max: number;
}

/**
 * Decide what the renewal interval should do after one tick's renew attempt.
 * Pure — no side effects, no timers, no DB. route.ts maps the returned decision
 * onto clearInterval / settleLock; the unit test drives it with real inputs.
 *
 * Priority: renew-false (ownership lost) takes precedence over the cap — if we
 * no longer own the lock there is nothing to settle, just stop.
 */
export function evaluateRenewal(params: EvaluateRenewalParams): RenewalDecision {
  const { autoTrigger, renewalCount, renewed, max } = params;
  if (!renewed) return 'stop-renew-false';
  if (autoTrigger && renewalCount >= max) return 'settle-cap';
  return 'continue';
}
