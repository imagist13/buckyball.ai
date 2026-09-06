/**
 * Canonical permission-review event contract — `runtime-permission-modes.md`
 * Phase 0.
 *
 * Distinct from `RuntimePermissionEvent` (`@/lib/runtime/contract`), which
 * models the *request/response* lifecycle a Runtime adapter emits. This union
 * models **who decided and how it ended**, so the UI and the audit trail can
 * answer the question the three-profile design creates:
 *
 *   "Was this denied by the model reviewing on my behalf, or by me?"
 *
 * Every Runtime that grows an auto reviewer maps into this same union, so
 * `模型代审拒绝` never renders as `用户拒绝` on one Runtime and not another.
 */

import type { HumanOnlyCategory } from './profile';

export const REVIEW_EVENT_STATES = [
  'requested',
  'approved',
  'denied',
  'unavailable',
  'timeout',
] as const;

export type ReviewEventState = (typeof REVIEW_EVENT_STATES)[number];

/**
 * Source breadcrumb — the "who decided" half of the contract.
 *
 *   - `sdk-reviewer` — the Runtime's own auto reviewer (Claude SDK
 *     `permissionMode: 'auto'`, Codex `approvals_reviewer`, …).
 *   - `user` — a human clicked approve/deny.
 *   - `rule-engine` — CodePilot's own deterministic classification decided
 *     without asking anyone (host MCP allowlist, human-only interception,
 *     mutationLevel safe_read skip).
 */
export const REVIEWER_SOURCES = ['sdk-reviewer', 'user', 'rule-engine'] as const;

export type ReviewerSource = (typeof REVIEWER_SOURCES)[number];

/**
 * Guards for values arriving over the wire. Fail-closed by omission: an
 * unrecognised state or source is dropped, never coerced to a plausible
 * neighbour — guessing 'denied' vs 'unavailable', or 'user' vs 'sdk-reviewer',
 * would fabricate the very fact the contract exists to carry.
 */
export function isReviewEventState(value: unknown): value is ReviewEventState {
  return typeof value === 'string' && (REVIEW_EVENT_STATES as readonly string[]).includes(value);
}

export function isReviewerSource(value: unknown): value is ReviewerSource {
  return typeof value === 'string' && (REVIEWER_SOURCES as readonly string[]).includes(value);
}

interface ReviewEventBase {
  readonly requestId: string;
  readonly sessionId: string;
  /** Runtime that produced the decision — 'claude_code' | 'codex_runtime' | … */
  readonly runtimeId: string;
  /** Which component decided. Never inferred by the UI from shape. */
  readonly reviewerSource: ReviewerSource;
  /** Tool the decision is about. Names only — never arguments. */
  readonly toolName: string;
  /** Set iff the tool is human-only; explains why a reviewer was skipped. */
  readonly humanOnlyCategory?: HumanOnlyCategory;
}

export type PermissionReviewEvent =
  | (ReviewEventBase & { readonly state: 'requested' })
  | (ReviewEventBase & { readonly state: 'approved' })
  | (ReviewEventBase & { readonly state: 'denied'; readonly reason?: string })
  /** Reviewer could not run at all (unsupported SDK, provider failure). */
  | (ReviewEventBase & { readonly state: 'unavailable'; readonly reason: string })
  /** Reviewer or user did not answer inside the window. Always a deny. */
  | (ReviewEventBase & { readonly state: 'timeout' });

/**
 * A review decision made WITHOUT showing the user a prompt, in the shape the
 * UI renders it (review round #3, P1).
 *
 * `pendingPermission` covers decisions the user is asked to make; this covers
 * decisions made *for* them. Without a surface of its own, an auto_review
 * denial is indistinguishable from the model quietly choosing not to act —
 * which is the exact confusion the three-profile contract exists to remove.
 *
 * `reviewerSource` travels with the notice so the UI labels it by breadcrumb
 * rather than inferring 模型代审拒绝 vs 你拒绝了 from the event's shape.
 */
