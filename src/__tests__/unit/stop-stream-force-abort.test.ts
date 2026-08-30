/**
 * Phase 2 (2026-06-02) — GitHub #578: after interrupting a running/long task
 * the composer was locked (clicking send did nothing).
 *
 * Root cause was in stopStream: the force-abort safety net was scheduled
 * INSIDE the interrupt fetch's `.finally()`. A hung `/api/chat/interrupt`
 * never settles, so `.finally` never ran, the abort was never scheduled, the
 * stream stayed `phase: 'active'`, and ChatView's `isStreaming` gate
 * (= phase==='active') queued every new message but never dequeued.
 *
 * The fix extracts the control flow into stopStreamWith() and schedules the
 * force-abort FIRST + UNCONDITIONALLY. These tests pin that ordering — the
 * exact regression — without needing the un-injectable module-level streams map.
 *
 * Interrupt lifecycle extends the contract: the interrupt
 * response now carries the backend's authoritative runtime_status, and
 * stopStreamWith converges the client phase to a TERMINAL phase when the backend
 * is already terminal — bounding phase off 'active' even if the reader never
 * rejects (I4). The convergence tests below drive that through injected deps
 * (mirrors session-lock-settle.test.ts's DI style), so they exercise real
 * runtime behavior rather than pinning source.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stopStreamWith } from '@/lib/stream-session-manager';

function makeStream(phase: string) {
  const calls: string[] = [];
  const stream = {
    snapshot: { phase },
    abortController: { abort: () => { calls.push('abort'); } },
  };
  return { stream, calls };
}

// Let queued microtasks (the interrupt-response `.then`) run.
const flush = () => new Promise<void>((r) => setImmediate(r));

// Minimal deps with the two Phase 3 additions defaulted to no-ops, so each test
// overrides only what it asserts on.
function makeDeps(over: Partial<Parameters<typeof stopStreamWith>[1]> = {}) {
  return {
    requestInterrupt: () => Promise.resolve<string | null>(null),
    scheduleForceAbort: () => {},
    convergePhase: () => {},
    ...over,
  };
}

describe('stopStreamWith — force-abort is independent of the interrupt request (#578)', () => {
  it('on an active stream: schedules the force-abort AND requests the interrupt (synchronously)', () => {
    const { stream } = makeStream('active');
    const order: string[] = [];
    stopStreamWith(stream, makeDeps({
      requestInterrupt: () => { order.push('interrupt'); return Promise.resolve(null); },
      scheduleForceAbort: () => order.push('schedule'),
    }), 2000);
    // The interrupt side effect fires synchronously right after the net is
    // armed; only its response handling is deferred to a microtask.
    assert.deepEqual(order, ['schedule', 'interrupt']);
  });

  it('schedules the force-abort BEFORE the interrupt — never gated behind it (the regression)', () => {
    const { stream } = makeStream('active');
    let scheduled = false;
    let scheduledBeforeInterrupt = false;
    stopStreamWith(stream, makeDeps({
      requestInterrupt: () => { scheduledBeforeInterrupt = scheduled; return Promise.resolve(null); },
      scheduleForceAbort: () => { scheduled = true; },
    }), 2000);
    assert.equal(scheduled, true, 'force-abort must be scheduled');
    assert.equal(
      scheduledBeforeInterrupt,
      true,
      'force-abort must be scheduled before the interrupt request, so a hung interrupt cannot strand the stream',
    );
  });

  it('the scheduled force-abort callback aborts when the stream is still active', () => {
    const { stream, calls } = makeStream('active');
    let captured: (() => void) | null = null;
    stopStreamWith(stream, makeDeps({
      scheduleForceAbort: (fn) => { captured = fn; },
    }), 2000);
    if (!captured) throw new Error('expected a scheduled force-abort callback');
    (captured as () => void)();
    assert.deepEqual(calls, ['abort'], 'still-active stream must be aborted when the timer fires');
  });

  it('the force-abort callback does NOT abort if the stream already left active', () => {
    const { stream, calls } = makeStream('active');
    let captured: (() => void) | null = null;
    stopStreamWith(stream, makeDeps({
      scheduleForceAbort: (fn) => { captured = fn; },
    }), 2000);
    if (!captured) throw new Error('expected a scheduled force-abort callback');
    // a graceful interrupt terminated the stream before the timer fired
    stream.snapshot.phase = 'stopped';
    (captured as () => void)();
    assert.deepEqual(calls, [], 'a stream that already terminated must not be re-aborted');
  });

  it('a non-active stream is a no-op (no interrupt, no schedule)', () => {
    const { stream } = makeStream('stopped');
    const order: string[] = [];
    stopStreamWith(stream, makeDeps({
      requestInterrupt: () => { order.push('interrupt'); return Promise.resolve(null); },
      scheduleForceAbort: () => order.push('schedule'),
    }), 2000);
    assert.deepEqual(order, []);
  });

  it('an undefined stream is a safe no-op', () => {
    const order: string[] = [];
    assert.doesNotThrow(() => stopStreamWith(undefined, makeDeps({
      requestInterrupt: () => { order.push('interrupt'); return Promise.resolve(null); },
      scheduleForceAbort: () => order.push('schedule'),
    }), 2000));
    assert.deepEqual(order, []);
  });
});

describe('stopStreamWith — phase converges on the authoritative runtime_status (Phase 3 D, I4)', () => {
  it("backend 'interrupted' → converges to 'stopped' even though the reader never rejected", async () => {
    const { stream, calls } = makeStream('active');
    const converged: string[] = [];
    stopStreamWith(stream, makeDeps({
      requestInterrupt: () => Promise.resolve('interrupted'),
      // The reader is hung: the force-abort callback is captured but never fired.
      scheduleForceAbort: () => {},
      convergePhase: (p) => { converged.push(p); stream.snapshot.phase = p; },
    }), 2000);
    await flush();
    assert.deepEqual(converged, ['stopped'], 'interrupted backend must bound the client phase to stopped');
    assert.equal(stream.snapshot.phase, 'stopped', 'client phase is off active → composer unlocks');
    assert.deepEqual(calls, [], 'convergence flips phase only — it must NOT abort the controller itself');
  });

  it("backend 'idle' (normal completion) → converges to 'completed'", async () => {
    const { stream } = makeStream('active');
    const converged: string[] = [];
    stopStreamWith(stream, makeDeps({
      requestInterrupt: () => Promise.resolve('idle'),
      convergePhase: (p) => { converged.push(p); stream.snapshot.phase = p; },
    }), 2000);
    await flush();
    assert.deepEqual(converged, ['completed']);
  });

  it("backend 'error' → converges to 'error'", async () => {
    const { stream } = makeStream('active');
    const converged: string[] = [];
    stopStreamWith(stream, makeDeps({
      requestInterrupt: () => Promise.resolve('error'),
      convergePhase: (p) => { converged.push(p); stream.snapshot.phase = p; },
    }), 2000);
    await flush();
    assert.deepEqual(converged, ['error']);
  });

  it("backend still 'running' → does NOT converge (force-abort net remains the sole bound; no reader-less re-lock)", async () => {
    const { stream } = makeStream('active');
    const converged: string[] = [];
    stopStreamWith(stream, makeDeps({
      requestInterrupt: () => Promise.resolve('running'),
      convergePhase: (p) => converged.push(p),
    }), 2000);
    await flush();
    assert.deepEqual(converged, [], 'a running backend maps back to active → no correction');
    assert.equal(stream.snapshot.phase, 'active');
  });

  it('unknown / null runtime_status (interrupt failed/timed out) → does NOT converge', async () => {
    const { stream } = makeStream('active');
    const converged: string[] = [];
    stopStreamWith(stream, makeDeps({
      requestInterrupt: () => Promise.resolve(null),
      convergePhase: (p) => converged.push(p),
    }), 2000);
    await flush();
    assert.deepEqual(converged, []);
  });

  it('if the reader already settled before the response arrives, no double-terminal convergence', async () => {
    const { stream } = makeStream('active');
    const converged: string[] = [];
    let resolveStatus: (s: string) => void = () => {};
    stopStreamWith(stream, makeDeps({
      requestInterrupt: () => new Promise<string>((res) => { resolveStatus = res; }),
      convergePhase: (p) => converged.push(p),
    }), 2000);
    // Reader rejects / real terminal event lands first.
    stream.snapshot.phase = 'stopped';
    resolveStatus('interrupted');
    await flush();
    assert.deepEqual(converged, [], 'phase already left active → the interrupt response must not re-converge');
  });

  it('a rejected interrupt promise does not throw out of stopStreamWith', async () => {
    const { stream } = makeStream('active');
    stopStreamWith(stream, makeDeps({
      requestInterrupt: () => Promise.reject(new Error('boom')),
    }), 2000);
    await assert.doesNotReject(flush());
  });
});

describe('stopStream wiring — source pins (#578)', () => {
  const src = readFileSync(
    path.resolve(__dirname, '../../lib/stream-session-manager.ts'),
    'utf8',
  );
  const block = src.match(/export function stopStream\(sessionId: string\)[\s\S]*?\n\}/)?.[0] ?? '';

  it('stopStream delegates to stopStreamWith', () => {
    assert.ok(block, 'stopStream() must exist');
    assert.match(block, /stopStreamWith\(/);
  });

  it('the force-abort is NOT scheduled inside a .finally() of the interrupt fetch (the regression)', () => {
    assert.doesNotMatch(
      block,
      /\.finally\(/,
      'scheduling the abort in the interrupt fetch .finally() is exactly the #578 hang',
    );
  });

  it('the interrupt fetch is bounded so a hung endpoint cannot leak', () => {
    assert.match(block, /signal:\s*AbortSignal\.timeout\(/);
  });

  it('the interrupt response feeds phase convergence (reads runtime_status, wires convergePhase)', () => {
    assert.match(block, /runtime_status/, 'stopStream must parse the interrupt response runtime_status');
    assert.match(block, /convergePhase:/, 'stopStream must wire the convergePhase dep');
  });
});
