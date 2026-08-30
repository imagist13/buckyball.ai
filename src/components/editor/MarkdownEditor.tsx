"use client";

import { useEffect, useRef } from "react";
import {
  EditorState,
  Compartment,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  dropCursor,
  keymap,
  rectangularSelection,
} from "@codemirror/view";
import { minimalSetup } from "codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { oneDark } from "@codemirror/theme-one-dark";
import { indentWithTab } from "@codemirror/commands";
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
} from "@codemirror/search";
import { useTheme } from "next-themes";
import {
  externalMarkdownValueSync,
  markdownLivePreview,
} from "@/components/editor/markdown-live-preview";

export const markdownEditingExtensions: Extension = [
  EditorState.allowMultipleSelections.of(true),
  dropCursor(),
  indentOnInput(),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  rectangularSelection(),
  crosshairCursor(),
  search(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...searchKeymap,
    ...completionKeymap,
  ]),
];

/*
 * MarkdownEditor — Phase 4 replacement for the raw <textarea> in
 * SkillEditor (and the future standalone .md editor surface).
 *
 * Design points (POC 0.4 §[设计]):
 * - Compartment-based theme swap so light↔dark does not rebuild the
 *   EditorView (no flash, no cursor loss).
 * - Value prop is controlled — external writes flow in via a diff
 *   dispatch, internal edits flow out via updateListener.
 * - Mod-s is intercepted for onSave; Tab inserts two spaces via
 *   indentWithTab to match the legacy textarea's behavior.
 * - CodeMirror owns its own virtualization (O(viewport) render), so 10-
 *   万-character files stay responsive without any app-side work.
 *
 * Style isolation from Tailwind v4 preflight is handled in globals.css
 * via `@layer base { .cm-editor, .cm-editor * { all: revert-layer; } }`
 * (POC 0.4 path C). Do not wrap this component in Shadow DOM —
 * token inheritance would break and focus behavior gets weird.
 */
export interface MarkdownEditorProps {
  value: string;
  onChange: (v: string) => void;
  onSave?: () => void;
  /** Optional filename shown via data-attribute (used for testing hooks). */
  filename?: string;
  /** Session scope used to resolve relative Markdown image paths safely. */
  sessionId?: string | null;
  /** Aria label for a11y; also shown as placeholder hint. */
  placeholder?: string;
  className?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  filename,
  sessionId,
  placeholder,
  className,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Compartment is stable across renders — store on ref init so we don't
  // create a new one on every render (which would cause reconfigure loops).
  const themeCompartment = useRef(new Compartment()).current;
  const livePreviewCompartment = useRef(new Compartment()).current;
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const { resolvedTheme } = useTheme();

  // Refs track the latest callbacks so CodeMirror's long-lived listener
  // never captures a stale closure. Without this, fast typing after
  // onChange identity changes would dispatch into the old handler.
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // Initialize EditorView once per mount. State changes flow through
  // dispatches in the other effects below.
  useEffect(() => {
    if (!hostRef.current || viewRef.current) return;

    const baseTheme = EditorView.theme({
      "&": {
        height: "100%",
        minWidth: "0",
        width: "100%",
        fontSize: "14px",
      },
      ".cm-scroller": {
        fontFamily: "var(--font-sans, system-ui, sans-serif)",
        maxWidth: "100%",
        overflow: "auto",
      },
      ".cm-content": {
        boxSizing: "border-box",
        minWidth: "0",
        width: "100%",
        maxWidth: "100%",
        padding: "16px 18px",
      },
      ".cm-line": {
        lineHeight: "1.75rem",
        overflowWrap: "anywhere",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      },
      "&.cm-focused": { outline: "none" },
    });

    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          onSaveRef.current?.();
          return true;
        },
      },
      indentWithTab,
    ]);

    const initialTheme = resolvedTheme === "dark" ? oneDark : [];
    const livePreview = isMarkdownFilename(filename)
      ? markdownLivePreview({ filename, sessionId })
      : [];

    const state = EditorState.create({
      doc: value,
      extensions: [
        // `basicSetup` also installs line numbers, a fold gutter and active-
        // line highlighting. Live Preview is a document surface rather than
        // a code editor, so start from the gutter-free setup, then restore
        // the non-visual editing affordances users already had.
        minimalSetup,
        markdownEditingExtensions,
        // Use the package's extended parser (GFM tables, task lists, etc.).
        // markdown() defaults to CommonMark and silently parses pipe tables as
        // paragraphs, which would make Live Preview lose table parity.
        markdown({ base: markdownLanguage }),
        baseTheme,
        themeCompartment.of(initialTheme),
        livePreviewCompartment.of(livePreview),
        saveKeymap,
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;

    // The workspace sidebar is continuously resizable. CodeMirror normally
    // observes its own DOM, but a flex ancestor changing width can leave line
    // wrapping measured against the previous geometry until another input or
    // fast resize occurs. Observe the actual host and explicitly request a
    // measure so slow drags and programmatic sidebar changes wrap immediately.
    let measureFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(measureFrame);
      measureFrame = requestAnimationFrame(() => view.requestMeasure());
    });
    resizeObserver.observe(hostRef.current);

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(measureFrame);
      view.destroy();
      viewRef.current = null;
    };
    // Intentional single-run — subsequent prop changes propagate via
    // dedicated effects (value / theme / Live Preview options).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value changes — replace doc contents via dispatch.
  // Skips when the incoming value already matches what CodeMirror has,
  // so typing doesn't cause a self-echo loop.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const spec = externalMarkdownValueSync(view.state, value);
    if (spec) view.dispatch(spec);
  }, [value]);

  // Theme compartment swap — no EditorView rebuild, no cursor loss.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.reconfigure(
        resolvedTheme === "dark" ? oneDark : [],
      ),
    });
  }, [resolvedTheme, themeCompartment]);

  // A PreviewPanel instance may stay mounted while the active file changes.
  // Reconfigure the resolver so relative images always belong to the current
  // Markdown file/session without rebuilding the EditorView or losing history.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: livePreviewCompartment.reconfigure(
        isMarkdownFilename(filename)
          ? markdownLivePreview({ filename, sessionId })
          : [],
      ),
    });
  }, [filename, sessionId, livePreviewCompartment]);

  return (
    <div
      ref={hostRef}
      className={className ?? "h-full w-full overflow-hidden"}
      data-filename={filename}
      data-markdown-editor={isMarkdownFilename(filename) || undefined}
      aria-label={placeholder}
    />
  );
}

function isMarkdownFilename(filename: string | undefined): boolean {
  return !!filename && /\.(?:md|mdx)$/i.test(filename);
}
