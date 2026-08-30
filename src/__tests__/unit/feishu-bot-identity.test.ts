/**
 * Phase 6 / #P2 (2026-06-02) — Feishu bridge log noise: `Cannot read properties
 * of undefined (reading 'v3')` every 60s.
 *
 * Root cause: getBotInfo called `client.bot.v3.botInfo.list()`, but the Lark
 * SDK 1.59 generated client has no `bot` namespace → TypeError on every call,
 * which getBotInfo's catch logged via console.error; the identity-retry timer
 * polls every 60s, so it spammed once a minute.
 *
 * Fix: call the documented endpoint via the raw `client.request` and log a
 * failure at most once per process. These tests use a fake client (no network).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getBotInfo, resetBotInfoFailureLogForTests } from '@/lib/channels/feishu/identity';

type ReqFn = (opts: { method?: string; url?: string }) => Promise<unknown>;
function fakeClient(request: ReqFn) {
  return { request } as unknown as Parameters<typeof getBotInfo>[0];
}

beforeEach(() => resetBotInfoFailureLogForTests());

describe('getBotInfo — uses GET /open-apis/bot/v3/info, parses top-level bot', () => {
  it('calls the documented bot-info endpoint (never the missing client.bot namespace)', async () => {
    let calledUrl: string | undefined;
    let calledMethod: string | undefined;
    const client = fakeClient(async (opts) => {
      calledUrl = opts.url;
      calledMethod = opts.method;
      return { code: 0, msg: 'ok', bot: { open_id: 'ou_abc', app_name: 'My Bot' } };
    });
    const info = await getBotInfo(client);
    assert.equal(calledMethod, 'GET');
    assert.equal(calledUrl, '/open-apis/bot/v3/info');
    assert.deepEqual(info, { appId: '', botName: 'My Bot', openId: 'ou_abc' });
  });

  it('also accepts a nested data.bot envelope (defensive)', async () => {
    const client = fakeClient(async () => ({ data: { bot: { open_id: 'ou_xyz' } } }));
    const info = await getBotInfo(client);
    assert.equal(info?.openId, 'ou_xyz');
  });

  it('returns null when the response carries no bot/open_id', async () => {
    const client = fakeClient(async () => ({ code: 0, msg: 'ok' }));
    assert.equal(await getBotInfo(client), null);
  });
});

describe('getBotInfo — failures are quiet (no per-minute spam)', () => {
  let warnCalls: number;
  let origWarn: typeof console.warn;
  beforeEach(() => {
    warnCalls = 0;
    origWarn = console.warn;
    console.warn = () => { warnCalls += 1; };
  });
  afterEach(() => { console.warn = origWarn; });

  it('returns null on a thrown request and logs at most once across repeated polls', async () => {
    const client = fakeClient(async () => { throw new Error('boom'); });
    assert.equal(await getBotInfo(client), null);
    assert.equal(await getBotInfo(client), null);
    assert.equal(await getBotInfo(client), null);
    assert.equal(warnCalls, 1, 'a persistent failure must log once, not once per 60s poll');
  });
});

describe('identity.ts source — no stale client.bot.v3 access (#P2)', () => {
  const src = readFileSync(
    path.resolve(__dirname, '../../lib/channels/feishu/identity.ts'),
    'utf8',
  );
  it('does not reference the missing client.bot.v3 namespace', () => {
    assert.doesNotMatch(src, /\.bot\.v3\.botInfo/, 'the SDK has no bot namespace in 1.59 — must use client.request');
    assert.doesNotMatch(src, /\.bot\.v3\b/);
  });
  it('calls the documented endpoint via client.request', () => {
    assert.match(src, /client\.request[\s\S]{0,120}\/open-apis\/bot\/v3\/info/);
  });
});
