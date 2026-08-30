/**
 * Tests for OAuth token exchange retry behavior.
 *
 * Background: Issue #464 reports users hitting "Token exchange failed: 403"
 * on macOS + Windows while the maintainer's machines never reproduce.
 * Strong network-stability dependence — the upstream OpenCode reference
 * implementation handles this with retries on 403/5xx/network errors.
 *
 * These tests pin the retry classification logic so the regression doesn't
 * silently come back when someone tries to "tighten" the retryable set
 * (e.g. removing 403 because "auth errors shouldn't retry") without
 * understanding the practical reason.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isRetryableTokenExchangeFailure } from '../../lib/openai-oauth';

describe('isRetryableTokenExchangeFailure', () => {
  describe('network-level failures (status=null)', () => {
    it('retries plain network failures', () => {
      assert.equal(isRetryableTokenExchangeFailure(null), true);
    });

    it('retries ECONNRESET', () => {
      const err = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      assert.equal(isRetryableTokenExchangeFailure(null, err), true);
    });

    it('retries ETIMEDOUT', () => {
      const err = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
      assert.equal(isRetryableTokenExchangeFailure(null, err), true);
    });

    it('retries DNS lookup failures', () => {
      const err = Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' });
      assert.equal(isRetryableTokenExchangeFailure(null, err), true);
    });

    it('retries connection refused', () => {
      const err = Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
      assert.equal(isRetryableTokenExchangeFailure(null, err), true);
    });
  });

  describe('HTTP status retry classification', () => {
    it('retries 403 — OpenAI auth-code propagation race (issue #464)', () => {
      assert.equal(isRetryableTokenExchangeFailure(403), true);
    });

    it('retries 408 (request timeout)', () => {
      assert.equal(isRetryableTokenExchangeFailure(408), true);
    });

    it('retries 429 (rate limited)', () => {
      assert.equal(isRetryableTokenExchangeFailure(429), true);
    });

    it('retries 500/502/503/504 (server errors)', () => {
      assert.equal(isRetryableTokenExchangeFailure(500), true);
      assert.equal(isRetryableTokenExchangeFailure(502), true);
      assert.equal(isRetryableTokenExchangeFailure(503), true);
      assert.equal(isRetryableTokenExchangeFailure(504), true);
    });

    it('does NOT retry 200 (would be ok anyway)', () => {
      // (we wouldn't reach this branch for 2xx, but the function still classifies it)
      assert.equal(isRetryableTokenExchangeFailure(200), false);
    });

    it('does NOT retry 400 (bad request — code is malformed, retrying won\'t help)', () => {
      assert.equal(isRetryableTokenExchangeFailure(400), false);
    });

    it('does NOT retry 401 (genuine auth failure)', () => {
      assert.equal(isRetryableTokenExchangeFailure(401), false);
    });

    it('does NOT retry 404 (endpoint wrong — config bug, not transient)', () => {
      assert.equal(isRetryableTokenExchangeFailure(404), false);
    });

    it('does NOT retry 422 (validation error)', () => {
      assert.equal(isRetryableTokenExchangeFailure(422), false);
    });
  });
});
