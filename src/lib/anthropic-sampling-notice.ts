/**
 * anthropic-sampling-notice.ts — decide whether a turn must tell the user that
 * its sampling params (temperature / top_p / top_k) were not sent.
 *
 * Extracted as its own dependency-free module (same convention as
 * agent-loop-anthropic-wire.ts / agent-loop-error-event.ts) so the decision is
 * unit-testable directly and CANNOT drift between the two Anthropic runtimes.
 *
 * Why this exists (Codex review P2, 2026-07-18): `sanitizeClaudeModelOptions`
 * strips non-default sampling params for the adaptive family (Sonnet 5 /
 * Fable 5 / Opus 4.7+ return 400 on them) and reports the removal via
 * `strippedSamplingParams` — but that field had ZERO production consumers. The
 * sanitizer's own contract says a strip must be surfaced, never swallowed (same
 * rule as `thinkingForcedOn`), so the strip was silent in exactly the way the
 * semantic-acceptance rules forbid. Both runtimes now build their notice here.
 *
 * The two runtimes differ in ONE way, and it is a real behavioral difference,
 * not a policy choice:
 *   - native (agent-loop / AI SDK): params that survive sanitization ARE sent
 *     to `streamText`, so only the STRIPPED ones are unsent.
 *   - sdk (claude-client / Claude Code SDK): `query()` exposes no sampling
 *     knobs at all, so EVERY provided param is unsent — stripped or not.
 */

import type { ClaudeModelOptionsOutput } from './claude-model-options';

/**
 * The notification payload, minus the SSE envelope the caller adds.
 *
 * Carries a `reason` + interpolation params, NOT rendered prose (Codex review
 * P2, 2026-07-18): the server has no idea which locale the user reads, so
 * hardcoding English here shipped an untranslatable toast. The client maps
 * (code, reason) → i18n key in `status-notice-i18n.ts`. The server still logs a
 * plain-English breadcrumb via console.warn for diagnosis — that's an operator
 * surface, not a user surface.
 */
export interface SamplingIgnoredNotice {
  code: 'SAMPLING_PARAMS_IGNORED';
  /** Which localized variant to render. The two runtimes fail differently:
   *  'model-rejects' = the model 400s on these values (they were stripped);
   *  'runtime-cannot-send' = query() has no sampling knobs at all. */
  reason: 'model-rejects' | 'runtime-cannot-send';
  /** Param names that will not reach the model. Never empty. */
  unsent: string[];
  /** Interpolation values for the i18n key — never pre-rendered sentences. */
  params: {
    /** Resolved model ID, or '' when the caller had none (key handles it). */
    model: string;
    /** Comma-joined `unsent`, for the {names} placeholder. */
    names: string;
    /** Drives singular/plural key selection on the client. */
    count: number;
  };
}

/**
 * Build the one-shot notice for sampling params that won't reach the model, or
 * null when everything the caller asked for is actually being sent (no notice =
 * no misleading toast).
 */
export function buildSamplingIgnoredNotice(args: {
  runtime: 'native' | 'sdk';
  model: string | undefined;
  sanitized: Pick<ClaudeModelOptionsOutput, 'sampling' | 'strippedSamplingParams'>;
}): SamplingIgnoredNotice | null {
  const { runtime, model, sanitized } = args;

  const unsent =
    runtime === 'sdk'
      // The SDK runtime cannot send sampling params at all — surviving ones are
      // just as unsent as stripped ones, so both go in the notice.
      ? [...sanitized.strippedSamplingParams, ...Object.keys(sanitized.sampling)]
      // The native runtime forwards survivors to streamText; only strips are unsent.
      : [...sanitized.strippedSamplingParams];

  if (unsent.length === 0) return null;

  return {
    code: 'SAMPLING_PARAMS_IGNORED',
    reason: runtime === 'sdk' ? 'runtime-cannot-send' : 'model-rejects',
    unsent,
    params: {
      model: model || '',
      names: unsent.join(', '),
      count: unsent.length,
    },
  };
}
