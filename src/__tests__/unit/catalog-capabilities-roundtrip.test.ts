/**
 * Catalog → DB → resolver round-trip for model capabilities.
 *
 * Phase 1 review round 1 (2026-07-17) found the hole this file guards: the
 * GLM/Kimi effort capabilities lived only on the in-memory catalog object.
 * Both DB sync paths (`seedCatalogModelsIfEmpty`, `alignEnabledWithCatalog`)
 * hard-wrote `capabilities_json='{}'`, and both read paths (models GET route,
 * provider-resolver) let a same-id DB row shadow the catalog. So the moment a
 * provider's rows were materialized — which the Models page does on first GET —
 * `supportsEffort` / `supportedEffortLevels` / `effortNoteKey` were dropped and
 * the Auto/High/Max menu disappeared for exactly the providers Phase 1 added it
 * for. Catalog-object-only assertions (provider-resolver.test.ts) could not see
 * this; these tests drive the DB.
 *
 * Invariants, in the order the review demanded them:
 *   - fresh seed  → resolver still reports the catalog capabilities
 *   - legacy row  → system-managed metadata (display/upstream/caps) realigns,
 *                   but model_id stays put so session pins never strand
 *   - user_edited / manual_* rows → untouched, capabilities included
 *   - catalog silent about capabilities → DB value preserved, never erased
 */

import '../db-isolation.setup';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  alignEnabledWithCatalog,
  mergeCatalogManagedModels,
  seedCatalogModelsIfEmpty,
  upsertProviderModel,
  getAllModelsForProvider,
  createProvider,
  deleteProvider,
  getDb,
  getAllProviders,
} from '../../lib/db';
import { resolveProvider } from '../../lib/provider-resolver';
import { getCatalogDefaultModelsForRecord as getCatalogDefaultModelsForRecordResolved } from '../../lib/provider-catalog';
import { classifyCatalogModelPresence } from '../../lib/catalog-model-identity';

const TEST_PROVIDER_PREFIX = '__test_caps_rt_';

function cleanup() {
  for (const p of getAllProviders()) {
    if (p.name.startsWith(TEST_PROVIDER_PREFIX)) deleteProvider(p.id);
  }
}

