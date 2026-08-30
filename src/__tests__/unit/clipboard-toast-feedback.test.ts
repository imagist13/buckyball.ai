/**
 * v11 fix — Copy buttons must give the user feedback AND must catch
 * clipboard rejections.
 *
 * Pre-fix had three fire-and-forget call sites:
 *   - `UnifiedTopBar.handleCopyId` (top-bar dropdown "Copy ID")
 *   - `SessionListItem` dropdown menu item "复制对话 ID"
 *   - `ProjectGroupHeader` dropdown menu item "Copy folder path"
 * All three did `navigator.clipboard.writeText(value)` and dropped the
 * promise. In Electron renderers `writeText` rejects with
 * `NotAllowedError` whenever the document isn't focused — which is the
 * COMMON case after a DropdownMenu click, because Radix transfers
 * focus to the menu item. The unhandled promise rejection became a
 * console error and a Sentry report; the user got no toast either way
 * and didn't know whether the copy succeeded.
 *
 * Post-fix: a single helper `lib/clipboard.ts:copyWithToast` wraps
 * await + try/catch and surfaces a one-line toast (success or warning
 * with the raw text inline so the user can manually copy from the
 * toast). All three call sites use it.
 *
 * This file is a source-grep contract — pure Node test, no React
 * Testing Library — so the runtime behaviour (await + catch + toast)
 * is pinned at the structural level.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Strip line comments + block comments before grep-ing for "no
 * navigator.clipboard.writeText left". The fix-explainer comments
 * intentionally name the old API so future readers understand the
 * rationale; without stripping, the assertion would match its own
 * documentation and fail. Strip line comments FIRST so any `/*`
 * sequence inside `// ...` text is removed before the block-comment
 * pass gets to it (same gotcha as the other repo-wide grep tests).
 */
