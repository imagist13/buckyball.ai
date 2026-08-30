/**
 * 2026-06-10 — stale capability cache after provider edit/delete.
 *
 * The per-provider capability cache (models / commands / account / MCP
 * status) has a 5-minute TTL but was never dropped when the provider row
 * changed: editing a provider's config or deleting it kept serving the old
 * capture for up to the full TTL. invalidateCapabilityCache() is now called
 * from the provider PUT/DELETE routes; these tests pin its behavior.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setCachedPlugins,
  getCachedPlugins,
  invalidateCapabilityCache,
} from '@/lib/agent-sdk-capabilities';

const CACHE_KEY = '__agentSdkCapabilities__';

beforeEach(() => {
  (globalThis as Record<string, unknown>)[CACHE_KEY] = new Map();
});

describe('invalidateCapabilityCache', () => {
  it('drops the cached entry for the given provider', () => {
    setCachedPlugins('prov-a', [{ name: 'p1', path: '/p1' }]);
    assert.equal(getCachedPlugins('prov-a').length, 1);

    invalidateCapabilityCache('prov-a');

    assert.equal(getCachedPlugins('prov-a').length, 0);
  });

  it('leaves other providers untouched', () => {
    setCachedPlugins('prov-a', [{ name: 'p1', path: '/p1' }]);
    setCachedPlugins('prov-b', [{ name: 'p2', path: '/p2' }]);

    invalidateCapabilityCache('prov-a');

    assert.equal(getCachedPlugins('prov-a').length, 0);
    assert.equal(getCachedPlugins('prov-b').length, 1);
  });

  it('is a no-op for an unknown provider id', () => {
    assert.doesNotThrow(() => invalidateCapabilityCache('never-seen'));
  });
});
