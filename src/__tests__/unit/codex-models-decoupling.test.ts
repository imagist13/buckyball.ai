/**
 * P0.3 (2026-06-01) — Codex model discovery must NOT block the global
 * model feed. A broken/old Codex app-server was hanging
 * `/api/providers/models` ~30s, freezing Settings overview, the chat
 * composer ("正在准备运行环境"), and the runtime health card.
 *
 * These tests drive listCodexModels / buildCodexProviderModelGroup through
 * a DI seam (fake app-server) so we can assert the spawn-decoupling
 * contract without a real subprocess:
 *   - cacheOnly never touches the app-server (no spawn).
 *   - a hung model/list rejects at the timeout instead of hanging.
 *
 * See docs/preview/packaged-preview-p0-diagnosis-2026-06-01.md
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  listCodexModels,
  buildCodexProviderModelGroup,
  invalidateCodexModelsCache,
} from '@/lib/codex/models';

const MODELS_RESULT = {
  data: [
    {
      id: 'gpt-5.5',
      model: 'gpt-5.5',
      displayName: 'GPT-5.5',
      description: '',
      hidden: false,
      isDefault: true,
      supportedReasoningEfforts: [{ effort: 'medium' }, { effort: 'high' }],
      defaultReasoningEffort: 'medium',
      inputModalities: ['text'],
    },
  ],
  nextCursor: null,
};

/** Fake app-server provider — a DI seam standing in for getCodexAppServer. */
function fakeAppServer(behavior: 'ok' | 'hang' | 'throw') {
  let calls = 0;
  return {
    get: async () => {
      calls++;
      if (behavior === 'throw') throw new Error('spawn refused (fake)');
      return {
        client: {
          request: <T>(): Promise<T> => {
            if (behavior === 'hang') return new Promise<T>(() => { /* never resolves */ });
            return Promise.resolve(MODELS_RESULT as T);
          },
        },
      };
    },
    calls: () => calls,
  };
}

describe('listCodexModels — P0.3 spawn decoupling', () => {
  beforeEach(() => invalidateCodexModelsCache());

  it('cacheOnly with empty cache returns [] and NEVER touches the app-server (no spawn)', async () => {
    const fake = fakeAppServer('throw'); // would throw if spawned
    const models = await listCodexModels({ cacheOnly: true }, fake.get);
    assert.deepEqual([...models], []);
    assert.equal(fake.calls(), 0, 'cacheOnly must not spawn the app-server');
  });

  it('timeoutMs rejects near the deadline when model/list never returns (does not hang)', async () => {
    const fake = fakeAppServer('hang');
    const start = Date.now();
    await assert.rejects(listCodexModels({ timeoutMs: 150 }, fake.get), /timed out/);
    assert.ok(Date.now() - start < 1500, 'must reject near the timeout, not hang');
  });

  it('aborts the underlying model/list RPC at the same deadline', async () => {
    let observedAbort = false;
    const get = async () => ({
      client: {
        request: <T>(
          _method: string,
          _params?: unknown,
          options?: { signal?: AbortSignal },
        ): Promise<T> => new Promise<T>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            observedAbort = true;
            reject(new Error('underlying aborted'));
          }, { once: true });
        }),
      },
    });
    await assert.rejects(listCodexModels({ timeoutMs: 40 }, get), /timed out/);
    assert.equal(observedAbort, true);
  });

  it('shares one server-side model/list across ten concurrent callers', async () => {
    let getCalls = 0;
    let requestCalls = 0;
    const get = async () => {
      getCalls += 1;
      return {
        client: {
          request: async <T>() => {
            requestCalls += 1;
            await new Promise((resolve) => setTimeout(resolve, 20));
            return MODELS_RESULT as T;
          },
        },
      };
    };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => listCodexModels({ timeoutMs: 500 }, get)),
    );
    assert.equal(getCalls, 1);
    assert.equal(requestCalls, 1);
    assert.ok(results.every((models) => models[0]?.id === 'gpt-5.5'));
  });

  it('enters cooldown after failure and explicit force bypasses it', async () => {
    const hung = fakeAppServer('hang');
    await assert.rejects(listCodexModels({ timeoutMs: 30 }, hung.get), /timed out/);

    const healthy = fakeAppServer('ok');
    await assert.rejects(listCodexModels({}, healthy.get), /cooling down/);
    assert.equal(healthy.calls(), 0, 'cooldown must not touch the app-server');

    const models = await listCodexModels({ force: true }, healthy.get);
    assert.equal(models[0]?.id, 'gpt-5.5');
    assert.equal(healthy.calls(), 1);
  });

  it('returns mapped models on the happy path', async () => {
    const fake = fakeAppServer('ok');
    const models = await listCodexModels({}, fake.get);
    assert.equal(models.length, 1);
    assert.equal(models[0].id, 'gpt-5.5');
    assert.deepEqual([...models[0].supportedReasoningEfforts], ['medium', 'high']);
  });

  it('cacheOnly serves a warm cache populated by a prior fetch (still no spawn)', async () => {
    await listCodexModels({}, fakeAppServer('ok').get); // populate cache
    const fake = fakeAppServer('throw');
    const models = await listCodexModels({ cacheOnly: true }, fake.get);
    assert.equal(models.length, 1, 'warm cache should be served');
    assert.equal(fake.calls(), 0, 'cacheOnly must not spawn even to refresh');
  });
});