function stripComments(src: string): string {
  return src
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const HELPER = readFileSync(
  path.resolve(__dirname, '../../lib/clipboard.ts'),
  'utf-8',
);
const TOPBAR = stripComments(
  readFileSync(
    path.resolve(__dirname, '../../components/layout/UnifiedTopBar.tsx'),
    'utf-8',
  ),
);
const SESSION_ITEM = stripComments(
  readFileSync(
    path.resolve(__dirname, '../../components/layout/SessionListItem.tsx'),
    'utf-8',
  ),
);
const PROJECT_HEADER = stripComments(
  readFileSync(
    path.resolve(__dirname, '../../components/layout/ProjectGroupHeader.tsx'),
    'utf-8',
  ),
);

const ZH = readFileSync(
  path.resolve(__dirname, '../../i18n/zh.ts'),
  'utf-8',
);
const EN = readFileSync(
  path.resolve(__dirname, '../../i18n/en.ts'),
  'utf-8',
);

describe('lib/clipboard.ts copyWithToast helper', () => {
  it('exports copyWithToast', () => {
    assert.match(
      HELPER,
      /export\s+async\s+function\s+copyWithToast\s*\(/,
      'lib/clipboard.ts must export an async copyWithToast function — the single entry point all "Copy …" sites route through',
    );
  });

  it('awaits navigator.clipboard.writeText INSIDE a try/catch', () => {
    // Brace-balanced extraction of the function body and assert: there
    // is at least one `try {` block, the `await navigator.clipboard
    // .writeText(...)` lives inside it, and there is a `catch` clause
    // immediately after.
    const fnBody = HELPER.match(
      /export\s+async\s+function\s+copyWithToast[\s\S]*?\{([\s\S]*)\n\}\n*$/,
    );
    assert.ok(fnBody, 'could not locate copyWithToast function body');
    const body = fnBody![1];
    assert.match(
      body,
      /try\s*\{[\s\S]*?await\s+navigator\.clipboard\.writeText\([\s\S]*?\}\s*catch/,
      'copyWithToast must `await navigator.clipboard.writeText(...)` inside a try block followed by a catch — the original bug was fire-and-forget without await',
    );
  });

  it('shows a toast in BOTH the success and failure branches', () => {
    // The helper must call showToast on success (so user knows the
    // copy worked) AND on failure (so user can see what to copy
    // manually). Pre-fix had neither branch — the failure path was an
    // unhandled rejection.
    const showToastCount = (HELPER.match(/showToast\(/g) ?? []).length;
    assert.ok(
      showToastCount >= 2,
      `copyWithToast must call showToast at least twice (success branch + failure branch); found ${showToastCount} calls. Without both branches the user has no feedback either way.`,
    );
    // Success branch must use the success type.
    assert.match(
      HELPER,
      /showToast\(\s*\{\s*type:\s*['"]success['"]/,
      'success branch must use type: "success"',
    );
    // Failure branch must use warning (not error — the value is
    // shown inline, so the user can recover by hand).
    assert.match(
      HELPER,
      /showToast\(\s*\{\s*type:\s*['"]warning['"]/,
      'failure branch must use type: "warning" (the helper surfaces the raw text so user can copy manually — not a fatal error)',
    );
  });
});

describe('the three copy-id / copy-path entries route through copyWithToast (no fire-and-forget left)', () => {
  it('UnifiedTopBar.handleCopyId imports + uses copyWithToast and no longer calls writeText directly', () => {
    assert.match(
      TOPBAR,
      /import[^;]*\bcopyWithToast\b[^;]*from\s+['"]@\/lib\/clipboard['"]/,
      'UnifiedTopBar.tsx must import copyWithToast from @/lib/clipboard',
    );
    assert.match(
      TOPBAR,
      /copyWithToast\s*\(/,
      'UnifiedTopBar.tsx must call copyWithToast — handleCopyId is the only copy entry in this file',
    );
    assert.doesNotMatch(
      TOPBAR,
      /navigator\.clipboard\.writeText\s*\(/,
      'UnifiedTopBar.tsx must NOT use navigator.clipboard.writeText directly — go through copyWithToast (which handles the rejection)',
    );
  });

  it('SessionListItem dropdown "Copy ID" entry routes through copyWithToast', () => {
    assert.match(
      SESSION_ITEM,
      /import[^;]*\bcopyWithToast\b[^;]*from\s+['"]@\/lib\/clipboard['"]/,
      'SessionListItem.tsx must import copyWithToast',
    );
    assert.match(
      SESSION_ITEM,
      /copyWithToast\s*\(/,
      'SessionListItem.tsx must call copyWithToast on the "Copy session ID" dropdown item',
    );
    assert.doesNotMatch(
      SESSION_ITEM,
      /navigator\.clipboard\.writeText\s*\(/,
      'SessionListItem.tsx must NOT use navigator.clipboard.writeText directly',
    );
  });

  it('ProjectGroupHeader dropdown "Copy folder path" entry routes through copyWithToast', () => {
    assert.match(
      PROJECT_HEADER,
      /import[^;]*\bcopyWithToast\b[^;]*from\s+['"]@\/lib\/clipboard['"]/,
      'ProjectGroupHeader.tsx must import copyWithToast',
    );
    assert.match(
      PROJECT_HEADER,
      /copyWithToast\s*\(/,
      'ProjectGroupHeader.tsx must call copyWithToast on the "Copy folder path" dropdown item',
    );
    assert.doesNotMatch(
      PROJECT_HEADER,
      /navigator\.clipboard\.writeText\s*\(/,
      'ProjectGroupHeader.tsx must NOT use navigator.clipboard.writeText directly',
    );
  });
});

describe('i18n bundles define common.copySuccess + common.copyFailed', () => {
  it('zh.ts defines both keys', () => {
    assert.match(
      ZH,
      /'common\.copySuccess':\s*'/,
      'zh.ts must define common.copySuccess (success toast message)',
    );
    assert.match(
      ZH,
      /'common\.copyFailed':\s*'/,
      'zh.ts must define common.copyFailed (warning toast message; user-visible text is appended at runtime so they can grab the value by hand)',
    );
  });

  it('en.ts defines both keys', () => {
    assert.match(
      EN,
      /'common\.copySuccess':\s*'/,
      'en.ts must define common.copySuccess',
    );
    assert.match(
      EN,
      /'common\.copyFailed':\s*'/,
      'en.ts must define common.copyFailed',
    );
  });
});
