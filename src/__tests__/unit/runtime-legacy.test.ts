/**
 * Pin the legacy-runtime coercion used by both SettingsCli migration and
 * RuntimeBadge display. If these rules drift between call sites the UI and
 * the persisted value disagree.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLegacyRuntimeForDisplay, isConcreteRuntime } from '@/lib/runtime/legacy';

describe('resolveLegacyRuntimeForDisplay', () => {
  it('preserves explicit claude-code-sdk regardless of CLI state', () => {
    assert.equal(resolveLegacyRuntimeForDisplay('claude-code-sdk', true), 'claude-code-sdk');
    assert.equal(resolveLegacyRuntimeForDisplay('claude-code-sdk', false), 'claude-code-sdk');
  });

  it('preserves explicit native regardless of CLI state', () => {
    assert.equal(resolveLegacyRuntimeForDisplay('native', true), 'native');
    assert.equal(resolveLegacyRuntimeForDisplay('native', false), 'native');
  });

  it('migrates legacy auto to claude-code-sdk when CLI is installed', () => {
    assert.equal(resolveLegacyRuntimeForDisplay('auto', true), 'claude-code-sdk');
  });

  it('migrates legacy auto to native when CLI is not installed', () => {
    assert.equal(resolveLegacyRuntimeForDisplay('auto', false), 'native');
  });

  it('treats null / undefined / empty as legacy and applies the same rule', () => {
    assert.equal(resolveLegacyRuntimeForDisplay(null, true), 'claude-code-sdk');
    assert.equal(resolveLegacyRuntimeForDisplay(null, false), 'native');
    assert.equal(resolveLegacyRuntimeForDisplay(undefined, true), 'claude-code-sdk');
    assert.equal(resolveLegacyRuntimeForDisplay('', false), 'native');
  });

  it('treats unknown garbage values as legacy (defensive)', () => {
    assert.equal(resolveLegacyRuntimeForDisplay('whatever', true), 'claude-code-sdk');
    assert.equal(resolveLegacyRuntimeForDisplay('whatever', false), 'native');
  });
});

describe('isConcreteRuntime', () => {
  it('accepts the two concrete runtime ids', () => {
    assert.equal(isConcreteRuntime('claude-code-sdk'), true);
    assert.equal(isConcreteRuntime('native'), true);
  });

  it('rejects legacy auto and everything else', () => {
    assert.equal(isConcreteRuntime('auto'), false);
    assert.equal(isConcreteRuntime(null), false);
    assert.equal(isConcreteRuntime(undefined), false);
    assert.equal(isConcreteRuntime(''), false);
    assert.equal(isConcreteRuntime('Claude Code'), false);
  });
});
