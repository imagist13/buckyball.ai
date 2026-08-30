/**
 * native-timeout — Native Runtime timeout reason codes (AI SDK 7 exec plan
 * Phase 4 ①).
 *
 * ## Semantic contract (per user-visible reason code)
 *
 * Every fired timeout carries `{ reason, budgetMs, source }` where `source`
 * is the breadcrumb naming the exact signal the measurement is anchored to —
 * no code is ever inferred from an error-message regex.
 *
 * - `connect` — the provider did not RESPOND (HTTP response headers) within
 *   `connectMs` of `streamText()` being invoked for a step. Anchor: the
 *   step's first `start-step` fullStream part — ai@7 emits it only after
 *   `doStream()` resolves, i.e. after response headers arrived (it carries
 *   the request metadata + provider warnings). Covers DNS/TCP/TLS/queueing.
 *   Source breadcrumb: `agent-loop.fullStream[start-step]`.
 * - `first-token` — the provider RESPONDED but produced no MODEL OUTPUT
 *   (text/reasoning/tool-call) within `firstTokenMs` of the response
 *   arriving. The timer is armed ONLY by the step's `start-step` part (the
 *   response-arrived signal) — never at request time — so an unresponsive
 *   connection can never be misclassified as first-token: a black hole with
 *   only `firstTokenMs` configured fires nothing (that window is `connect`'s
 *   to cover), and with both configured only `connect` can fire before the
 *   response. Clear anchor: first fullStream part in {text-start,
 *   text-delta, reasoning-start, reasoning-delta, tool-input-start,
 *   tool-input-delta, tool-call}. Measured per step (each step is one
 *   provider request). Source breadcrumb:
 *   `agent-loop.fullStream[first-output-part]`.
 * - `tool-execution` — one tool call's execution did not finish within
 *   `toolExecutionMs`. Anchor: `tool-call` part (execution starts) →
 *   matching `tool-result` / `tool-error` part (by toolCallId). NOTE: for
 *   permission-gated tools the in-execute approval wait counts toward this
 *   budget (approval blocks inside `execute()` for up to 5 minutes —
 *   permission-registry TIMEOUT_MS); budgets at or below the approval
 *   window will cut approval waits short. Source breadcrumb:
 *   `agent-loop.fullStream[tool-call→tool-result]`. Because ai@7 merely
 *   passes the abort signal INTO `execute()` and still awaits its promise,
 *   firing this budget must not rely on the SDK ending the stream — the
 *   consumer loop must iterate via `guardStream` (below) to escape a tool
 *   that ignores the signal.
 * - `total-run` — the whole run (all steps + tool executions) exceeded
 *   `totalRunMs`. Anchor: `runAgentLoop` start → run teardown. Source
 *   breadcrumb: `agent-loop.run`.
 *
 * ## Persistence / display path (source breadcrumb for the stored value)
 *
 * fired reason → agent-loop catch → `buildNativeErrorEventData` (category
 * `TIMEOUT_*` + `timeout` payload) → SSE `error` event → chat route
 * persists `**Error:** <event.data JSON>` into `messages.content` when the
 * turn produced no other content (route.ts error fallback) → chat page
 * renders `parsed.userMessage` from the same JSON. So DB, SSE, and UI all
 * read the one JSON payload; there is no second derivation.
 *
 * ## Defaults: ALL DISABLED
 *
 * Every budget is opt-in (`AgentLoopOptions.timeouts` or the
 * `CODEPILOT_NATIVE_TIMEOUTS` env JSON, e.g.
 * `{"connectMs":30000,"totalRunMs":600000}`). With no config the controller
 * arms no timers and `signal` degrades to the caller's own abort signal —
 * zero behavior change. Turning any budget ON aborts runs that previously
 * hung forever, which is a user-visible behavior change reserved for a
 * product decision (Phase 4 ships the accurate plumbing, not new defaults).
 */

export type NativeTimeoutReason = 'connect' | 'first-token' | 'tool-execution' | 'total-run';

export interface NativeTimeoutConfig {
  connectMs?: number;
  firstTokenMs?: number;
  toolExecutionMs?: number;
  totalRunMs?: number;
}

export interface NativeTimeoutFired {
  reason: NativeTimeoutReason;
  budgetMs: number;
  /** Breadcrumb naming the signal the measurement was anchored to. */
  source: string;
}

export const TIMEOUT_CATEGORY = {
  connect: 'TIMEOUT_CONNECT',
  'first-token': 'TIMEOUT_FIRST_TOKEN',
  'tool-execution': 'TIMEOUT_TOOL_EXECUTION',
  'total-run': 'TIMEOUT_TOTAL_RUN',
} as const satisfies Record<NativeTimeoutReason, string>;

