/**
 * Phase 4.B — code-fence language → PreviewSource mapping.
 *
 * The `previewSourceForCodeFence` helper in code-block.tsx is what the
 * chat-side Preview button uses to decide which inline-* kind to
 * route a code fence into. Coverage pins:
 *  - every supported language returns a PreviewSource (no undefined)
 *  - unsupported languages return null (button stays hidden)
 *  - csv / tsv split correctly (header + rows)
 *  - virtual names are stable for tab dedup
 *
 * Run: npx tsx --test src/__tests__/unit/code-fence-routing.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { previewSourceForCodeFence } from '../../components/ai-elements/code-block';

describe('previewSourceForCodeFence', () => {
  it('html → inline-html', () => {
    const s = previewSourceForCodeFence('html', '<h1>x</h1>');
    assert.equal(s?.kind, 'inline-html');
    if (s?.kind !== 'inline-html') return;
    assert.equal(s.html, '<h1>x</h1>');
    assert.equal(s.virtualName, 'fence.html');
  });

  it('jsx / tsx → inline-jsx', () => {
    const jsx = previewSourceForCodeFence('jsx', 'const X = () => <div/>');
    assert.equal(jsx?.kind, 'inline-jsx');
    const tsx = previewSourceForCodeFence('tsx', 'const Y: FC = () => null');
    assert.equal(tsx?.kind, 'inline-jsx');
  });

  it('json → inline-json with the code text preserved', () => {
    const s = previewSourceForCodeFence('json', '{"a":1}');
    assert.equal(s?.kind, 'inline-json');
    if (s?.kind !== 'inline-json') return;
    assert.equal(s.text, '{"a":1}');
  });

  it('diff / patch → inline-diff', () => {
    const a = previewSourceForCodeFence('diff', '--- a\n+++ b\n@@\n-x\n+y');
    assert.equal(a?.kind, 'inline-diff');
    const b = previewSourceForCodeFence('patch', '--- a\n+++ b\n@@\n-x\n+y');
    assert.equal(b?.kind, 'inline-diff');
  });

  it('csv → inline-datatable with header + rows', () => {
    const s = previewSourceForCodeFence('csv', 'name,age\nAlice,30\nBob,25');
    assert.equal(s?.kind, 'inline-datatable');
    if (s?.kind !== 'inline-datatable') return;
    assert.deepEqual(s.header, ['name', 'age']);
    assert.deepEqual(s.rows, [['Alice', '30'], ['Bob', '25']]);
  });

  it('tsv → inline-datatable with tab delimiter', () => {
    const s = previewSourceForCodeFence('tsv', 'a\tb\n1\t2');
    if (s?.kind !== 'inline-datatable') {
      assert.fail('expected inline-datatable');
      return;
    }
    assert.deepEqual(s.header, ['a', 'b']);
    assert.deepEqual(s.rows, [['1', '2']]);
  });

  it('markdown / md / mdx → inline-markdown', () => {
    assert.equal(previewSourceForCodeFence('md', '# x')?.kind, 'inline-markdown');
    assert.equal(previewSourceForCodeFence('markdown', '# x')?.kind, 'inline-markdown');
    assert.equal(previewSourceForCodeFence('mdx', '# x')?.kind, 'inline-markdown');
  });

  it('case-insensitive language matching', () => {
    assert.equal(previewSourceForCodeFence('HTML', '<x/>')?.kind, 'inline-html');
    assert.equal(previewSourceForCodeFence('JSON', '{}')?.kind, 'inline-json');
  });

  it('unsupported languages return null', () => {
    assert.equal(previewSourceForCodeFence('python', 'print(1)'), null);
    assert.equal(previewSourceForCodeFence('rust', 'fn main(){}'), null);
    assert.equal(previewSourceForCodeFence('shell', 'echo hi'), null);
    assert.equal(previewSourceForCodeFence('', 'x'), null);
  });
});
