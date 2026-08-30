/**
 * Phase 4.D — dev-output tokenizer for chat assistant text.
 *
 * Coverage:
 *  - bare file references (abs / relative)
 *  - line anchor variants (:12, :12:5, #L12)
 *  - localhost URL variants (http / https / 127.0.0.1)
 *  - text concatenation reconstructs the input verbatim
 *  - non-previewable extensions still tokenize but `previewable: false`
 *
 * Run: npx tsx --test src/__tests__/unit/dev-output-parser.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  tokenizeDevOutput,
  PREVIEWABLE_FILE_EXTENSIONS,
} from '../../lib/markdown/dev-output-parser';

function reconstruct(text: string): string {
  return tokenizeDevOutput(text)
    .map((t) => t.value)
    .join('');
}

describe('tokenizeDevOutput', () => {
  it('tokenizes a bare absolute path', () => {
    const t = tokenizeDevOutput('Open /Users/me/foo.md to see.');
    const ref = t.find((x) => x.kind === 'file-ref');
    assert.ok(ref && ref.kind === 'file-ref');
    if (ref?.kind !== 'file-ref') return;
    assert.equal(ref.filePath, '/Users/me/foo.md');
    assert.equal(ref.previewable, true);
    assert.equal(reconstruct('Open /Users/me/foo.md to see.'), 'Open /Users/me/foo.md to see.');
  });

  it('tokenizes a relative path with directory separator', () => {
    const t = tokenizeDevOutput('See src/foo.ts for impl.');
    const ref = t.find((x) => x.kind === 'file-ref');
    if (ref?.kind !== 'file-ref') {
      assert.fail('expected file-ref');
      return;
    }
    assert.equal(ref.filePath, 'src/foo.ts');
    assert.equal(ref.previewable, false); // .ts not in PREVIEWABLE_FILE_EXTENSIONS
  });

  it('extracts :12 line anchor', () => {
    const t = tokenizeDevOutput('Error at /abs/x.md:12.');
    const ref = t.find((x) => x.kind === 'file-ref');
    if (ref?.kind !== 'file-ref') {
      assert.fail();
      return;
    }
    assert.equal(ref.filePath, '/abs/x.md');
    assert.equal(ref.anchor, ':12');
  });

  it('extracts :12:5 line+column anchor', () => {
    const t = tokenizeDevOutput('jump /a/b.json:42:9 now');
    const ref = t.find((x) => x.kind === 'file-ref');
    if (ref?.kind !== 'file-ref') {
      assert.fail();
      return;
    }
    assert.equal(ref.anchor, ':42:9');
  });

  it('extracts #L12 anchor variant', () => {
    const t = tokenizeDevOutput('see /a/foo.md#L99 here.');
    const ref = t.find((x) => x.kind === 'file-ref');
    if (ref?.kind !== 'file-ref') {
      assert.fail();
      return;
    }
    assert.equal(ref.filePath, '/a/foo.md');
    assert.equal(ref.anchor, '#L99');
  });

  it('tokenizes localhost http URL with port + path', () => {
    const t = tokenizeDevOutput('Open http://localhost:3000/api/x for results');
    const url = t.find((x) => x.kind === 'localhost-url');
    if (url?.kind !== 'localhost-url') {
      assert.fail();
      return;
    }
    assert.equal(url.url, 'http://localhost:3000/api/x');
  });

  it('tokenizes 127.0.0.1 URL', () => {
    const t = tokenizeDevOutput('Visit http://127.0.0.1:8080/');
    const url = t.find((x) => x.kind === 'localhost-url');
    assert.equal(url?.kind, 'localhost-url');
  });

  it('tokenizes https://localhost', () => {
    const t = tokenizeDevOutput('Production preview https://localhost:443/admin');
    const url = t.find((x) => x.kind === 'localhost-url');
    assert.equal(url?.kind, 'localhost-url');
  });

  it('previewable flag matches PREVIEWABLE_FILE_EXTENSIONS', () => {
    const sets: Array<[string, boolean]> = [
      ['/a/b.md', true],
      ['/a/b.mdx', true],
      ['/a/b.html', true],
      ['/a/b.json', true],
      ['/a/b.csv', true],
      ['/a/b.tsx', true],
      ['/a/b.txt', true],
      ['/a/b.ts', false],
      ['/a/b.py', false],
      ['/a/b.rs', false],
    ];
    for (const [path, want] of sets) {
      const t = tokenizeDevOutput(`See ${path} please.`);
      const ref = t.find((x) => x.kind === 'file-ref');
      if (ref?.kind !== 'file-ref') {
        assert.fail(`expected file-ref for ${path}`);
        continue;
      }
      assert.equal(ref.previewable, want, `${path} previewable should be ${want}`);
    }
  });

  it('PREVIEWABLE_FILE_EXTENSIONS covers the documented set', () => {
    // Drift guard: removing one of these silently disables chip
    // affordances for chat references. Bump the test if a deliberate
    // narrowing lands.
    for (const ext of ['.md', '.html', '.json', '.csv', '.tsx']) {
      assert.ok(PREVIEWABLE_FILE_EXTENSIONS.has(ext), `${ext} expected`);
    }
  });

  it('reconstruct round-trip preserves the input verbatim', () => {
    const samples = [
      'plain text without any references',
      '/abs/path.md:12 in the middle',
      'mixed http://localhost:3000/ and /a/b.json:1 case',
      'multiple /a.md /b.md /c.md lines',
    ];
    for (const s of samples) {
      assert.equal(reconstruct(s), s, `reconstruct mismatch for: ${s}`);
    }
  });

  it('text-only input produces a single text token', () => {
    const t = tokenizeDevOutput('hello world');
    assert.equal(t.length, 1);
    assert.equal(t[0].kind, 'text');
  });

  it('tokenizes bare filenames with previewable extensions (P2.1)', () => {
    // Codex review finding: README.md / README.md:12 / README.md#L12 must
    // each become a file-ref chip without requiring a directory prefix.
    for (const sample of ['README.md', 'README.md:12', 'README.md#L12', 'CHANGELOG.mdx']) {
      const t = tokenizeDevOutput(`See ${sample} for details.`);
      const ref = t.find((x) => x.kind === 'file-ref');
      if (ref?.kind !== 'file-ref') {
        assert.fail(`expected file-ref for ${sample}`);
        continue;
      }
      assert.ok(ref.filePath.startsWith('README') || ref.filePath.startsWith('CHANGELOG'),
        `${sample} → ${ref.filePath}`);
      assert.equal(ref.previewable, true);
    }
  });

  it('does NOT tokenize bare words ending in non-previewable extensions', () => {
    // "version1.0" or "thanks.thanks" must not get chip-ified — the
    // previewable-extensions whitelist guards against that.
    const samples = ['version1.0', 'okay.okay', 'no.exe', 'foo.zip'];
    for (const s of samples) {
      const t = tokenizeDevOutput(`label ${s} done`);
      assert.ok(
        !t.some((x) => x.kind === 'file-ref'),
        `should not tokenize ${s}`,
      );
    }
  });
});
