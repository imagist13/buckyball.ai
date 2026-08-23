import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  invalidateCodexModelCatalogWarmup,
  isCodexRecoverySafeModeVisible,
  resetCodexModelCatalogWarmupForTests,
  warmCodexModelCatalog,
} from '@/lib/codex/model-catalog-warmup';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Codex model catalog chat warm-up', () => {
  beforeEach(() => resetCodexModelCatalogWarmupForTests());

  it('deduplicates concurrent chat consumers and emits readiness once', async () => {
    const response = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    let fetchCalls = 0;
    let readyEvents = 0;
    const fakeFetch = () => {
      fetchCalls += 1;
      return response.promise;
    };

    const first = warmCodexModelCatalog(fakeFetch, () => { readyEvents += 1; });
    const second = warmCodexModelCatalog(fakeFetch, () => { readyEvents += 1; });

    assert.strictEqual(first, second, 'ChatView and MessageInput must share one warm-up');
    assert.equal(fetchCalls, 1);

    response.resolve({
      ok: true,
      json: async () => ({ group: { models: [{ value: 'gpt-5.6' }] } }),
    });
    await Promise.all([first, second]);

    assert.equal(readyEvents, 1, 'one successful warm-up should trigger one catalog refresh');

    await warmCodexModelCatalog(fakeFetch, () => { readyEvents += 1; });
    assert.equal(fetchCalls, 1, 'a successful catalog stays memoized across chat remounts');
    assert.equal(readyEvents, 1, 'a remount must not churn the full model feed');

    invalidateCodexModelCatalogWarmup();
    const refreshed = warmCodexModelCatalog(async () => {
      fetchCalls += 1;
      return {
        ok: true,
        json: async () => ({ group: { models: [{ value: 'gpt-5.6' }] } }),
      };
    }, () => { readyEvents += 1; });
    await refreshed;
    assert.equal(fetchCalls, 2, 'a provider/account mutation must re-enable discovery');
    assert.equal(readyEvents, 2);
  });

  it('does not emit for an empty result and allows a later retry', async () => {
    let fetchCalls = 0;
    let readyEvents = 0;
    const fakeFetch = async () => {
      fetchCalls += 1;
      return fetchCalls === 1
        ? { ok: true, json: async () => ({ group: null }) }
        : { ok: true, json: async () => ({ group: { models: [{ value: 'gpt-5.6' }] } }) };
    };

    await warmCodexModelCatalog(fakeFetch, () => { readyEvents += 1; });
    assert.equal(readyEvents, 0);

    await warmCodexModelCatalog(fakeFetch, () => { readyEvents += 1; });
    assert.equal(fetchCalls, 2, 'an empty first attempt must not permanently poison the renderer');
    assert.equal(readyEvents, 1);
  });

  it('surfaces Main-owned recovery safe mode without claiming an empty account', async () => {
    let recoveryEvents = 0;
    await warmCodexModelCatalog(
      async () => ({
        ok: true,
        json: async () => ({ group: null, recoverySafeMode: true }),
      }),
      () => assert.fail('safe mode must not emit catalog ready'),
      (active) => { if (active) recoveryEvents += 1; },
    );
    assert.equal(isCodexRecoverySafeModeVisible(), true);
    assert.equal(recoveryEvents, 1);
  });

  it('keeps the unified feed cache-only and wires the narrow ready event into the hook', () => {
    const repoRoot = path.resolve(__dirname, '../..');
    const hookSource = fs.readFileSync(path.join(repoRoot, 'hooks/useProviderModels.ts'), 'utf8');
    const providerManagerSource = fs.readFileSync(
      path.join(repoRoot, 'components/settings/ProviderManager.tsx'),
      'utf8',
    );
    const routeSource = fs.readFileSync(path.join(repoRoot, 'app/api/providers/models/route.ts'), 'utf8');

    assert.match(routeSource, /else if \(!runtimeFilter\)[\s\S]{0,400}cacheOnly:\s*true/);
    assert.match(hookSource, /warmCodexModelCatalog\(\)/);
    assert.match(hookSource, /addEventListener\(CODEX_MODEL_CATALOG_READY_EVENT, codexCatalogReadyHandler\)/);
    assert.match(providerManagerSource, /setCodexLoginStart\(json\.login\);[\s\S]{0,400}invalidateCodexModelCatalogWarmup\(\)/);
    assert.match(providerManagerSource, /handleCodexLoginComplete[\s\S]{0,300}invalidateCodexModelCatalogWarmup\(\)/);
    assert.match(providerManagerSource, /handleCodexLogout[\s\S]{0,500}invalidateCodexModelCatalogWarmup\(\)/);
    assert.doesNotMatch(
      hookSource,
      /window\.dispatchEvent\(new Event\(['"]provider-changed['"]\)\)/,
      'read-only Codex warm-up must not fan out as a provider mutation',
    );
  });
});
