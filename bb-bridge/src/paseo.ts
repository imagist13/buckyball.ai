/**
 * Paseo daemon lifecycle supervisor.
 *
 * bb-bridge is the *only* process that ever spawns / kills the Paseo
 * daemon. The daemon is a child process of bb-bridge for the lifetime
 * of one `bb-bridge server` invocation:
 *
 *   - `spawnPaseoDaemon`         — fork `paseo daemon`, return a handle.
 *   - `waitForPaseoReady`        — poll the WS URL until the daemon answers.
 *   - `supervisePaseo`           — restart-on-crash loop, SIGTERM-aware.
 *
 * Pure-Node ESM; no `node:*` outside what's needed for `child_process`.
 * All child-process plumbing is injected (`SpawnFn`, `PingWsFn`) so
 * the supervisor is unit-testable without actually forking Paseo.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

/** Env-overridable defaults — see `bb-bridge/src/server.ts`. */
export interface PaseoSupervisorOptions {
  /** Path to the `paseo` binary. Default: `paseo` (PATH lookup). */
  bin?: string;
  /** Args passed to the binary. Default: `["daemon"]`. */
  args?: string[];
  /** WS URL bb-bridge should poll for readiness. */
  wsUrl: string;
  /** How long to wait for readiness before failing boot. Default: 10s. */
  readyTimeoutMs?: number;
  /** Backoff between crash-restart attempts. Default: 1s. */
  restartBackoffMs?: number;
  /** Test hook: replace `child_process.spawn`. */
  spawnFn?: SpawnFn;
  /** Test hook: replace the WS readiness probe. */
  pingWsFn?: PingWsFn;
  /** Test hook: replace the post-spawn delay. */
  delayFn?: (ms: number) => Promise<void>;
  /** Test hook: receive lifecycle events. */
  onEvent?: (event: PaseoSupervisorEvent) => void;
}

export type PaseoSupervisorEvent =
  | { kind: "spawned"; pid: number }
  | { kind: "ready" }
  | { kind: "ready-timeout" }
  | { kind: "exit"; code: number | null; signal: NodeJS.Signals | null }
  | { kind: "shutdown"; signal: NodeJS.Signals };

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: Parameters<typeof spawn>[2],
) => ChildProcess;

export type PingWsFn = (url: string) => Promise<void>;

/**
 * Spawn `paseo daemon` and return its ChildProcess. Stdout/stderr are
 * piped through to bb-bridge's own stdio (the daemon is part of our
 * supervisor group — its logs belong with ours).
 */
export function spawnPaseoDaemon(opts: PaseoSupervisorOptions): ChildProcess {
  const bin = opts.bin ?? "paseo";
  const args = opts.args ?? ["daemon"];
  const spawnFn = opts.spawnFn ?? spawn;
  const child = spawnFn(bin, args, {
    stdio: ["ignore", "inherit", "inherit"],
    detached: false,
  });
  opts.onEvent?.({ kind: "spawned", pid: child.pid ?? -1 });
  return child;
}

/**
 * Poll the Paseo WS endpoint until it accepts a connection or the
 * timeout elapses. Resolves on success, rejects on timeout.
 *
 * The probe opens a `WebSocket`, awaits `'open'`, closes immediately,
 * and treats any error or close-without-open as "not ready yet".
 * Once is enough on success — Paseo does not require a handshake.
 */
export async function waitForPaseoReady(opts: PaseoSupervisorOptions): Promise<void> {
  const timeoutMs = opts.readyTimeoutMs ?? 10_000;
  const ping = opts.pingWsFn ?? defaultPingWs;
  const sleep = opts.delayFn ?? delay;

  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      await ping(opts.wsUrl);
      opts.onEvent?.({ kind: "ready" });
      return;
    } catch (err) {
      lastErr = err;
      await sleep(100);
    }
  }
  opts.onEvent?.({ kind: "ready-timeout" });
  throw new Error(
    `paseo daemon did not become ready at ${opts.wsUrl} within ${timeoutMs}ms (last error: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    })`,
  );
}

function defaultPingWs(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      reject(err);
      return;
    }
    const cleanup = () => {
      try {
        ws.close();
      } catch {
        // ignore — socket may already be closed
      }
    };
    ws.addEventListener("open", () => {
      cleanup();
      resolve();
    });
    ws.addEventListener("error", (event) => {
      cleanup();
      reject(new Error(`ws probe failed: ${String(event)}`));
    });
  });
}

/**
 * Returns a controller that supervises a Paseo child for the lifetime
 * of the bb-bridge process. On non-SIGTERM exit, restart with
 * `restartBackoffMs`. On explicit `shutdown()`, send SIGTERM and stop
 * supervising.
 */
export interface PaseoSupervisor {
  /** Start spawning the daemon and waiting for readiness. */
  start(): Promise<ChildProcess>;
  /** Send SIGTERM (or configured signal) and stop supervising. */
  shutdown(signal?: NodeJS.Signals): void;
  /** The current child, if any. Useful for tests. */
  current(): ChildProcess | null;
}

export function supervisePaseo(opts: PaseoSupervisorOptions): PaseoSupervisor {
  const backoff = opts.restartBackoffMs ?? 1_000;
  const sleep = opts.delayFn ?? delay;

  let child: ChildProcess | null = null;
  let stopped = false;
  let stopping = false;

  function isGracefulExit(signal: NodeJS.Signals | null): boolean {
    return signal === "SIGTERM" || signal === "SIGINT";
  }

  function attachLifecycle(c: ChildProcess): void {
    c.on("exit", (code, signal) => {
      opts.onEvent?.({ kind: "exit", code, signal });
      if (stopping || isGracefulExit(signal) || stopped) return;
      // Crash: back off and restart. We don't loop forever — the
      // supervisor itself is short-lived (one bb-bridge process).
      void sleep(backoff).then(() => {
        if (stopped || stopping) return;
        child = spawnPaseoDaemon(opts);
        attachLifecycle(child);
      });
    });
  }

  return {
    async start(): Promise<ChildProcess> {
      child = spawnPaseoDaemon(opts);
      attachLifecycle(child);
      await waitForPaseoReady(opts);
      return child;
    },
    shutdown(signal: NodeJS.Signals = "SIGTERM"): void {
      stopping = true;
      stopped = true;
      opts.onEvent?.({ kind: "shutdown", signal });
      if (child && child.exitCode === null) {
        try {
          child.kill(signal);
        } catch {
          // already gone
        }
      }
    },
    current(): ChildProcess | null {
      return child;
    },
  };
}
