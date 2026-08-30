/**
 * Phase 4.B — unified-diff line classifier.
 *
 * Pins the small line-prefix table so a future refactor can't quietly
 * change which lines render as added/removed/header/meta/context.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDiff } from '../../components/editor/DiffViewer';

describe('classifyDiff', () => {
  it('classifies a typical unified diff into the right buckets', () => {
    const diff = `diff --git a/foo b/foo
index 0000..1111
--- a/foo
+++ b/foo
@@ -1,3 +1,3 @@
 context line
-removed line
+added line`;
    const out = classifyDiff(diff);
    const byKind = (k: string) => out.filter((l) => l.kind === k).map((l) => l.text);
    assert.deepEqual(byKind('header'), ['@@ -1,3 +1,3 @@']);
    assert.deepEqual(byKind('added'), ['+added line']);
    assert.deepEqual(byKind('removed'), ['-removed line']);
    assert.deepEqual(byKind('meta'), [
      'diff --git a/foo b/foo',
      'index 0000..1111',
      '--- a/foo',
      '+++ b/foo',
    ]);
    assert.deepEqual(byKind('context'), [' context line']);
  });

  it('does not mis-classify --- / +++ as added/removed content', () => {
    const out = classifyDiff('--- a\n+++ b');
    assert.equal(out[0].kind, 'meta');
    assert.equal(out[1].kind, 'meta');
  });

  it('handles new-file mode / similarity lines', () => {
    const out = classifyDiff('new file mode 100644\nsimilarity index 95%');
    assert.equal(out[0].kind, 'meta');
    assert.equal(out[1].kind, 'meta');
  });

  it('preserves line text verbatim', () => {
    const diff = '+x\n y';
    const out = classifyDiff(diff);
    assert.equal(out[0].text, '+x');
    assert.equal(out[1].text, ' y');
  });
});
