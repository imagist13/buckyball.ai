/**
 * Phase 4 UX III — inline artifact content-hash dedup.
 *
 * `tabFromPreviewSource` now fingerprints inline-* sources by a fast
 * 32-bit hash of their content, not by virtualName. The contract:
 *   - Same content + same kind → same tab id (dedup)
 *   - Different content (even with the same virtualName) → different
 *     tab ids (no false collapse)
 *   - Different kind but same content → different tab ids
 *
 * Run: npx tsx --test src/__tests__/unit/inline-artifact-dedup.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  tabFromPreviewSource,
  openDynamicTab,
  initialState,
  djb2Hex,
} from '../../lib/workspace-sidebar';

describe('djb2Hex', () => {
  it('produces stable 8-char hex for the same input', () => {
    assert.equal(djb2Hex('hello'), djb2Hex('hello'));
    assert.match(djb2Hex('hello'), /^[0-9a-f]{8}$/);
  });

  it('differentiates inputs that share a prefix', () => {
    assert.notEqual(djb2Hex('hello world'), djb2Hex('hello world!'));
    assert.notEqual(djb2Hex('a'), djb2Hex('b'));
  });

  it('handles empty input', () => {
    assert.match(djb2Hex(''), /^[0-9a-f]{8}$/);
  });
});

describe('inline artifact tab dedup by content hash', () => {
  it('same html content → same tab id (multiple Preview clicks reuse one tab)', () => {
    const a = tabFromPreviewSource({
      kind: 'inline-html',
      html: '<h1>x</h1>',
      virtualName: 'fence.html',
    });
    const b = tabFromPreviewSource({
      kind: 'inline-html',
      html: '<h1>x</h1>',
      virtualName: 'fence.html',
    });
    assert.equal(a.id, b.id, 'identical content must produce identical tab id');
  });

  it('different html content → different tab ids', () => {
    const a = tabFromPreviewSource({
      kind: 'inline-html',
      html: '<h1>A</h1>',
      virtualName: 'fence.html',
    });
    const b = tabFromPreviewSource({
      kind: 'inline-html',
      html: '<h1>B</h1>',
      virtualName: 'fence.html',
    });
    assert.notEqual(a.id, b.id, 'different content with same virtualName must NOT collapse');
  });

  it('different kinds with same content → different tab ids', () => {
    const a = tabFromPreviewSource({
      kind: 'inline-json',
      text: 'shared',
      virtualName: 'x',
    });
    const b = tabFromPreviewSource({
      kind: 'inline-markdown',
      markdown: 'shared',
      virtualName: 'x',
    });
    assert.notEqual(a.id, b.id, 'kind must be part of the fingerprint');
  });

  it('openDynamicTab dedups: same content opened twice → tabs.length stays 3', () => {
    let s = initialState();
    s = openDynamicTab(
      s,
      tabFromPreviewSource({
        kind: 'inline-html',
        html: '<p>same</p>',
        virtualName: 'a.html',
      }),
    );
    s = openDynamicTab(
      s,
      tabFromPreviewSource({
        kind: 'inline-html',
        html: '<p>same</p>',
        virtualName: 'a.html',
      }),
    );
    // 2 fixed + 1 dedup'd artifact
    assert.equal(s.tabs.length, 3);
  });

  it('inline-datatable fingerprints over header+rows, not virtualName', () => {
    const a = tabFromPreviewSource({
      kind: 'inline-datatable',
      header: ['a', 'b'],
      rows: [['1', '2']],
      virtualName: 'table',
    });
    const b = tabFromPreviewSource({
      kind: 'inline-datatable',
      header: ['a', 'b'],
      rows: [['1', '2']],
      virtualName: 'different-name',
    });
    assert.equal(a.id, b.id, 'identical table content dedupes regardless of name');
    const c = tabFromPreviewSource({
      kind: 'inline-datatable',
      header: ['a', 'b'],
      rows: [['1', '3']],
      virtualName: 'table',
    });
    assert.notEqual(a.id, c.id, 'row diff produces a new tab');
  });
});
