/**
 * Codex turn/interrupt contract — source-level pins.
 *
 * `turn/interrupt` in Codex requires `{ threadId, turnId }` per
 * `资料/codex/.../v2/TurnInterruptParams.ts`. Slice 3 (Phase 5 Phase 4)
 * captures the turnId returned by `turn/start` into an in-process map so
 * interrupt can find it.
 *
 * codex-stop-recovery (Phase 1/2) refactored the interrupt implementation
 * into a shared module-level helper `issueCodexTurnInterrupt(sessionId)` so
 * BOTH interrupt paths converge on one implementation:
 *   - the public `interrupt(sessionId)` method — HTTP `/api/chat/interrupt`
 *     fan-out (Stop button);
 *   - the in-stream abort-signal handler — honors the `abortController` the
 *     chat route already passes (force-abort / disconnect path).
 *
 * The transient registry and wire payload are behavior-tested without a live
 * app-server. A small set of source pins remains for the runtime integration
 * points that only execute against a real app-server; the true end-to-end
 * Stop path remains a required smoke.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  abortCodexTurnController,
  CodexTurnInterruptRegistry,
  registerCodexTurnAbortController,
  requestCodexTurnInterrupt,
} from '../../lib/codex/turn-interrupt-registry';

const runtimeSrc = fs.readFileSync(
  path.resolve(__dirname, '../../lib/codex/runtime.ts'),
  'utf8',
);

describe('Codex turn registry — Slice 3 contract', () => {
  it('owns active turn identity and refuses interrupt after terminal cleanup', () => {
    const registry = new CodexTurnInterruptRegistry();
    const turn = { threadId: 'thread-1', turnId: 'turn-1' };
    registry.set('session-1', turn);
    assert.deepEqual(registry.get('session-1'), turn);

    let requested: typeof turn | undefined;
    assert.equal(registry.issue('session-1', active => {
      requested = active;
    }), true);
    assert.deepEqual(requested, turn);

    assert.equal(registry.delete('session-1'), true);
    assert.equal(registry.get('session-1'), undefined);
    assert.equal(registry.issue('session-1', () => {
      assert.fail('a terminal-cleaned turn must not be interrupted');
    }), false);
  });

  it('runtime owns one module-scoped registry', () => {
    assert.match(
      runtimeSrc,
      /const\s+activeCodexTurns\s*=\s*new\s+CodexTurnInterruptRegistry\(\)/,
    );
  });

  it('turn/start response → activeCodexTurns.set with (threadId, turnId)', () => {
    // Anchored on the real JSON-RPC call (not the word "turn/start", which now
    // also appears in Phase 2 comments) so the pin stays precise.
    assert.match(
      runtimeSrc,
      /client\.request<[^>]*>\('turn\/start'[\s\S]{0,800}activeCodexTurns\.set\(sessionId,\s*\{\s*threadId,\s*turnId:\s*turnResult\.turn\.id\s*\}\)/,
    );
  });

  it('closeStream() drops the active-turn entry on EVERY close path (codebase-health A4)', () => {
    // The delete moved OUT of the terminal-event branch and INTO closeStream,
    // positioned BEFORE the `active` guard, so an error/abort close that lands
    // before a terminal run_completed/run_failed event still can't leave a
    // stale turnId. This is the "no stale entries" invariant, now enforced at
    // the single close exit instead of only the happy terminal path.
    assert.match(
      runtimeSrc,
      /const closeStream = \(extra[^)]*\) => \{[\s\S]{0,1400}?activeCodexTurns\.delete\(sessionId\);[\s\S]{0,120}?if \(!active\) return;/,
    );
  });

  it('terminal run_completed | run_failed routes cleanup through closeStream() (no inline delete)', () => {
    // Terminal event must call closeStream() (which owns the cleanup); it must
    // NOT carry its own activeCodexTurns.delete anymore — that would re-fork
    // the cleanup the way A4 just consolidated.
    const terminalBranch = runtimeSrc.match(
      /event\?\.type\s*===\s*'run_completed'\s*\|\|\s*event\?\.type\s*===\s*'run_failed'\)\s*\{[\s\S]{0,500}?\n\s*\}/,
    );
    assert.ok(terminalBranch, 'expected the terminal-event branch in runtime.ts');
    assert.match(terminalBranch![0], /closeStream\(\);/);
    assert.doesNotMatch(
      terminalBranch![0],
      /activeCodexTurns\.delete/,
      'terminal branch should delegate cleanup to closeStream, not delete inline (A4 single-exit)',
    );
  });

  it('error catch path closes via closeStream so a throw after turn/start cleans up the entry', () => {
    // turn registered (activeCodexTurns.set) → throw before a terminal event →
    // catch → closeStream({ error }) → entry deleted. This is the exact
    // residual A4 set out to close.
    assert.match(
      runtimeSrc,
      /\}\s*catch\s*\(err\)\s*\{[\s\S]{0,200}closeStream\(\{\s*error:\s*reason\s*\}\)/,
    );
  });
});

describe('Codex interrupt — shared helper (single implementation)', () => {
  it('aborts the HMR-safe parent controller and protects a newer owner from stale cleanup', () => {
    const oldController = new AbortController();
    const cleanupOld = registerCodexTurnAbortController('session-abort', oldController);
    const currentController = new AbortController();
    const cleanupCurrent = registerCodexTurnAbortController('session-abort', currentController);

    cleanupOld();
    assert.equal(abortCodexTurnController('session-abort'), true);
    assert.equal(oldController.signal.aborted, false);
    assert.equal(currentController.signal.aborted, true);

    cleanupCurrent();
    assert.equal(abortCodexTurnController('session-abort'), false);
  });

  it('sends the exact app-server turn/interrupt payload', async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    await requestCodexTurnInterrupt({
      async request(method, params) {
        calls.push({ method, params });
        return {};
      },
    }, {
      threadId: 'thread-wire',
      turnId: 'turn-wire',
    });
    assert.deepEqual(calls, [{
      method: 'turn/interrupt',
      params: { threadId: 'thread-wire', turnId: 'turn-wire' },
    }]);
  });

  it('issueCodexTurnInterrupt delegates registry lookup and wire request', () => {
    assert.match(
      runtimeSrc,
      /function issueCodexTurnInterrupt\(sessionId: string, source: string\): boolean[\s\S]{0,300}activeCodexTurns\.issue\(sessionId/,
    );
    assert.match(
      runtimeSrc,
      /function issueCodexTurnInterrupt[\s\S]{0,500}requestCodexTurnInterrupt\(client, active\)/,
    );
  });

  it('issueCodexTurnInterrupt preserves the no-active false result', () => {
    assert.match(
      runtimeSrc,
      /function issueCodexTurnInterrupt[\s\S]{0,700}return issued/,
    );
  });

  it('public interrupt(sessionId) delegates to the shared helper (no duplicated impl)', () => {
    assert.match(
      runtimeSrc,
      /interrupt\(sessionId: string\): void \{[\s\S]{0,900}abortCodexTurnController\(sessionId\);[\s\S]{0,200}issueCodexTurnInterrupt\(sessionId, 'route'\)/,
    );
  });
});

describe('Codex stream() honors the abort signal (codex-stop-recovery Phase 2)', () => {
  it('reads options.abortController.signal and bails before turn/start if already aborted', () => {
    assert.match(
      runtimeSrc,
      /registerCodexTurnAbortController\(\s*sessionId,\s*options\.abortController/,
      'Stop must be able to abort a parent blocked inside a dynamic tool request',
    );
    assert.match(
      runtimeSrc,
      /const parentAbortSignal = options\.abortController\?\.signal;/,
      'the parent chat turn owns the authoritative cancellation signal',
    );
    assert.match(
      runtimeSrc,
      /const abortSignal = parentAbortSignal;[\s\S]{0,300}if\s*\(abortSignal\?\.aborted\)\s*\{[\s\S]{0,200}closeStream\(\);[\s\S]{0,60}return/,
    );
  });

  it('an abort during the turn interrupts via the shared helper', () => {
    assert.match(
      runtimeSrc,
      /onAbort = \(\) => \{[\s\S]{0,200}issueCodexTurnInterrupt\(sessionId, 'abort-signal'\)/,
    );
    assert.match(
      runtimeSrc,
      /abortSignal\.addEventListener\('abort',\s*onAbort/,
    );
  });

  it('abort-before-turnId race re-interrupts the moment the turnId is recorded', () => {
    assert.match(
      runtimeSrc,
      /activeCodexTurns\.set\(sessionId[\s\S]{0,300}if\s*\(pendingAbort\)\s*\{[\s\S]{0,200}issueCodexTurnInterrupt\(sessionId, 'abort-race'\)/,
    );
  });
});
