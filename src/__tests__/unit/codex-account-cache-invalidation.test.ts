/**
 * Phase 0 fix round (2026-07-17) — an account transition must drop cached
 * Codex capability, on the PRODUCTION route path.
 *
 * The `cacheOnly` model read ignores TTL by design (P0.3 spawn decoupling), so
 * a warm cache survives forever until something invalidates it. Before this
 * round the real logout route (`DELETE /api/codex/account`) only called
 * `logoutCodex()`, so after logout the full catalog and the `turn/start` effort
 * allowlist still answered with the logged-out account's capability.
 *
 * These tests go through the real route handlers — request parsing, branching,
 * the invalidating transition wrapper, the real cache and both real readers.
 * The ONLY thing replaced is the bottom JSON-RPC call (the `perform` seam), so
 * no Codex app-server is spawned. Everything above that seam is production code.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import {
  listCodexModels,
  buildCodexProviderModelGroup,
  getCachedCodexEffortLevels,
  invalidateCodexModelsCache,
} from '@/lib/codex/models';
import type { CodexLoginStart } from '@/lib/codex/account';
import { handleAccountDelete } from '@/app/api/codex/account/route';
import { handleLoginPost } from '@/app/api/codex/login/route';

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

/** DI seam standing in for getCodexAppServer — never spawns anything. */
const okAppServer = async () =>
  ({
    client: {
      request: <T>(): Promise<T> => Promise.resolve(MODELS_RESULT as T),
    },
  }) as never;

/** Populate the real in-memory cache the way a live model/list would. */
async function warmCache() {
  const models = await listCodexModels({ force: true }, okAppServer);
  assert.equal(models.length, 1, 'precondition: cache warmed with the old account');
  assert.ok(
    await buildCodexProviderModelGroup({ cacheOnly: true }),
    'precondition: warm cache serves a group',
  );
  assert.deepEqual(
    [...((await getCachedCodexEffortLevels('gpt-5.5')) ?? [])],
    ['medium', 'high'],
    'precondition: warm cache serves the effort allowlist',
  );
}

/** Both readers must fail closed — no group, no allowlist. */
async function assertCacheCleared(when: string) {
  assert.equal(
    await buildCodexProviderModelGroup({ cacheOnly: true }),
    null,
    `${when}: full catalog must not serve the previous account's models`,
  );
  assert.equal(
    await getCachedCodexEffortLevels('gpt-5.5'),
    undefined,
    `${when}: turn/start must not serve the previous account's effort allowlist`,
  );
}

const loginRequest = (body?: unknown) =>
  new NextRequest('http://test.local/api/codex/login', {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe('DELETE /api/codex/account — logout drops the previous account cache', () => {
  beforeEach(() => invalidateCodexModelsCache());

  it('a successful logout leaves both readers failing closed', async () => {
    await warmCache();

    let loggedOut = 0;
    const res = await handleAccountDelete(async () => {
      loggedOut++;
    });

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(loggedOut, 1, 'the route must still drive the real logout RPC');
    await assertCacheCleared('after logout');
  });

  it('a failed logout keeps the cache and reports the error', async () => {
    await warmCache();

    const res = await handleAccountDelete(async () => {
      throw new Error('logout RPC failed');
    });

    assert.equal(res.status, 500);
    assert.match((await res.json()).error, /logout RPC failed/);
    assert.ok(
      await buildCodexProviderModelGroup({ cacheOnly: true }),
      'a logout that never happened must not look like an account change',
    );
  });
});

describe('POST /api/codex/login — an account switch drops the previous account cache', () => {
  beforeEach(() => invalidateCodexModelsCache());

  const branches: Array<{
    name: string;
    body: unknown;
    start: CodexLoginStart;
  }> = [
    {
      name: 'chatgpt (default, empty body)',
      body: undefined,
      start: { type: 'chatgpt', loginId: 'login-1', authUrl: 'https://example.invalid/auth' },
    },
    {
      name: 'chatgpt (explicit kind)',
      body: { kind: 'chatgpt' },
      start: { type: 'chatgpt', loginId: 'login-2', authUrl: 'https://example.invalid/auth' },
    },
    {
      name: 'chatgptDeviceCode',
      body: { kind: 'chatgptDeviceCode' },
      start: {
        type: 'chatgptDeviceCode',
        loginId: 'login-3',
        verificationUrl: 'https://example.invalid/device',
        userCode: 'ABCD-EFGH',
      },
    },
    {
      name: 'apiKey',
      body: { kind: 'apiKey', apiKey: 'sk-test' },
      start: { type: 'apiKey' },
    },
  ];

  for (const branch of branches) {
    it(`${branch.name} login start clears the old cache and returns the start result`, async () => {
      await warmCache();

      const res = await handleLoginPost(loginRequest(branch.body), async () => branch.start);

      assert.equal(res.status, 200);
      assert.deepEqual(
        (await res.json()).login,
        branch.start,
        'the login start result must pass through unchanged',
      );
      await assertCacheCleared(`after ${branch.name} account switch`);
    });
  }

  it('apiKey login without a key is rejected before any transition (cache untouched)', async () => {
    await warmCache();

    let started = 0;
    const res = await handleLoginPost(loginRequest({ kind: 'apiKey' }), async () => {
      started++;
      return { type: 'apiKey' as const };
    });

    assert.equal(res.status, 400);
    assert.equal(started, 0, 'a rejected request must not start a login');
    assert.ok(
      await buildCodexProviderModelGroup({ cacheOnly: true }),
      'a login that never started must not look like an account change',
    );
  });

  it('a failed login start keeps the cache (no invalidation on the error path)', async () => {
    await warmCache();

    const res = await handleLoginPost(loginRequest({ kind: 'chatgpt' }), async () => {
      throw new Error('login RPC failed');
    });

    assert.equal(res.status, 500);
    assert.match((await res.json()).error, /login RPC failed/);
    assert.ok(
      await buildCodexProviderModelGroup({ cacheOnly: true }),
      'a login that never started must not look like an account change',
    );
  });
});
