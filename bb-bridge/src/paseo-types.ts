/**
 * Thin type stub for the Paseo client.
 *
 * Stage 1 only needs the existence of the type so bb-bridge can
 * declare the `paseo` variable; it never calls any method on it
 * (only `/v1/health` is mounted). In Stage 2, the import path below
 * switches from `./paseo-types` to `@getpaseo/client`; the methods
 * we use are the ones declared here.
 *
 * Keep this file in lock-step with the public Paseo SDK surface we
 * rely on. Anything not declared here cannot be called from bb-bridge
 * without a code change here first.
 */

export interface PaseoClientOptions {
  /** Paseo WebSocket URL, e.g. ws://127.0.0.1:6767/ws. */
  url: string;
  reconnect?: {
    enabled?: boolean;
    maxBackoffMs?: number;
  };
}

export interface PaseoProviderInfo {
  id: string;
  label: string;
  models: Array<{ id: string }>;
  ready: boolean;
}

/** Minimal Paseo client surface bb-bridge (will) depend on. */
export interface PaseoClient {
  readonly url: string;
  /** Resolves once the underlying WS is open. */
  waitForReady(timeoutMs?: number): Promise<void>;
  /** Lists installed providers (codex, claude, opencode, bb-agent, …). */
  providers: {
    list(): Promise<PaseoProviderInfo[]>;
    waitForReady(opts?: { timeoutMs?: number }): Promise<void>;
  };
}

/**
 * Constructor signature for the Paseo client. The real implementation
 * lives in `@getpaseo/client`; this stub mirrors its shape.
 *
 * Stage 1: never invoked (we only spawn the daemon and probe its WS).
 * Stage 2+: imported from `@getpaseo/client` and called once during
 * bb-bridge boot.
 */
export type CreatePaseoClient = (opts: PaseoClientOptions) => PaseoClient;
