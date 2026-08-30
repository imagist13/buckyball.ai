/**
 * Phase 5 Phase 5 — CodePilot provider proxy injection contract.
 *
 * Pins the shape `buildCodexProviderProxyInjection` produces.
 * Codex's `thread/start` accepts `config.model_providers` overrides
 * per the upstream schema; this test asserts our injection lines up
 * with the CodexProxyInjection type that the runtime will pass.
 *
 * The actual proxy route returns 501 unsupported_yet for every
 * compat tier in this MVP — Phase 5b will land the Responses
 * translator. Tests for those behaviors live in
 * `codex-provider-proxy-route.test.ts`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCodexProviderProxyInjection,
  resolveCodexProxyBaseUrl,
  CODEX_PROXY_PROVIDER_KEY,
} from '@/lib/codex/provider-proxy';

describe('buildCodexProviderProxyInjection — config override shape', () => {
  it('sets modelProvider to the canonical proxy key', () => {
    const injection = buildCodexProviderProxyInjection('prov-1', 'http://127.0.0.1:3000');
    assert.equal(injection.modelProvider, CODEX_PROXY_PROVIDER_KEY);
    assert.equal(injection.modelProvider, 'codepilot_proxy');
  });

  it('emits model_providers entry under the canonical proxy key', () => {
    const injection = buildCodexProviderProxyInjection('prov-1', 'http://127.0.0.1:3000');
    const entry = injection.config.model_providers[CODEX_PROXY_PROVIDER_KEY];
    assert.equal(entry.name, 'CodePilot via Codex');
    assert.equal(entry.base_url, 'http://127.0.0.1:3000/api/codex/proxy/v1');
    assert.equal(entry.wire_api, 'responses');
  });

  it('routes the target provider via the x-codepilot-target-provider header', () => {
    // Header (not query) so Codex's HTTP client adds it to every
    // request to this provider without per-request plumbing.
    const injection = buildCodexProviderProxyInjection('my-openai-provider', 'http://localhost:3001');
    const entry = injection.config.model_providers[CODEX_PROXY_PROVIDER_KEY];
    assert.equal(entry.http_headers['x-codepilot-target-provider'], 'my-openai-provider');
  });

  it('strips trailing slashes from the base URL before appending the proxy path', () => {
    const a = buildCodexProviderProxyInjection('p', 'http://127.0.0.1:3000/');
    const b = buildCodexProviderProxyInjection('p', 'http://127.0.0.1:3000');
    assert.equal(
      a.config.model_providers[CODEX_PROXY_PROVIDER_KEY].base_url,
      b.config.model_providers[CODEX_PROXY_PROVIDER_KEY].base_url,
    );
  });
});

describe('resolveCodexProxyBaseUrl — env-driven default', () => {
  it('respects CODEPILOT_PROXY_BASE_URL when set', () => {
    const saved = process.env.CODEPILOT_PROXY_BASE_URL;
    process.env.CODEPILOT_PROXY_BASE_URL = 'http://codepilot.example.com';
    try {
      assert.equal(resolveCodexProxyBaseUrl(), 'http://codepilot.example.com');
    } finally {
      if (saved === undefined) {
        delete process.env.CODEPILOT_PROXY_BASE_URL;
      } else {
        process.env.CODEPILOT_PROXY_BASE_URL = saved;
      }
    }
  });

  it('falls back to 127.0.0.1 + PORT (or 3000) when env unset', () => {
    const saved = process.env.CODEPILOT_PROXY_BASE_URL;
    const savedPort = process.env.PORT;
    delete process.env.CODEPILOT_PROXY_BASE_URL;
    process.env.PORT = '3001';
    try {
      assert.equal(resolveCodexProxyBaseUrl(), 'http://127.0.0.1:3001');
    } finally {
      if (saved !== undefined) process.env.CODEPILOT_PROXY_BASE_URL = saved;
      if (savedPort !== undefined) {
        process.env.PORT = savedPort;
      } else {
        delete process.env.PORT;
      }
    }
  });
});
