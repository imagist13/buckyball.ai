/**
 * bb-bridge boot + HTTP gateway.
 *
 * This file does two things and two things only:
 *
 *   1. Supervises the Paseo daemon (spawn / wait / restart / SIGTERM).
 *   2. Serves a single `/v1/health` endpoint that reports whether
 *      bb-bridge is alive and whether the supervised Paseo daemon is
 *      ready.
 *
 * It deliberately has NO bb.ai-specific logic. In Stage 2 it grows a
 * `POST /v1/agents` forwarder to `bb-companion`'s `/internal/compose`
 * and a passthrough to the Paseo client for the rest of `/v1/*`. In
 * Stage 3 it grows a startup hook that registers the `bb-agent`
 * Paseo provider via `client.config.patch(...)`.
 *
 * No authentication is wired in Stage 1 — the server is bound to
 * `127.0.0.1` by default. Auth is a Stage 2+ concern.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  supervisePaseo,
  type PaseoSupervisor,
  type PaseoSupervisorEvent,
  type PingWsFn,
  type SpawnFn,
} from "./paseo.js";

export interface BridgeServerOptions {
  /** HTTP port to listen on. Default: 6767 (matches Paseo's port — we own the port). */
  port?: number;
  /** Bind address. Default: 127.0.0.1 (no external exposure in Stage 1). */
  host?: string;
  /** Paseo WS URL — supervisor polls this for readiness. */
  paseoWsUrl?: string;
  /** Paseo binary to spawn. Default: `paseo`. */
  paseoBin?: string;
  /** Readiness timeout. Default: 10 s. */
  readyTimeoutMs?: number;
  /** Test hooks — passed straight to `supervisePaseo`. */
  spawnFn?: SpawnFn;
  pingWsFn?: PingWsFn;
  delayFn?: (ms: number) => Promise<void>;
  onEvent?: (e: PaseoSupervisorEvent) => void;
}

export interface BridgeRuntime {
  port: number;
  url: string;
  supervisor: PaseoSupervisor;
  close: () => Promise<void>;
}

export async function startBridge(opts: BridgeServerOptions = {}): Promise<BridgeRuntime> {
  const port = opts.port ?? Number(process.env.BB_BRIDGE_PORT ?? 6767);
  const host = opts.host ?? process.env.BB_BRIDGE_HOST ?? "127.0.0.1";
  const paseoWsUrl = opts.paseoWsUrl ?? process.env.PASEO_WS_URL ?? "ws://127.0.0.1:6767/ws";
  const paseoBin = opts.paseoBin ?? process.env.PASEO_BIN ?? "paseo";

  const supervisor = supervisePaseo({
    bin: paseoBin,
    wsUrl: paseoWsUrl,
    readyTimeoutMs: opts.readyTimeoutMs ?? 10_000,
    spawnFn: opts.spawnFn,
    pingWsFn: opts.pingWsFn,
    delayFn: opts.delayFn,
    onEvent: opts.onEvent,
  });

  await supervisor.start();

  const httpServer = createServer((req, res) => {
    if (req.url === "/v1/health" && req.method === "GET") {
      handleHealth(req, res, supervisor);
      return;
    }
    notFound(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });

  return {
    port,
    url: `http://${host}:${port}`,
    supervisor,
    close: () =>
      new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      }),
  };
}

function handleHealth(
  _req: IncomingMessage,
  res: ServerResponse,
  supervisor: PaseoSupervisor,
): void {
  const child = supervisor.current();
  const paseoReady = child !== null && child.exitCode === null && child.signalCode === null;
  const body = JSON.stringify({
    ok: true,
    bb_bridge: "ready",
    paseo: paseoReady ? "ready" : "not_ready",
  });
  res.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function notFound(_req: IncomingMessage, res: ServerResponse): void {
  const body = JSON.stringify({ ok: false, error: "not_found" });
  res.writeHead(404, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  res.end(body);
}
