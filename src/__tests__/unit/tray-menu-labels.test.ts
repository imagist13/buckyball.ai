/**
 * Unit tests for the OS-locale-driven tray / menubar labels.
 *
 * The Electron tray menu lives in the main process and has no access to the
 * React i18n bundle, so we pick labels via a small pure helper based on
 * `app.getLocale()`. Tests live here because the helper is callable without
 * an Electron runtime — see src/lib/tray-menu-labels.ts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getTrayMenuLabels } from '../../lib/tray-menu-labels';

describe('getTrayMenuLabels', () => {
  it('returns Chinese labels for zh-CN locale', () => {
    const labels = getTrayMenuLabels('zh-CN');
    assert.equal(labels.open, '打开 CodePilot');
    assert.equal(labels.quit, '退出 CodePilot');
    assert.equal(labels.tooltip, 'CodePilot');
  });

  it('returns Chinese labels for zh-TW (any zh-* variant)', () => {
    const labels = getTrayMenuLabels('zh-TW');
    assert.equal(labels.open, '打开 CodePilot');
    assert.equal(labels.quit, '退出 CodePilot');
  });

  it('returns Chinese labels for plain "zh"', () => {
    const labels = getTrayMenuLabels('zh');
    assert.equal(labels.open, '打开 CodePilot');
  });

  it('returns English labels for en-US', () => {
    const labels = getTrayMenuLabels('en-US');
    assert.equal(labels.open, 'Open CodePilot');
    assert.equal(labels.quit, 'Quit CodePilot');
    assert.equal(labels.tooltip, 'CodePilot');
  });

  it('returns English labels for unknown locales', () => {
    const labels = getTrayMenuLabels('fr-FR');
    assert.equal(labels.open, 'Open CodePilot');
    assert.equal(labels.quit, 'Quit CodePilot');
  });

  it('falls back to English when locale is undefined', () => {
    const labels = getTrayMenuLabels(undefined);
    assert.equal(labels.open, 'Open CodePilot');
    assert.equal(labels.quit, 'Quit CodePilot');
  });

  it('falls back to English for empty string', () => {
    const labels = getTrayMenuLabels('');
    assert.equal(labels.open, 'Open CodePilot');
  });

  it('handles uppercase locales (e.g. "ZH-CN")', () => {
    const labels = getTrayMenuLabels('ZH-CN');
    assert.equal(labels.open, '打开 CodePilot');
  });

  it('does not mention Bridge in any label', () => {
    // Phase 3 Step 2 invariant: tray UI must not be bridge-coupled.
    // Local notifications and scheduler keep running with or without
    // the bridge — bridge is just an optional remote channel.
    for (const loc of ['zh-CN', 'en-US', 'fr-FR', '', undefined]) {
      const labels = getTrayMenuLabels(loc);
      for (const v of Object.values(labels)) {
        assert.doesNotMatch(v, /Bridge|bridge|桥接/);
      }
    }
  });
});
