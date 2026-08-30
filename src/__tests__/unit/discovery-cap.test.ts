/**
 * Tests for the SAMPLE_CAP fix in model-discovery + discover-models route.
 *
 * Bug: `result.sampleModels` is capped at 500 for response size, but the
 * /discover-models route was using it as both the diff source AND the
 * "seen in upstream" set. For aggregators that legitimately serve > 500
 * model ids:
 *   - tail entries beyond 500 silently dropped from DB writes
 *   - existing DB rows for those tail entries got mis-flagged as orphan
 *
 * Fix: discoverModels now returns `fullModelIds` (uncapped) for diff +
 * seen logic; `sampleModels` stays as the UI display slice.
 *
 * These tests stub fetch with a synthetic large catalog and assert that
 * the discovery layer keeps the full list in `fullModelIds`.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { discoverModels } from '../../lib/model-discovery';

const ORIGINAL_FETCH = global.fetch;

function stubFetchWithIds(ids: string[]) {
  // OpenAI-compatible /v1/models response shape
  global.fetch = (async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ data: ids.map(id => ({ id })) }),
    text: async () => JSON.stringify({ data: ids.map(id => ({ id })) }),
  })) as unknown as typeof fetch;
}

function restoreFetch() {
  global.fetch = ORIGINAL_FETCH;
}

describe('discoverModels — SAMPLE_CAP must not truncate apply/diff source of truth', () => {
  beforeEach(() => { /* fresh stub per test */ });
  afterEach(restoreFetch);

  it('returns ALL upstream ids in fullModelIds even when count exceeds 500', async () => {
    const huge = Array.from({ length: 750 }, (_, i) => `model-${i}`);
    stubFetchWithIds(huge);

    const result = await discoverModels({
      protocol: 'openai-compatible',
      baseUrl: 'https://example.test',
      apiKey: 'sk-test',
    });

    assert.equal(result.ok, true);
    assert.equal(result.modelCount, 750, 'modelCount reflects full upstream count');
    assert.equal(result.fullModelIds?.length, 750,
      'fullModelIds must NEVER be truncated — it is the apply/diff source');
    assert.equal(result.sampleModels?.length, 500,
      'sampleModels stays capped at 500 for UI response size');
    // The 700th entry must survive in fullModelIds — that's the bug we fixed.
    assert.equal(result.fullModelIds?.[700], 'model-700',
      'tail entry beyond SAMPLE_CAP survives in fullModelIds');
    // …and must NOT appear in the capped sample.
    assert.equal(result.sampleModels?.includes('model-700'), false,
      'tail entry correctly absent from the capped UI sample');
  });

  it('small upstream catalogs end up identical between fullModelIds and sampleModels', async () => {
    const small = ['sonnet', 'opus', 'haiku'];
    stubFetchWithIds(small);

    const result = await discoverModels({
      protocol: 'openai-compatible',
      baseUrl: 'https://example.test',
      apiKey: 'sk-test',
    });

    assert.deepEqual(result.fullModelIds, small);
    assert.deepEqual(result.sampleModels, small);
  });

  it('ok=false probes do not produce a fullModelIds list', async () => {
    global.fetch = (async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers(),
      json: async () => ({ error: { message: 'bad key' } }),
      text: async () => '{"error":{"message":"bad key"}}',
    })) as unknown as typeof fetch;

    const result = await discoverModels({
      protocol: 'openai-compatible',
      baseUrl: 'https://example.test',
      apiKey: 'sk-test',
    });

    assert.equal(result.ok, false);
    assert.equal(result.fullModelIds, undefined,
      'failed probes have no model list — never falsely report ids');
  });
});
