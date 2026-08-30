import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getContextWindow, MODEL_CONTEXT_WINDOWS } from '../../lib/model-context';

describe('getContextWindow — alias disambiguation', () => {
  it('bare opus alias resolves to 200K (Bedrock/Vertex-safe default)', () => {
    assert.equal(getContextWindow('opus'), 200_000);
  });

  it('opus with first-party upstream resolves to 1M (Opus 4.7)', () => {
    assert.equal(
      getContextWindow('opus', { upstream: 'claude-opus-4-7' }),
      1_000_000,
    );
  });

  it('claude-opus-4-7 exact match returns 1M', () => {
    assert.equal(getContextWindow('claude-opus-4-7'), 1_000_000);
  });

  it('vendor-prefixed opus-4-7 substring matches 1M, not 200K alias', () => {
    // Regression: keys were iterated in insertion order, so the short 'opus'
    // alias (200K) was matched first for any full name containing 'opus'.
    // Sorting fallback keys by length puts claude-opus-4-7 (1M) ahead.
    assert.equal(
      getContextWindow('us.anthropic.claude-opus-4-7-v1:0'),
      1_000_000,
      'vendor-prefixed 4.7 must hit claude-opus-4-7 before opus alias',
    );
  });

  it('opus alias with vendor-prefixed upstream resolves to 1M', () => {
    // Regression: the previous guard (`MODEL_CONTEXT_WINDOWS[upstream] != null`)
    // required an exact key match on `upstream` before using it. A vendor-
    // prefixed full name like `us.anthropic.claude-opus-4-7-v1:0` failed that
    // check and the helper silently fell back to the bare 'opus' alias (200K).
    // resolveWindow must now substring-match the upstream first.
    assert.equal(
      getContextWindow('opus', { upstream: 'us.anthropic.claude-opus-4-7-v1:0' }),
      1_000_000,
    );
  });

  it('unknown upstream falls back to model alias instead of returning null', () => {
    // When the caller supplies an upstream we don't recognize, we should
    // not drop to null — we should honor the alias the caller also knows.
    // Example: some third-party proxy passes an opaque upstream ID we've
    // never seen, but the UI model is still 'opus'.
    assert.equal(
      getContextWindow('opus', { upstream: 'proxy-specific-opaque-name' }),
      200_000,
    );
  });

  it('unknown upstream does not poison a known model key', () => {
    // The failing-upstream path must not shadow a valid exact match on
    // the model itself. If model='claude-opus-4-7' and upstream is garbage,
    // the result should still be 1M (from the model), not null.
    assert.equal(
      getContextWindow('claude-opus-4-7', { upstream: 'not-in-the-table' }),
      1_000_000,
    );
  });

  it('context1m beta toggle upgrades to 1M regardless of base', () => {
    assert.equal(
      getContextWindow('claude-opus-4-20250514', { context1m: true }),
      1_000_000,
    );
  });

  it('unknown model returns null (so callers can fall back safely)', () => {
    assert.equal(getContextWindow('nonexistent-model'), null);
  });

  it('GLM-5.3-Flash resolves its official 1M window for both wire IDs', () => {
    assert.equal(getContextWindow('glm-5.3-flash'), 1_000_000);
    assert.equal(getContextWindow('haiku', { upstream: 'glm-5.3-flash[1m]' }), 1_000_000);
  });

  it('MODEL_CONTEXT_WINDOWS still carries explicit entries expected by route code', () => {
    // Guardrail for future refactors that might accidentally rename keys
    // out from under /api/providers/models and claude-client.
    assert.ok('opus' in MODEL_CONTEXT_WINDOWS);
    assert.ok('claude-opus-4-7' in MODEL_CONTEXT_WINDOWS);
    assert.ok('claude-opus-4-20250514' in MODEL_CONTEXT_WINDOWS);
  });
});
