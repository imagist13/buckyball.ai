/**
 * Interrupt/phase reconcile — pure runtime_status → phase
 * reconciliation (d-reconcile-tests).
 *
 * Behavioral truth table, not a source-pin: `reconcilePhase` is the single seam
 * shared by the stop-convergence path (stream-session-manager) and the /chat/[id]
 * mount reconcile (page.tsx). Its mapping must actually hold at runtime so both
 * sites converge the client phase toward the authoritative backend runtime_status
 * (I2) instead of drifting.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  runtimeStatusToPhase,
  reconcilePhase,
} from '../../lib/stream-phase-reconcile';

describe('runtimeStatusToPhase — canonical backend status → client phase', () => {
  // The values here are exactly the ones written to
  // chat_sessions.runtime_status by setSessionRuntimeStatus call sites.
  const cases: Array<[string, ReturnType<typeof runtimeStatusToPhase>]> = [
    ['running', 'active'],
    ['waiting_permission', 'active'],
    ['idle', 'completed'],
    ['interrupted', 'stopped'],
    ['error', 'error'],
  ];
  for (const [status, phase] of cases) {
    it(`'${status}' → ${phase}`, () => {
      assert.equal(runtimeStatusToPhase(status), phase);
    });
  }

  it('unrecognized / empty / null → null (nothing authoritative to act on)', () => {
    assert.equal(runtimeStatusToPhase('something-else'), null);
    assert.equal(runtimeStatusToPhase(''), null);
    assert.equal(runtimeStatusToPhase(null), null);
    assert.equal(runtimeStatusToPhase(undefined), null);
  });
});

describe('reconcilePhase — drift correction truth table', () => {
  // Full grid: each real runtime_status × each client phase → expected result.
  // null means "no correction" (unknown status, or already consistent).
  const RUNTIME = ['running', 'waiting_permission', 'idle', 'interrupted', 'error', 'bogus', ''] as const;
  const PHASES = ['active', 'completed', 'stopped', 'error', null] as const;

  const expected: Record<string, (phase: string | null) => string | null> = {
    running: (p) => (p === 'active' ? null : 'active'),
    waiting_permission: (p) => (p === 'active' ? null : 'active'),
    idle: (p) => (p === 'completed' ? null : 'completed'),
    interrupted: (p) => (p === 'stopped' ? null : 'stopped'),
    error: (p) => (p === 'error' ? null : 'error'),
    bogus: () => null,
    '': () => null,
  };

  for (const status of RUNTIME) {
    for (const phase of PHASES) {
      const want = expected[status](phase);
      it(`(${status || 'empty'} × ${phase ?? 'none'}) → ${want ?? 'null'}`, () => {
        assert.equal(reconcilePhase(status, phase), want);
      });
    }
  }

  it('the primary I2/I4 fix: backend terminal while client stuck active → converge', () => {
    // interrupted/idle/error while the client snapshot is stuck 'active' — the
    // exact "假 active" split that locks the composer.
    assert.equal(reconcilePhase('interrupted', 'active'), 'stopped');
    assert.equal(reconcilePhase('idle', 'active'), 'completed');
    assert.equal(reconcilePhase('error', 'active'), 'error');
  });

  it('never spuriously corrects a consistent state', () => {
    assert.equal(reconcilePhase('running', 'active'), null);
    assert.equal(reconcilePhase('idle', 'completed'), null);
    assert.equal(reconcilePhase('interrupted', 'stopped'), null);
    assert.equal(reconcilePhase('error', 'error'), null);
  });
});
