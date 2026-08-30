import { syntaxTree } from "@codemirror/language";
import {
  Annotation,
  EditorState,
  RangeSet,
  StateField,
  Transaction,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import katex from "katex";

export interface MarkdownLivePreviewOptions {
  filename?: string;
  sessionId?: string | null;
}

export interface BuiltMarkdownLivePreview {
  decorations: DecorationSet;
  atomic: DecorationSet;
}

export interface MarkdownVisibleRange {
  from: number;
  to: number;
}

type Span = MarkdownVisibleRange;

export const externalMarkdownValueSyncAnnotation =
  Annotation.define<boolean>();

function overlaps(left: Span, right: Span): boolean {
  return left.from < right.to && right.from < left.to;
}

function mergedSpans(ranges: readonly Span[]): Span[] {
  const sorted = ranges
    .filter((range) => range.to > range.from)
    .map((range) => ({ from: range.from, to: range.to }))
    .sort((left, right) => left.from - right.from);
  const merged: Span[] = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (previous && range.from <= previous.to) {
      previous.to = Math.max(previous.to, range.to);
    } else {
      merged.push(range);
    }
  }
  return merged;
}

function overlapsAny(span: Span, ranges: readonly Span[]): boolean {
  return ranges.some((range) => overlaps(span, range));
}

function markdownFrontmatterSpan(documentText: string): Span | null {
  const match = documentText.match(
    /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/,
  );
  return match ? { from: 0, to: match[0].length } : null;
}

function activeLines(state: EditorState): Span[] {
  return state.selection.ranges.map((range) => {
    const first = state.doc.lineAt(range.from);
    const last = state.doc.lineAt(range.to);
    return { from: first.from, to: last.to };
  });
}

function activeLineKey(state: EditorState): string {
  return state.selection.ranges
    .map(
      (range) =>
        `${state.doc.lineAt(range.from).number}:${state.doc.lineAt(range.to).number}`,
    )
    .join(",");
}

function revealSource(view: EditorView, position: number) {
  view.dispatch({
    selection: { anchor: position },
    scrollIntoView: true,
  });
  view.focus();
}

abstract class RevealWidget extends WidgetType {
  constructor(readonly sourceFrom: number) {
    super();
  }

