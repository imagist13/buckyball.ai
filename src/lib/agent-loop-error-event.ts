import type { RuntimeContextAccountingSnapshot } from '@/types';
import {
  TIMEOUT_CATEGORY,
  describeNativeTimeout,
  type NativeTimeoutFired,
} from './native-timeout';
import {
  classifyXaiSearchFailure,
  type XaiSearchFailureCode,
} from './xai-hosted-search';

/**
 * Data payload for the Native runtime `error` SSE event.
 *
 * `context_accounting` mirrors the field the success-path `result` event
 * carries: an error-terminated turn still consumed context for whatever tool
 * calls ran before the throw, so when a snapshot is available the UI can still
 * report that usage. Omitted entirely when no snapshot could be produced, which
 * keeps the legacy `{ category, userMessage }` shape for the common case.
 *
 * `timeout` (Phase 4 ①) is present iff a native timeout budget fired:
 * `category` is then the matching `TIMEOUT_*` code and `timeout` carries the
 * machine-readable reason + budget + source breadcrumb. The chat route
 * persists this exact JSON (inside the `**Error:** …` fallback message), so
 * the reason code in the DB and the one the live UI displayed are the same
 * value by construction — see native-timeout.ts "Persistence / display path".
 */
export type NativeErrorCategory =
  | 'AGENT_ERROR'
  | XaiSearchFailureCode
  | 'TIMEOUT_CONNECT'
  | 'TIMEOUT_FIRST_TOKEN'
  | 'TIMEOUT_TOOL_EXECUTION'
  | 'TIMEOUT_TOTAL_RUN';

export interface NativeErrorEventData {
  category: NativeErrorCategory;
  userMessage: string;
  timeout?: NativeTimeoutFired;
  context_accounting?: RuntimeContextAccountingSnapshot;
}

/**
 * Build the Native runtime error-event data. Pure (no I/O) so it is unit
 * testable without driving the agent-loop stream — which depends on
 * DB/streaming infrastructure and can't run in a pure unit context. (audit A3)
 *
 * @param err        the thrown value (Error → its message; otherwise String()).
 * @param accounting optional context-accounting snapshot; attached only when
 *                   present so a normal (no-snapshot) error keeps the legacy
 *                   `{ category, userMessage }` shape.
 * @param timeout    the fired native timeout, when the turn was terminated by
 *                   a timeout budget rather than a provider/tool failure.
 */
export function buildNativeErrorEventData(
  err: unknown,
  accounting?: RuntimeContextAccountingSnapshot,
  timeout?: NativeTimeoutFired | null,
  context?: { xaiSearchEnabled?: boolean },
): NativeErrorEventData {
  if (timeout) {
    return {
      category: TIMEOUT_CATEGORY[timeout.reason],
      userMessage: describeNativeTimeout(timeout),
      timeout,
      ...(accounting ? { context_accounting: accounting } : {}),
    };
  }
  const xaiFailure = context?.xaiSearchEnabled
    ? classifyXaiSearchFailure(err)
    : undefined;
  if (xaiFailure) {
    return {
      category: xaiFailure.code,
      userMessage: xaiFailure.message,
      ...(accounting ? { context_accounting: accounting } : {}),
    };
  }
  return {
    category: 'AGENT_ERROR',
    userMessage: err instanceof Error ? err.message : String(err),
    ...(accounting ? { context_accounting: accounting } : {}),
  };
}
