import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  modelRouteFavoriteIdentity,
  modelRouteIdentity,
  parseModelRouteFavorites,
  rankModelRoutes,
  serializeModelRouteFavorites,
  toggleModelRouteFavorite,
  type ModelRouteFavoriteV2,
} from '@/lib/model-route-favorites';

const favorite = (
  providerInstanceId: string,
  modelId: string,
  runtimeId: ModelRouteFavoriteV2['runtimeId'] = 'claude_code',
): ModelRouteFavoriteV2 => ({
  runtimeId,
  providerInstanceId,
  modelId,
  providerNameSnapshot: `provider-${providerInstanceId}`,
  modelNameSnapshot: `model-${modelId}`,
  createdAt: 10,
});

describe('model route favorites', () => {
  it('keys the exact Runtime + provider instance + model combination', () => {
    assert.notEqual(modelRouteIdentity('provider-a', 'same'), modelRouteIdentity('provider-b', 'same'));
    assert.notEqual(
      modelRouteFavoriteIdentity('claude_code', 'provider-a', 'same'),
      modelRouteFavoriteIdentity('codex_runtime', 'provider-a', 'same'),
    );
    let rows = toggleModelRouteFavorite([], favorite('provider-a', 'same'));
    rows = toggleModelRouteFavorite(rows, favorite('provider-b', 'same'));
    rows = toggleModelRouteFavorite(rows, favorite('provider-a', 'same', 'codex_runtime'));
    assert.equal(rows.length, 3);
    rows = toggleModelRouteFavorite(rows, favorite('provider-a', 'same'));
    assert.deepEqual(rows.map((row) => [row.runtimeId, row.providerInstanceId]), [
      ['codex_runtime', 'provider-a'],
      ['claude_code', 'provider-b'],
    ]);
  });

  it('round-trips the versioned snapshot envelope and rejects corrupt data', () => {
    const rows = [favorite('provider-a', 'model-a')];
    assert.deepEqual(parseModelRouteFavorites(serializeModelRouteFavorites(rows)), rows);
    assert.deepEqual(parseModelRouteFavorites('{bad'), []);
    assert.deepEqual(parseModelRouteFavorites(JSON.stringify({ version: 3, favorites: rows })), []);
  });

  it('deduplicates duplicate exact combinations without collapsing Runtime variants', () => {
    const first = favorite('provider-a', 'model-a');
    const duplicate = { ...first, providerNameSnapshot: 'new snapshot' };
    const codex = favorite('provider-a', 'model-a', 'codex_runtime');
    const parsed = parseModelRouteFavorites(JSON.stringify({
      version: 2,
      favorites: [first, duplicate, codex],
    }));
    assert.deepEqual(parsed, [first, codex]);
  });

  it('rejects the unreleased V1 shape instead of guessing a Runtime', () => {
    const legacy = {
      providerInstanceId: 'provider-a',
      modelId: 'model-a',
      providerNameSnapshot: 'Provider A',
      modelNameSnapshot: 'Model A',
      createdAt: 10,
    };
    assert.deepEqual(parseModelRouteFavorites(JSON.stringify({
      version: 1,
      favorites: [legacy],
    })), []);
  });
});

describe('model route search ranking', () => {
  const routes = [
    { providerInstanceId: '1', providerName: 'Codex', modelId: 'gpt-5.6-sol', modelName: 'GPT-5.6-Sol', catalogOrder: 0, favorite: false },
    { providerInstanceId: '2', providerName: 'Favorite proxy', modelId: 'old-gpt', modelName: 'An older GPT', catalogOrder: 1, favorite: true },
    { providerInstanceId: '3', providerName: 'Anthropic', modelId: 'claude-opus-5', modelName: 'Claude Opus 5', catalogOrder: 2, favorite: false },
  ];

  it('does not let favorite boost beat an exact/prefix text match', () => {
    assert.equal(rankModelRoutes(routes, 'gpt-5.6-sol')[0]?.providerInstanceId, '1');
  });

  it('searches provider names as well as model names and ids', () => {
    assert.deepEqual(rankModelRoutes(routes, 'anthropic').map((row) => row.providerInstanceId), ['3']);
  });

  it('puts favorites first when no query is present', () => {
    assert.equal(rankModelRoutes(routes, '')[0]?.providerInstanceId, '2');
  });
});
