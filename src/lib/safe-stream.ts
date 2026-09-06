/**
 * safe-stream.ts — Defensive wrapper for ReadableStreamDefaultController.
 *
 * Background: Several SSE streaming code paths in agent-loop.ts and
 * claude-client.ts call `controller.enqueue()` from async callbacks
 * (onStepFinish, keep-alive timers, late tool-result handlers, etc).
 * If the consumer aborts the stream — by closing the browser tab, hitting
 * Stop, or AbortController firing — the underlying controller transitions
 * to a "closed" state. Subsequent enqueue() calls throw
 * `TypeError: Invalid state: Controller is already closed`, which Sentry
 * recorded 53 times (fatal) over 14 days.
 *
 * This wrapper remains useful for large, callback-heavy streams that already
 * have many controller-shaped call sites. New subprocess/SSE routes should
 * normally use `SingleOwnerStreamWriter` instead: it owns cancellation and
 * terminal close explicitly rather than making every stream use this wrapper.
 *
 * Closed-state errors from genuine bugs (not from racy late writes) are
 * still observable via the optional `onClosedWrite` callback, which logs
 * once per stream so we can detect a regression in dev/test without
 * spamming Sentry.
 */

export interface SafeStreamController<T> {
  enqueue(chunk: T): void;
  close(): void;
  error(err: unknown): void;
  /** True after the controller has transitioned to closed (either via close() or detected via enqueue failure). */
  readonly closed: boolean;
}

/**
 * Wrap a ReadableStream controller with one that silently ignores
 * "already closed" errors on enqueue/close, and tracks a `closed` flag.
 *
 * For an existing callback-heavy stream that cannot yet move to a single-owner
 * writer, wrap the controller at the stream boundary:
 *
 *   start(controllerRaw) {
 *     const controller = wrapController(controllerRaw);
 *     // ... rest of the code unchanged ...
 *   }
 */
export function wrapController<T>(
  raw: ReadableStreamDefaultController<T>,
  onClosedWrite?: (kind: 'enqueue' | 'close') => void,
): SafeStreamController<T> {
  let closed = false;
  let warned = false;

  const isClosedError = (e: unknown): boolean => {
    if (!(e instanceof Error)) return false;
    // Node's ReadableStream uses "Invalid state: Controller is already closed".
    // Other implementations use "The stream is closed.", "Controller has been released.", etc.
    return /already closed|stream is closed|controller has been (released|closed)|invalid state/i.test(e.message);
  };

  const noteClosed = (kind: 'enqueue' | 'close') => {
    closed = true;
    if (!warned && onClosedWrite) {
      warned = true;
      onClosedWrite(kind);
    }
  };

  return {
    enqueue(chunk: T): void {
      if (closed) return;
      try {
        raw.enqueue(chunk);
      } catch (e) {
        if (isClosedError(e)) {
          noteClosed('enqueue');
          return;
        }
        throw e;
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      try {
        raw.close();
      } catch (e) {
        if (!isClosedError(e)) throw e;
        // Already closed by another path — that's the whole point of this wrapper.
      }
    },
    error(err: unknown): void {
      if (closed) return;
      closed = true;
      try {
        raw.error(err);
      } catch {
        /* ignore — the consumer already gave up */
      }
    },
    get closed(): boolean {
      return closed;
    },
  };
}
