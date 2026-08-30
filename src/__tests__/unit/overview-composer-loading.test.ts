/**
 * P0.4 (2026-06-01) — Settings/Chat loading must not be held by background
 * model-catalog work.
 *
 *  - MessageInput composer: "正在准备运行环境…" should only show during the
 *    genuine first load, NOT on a background refetch once a sendable model
 *    is already resolved (isComposerProviderLoading).
 *  - Settings Overview: the unbounded per-provider `?all=1` manual-count
 *    deep fetch must run AFTER the first paint, so the core + inventory
 *    cards aren't held by a long provider list.
 *
 * See docs/preview/packaged-preview-p0-diagnosis-2026-06-01.md
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isComposerProviderLoading } from '@/hooks/useProviderModels';

describe('isComposerProviderLoading — composer "preparing runtime" gate (P0.4 item 6)', () => {
  it('shows "preparing" during the genuine first load (idle + no resolved model)', () => {
    assert.equal(isComposerProviderLoading('idle', false), true);
  });

  it('does NOT show "preparing" on a background refetch once a model is resolved', () => {
    // provider-changed / runtime switch resets fetchState to 'idle' but keeps
    // the prior providerGroups → a sendable model is still resolved.
    assert.equal(isComposerProviderLoading('idle', true), false);
  });

  it('never shows "preparing" once the feed has loaded', () => {
    assert.equal(isComposerProviderLoading('loaded', false), false);
    assert.equal(isComposerProviderLoading('loaded', true), false);
  });

  it('never shows "preparing" on failure (catch branch synthesised an env fallback)', () => {
    assert.equal(isComposerProviderLoading('failed', false), false);
    assert.equal(isComposerProviderLoading('failed', true), false);
  });
});

describe('useOverviewData — deferred per-provider counts (P0.4 item 5, source pin)', () => {
  const overviewSrc = fs.readFileSync(
    path.resolve(__dirname, '../../components/settings/useOverviewData.ts'),
    'utf8',
  );

  it('emits the first paint (setState) BEFORE the per-provider deep-fetch loop', () => {
    // The per-provider loop is the only unbounded-N work in the hook; it must
    // not block the core + inventory cards' first render. Anchor on the loop's
    // `dbGroupsToCount.map(` (phase-2 only) — `?all=1` also appears in a comment.
    const firstPaint = overviewSrc.indexOf('setState(next)');
    const perProviderLoop = overviewSrc.indexOf('dbGroupsToCount.map(');
    assert.notEqual(firstPaint, -1, 'expected a first-paint setState(next)');
    assert.notEqual(perProviderLoop, -1, 'expected the deferred per-provider manual-count loop');
    assert.ok(
      firstPaint < perProviderLoop,
      'the core/inventory first paint must precede the per-provider manual-count deep fetch',
    );
  });

  it('patches manual counts via a follow-up setState after the deep fetch', () => {
    assert.match(
      overviewSrc,
      /setState\(\(prev\) => \(\{ \.\.\.prev, modelsManualEnabled:/,
      'manual counts must land via a follow-up patch, not block the first paint',
    );
  });
});
