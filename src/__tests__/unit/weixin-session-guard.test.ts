/**
 * Unit tests for WeChat session guard (account pause management).
 *
 * Run with: npx tsx src/__tests__/unit/weixin-session-guard.test.ts
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { isPaused, setPaused, clearPause, clearAllPauses, getPauseRemainingMs } from '../../lib/bridge/adapters/weixin/weixin-session-guard';

describe('weixin-session-guard', () => {
  beforeEach(() => {
    clearAllPauses();
  });

  it('starts unpaused', () => {
    assert.equal(isPaused('test-account'), false);
  });

  it('can be paused and detected', () => {
    setPaused('test-account', 'Session expired');
    assert.equal(isPaused('test-account'), true);
  });

  it('can be cleared', () => {
    setPaused('test-account');
    clearPause('test-account');
    assert.equal(isPaused('test-account'), false);
  });

  it('tracks multiple accounts independently', () => {
    setPaused('account-1');
    assert.equal(isPaused('account-1'), true);
    assert.equal(isPaused('account-2'), false);
  });

  it('clearAllPauses clears everything', () => {
    setPaused('account-1');
    setPaused('account-2');
    clearAllPauses();
    assert.equal(isPaused('account-1'), false);
    assert.equal(isPaused('account-2'), false);
  });

  it('getPauseRemainingMs returns positive value when paused', () => {
    setPaused('test-account');
    const remaining = getPauseRemainingMs('test-account');
    assert.ok(remaining > 0);
    assert.ok(remaining <= 60 * 60 * 1000);
  });

  it('getPauseRemainingMs returns 0 when not paused', () => {
    assert.equal(getPauseRemainingMs('test-account'), 0);
  });
});