const SOURCE = {
  connect: 'agent-loop.fullStream[start-step]',
  'first-token': 'agent-loop.fullStream[first-output-part]',
  'tool-execution': 'agent-loop.fullStream[tool-call→tool-result]',
  'total-run': 'agent-loop.run',
} as const satisfies Record<NativeTimeoutReason, string>;

/** fullStream part types that count as "model output began" (first-token). */
const OUTPUT_PART_TYPES = new Set([
  'text-start',
  'text-delta',
  'reasoning-start',
  'reasoning-delta',
  'tool-input-start',
  'tool-input-delta',
  'tool-call',
]);

/**
 * Resolve the effective config: explicit options win; otherwise the
 * `CODEPILOT_NATIVE_TIMEOUTS` env JSON; otherwise disabled. Malformed env
 * values are ignored (warn once) — a bad env var must never break chat.
 */
export function resolveNativeTimeoutConfig(
  explicit?: NativeTimeoutConfig,
  env: NodeJS.ProcessEnv = process.env,
): NativeTimeoutConfig {
  if (explicit && Object.values(explicit).some((v) => typeof v === 'number' && v > 0)) {
    return explicit;
  }
  const raw = env.CODEPILOT_NATIVE_TIMEOUTS;
  if (!raw) return explicit ?? {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const pick = (k: string): number | undefined => {
      const v = parsed[k];
      return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
    };
    return {
      connectMs: pick('connectMs'),
      firstTokenMs: pick('firstTokenMs'),
      toolExecutionMs: pick('toolExecutionMs'),
      totalRunMs: pick('totalRunMs'),
    };
  } catch {
    console.warn('[native-timeout] Ignoring malformed CODEPILOT_NATIVE_TIMEOUTS env JSON');
    return explicit ?? {};
  }
}

export interface NativeTimeoutController {
  /** Combined signal: aborts on the caller's signal OR any fired budget. */
  readonly signal: AbortSignal;
  /** Set exactly once, by whichever budget fired first; null = no timeout. */
  readonly fired: NativeTimeoutFired | null;
  /** Arm the total-run timer (idempotent; no-op when budget disabled). */
  onRunStart(): void;
  /**
   * Arm the connect timer for one step's provider request. Deliberately
   * does NOT arm first-token: before the response arrives, `connect` is the
   * only valid classification (see the semantic contract above).
   */
  onStepRequest(): void;
  /**
   * Observe one fullStream part: `start-step` clears connect and arms
   * first-token, the first output part clears first-token, and
   * `tool-call` / `tool-result` / `tool-error` start/stop per-tool timers.
   */
  onStreamPart(part: { type: string; toolCallId?: string }): void;
  /**
   * Race the stream's iteration against a fired budget. Needed because
   * ai@7 only PASSES the abort signal to a tool's `execute()` — it still
   * awaits the execute promise, so a tool that ignores the signal (hung
   * network call, wedged MCP server) keeps `fullStream` open forever and
   * aborting alone never unblocks the consumer loop. With no budget
   * configured this returns the iterable unchanged (zero overhead /
   * zero behavior change); user aborts are NOT short-circuited here —
   * they keep the SDK's own abort semantics.
   */
  guardStream<T>(iterable: AsyncIterable<T>): AsyncIterable<T>;
  /** Clear step-scoped timers at the end of a step's stream consumption. */
  onStepEnd(): void;
  /** Clear everything (run teardown). Safe to call multiple times. */
  dispose(): void;
}