export interface PermissionReviewNotice {
  readonly id: string;
  readonly state: ReviewEventState;
  readonly reviewerSource: ReviewerSource;
  readonly toolName: string;
  readonly reason?: string;
  /** Epoch ms — the UI ages these out. */
  readonly at: number;
}

/**
 * The three states that mean "the tool call did NOT proceed". `unavailable`
 * and `timeout` are denies, not neutral outcomes — this helper exists so no
 * caller re-derives fail-closed semantics and gets it subtly wrong.
 */
export function isDenyingState(state: ReviewEventState): boolean {
  return state === 'denied' || state === 'unavailable' || state === 'timeout';
}

/** True iff the decision was made by a model rather than a human. */
export function isModelDecision(event: PermissionReviewEvent): boolean {
  return event.reviewerSource === 'sdk-reviewer';
}

/**
 * Build the canonical `sdk-reviewer` denial event from a Claude Agent SDK
 * `PermissionDenied` hook payload.
 *
 * ## Why this hook is the reviewer breadcrumb, and the only one
 *
 * Verified against the shipped classifier in
 * `node_modules/@anthropic-ai/claude-agent-sdk/cli.js` (0.2.111): the
 * `PermissionDenied` hook is dispatched inside a branch guarded by
 * `decisionReason.type === 'classifier' && decisionReason.classifier ===
 * 'auto-mode'`. It therefore fires **only** for auto-mode classifier denials —
 * a user clicking Deny does not reach it. That exactness is what lets the UI
 * say 模型代审拒绝 rather than 用户拒绝 without guessing from shape.
 *
 * The converse is a real gap, recorded rather than papered over: a classifier
 * **approval** returns `{behavior:'allow'}` with no hook and no callback, so
 * there is nothing to observe. `approved` events with `reviewerSource:
 * 'sdk-reviewer'` are consequently NOT emitted on the Claude path — the
 * profile's approvals are invisible by construction of the upstream SDK. See
 * the plan's decision log.
 */
export function buildSdkReviewerDenial(input: {
  readonly requestId: string;
  readonly sessionId: string;
  readonly toolName: string;
  readonly reason?: string;
}): PermissionReviewEvent {
  return buildReviewEvent({
    state: 'denied',
    requestId: input.requestId,
    sessionId: input.sessionId,
    runtimeId: 'claude_code',
    reviewerSource: 'sdk-reviewer',
    toolName: input.toolName,
    reason: input.reason,
  });
}

/**
 * Redact a reason string before it reaches a log line or the audit trail.
 *
 * Permission reasons can quote tool input — file contents, prompts, shell
 * arguments. The audit trail needs the *shape* of the decision, not the
 * payload. We keep a short, single-line, length-capped excerpt and strip
 * anything that looks like a secret.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(sk|pk|ghp|gho|ghs|xox[baprs])-[A-Za-z0-9_-]{8,}/gi,
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\b(?:api[_-]?key|secret|password|token)\s*[:=]\s*\S+/gi,
];

export const REVIEW_REASON_MAX_LENGTH = 200;

export function redactReviewReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  let out = reason.replace(/\s+/g, ' ').trim();
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, '[redacted]');
  }
  if (out.length > REVIEW_REASON_MAX_LENGTH) {
    out = out.slice(0, REVIEW_REASON_MAX_LENGTH) + '…';
  }
  return out;
}

/**
 * Build a review event with the reason redacted. Constructing the union
 * literal by hand is allowed, but going through here is what keeps raw
 * tool input out of the audit trail — prefer it.
 */
export function buildReviewEvent(event: PermissionReviewEvent): PermissionReviewEvent {
  if (event.state === 'denied') {
    return { ...event, reason: redactReviewReason(event.reason) };
  }
  if (event.state === 'unavailable') {
    return { ...event, reason: redactReviewReason(event.reason) ?? 'unavailable' };
  }
  return event;
}
