import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertProviderDnsResolvable,
  hostMatchesNoProxy,
} from '../../lib/provider-dns-preflight';
import { classifyError } from '../../lib/error-classifier';

describe('Claude provider DNS preflight', () => {
  it('resolves only the provider hostname, never an HTTP path or credential', async () => {
    const seen: string[] = [];
    const result = await assertProviderDnsResolvable({
      baseUrl: 'https://api.example.test/anthropic/v1?token=secret',
      env: {},
      lookup: async (hostname) => { seen.push(hostname); },
    });

    assert.equal(result, 'resolved');
    assert.deepEqual(seen, ['api.example.test']);
  });

  it('fails with a classified DNS code instead of waiting for the SDK idle fuse', async () => {
    await assert.rejects(
      assertProviderDnsResolvable({
        baseUrl: 'https://unresolvable.example.test',
        env: {},
        lookup: async () => {
          const error = new Error('temporary resolver failure');
          (error as NodeJS.ErrnoException).code = 'EAI_AGAIN';
          throw error;
        },
      }),
      (error: unknown) => {
        assert.equal((error as NodeJS.ErrnoException).code, 'EAI_AGAIN');
        assert.match((error as Error).message, /DNS lookup failed/);
        assert.doesNotMatch((error as Error).message, /unresolvable\.example\.test/);
        return true;
      },
    );
  });

  it('maps a resolver timeout to the existing actionable network category', () => {
    const error = new Error('DNS lookup timed out for the selected provider');
    (error as NodeJS.ErrnoException).code = 'EAI_AGAIN';
    const classified = classifyError({ error });
    assert.equal(classified.category, 'NETWORK_UNREACHABLE');
    assert.equal(classified.retryable, true);
  });

  it('skips when a proxy may perform remote DNS resolution', async () => {
    let called = false;
    const result = await assertProviderDnsResolvable({
      baseUrl: 'https://api.example.test',
      env: { HTTPS_PROXY: 'http://127.0.0.1:7890' },
      lookup: async () => { called = true; },
    });

    assert.equal(result, 'skipped');
    assert.equal(called, false);
  });

  it('does not skip a host that NO_PROXY routes directly', async () => {
    const seen: string[] = [];
    const result = await assertProviderDnsResolvable({
      baseUrl: 'https://api.example.test',
      env: {
        HTTPS_PROXY: 'http://127.0.0.1:7890',
        NO_PROXY: '.example.test,localhost',
      },
      lookup: async (hostname) => { seen.push(hostname); },
    });
    assert.equal(result, 'resolved');
    assert.deepEqual(seen, ['api.example.test']);
  });

  it('supports exact, suffix, port and wildcard NO_PROXY entries', () => {
    assert.equal(hostMatchesNoProxy('api.example.test', { NO_PROXY: 'api.example.test:443' }), true);
    assert.equal(hostMatchesNoProxy('api.example.test', { no_proxy: 'example.test' }), true);
    assert.equal(hostMatchesNoProxy('::1', { NO_PROXY: '::1' }), true);
    assert.equal(hostMatchesNoProxy('::1', { NO_PROXY: '[::1]:8080' }), true);
    assert.equal(hostMatchesNoProxy('unrelated.test', { NO_PROXY: 'example.test' }), false);
    assert.equal(hostMatchesNoProxy('anything.test', { NO_PROXY: '*' }), true);
  });

  it('skips localhost and numeric hosts', async () => {
    let called = false;
    for (const baseUrl of ['http://localhost:3000', 'http://127.0.0.1:8080']) {
      assert.equal(await assertProviderDnsResolvable({
        baseUrl,
        env: {},
        lookup: async () => { called = true; },
      }), 'skipped');
    }
    assert.equal(called, false);
  });
});
