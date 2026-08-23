import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { history, undo } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, type DecorationSet } from '@codemirror/view';

import {
  buildMarkdownLivePreview,
  externalMarkdownValueSync,
  externalMarkdownValueSyncAnnotation,
  markdownLivePreview,
  resolveMarkdownAssetUrl,
} from '../../components/editor/markdown-live-preview';
import { markdownEditingExtensions } from '../../components/editor/MarkdownEditor';

const GLOBALS_SOURCE = readFileSync(
  resolve(__dirname, '../../app/globals.css'),
  'utf-8',
);

function decorationKinds(set: DecorationSet): string[] {
  const result: string[] = [];
  const cursor = set.iter();
  while (cursor.value) {
    const kind = cursor.value.spec.codepilotKind;
    if (typeof kind === 'string') result.push(kind);
    cursor.next();
  }
  return result;
}

function decorationClasses(set: DecorationSet): string[] {
  const result: string[] = [];
  const cursor = set.iter();
  while (cursor.value) {
    const className = cursor.value.spec.class;
    if (typeof className === 'string') result.push(className);
    cursor.next();
  }
  return result;
}

const fixture = [
  '# Heading',
  '',
  'Paragraph with **bold**, ~~gone~~, $x^2$ and [link](https://example.com).',
  '',
  '![diagram](./assets/diagram.png)',
  '',
  '- [ ] Todo',
  '- [x] Done',
  '1. [x] Ordered',
  '',
  '| Name | Value |',
  '| --- | --- |',
  '| A | 1 |',
  '',
  '```ts',
  'const value = 1;',
  '```',
  '',
  '```mermaid',
  'graph TD',
  '  A --> B',
  '```',
  '',
  '$$',
  'x = {-b \\pm \\sqrt{b^2-4ac} \\over 2a}',
  '$$',
  '',
  'end',
].join('\n');

describe('production Markdown Live Preview decorations', () => {
  it('renders every Phase 2 parity block while the cursor is elsewhere', () => {
    const state = EditorState.create({
      doc: fixture,
      selection: { anchor: fixture.length },
      extensions: [markdown({ base: markdownLanguage })],
    });
    const built = buildMarkdownLivePreview(
      state,
      [{ from: 0, to: fixture.length }],
      { filename: '/workspace/docs/note.md', sessionId: 'session-1' },
    );
    const kinds = decorationKinds(built.decorations);

    for (const expected of [
      'heading-prefix',
      'emphasis-marker',
      'strikethrough-marker',
      'math-inline',
      'link-marker',
      'image',
      'task-list-prefix',
      'task-checkbox',
      'table',
      'code-block',
      'mermaid',
      'math-block',
    ]) {
      assert.ok(kinds.includes(expected), `missing ${expected}: ${kinds.join(', ')}`);
    }
    assert.ok(decorationKinds(built.atomic).includes('table'));
    assert.equal(
      kinds.filter((kind) => kind === 'task-checkbox').length,
      3,
      'unordered and ordered tasks should all render as checkbox widgets',
    );
    const orderedStart = fixture.indexOf('1. [x]');
    const orderedCursor = built.decorations.iter(orderedStart);
    const orderedPrefix = orderedCursor.value;
    if (!orderedPrefix) throw new Error('ordered task prefix decoration is missing');
    assert.equal(orderedPrefix.spec.codepilotKind, 'task-list-prefix');
    assert.equal(
      fixture.slice(orderedStart, orderedCursor.to),
      '1.',
      'ordered task prefix must retain its sequence marker',
    );
  });

  it('keeps frontmatter as source while styling real Setext headings', () => {
    const source = [
      '---',
      'title: Metadata',
      '---',
      '',
      'Visible heading',
      '===============',
      '',
      'end',
    ].join('\n');
    const state = EditorState.create({
      doc: source,
      selection: { anchor: source.length },
      extensions: [markdown({ base: markdownLanguage })],
    });
    const built = buildMarkdownLivePreview(
      state,
      [{ from: 0, to: source.length }],
    );
    const kinds = decorationKinds(built.decorations);
    assert.equal(kinds.includes('rule'), false, 'frontmatter delimiter is not a rule');
    assert.equal(
      kinds.filter((kind) => kind === 'heading-prefix').length,
      1,
      'only the real Setext heading receives heading decoration',
    );
    assert.ok(
      decorationClasses(built.decorations).includes('cm-lp-heading cm-lp-h1'),
    );
  });

  it('reveals the entire active block as lossless source', () => {
    const tablePosition = fixture.indexOf('| Name |') + 2;
    const state = EditorState.create({
      doc: fixture,
      selection: { anchor: tablePosition },
      extensions: [markdown({ base: markdownLanguage })],
    });
    const kinds = decorationKinds(
      buildMarkdownLivePreview(state, [{ from: 0, to: fixture.length }]).decorations,
    );
    assert.equal(kinds.includes('table'), false);
    assert.ok(kinds.includes('code-block'), 'unrelated inactive blocks stay rendered');
  });

  it('limits work to half-open visible ranges', () => {
    const headingEnd = fixture.indexOf('\n');
    const state = EditorState.create({
      doc: fixture,
      selection: { anchor: fixture.length },
      extensions: [markdown({ base: markdownLanguage })],
    });
    const kinds = decorationKinds(
      buildMarkdownLivePreview(state, [{ from: 0, to: headingEnd }]).decorations,
    );
    assert.deepEqual(kinds, ['heading-prefix']);
  });
});

