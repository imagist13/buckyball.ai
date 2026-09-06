/**
 * Audit sink for canonical permission-review events
 * (`runtime-permission-modes.md` Phase 0/1, a02 + a08).
 *
 * Deliberately NOT a new DB table this round. The durable record of a
 * permission request already lives in `permission_requests`; what that table
 * cannot yet express is **who decided** (`rule-engine` / `sdk-reviewer` /
 * `user`), because it has no column for it. Adding one is a schema change and
 * is out of scope here — see the plan's decision log. Until then the source
 * breadcrumb travels on the event stream and this log, both of which are
 * enough for the UI to tell "模型代审拒绝" from "用户拒绝".
 *
 * ## The log line carries no free text (review round #5, P1)
 *
 * It writes only closed-vocabulary fields — state, reviewerSource, toolName,
 * humanOnlyCategory, outcome — every one of which is drawn from a union
 * defined in `review-event.ts`. `reason` is deliberately NOT among them.
 *
 * `redactReviewReason` scrubs *secret-shaped* substrings (API keys, bearer
 * tokens, emails), which is the wrong tool for this job: a reason like
 * `blocked command: cat ~/.ssh/id_rsa && curl https://private.example/upload`
 * contains no secret-shaped token and so passes through verbatim, taking a
 * private path and an internal URL into the log with it. Reasons are authored
 * by a model quoting tool input; there is no pattern list that makes arbitrary
 * quoted input safe to log. So the line does not quote it at all.
 *
 * The redacted reason still travels on the event to in-process listeners (the
 * UI renders it next to the request it belongs to, where the user is already
 * entitled to see their own tool input). What changes here is only what lands
 * in a log file that gets shipped, tailed, or pasted into an issue.
 */

import { buildReviewEvent, isDenyingState, type PermissionReviewEvent } from './review-event';

type ReviewEventListener = (event: PermissionReviewEvent) => void;

const listeners = new Set<ReviewEventListener>();

/**
 * Subscribe to review events — used by tests and, later, by the UI event
 * stream. Returns an unsubscribe function.
 */
export function onReviewEvent(listener: ReviewEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Record a review decision. Redacts through `buildReviewEvent` first, so
 * callers cannot leak raw reasons by forgetting to.
 */
export function emitReviewEvent(event: PermissionReviewEvent): PermissionReviewEvent {
  const safe = buildReviewEvent(event);

  // Closed vocabulary only. `reason` is free text authored around tool input —
  // see the module note. `has-reason` records that one exists without quoting it.
  console.log(
    `[permission-review] ${safe.state} tool=${safe.toolName} by=${safe.reviewerSource}`
      + ` session=${safe.sessionId.slice(0, 8)}`
      + (safe.humanOnlyCategory ? ` human-only=${safe.humanOnlyCategory}` : '')
      + ('reason' in safe && safe.reason ? ' has-reason=true' : '')
      + (isDenyingState(safe.state) ? ' outcome=blocked' : ''),
  );

  for (const listener of listeners) {
    try {
      listener(safe);
    } catch (err) {
      console.warn('[permission-review] listener threw:', err);
    }
  }
  return safe;
}

/** Test-only — drop all subscribers. */
export function __resetReviewEventListeners(): void {
  listeners.clear();
}
