/**
 * Phase 0.A — DOM-free Live Preview feasibility POC.
 *
 * This file intentionally imports only a helper under `src/__tests__`.
 * It does not connect the POC to PreviewPanel, routes, menus, or any
 * production component.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { history, undo, undoDepth } from '@codemirror/commands';
import {
  EditorSelection,
  EditorState,
  type Extension,
} from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import {
  buildLivePreviewSnapshot,
  externalSyncSpec,
  listDecorationRanges,
  livePreviewAtomicExtension,
  reduceLivePreview,
} from '../helpers/live-preview-poc';

function stateWith(
  doc: string,
  cursor = doc.length,
  extensions: Extension = [],
) {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions,
  });
}

describe('Phase 0.A decoration model', () => {
  it('renders heading, strong, inline code, and link while inactive', () => {
    const doc = '# Title\n\n**bold** and `code` [label](https://example.com)';
    const state = stateWith(doc, doc.indexOf(' and ') + 2);
    const snapshot = buildLivePreviewSnapshot(state, [{ from: 0, to: doc.length }]);

    assert.deepEqual(
      snapshot.semantic.map(({ kind, role }) => `${role}:${kind}`),
      [
        'replace:heading-prefix',
        'mark:heading-content',
        'replace:strong-marker',
        'mark:strong-content',
        'replace:strong-marker',
        'replace:code-marker',
        'mark:code-content',
        'replace:code-marker',
        'replace:link-marker',
        'mark:link-content',
        'replace:link-marker',
      ],
    );
  });

  it('reveals the complete Markdown node touched by the cursor', () => {
    const doc = 'Before **bold** after';
    const cursor = doc.indexOf('bold') + 2;
    const snapshot = buildLivePreviewSnapshot(stateWith(doc, cursor), [
      { from: 0, to: doc.length },
    ]);

    assert.equal(
      snapshot.semantic.some((item) => item.kind.startsWith('strong-')),
      false,
    );
  });

  it('reveals every node touched by a cross-node selection', () => {
    const doc = '**one** gap `two`';
    const state = EditorState.create({
      doc,
      selection: EditorSelection.range(3, doc.indexOf('two') + 2),
    });
    const snapshot = buildLivePreviewSnapshot(state, [{ from: 0, to: doc.length }]);

    assert.equal(snapshot.semantic.length, 0);
  });

  it('uses half-open visible ranges and does not duplicate a spanning node', () => {
    const doc = 'xxxx **spanning** yyyy';
    const state = stateWith(doc, 0);
    const nodeStart = doc.indexOf('**');
    const nodeEnd = doc.lastIndexOf('**') + 2;
    const split = doc.indexOf('spanning') + 3;
    const snapshot = buildLivePreviewSnapshot(state, [
      { from: nodeStart, to: split },
      { from: split, to: nodeEnd },
    ]);

    assert.equal(
      snapshot.semantic.filter((item) => item.kind === 'strong-marker').length,
      2,
    );

    const outside = buildLivePreviewSnapshot(state, [
      { from: nodeEnd, to: doc.length },
    ]);
    assert.equal(
      outside.semantic.some((item) => item.kind.startsWith('strong-')),
      false,
    );
  });

  it('turns every hidden marker into an atomic range provider', () => {
    const doc = '**bold** and `code`';
    const snapshot = buildLivePreviewSnapshot(stateWith(doc, doc.length), [
      { from: 0, to: doc.length },
    ]);
    const expected = snapshot.semantic
      .filter((item) => item.role === 'replace')
      .map(({ from, to, kind }) => ({ from, to, kind }));

    assert.deepEqual(listDecorationRanges(snapshot.atomicRanges), expected);

    const state = stateWith(doc, doc.length, [
      livePreviewAtomicExtension(snapshot),
    ]);
    const providers = state.facet(EditorView.atomicRanges);
    assert.equal(providers.length, 1);
    assert.strictEqual(providers[0]({} as EditorView), snapshot.atomicRanges);
  });
});

describe('Phase 0.A IME freeze contract', () => {
  it('does not rebuild decorations during composition-only updates', () => {
    const doc = '**stable**';
    const state = stateWith(doc, doc.length);
    const previous = buildLivePreviewSnapshot(state, [{ from: 0, to: doc.length }]);
    const frozen = reduceLivePreview(previous, state, {
      composing: true,
      docChanged: false,
      selectionSet: true,
      viewportChanged: false,
      visibleRanges: [{ from: 0, to: doc.length }],
    });

    assert.strictEqual(frozen.decorations, previous.decorations);
    assert.strictEqual(frozen.atomicRanges, previous.atomicRanges);
    assert.equal(frozen.source, 'frozen');
  });

  it('maps existing decorations across composition text changes', () => {
    const doc = 'x **stable**';
    const before = stateWith(doc, 0);
    const previous = buildLivePreviewSnapshot(before, [{ from: 0, to: doc.length }]);
    const transaction = before.update({ changes: { from: 0, insert: '中' } });
    const mapped = reduceLivePreview(previous, transaction.state, {
      composing: true,
      docChanged: true,
      selectionSet: false,
      viewportChanged: false,
      changes: transaction.changes,
      visibleRanges: [{ from: 0, to: transaction.state.doc.length }],
    });

    assert.equal(mapped.source, 'frozen-mapped');
    assert.deepEqual(
      listDecorationRanges(mapped.atomicRanges).map(({ from, to }) => ({ from, to })),
      listDecorationRanges(previous.atomicRanges).map(({ from, to }) => ({
        from: from + 1,
        to: to + 1,
      })),
    );
  });

  it('rebuilds on the empty update that follows compositionend', () => {
    const before = stateWith('plain', 0);
    const previous = buildLivePreviewSnapshot(before, [{ from: 0, to: 5 }]);
    const transaction = before.update({
      changes: { from: 5, insert: ' **new**' },
    });
    const duringComposition = reduceLivePreview(previous, transaction.state, {
      composing: true,
      docChanged: true,
      selectionSet: false,
      viewportChanged: false,
      changes: transaction.changes,
      visibleRanges: [{ from: 0, to: transaction.state.doc.length }],
    });

    const afterComposition = reduceLivePreview(
      duringComposition,
      transaction.state,
      {
        composing: false,
        docChanged: false,
        selectionSet: false,
        viewportChanged: false,
        visibleRanges: [{ from: 0, to: transaction.state.doc.length }],
      },
    );

    assert.equal(afterComposition.source, 'rebuilt');
    assert.equal(
      afterComposition.semantic.some((item) => item.kind === 'strong-content'),
      true,
    );
  });
});

describe('Phase 0.A history and controlled-value sync', () => {
  it('creates a minimal middle replacement and excludes it from history', () => {
    let state = stateWith('hello world', 11, [history()]);
    state = state.update({
      changes: { from: 11, insert: '!' },
      userEvent: 'input.type',
    }).state;
    assert.equal(undoDepth(state), 1);

    const spec = externalSyncSpec(state, 'hello CodePilot!');
    assert.ok(spec);
    const transaction = state.update(spec);
    const changedSpans: Array<{
      fromA: number;
      toA: number;
      fromB: number;
      toB: number;
      insert: string;
    }> = [];
    transaction.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      changedSpans.push({
        fromA,
        toA,
        fromB,
        toB,
        insert: inserted.toString(),
      });
    });
    assert.deepEqual(changedSpans, [
      { fromA: 6, toA: 11, fromB: 6, toB: 15, insert: 'CodePilot' },
    ]);
    state = transaction.state;

    assert.equal(state.doc.toString(), 'hello CodePilot!');
    assert.equal(
      state.selection.main.head,
      transaction.changes.mapPos(
        transaction.startState.selection.main.head,
        transaction.startState.selection.main.assoc,
      ),
    );
    assert.notEqual(state.selection.main.head, 0);
    assert.equal(undoDepth(state), 1);

    const didUndo = undo({
      state,
      dispatch(transactionToApply) {
        state = transactionToApply.state;
      },
    });
    assert.equal(didUndo, true);
    assert.equal(state.doc.toString(), 'hello CodePilot');
  });

  it('returns null when the controlled value is unchanged', () => {
    const state = stateWith('same');
    assert.equal(externalSyncSpec(state, 'same'), null);
  });

  it('recomputing decorations cannot add an undo event', () => {
    const doc = '**bold**';
    const state = stateWith(doc, doc.length, [history()]);
    const before = undoDepth(state);
    buildLivePreviewSnapshot(state, [{ from: 0, to: doc.length }]);
    buildLivePreviewSnapshot(
      stateWith(doc, 3, [history()]),
      [{ from: 0, to: doc.length }],
    );
    assert.equal(undoDepth(state), before);
  });
});
