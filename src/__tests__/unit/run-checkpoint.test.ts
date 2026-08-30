/**
 * Unit tests for the Run Checkpoint trust-layer builder.
 *
 * Coverage: all four active reasons (no-compatible-provider /
 * pinned-invalid / runtime-fallback from Round 1; context-cost-change
 * from Round 2) plus the precedence rule
 * (no-provider supersedes the others, since "your pin is wrong" is
 * meaningless when there's no provider to send to in the first place).
 *
 * Run with: npx tsx --test src/__tests__/unit/run-checkpoint.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCheckpoints,
  shouldTriggerContextCost,
  CONTEXT_COST_PENDING_HARD,
  type BuildCheckpointsOpts,
} from '../../lib/run-checkpoint';

const ok: BuildCheckpointsOpts = {
  noCompatibleProvider: false,
  defaultInvalid: false,
  runtimeFallback: false,
};

describe('buildCheckpoints — happy path', () => {
  it('returns [] when nothing is wrong', () => {
    assert.deepEqual(buildCheckpoints(ok), []);
  });
});

describe('buildCheckpoints — no-compatible-provider precedence', () => {
  it('emits only the no-provider reason even if other flags are set', () => {
    const out = buildCheckpoints({
      noCompatibleProvider: true,
      defaultInvalid: true,
      runtimeFallback: true,
    });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'no-compatible-provider');
    assert.equal(out[0].tone, 'error');
    assert.equal(out[0].action?.href, '/settings/providers');
  });

  it('uses the providers settings route, not runtime, for the action', () => {
    const out = buildCheckpoints({ ...ok, noCompatibleProvider: true });
    assert.equal(out[0].action?.href, '/settings/providers');
  });
});

describe('buildCheckpoints — pinned-invalid', () => {
  it('emits the pinned-invalid reason when defaultInvalid is true', () => {
    const out = buildCheckpoints({ ...ok, defaultInvalid: true });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'pinned-invalid');
    // Phase 6 UI收口 P0 (2026-05-14) — pinned-invalid is a non-blocking
    // warning, not an error. The composer no longer blocks when the
    // current selected (provider, model, runtime) is sendable — the
    // banner just informs the user that their *default-model* pin is
    // in a degraded state. Tone reflects that.
    assert.equal(out[0].tone, 'warning');
    // Phase 6 UI收口 fix-up (2026-05-14) — the primary action is
    // "Change default" (not "Fix runtime"); jump target is
    // /settings/models where the pinned-default is set, not
    // /settings/runtime which was a leftover from when the banner
    // suggested switching engines as a recovery.
    assert.equal(out[0].action?.href, '/settings/models');
  });

  it('renders a {pinned} placeholder when no descriptor is provided', () => {
    const out = buildCheckpoints({ ...ok, defaultInvalid: true });
    assert.equal(out[0].descriptionValues?.pinned, '?');
  });

  it('passes the supplied descriptor through to the description', () => {
    const out = buildCheckpoints({
      ...ok,
      defaultInvalid: true,
      pinnedDescriptor: 'Anthropic / sonnet-4-5',
    });
    assert.equal(out[0].descriptionValues?.pinned, 'Anthropic / sonnet-4-5');
  });
});

describe('buildCheckpoints — runtime-fallback', () => {
  it('emits the runtime-fallback reason as warning, not error', () => {
    const out = buildCheckpoints({ ...ok, runtimeFallback: true });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'runtime-fallback');
    assert.equal(out[0].tone, 'warning');
    assert.equal(out[0].action?.href, '/settings/runtime');
  });
});

describe('buildCheckpoints — stacking', () => {
  it('stacks pinned-invalid + runtime-fallback when both apply', () => {
    const out = buildCheckpoints({
      ...ok,
      defaultInvalid: true,
      runtimeFallback: true,
      pinnedDescriptor: 'OpenRouter / gpt-5',
    });
    assert.equal(out.length, 2);
    // Pinned first (more blocking), runtime fallback after.
    assert.equal(out[0].id, 'pinned-invalid');
    assert.equal(out[1].id, 'runtime-fallback');
  });
});

describe('buildCheckpoints — Round 1 + 2 scope guard', () => {
  // The active reason set is exactly the four below. If a future
  // commit adds `dangerous-tool-call` (Round 3) — or any new id — to
  // the builder, this test will fail and force the author to confirm
  // the new round has been formally started (plan + i18n + state
  // wiring + e2e all in place). permission-elevation was removed
  // 2026-06-02 (full-access is confirmed once at toggle time, not per send).
  it('only emits the four known reason ids', () => {
    const seen = new Set<string>();
    for (const opts of [
      { ...ok, noCompatibleProvider: true },
      { ...ok, defaultInvalid: true },
      { ...ok, runtimeFallback: true },
      { ...ok, defaultInvalid: true, runtimeFallback: true },
      { ...ok, pendingContextTokens: 50_000, usedContextTokens: 0 },
    ]) {
      for (const r of buildCheckpoints(opts)) {
        seen.add(r.id);
      }
    }
    assert.deepEqual(
      [...seen].sort(),
      [
        'context-cost-change',
        'no-compatible-provider',
        'pinned-invalid',
        'runtime-fallback',
      ].sort(),
    );
  });

  it('each reason has at most one well-formed action — single-action plan §B', () => {
    for (const opts of [
      { ...ok, noCompatibleProvider: true },
      { ...ok, defaultInvalid: true },
      { ...ok, runtimeFallback: true },
      { ...ok, pendingContextTokens: 12_000, usedContextTokens: 0 },
    ]) {
      for (const r of buildCheckpoints(opts)) {
        // context-cost-change is a NON-BLOCKING info heads-up with NO action
        // (#632 / Phase 2 — an estimated context size must not force a confirm).
        if (r.id === 'context-cost-change') {
          assert.equal(r.action, undefined, 'context-cost is info-only; must carry no action');
          continue;
        }
        // The remaining (Round 1) reasons each carry exactly one action,
        // either a navigation (href + actionId) or a confirm (actionId only).
        assert.ok(r.action, `${r.id} must have an action`);
        assert.ok(
          r.action?.href || r.action?.onClick || r.action?.actionId,
          `${r.id} must have href / onClick / actionId`,
        );
      }
    }
  });
});

// ─── Round 2 — context-cost-change ──────────────────────────────────

describe('shouldTriggerContextCost', () => {
  it('returns true when pending crosses the hard 10K cap regardless of used', () => {
    assert.equal(shouldTriggerContextCost(CONTEXT_COST_PENDING_HARD, 0), true);
    assert.equal(shouldTriggerContextCost(15_000, 1_000_000), true);
  });

  it('returns false when pending is below 10K AND used is 0', () => {
    assert.equal(shouldTriggerContextCost(0, 0), false);
    assert.equal(shouldTriggerContextCost(9_999, 0), false);
  });

  it('returns true when pending / used >= 30% (with used > 0)', () => {
    assert.equal(shouldTriggerContextCost(3_000, 10_000), true);  // 30% exact
    assert.equal(shouldTriggerContextCost(5_000, 10_000), true);  // 50%
  });

  it('returns false when pending / used < 30%', () => {
    assert.equal(shouldTriggerContextCost(2_999, 10_000), false); // 29.99%
    assert.equal(shouldTriggerContextCost(1_000, 10_000), false); // 10%
  });

  it('the 10K hard cap takes precedence over the ratio for tiny used', () => {
    // pending=10K, used=1 → ratio is huge but hard-cap fires first
    assert.equal(shouldTriggerContextCost(10_000, 1), true);
  });
});

describe('buildCheckpoints — context-cost-change reason', () => {
  it('emits an info-toned, NON-blocking heads-up — no requiresConfirm, no confirm action (#632 / Phase 2)', () => {
    const reasons = buildCheckpoints({ ...ok, pendingContextTokens: 12_000, usedContextTokens: 0 });
    const r = reasons.find((x) => x.id === 'context-cost-change');
    assert.ok(r, 'context-cost reason should still fire as info');
    assert.equal(r!.tone, 'info');
    // #632 / Phase 2: an ESTIMATED context size must not block a non-destructive,
    // user-initiated send. It must NOT require confirm and must NOT carry a
    // confirm action (so it never enters blockingReasonIds; image/file
    // attachments send on the first Enter).
    assert.notEqual(r!.requiresConfirm, true);
    assert.equal(r!.action, undefined);
    // descriptionValues still carries human-formatted token counts
    assert.equal(r!.descriptionValues?.pending, '12K');
    assert.equal(r!.descriptionValues?.used, '0');
  });

  it('does NOT emit when below trigger thresholds', () => {
    const reasons = buildCheckpoints({ ...ok, pendingContextTokens: 5_000, usedContextTokens: 0 });
    assert.equal(reasons.find((x) => x.id === 'context-cost-change'), undefined);
  });

  it('formats large used counts in K', () => {
    const reasons = buildCheckpoints({ ...ok, pendingContextTokens: 3_500, usedContextTokens: 10_000 });
    const r = reasons.find((x) => x.id === 'context-cost-change')!;
    assert.equal(r.descriptionValues?.used, '10K');
  });
});

// ─── Round 2 — stacking with Round 1 ────────────────────────────────

describe('buildCheckpoints — Round 1 + 2 stacking', () => {
  it('runtime-fallback + context-cost stack together', () => {
    const reasons = buildCheckpoints({
      ...ok,
      runtimeFallback: true,
      pendingContextTokens: 12_000,
      usedContextTokens: 0,
    });
    const ids = reasons.map((r) => r.id);
    assert.ok(ids.includes('runtime-fallback'));
    assert.ok(ids.includes('context-cost-change'));
  });

  it('no-compatible-provider still suppresses Round 2 reasons (precedence)', () => {
    const reasons = buildCheckpoints({
      ...ok,
      noCompatibleProvider: true,
      pendingContextTokens: 50_000,
    });
    assert.equal(reasons.length, 1);
    assert.equal(reasons[0].id, 'no-compatible-provider');
  });
});
