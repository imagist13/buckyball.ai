/**
 * sdk-model-usage.test.ts — coverage for `pickModelUsage`, the helper
 * that picks the right ModelUsage entry when extracting contextWindow
 * from `SDKResultMessage.modelUsage`.
 *
 * The point of having this tested directly: GLM / Bailian /
 * Volcengine / MiniMax / Kimi / DeepSeek and other ClaudeCode-compat
 * brands aren't in `model-context.ts`. Instead of maintaining a
 * whitelist, we trust the SDK to tell us the window via modelUsage —
 * which means we MUST pick the correct entry, even when the proxy
 * keys it under upstream id rather than the alias the user picked.
 * This regression test locks the priority chain so a future "always
 * match by alias" refactor can't quietly regress non-catalog brands
 * back to "capacity unknown."
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickModelUsage, type SdkModelUsage } from '../../lib/sdk-model-usage';

function mkUsage(overrides: Partial<SdkModelUsage> = {}): SdkModelUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    webSearchRequests: 0,
    costUSD: 0,
    contextWindow: 200000,
    maxOutputTokens: 8192,
    ...overrides,
  };
}

describe('pickModelUsage — priority chain', () => {
  it('returns null for undefined modelUsage (older SDK / adapter without map)', () => {
    assert.equal(pickModelUsage(undefined, { requested: 'sonnet' }), null);
  });

  it('returns null for an empty map', () => {
    assert.equal(pickModelUsage({}, { requested: 'sonnet' }), null);
  });

  it('priority 1: exact match on requested alias wins over everything else', () => {
    const map = {
      'sonnet': mkUsage({ contextWindow: 200000 }),
      'claude-sonnet-4-6': mkUsage({ contextWindow: 1000000 }),
      'opus': mkUsage({ contextWindow: 200000 }),
    };
    const picked = pickModelUsage(map, { requested: 'sonnet', upstream: 'claude-sonnet-4-6' });
    assert.ok(picked);
    assert.equal(picked![0], 'sonnet');
    assert.equal(picked![1].contextWindow, 200000);
  });

  it('priority 2: upstream match wins when alias missing', () => {
    const map = {
      'claude-sonnet-4-6': mkUsage({ contextWindow: 1000000 }),
      'opus': mkUsage({ contextWindow: 200000 }),
    };
    const picked = pickModelUsage(map, { requested: 'sonnet', upstream: 'claude-sonnet-4-6' });
    assert.ok(picked);
    assert.equal(picked![0], 'claude-sonnet-4-6');
    assert.equal(picked![1].contextWindow, 1000000);
  });

  it('priority 3: single entry wins when no hint matches — the GLM / Bailian / Kimi case', () => {
    // Catalog doesn't enumerate `glm-5-turbo`, so neither requested
    // nor upstream is in the map. SDK round-trips one entry. We must
    // still surface its contextWindow rather than fall through to "no
    // match → caller treats as capacity unknown."
    const map = { 'glm-5-turbo-200k': mkUsage({ contextWindow: 200000 }) };
    const picked = pickModelUsage(map, { requested: 'glm-5-turbo' });
    assert.ok(picked);
    assert.equal(picked![0], 'glm-5-turbo-200k');
    assert.equal(picked![1].contextWindow, 200000);
  });

  it('priority 4: with multiple unmatched entries, prefer the first with contextWindow > 0', () => {
    const map = {
      'mystery-a': mkUsage({ contextWindow: 0 }),
      'mystery-b': mkUsage({ contextWindow: 128000 }),
      'mystery-c': mkUsage({ contextWindow: 0 }),
    };
    const picked = pickModelUsage(map, { requested: 'glm-5-turbo' });
    assert.ok(picked);
    assert.equal(picked![0], 'mystery-b');
    assert.equal(picked![1].contextWindow, 128000);
  });

  it('priority 4 fallback: when no entry has a positive window, return the first entry — caller still sees usage_model_id even if window is 0', () => {
    const map = {
      'a': mkUsage({ contextWindow: 0 }),
      'b': mkUsage({ contextWindow: 0 }),
    };
    const picked = pickModelUsage(map, { requested: 'unknown' });
    assert.ok(picked);
    assert.equal(picked![0], 'a');
  });

  it('hints with no requested or upstream still resolves single-entry correctly', () => {
    const map = { 'only-one': mkUsage({ contextWindow: 64000 }) };
    const picked = pickModelUsage(map, {});
    assert.ok(picked);
    assert.equal(picked![0], 'only-one');
    assert.equal(picked![1].contextWindow, 64000);
  });
});
