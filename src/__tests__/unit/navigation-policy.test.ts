/**
 * Behavior test for `classifyNavigation` — the pure policy behind the main
 * window's `will-navigate` handler.
 *
 * Blocker it guards (Codex Loop-1 review of audit finding 1.7): the previous
 * inline handler ran the same-origin allow BEFORE the http/https whitelist.
 * The startup splash is a `data:` page (opaque origin → serializes to "null"),
 * so a `data:`/`file:`/`javascript:` target — also origin "null" — compared
 * equal and was allowed as "same-origin", bypassing the whitelist. The helper
 * now requires BOTH sides to be http/https for an in-app allow.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyNavigation } from '../../lib/navigation-policy';

describe('classifyNavigation — will-navigate policy (audit 1.7 + Codex Loop-1)', () => {
  it('same-origin http/https navigation is allowed in-app', () => {
    assert.equal(
      classifyNavigation('http://127.0.0.1:3000/', 'http://127.0.0.1:3000/chat/1'),
      'allow-in-app',
    );
    assert.equal(classifyNavigation('https://app.local/', 'https://app.local/x'), 'allow-in-app');
  });

  it('cross-origin http/https target is opened externally', () => {
    assert.equal(classifyNavigation('http://127.0.0.1:3000/', 'https://example.com/'), 'open-external');
    assert.equal(classifyNavigation('http://127.0.0.1:3000/', 'http://other.host/'), 'open-external');
    // scheme mismatch (http → https of same host) is still cross-origin → external
    assert.equal(classifyNavigation('http://app.local/', 'https://app.local/'), 'open-external');
  });

  it('non-web schemes are blocked, never opened externally', () => {
    for (const t of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'vscode://file/x',
      'data:text/html,x',
      'blob:http://x/y',
      'ms-msdt:/id',
    ]) {
      assert.equal(classifyNavigation('http://127.0.0.1:3000/', t), 'block', `${t} must be blocked`);
    }
  });

  it('the startup data: page does NOT let opaque-origin targets pass as same-origin (the Codex blocker)', () => {
    // Both sides are opaque → origin "null" === "null". Must NOT be allow-in-app.
    assert.equal(classifyNavigation('data:text/html,loading', 'data:text/html,evil'), 'block');
    assert.equal(classifyNavigation('data:text/html,loading', 'file:///etc/passwd'), 'block');
    assert.equal(classifyNavigation('data:text/html,loading', 'javascript:alert(1)'), 'block');
    // From the data: splash, a real http app URL is external here (the real
    // transition uses loadURL, which does not fire will-navigate).
    assert.equal(classifyNavigation('data:text/html,loading', 'http://127.0.0.1:3000/'), 'open-external');
  });

  it('malformed URLs are blocked', () => {
    assert.equal(classifyNavigation('http://127.0.0.1:3000/', 'not a url'), 'block');
    assert.equal(classifyNavigation('http://127.0.0.1:3000/', ''), 'block');
  });

  it('an unparseable current URL still blocks non-web and externalizes web targets', () => {
    assert.equal(classifyNavigation('', 'https://example.com/'), 'open-external');
    assert.equal(classifyNavigation('', 'file:///x'), 'block');
  });
});
