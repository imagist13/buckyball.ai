"use client";

/**
 * Markdown element overrides for chat messages.
 *
 * Plugged into <Streamdown components={CHAT_MARKDOWN_COMPONENTS}/> from
 * `MessageResponse` in `src/components/ai-elements/message.tsx`. The
 * goal is to bring the AI reply rendering in line with the same design
 * language the Widget card uses (rounded-xl card, muted backdrop,
 * always-visible top-right action buttons) instead of streamdown's
 * default browser-paper look.
 *
 * Geometry / colors mirror Widget card:
 *   - container: `rounded-xl bg-muted/20 p-4 my-4`
 *   - action button: `h-7 px-2 gap-1 rounded-md text-xs hover:bg-muted`
 *   - actions sit absolute top-2 right-2 — permanent, no opacity-gate
 *
 * Typography overrides bump every heading + paragraph one notch from
 * streamdown defaults so the chat thread reads at our application
 * font scale, not the library's compact default.
 *
 * Round 12 (2026-05-23): first cut of the unified markdown rendering.
 * "Export as PNG" on tables is deferred — that needs the same
 * `electronAPI.widget.exportPng` pipeline the Widget uses and is a
 * separate slice; the action button slot is reserved so we can
 * plug it in without restyling.
 */

import type { ComponentProps } from "react";
import { useCallback, useContext, useRef } from "react";
import type { BundledLanguage } from "shiki";
import { cn } from "@/lib/utils";
import { CodePilotIcon } from "@/components/ui/semantic-icon";
import { showToast } from "@/hooks/useToast";
import {
  CodeBlockContent,
  previewSourceForCodeFence,
} from "@/components/ai-elements/code-block";
import { PanelContext } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import {
  BASE_MARKDOWN_COMPONENTS,
  MarkdownInlineCode,
  isMarkdownFenceBlock,
  markdownChildrenToText,
  markdownFenceLanguage,
  type MarkdownCodeProps,
} from "@/components/markdown/markdown-contract";

// Shared card-action-button class — same geometry as Widget toolbar.
// `justify-center` is intentional: icon-only variants (h-7 w-7 px-0)
// would otherwise hug the left edge of the button, putting the
// hover background visibly off-center from the glyph. Round 13
// fix after user feedback.
const cardActionBtn =
  "h-7 px-2 gap-1 inline-flex items-center justify-center rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 disabled:pointer-events-none";

// ---------------------------------------------------------------------------
// Table → Widget-style card with action buttons
// ---------------------------------------------------------------------------

