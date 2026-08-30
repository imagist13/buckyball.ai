/**
 * context-usage-walk.test.ts — behavioral coverage for the pure walk
 * helper that powers `useContextUsage`.
 *
 * The two non-obvious rules under test (both with regression history,
 * see commit messages 2026-05-08):
 *
 *   1. Output-only / all-zero records must NOT zero the `used`
 *      baseline — the prior turn's input + cache is still the
 *      authoritative session-context number.
 *
 *   2. The `context_window` on those skipped records must STILL be
 *      preserved — the SDK populates it on every result, including
 *      output-only tails, and dropping it on the floor sends GLM /
 *      Bailian / MiniMax / Kimi / Volcengine / DeepSeek (catalog
 *      misses) back to "capacity unknown" in RunCockpit.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { walkContextUsage, type MinimalMessageForUsage } from '../../lib/context-usage-walk';

function asstUsage(usage: Record<string, number>): MinimalMessageForUsage {
  return { role: 'assistant', token_usage: JSON.stringify(usage) };
}

describe('walkContextUsage — baseline + capacity capture', () => {
  it('returns null baseline for an empty / no-usage list', () => {
    const r = walkContextUsage([]);
    assert.equal(r.baseline, null);
    assert.equal(r.latestSdkContextWindow, null);
  });

  it('skips user messages and assistant messages without token_usage', () => {
    const r = walkContextUsage([
      { role: 'user', token_usage: null },
      { role: 'assistant', token_usage: null },
    ]);
    assert.equal(r.baseline, null);
    assert.equal(r.latestSdkContextWindow, null);
  });

  it('uses a single meaningful record as baseline and surfaces its context_window', () => {
    const r = walkContextUsage([
      asstUsage({
        input_tokens: 18119,
        output_tokens: 47,
        cache_read_input_tokens: 2000,
        context_window: 200000,
      }),
    ]);
    assert.ok(r.baseline);
    assert.equal(r.baseline!.used, 18119 + 2000);
    assert.equal(r.baseline!.outputTokens, 47);
    assert.equal(r.baseline!.cacheReadTokens, 2000);
    assert.equal(r.baseline!.sdkContextWindow, 200000);
    assert.equal(r.latestSdkContextWindow, 200000);
  });

  it('the user-reported regression: latest output-only carries context_window, prior meaningful record lacks it', () => {
    // Reproduces the exact bf031… session symptom:
    //   • Newest message: { input:0, cache:0, output:812, context_window:200000 }
    //   • Prior message:  { input:18119, cache:0, output:47 } — NO context_window
    // Pre-fix behavior:
    //   • Used to read the output-only first → used=0 → context bar zeroed.
    //   • After 2026-05-08 fix #1: output-only skipped, but context_window
    //     dropped on the floor, so capacity fell to "unknown" (GLM etc.).
    // Expected behavior NOW:
    //   • baseline.used = 18119 (from the prior meaningful record).
    //   • contextWindow surfaced via latestSdkContextWindow = 200000.
    const r = walkContextUsage([
      asstUsage({ input_tokens: 18119, output_tokens: 47 }),
      asstUsage({ input_tokens: 0, output_tokens: 812, context_window: 200000 }),
    ]);
    assert.ok(r.baseline);
    assert.equal(r.baseline!.used, 18119, 'used must come from the prior meaningful record');
    assert.equal(r.baseline!.outputTokens, 47, 'outputTokens must come from the same baseline record (NOT the latest output-only one)');
    assert.equal(r.baseline!.sdkContextWindow, null, 'baseline record had no context_window of its own');
    assert.equal(r.latestSdkContextWindow, 200000, 'output-only tail\'s context_window must be preserved as latestSdkContextWindow so the hook can fall back to it');
  });

  it('baseline that DOES carry its own context_window still records latestSdkContextWindow (newest wins via walk order)', () => {
    // Multi-turn session where capacity hasn't changed turn-over-turn.
    // The baseline's own context_window == latestSdkContextWindow, but
    // we confirm both flow through so a future multi-model session
    // (where capacity could differ) still sees the freshest value
    // first.
    const r = walkContextUsage([
      asstUsage({ input_tokens: 5000, output_tokens: 100, context_window: 200000 }),
      asstUsage({ input_tokens: 18000, output_tokens: 47, context_window: 200000 }),
      asstUsage({ input_tokens: 0, output_tokens: 800, context_window: 200000 }),
    ]);
    assert.ok(r.baseline);
    assert.equal(r.baseline!.used, 18000);
    assert.equal(r.baseline!.sdkContextWindow, 200000);
    assert.equal(r.latestSdkContextWindow, 200000);
  });

  it('skips trailing output-only AND all-zero records when picking baseline', () => {
    const r = walkContextUsage([
      asstUsage({ input_tokens: 9000, output_tokens: 50 }),
      asstUsage({ input_tokens: 0, output_tokens: 0 }), // all-zero noise
      asstUsage({ input_tokens: 0, output_tokens: 200 }), // output-only
    ]);
    assert.ok(r.baseline);
    assert.equal(r.baseline!.used, 9000);
    assert.equal(r.baseline!.outputTokens, 50);
  });

  it('output-only-only session: surfaces weak baseline (used=0) so popover still renders', () => {
    // Updated 2026-05-20: previously this returned baseline=null. But
    // Native+Codex via provider proxies (Codex+GLM, agent-loop+OpenRouter)
    // consistently report input_tokens=0 on every turn — the old null
    // baseline meant their popovers were completely empty (user report:
    // "Native + Codex 连使用了多少都不显示"). New behavior: if every
    // record is output-only, return the newest as a weak baseline with
    // used=0; the popover then shows capacity + breakdown (just no
    // input-tokens ratio).
    const r = walkContextUsage([
      asstUsage({ input_tokens: 0, output_tokens: 800, context_window: 128000 }),
    ]);
    assert.ok(r.baseline, 'output-only record should become weak baseline');
    assert.equal(r.baseline!.used, 0);
    assert.equal(r.baseline!.outputTokens, 800);
    assert.equal(r.baseline!.sdkContextWindow, 128000);
    assert.equal(r.latestSdkContextWindow, 128000);
  });

  it('weak baseline fallback: surfaces context_accounting even when input=0 (Native/Codex regression)', () => {
    // Native + Codex via provider proxies report input_tokens=0 reliably.
    // The walk must still surface their context_accounting snapshot so
    // the popover can render the breakdown (skills/mcp/tools rows).
    const r = walkContextUsage([
      {
        role: 'assistant',
        token_usage: JSON.stringify({
          input_tokens: 0,
          output_tokens: 2552,
          context_accounting: {
            entries: { rules: { tokens: 93, source: 'workspace/CLAUDE.md' } },
            unsupported: ['system_prompt', 'memory', 'files_attachments'],
            producedBy: 'codepilot_runtime',
          },
        }),
      },
    ]);
    assert.ok(r.baseline);
    assert.equal(r.baseline!.used, 0);
    assert.equal(r.baseline!.outputTokens, 2552);
    assert.ok(r.contextAccounting, 'context_accounting must be captured from weak baseline');
    assert.equal(r.contextAccounting!.producedBy, 'codepilot_runtime');
  });

  it('positive context_window only — zero / missing context_window must NOT overwrite a previously captured positive value', () => {
    // Walking from the end: we set latestSdkContextWindow on the FIRST
    // positive value. Older records' missing / zero context_window
    // must not blank it out.
    const r = walkContextUsage([
      asstUsage({ input_tokens: 100, output_tokens: 10 }), // older, no window
      asstUsage({ input_tokens: 200, output_tokens: 20, context_window: 0 }), // zero, ignored
      asstUsage({ input_tokens: 0, output_tokens: 50, context_window: 200000 }), // newest, sets it
    ]);
    assert.equal(r.latestSdkContextWindow, 200000);
    assert.ok(r.baseline);
    assert.equal(r.baseline!.used, 200, 'baseline picks first non-output-only walking from end');
  });

  it('malformed token_usage JSON is skipped without throwing', () => {
    const r = walkContextUsage([
      asstUsage({ input_tokens: 7000, output_tokens: 50 }),
      { role: 'assistant', token_usage: '{not valid json' },
    ]);
    assert.ok(r.baseline);
    assert.equal(r.baseline!.used, 7000);
  });
});
