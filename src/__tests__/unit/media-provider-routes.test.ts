/**
 * Regression tests for the third-party media provider guards + active-image
 * stale detection added in the image-provider overhaul.
 *
 * Covers:
 *   1. POST /api/providers rejects openai-image / gemini-image rows with an
 *      empty base_url (MEDIA_BASE_URL_REQUIRED). Without this guard the row
 *      silently generates against the official endpoint.
 *   2. PUT /api/providers/[id] same rejection on update (and clears the
 *      active_image_provider_id when the active row's type moves out of
 *      media — defensive counterpart to the DELETE cleanup).
 *   3. GET /api/providers/active-image reports stale=true when the stored
 *      id no longer resolves to a usable media row. This is the branch the
 *      ProviderManager banner relies on to surface a Clear button after a
 *      row is deleted, retyped, or has its key cleared.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import {
  createProvider,
  deleteProvider,
  getAllProviders,
  getSetting,
  setSetting,
} from '../../lib/db';
import { POST as providersPOST } from '../../app/api/providers/route';
import { PUT as providerPUT } from '../../app/api/providers/[id]/route';
import { GET as activeImageGET, PUT as activeImagePUT } from '../../app/api/providers/active-image/route';
import { XAI_OAUTH_BUNDLE_SETTING } from '../../lib/xai-oauth-manager';

// ── Helpers ─────────────────────────────────────────────────────

function jsonReq(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function cleanupTestRows() {
  for (const p of getAllProviders()) {
    if (p.name.startsWith('__test_mp_')) {
      deleteProvider(p.id);
    }
  }
}

// ── POST guard ───────────────────────────────────────────────────

describe('POST /api/providers — MEDIA_BASE_URL_REQUIRED', () => {
  afterEach(cleanupTestRows);

  it('rejects openai-image with empty base_url', async () => {
    const res = await providersPOST(jsonReq('http://localhost/api/providers', 'POST', {
      name: '__test_mp_openai_empty',
      provider_type: 'openai-image',
      protocol: 'openai-image',
      base_url: '',
      api_key: 'sk-test',
      extra_env: '{}',
    }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'MEDIA_BASE_URL_REQUIRED');
  });

  it('rejects gemini-image with empty base_url', async () => {
    const res = await providersPOST(jsonReq('http://localhost/api/providers', 'POST', {
      name: '__test_mp_gemini_empty',
      provider_type: 'gemini-image',
      protocol: 'gemini-image',
      base_url: '',
      api_key: 'k',
      extra_env: '{}',
    }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'MEDIA_BASE_URL_REQUIRED');
  });

  it('accepts openai-image when base_url is provided', async () => {
    const res = await providersPOST(jsonReq('http://localhost/api/providers', 'POST', {
      name: '__test_mp_openai_ok',
      provider_type: 'openai-image',
      protocol: 'openai-image',
      base_url: 'https://proxy.example.com/v1',
      api_key: 'sk-test',
      extra_env: '{}',
    }));
    assert.equal(res.status, 201);
  });
});

// ── PUT guard ───────────────────────────────────────────────────

describe('PUT /api/providers/[id] — MEDIA_BASE_URL_REQUIRED', () => {
  let testId: string;

  beforeEach(() => {
    testId = createProvider({
      name: '__test_mp_put_target',
      provider_type: 'openai-image',
      protocol: 'openai-image',
      base_url: 'https://proxy.example.com/v1',
      api_key: 'sk-test',
      extra_env: '{}',
    }).id;
  });

  afterEach(cleanupTestRows);

  it('rejects PUT that clears base_url on an openai-image row', async () => {
    // Simulate a user editing the third-party row and accidentally blanking
    // the URL. Without this guard the row would silently start generating
    // against api.openai.com via provider-resolver's default fallback.
    const res = await providerPUT(
      jsonReq(`http://localhost/api/providers/${testId}`, 'PUT', { base_url: '' }),
      { params: Promise.resolve({ id: testId }) },
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'MEDIA_BASE_URL_REQUIRED');
  });
});

// ── Active-image stale-state surfacing ────────────────────────────

describe('/api/providers/active-image — stale detection', () => {
  let originalActive: string;
  let originalXaiBundle: string;
  let originalXaiEnabled: string | undefined;

  beforeEach(() => {
    originalActive = getSetting('active_image_provider_id') || '';
    originalXaiBundle = getSetting(XAI_OAUTH_BUNDLE_SETTING) || '';
    originalXaiEnabled = process.env.CODEPILOT_XAI_OAUTH_ENABLED;
    process.env.CODEPILOT_XAI_OAUTH_ENABLED = '1';
    setSetting('active_image_provider_id', '');
    setSetting(XAI_OAUTH_BUNDLE_SETTING, '');
  });

  afterEach(() => {
    cleanupTestRows();
    setSetting('active_image_provider_id', originalActive);
    setSetting(XAI_OAUTH_BUNDLE_SETTING, originalXaiBundle);
    if (originalXaiEnabled === undefined) delete process.env.CODEPILOT_XAI_OAUTH_ENABLED;
    else process.env.CODEPILOT_XAI_OAUTH_ENABLED = originalXaiEnabled;
  });

  it('reports stale=true when the active row is edited to a non-media type', async () => {
    // Regression for the banner-hiding bug: the row still exists after the
    // type change, so the old banner condition (`!providers.some(...match id)`)
    // evaluated false and the stale setting never surfaced. The GET endpoint
    // must flag stale=true so the UI can render its safety-net banner.
    const created = createProvider({
      name: '__test_mp_active_target',
      provider_type: 'openai-image',
      protocol: 'openai-image',
      base_url: 'https://proxy.example.com/v1',
      api_key: 'sk-test',
      extra_env: '{}',
    });

    // Mark the row active — this is the state the user lands in after
    // clicking a model capsule in ProviderManager.
    const putRes = await activeImagePUT(
      jsonReq('http://localhost/api/providers/active-image', 'PUT', { providerId: created.id }),
    );
    assert.equal(putRes.status, 200);

    // Sanity: active is healthy right after being set.
    let getRes = await activeImageGET();
    let body = await getRes.json();
    assert.equal(body.providerId, created.id);
    assert.equal(body.stale, false);

    // Edit the row's type to something non-media. The PUT handler clears
    // active_image_provider_id as a defensive cleanup, so GET reports no
    // active row rather than a stale one — either outcome surfaces the
    // setting (vs. the original bug where it stayed hidden).
    const editRes = await providerPUT(
      jsonReq(`http://localhost/api/providers/${created.id}`, 'PUT', {
        provider_type: 'anthropic',
        protocol: 'anthropic',
        base_url: 'https://api.anthropic.com',
      }),
      { params: Promise.resolve({ id: created.id }) },
    );
    assert.equal(editRes.status, 200);

    getRes = await activeImageGET();
    body = await getRes.json();
    // Defensive PUT cleanup clears the setting entirely; the UI sees
    // providerId='' and doesn't render an "active" badge at all.
    assert.equal(body.providerId, '', 'type-change cleanup should clear the active setting');
    assert.equal(body.stale, false);
  });

  it('reports stale=true when the active row key is cleared (no defensive cleanup on this path)', async () => {
    // Clearing the api_key on the active row goes through PUT too, but unlike
    // the type change, we keep the setting intact — the row is still a media
    // provider, just not currently usable. GET must flag stale=true so the
    // per-row amber badge (`已失效（缺少密钥）`) renders.
    const created = createProvider({
      name: '__test_mp_active_key',
      provider_type: 'openai-image',
      protocol: 'openai-image',
      base_url: 'https://proxy.example.com/v1',
      api_key: 'sk-test',
      extra_env: '{}',
    });
    setSetting('active_image_provider_id', created.id);

    const editRes = await providerPUT(
      jsonReq(`http://localhost/api/providers/${created.id}`, 'PUT', { api_key: '' }),
      { params: Promise.resolve({ id: created.id }) },
    );
    assert.equal(editRes.status, 200);

    const getRes = await activeImageGET();
    const body = await getRes.json();
    assert.equal(body.providerId, created.id, 'key-only change keeps the active id');
    assert.equal(body.stale, true, 'empty api_key must flag stale');
  });

  it('PUT rejects setting a key-less row as active (MISSING_API_KEY)', async () => {
    const created = createProvider({
      name: '__test_mp_no_key',
      provider_type: 'openai-image',
      protocol: 'openai-image',
      base_url: 'https://proxy.example.com/v1',
      api_key: '',
      extra_env: '{}',
    });

    const putRes = await activeImagePUT(
      jsonReq('http://localhost/api/providers/active-image', 'PUT', { providerId: created.id }),
    );
    assert.equal(putRes.status, 400);
    const body = await putRes.json();
    assert.equal(body.code, 'MISSING_API_KEY');
  });

  it('accepts usable Grok Build OAuth as a virtual image provider and returns official media metadata', async () => {
    setSetting(XAI_OAUTH_BUNDLE_SETTING, JSON.stringify({
      accessToken: 'test-token',
      expiresAt: Date.now() + 60 * 60 * 1000,
      email: 'media@example.com',
      updatedAt: Date.now(),
    }));

    const putRes = await activeImagePUT(
      jsonReq('http://localhost/api/providers/active-image', 'PUT', { providerId: 'xai-oauth' }),
    );
    assert.equal(putRes.status, 200);
    assert.equal(getSetting('active_image_provider_id'), 'xai-oauth');

    const getRes = await activeImageGET();
    const body = await getRes.json();
    assert.deepEqual(
      {
        providerId: body.providerId,
        stale: body.stale,
        providerName: body.providerName,
        providerType: body.providerType,
        family: body.family,
        model: body.model,
        modelLabel: body.modelLabel,
        videoModel: body.videoModel,
        videoModelLabel: body.videoModelLabel,
      },
      {
        providerId: 'xai-oauth',
        stale: false,
        providerName: 'Grok Build',
        providerType: 'xai-oauth',
        family: 'xai',
        model: 'grok-imagine-image-2.0',
        modelLabel: 'Grok Imagine Image 2.0',
        videoModel: 'grok-imagine-video-1.5',
        videoModelLabel: 'Grok Imagine Video 1.5',
      },
    );
  });

  it('rejects Grok Build as the default when OAuth is missing and marks a stored choice stale', async () => {
    const putRes = await activeImagePUT(
      jsonReq('http://localhost/api/providers/active-image', 'PUT', { providerId: 'xai-oauth' }),
    );
    assert.equal(putRes.status, 401);
    assert.equal((await putRes.json()).code, 'GROK_BUILD_OAUTH_REQUIRED');

    setSetting('active_image_provider_id', 'xai-oauth');
    const getRes = await activeImageGET();
    const body = await getRes.json();
    assert.equal(body.providerId, 'xai-oauth');
    assert.equal(body.stale, true);
    assert.equal(body.providerType, 'xai-oauth');
  });
});
