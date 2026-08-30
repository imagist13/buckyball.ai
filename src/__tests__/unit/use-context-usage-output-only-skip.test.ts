/**
 * use-context-usage-output-only-skip.test.ts — contract for
 * walkContextUsage's baseline + SDK context_window preservation rules.
 *
 * The behavioral piece — message walk, baseline picking,
 * latestSdkContextWindow capture — has its own behavioral test
 * (`context-usage-walk.test.ts`). This file locks the *contracts*:
 *
 *   • The walk helper captures latestSdkContextWindow newest-wins.
 *   • All-zero records (used=0 && output=0) are skipped (no signal).
 *   • The hook actually consumes the helper (so a future "let's
 *     inline this back" refactor doesn't silently drop the helper's
 *     guarantees while leaving the test passing).
 *   • The hook resolves contextWindow with the documented priority
 *     chain: baseline.context_window → latestSdkContextWindow →
 *     catalogContextWindow.
 *
 * Background:
 *   2026-05-08 regression #1: output-only tail records zeroed `used`.
 *   2026-05-08 regression #2: skipping those records also dropped their
 *     authoritative `context_window`, sending GLM / Bailian / etc.
 *     back to "capacity unknown."
 *   2026-05-20 (Phase 7): the unconditional output-only skip from #1
 *     turned out to also break Native + Codex via provider proxies
 *     that report input_tokens=0 reliably — they had no baseline at
 *     all and popover was empty. New rule: output-only records become
 *     a WEAK baseline (used=0) when no STRONG baseline exists, so the
 *     popover at least surfaces capacity + breakdown. ClaudeCode's
 *     mid-stream output-only case is preserved by walking from the end
 *     — strong baseline always wins if present.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.join(__dirname, '..', '..');

describe('context-usage-walk — baseline + context_window preservation', () => {
  const src = fs.readFileSync(
    path.join(repoRoot, 'lib/context-usage-walk.ts'),
    'utf8',
  );

  it('strong baseline (used>0) returns immediately so prior input/cache wins over later output-only records (regression #1, 2026-05-08)', () => {
    // ClaudeCode mid-stream often has a tail output-only record; if the
    // walk took THAT as the baseline, used would zero out the popover.
    // Walking from end + returning on first used>0 keeps the prior
    // turn's input+cache as the authoritative baseline.
    assert.match(
      src,
      /if\s*\(\s*used\s*>\s*0\s*\)[\s\S]{0,400}return\s*\{/,
      'walkContextUsage must return immediately on used > 0 (strong baseline) so a later output-only tail does not silently zero used',
    );
  });

  it('all-zero records skipped (no context signal at all)', () => {
    assert.match(
      src,
      /used\s*===\s*0\s*&&\s*outputTokens\s*===\s*0[\s\S]{0,40}continue/,
      'walkContextUsage must skip all-zero records — they have no context signal at all',
    );
  });

  it('output-only records become weak baseline when no strong baseline exists (Phase 7 fix, 2026-05-20)', () => {
    // Provider proxies (Codex+GLM, Native+OpenRouter) report
    // input_tokens=0 every turn — pre-Phase-7 this made baseline=null
    // and popover empty. Now we remember the FIRST output-only record
    // (newest, since we walk from end) and use it if no strong
    // baseline exists. Strong baseline still wins when present.
    assert.match(
      src,
      /weakBaseline/,
      'walkContextUsage must declare a weakBaseline that captures output-only records as a fallback',
    );
    assert.match(
      src,
      /baseline:\s*weakBaseline/,
      'walkContextUsage must return baseline: weakBaseline when no strong baseline was found',
    );
  });

  it('walks from the end (newest meaningful record wins)', () => {
    assert.match(
      src,
      /for\s*\(\s*let\s+i\s*=\s*messages\.length\s*-\s*1\s*;\s*i\s*>=\s*0\s*;\s*i--\s*\)/,
      'walkContextUsage must walk messages from the end so the newest meaningful token_usage wins',
    );
  });

  it('captures latestSdkContextWindow BEFORE deciding to skip / return (regression #2, 2026-05-08)', () => {
    // The bug we're guarding against: pre-fix, the loop did
    //   if (output-only) continue;
    //   captureContextWindow();
    // — which meant tail output-only records with positive
    // context_window dropped that capacity on the floor.
    // Post-fix shape: the capture (latestSdkContextWindow assignment)
    // must appear textually BEFORE the all-zero skip predicate AND
    // before the strong-baseline return.
    const captureIdx = src.search(/latestSdkContextWindow\s*=\s*[^=]/);
    const skipIdx = src.search(/used\s*===\s*0\s*&&\s*outputTokens\s*===\s*0[\s\S]{0,40}continue/);
    const returnIdx = src.search(/if\s*\(\s*used\s*>\s*0\s*\)[\s\S]{0,400}return\s*\{/);
    assert.ok(captureIdx >= 0, 'expected a `latestSdkContextWindow = …` assignment');
    assert.ok(skipIdx >= 0, 'expected the all-zero skip predicate');
    assert.ok(returnIdx >= 0, 'expected the strong-baseline return');
    assert.ok(
      captureIdx < skipIdx,
      `latestSdkContextWindow capture must precede the all-zero skip — captureIdx=${captureIdx}, skipIdx=${skipIdx}`,
    );
    assert.ok(
      captureIdx < returnIdx,
      `latestSdkContextWindow capture must precede the strong-baseline return — captureIdx=${captureIdx}, returnIdx=${returnIdx}`,
    );
  });

  it('only sets latestSdkContextWindow on the FIRST positive value (newest wins; older zero/missing must not overwrite)', () => {
    // Two requirements:
    //   • `latestSdkContextWindow === null` guard (newest wins)
    //   • `> 0` guard (stale zero must not capture)
    // Both must appear inside the same capture block. We loosen the
    // anchor to allow intermediate type checks (`typeof … === 'number'`).
    assert.match(
      src,
      /latestSdkContextWindow\s*===\s*null/,
      'walkContextUsage must guard the capture with `latestSdkContextWindow === null` so older records can\'t overwrite a captured value',
    );
    assert.match(
      src,
      /context_window[\s\S]{0,200}>\s*0|>\s*0[\s\S]{0,200}latestSdkContextWindow\s*=/,
      'walkContextUsage must require `context_window > 0` before capturing — a stale zero from a partial adapter must not blank out a captured value',
    );
  });
});

describe('useContextUsage — wiring contract', () => {
  const src = fs.readFileSync(
    path.join(repoRoot, 'hooks/useContextUsage.ts'),
    'utf8',
  );

  it('imports walkContextUsage from the helper module', () => {
    assert.match(
      src,
      /import\s*\{\s*walkContextUsage\s*\}\s*from\s*['\"]@\/lib\/context-usage-walk['\"]/,
      'useContextUsage must consume walkContextUsage so the skip + capacity-capture rules stay in one place',
    );
  });

  it('resolves contextWindow with the documented 3-way priority chain', () => {
    // Anchor the exact `??` order. Reordering would silently change
    // semantics — e.g. `latestSdkContextWindow ?? sdkContextWindow`
    // would prefer a transient tail value over the baseline turn's
    // own window in multi-model sessions.
    assert.match(
      src,
      /sdkContextWindow\s*\?\?\s*latestSdkContextWindow\s*\?\?\s*catalogContextWindow/,
      'useContextUsage must resolve contextWindow as `sdkContextWindow ?? latestSdkContextWindow ?? catalogContextWindow`',
    );
  });

  it('falls back to latestSdkContextWindow even when no baseline exists', () => {
    // The "first turn was output-only" case: baseline is null but we
    // still want to surface the capacity number the SDK gave us.
    assert.match(
      src,
      /contextWindow:\s*latestSdkContextWindow\s*\?\?\s*catalogContextWindow/,
      'useContextUsage no-baseline branch must still surface latestSdkContextWindow ?? catalogContextWindow so the popover header can show "0 / capacity" instead of "容量未知"',
    );
  });
});
