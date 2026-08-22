/**
 * Paseo daemon supervisor lifecycle tests.
 *
 * We exercise the supervisor's `start / exit / restart / shutdown`
 * state machine by injecting a fake `spawnFn` that returns a
 * controllable EventEmitter. No real Paseo binary is forked; we
 * only verify that bb-bridge's policy (spawn → wait → restart-on-
 * non-SIGTERM → SIGTERM-aware shutdown) is wired correctly.
 */

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  spawnPaseoDaemon,
  supervisePaseo,
  waitForPaseoReady,
  type PingWsFn,
  type SpawnFn,
} from "../src/paseo.js";

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
  emitter.kill = vi.fn((signal?: NodeJS.Signals) => {
    emitter.signalCode = signal ?? "SIGTERM";
    // Sync-emit exit so callers awaiting supervisor state see it.
    queueMicrotask(() => emitter.emit("exit", null, emitter.signalCode));
    return true;
  });
  return emitter;
}

describe("spawnPaseoDaemon", () => {
  it("invokes the injected spawn fn with the right args and stdio", () => {
    const child = makeFakeChild(4242);
    const spawnFn: SpawnFn = vi.fn(() => child) as unknown as SpawnFn;
    const events: string[] = [];
    const result = spawnPaseoDaemon({
      bin: "/custom/paseo",
      args: ["daemon", "--debug"],
      wsUrl: "ws://localhost:6767/ws",
      spawnFn,
      onEvent: (e) => events.push(e.kind),
    });
    expect(spawnFn).toHaveBeenCalledWith(
      "/custom/paseo",
      ["daemon", "--debug"],
      expect.objectContaining({ stdio: ["ignore", "inherit", "inherit"] }),
    );
    expect(result).toBe(child);
    expect(events).toEqual(["spawned"]);
  });
});

describe("waitForPaseoReady", () => {
  it("resolves once ping succeeds before the timeout", async () => {
    let calls = 0;
    const ping: PingWsFn = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Error("not yet");
    });
    const events: string[] = [];
    await waitForPaseoReady({
      wsUrl: "ws://localhost:6767/ws",
      readyTimeoutMs: 1_000,
      pingWsFn: ping,
      delayFn: async () => {
        // No real wait in tests.
      },
      onEvent: (e) => events.push(e.kind),
    });
    expect(ping).toHaveBeenCalledTimes(3);
    expect(events).toEqual(["ready"]);
  });

  it("throws ready-timeout if ping never succeeds", async () => {
    const ping: PingWsFn = vi.fn(async () => {
      throw new Error("never");
    });
    const events: string[] = [];
    await expect(
      waitForPaseoReady({
        wsUrl: "ws://localhost:6767/ws",
        readyTimeoutMs: 50,
        pingWsFn: ping,
        delayFn: async () => {
          // Skip the sleep.
        },
        onEvent: (e) => events.push(e.kind),
      }),
    ).rejects.toThrow(/did not become ready/);
    expect(events).toContain("ready-timeout");
  });
});

describe("supervisePaseo", () => {
  let children: FakeChild[];
  let currentSpawnIndex = 0;

  beforeEach(() => {
    children = [];
    currentSpawnIndex = 0;
  });

  afterEach(() => {
    // Drain any leftover fake children.
    children.length = 0;
  });

  function spawnFnBuilder(): SpawnFn {
    return (() => {
      const child = makeFakeChild(1000 + currentSpawnIndex++);
      children.push(child);
      return child as unknown as ReturnType<typeof import("node:child_process").spawn>;
    }) as unknown as SpawnFn;
  }

  it("spawns the daemon and waits for readiness on start()", async () => {
    const events: string[] = [];
    const ping: PingWsFn = vi.fn(async () => {});
    const sup = supervisePaseo({
      bin: "paseo",
      wsUrl: "ws://localhost:6767/ws",
      spawnFn: spawnFnBuilder(),
      pingWsFn: ping,
      delayFn: async () => {},
      onEvent: (e) => events.push(e.kind),
    });
    const child = await sup.start();
    expect(child.pid).toBe(1000);
    expect(ping).toHaveBeenCalledWith("ws://localhost:6767/ws");
    expect(events).toEqual(["spawned", "ready"]);
    sup.shutdown();
  });

  it("restarts the daemon after a non-SIGTERM crash, but not after a graceful one", async () => {
    const events: string[] = [];
    const ping: PingWsFn = vi.fn(async () => {});
    const sup = supervisePaseo({
      bin: "paseo",
      wsUrl: "ws://localhost:6767/ws",
      spawnFn: spawnFnBuilder(),
      pingWsFn: ping,
      delayFn: async () => {},
      restartBackoffMs: 0,
      onEvent: (e) => events.push(e.kind),
    });

    await sup.start();
    expect(children).toHaveLength(1);

    // Crash with code 1 (not a signal). Supervisor should restart.
    children[0]!.emit("exit", 1, null);
    // Let the microtask + restart resolve.
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(children).toHaveLength(2);
    expect(events).toContain("exit");

    // Now kill with SIGTERM. Supervisor should NOT restart.
    sup.shutdown();
    children[1]!.emit("exit", null, "SIGTERM");
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(children).toHaveLength(2);
  });

  it("shutdown() sends SIGTERM to the current child", async () => {
    const ping: PingWsFn = vi.fn(async () => {});
    const sup = supervisePaseo({
      bin: "paseo",
      wsUrl: "ws://localhost:6767/ws",
      spawnFn: spawnFnBuilder(),
      pingWsFn: ping,
      delayFn: async () => {},
    });
    await sup.start();
    sup.shutdown();
    expect(children[0]!.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("shutdown() is safe to call when no child is running", () => {
    const sup = supervisePaseo({
      bin: "paseo",
      wsUrl: "ws://localhost:6767/ws",
      spawnFn: spawnFnBuilder(),
      pingWsFn: vi.fn(async () => {}),
      delayFn: async () => {},
    });
    expect(() => sup.shutdown()).not.toThrow();
  });
});
