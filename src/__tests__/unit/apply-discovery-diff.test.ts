/**
 * Tests for applyDiscoveryDiff — the DB-side commit step of the model
 * discovery flow. Critical invariants:
 *
 *   - Pristine rows (recommended/discovered/catalog) MAY flip enabled state
 *     based on the new isRecommended verdict (catalog can change between
 *     refreshes — e.g. blacklist tightening).
 *   - Rows where the user has explicitly chosen (manual_enabled or
 *     manual_hidden, OR legacy user_edited=1) MUST NEVER have their
 *     enabled / enable_source touched. Only upstream_model_id +
 *     last_refreshed_at update.
 *   - New rows land with enabled=isRecommended(id), enable_source set
 *     accordingly (recommended or discovered).
 *   - Counter return values match what was actually written so the toast
 *     message can quote them.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyDiscoveryDiff,
  getAllModelsForProvider,
  upsertProviderModel,
  updateProviderModelUserFields,
  createProvider,
  deleteProvider,
  getAllProviders,
} from '../../lib/db';

const TEST_PROVIDER_PREFIX = '__test_apply_diff_';

function createScratchProvider(): string {
  const p = createProvider({
    name: `${TEST_PROVIDER_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    provider_type: 'anthropic',
    protocol: 'anthropic',
    base_url: 'https://api.test-apply-diff.com',
    api_key: 'sk-test',
    extra_env: '{}',
  });
  return p.id;
}

function cleanup() {
  for (const p of getAllProviders()) {
    if (p.name.startsWith(TEST_PROVIDER_PREFIX)) deleteProvider(p.id);
  }
}

describe('applyDiscoveryDiff', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('inserts brand-new rows enabled=true when isRecommended returns true', () => {
    const providerId = createScratchProvider();
    const stats = applyDiscoveryDiff(
      providerId,
      [{ modelId: 'sonnet', upstreamModelId: 'claude-sonnet-4' }],
      () => true,
    );

    assert.equal(stats.inserted, 1);
    assert.equal(stats.recommendedEnabled, 1);
    assert.equal(stats.discoveredHidden, 0);

    const rows = getAllModelsForProvider(providerId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].enabled, 1);
    assert.equal(rows[0].enable_source, 'recommended');
  });

  it('inserts brand-new rows enabled=false when isRecommended returns false', () => {
    const providerId = createScratchProvider();
    const stats = applyDiscoveryDiff(
      providerId,
      [{ modelId: 'something-weird', upstreamModelId: 'something-weird' }],
      () => false,
    );

    assert.equal(stats.inserted, 1);
    assert.equal(stats.recommendedEnabled, 0);
    assert.equal(stats.discoveredHidden, 1);

    const rows = getAllModelsForProvider(providerId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].enabled, 0);
    assert.equal(rows[0].enable_source, 'discovered');
  });

  it('NEVER touches manual_enabled rows on refresh — even if isRecommended now says false', () => {
    const providerId = createScratchProvider();
    // Seed: row exists, user toggled it on explicitly
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'opus',
      upstream_model_id: 'claude-opus',
      display_name: 'Opus (renamed by user)',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 0,
      enabled: 1,
      source: 'api',
      last_refreshed_at: '2026-01-01 00:00:00',
      user_edited: 0,
      enable_source: 'manual_enabled',
    });

    // Refresh: catalog now says "not recommended" (e.g. it was blacklisted).
    const stats = applyDiscoveryDiff(
      providerId,
      [{ modelId: 'opus', upstreamModelId: 'claude-opus-v2' }],
      () => false, // says NO — but we should ignore this
    );

    assert.equal(stats.inserted, 0);
    assert.equal(stats.refreshedPreserved, 1);
    assert.equal(stats.refreshedPristine, 0);

    const rows = getAllModelsForProvider(providerId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].enabled, 1, 'manual_enabled row must stay enabled');
    assert.equal(rows[0].enable_source, 'manual_enabled', 'enable_source must not be downgraded');
    assert.equal(rows[0].display_name, 'Opus (renamed by user)', 'user-renamed display_name preserved');
    assert.equal(rows[0].upstream_model_id, 'claude-opus-v2', 'upstream id should advance');
  });

  it('NEVER re-enables manual_hidden rows on refresh', () => {
    const providerId = createScratchProvider();
    // User explicitly hid this row
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'sonnet',
      upstream_model_id: 'claude-sonnet',
      display_name: 'sonnet',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 0,
      enabled: 0,
      source: 'api',
      last_refreshed_at: '2026-01-01 00:00:00',
      user_edited: 0,
      enable_source: 'manual_hidden',
    });

    // Refresh says "recommended" — must still leave the row hidden
    const stats = applyDiscoveryDiff(
      providerId,
      [{ modelId: 'sonnet', upstreamModelId: 'claude-sonnet' }],
      () => true,
    );

    assert.equal(stats.refreshedPreserved, 1);
    assert.equal(stats.recommendedEnabled, 0, 'manual_hidden does not count toward recommendedEnabled');

    const rows = getAllModelsForProvider(providerId);
    assert.equal(rows[0].enabled, 0, 'manual_hidden row must stay hidden');
    assert.equal(rows[0].enable_source, 'manual_hidden');
  });

  it('re-evaluates pristine (recommended/discovered) rows against new verdict', () => {
    const providerId = createScratchProvider();
    // Seed: previously discovered as recommended
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'gpt-4o',
      upstream_model_id: 'gpt-4o',
      display_name: 'gpt-4o',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 0,
      enabled: 1,
      source: 'api',
      last_refreshed_at: '2026-01-01 00:00:00',
      user_edited: 0,
      enable_source: 'recommended',
    });

    // Refresh: catalog tightened, this is no longer recommended
    const stats = applyDiscoveryDiff(
      providerId,
      [{ modelId: 'gpt-4o', upstreamModelId: 'gpt-4o' }],
      () => false,
    );

    assert.equal(stats.refreshedPristine, 1);
    assert.equal(stats.refreshedPreserved, 0);
    assert.equal(stats.discoveredHidden, 0,
      'discoveredHidden counts INSERTS only — refreshes do not contribute');

    const rows = getAllModelsForProvider(providerId);
    assert.equal(rows[0].enabled, 0, 'recommended row flipped off after re-evaluation');
    assert.equal(rows[0].enable_source, 'discovered',
      'enable_source moves to discovered when recommendation flips off');
  });

  it('legacy user_edited=1 rows stay preserved even without an explicit manual_enabled marker', () => {
    const providerId = createScratchProvider();
    // Pre-Phase-B legacy row: user_edited=1 was the only signal.
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'haiku',
      upstream_model_id: 'claude-haiku',
      display_name: 'Haiku (custom)',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 0,
      enabled: 1,
      source: 'api',
      last_refreshed_at: '2026-01-01 00:00:00',
      user_edited: 1,
      enable_source: 'recommended', // legacy row - never migrated to manual_enabled
    });

    const stats = applyDiscoveryDiff(
      providerId,
      [{ modelId: 'haiku', upstreamModelId: 'claude-haiku' }],
      () => false,
    );

    assert.equal(stats.refreshedPreserved, 1);
    const rows = getAllModelsForProvider(providerId);
    assert.equal(rows[0].enabled, 1,
      'user_edited=1 must be honored as a hands-off signal even when enable_source predates the migration');
  });

  it('mixed batch — counts inserts, pristine flips, and preserved rows independently', () => {
    const providerId = createScratchProvider();
    // Seed: one user-touched (must preserve), one pristine (must flip)
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'opus',
      upstream_model_id: 'claude-opus',
      display_name: 'Opus',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 0,
      enabled: 1,
      source: 'api',
      last_refreshed_at: '2026-01-01 00:00:00',
      user_edited: 0,
      enable_source: 'manual_enabled',
    });
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'old-recommended',
      upstream_model_id: 'old-recommended',
      display_name: 'old-recommended',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 1,
      enabled: 1,
      source: 'api',
      last_refreshed_at: '2026-01-01 00:00:00',
      user_edited: 0,
      enable_source: 'recommended',
    });

    // isRecommended: opus=YES (no-op since user-touched), old-recommended=NO
    // (must flip), brand-new = YES, brand-new-blacklisted = NO
    const recommendedSet = new Set(['opus', 'brand-new']);
    const stats = applyDiscoveryDiff(
      providerId,
      [
        { modelId: 'opus', upstreamModelId: 'claude-opus' },
        { modelId: 'old-recommended', upstreamModelId: 'old-recommended' },
        { modelId: 'brand-new', upstreamModelId: 'brand-new' },
        { modelId: 'brand-new-blacklisted', upstreamModelId: 'brand-new-blacklisted' },
      ],
      (id) => recommendedSet.has(id),
    );

    assert.equal(stats.inserted, 2, 'two new rows inserted');
    assert.equal(stats.refreshedPristine, 1, 'one pristine row re-evaluated');
    assert.equal(stats.refreshedPreserved, 1, 'one user-touched row preserved');
    assert.equal(stats.recommendedEnabled, 1, 'one new row was recommended (brand-new)');
    assert.equal(stats.discoveredHidden, 1, 'one new row was hidden (brand-new-blacklisted)');
  });
});

describe('manual-add via upsertProviderModel', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('row added with enable_source=manual_enabled is protected from refresh re-evaluation', () => {
    // Mirrors what POST /api/providers/[id]/models does for "添加模型".
    const providerId = createScratchProvider();
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'my-custom-model',
      upstream_model_id: 'my-custom-model',
      display_name: 'My Custom Model',
      capabilities_json: '{}',
      sort_order: 0,
      source: 'manual',
      user_edited: 1,
      enable_source: 'manual_enabled',
    });

    const seeded = getAllModelsForProvider(providerId).find(r => r.model_id === 'my-custom-model')!;
    assert.equal(seeded.enable_source, 'manual_enabled',
      'manual-add must land as manual_enabled (not the default "recommended")');

    // Refresh that says "this is not recommended" — must still leave
    // the row enabled because the user added it on purpose.
    applyDiscoveryDiff(
      providerId,
      [{ modelId: 'my-custom-model', upstreamModelId: 'my-custom-model' }],
      () => false,
    );

    const after = getAllModelsForProvider(providerId).find(r => r.model_id === 'my-custom-model')!;
    assert.equal(after.enabled, 1, 'manually-added row stays enabled across refresh');
    assert.equal(after.enable_source, 'manual_enabled', 'enable_source intact');
  });
});

describe('updateProviderModelUserFields auto-marks manual_*', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('toggling enabled=1 on a recommended row marks it manual_enabled', () => {
    const providerId = createScratchProvider();
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'sonnet',
      upstream_model_id: 'claude-sonnet',
      display_name: 'sonnet',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 0,
      enabled: 0, // currently hidden via discovered
      source: 'api',
      last_refreshed_at: '2026-01-01 00:00:00',
      user_edited: 0,
      enable_source: 'discovered',
    });

    updateProviderModelUserFields(providerId, 'sonnet', { enabled: 1 });

    const rows = getAllModelsForProvider(providerId);
    assert.equal(rows[0].enabled, 1);
    assert.equal(rows[0].enable_source, 'manual_enabled',
      'flipping enabled on must promote enable_source so future refreshes respect it');
  });

  it('toggling enabled=0 on a recommended row marks it manual_hidden', () => {
    const providerId = createScratchProvider();
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'sonnet',
      upstream_model_id: 'claude-sonnet',
      display_name: 'sonnet',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 0,
      enabled: 1,
      source: 'api',
      last_refreshed_at: '2026-01-01 00:00:00',
      user_edited: 0,
      enable_source: 'recommended',
    });

    updateProviderModelUserFields(providerId, 'sonnet', { enabled: 0 });

    const rows = getAllModelsForProvider(providerId);
    assert.equal(rows[0].enabled, 0);
    assert.equal(rows[0].enable_source, 'manual_hidden',
      'flipping enabled off must promote enable_source so future refreshes do not silently re-enable');
  });

  it('does NOT change enable_source when fields other than enabled change', () => {
    const providerId = createScratchProvider();
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'sonnet',
      upstream_model_id: 'claude-sonnet',
      display_name: 'sonnet',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 0,
      enabled: 1,
      source: 'api',
      last_refreshed_at: '2026-01-01 00:00:00',
      user_edited: 0,
      enable_source: 'recommended',
    });

    updateProviderModelUserFields(providerId, 'sonnet', { display_name: 'My Sonnet' });

    const rows = getAllModelsForProvider(providerId);
    assert.equal(rows[0].display_name, 'My Sonnet');
    assert.equal(rows[0].enable_source, 'recommended',
      'renaming alone is not an enable-state choice; enable_source stays put');
  });
});
