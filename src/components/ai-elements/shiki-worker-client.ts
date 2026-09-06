/**
 * Phase 5B — main-thread client for the Shiki tokenization worker.
 *
 * Responsibilities:
 *   - spawn / terminate the worker (lazily, browser-only),
 *   - correlate each tokenize RPC with its response by monotonic id,
 *   - surface worker init / runtime failures so the caller can fall back to
 *     main-thread highlighting (never a blank code block).
 *
 * The client is deliberately transport-agnostic (`createShikiWorkerClient`
 * takes a `spawn` thunk) so it can be driven by a fake worker in node unit
 * tests without a real DOM/Worker. `getShikiWorkerClient()` wires the real
 * `new Worker(new URL(...))` and is browser-guarded.
 */

import type { BundledLanguage, BundledTheme } from "shiki";
import type { TokenizedCode } from "./shiki-highlight-core";
import type {
  ShikiTokenizeRequest,
  ShikiWorkerResponse,
} from "./shiki-worker-protocol";

/** The subset of the DOM `Worker` interface the client relies on. */
export interface WorkerLike {
  postMessage(message: ShikiTokenizeRequest): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: (event: unknown) => void,
  ): void;
  terminate(): void;
}

export interface TokenizeParams {
  code: string;
  language: BundledLanguage;
  lightTheme: BundledTheme;
  darkTheme: BundledTheme;
}

export interface ShikiWorkerClient {
  /** Resolve themed tokens from the worker, or reject so the caller can fall
   *  back. Rejects immediately once the worker has hard-failed. */
  tokenize(params: TokenizeParams): Promise<TokenizedCode>;
  terminate(): void;
  /** True once the worker has hard-failed (init error, message error, or a
   *  postMessage throw). Callers should stop routing to it. */
  readonly failed: boolean;
}

interface PendingEntry {
  resolve: (tokens: TokenizedCode) => void;
  reject: (error: Error) => void;
}

export function createShikiWorkerClient(
  spawn: () => WorkerLike,
): ShikiWorkerClient {
  let worker: WorkerLike | null = null;
  let failed = false;
  let nextId = 1;
  const pending = new Map<number, PendingEntry>();

  function failAll(reason: string): void {
    failed = true;
    const err = new Error(reason);
    for (const entry of pending.values()) {
      entry.reject(err);
    }
    pending.clear();
  }

  function ensureWorker(): WorkerLike {
    if (worker) return worker;
    const spawned = spawn(); // may throw — caller catches and falls back

    spawned.addEventListener("message", (event: unknown) => {
      const data = (event as MessageEvent<ShikiWorkerResponse>).data;
      if (!data || typeof data.id !== "number") return;
      const entry = pending.get(data.id);
      if (!entry) return;
      pending.delete(data.id);
      if (data.ok) {
        entry.resolve(data.tokenized);
      } else {
        entry.reject(new Error(data.error || "shiki worker tokenize failed"));
      }
    });

    // A worker script that fails to load (e.g. missing chunk) fires `error`
    // rather than throwing from the constructor. Treat it — and messageerror
    // (uncloneable payloads) — as a hard failure: reject in-flight work and
    // stop routing to the worker for the rest of the session.
    spawned.addEventListener("error", (event: unknown) => {
      const message = (event as { message?: string })?.message;
      failAll(message ? String(message) : "shiki worker error");
    });
    spawned.addEventListener("messageerror", () => {
      failAll("shiki worker messageerror");
    });

    worker = spawned;
    return spawned;
  }

  return {
    get failed() {
      return failed;
    },
    terminate() {
      try {
        worker?.terminate();
      } catch {
        // ignore — terminating a dead worker is best-effort
      }
      worker = null;
    },
    tokenize(params: TokenizeParams): Promise<TokenizedCode> {
      if (failed) {
        return Promise.reject(new Error("shiki worker previously failed"));
      }
      let active: WorkerLike;
      try {
        active = ensureWorker();
      } catch (error) {
        failed = true;
        return Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
      const id = nextId++;
      return new Promise<TokenizedCode>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          active.postMessage({
            id,
            code: params.code,
            language: params.language,
            lightTheme: params.lightTheme,
            darkTheme: params.darkTheme,
          });
        } catch (error) {
          pending.delete(id);
          const err = error instanceof Error ? error : new Error(String(error));
          failAll(err.message);
          reject(err);
        }
      });
    },
  };
}

/**
 * Try the worker first; on any worker failure (unavailable, init error, or a
 * rejected/failed RPC) fall back to the provided main-thread tokenizer. The
 * fallback guarantees a code block is never left blank.
 *
 * Pure over its dependencies (client + fallback are injected), so both the
 * worker-offload path and the fallback path are unit-testable without a DOM.
 */
export async function tokenizeWithFallback(
  params: TokenizeParams,
  client: Pick<ShikiWorkerClient, "tokenize"> | null,
  fallback: (
    code: string,
    language: BundledLanguage,
    lightTheme: BundledTheme,
    darkTheme: BundledTheme,
  ) => Promise<TokenizedCode>,
): Promise<TokenizedCode> {
  if (client) {
    try {
      return await client.tokenize(params);
    } catch {
      // Worker unavailable or tokenize failed — fall through to main thread.
    }
  }
  return fallback(
    params.code,
    params.language,
    params.lightTheme,
    params.darkTheme,
  );
}

// ── Real-worker singleton ────────────────────────────────────────────────

let singleton: ShikiWorkerClient | null = null;
let spawnAttempted = false;

/**
 * Return the process-wide worker client, or `null` when a worker can't be used
 * (SSR / no `Worker` global / a prior hard failure / spawn threw). `null`
 * signals the caller to tokenize on the main thread. The `new Worker(new URL
 * ('./shiki.worker.ts', import.meta.url), { type: 'module' })` form is what
 * Turbopack statically detects to emit the worker as a same-origin chunk.
 */
export function getShikiWorkerClient(): ShikiWorkerClient | null {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return null;
  }
  if (singleton) {
    return singleton.failed ? null : singleton;
  }
  // Only attempt to spawn once. If the worker hard-failed, we don't keep
  // re-spawning a broken worker on every code block for the rest of the
  // session — we route straight to the main-thread fallback.
  if (spawnAttempted) return null;
  spawnAttempted = true;
  try {
    singleton = createShikiWorkerClient(
      () =>
        new Worker(new URL("./shiki.worker.ts", import.meta.url), {
          type: "module",
        }) as unknown as WorkerLike,
    );
    return singleton;
  } catch {
    singleton = null;
    return null;
  }
}