function ChatTable({ children, className, ...props }: ComponentProps<"table">) {
  const tableRef = useRef<HTMLTableElement>(null);

  // Copy the table's current visual content as a Markdown pipe table.
  // We walk the live DOM (rather than the React tree) because by the
  // time the click handler fires the streamdown blocks have already
  // committed; the DOM is the source of truth and avoids re-deriving
  // the markdown string from JSX.
  const handleCopyMarkdown = useCallback(async () => {
    const table = tableRef.current;
    if (!table) return;
    const rows: string[][] = [];
    table.querySelectorAll("tr").forEach((tr) => {
      const cells: string[] = [];
      tr.querySelectorAll("th, td").forEach((cell) => {
        // Cell text — collapse newlines so the pipe table stays one
        // row per source row. Escape pipes inside cells.
        cells.push((cell.textContent ?? "").replace(/\n+/g, " ").replace(/\|/g, "\\|").trim());
      });
      if (cells.length > 0) rows.push(cells);
    });
    if (rows.length === 0) return;
    const cols = rows[0].length;
    const lines: string[] = [];
    lines.push(`| ${rows[0].join(" | ")} |`);
    lines.push(`| ${Array.from({ length: cols }, () => "---").join(" | ")} |`);
    for (let i = 1; i < rows.length; i++) {
      lines.push(`| ${rows[i].join(" | ")} |`);
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      showToast({ type: "success", message: "已复制 Markdown 表格" });
    } catch {
      showToast({ type: "error", message: "复制失败" });
    }
  }, []);

  // Round 14: table body is inset from the card edges (px-3 pb-3 on
  // the scroll wrapper) so the horizontal dividers no longer run
  // from card-left to card-right. The action header bar stays full
  // width, which keeps the visual top of the card clean.
  return (
    <div className="my-4 rounded-xl bg-muted/20 overflow-hidden">
      <div className="flex items-center justify-end gap-1 bg-muted/30 px-2 py-1">
        <button type="button" onClick={handleCopyMarkdown} className={cn(cardActionBtn, "h-7 w-7 px-0")} aria-label="Copy as Markdown" title="复制 Markdown">
          <CodePilotIcon name="copy" size="sm" aria-hidden />
        </button>
        {/* Export PNG placeholder — same slot the Widget card uses for
            its download button. Wire-up deferred; needs the
            electronAPI.widget.exportPng plumbing applied to an HTML
            snapshot of the table. */}
        <button type="button" disabled className={cn(cardActionBtn, "h-7 w-7 px-0")} aria-label="Export PNG (coming soon)" title="导出图片（即将上线）">
          <CodePilotIcon name="download" size="sm" aria-hidden />
        </button>
      </div>
      <div className="overflow-x-auto px-3 pb-3 pt-2">
        <table ref={tableRef} className={cn("w-full text-sm border-collapse", className)} {...props}>
          {children}
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Code block — Widget-style card, Shiki-highlighted via the Web Worker
// ---------------------------------------------------------------------------
// Chat code-fence highlighting fix: the previous cut mapped `code` to a plain
// inline pill for BOTH inline and fenced code and `pre` to the card chrome.
// Because react-markdown/streamdown render a fenced block as `<pre><code>`,
// overriding `code` with an inline pill made real chat code fences render as
// un-highlighted text and NEVER reach `highlightCode()` → the Shiki Worker
// (they were "swallowed" as inline code). Streamdown's own block renderer —
// the only thing that consults `plugins.code` / `createSharedCodePlugin` — was
// bypassed by the override.
//
// Fix: split `code` into a dispatcher (`ChatCode`) that keeps inline code as
// the pill but renders fenced blocks as a self-contained Widget-card block
// (`ChatCodeFenceBlock`). The block body reuses `CodeBlockContent`, which routes
// tokenization through the exact same `highlightCode()` seam as the rest of the
// app: Shiki Worker on the hot path, main-thread engine as fallback, raw code
// shown immediately so a block is never blank. `pre` becomes a pass-through
// (streamdown's own default) because the card now owns the whole block.

/**
 * Inline-vs-block classification, mirroring streamdown's own heuristic
 * (`node.position.start.line === node.position.end.line` ⇒ inline). A fenced
 * block always spans its opening/closing delimiters, so its position is
 * multi-line; a language class or an embedded newline are robust fallbacks
 * when `node.position` is absent. Exported for the routing regression test.
 */
export function isChatFenceBlock(args: {
  node?: { position?: { start?: { line?: number }; end?: { line?: number } } };
  className?: string;
  text: string;
}): boolean {
  return isMarkdownFenceBlock(args);
}

/**
 * Fenced code block rendered as a Widget-style card. Chrome (rounded-xl muted
 * card, language badge, single copy button) matches the previous ChatPre; the
 * body is `CodeBlockContent`, which highlights through the Shiki Worker seam
 * (with main-thread fallback) and surfaces `data-language` for the block.
 */
function ChatCodeFenceBlock({ code, language }: { code: string; language: string }) {
  const panel = useContext(PanelContext);
  const { t } = useTranslation();
  const previewSource = previewSourceForCodeFence(language, code);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      showToast({ type: "success", message: "已复制" });
    } catch {
      showToast({ type: "error", message: "复制失败" });
    }
  }, [code]);

  return (
    <div
      className="my-4 rounded-xl bg-muted/20 overflow-hidden"
      data-language={language || "text"}
      data-codepilot-chat-code-block=""
    >
      <div className="flex items-center justify-between gap-2 bg-muted/30 px-3 py-1">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
          {language || "code"}
        </span>
        <div className="flex items-center gap-1">
          {panel && previewSource && (
            <button
              type="button"
              onClick={() => panel.setPreviewSource(previewSource)}
              className={cn(cardActionBtn, "h-7 w-7 px-0")}
              aria-label={t('common.preview')}
              title={t('common.preview')}
              data-codepilot-codefence-preview={language}
            >
              <CodePilotIcon name="preview" size="sm" aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className={cn(cardActionBtn, "h-7 w-7 px-0")}
            aria-label="Copy code"
            title="复制代码"
          >
            <CodePilotIcon name="copy" size="sm" aria-hidden />
          </button>
        </div>
      </div>
      <CodeBlockContent code={code} language={(language || "text") as BundledLanguage} />
    </div>
  );
}

// The `code` component override. Inline code stays a muted pill; fenced blocks
// render as the highlighted Widget-card block above (worker-backed).
function ChatCode({ node, className, children, ...props }: MarkdownCodeProps) {
  const text = markdownChildrenToText(children);
  if (!isChatFenceBlock({ node, className, text })) {
    return (
      <MarkdownInlineCode className={className} {...props}>
        {children}
      </MarkdownInlineCode>
    );
  }
  return <ChatCodeFenceBlock code={text} language={markdownFenceLanguage(className)} />;
}

// `pre` is now a pass-through: ChatCode renders the entire fenced-block card,
// so `pre` only needs to hand the block through — matching streamdown's own
// default `pre` (which is likewise a pass-through).
export const CHAT_MARKDOWN_COMPONENTS = {
  ...BASE_MARKDOWN_COMPONENTS,
  table: ChatTable,
  code: ChatCode,
} as const;
