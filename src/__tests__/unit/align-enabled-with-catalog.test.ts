/**
 * Tests for alignEnabledWithCatalog — the "reset every system-managed
 * row to the recommended catalog" operation behind the Models page's
 * "按推荐整理" button. Critical invariants:
 *
 *   - manual_enabled / manual_hidden rows are NEVER touched (no enabled
 *     flip, no enable_source rewrite, no DELETE)
 *   - legacy user_edited=1 rows are also untouched (same protection)
 *   - For system-managed rows, `enabled` and `enable_source` always
 *     update together — a row should never end up enabled=0 with
 *     enable_source='recommended' or enabled=1 with 'discovered'
 *   - Catalog seed cleanup only removes truly-unused rows (source='catalog'
 *     AND not user-touched)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  alignEnabledWithCatalog,
  upsertProviderModel,
  getAllModelsForProvider,
  createProvider,
  deleteProvider,
  getAllProviders,
} from '../../lib/db';

const TEST_PROVIDER_PREFIX = '__test_align_';

function createScratchProvider(): string {
  const p = createProvider({
    name: `${TEST_PROVIDER_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    provider_type: 'anthropic',
    protocol: 'anthropic',
    base_url: 'https://api.test-align.com',
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

const CATALOG = [
  { modelId: 'sonnet', displayName: 'Sonnet 4.6', upstreamModelId: 'claude-sonnet-4' },
  { modelId: 'opus', displayName: 'Opus 4.7', upstreamModelId: 'claude-opus-4-7' },
];

describe('alignEnabledWithCatalog — user-managed rows are untouchable', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('manual_hidden row in catalog stays hidden (does NOT re-enable)', () => {
    const providerId = createScratchProvider();
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'sonnet',
      upstream_model_id: 'claude-sonnet-4',
      display_name: 'sonnet',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 0,
      enabled: 0,                  // user explicitly hid this
      source: 'api',
      last_refreshed_at: '2026-01-01 00:00:00',
      user_edited: 0,
      enable_source: 'manual_hidden',
    });

    const stats = alignEnabledWithCatalog(providerId, CATALOG);

    const row = getAllModelsForProvider(providerId).find(r => r.model_id === 'sonnet')!;
    assert.equal(row.enabled, 0, 'manual_hidden must not flip to enabled');
    assert.equal(row.enable_source, 'manual_hidden', 'enable_source must not be rewritten');
    assert.equal(stats.enabled, 0,
      'this row was untouched, so the enabled counter should not include it');
  });

  it('manual_enabled row NOT in catalog stays enabled (does NOT disable)', () => {
    const providerId = createScratchProvider();
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'gpt-4o',           // not in CATALOG
      upstream_model_id: 'gpt-4o',
      display_name: 'GPT-4o',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 0,
      enabled: 1,
      source: 'api',
      last_refreshed_at: '2026-01-01 00:00:00',
      user_edited: 0,
      enable_source: 'manual_enabled',
    });

    const stats = alignEnabledWithCatalog(providerId, CATALOG);

    const row = getAllModelsForProvider(providerId).find(r => r.model_id === 'gpt-4o')!;
    assert.equal(row.enabled, 1, 'manual_enabled must not be disabled');
    assert.equal(row.enable_source, 'manual_enabled');
    assert.equal(stats.disabled, 0);
  });

  it('legacy user_edited=1 row is also protected (even if enable_source is recommended)', () => {
    const providerId = createScratchProvider();
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'sonnet',
      upstream_model_id: 'claude-sonnet-4',
      display_name: 'My Sonnet',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 0,
      enabled: 0,                  // user hid via the legacy flag
      source: 'api',
      last_refreshed_at: '2026-01-01 00:00:00',
      user_edited: 1,
      enable_source: 'recommended', // pre-Phase-B legacy row
    });

    alignEnabledWithCatalog(providerId, CATALOG);

    const row = getAllModelsForProvider(providerId).find(r => r.model_id === 'sonnet')!;
    assert.equal(row.enabled, 0, 'user_edited=1 must keep hidden state');
    assert.equal(row.display_name, 'My Sonnet', 'display_name must not be overwritten');
  });

  it('does NOT prune a user-edited catalog row even when not in current catalog', () => {
    const providerId = createScratchProvider();
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'old-catalog-entry',
      upstream_model_id: 'old-catalog-entry',
      display_name: 'old-catalog-entry',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 0,
      enabled: 1,
      source: 'catalog',          // would normally prune…
      last_refreshed_at: null,
      user_edited: 1,             // …but user touched it
      enable_source: 'manual_enabled',
    });

    alignEnabledWithCatalog(providerId, CATALOG);

    const row = getAllModelsForProvider(providerId).find(r => r.model_id === 'old-catalog-entry');
    assert.ok(row, 'user-touched catalog row must NOT be pruned');
    assert.equal(row!.enabled, 1);
  });
});

describe('alignEnabledWithCatalog — system-managed rows update enabled+enable_source together', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('disabling a recommended row also moves enable_source to discovered', () => {
    const providerId = createScratchProvider();
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'gpt-4o',         // not in CATALOG
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

    const stats = alignEnabledWithCatalog(providerId, CATALOG);

    const row = getAllModelsForProvider(providerId).find(r => r.model_id === 'gpt-4o')!;
    assert.equal(row.enabled, 0);
    assert.equal(row.enable_source, 'discovered',
      'badge semantics: row is no longer "recommended" since catalog rejected it');
    assert.equal(stats.disabled, 1);
  });

  it('re-enabling a discovered row also moves enable_source to recommended', () => {
    const providerId = createScratchProvider();
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'sonnet',         // IS in CATALOG
      upstream_model_id: 'old-upstream',
      display_name: 'old-name',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 0,
      enabled: 0,
      source: 'api',
      last_refreshed_at: '2026-01-01 00:00:00',
      user_edited: 0,
      enable_source: 'discovered',
    });

    const stats = alignEnabledWithCatalog(providerId, CATALOG);

    const row = getAllModelsForProvider(providerId).find(r => r.model_id === 'sonnet')!;
    assert.equal(row.enabled, 1);
    assert.equal(row.enable_source, 'recommended');
    assert.equal(row.display_name, 'Sonnet 4.6', 'display_name refreshed from catalog');
    assert.equal(row.upstream_model_id, 'claude-sonnet-4', 'upstream refreshed from catalog');
    assert.equal(stats.enabled, 1);
  });

  it('catalog-source pristine row not in catalog gets pruned', () => {
    const providerId = createScratchProvider();
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'stale-seed',
      upstream_model_id: 'stale-seed',
      display_name: 'stale-seed',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 0,
      enabled: 1,
      source: 'catalog',
      last_refreshed_at: null,
      user_edited: 0,
      enable_source: 'catalog',
    });

    const stats = alignEnabledWithCatalog(providerId, CATALOG);

    const row = getAllModelsForProvider(providerId).find(r => r.model_id === 'stale-seed');
    assert.equal(row, undefined, 'pristine catalog seed should be pruned');
    assert.equal(stats.pruned, 1);
  });

  it('inserts catalog rows with enable_source=recommended (verified via DB read)', () => {
    const providerId = createScratchProvider();
    // Empty DB → align should INSERT both catalog entries
    const stats = alignEnabledWithCatalog(providerId, CATALOG);
    assert.equal(stats.inserted, 2);

    const rows = getAllModelsForProvider(providerId);
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.enabled, 1);
      assert.equal(row.enable_source, 'recommended',
        'newly inserted catalog rows land as recommended (matches enabled=1)');
    }
  });
});