/** A provider record shaped like the real vendor preset so the catalog matches. */
function createScratchProvider(baseUrl: string): string {
  const p = createProvider({
    name: `${TEST_PROVIDER_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    provider_type: 'anthropic',
    protocol: 'anthropic',
    base_url: baseUrl,
    api_key: 'sk-test',
    extra_env: '{}',
  });
  return p.id;
}

const GLM_BASE_URL = 'https://open.bigmodel.cn/api/anthropic';
const KIMI_BASE_URL = 'https://api.kimi.com/coding/';
const getCatalogDefaultModelsForRecord = (record: { provider_type: string; base_url: string }) =>
  getCatalogDefaultModelsForRecordResolved({
    preset_key: '',
    protocol: record.provider_type,
    ...record,
  });

function resolvedModel(providerId: string, modelId: string) {
  const resolution = resolveProvider({ providerId, model: modelId });
  const entry = resolution.availableModels.find(m => m.modelId === modelId);
  return { resolution, entry };
}

describe('catalog capabilities survive the DB round-trip — GLM', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('keeps the complete legacy capabilities snapshot in the SQL compare-and-swap', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/db.ts'), 'utf8');
    assert.match(source, /upstream_model_id = \? AND display_name = \?\s+AND capabilities_json IS \?/);
  });

  it('fresh seed: resolver sees current GLM-5.3 metadata and effort contract', () => {
    const providerId = createScratchProvider(GLM_BASE_URL);
    const catalog = getCatalogDefaultModelsForRecord({
      provider_type: 'anthropic',
      base_url: GLM_BASE_URL,
    });
    assert.ok(catalog.length > 0, 'GLM catalog defaults must match this base_url');

    // This is what `GET /api/providers/[id]/models` does on first open.
    seedCatalogModelsIfEmpty(providerId, catalog);

    const { entry } = resolvedModel(providerId, 'sonnet');
    assert.ok(entry, 'materialized GLM row vanished from the resolver');
    assert.equal(entry.capabilities?.supportsEffort, true,
      'DB row shadowed the catalog and dropped supportsEffort — effort menu would not render');
    assert.equal(entry.displayName, 'GLM-5.3');
    assert.equal(entry.upstreamModelId, 'glm-5.3[1m]');
    assert.deepEqual(entry.capabilities?.supportedEffortLevels, ['low', 'high', 'max']);
    assert.equal(entry.capabilities?.effortNoteKey, 'messageInput.effort.note.glmCodePlan');
  });

  it('seeded rows carry capabilities in the DB column, not a placeholder {}', () => {
    const providerId = createScratchProvider(GLM_BASE_URL);
    const catalog = getCatalogDefaultModelsForRecord({
      provider_type: 'anthropic',
      base_url: GLM_BASE_URL,
    });
    seedCatalogModelsIfEmpty(providerId, catalog);

    const row = getAllModelsForProvider(providerId).find(r => r.model_id === 'sonnet')!;
    const caps = JSON.parse(row.capabilities_json || '{}');
    assert.deepEqual(caps.supportedEffortLevels, ['low', 'high', 'max'],
      'capabilities_json is the source breadcrumb the picker reads');
  });

  it('reads a stale catalog-managed 5.2 row as 5.3 before persistence alignment', () => {
    const providerId = createScratchProvider(GLM_BASE_URL);
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'sonnet',
      upstream_model_id: 'sonnet',
      display_name: 'GLM-5.2',
      capabilities_json: JSON.stringify({
        supportsEffort: true,
        supportedEffortLevels: ['high', 'max'],
      }),
      variants_json: '{}',
      sort_order: 0,
      enabled: 1,
      source: 'catalog',
      last_refreshed_at: '2026-07-17 00:00:00',
      user_edited: 0,
      enable_source: 'catalog',
    });

    const { resolution, entry } = resolvedModel(providerId, 'sonnet');
    assert.equal(resolution.upstreamModel, 'glm-5.3[1m]', 'wire must not keep the stale sonnet alias');
    assert.equal(entry?.displayName, 'GLM-5.3');
    assert.deepEqual(entry?.capabilities?.supportedEffortLevels, ['low', 'high', 'max']);

    const unchangedRow = getAllModelsForProvider(providerId).find(row => row.model_id === 'sonnet')!;
    assert.equal(unchangedRow.display_name, 'GLM-5.2', 'resolver enrichment must stay read-only');

    const catalog = getCatalogDefaultModelsForRecord({
      provider_type: 'anthropic',
      base_url: GLM_BASE_URL,
    });
    alignEnabledWithCatalog(providerId, catalog);
    const alignedRows = getAllModelsForProvider(providerId);
    const flagship = alignedRows.find(row => row.model_id === 'sonnet')!;
    assert.equal(flagship.display_name, 'GLM-5.3');
    assert.equal(flagship.upstream_model_id, 'glm-5.3[1m]');
    const flash = alignedRows.find(row => row.model_id === 'haiku');
    assert.equal(flash?.upstream_model_id, 'glm-5.3-flash[1m]');
    assert.equal(flash?.display_name, 'GLM-5.3-Flash');
    assert.equal(JSON.parse(flash?.capabilities_json ?? '{}').vision, true);
  });

  it('Models-page catalog merge preserves a user-hidden catalog identity', () => {
    const providerId = createScratchProvider(GLM_BASE_URL);
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'sonnet',
      upstream_model_id: 'my-private-glm-route',
      display_name: 'My hidden GLM',
      capabilities_json: JSON.stringify({ private: true }),
      variants_json: '{}',
      sort_order: 42,
      enabled: 0,
      source: 'catalog',
      user_edited: 1,
      enable_source: 'manual_hidden',
    });

    const catalog = getCatalogDefaultModelsForRecord({
      provider_type: 'anthropic',
      base_url: GLM_BASE_URL,
    });
    const result = mergeCatalogManagedModels(providerId, catalog);
    assert.equal(result.inserted, 1, 'the missing Flash catalog row should still be added');
    assert.equal(result.updated, 0, 'the existing user-managed flagship must not be rewritten');

    const flagship = getAllModelsForProvider(providerId).find(row => row.model_id === 'sonnet')!;
    assert.equal(flagship.display_name, 'My hidden GLM');
    assert.equal(flagship.upstream_model_id, 'my-private-glm-route');
    assert.equal(flagship.enabled, 0);
    assert.equal(flagship.sort_order, 42);
    assert.equal(flagship.user_edited, 1);
    assert.equal(flagship.enable_source, 'manual_hidden');
    assert.deepEqual(JSON.parse(flagship.capabilities_json), { private: true });
  });

  it('keeps a retired pristine GLM-5-Turbo row as historical data', () => {
    const providerId = createScratchProvider(GLM_BASE_URL);
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'glm-5-turbo',
      upstream_model_id: 'glm-5-turbo',
      display_name: 'GLM-5-Turbo',
      capabilities_json: JSON.stringify({
        reasoning: true,
        toolUse: true,
        contextWindow: 204_800,
        defaultEffortLevel: 'max',
      }),
      variants_json: '{}',
      sort_order: 1,
      enabled: 1,
      source: 'catalog',
      user_edited: 0,
      enable_source: 'catalog',
    });

    const catalog = getCatalogDefaultModelsForRecord({
      provider_type: 'anthropic',
      base_url: GLM_BASE_URL,
    });
    mergeCatalogManagedModels(providerId, catalog);

    const rows = getAllModelsForProvider(providerId);
    const retired = rows.find(row => row.model_id === 'glm-5-turbo');
    assert.ok(retired, 'a Models-page read must not delete a retired catalog row');
    assert.equal(retired.display_name, 'GLM-5-Turbo');
    assert.equal(retired.upstream_model_id, 'glm-5-turbo');
    assert.equal(retired.enabled, 1);
    assert.ok(rows.some(row => row.model_id === 'sonnet'));
    assert.equal(rows.find(row => row.model_id === 'haiku')?.upstream_model_id, 'glm-5.3-flash[1m]');
  });

  it('upgrades the exact three-row pre-source-migration GLM snapshot without inventing fingerprints', () => {
    const providerId = createScratchProvider(GLM_BASE_URL);
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'sonnet',
      upstream_model_id: 'sonnet',
      display_name: 'GLM-5-Turbo',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 0,
      enabled: 1,
      // Old databases received this conservative source backfill even for
      // rows originally seeded from the built-in catalog.
      source: 'manual',
      user_edited: 0,
      enable_source: 'recommended',
    });
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'opus',
      upstream_model_id: 'opus',
      display_name: 'GLM-5.1',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 1,
      enabled: 1,
      source: 'manual',
      user_edited: 0,
      enable_source: 'recommended',
    });
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'haiku',
      upstream_model_id: 'haiku',
      display_name: 'GLM-4.5-Air',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 2,
      enabled: 1,
      source: 'manual',
      user_edited: 0,
      enable_source: 'recommended',
    });

    const catalog = getCatalogDefaultModelsForRecord({
      provider_type: 'anthropic',
      base_url: GLM_BASE_URL,
    });
    const result = mergeCatalogManagedModels(providerId, catalog);
    assert.deepEqual(result, { inserted: 0, updated: 2 });

    const rows = getAllModelsForProvider(providerId);
    const flagship = rows.find(row => row.model_id === 'sonnet')!;
    assert.equal(flagship.upstream_model_id, 'glm-5.3[1m]');
    assert.equal(flagship.display_name, 'GLM-5.3');
    assert.equal(flagship.source, 'catalog');
    assert.equal(flagship.enable_source, 'catalog');
    assert.equal(rows.find(row => row.model_id === 'haiku')?.upstream_model_id, 'glm-5.3-flash[1m]');
    assert.equal(rows.find(row => row.model_id === 'haiku')?.display_name, 'GLM-5.3-Flash');
    assert.equal(rows.find(row => row.model_id === 'opus')?.display_name, 'GLM-5.1',
      'the retired opus slot is historical data and must not be silently deleted or rewritten');
  });

  it('upgrades the gen-0 GLM-4.7 sonnet slot shipped from 2026-03-09 through 2026-03-28', () => {
    const providerId = createScratchProvider(GLM_BASE_URL);
    for (const [modelId, displayName, sortOrder] of [
      ['sonnet', 'GLM-4.7', 0],
      ['opus', 'GLM-5', 1],
      ['haiku', 'GLM-4.5-Air', 2],
    ] as const) {
      upsertProviderModel({
        provider_id: providerId,
        model_id: modelId,
        upstream_model_id: modelId,
        display_name: displayName,
        capabilities_json: '{}',
        variants_json: '{}',
        sort_order: sortOrder,
        enabled: 1,
        source: 'manual',
        user_edited: 0,
        enable_source: 'recommended',
      });
    }

    const catalog = getCatalogDefaultModelsForRecord({
      provider_type: 'anthropic',
      base_url: GLM_BASE_URL,
    });
    assert.deepEqual(mergeCatalogManagedModels(providerId, catalog), { inserted: 0, updated: 2 });

    const rows = getAllModelsForProvider(providerId);
    assert.equal(rows.find(row => row.model_id === 'sonnet')?.upstream_model_id, 'glm-5.3[1m]');
    assert.equal(rows.find(row => row.model_id === 'sonnet')?.display_name, 'GLM-5.3');
    assert.equal(rows.find(row => row.model_id === 'haiku')?.upstream_model_id, 'glm-5.3-flash[1m]');
    assert.equal(rows.find(row => row.model_id === 'opus')?.display_name, 'GLM-5',
      'retired gen-0 opus history is preserved rather than guessed into a current slot');
  });

  it('keeps a canonical current SKU usable when an extra direct-wire row remains', () => {
    const catalog = getCatalogDefaultModelsForRecord({
      provider_type: 'anthropic',
      base_url: GLM_BASE_URL,
    });
    const flagship = catalog.find(model => model.modelId === 'sonnet')!;
    const presence = classifyCatalogModelPresence([
      {
        model_id: 'sonnet',
        upstream_model_id: 'glm-5.3[1m]',
        display_name: 'GLM-5.3',
        capabilities_json: '{}',
        enabled: 1,
        source: 'catalog',
        user_edited: 0,
        enable_source: 'catalog',
      },
      {
        model_id: 'glm-5.3[1m]',
        upstream_model_id: 'glm-5.3[1m]',
        display_name: 'Older direct row',
        capabilities_json: '{}',
        enabled: 1,
        source: 'manual',
        user_edited: 1,
        enable_source: 'manual_enabled',
      },
    ], flagship);
    assert.deepEqual(presence, { state: 'current_enabled', existingModelId: 'sonnet' });
  });

  it('reports the current SKU enabled when a unique direct wire is enabled beside a hidden canonical row', () => {
    const catalog = getCatalogDefaultModelsForRecord({
      provider_type: 'anthropic',
      base_url: GLM_BASE_URL,
    });
    const flagship = catalog.find(model => model.modelId === 'sonnet')!;
    const presence = classifyCatalogModelPresence([
      {
        model_id: 'sonnet',
        upstream_model_id: 'glm-5.3[1m]',
        display_name: 'GLM-5.3',
        capabilities_json: '{}',
        enabled: 0,
        source: 'catalog',
        user_edited: 0,
        enable_source: 'manual_hidden',
      },
      {
        model_id: 'glm-5.3[1m]',
        upstream_model_id: 'glm-5.3[1m]',
        display_name: 'GLM-5.3 direct',
        capabilities_json: '{}',
        enabled: 1,
        source: 'manual',
        user_edited: 1,
        enable_source: 'manual_enabled',
      },
    ], flagship);

    assert.deepEqual(presence, {
      state: 'current_enabled',
      existingModelId: 'glm-5.3[1m]',
    });
  });

  it('fails closed with explicit model ids when no row is a unique current or legacy identity', () => {
    const catalog = getCatalogDefaultModelsForRecord({
      provider_type: 'anthropic',
      base_url: GLM_BASE_URL,
    });
    const flagship = catalog.find(model => model.modelId === 'sonnet')!;
    const presence = classifyCatalogModelPresence([
      {
        model_id: 'sonnet',
        upstream_model_id: 'private-sonnet-route',
        display_name: 'My custom Sonnet slot',
        capabilities_json: '{}',
        enabled: 1,
        source: 'manual',
        user_edited: 1,
        enable_source: 'manual_enabled',
      },
      {
        model_id: 'glm-5.3[1m]',
        upstream_model_id: 'proxy-glm-route',
        display_name: 'Conflicting direct-id row',
        capabilities_json: '{}',
        enabled: 0,
        source: 'manual',
        user_edited: 1,
        enable_source: 'manual_hidden',
      },
    ], flagship);

    assert.deepEqual(presence, {
      state: 'identity_conflict',
      conflictModelIds: ['sonnet', 'glm-5.3[1m]'],
    });
  });

  it('does not upgrade a lookalike GLM row after the user has claimed ownership', () => {
    const providerId = createScratchProvider(GLM_BASE_URL);
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'sonnet',
      upstream_model_id: 'sonnet',
      display_name: 'GLM-5-Turbo',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 17,
      enabled: 0,
      source: 'manual',
      user_edited: 1,
      enable_source: 'manual_hidden',
    });

    const catalog = getCatalogDefaultModelsForRecord({
      provider_type: 'anthropic',
      base_url: GLM_BASE_URL,
    });
    const result = mergeCatalogManagedModels(providerId, catalog);
    assert.equal(result.updated, 0);
    const flagship = getAllModelsForProvider(providerId).find(row => row.model_id === 'sonnet')!;
    assert.equal(flagship.upstream_model_id, 'sonnet');
    assert.equal(flagship.display_name, 'GLM-5-Turbo');
    assert.equal(flagship.enabled, 0);
    assert.equal(flagship.sort_order, 17);
    assert.equal(flagship.source, 'manual');
  });

  it('does not create a stable alias when a user row already owns the catalog upstream id', () => {
    const providerId = createScratchProvider(GLM_BASE_URL);
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'glm-5.3[1m]',
      upstream_model_id: 'glm-5.3[1m]',
      display_name: 'My direct GLM wire row',
      capabilities_json: JSON.stringify({ private: true }),
      sort_order: 8,
      enabled: 1,
      source: 'manual',
      user_edited: 1,
      enable_source: 'manual_enabled',
    });

    const catalog = getCatalogDefaultModelsForRecord({
      provider_type: 'anthropic',
      base_url: GLM_BASE_URL,
    });
    const result = mergeCatalogManagedModels(providerId, catalog);
    assert.equal(result.inserted, 1, 'Flash is new, but the duplicate 5.3 wire is not');
    const rows = getAllModelsForProvider(providerId);
    assert.equal(rows.filter(row => row.upstream_model_id === 'glm-5.3[1m]').length, 1);
    assert.equal(rows.some(row => row.model_id === 'sonnet'), false);
    const manual = rows.find(row => row.model_id === 'glm-5.3[1m]')!;
    assert.equal(manual.display_name, 'My direct GLM wire row');
    assert.deepEqual(JSON.parse(manual.capabilities_json), { private: true });
  });

  it('treats user_edited and manual_hidden as independent merge guards', () => {
    const providerId = createScratchProvider(GLM_BASE_URL);
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'sonnet',
      upstream_model_id: 'user-edited-wire',
      display_name: 'Edited only',
      capabilities_json: JSON.stringify({ edited: true }),
      sort_order: 20,
      enabled: 1,
      source: 'catalog',
      user_edited: 1,
      enable_source: 'catalog',
    });
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'haiku',
      upstream_model_id: 'hidden-only-wire',
      display_name: 'Hidden only',
      capabilities_json: JSON.stringify({ hidden: true }),
      sort_order: 21,
      enabled: 0,
      source: 'catalog',
      user_edited: 0,
      enable_source: 'manual_hidden',
    });

    const catalog = getCatalogDefaultModelsForRecord({
      provider_type: 'anthropic',
      base_url: GLM_BASE_URL,
    });
    const result = mergeCatalogManagedModels(providerId, catalog);
    assert.equal(result.updated, 0);
    const rows = getAllModelsForProvider(providerId);
    const edited = rows.find(row => row.model_id === 'sonnet')!;
    const hidden = rows.find(row => row.model_id === 'haiku')!;
    assert.equal(edited.upstream_model_id, 'user-edited-wire');
    assert.equal(edited.sort_order, 20);
    assert.deepEqual(JSON.parse(edited.capabilities_json), { edited: true });
    assert.equal(hidden.upstream_model_id, 'hidden-only-wire');
    assert.equal(hidden.sort_order, 21);
    assert.equal(hidden.enabled, 0);
    assert.deepEqual(JSON.parse(hidden.capabilities_json), { hidden: true });
  });

  it('keeps discovered capabilities when the merge catalog is silent', () => {
    const providerId = createScratchProvider(GLM_BASE_URL);
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'haiku',
      upstream_model_id: 'legacy-haiku',
      display_name: 'Legacy 4.7',
      capabilities_json: JSON.stringify({ contextWindow: 128000 }),
      sort_order: 5,
      enabled: 1,
      source: 'catalog',
      user_edited: 0,
      enable_source: 'catalog',
    });

    const result = mergeCatalogManagedModels(providerId, [{
      modelId: 'haiku',
      upstreamModelId: 'glm-4.7',
      displayName: 'GLM-4.7',
    }]);
    assert.deepEqual(result, { inserted: 0, updated: 1 });
    const row = getAllModelsForProvider(providerId)[0];
    assert.equal(row.upstream_model_id, 'glm-4.7');
    assert.equal(row.display_name, 'GLM-4.7');
    assert.deepEqual(JSON.parse(row.capabilities_json), { contextWindow: 128000 });
  });

  it('allocates collision-free catalog ordering around user-owned rows', () => {
    const providerId = createScratchProvider(GLM_BASE_URL);
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'user/pinned-order',
      upstream_model_id: 'user/pinned-order',
      display_name: 'Pinned between catalog rows',
      sort_order: 1,
      enabled: 1,
      source: 'manual',
      user_edited: 1,
      enable_source: 'manual_enabled',
    });
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'sonnet',
      upstream_model_id: 'sonnet',
      display_name: 'GLM-5.2',
      sort_order: 0,
      enabled: 1,
      source: 'catalog',
      user_edited: 0,
      enable_source: 'catalog',
    });

    const catalog = getCatalogDefaultModelsForRecord({
      provider_type: 'anthropic',
      base_url: GLM_BASE_URL,
    });
    mergeCatalogManagedModels(providerId, catalog);
    const rows = getAllModelsForProvider(providerId);
    assert.equal(new Set(rows.map(row => row.sort_order)).size, rows.length);
    assert.equal(rows.find(row => row.model_id === 'user/pinned-order')?.sort_order, 1);
    const catalogRows = catalog.map(model => rows.find(row => row.model_id === model.modelId)!);
    assert.deepEqual(catalogRows.map(row => row.sort_order), [0, 2]);
  });

  it('absorbs a unique-key winner committed after the merge snapshot', () => {
    const providerId = createScratchProvider(GLM_BASE_URL);
    const db = getDb();
    db.exec(`
      CREATE TEMP TRIGGER test_catalog_merge_conflict
      BEFORE INSERT ON provider_models
      WHEN NEW.provider_id = '${providerId}' AND NEW.model_id = 'sonnet'
      BEGIN
        INSERT INTO provider_models (
          id, provider_id, model_id, upstream_model_id, display_name,
          capabilities_json, variants_json, sort_order, enabled, created_at,
          source, last_refreshed_at, user_edited, enable_source
        ) VALUES (
          'concurrent-winner', NEW.provider_id, NEW.model_id, NEW.upstream_model_id,
          'Concurrent winner', '{}', '{}', 77, 1, CURRENT_TIMESTAMP,
          'manual', NULL, 1, 'manual_enabled'
        );
      END;
    `);
    try {
      const catalog = getCatalogDefaultModelsForRecord({
        provider_type: 'anthropic',
        base_url: GLM_BASE_URL,
      });
      const result = mergeCatalogManagedModels(providerId, catalog);
      assert.equal(result.inserted, 1, 'the ignored catalog insert must not inflate the write count');
      const winner = getAllModelsForProvider(providerId).find(row => row.model_id === 'sonnet')!;
      assert.equal(winner.display_name, 'Concurrent winner');
      assert.equal(winner.source, 'manual');
      assert.equal(winner.user_edited, 1);
    } finally {
      db.exec('DROP TRIGGER IF EXISTS test_catalog_merge_conflict');
    }
  });
});

describe('catalog capabilities survive the DB round-trip — Kimi for Coding', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('legacy `Kimi K2.5` row realigns to the channel name, id and upstream', () => {
    const providerId = createScratchProvider(KIMI_BASE_URL);
    // Exactly the shape a pre-Phase-1 install has on disk: stale display name,
    // self-referential upstream (which shipped the bare `sonnet` string to
    // Kimi), and no capabilities.
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'sonnet',
      upstream_model_id: 'sonnet',
      display_name: 'Kimi K2.5',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 0,
      enabled: 1,
      source: 'catalog',
      last_refreshed_at: '2026-01-01 00:00:00',
      user_edited: 0,
      enable_source: 'recommended',
    });

    const catalog = getCatalogDefaultModelsForRecord({
      provider_type: 'anthropic',
      base_url: KIMI_BASE_URL,
    });
    alignEnabledWithCatalog(providerId, catalog);

    const row = getAllModelsForProvider(providerId).find(r => r.model_id === 'sonnet')!;
    assert.equal(row.display_name, 'Kimi for Coding',
      'legacy row kept showing an underlying version the catalog no longer claims');
    assert.equal(row.upstream_model_id, 'kimi-for-coding',
      'legacy row would keep sending the bare `sonnet` alias upstream');
    assert.equal(row.model_id, 'sonnet',
      'model_id is the session/DB pin — realignment must never move it');

    const { resolution, entry } = resolvedModel(providerId, 'sonnet');
    assert.equal(resolution.upstreamModel, 'kimi-for-coding');
    assert.deepEqual(entry?.capabilities?.supportedEffortLevels, ['low', 'high', 'max'],
      'Kimi menu is Auto + Low/High/Max; without caps on the row it renders nothing');
    assert.equal(entry?.capabilities?.effortNoteKey, 'messageInput.effort.note.kimiAuto');
  });

  it('preserves documented tiers and omits unsupported ones after the round-trip', () => {
    const providerId = createScratchProvider(KIMI_BASE_URL);
    const catalog = getCatalogDefaultModelsForRecord({
      provider_type: 'anthropic',
      base_url: KIMI_BASE_URL,
    });
    seedCatalogModelsIfEmpty(providerId, catalog);

    const { entry } = resolvedModel(providerId, 'sonnet');
    const levels = entry?.capabilities?.supportedEffortLevels ?? [];
    assert.deepEqual(levels, ['low', 'high', 'max']);
    for (const fake of ['medium', 'xhigh']) {
      assert.ok(!levels.includes(fake as 'low'),
        `Kimi advertises unsupported tier ${fake}`);
    }
  });
});

describe('capability realignment respects user ownership', () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it('user_edited row keeps its display name AND its capabilities', () => {
    const providerId = createScratchProvider(KIMI_BASE_URL);
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'sonnet',
      upstream_model_id: 'my-own-pin',
      display_name: 'My Kimi',
      capabilities_json: JSON.stringify({ supportsEffort: false }),
      variants_json: '{}',
      sort_order: 0,
      enabled: 1,
      source: 'catalog',
      last_refreshed_at: '2026-01-01 00:00:00',
      user_edited: 1,               // the user has chosen for this row
      enable_source: 'recommended',
    });

    const catalog = getCatalogDefaultModelsForRecord({
      provider_type: 'anthropic',
      base_url: KIMI_BASE_URL,
    });
    alignEnabledWithCatalog(providerId, catalog);

    const row = getAllModelsForProvider(providerId).find(r => r.model_id === 'sonnet')!;
    assert.equal(row.display_name, 'My Kimi', 'user_edited display_name was overwritten');
    assert.equal(row.upstream_model_id, 'my-own-pin', 'user_edited upstream was overwritten');
    assert.deepEqual(JSON.parse(row.capabilities_json || '{}'), { supportsEffort: false },
      'user_edited capabilities were overwritten by the catalog');
  });

  it('manual_hidden row is not resurrected by the capability sync', () => {
    const providerId = createScratchProvider(KIMI_BASE_URL);
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'sonnet',
      upstream_model_id: 'sonnet',
      display_name: 'Kimi K2.5',
      capabilities_json: '{}',
      variants_json: '{}',
      sort_order: 0,
      enabled: 0,
      source: 'catalog',
      last_refreshed_at: '2026-01-01 00:00:00',
      user_edited: 0,
      enable_source: 'manual_hidden',
    });

    const catalog = getCatalogDefaultModelsForRecord({
      provider_type: 'anthropic',
      base_url: KIMI_BASE_URL,
    });
    alignEnabledWithCatalog(providerId, catalog);

    const row = getAllModelsForProvider(providerId).find(r => r.model_id === 'sonnet')!;
    assert.equal(row.enabled, 0, 'manual_hidden row must stay hidden');
    assert.equal(row.enable_source, 'manual_hidden');
    assert.equal(row.capabilities_json, '{}',
      'hidden rows are the user\'s call — sync must not write to them at all');
  });

  it('a catalog entry with no capabilities does not erase discovered ones', () => {
    // A catalog entry may intentionally omit capabilities. If the sync wrote
    // `{}` unconditionally it would clobber whatever discovery found.
    const providerId = createScratchProvider(GLM_BASE_URL);
    upsertProviderModel({
      provider_id: providerId,
      model_id: 'haiku',
      upstream_model_id: 'haiku',
      display_name: 'stale',
      capabilities_json: JSON.stringify({ contextWindow: 128000 }),
      variants_json: '{}',
      sort_order: 0,
      enabled: 1,
      source: 'api',
      last_refreshed_at: '2026-01-01 00:00:00',
      user_edited: 0,
      enable_source: 'recommended',
    });

    const catalog = [{
      modelId: 'haiku',
      upstreamModelId: 'glm-4.7',
      displayName: 'GLM-4.7',
    }];
    alignEnabledWithCatalog(providerId, catalog);

    const row = getAllModelsForProvider(providerId).find(r => r.model_id === 'haiku')!;
    assert.equal(row.display_name, 'GLM-4.7', 'system-managed display name should realign');
    assert.deepEqual(JSON.parse(row.capabilities_json || '{}'), { contextWindow: 128000 },
      'a catalog that is merely silent about capabilities must not erase the column');
  });
});