  protected makeRoot(
    view: EditorView,
    tag: keyof HTMLElementTagNameMap,
    className: string,
  ): HTMLElement {
    const element = document.createElement(tag);
    element.className = className;
    element.dataset.markdownLivePreview = "";
    element.title = "点击编辑 Markdown 源码";
    element.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      revealSource(view, this.sourceFrom);
    });
    return element;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class TextWidget extends RevealWidget {
  constructor(
    sourceFrom: number,
    readonly text: string,
    readonly className: string,
  ) {
    super(sourceFrom);
  }

  eq(other: TextWidget): boolean {
    return (
      other.sourceFrom === this.sourceFrom &&
      other.text === this.text &&
      other.className === this.className
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const span = this.makeRoot(view, "span", this.className);
    span.textContent = this.text;
    return span;
  }
}

class TaskCheckboxWidget extends RevealWidget {
  constructor(sourceFrom: number, readonly checked: boolean) {
    super(sourceFrom);
  }

  eq(other: TaskCheckboxWidget): boolean {
    return other.sourceFrom === this.sourceFrom && other.checked === this.checked;
  }

  toDOM(view: EditorView): HTMLElement {
    const root = this.makeRoot(view, "span", "cm-lp-task-checkbox");
    root.setAttribute("role", "checkbox");
    root.setAttribute("aria-checked", String(this.checked));
    root.setAttribute("aria-disabled", "true");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = this.checked;
    checkbox.disabled = true;
    checkbox.tabIndex = -1;
    checkbox.setAttribute("aria-hidden", "true");
    root.append(checkbox);
    return root;
  }
}

class RuleWidget extends RevealWidget {
  eq(other: RuleWidget): boolean {
    return other.sourceFrom === this.sourceFrom;
  }

  toDOM(view: EditorView): HTMLElement {
    return this.makeRoot(view, "hr", "cm-lp-rule");
  }
}

class ImageWidget extends RevealWidget {
  constructor(
    sourceFrom: number,
    readonly src: string,
    readonly alt: string,
  ) {
    super(sourceFrom);
  }

  eq(other: ImageWidget): boolean {
    return (
      other.sourceFrom === this.sourceFrom &&
      other.src === this.src &&
      other.alt === this.alt
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const figure = this.makeRoot(view, "span", "cm-lp-image");
    const image = document.createElement("img");
    image.src = this.src;
    image.alt = this.alt;
    image.loading = "lazy";
    figure.append(image);
    if (this.alt) {
      const caption = document.createElement("span");
      caption.className = "cm-lp-image-caption";
      caption.textContent = this.alt;
      figure.append(caption);
    }
    return figure;
  }
}

class CodeBlockWidget extends RevealWidget {
  constructor(
    sourceFrom: number,
    readonly code: string,
    readonly language: string,
  ) {
    super(sourceFrom);
  }

  eq(other: CodeBlockWidget): boolean {
    return (
      other.sourceFrom === this.sourceFrom &&
      other.code === this.code &&
      other.language === this.language
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const card = this.makeRoot(view, "div", "cm-lp-block cm-lp-code-block");
    const header = document.createElement("div");
    header.className = "cm-lp-block-header";
    header.textContent = this.language || "code";
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = this.code;
    pre.append(code);
    card.append(header, pre);
    return card;
  }
}

let mermaidRenderSequence = 0;

class MermaidWidget extends RevealWidget {
  constructor(sourceFrom: number, readonly source: string) {
    super(sourceFrom);
  }

  eq(other: MermaidWidget): boolean {
    return other.sourceFrom === this.sourceFrom && other.source === this.source;
  }

  toDOM(view: EditorView): HTMLElement {
    const card = this.makeRoot(view, "div", "cm-lp-block cm-lp-mermaid");
    const status = document.createElement("div");
    status.className = "cm-lp-mermaid-loading";
    status.textContent = "Rendering diagram…";
    card.append(status);

    const renderId = `codepilot-mermaid-${++mermaidRenderSequence}`;
    void import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: document.documentElement.classList.contains("dark") ? "dark" : "default",
        });
        const { svg } = await mermaid.render(renderId, this.source);
        if (!card.isConnected) return;
        card.innerHTML = svg;
      })
      .catch(() => {
        if (!card.isConnected) return;
        card.classList.add("cm-lp-render-error");
        status.textContent = this.source;
      });
    return card;
  }
}

class MathWidget extends RevealWidget {
  constructor(
    sourceFrom: number,
    readonly expression: string,
    readonly displayMode: boolean,
  ) {
    super(sourceFrom);
  }

