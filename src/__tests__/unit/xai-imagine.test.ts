import '../db-isolation.setup';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import fs from 'node:fs';
import { getDb } from '@/lib/db';
import {
  generateGrokVideo,
  requestGrokImagineImage,
  XAI_IMAGINE_IMAGE_MODEL,
  XAI_IMAGINE_VIDEO_MODEL,
} from '@/lib/xai-imagine';
import {
  clearXaiOAuthTokens,
  saveXaiOAuthTokens,
} from '@/lib/xai-oauth-manager';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const savedPaths = new Set<string>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function inputUrl(input: RequestInfo | URL): string {
  return typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
}

beforeEach(() => {
  process.env.CODEPILOT_XAI_OAUTH_ENABLED = '1';
  clearXaiOAuthTokens();
  saveXaiOAuthTokens({
    accessToken: 'fresh-media-access',
    expiresAt: Date.now() + 3_600_000,
  });
});

afterEach(() => {
  clearXaiOAuthTokens();
  for (const localPath of savedPaths) {
    try { fs.unlinkSync(localPath); } catch { /* best-effort fixture cleanup */ }
  }
  savedPaths.clear();
});

describe('Grok Imagine image wire contract', () => {
  it('uses the official image model and public generation endpoint without proxy-only headers', async () => {
    let url = '';
    let headers = new Headers();
    let payload: Record<string, unknown> = {};
    const fetchImpl = (async (input, init) => {
      url = inputUrl(input);
      headers = new Headers(init?.headers);
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ data: [{ b64_json: PNG_BASE64 }], model: XAI_IMAGINE_IMAGE_MODEL });
    }) as typeof fetch;

    const result = await requestGrokImagineImage({
      prompt: 'A small blue planet',
      aspectRatio: '16:9',
      resolution: '2k',
      quality: 'medium',
    }, { fetchImpl });

    assert.equal(url, 'https://api.x.ai/v1/images/generations');
    assert.equal(headers.get('authorization'), 'Bearer fresh-media-access');
    assert.equal(headers.get('x-grok-client-version'), '1.0.3');
    assert.equal(headers.get('x-grok-client-identifier'), 'codepilot');
    assert.equal(headers.get('x-xai-token-auth'), null);
    assert.equal(headers.get('x-authenticateresponse'), null);
    assert.equal(headers.get('x-grok-client-mode'), null);
    assert.equal(headers.get('x-grok-model-override'), null);
    assert.deepEqual(payload, {
      model: XAI_IMAGINE_IMAGE_MODEL,
      prompt: 'A small blue planet',
      n: 1,
      resolution: '2k',
      quality: 'medium',
      response_format: 'b64_json',
      aspect_ratio: '16:9',
    });
    assert.equal(result.mimeType, 'image/png');
    assert.equal(result.bytes.length > 0, true);
  });

  it('switches to the official edit endpoint and sends references as data URLs', async () => {
    let payload: Record<string, unknown> = {};
    let url = '';
    const fetchImpl = (async (input, init) => {
      url = inputUrl(input);
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ data: [{ b64_json: PNG_BASE64 }] });
    }) as typeof fetch;

    await requestGrokImagineImage({
      prompt: 'Keep the subject and change the lighting',
      referenceImages: [{ mimeType: 'image/png', data: PNG_BASE64 }],
    }, { fetchImpl });

    assert.equal(url, 'https://api.x.ai/v1/images/edits');
    assert.deepEqual(payload.image, { url: `data:image/png;base64,${PNG_BASE64}` });
    assert.equal('images' in payload, false);
    assert.equal('aspect_ratio' in payload, false);
  });
});

