import { markdownLanguage } from '@codemirror/lang-markdown';
import {
  EditorState,
  Transaction,
  type ChangeDesc,
  type SelectionRange,
  type TransactionSpec,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  type DecorationSet,
} from '@codemirror/view';

export interface VisibleRange {
  from: number;
  to: number;
}

export interface SemanticDecoration {
  from: number;
  to: number;
  kind:
    | 'heading-prefix'
    | 'heading-content'
    | 'strong-marker'
    | 'strong-content'
    | 'emphasis-marker'
    | 'emphasis-content'
    | 'code-marker'
    | 'code-content'
    | 'link-marker'
    | 'link-content';
  role: 'replace' | 'mark';
}

export interface LivePreviewSnapshot {
  decorations: DecorationSet;
  atomicRanges: DecorationSet;
  semantic: readonly SemanticDecoration[];
  source: 'rebuilt' | 'frozen' | 'frozen-mapped';
}

export interface PreviewUpdate {
  composing: boolean;
  docChanged: boolean;
  selectionSet: boolean;
  viewportChanged: boolean;
  changes?: ChangeDesc;
  visibleRanges: readonly VisibleRange[];
}

function overlapsVisible(
  from: number,
  to: number,
  ranges: readonly VisibleRange[],
): boolean {
  return ranges.some((range) => from < range.to && range.from < to);
}

function touchesSelection(
  from: number,
  to: number,
  ranges: readonly SelectionRange[],
): boolean {
  return ranges.some((range) => {
    if (range.empty) {
      return range.from >= from && range.from <= to;
    }
    return range.from <= to && range.to >= from;
  });
}

export function buildLivePreviewSnapshot(
  state: EditorState,
  visibleRanges: readonly VisibleRange[],
): LivePreviewSnapshot {
  const document = state.doc.toString();
  const tree = markdownLanguage.parser.parse(document);
  const decorationRanges: ReturnType<Decoration['range']>[] = [];
  const atomicRanges: ReturnType<Decoration['range']>[] = [];
  const semantic: SemanticDecoration[] = [];

  const addReplace = (
    from: number,
    to: number,
    kind: SemanticDecoration['kind'],
  ) => {
    if (to <= from) return;
    const value = Decoration.replace({ codepilotKind: kind });
    const range = value.range(from, to);
    decorationRanges.push(range);
    atomicRanges.push(range);
    semantic.push({ from, to, kind, role: 'replace' });
  };

  const addMark = (
    from: number,
    to: number,
    kind: SemanticDecoration['kind'],
    className: string,
  ) => {
    if (to <= from) return;
    decorationRanges.push(
      Decoration.mark({ class: className, codepilotKind: kind }).range(from, to),
    );
    semantic.push({ from, to, kind, role: 'mark' });
  };

  tree.iterate({
    enter(ref) {
      const { node, from, to, name } = ref;
      if (!overlapsVisible(from, to, visibleRanges)) return;
      if (touchesSelection(from, to, state.selection.ranges)) return;

      if (/^ATXHeading[1-6]$/.test(name)) {
        const marker = node.getChild('HeaderMark');
        if (!marker) return;
        let prefixTo = marker.to;
        while (prefixTo < to && /[ \t]/.test(document[prefixTo] ?? '')) {
          prefixTo += 1;
        }
        const level = Number(name.slice(-1));
        addReplace(marker.from, prefixTo, 'heading-prefix');
        addMark(prefixTo, to, 'heading-content', `cm-lp-heading cm-lp-h${level}`);
        return;
      }

      if (name === 'StrongEmphasis' || name === 'Emphasis') {
        const marks = node.getChildren('EmphasisMark');
        if (marks.length < 2) return;
        const markerKind =
          name === 'StrongEmphasis' ? 'strong-marker' : 'emphasis-marker';
        const contentKind =
          name === 'StrongEmphasis' ? 'strong-content' : 'emphasis-content';
        const className =
          name === 'StrongEmphasis' ? 'cm-lp-strong' : 'cm-lp-emphasis';
        addReplace(marks[0].from, marks[0].to, markerKind);
        addReplace(marks.at(-1)!.from, marks.at(-1)!.to, markerKind);
        addMark(marks[0].to, marks.at(-1)!.from, contentKind, className);
        return;
      }

      if (name === 'InlineCode') {
        const marks = node.getChildren('CodeMark');
        if (marks.length < 2) return;
        addReplace(marks[0].from, marks[0].to, 'code-marker');
        addReplace(marks.at(-1)!.from, marks.at(-1)!.to, 'code-marker');
        addMark(marks[0].to, marks.at(-1)!.from, 'code-content', 'cm-lp-code');
        return;
      }

      if (name === 'Link') {
        const marks = node.getChildren('LinkMark');
        if (marks.length < 4) return;
        addReplace(marks[0].from, marks[0].to, 'link-marker');
        addReplace(marks[1].from, to, 'link-marker');
        addMark(marks[0].to, marks[1].from, 'link-content', 'cm-lp-link');
      }
    },
  });

  semantic.sort((left, right) => left.from - right.from || left.to - right.to);

  return {
    decorations: Decoration.set(decorationRanges, true),
    atomicRanges: Decoration.set(atomicRanges, true),
    semantic,
    source: 'rebuilt',
  };
}

export function reduceLivePreview(
  previous: LivePreviewSnapshot,
  state: EditorState,
  update: PreviewUpdate,
): LivePreviewSnapshot {
  if (update.composing) {
    if (update.docChanged && update.changes) {
      return {
        ...previous,
        decorations: previous.decorations.map(update.changes),
        atomicRanges: previous.atomicRanges.map(update.changes),
        semantic: previous.semantic.map((item) => ({
          ...item,
          from: update.changes!.mapPos(item.from, 1),
          to: update.changes!.mapPos(item.to, -1),
        })),
        source: 'frozen-mapped',
      };
    }
    return { ...previous, source: 'frozen' };
  }

  const compositionJustEnded =
    previous.source === 'frozen' || previous.source === 'frozen-mapped';
  if (
    compositionJustEnded ||
    update.docChanged ||
    update.selectionSet ||
    update.viewportChanged
  ) {
    return buildLivePreviewSnapshot(state, update.visibleRanges);
  }
  return previous;
}

export function externalSyncSpec(
  state: EditorState,
  nextValue: string,
): TransactionSpec | null {
  const current = state.doc.toString();
  if (current === nextValue) return null;

  const sharedLimit = Math.min(current.length, nextValue.length);
  let prefix = 0;
  while (prefix < sharedLimit && current[prefix] === nextValue[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < sharedLimit - prefix &&
    current[current.length - 1 - suffix] ===
      nextValue[nextValue.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return {
    changes: {
      from: prefix,
      to: current.length - suffix,
      insert: nextValue.slice(prefix, nextValue.length - suffix),
    },
    annotations: Transaction.addToHistory.of(false),
  };
}

export function livePreviewAtomicExtension(snapshot: LivePreviewSnapshot) {
  return EditorView.atomicRanges.of(() => snapshot.atomicRanges);
}

export function listDecorationRanges(set: DecorationSet) {
  const result: Array<{
    from: number;
    to: number;
    kind: string | undefined;
  }> = [];
  const cursor = set.iter();
  while (cursor.value) {
    result.push({
      from: cursor.from,
      to: cursor.to,
      kind: cursor.value.spec.codepilotKind,
    });
    cursor.next();
  }
  return result;
}