  eq(other: MathWidget): boolean {
    return (
      other.sourceFrom === this.sourceFrom &&
      other.expression === this.expression &&
      other.displayMode === this.displayMode
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const root = this.makeRoot(
      view,
      this.displayMode ? "div" : "span",
      this.displayMode ? "cm-lp-block cm-lp-math-block" : "cm-lp-math-inline",
    );
    try {
      root.innerHTML = katex.renderToString(this.expression, {
        displayMode: this.displayMode,
        throwOnError: false,
        strict: "warn",
        trust: false,
      });
    } catch {
      root.classList.add("cm-lp-render-error");
      root.textContent = this.expression;
    }
    return root;
  }
}

function splitPipeRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const char of trimmed) {
    if (escaped) {
      cell += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function inlineText(value: string): string {
  return value
    .replace(/!\[([^\]]*)]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/`([^`]+)`/g, "$1");
}

class TableWidget extends RevealWidget {
  constructor(sourceFrom: number, readonly source: string) {
    super(sourceFrom);
  }

  eq(other: TableWidget): boolean {
    return other.sourceFrom === this.sourceFrom && other.source === this.source;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = this.makeRoot(view, "div", "cm-lp-block cm-lp-table-wrap");
    const rows = this.source.split(/\r?\n/).filter(Boolean).map(splitPipeRow);
    const table = document.createElement("table");
    const header = rows[0] ?? [];
    const bodyRows = rows.slice(2);
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const cell of header) {
      const th = document.createElement("th");
      th.textContent = inlineText(cell);
      headRow.append(th);
    }
    thead.append(headRow);
    const tbody = document.createElement("tbody");
    for (const row of bodyRows) {
      const tr = document.createElement("tr");
      for (const cell of row) {
        const td = document.createElement("td");
        td.textContent = inlineText(cell);
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(thead, tbody);
    wrapper.append(table);
    return wrapper;
  }
}

function normalizeAssetPath(filename: string, target: string): string {
  if (/^(?:[a-z]+:|\/\/|#)/i.test(target)) return target;
  const normalizedTarget = target.replace(/\\/g, "/");
  if (normalizedTarget.startsWith("/")) return normalizedTarget;
  const source = filename.replace(/\\/g, "/");
  const parts = `${source.slice(0, Math.max(0, source.lastIndexOf("/") + 1))}${normalizedTarget}`
    .split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  const drive = source.match(/^[A-Za-z]:/)?.[0];
  if (drive) return `${drive}/${resolved.slice(1).join("/")}`;
  return `/${resolved.join("/")}`;
}

export function resolveMarkdownAssetUrl(
  target: string,
  options: MarkdownLivePreviewOptions,
): string {
  if (/^(?:https?:|data:|blob:|#)/i.test(target)) return target;
  if (!options.filename) return target;
  const absolutePath = normalizeAssetPath(options.filename, target);
  if (options.sessionId) {
    return `/api/files/serve?path=${encodeURIComponent(absolutePath)}&sessionId=${encodeURIComponent(options.sessionId)}`;
  }
  return `/api/files/raw?path=${encodeURIComponent(absolutePath)}`;
}

function blockCode(source: string): { language: string; code: string } {
  const lines = source.split(/\r?\n/);
  const opening = lines.shift() ?? "";
  if (/^\s*(```|~~~)/.test(lines.at(-1) ?? "")) lines.pop();
  return {
    language: opening.replace(/^\s*(```|~~~)\s*/, "").trim().split(/\s+/)[0] ?? "",
    code: lines.join("\n"),
  };
}

export function buildMarkdownLivePreview(
  state: EditorState,
  visibleRanges: readonly Span[],
  options: MarkdownLivePreviewOptions = {},
  mode: "all" | "inline" | "block" = "all",
): BuiltMarkdownLivePreview {
  const visible = mergedSpans(visibleRanges);
  const active = activeLines(state);
  const documentText = state.doc.toString();
  const decorationRanges: ReturnType<Decoration["range"]>[] = [];
  const atomicRanges: ReturnType<Decoration["range"]>[] = [];
  const blockSpans: Span[] = [];

  const isVisible = (span: Span) => overlapsAny(span, visible);
  const isActive = (span: Span) => overlapsAny(span, active);
  const addReplace = (
    from: number,
    to: number,
    widget?: WidgetType,
    block = false,
    kind?: string,
  ) => {
    if (to <= from) return;
    const decoration = Decoration.replace({
      ...(widget ? { widget } : {}),
      ...(block ? { block: true } : {}),
      codepilotKind: kind,
    });
    const range = decoration.range(from, to);
    decorationRanges.push(range);
    atomicRanges.push(range);
  };
  const addMark = (from: number, to: number, className: string) => {
    if (to <= from) return;
    decorationRanges.push(Decoration.mark({ class: className }).range(from, to));
  };
  const frontmatter = markdownFrontmatterSpan(documentText);
  if (frontmatter && isVisible(frontmatter)) {
    // Frontmatter remains lossless source. Without this exclusion the base
    // Markdown grammar interprets its delimiters as a HorizontalRule plus a
    // Setext heading, producing false visual semantics.
    blockSpans.push(frontmatter);
  }

  // Display math is not part of @lezer/markdown's base grammar. Detect it
  // line-wise before syntax-tree blocks so it participates in the same
  // active-line and viewport rules.
  const scannedMathLines = new Set<number>();
  for (const visibleRange of visible) {
    const firstVisibleLine = state.doc.lineAt(visibleRange.from).number;
    const lastVisibleLine = state.doc.lineAt(
      Math.max(visibleRange.from, Math.min(state.doc.length, visibleRange.to)),
    ).number;
    // One-line look-behind covers the common multi-line `$$` form without
    // turning every keystroke into an O(document lines) scan.
    for (
      let lineNumber = Math.max(1, firstVisibleLine - 1);
      lineNumber <= lastVisibleLine;
      lineNumber += 1
    ) {
      if (scannedMathLines.has(lineNumber)) continue;
      scannedMathLines.add(lineNumber);
      const line = state.doc.line(lineNumber);
      if (!line.text.trimStart().startsWith("$$")) continue;
      let endLine = line;
      let expression = line.text.trim().slice(2);
      if (expression.endsWith("$$") && expression.length > 2) {
        expression = expression.slice(0, -2);
      } else {
        const body: string[] = expression ? [expression] : [];
        for (let cursor = lineNumber + 1; cursor <= state.doc.lines; cursor += 1) {
          endLine = state.doc.line(cursor);
          scannedMathLines.add(cursor);
          if (endLine.text.trimEnd().endsWith("$$")) {
            body.push(endLine.text.replace(/\$\$\s*$/, ""));
            lineNumber = cursor;
            break;
          }
          body.push(endLine.text);
        }
        expression = body.join("\n");
      }
      const span = { from: line.from, to: endLine.to };
      if (
        !isVisible(span) ||
        isActive(span) ||
        overlapsAny(span, blockSpans)
      ) {
        continue;
      }
      blockSpans.push(span);
      if (mode !== "inline") {
        addReplace(
          span.from,
          span.to,
          new MathWidget(span.from, expression.trim(), true),
          true,
          "math-block",
        );
      }
    }
  }

  for (const visibleRange of visible) {
    syntaxTree(state).iterate({
      from: visibleRange.from,
      to: visibleRange.to,
      enter(ref) {
        if (ref.name !== "FencedCode" && ref.name !== "Table") return;
        const span = { from: ref.from, to: ref.to };
        if (!isVisible(span) || isActive(span) || overlapsAny(span, blockSpans)) return;
        const source = documentText.slice(ref.from, ref.to);
        blockSpans.push(span);
        if (mode === "inline") return;
        if (ref.name === "Table") {
          addReplace(ref.from, ref.to, new TableWidget(ref.from, source), true, "table");
          return;
        }
        const parsed = blockCode(source);
        const widget =
          parsed.language.toLowerCase() === "mermaid"
            ? new MermaidWidget(ref.from, parsed.code)
            : new CodeBlockWidget(ref.from, parsed.code, parsed.language);
        addReplace(
          ref.from,
          ref.to,
          widget,
          true,
          parsed.language.toLowerCase() === "mermaid" ? "mermaid" : "code-block",
        );
      },
    });
  }

  if (mode === "block") {
    return {
      decorations: Decoration.set(decorationRanges, true),
      atomic: Decoration.set(atomicRanges, true),
    };
  }

  for (const visibleRange of visible) {
    syntaxTree(state).iterate({
      from: visibleRange.from,
      to: visibleRange.to,
      enter(ref) {
        const span = { from: ref.from, to: ref.to };
        if (
          !isVisible(span) ||
          isActive(span) ||
          overlapsAny(span, blockSpans)
        ) {
          return;
        }
        const node = ref.node;

        if (/^ATXHeading[1-6]$/.test(ref.name)) {
          const marker = node.getChild("HeaderMark");
          if (!marker) return;
          let contentFrom = marker.to;
          while (contentFrom < ref.to && /[ \t]/.test(documentText[contentFrom] ?? "")) {
            contentFrom += 1;
          }
          addReplace(marker.from, contentFrom, undefined, false, "heading-prefix");
          addMark(contentFrom, ref.to, `cm-lp-heading cm-lp-h${ref.name.slice(-1)}`);
          return;
        }

        if (/^SetextHeading[12]$/.test(ref.name)) {
          const marker = node.getChild("HeaderMark");
          if (!marker) return;
          let contentTo = marker.from;
          while (
            contentTo > ref.from &&
            /[\r\n]/.test(documentText[contentTo - 1] ?? "")
          ) {
            contentTo -= 1;
          }
          addMark(
            ref.from,
            contentTo,
            `cm-lp-heading cm-lp-h${ref.name.slice(-1)}`,
          );
          addReplace(
            marker.from,
            marker.to,
            undefined,
            false,
            "heading-prefix",
          );
          return;
        }

        if (ref.name === "StrongEmphasis" || ref.name === "Emphasis") {
          const marks = node.getChildren("EmphasisMark");
          if (marks.length < 2) return;
          addReplace(marks[0].from, marks[0].to, undefined, false, "emphasis-marker");
          addReplace(marks.at(-1)!.from, marks.at(-1)!.to, undefined, false, "emphasis-marker");
          addMark(
            marks[0].to,
            marks.at(-1)!.from,
            ref.name === "StrongEmphasis" ? "cm-lp-strong" : "cm-lp-emphasis",
          );
          return;
        }

        if (ref.name === "Strikethrough") {
          const marks = node.getChildren("StrikethroughMark");
          if (marks.length < 2) return;
          addReplace(
            marks[0].from,
            marks[0].to,
            undefined,
            false,
            "strikethrough-marker",
          );
          addReplace(
            marks.at(-1)!.from,
            marks.at(-1)!.to,
            undefined,
            false,
            "strikethrough-marker",
          );
          addMark(
            marks[0].to,
            marks.at(-1)!.from,
            "cm-lp-strikethrough",
          );
          return;
        }

        if (ref.name === "InlineCode") {
          const marks = node.getChildren("CodeMark");
          if (marks.length < 2) return;
          addReplace(marks[0].from, marks[0].to, undefined, false, "code-marker");
          addReplace(marks.at(-1)!.from, marks.at(-1)!.to, undefined, false, "code-marker");
          addMark(marks[0].to, marks.at(-1)!.from, "cm-lp-code");
          return;
        }

        if (ref.name === "Image") {
          const source = documentText.slice(ref.from, ref.to);
          const match = source.match(/^!\[([^\]]*)]\((\S+?)(?:\s+["'][^"']*["'])?\)$/);
          if (!match) return;
          addReplace(
            ref.from,
            ref.to,
            new ImageWidget(
              ref.from,
              resolveMarkdownAssetUrl(match[2], options),
              match[1],
            ),
            false,
            "image",
          );
          return;
        }

        if (ref.name === "Link") {
          const marks = node.getChildren("LinkMark");
          if (marks.length < 4) return;
          addReplace(marks[0].from, marks[0].to, undefined, false, "link-marker");
          addReplace(marks[1].from, marks.at(-1)!.to, undefined, false, "link-target");
          addMark(marks[0].to, marks[1].from, "cm-lp-link");
          return;
        }

        if (ref.name === "TaskMarker") {
          const marker = documentText.slice(ref.from, ref.to);
          addReplace(
            ref.from,
            ref.to,
            new TaskCheckboxWidget(ref.from, /\[[xX]\]/.test(marker)),
            false,
            "task-checkbox",
          );
          return;
        }

        if (ref.name === "ListMark") {
          const task = node.parent?.getChild("Task");
          const taskMarker = task?.getChild("TaskMarker");
          if (taskMarker) {
            const marker = documentText.slice(ref.from, ref.to);
            if (/^\d/.test(marker)) {
              // Ordered task lists keep their visible sequence number. Only
              // unordered task bullets are redundant beside the checkbox.
              addReplace(
                ref.from,
                ref.to,
                new TextWidget(
                  ref.from,
                  marker,
                  "cm-lp-list-marker",
                ),
                false,
                "task-list-prefix",
              );
            } else {
              addReplace(
                ref.from,
                taskMarker.from,
                undefined,
                false,
                "task-list-prefix",
              );
            }
            return;
          }
          const marker = documentText.slice(ref.from, ref.to);
          const rendered = /^\d/.test(marker) ? marker : "•";
          addReplace(
            ref.from,
            ref.to,
            new TextWidget(ref.from, rendered, "cm-lp-list-marker"),
            false,
            "list-marker",
          );
          return;
        }

        if (ref.name === "QuoteMark") {
          addReplace(
            ref.from,
            ref.to,
            new TextWidget(ref.from, "│", "cm-lp-quote-marker"),
            false,
            "quote-marker",
          );
          return;
        }

        if (ref.name === "HorizontalRule") {
          addReplace(ref.from, ref.to, new RuleWidget(ref.from), false, "rule");
        }
      },
    });
  }

  // Inline math is likewise outside the Lezer Markdown base grammar.
  for (const visibleRange of visible) {
    const source = documentText.slice(visibleRange.from, visibleRange.to);
    const pattern = /(^|[^\\$])\$([^$\n]+?)\$/g;
    for (const match of source.matchAll(pattern)) {
      const prefixLength = match[1].length;
      const from = visibleRange.from + (match.index ?? 0) + prefixLength;
      const to = from + match[0].length - prefixLength;
      const span = { from, to };
      if (isActive(span) || overlapsAny(span, blockSpans)) continue;
      addReplace(
        from,
        to,
        new MathWidget(from, match[2], false),
        false,
        "math-inline",
      );
    }
  }

  return {
    decorations: Decoration.set(decorationRanges, true),
    atomic: Decoration.set(atomicRanges, true),
  };
}

export function externalMarkdownValueSync(
  state: EditorState,
  nextValue: string,
): TransactionSpec | null {
  const current = state.doc.toString();
  if (current === nextValue) return null;
  const limit = Math.min(current.length, nextValue.length);
  let prefix = 0;
  while (prefix < limit && current[prefix] === nextValue[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix &&
    current[current.length - 1 - suffix] === nextValue[nextValue.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    changes: {
      from: prefix,
      to: current.length - suffix,
      insert: nextValue.slice(prefix, nextValue.length - suffix),
    },
    annotations: [
      Transaction.addToHistory.of(false),
      externalMarkdownValueSyncAnnotation.of(true),
    ],
  };
}

export function markdownLivePreview(
  options: MarkdownLivePreviewOptions = {},
): Extension {
  const blockField = StateField.define<DecorationSet>({
    create(state) {
      return buildMarkdownLivePreview(
        state,
        [{ from: 0, to: state.doc.length }],
        options,
        "block",
      ).decorations;
    },
    update(value, transaction) {
      // A document change maps existing block widgets cheaply. While the
      // cursor remains inside a block that block is raw source, so its widget
      // does not need rebuilding on every keystroke. Recompute only on an
      // explicit selection move (enter/leave a block), or a controlled
      // external-value sync; this keeps normal typing cheap while ensuring a
      // quiet disk refresh rebuilds widgets whose rendered content changed.
      if (
        transaction.selection ||
        transaction.annotation(externalMarkdownValueSyncAnnotation)
      ) {
        return buildMarkdownLivePreview(
          transaction.state,
          [{ from: 0, to: transaction.state.doc.length }],
          options,
          "block",
        ).decorations;
      }
      return transaction.docChanged ? value.map(transaction.changes) : value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      atomic: DecorationSet;
      private composing = false;
      private activeKey: string;

      constructor(view: EditorView) {
        const built = buildMarkdownLivePreview(
          view.state,
          view.visibleRanges,
          options,
          "inline",
        );
        this.decorations = built.decorations;
        this.atomic = built.atomic;
        this.activeKey = activeLineKey(view.state);
      }

      update(update: ViewUpdate) {
        if (update.view.composing) {
          this.composing = true;
          if (update.docChanged) {
            this.decorations = this.decorations.map(update.changes);
            this.atomic = this.atomic.map(update.changes);
          }
          return;
        }
        const compositionJustEnded = this.composing;
        const externalValueChanged = update.transactions.some(
          (transaction) =>
            transaction.annotation(externalMarkdownValueSyncAnnotation),
        );
        const nextActiveKey = activeLineKey(update.state);
        const activeLineChanged = nextActiveKey !== this.activeKey;
        this.activeKey = nextActiveKey;
        if (update.docChanged) {
          // The active line is raw source, so normal typing cannot invalidate
          // an inline widget on that line. Mapping the existing viewport
          // decorations is sufficient until the cursor changes lines or the
          // viewport moves, and keeps keystroke latency at plain-editor cost.
          this.decorations = this.decorations.map(update.changes);
          this.atomic = this.atomic.map(update.changes);
        }
        if (
          compositionJustEnded ||
          externalValueChanged ||
          activeLineChanged ||
          (!update.docChanged &&
            (update.viewportChanged || update.geometryChanged))
        ) {
          this.composing = false;
          const built = buildMarkdownLivePreview(
            update.state,
            update.view.visibleRanges,
            options,
            "inline",
          );
          this.decorations = built.decorations;
          this.atomic = built.atomic;
        }
      }
    },
    {
      decorations: (value) => value.decorations,
    },
  );

  return [
    blockField,
    plugin,
    EditorView.atomicRanges.of((view) =>
      RangeSet.join([
        view.state.field(blockField),
        view.plugin(plugin)?.atomic ?? Decoration.none,
      ]),
    ),
  ];
}
