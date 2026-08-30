/**
 * Phase 4 P1 (Codex review) — guardrail for the PreviewPanel load
 * effect's `finally` block.
 *
 * Background: `setLoading(false)` was previously gated on
 * `isFilePathChange`. In React StrictMode dev the load effect runs
 * twice; the first pass writes `prevFilePathRef.current = filePath`
 * synchronously, so by the time the second pass's `finally` runs
 * the closure has `isFilePathChange = false` and the conditional
 * skips clearing loading — leaving the panel pinned to its spinner
 * forever even though the data arrived.
 *
 * This test pins the contract that the load effect's finally must
 * clear `loading` whenever the fetch resolves (un-cancelled),
 * irrespective of file-path-change state. A future refactor that
 * re-introduces the gate would fail this check and re-surface the
 * stuck-spinner regression.
 *
 * Approach: read PreviewPanel.tsx, isolate the `loadPreview` finally
 * block textually, and assert two facts:
 *   1. The block calls `setLoading(false)`.
 *   2. The block does NOT mention `isFilePathChange` at all.
 *
 * String-grep against source is the same technique we use for
 * heartbeat-copy-honesty and other UX-contract guardrails — robust
 * against refactors as long as the call site is recognizable.
 *
 * Run: npx tsx --test src/__tests__/unit/preview-panel-finally-contract.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PREVIEW_PANEL_SRC = readFileSync(
  path.resolve(__dirname, '../../components/layout/panels/PreviewPanel.tsx'),
  'utf-8',
);

/**
 * Pull out the `} finally {` block that lives inside the
 * `loadPreview` function. We anchor on the surrounding context
 * rather than a single line so a comment refactor or whitespace
 * change doesn't accidentally pass the test.
 *
 * The block we're after is the one immediately preceded by the
 * catch handler that calls `setError(...)`. We grab everything from
 * `} finally {` up to the matching closing brace.
 */
function extractLoadPreviewFinally(): string {
  // Find the finally that follows the load effect's catch block.
  // The catch sets `setError(... t('filePreview.failedToLoad') ...)`
  // so we anchor on that string + the next finally.
  const catchAnchor = PREVIEW_PANEL_SRC.indexOf("t('filePreview.failedToLoad')");
  if (catchAnchor < 0) {
    throw new Error('could not locate the load effect catch anchor');
  }
  const finallyStart = PREVIEW_PANEL_SRC.indexOf('} finally {', catchAnchor);
  if (finallyStart < 0) {
    throw new Error('could not locate `} finally {` after the catch');
  }
  // Walk forward counting braces from the `{` after `finally`.
  let i = finallyStart + '} finally '.length;
  if (PREVIEW_PANEL_SRC[i] !== '{') {
    throw new Error('finally block does not open with `{`');
  }
  let depth = 0;
  let end = -1;
  for (; i < PREVIEW_PANEL_SRC.length; i++) {
    const ch = PREVIEW_PANEL_SRC[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error('finally block never closed');
  return PREVIEW_PANEL_SRC.slice(finallyStart, end);
}

/**
 * Strip line and block comments so the "no isFilePathChange" assertion
 * doesn't trip on prose that explains the past regression. We only
 * want to gate on real code references.
 */
function stripComments(src: string): string {
  // Block comments first — non-greedy.
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Then line comments.
  out = out
    .split(/\r?\n/)
    .map((line) => {
      const idx = line.indexOf('//');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
  return out;
}

describe('PreviewPanel load-effect finally — Phase 4 P1 contract', () => {
  it('clears `loading` unconditionally after fetch resolves', () => {
    const block = stripComments(extractLoadPreviewFinally());
    assert.match(
      block,
      /setLoading\(\s*false\s*\)/,
      'load effect finally MUST call setLoading(false). Removing this regression-tests the stuck-spinner bug where StrictMode\'s double-effect cycle skipped the clear.',
    );
  });

  it('does NOT gate setLoading(false) on isFilePathChange', () => {
    const block = stripComments(extractLoadPreviewFinally());
    assert.doesNotMatch(
      block,
      /isFilePathChange/,
      [
        'load effect finally MUST NOT reference isFilePathChange.',
        '',
        'Why: in React StrictMode dev mode the load effect runs twice.',
        '  - Run 1 writes prevFilePathRef.current = filePath',
        '  - Run 2 sees prevFilePathRef.current === filePath → isFilePathChange = false',
        'If the finally is gated on isFilePathChange, the second run never',
        'clears loading, and the panel sits on its spinner forever even',
        'after the fetch resolves. Codex P1 review caught exactly this.',
        '',
        'For warm-refresh paths setLoading(false) is a harmless no-op',
        '(loading was never set true), so unconditional clearing is safe.',
      ].join('\n'),
    );
  });

  it('still gates on `!cancelled` so a stale fetch from a switched-away file does not blank loading', () => {
    const block = stripComments(extractLoadPreviewFinally());
    // Required: the cancellation guard stays. We don't want a
    // stale fetch from a file the user just navigated away from
    // to fire setLoading(false) and visually unstick a spinner the
    // NEW file's effect just put up.
    assert.match(
      block,
      /!cancelled/,
      'load effect finally MUST keep the !cancelled guard so stale fetches do not stomp the next file\'s loading state.',
    );
  });
});