describe('Grok Imagine video generation contract', () => {
  it('starts, polls with OAuth on every request, downloads and registers a Gallery video', async () => {
    const calls: Array<{ url: string; method: string; headers: Headers; payload?: Record<string, unknown> }> = [];
    let pollCount = 0;
    const fetchImpl = (async (input, init) => {
      const url = inputUrl(input);
      const method = String(init?.method || 'GET');
      calls.push({
        url,
        method,
        headers: new Headers(init?.headers),
        payload: init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined,
      });
      if (url.endsWith('/videos/generations')) return jsonResponse({ request_id: 'video_req_123' });
      pollCount += 1;
      return pollCount === 1
        ? jsonResponse({ status: 'pending' })
        : jsonResponse({ status: 'done', video: { url: 'https://vidgen.x.ai/test/output.mp4' } });
    }) as typeof fetch;
    let downloadedUrl = '';
    const downloadFetchImpl = (async (input) => {
      downloadedUrl = inputUrl(input);
      return new Response(Buffer.from('synthetic-mp4-bytes'), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      });
    }) as typeof fetch;

    const result = await generateGrokVideo({
      prompt: 'A paper spaceship crosses a star field',
      duration: 10,
      resolution: '720p',
      aspectRatio: '9:16',
      sessionId: 'grok-video-session',
      runtimeId: 'codex_runtime',
    }, { fetchImpl, downloadFetchImpl, pollIntervalMs: 0 });
    savedPaths.add(result.localPath);

    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, 'https://api.x.ai/v1/videos/generations');
    assert.equal(calls[0].method, 'POST');
    assert.deepEqual(calls[0].payload, {
      model: XAI_IMAGINE_VIDEO_MODEL,
      prompt: 'A paper spaceship crosses a star field',
      duration: 10,
      resolution: '720p',
      aspect_ratio: '9:16',
    });
    for (const call of calls) {
      assert.equal(call.headers.get('authorization'), 'Bearer fresh-media-access');
      assert.equal(call.headers.get('x-grok-client-version'), '1.0.3');
      assert.equal(call.headers.get('x-grok-model-override'), null);
      assert.equal(call.headers.get('x-xai-token-auth'), null);
    }
    assert.equal(calls[1].url, 'https://api.x.ai/v1/videos/video_req_123');
    assert.equal(calls[2].url, calls[1].url);
    assert.equal(downloadedUrl, 'https://vidgen.x.ai/test/output.mp4');
    assert.deepEqual(fs.readFileSync(result.localPath), Buffer.from('synthetic-mp4-bytes'));
    assert.equal(result.mimeType, 'video/mp4');

    const row = getDb().prepare(
      'SELECT type, provider, model, session_id, metadata FROM media_generations WHERE id = ?',
    ).get(result.mediaGenerationId) as {
      type: string;
      provider: string;
      model: string;
      session_id: string;
      metadata: string;
    };
    assert.equal(row.type, 'video');
    assert.equal(row.provider, 'xai-oauth');
    assert.equal(row.model, XAI_IMAGINE_VIDEO_MODEL);
    assert.equal(row.session_id, 'grok-video-session');
    assert.equal(JSON.parse(row.metadata).runtimeId, 'codex_runtime');
  });

  it('refuses an untrusted download host before issuing a download request', async () => {
    const fetchImpl = (async (input) => inputUrl(input).endsWith('/videos/generations')
      ? jsonResponse({ request_id: 'video_req_untrusted' })
      : jsonResponse({ status: 'done', video: { url: 'https://attacker.example/output.mp4' } })) as typeof fetch;
    let downloads = 0;
    const downloadFetchImpl = (async () => {
      downloads += 1;
      return new Response('should-not-run');
    }) as typeof fetch;

    await assert.rejects(
      () => generateGrokVideo({ prompt: 'test security boundary' }, {
        fetchImpl,
        downloadFetchImpl,
        pollIntervalMs: 0,
      }),
      /outside the approved xAI download hosts/,
    );
    assert.equal(downloads, 0);
  });

  it('rejects a non-video download response before persistence', async () => {
    const fetchImpl = (async (input) => inputUrl(input).endsWith('/videos/generations')
      ? jsonResponse({ request_id: 'video_req_wrong_type' })
      : jsonResponse({ status: 'done', video: { url: 'https://vidgen.x.ai/test/output.mp4' } })) as typeof fetch;
    const downloadFetchImpl = (async () => new Response('<html>not a video</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })) as typeof fetch;

    await assert.rejects(
      () => generateGrokVideo({ prompt: 'test media type boundary' }, {
        fetchImpl,
        downloadFetchImpl,
        pollIntervalMs: 0,
      }),
      /unsupported video content type/,
    );
  });

  it('stops before the next poll, leaves no Gallery row, and releases abort listeners', async () => {
    const controller = new AbortController();
    const sessionId = 'grok-video-abort-before-poll';
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
    let pollCalls = 0;
    const fetchImpl = (async (input) => {
      if (inputUrl(input).endsWith('/videos/generations')) {
        resolveStarted();
        return jsonResponse({ request_id: 'video_req_abort' });
      }
      pollCalls += 1;
      return jsonResponse({ status: 'pending' });
    }) as typeof fetch;

    const generation = generateGrokVideo({
      prompt: 'A test video that will be cancelled',
      sessionId,
      abortSignal: controller.signal,
    }, {
      fetchImpl,
      pollIntervalMs: 10_000,
    });
    await started;
    controller.abort(new Error('user stopped media generation'));

    await assert.rejects(generation, /user stopped media generation/);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(pollCalls, 0, 'no poll may start after cancellation');
    const persisted = getDb().prepare(
      'SELECT COUNT(*) AS count FROM media_generations WHERE session_id = ?',
    ).get(sessionId) as { count: number };
    assert.equal(persisted.count, 0, 'cancelled generation must not create a Gallery row');
    assert.equal(
      getEventListeners(controller.signal, 'abort').length,
      0,
      'the caller signal must not retain abort listeners after settlement',
    );
  });

  it('preserves an already completed download when cancellation arrives before persistence', async () => {
    const controller = new AbortController();
    const sessionId = 'grok-video-completed-before-abort';
    const fetchImpl = (async (input) => inputUrl(input).endsWith('/videos/generations')
      ? jsonResponse({ request_id: 'video_req_completed' })
      : jsonResponse({ status: 'done', video: { url: 'https://vidgen.x.ai/test/completed.mp4' } })) as typeof fetch;
    const downloadFetchImpl = (async () => {
      const completedResponse = new Response(Buffer.from('completed-and-billable-video'), {
        status: 200,
        headers: { 'content-type': 'video/mp4' },
      });
      controller.abort(new Error('stop arrived after download completed'));
      return completedResponse;
    }) as typeof fetch;

    const result = await generateGrokVideo({
      prompt: 'Keep a completed result even if stop arrives late',
      sessionId,
      abortSignal: controller.signal,
    }, {
      fetchImpl,
      downloadFetchImpl,
      pollIntervalMs: 0,
    });
    savedPaths.add(result.localPath);

    assert.deepEqual(fs.readFileSync(result.localPath), Buffer.from('completed-and-billable-video'));
    const persisted = getDb().prepare(
      'SELECT COUNT(*) AS count FROM media_generations WHERE id = ? AND session_id = ?',
    ).get(result.mediaGenerationId, sessionId) as { count: number };
    assert.equal(persisted.count, 1, 'completed upstream output is retained instead of discarded');
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  });
});
