/**
 * Phase 5c (2026-05-16) — provider proxy injection now carries
 * session + workspace headers when CodexRuntime supplies them.
 *
 * These are what let the proxy mount the CodePilot built-in tool
 * bridge: without `x-codepilot-session-id` the proxy has no way to
 * address the side-channel event bus, so tool execution results
 * never reach the running ChatView. Without
 * `x-codepilot-workspace-path` bridge tools that need a cwd (image
 * gen reference paths, memory workspace lookup, scheduled-task
 * origin record) silently degrade to the user's home dir.
 *
 * Codex Account paths skip the proxy injection entirely (the
 * routingBug check in `adapter.ts` short-circuits before this code
 * runs) — so the test for "no headers leak into codex_account" lives
 * in `codex-builtin-codex-account-guardrail.test.ts`, not here.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCodexProviderProxyInjection,
  buildCodexThreadParams,
  CODEX_PROXY_PROVIDER_KEY,
} from '@/lib/codex/provider-proxy';

describe('buildCodexProviderProxyInjection — Phase 5c headers (session + workspace)', () => {
  it('omits session/workspace headers when caller passes no opts (back-compat)', () => {
    const injection = buildCodexProviderProxyInjection('prov-1', 'http://127.0.0.1:3000');
    const headers = injection.config.model_providers[CODEX_PROXY_PROVIDER_KEY].http_headers;
    assert.equal(headers['x-codepilot-target-provider'], 'prov-1');
    assert.equal(headers['x-codepilot-session-id'], undefined, 'pre-5c smoke runs with no session id should NOT see a stray header');
    assert.equal(headers['x-codepilot-workspace-path'], undefined);
  });

  it('emits both headers when caller supplies sessionId + workspacePath', () => {
    const injection = buildCodexProviderProxyInjection('prov-1', 'http://127.0.0.1:3000', {
      sessionId: 'chat-abc-123',
      workspacePath: '/Users/me/projects/codepilot',
    });
    const headers = injection.config.model_providers[CODEX_PROXY_PROVIDER_KEY].http_headers;
    assert.equal(headers['x-codepilot-session-id'], 'chat-abc-123');
    assert.equal(headers['x-codepilot-workspace-path'], '/Users/me/projects/codepilot');
  });

  it('omits each header independently when its value is empty string', () => {
    const injection = buildCodexProviderProxyInjection('prov-1', 'http://127.0.0.1:3000', {
      sessionId: 'chat-1',
      workspacePath: '',
    });
    const headers = injection.config.model_providers[CODEX_PROXY_PROVIDER_KEY].http_headers;
    assert.equal(headers['x-codepilot-session-id'], 'chat-1');
    assert.equal(
      headers['x-codepilot-workspace-path'],
      undefined,
      'empty workspace MUST not emit the header — proxy uses absence to decide whether to skip workspace-gated tools',
    );
  });

  it('preserves existing x-codepilot-target-provider header even with new options', () => {
    // Regression guard against accidentally overwriting the original
    // header when restructuring the headers object.
    const injection = buildCodexProviderProxyInjection('prov-xyz', 'http://localhost:3001', {
      sessionId: 's',
      workspacePath: '/w',
    });
    const headers = injection.config.model_providers[CODEX_PROXY_PROVIDER_KEY].http_headers;
    assert.equal(headers['x-codepilot-target-provider'], 'prov-xyz');
  });
});

describe('buildCodexThreadParams — sessionId forwarded into the injection', () => {
  it('forwards sessionId into proxy http_headers when injection runs', () => {
    const params = buildCodexThreadParams({
      providerId: 'prov-glm',
      workingDirectory: '/Users/me/proj',
      proxyBaseUrl: 'http://127.0.0.1:3000',
      model: 'glm-5-turbo',
      sessionId: 'chat-glm-1',
    });
    const headers = params.config?.model_providers?.codepilot_proxy.http_headers;
    assert.ok(headers, 'codepilot_proxy entry must include http_headers');
    assert.equal(headers!['x-codepilot-session-id'], 'chat-glm-1');
    assert.equal(headers!['x-codepilot-workspace-path'], '/Users/me/proj');
  });

  it('codex_account branch skips the injection entirely (no headers leak)', () => {
    const params = buildCodexThreadParams({
      providerId: 'codex_account',
      workingDirectory: '/Users/me/proj',
      proxyBaseUrl: 'http://127.0.0.1:3000',
      model: 'gpt-5.5',
      sessionId: 'chat-codex-1',
    });
    // Codex Account routes through Codex's native account, NOT
    // through the proxy. The function returns cwd + model only;
    // modelProvider + config must be absent so Codex's defaults
    // (model_provider="openai") win.
    assert.equal(params.modelProvider, undefined);
    assert.equal(params.config, undefined);
    assert.equal(params.cwd, '/Users/me/proj');
    assert.equal(params.model, 'gpt-5.5');
  });

  it('sessionId omitted entirely is back-compat: injection still runs, no session header', () => {
    const params = buildCodexThreadParams({
      providerId: 'prov-glm',
      workingDirectory: '/w',
      proxyBaseUrl: 'http://127.0.0.1:3000',
      model: 'glm-5-turbo',
      // sessionId not passed
    });
    const headers = params.config?.model_providers?.codepilot_proxy.http_headers;
    assert.ok(headers);
    assert.equal(headers!['x-codepilot-session-id'], undefined);
  });
});