export function createNativeTimeoutController(
  config: NativeTimeoutConfig,
  callerSignal: AbortSignal,
): NativeTimeoutController {
  const combined = new AbortController();
  let fired: NativeTimeoutFired | null = null;
  const anyBudget = Object.values(config).some((v) => typeof v === 'number' && v > 0);

  // Rejects when a budget fires — raced against stream reads by guardStream
  // so a hung tool execute cannot wedge the run. Pre-attach a no-op handler:
  // a fire while nothing is racing must not raise an unhandled rejection.
  let rejectOnFire: ((err: Error) => void) | undefined;
  const firedRejection = new Promise<never>((_, reject) => { rejectOnFire = reject; });
  firedRejection.catch(() => { /* handled by whichever race is active */ });

  if (callerSignal.aborted) {
    combined.abort(callerSignal.reason);
  } else {
    callerSignal.addEventListener('abort', () => combined.abort(callerSignal.reason), { once: true });
  }

  let totalTimer: NodeJS.Timeout | null = null;
  let connectTimer: NodeJS.Timeout | null = null;
  let firstTokenTimer: NodeJS.Timeout | null = null;
  // Guards first-token arming: true once the current step produced output,
  // so a stray late `start-step` can never re-arm a budget already satisfied.
  let stepOutputSeen = false;
  const toolTimers = new Map<string, NodeJS.Timeout>();

  const clear = (t: NodeJS.Timeout | null) => { if (t) clearTimeout(t); };

  function fire(reason: NativeTimeoutReason, budgetMs: number) {
    if (fired || combined.signal.aborted) return;
    fired = { reason, budgetMs, source: SOURCE[reason] };
    combined.abort();
    const err = new Error(`Native timeout fired: ${reason} (${budgetMs}ms)`);
    err.name = 'AbortError';
    rejectOnFire?.(err);
  }

  function arm(reason: NativeTimeoutReason, budgetMs: number | undefined): NodeJS.Timeout | null {
    if (!budgetMs || budgetMs <= 0 || combined.signal.aborted) return null;
    // Deliberately NOT unref'd: an armed budget must be able to wake an
    // otherwise-idle event loop (an unref'd timer never fires once the loop
    // drains, so the guardStream race would dangle forever). Run teardown
    // always clears every timer via dispose(), so nothing outlives the run.
    return setTimeout(() => fire(reason, budgetMs), budgetMs);
  }

  function disposeAll() {
    clear(totalTimer); totalTimer = null;
    clear(connectTimer); connectTimer = null;
    clear(firstTokenTimer); firstTokenTimer = null;
    for (const t of toolTimers.values()) clearTimeout(t);
    toolTimers.clear();
  }

  return {
    get signal() { return combined.signal; },
    get fired() { return fired; },

    onRunStart() {
      if (!totalTimer) totalTimer = arm('total-run', config.totalRunMs);
    },

    onStepRequest() {
      clear(connectTimer);
      clear(firstTokenTimer); firstTokenTimer = null;
      stepOutputSeen = false;
      connectTimer = arm('connect', config.connectMs);
      // first-token is armed by `start-step` (response arrived), never here:
      // arming at request time would let it fire during a connection black
      // hole and misreport a connect failure as first-token.
    },

    onStreamPart(part) {
      if (part.type === 'start-step') {
        clear(connectTimer); connectTimer = null;
        if (!firstTokenTimer && !stepOutputSeen) {
          firstTokenTimer = arm('first-token', config.firstTokenMs);
        }
        return;
      }
      if (OUTPUT_PART_TYPES.has(part.type)) {
        stepOutputSeen = true;
        // Any output part also proves the response arrived.
        clear(connectTimer); connectTimer = null;
        clear(firstTokenTimer); firstTokenTimer = null;
      }
      if (part.type === 'tool-call' && part.toolCallId) {
        const timer = arm('tool-execution', config.toolExecutionMs);
        if (timer) toolTimers.set(part.toolCallId, timer);
        return;
      }
      if ((part.type === 'tool-result' || part.type === 'tool-error') && part.toolCallId) {
        const timer = toolTimers.get(part.toolCallId);
        if (timer) { clearTimeout(timer); toolTimers.delete(part.toolCallId); }
      }
    },

    onStepEnd() {
      clear(connectTimer); connectTimer = null;
      clear(firstTokenTimer); firstTokenTimer = null;
      for (const t of toolTimers.values()) clearTimeout(t);
      toolTimers.clear();
    },

    async *guardStream<T>(iterable: AsyncIterable<T>): AsyncIterable<T> {
      if (!anyBudget) {
        yield* iterable;
        return;
      }
      const it = iterable[Symbol.asyncIterator]();
      try {
        while (true) {
          const r = await Promise.race([it.next(), firedRejection]);
          if (r.done) return;
          yield r.value;
        }
      } finally {
        // On a fired budget the underlying next() is still pending (hung
        // tool) — cancel the stream fire-and-forget; never await it.
        try { void it.return?.()?.catch(() => {}); } catch { /* ignore */ }
      }
    },

    dispose: disposeAll,
  };
}

/** User-facing one-liner for a fired timeout (shown via the error event). */
export function describeNativeTimeout(fired: NativeTimeoutFired): string {
  const what: Record<NativeTimeoutReason, string> = {
    connect: 'no response from the provider',
    'first-token': 'the provider responded but produced no output',
    'tool-execution': 'a tool call did not finish',
    'total-run': 'the run did not complete',
  };
  return `Native run timed out (${fired.reason}): ${what[fired.reason]} within ${fired.budgetMs}ms`;
}
