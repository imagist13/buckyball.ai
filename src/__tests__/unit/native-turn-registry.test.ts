import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  disposeNativeTurns,
  interruptNativeTurn,
  registerNativeTurnController,
  unregisterNativeTurnController,
} from '../../lib/runtime/native-turn-registry';

afterEach(() => {
  disposeNativeTurns();
});

describe('Native turn registry', () => {
  it('shares the active controller through globalThis and aborts it on Stop', () => {
    const controller = new AbortController();
    registerNativeTurnController('native-stop', controller);

    assert.equal(interruptNativeTurn('native-stop'), true);
    assert.equal(controller.signal.aborted, true);
    assert.equal(interruptNativeTurn('native-stop'), false);
  });

  it('does not let a stale turn cleanup evict the newer owner', () => {
    const stale = new AbortController();
    const current = new AbortController();
    registerNativeTurnController('native-owner', stale);
    registerNativeTurnController('native-owner', current);

    assert.equal(unregisterNativeTurnController('native-owner', stale), false);
    assert.equal(interruptNativeTurn('native-owner'), true);
    assert.equal(stale.signal.aborted, false);
    assert.equal(current.signal.aborted, true);
  });

  it('preserves the first abort reason', () => {
    const controller = new AbortController();
    const reason = new Error('explicit native stop');
    registerNativeTurnController('native-reason', controller);

    assert.equal(interruptNativeTurn('native-reason', reason), true);
    assert.equal(controller.signal.reason, reason);
  });
});