describe('buildCodexProviderModelGroup — P0.3', () => {
  beforeEach(() => invalidateCodexModelsCache());

  it('cacheOnly with empty cache returns null without spawning', async () => {
    const fake = fakeAppServer('throw');
    const group = await buildCodexProviderModelGroup({ cacheOnly: true }, fake.get);
    assert.equal(group, null);
    assert.equal(fake.calls(), 0);
  });

  it('returns a codex_account group when the app-server yields models', async () => {
    const fake = fakeAppServer('ok');
    const group = await buildCodexProviderModelGroup({}, fake.get);
    assert.ok(group);
    assert.equal(group!.provider_id, 'codex_account');
    assert.equal(group!.models.length, 1);
  });

  it('returns null (degraded) when model/list times out — no Codex group, no throw', async () => {
    const fake = fakeAppServer('hang');
    const group = await buildCodexProviderModelGroup({ timeoutMs: 150 }, fake.get);
    assert.equal(group, null);
  });
});

describe('providers/models route — P0.3 spawn-policy source pins', () => {
  const routeSrc = fs.readFileSync(
    path.resolve(__dirname, '../../app/api/providers/models/route.ts'),
    'utf8',
  );

  it('full-catalog (no runtime) path uses cacheOnly — never spawns Codex', () => {
    assert.match(
      routeSrc,
      /else if \(!runtimeFilter\)[\s\S]{0,400}cacheOnly:\s*true/,
      'the no-runtime full-catalog branch must call buildCodexProviderModelGroup({ cacheOnly: true })',
    );
  });

  it('codex_runtime path bounds the spawn with a timeout', () => {
    assert.match(
      routeSrc,
      /runtimeFilter === 'codex_runtime'[\s\S]{0,400}timeoutMs:/,
      'the codex_runtime branch must pass a timeoutMs so a slow app-server degrades instead of hanging',
    );
  });

  it('recovery safe mode makes the codex_runtime path cache-only', () => {
    assert.match(routeSrc, /isServerRecoverySafeMode\(\)[\s\S]{0,160}cacheOnly:\s*true/);
  });

  it('never calls buildCodexProviderModelGroup with no options (the old unconditional spawn)', () => {
    assert.doesNotMatch(
      routeSrc,
      /buildCodexProviderModelGroup\(\)/,
      'the bare no-arg call would spawn from the full-catalog path — must pass cacheOnly/timeoutMs',
    );
  });
});