describe('Markdown Live Preview product-theme contract', () => {
  it('uses app surfaces and prevents syntax colors from leaking into rendered headings', () => {
    assert.ok(
      GLOBALS_SOURCE.includes(
        '[data-markdown-editor] .cm-editor {',
      ) && GLOBALS_SOURCE.includes(
        'background-color: var(--background);',
      ),
      'Markdown CodeMirror canvas must use the same --background token as its workspace card',
    );
    assert.ok(
      GLOBALS_SOURCE.includes(
        '[data-markdown-editor] .cm-lp-heading {',
      ) && GLOBALS_SOURCE.includes(
        'color: var(--foreground);',
      ),
      'rendered Markdown headings must use the shared foreground token',
    );
    assert.ok(
      GLOBALS_SOURCE.includes(
        '[data-markdown-editor] .cm-lp-heading *,',
      ) && GLOBALS_SOURCE.includes(
        'color: inherit;',
      ),
      'nested CodeMirror syntax spans must inherit the rendered heading color',
    );
  });
});

describe('controlled value and asset contracts', () => {
  it('applies the smallest external diff without adding an undo step', () => {
    let state = EditorState.create({ doc: 'alpha', extensions: [history()] });
    state = state.update({
      changes: { from: 5, insert: '!' },
      selection: { anchor: 6 },
    }).state;
    const sync = externalMarkdownValueSync(state, 'ALPHA!');
    assert.ok(sync);
    const transaction = state.update(sync);
    assert.equal(
      transaction.annotation(externalMarkdownValueSyncAnnotation),
      true,
      'external changes must be identifiable by Live Preview plugins',
    );
    state = transaction.state;
    assert.equal(state.doc.toString(), 'ALPHA!');
    assert.equal(state.selection.main.head, 6);

    let undone = state;
    const didUndo = undo({
      state,
      dispatch(transaction) {
        undone = transaction.state;
      },
    });
    assert.equal(didUndo, true);
    assert.equal(undone.doc.toString(), 'ALPHA');
  });

  it('rebuilds block widgets from externally-synchronised content', () => {
    const initial = '| A |\n| --- |\n| old |\n\nend';
    let state = EditorState.create({
      doc: initial,
      selection: { anchor: initial.length },
      extensions: [
        markdown({ base: markdownLanguage }),
        markdownLivePreview(),
      ],
    });
    const next = initial.replace('old', 'new');
    const sync = externalMarkdownValueSync(state, next);
    assert.ok(sync);
    state = state.update(sync).state;

    const blockDecorations = state
      .facet(EditorView.decorations)
      .find(
        (source): source is DecorationSet =>
          typeof source !== 'function' && typeof source.iter === 'function',
      );
    if (!blockDecorations) throw new Error('block decorations are missing');
    const blockCursor = blockDecorations.iter();
    if (!blockCursor.value) throw new Error('table widget decoration is missing');
    const widget = blockCursor.value.spec.widget as
      | { source?: string }
      | undefined;
    assert.equal(widget?.source?.includes('new'), true);
    assert.equal(widget?.source?.includes('old'), false);
  });

  it('retains the standard document-search key binding without gutters', () => {
    const state = EditorState.create({
      extensions: [markdownEditingExtensions],
    });
    const keys = state.facet(keymap).flat().map((binding) => binding.key);
    assert.ok(keys.includes('Mod-f'));
  });

  it('resolves relative images through the session-scoped file route', () => {
    assert.equal(
      resolveMarkdownAssetUrl('../img/diagram.png', {
        filename: '/workspace/docs/note.md',
        sessionId: 'session 1',
      }),
      '/api/files/serve?path=%2Fworkspace%2Fimg%2Fdiagram.png&sessionId=session%201',
    );
    assert.equal(
      resolveMarkdownAssetUrl('https://example.com/image.png', {
        filename: '/workspace/docs/note.md',
        sessionId: 'session-1',
      }),
      'https://example.com/image.png',
    );
  });
});
