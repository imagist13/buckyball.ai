/**
 * Conversation title — the single source of truth for turning user-visible
 * text into a session title.
 *
 * Before this module there were three independent "first message, sliced to
 * 50" implementations that disagreed with each other:
 *   - `src/app/chat/page.tsx`            — `content.slice(0, 50)`, NO ellipsis
 *   - `src/app/api/chat/route.ts`        — `slice(0, 50) + '...'`
 *   - `src/app/api/claude-sessions/import/route.ts` — `slice(0, 50) + '...'`
 * All three sliced by UTF-16 code unit, so a CJK/emoji boundary could be cut
 * mid-grapheme (a family emoji became a lone ZWJ tail), and all three fed on
 * raw `content` — the text sent to the MODEL, which may carry hidden
 * expansion blocks the user never typed. Every entry point now routes here.
 *
 * PRIVACY: callers MUST pass user-visible text (`displayOverride || content`).
 * `displayOverride` is the composer's bubble text and, per
 * `message-input-logic.ts`, NEVER contains `[Referenced Directories]`. The
 * stripping below is defense-in-depth for callers that only hold `content`
 * (e.g. imported transcripts), not the primary guarantee.
 */

export type TitleOrigin =
  /** Session created, no real user message yet — the only origin a fallback may overwrite. */
  | 'placeholder'
  /** Deterministic truncation of the first real user message. */
  | 'fallback'
  /** Model-written semantic title (Phase 2). Only ever replaces `fallback`. */
  | 'generated'
  /** User typed it. Never overwritten by anything asynchronous. */
  | 'manual'
  /** Bridge / task / heartbeat / worktree sessions name themselves. */
  | 'system'
  /** Derived at import time from a foreign transcript. */
  | 'import';

export const TITLE_ORIGINS: readonly TitleOrigin[] = [
  'placeholder',
  'fallback',
  'generated',
  'manual',
  'system',
  'import',
];

export function isTitleOrigin(value: unknown): value is TitleOrigin {
  return typeof value === 'string' && (TITLE_ORIGINS as readonly string[]).includes(value);
}

/** Title budget, counted in graphemes (not UTF-16 code units) — ellipsis included. */
export const MAX_TITLE_GRAPHEMES = 50;

/** The one ellipsis. A single grapheme, so it costs exactly one of the 50. */
export const TITLE_ELLIPSIS = '…';

/** DB default for a session that has no real title yet. Not user-facing copy —
 *  the UI renders `t('chat.newConversation')` when it sees this. */
export const PLACEHOLDER_TITLE = 'New Chat';

/** Guard against segmenting a pasted megabyte: no title can survive past this.
 *  Applied AFTER metadata stripping — see `stripHiddenMetadata`. */
const RAW_INPUT_CAP = 4096;

/**
 * Strip metadata the user never typed:
 *  - `<!--files:[...]-->` attachment manifests (paths, mime types, base64)
 *  - the `[Referenced Directories]` / `[Mention Limits]` blocks appended by
 *    `buildMentionAppend` — anchored to that helper's exact `\n\n[Section]\n`
 *    shape so ordinary prose mentioning the words is untouched.
 *
 * Runs on the FULL input, before any length cap: a base64 attachment manifest
 * routinely runs past a cap, and capping first would cut off the closing
 * `-->` and leave the opener — paths and payload — looking like prose.
 *
 * An opener with no closer is fail-closed: everything from `<!--files:` on is
 * dropped rather than kept, so a truncated or malformed manifest can never
 * reach the title.
 */
function stripHiddenMetadata(raw: string): string {
  let text = raw.replace(/<!--files:[\s\S]*?-->/g, '');
  const dangling = text.indexOf('<!--files:');
  if (dangling !== -1) text = text.slice(0, dangling);
  const expansion = text.search(/\n\n\[(?:Referenced Directories|Mention Limits)\]\n/);
  return expansion === -1 ? text : text.slice(0, expansion);
}

/**
 * Collapse to one clean line.
 *
 * `\p{Cc}` (C0/C1 controls — newlines, tabs, ANSI escape introducers) becomes
 * a space rather than being deleted, so `"foo\nbar"` reads as `"foo bar"` and
 * not `"foobar"`. Runs of whitespace then collapse and the ends are trimmed.
 *
 * Deliberately NOT stripped: `\p{Cf}` (format characters). ZWJ lives in that
 * category, and removing it would explode a family emoji into three separate
 * people — the exact grapheme damage this module exists to prevent. The
 * `\s+` collapse already absorbs the zero-width space and BOM.
 */
function toSingleLine(raw: string): string {
  return raw
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Grapheme split — keeps emoji ZWJ sequences and combining marks intact. */
function toGraphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text), (s) => s.segment);
  }
  // Code-point fallback (still never splits a surrogate pair).
  return Array.from(text);
}

/** Grapheme length — exported so validation and tests agree on "how long". */
export function titleLength(text: string): number {
  return toGraphemes(text).length;
}

/**
 * Derive a title from user-visible text.
 *
 * Returns `''` when nothing usable survives cleaning (empty / whitespace /
 * control-characters-only / attachment-manifest-only). Callers decide what
 * that means — the chat route keeps the placeholder, import falls back to the
 * project name — because "" is not a title and this function will not invent
 * one.
 */
export function deriveConversationTitle(input: string | null | undefined): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  const cleaned = toSingleLine(stripHiddenMetadata(input).slice(0, RAW_INPUT_CAP));
  if (!cleaned) return '';

  const graphemes = toGraphemes(cleaned);
  if (graphemes.length <= MAX_TITLE_GRAPHEMES) return cleaned;

  const kept = graphemes.slice(0, MAX_TITLE_GRAPHEMES - 1).join('').trimEnd();
  return kept + TITLE_ELLIPSIS;
}

export type ManualTitleResult =
  | { ok: true; title: string }
  | { ok: false; error: string };

/**
 * Validate + canonicalize a user-supplied rename (PATCH /api/chat/sessions/[id]).
 *
 * Rejects what isn't a title at all (non-string, empty, whitespace-only,
 * control-characters-only). Over-long input is CLAMPED rather than rejected,
 * so a manual rename lands on exactly the same 50-grapheme canonical form as
 * every other entry point — one rule, one shape, no "why did the sidebar cut
 * it but the dialog refuse it" split.
 */
export function sanitizeManualTitle(raw: unknown): ManualTitleResult {
  if (typeof raw !== 'string') {
    return { ok: false, error: 'title must be a string' };
  }
  const title = deriveConversationTitle(raw);
  if (!title) {
    return { ok: false, error: 'title must not be empty' };
  }
  return { ok: true, title };
}
