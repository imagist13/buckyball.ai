/**
 * bb-bridge HTTP gateway tests.
 *
 * Stage 1 mounts a single endpoint: GET /v1/health. These tests
 * exercise the boot wiring, the health response shape, and the
 * "paseo not ready" reporting.
 */

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startBridge } from "../src/server.js";
import type { PingWsFn, SpawnFn } from "../src/paseo.js";

interface FakeChild extends EventEmitter {
  pid: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill: (signal?: NodeJS.Signals) => boolean;
}

function makeFakeChild(pid: number): FakeChild {
  const emitter = new EventEmitter() as FakeChild;
  emitter.pid = pid;
  emitter.exitCode = null;
  emitter.signalCode = null;
  emitter.kill = vi.fn(() => true);
  return emitter;
}

let children: FakeChild[];

beforeEach(() => {
  children = [];
});

afterEach(() => {
  for (const c of children) {
    if (c.exitCode === null && c.signalCode === null) {
      c.emit("exit", null, "SIGTERM");
    }
  }
  children = [];
});

describe("bb-bridge HTTP gateway", () => {
  function alwaysOkPing(): PingWsFn {
    return vi.fn(async () => {}) as unknown as PingWsFn;
  }

  function alwaysOkSpawnFn(): SpawnFn {
    return (() => {
      const child = makeFakeChild(7000 + children.length);
      children.push(child);
      return child as unknown as ReturnType<typeof import("node:child_process").spawn>;
    }) as unknown as SpawnFn;
  }

  it("responds 200 with { ok: true, bb_bridge: 'ready', paseo: 'ready' } when Paseo is up", async () => {
    const runtime = await startBridge({
      port: 0,
      host: "127.0.0.1",
      paseoWsUrl: "ws://127.0.0.1:6767/ws",
      paseoBin: "paseo",
      readyTimeoutMs: 500,
      spawnFn: alwaysOkSpawnFn(),
      pingWsFn: alwaysOkPing(),
      delayFn: async () => {},
    });
    try {
      const res = await fetch(`${runtime.url}/v1/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({
        ok: true,
        bb_bridge: "ready",
        paseo: "ready",
      });
    } finally {
      await runtime.close();
      runtime.supervisor.shutdown();
    }
  });

  it("responds 404 with { ok: false, error: 'not_found' } for unknown paths", async () => {
    const runtime = await startBridge({
      port: 0,
      host: "127.0.0.1",
      paseoWsUrl: "ws://127.0.0.1:6767/ws",
      paseoBin: "paseo",
      readyTimeoutMs: 500,
      spawnFn: alwaysOkSpawnFn(),
      pingWsFn: alwaysOkPing(),
      delayFn: async () => {},
    });
    try {
      const res = await fetch(`${runtime.url}/v1/nope`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({ ok: false, error: "not_found" });
    } finally {
      await runtime.close();
      runtime.supervisor.shutdown();
    }
  });

  it("refuses to boot if Paseo never becomes ready", async () => {
    // Override the default probe: always reject. No real ws / no
    // real Paseo daemon is touched.
    const alwaysFailPing: PingWsFn = vi.fn(async () => {
      throw new Error("synthetic not-ready");
    });
    const fakeChild = makeFakeChild(9001);
    children.push(fakeChild);
    await expect(
      startBridge({
        port: 0,
        host: "127.0.0.1",
        paseoWsUrl: "ws://127.0.0.1:6767/ws",
        paseoBin: "paseo",
        readyTimeoutMs: 50,
        spawnFn: (() => fakeChild) as unknown as SpawnFn,
        pingWsFn: alwaysFailPing,
        delayFn: async () => {},
      }),
    ).rejects.toThrow(/did not become ready/);
    expect(alwaysFailPing).toHaveBeenCalled();
  });
});
