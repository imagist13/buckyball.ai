/**
 * v11 â†?v13 â†?round 7+ right-rail policy + layout history.
 *
 * Round 7+ (2026-05-23) note: ChatContentRow used to derive a
 * `railVisible = fileTreeOpen || ws?.state.open` flag and only paint
 * a `border-t` between the topbar and the work area when a rail was
 * actually visible. The macOS-vibrancy refresh wrapped the whole row
 * in a single rounded card with unconditional top/bottom borders, so
 * `railVisible` is dead and the assertion that used to pin it was
 * removed from this file. The "additive rails" invariants below are
 * still authoritative â€?only the conditional-border test went away.
 *
 * --- Original v11 â†?v13 history below ---
 *
 * v11 â†?v13 right-rail policy reversal.
 *
 * v11 added a `RightRailMutexEnforcer` and pinned both topbar
 * onClick handlers as auto-closing the OTHER panel â€?codifying the
 * idea that FileTreePanel and WorkspaceSidebar should be mutually
 * exclusive ("only one rail at a time so chat keeps breathing
 * room"). The user reviewed v11 and called the direction wrong: the
 * actual product wish is for the two panels to be **additive** â€? * users want to browse files in the FileTree AND keep a markdown /
 * artifact / file-preview Tab pinned on the WorkspaceSidebar at the
 * same time. Forcing one to close on the other's open path was
 * fixing the wrong invariant.
 *
 * v13 reverses:
 *   - `RightRailMutexEnforcer` component: removed entirely.
 *   - Topbar fileTree onClick: drops `if (next && ws.state.open)
 *     ws.setOpen(false)`. Each toggle now just flips its own state.
 *   - Topbar sidebar onClick: drops `if (next && fileTreeOpen)
 *     setFileTreeOpen(false)`. Same pattern.
 *   - The flexbox layout in `ChatContentRow` already supported both
 *     panels stacked on the right (they were rendered as siblings);
 *     only the behavior was wrong.
 *
 * This file kept the original `right-rail-mutex.test.ts` name so git
 * history is traceable, but the asserted invariant is now the
 * opposite: **the two panels can coexist, neither button closes the
 * other, no enforcer effect exists**. A future PR re-introducing
 * mutex would trip these assertions and force a re-read of the
 * v13 product decision.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const APPSHELL = readFileSync(
  path.resolve(__dirname, '../../components/layout/AppShell.tsx'),
  'utf-8',
);
const TOPBAR = readFileSync(
  path.resolve(__dirname, '../../components/layout/UnifiedTopBar.tsx'),
  'utf-8',
);

/**
 * Same comment-stripping helper as other repo-wide grep tests:
 * line comments first, then block comments â€?so a `/*` sequence
 * inside `// â€¦` rationale text is removed before the block-comment
 * pass eats it. The retirement docs left in v13 source name the
 * old API ("RightRailMutexEnforcer", "mutex") on purpose so the
 * rationale survives; without stripping, those mentions would trip
 * the negative assertions below.
 */
function stripComments(src: string): string {
  return src
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const APPSHELL_CODE = stripComments(APPSHELL);
const TOPBAR_CODE = stripComments(TOPBAR);

describe('right-rail panels are additive â€?neither button forces the other to close (v13 reversal of v11)', () => {
  it('the v11 RightRailMutexEnforcer component is gone from AppShell.tsx', () => {
    // The enforcer was the global watcher that closed FileTree on
    // sidebar-open transitions; removing the function declaration
    // (not just the JSX mount) is the durable signal.
    assert.doesNotMatch(
      APPSHELL_CODE,
      /\bfunction\s+RightRailMutexEnforcer\b/,
      'AppShell must not declare a `RightRailMutexEnforcer` function â€?v13 reversed the v11 mutex policy and the enforcer is dead code',
    );
    assert.doesNotMatch(
      APPSHELL_CODE,
      /<RightRailMutexEnforcer\s*\/>/,
      'AppShell must not mount <RightRailMutexEnforcer /> â€?even if a future PR re-defines the function, mounting it would re-introduce the mutex behavior',
    );
  });

  it('the topbar fileTree onClick does NOT close the workspace sidebar', () => {
    // Pre-fix v13 had `if (next && ws?.state.open) ws.setOpen(false)`
    // inside the file-tree onClick. Pin its absence so a future PR
    // can't quietly add it back in the name of "tidying chat width".
    // Note this is more specific than just searching for
    // `ws.setOpen(false)` (which legitimately appears elsewhere, e.g.
    // the sidebar's own close button) â€?anchor on the conditional
    // structure that lived in the file-tree button only.
    assert.doesNotMatch(
      TOPBAR_CODE,
      /if\s*\(\s*next\s*&&\s*ws\?\.state\.open\s*\)\s*ws\.setOpen\(\s*false\s*\)/,
      'UnifiedTopBar fileTree onClick must NOT contain `if (next && ws?.state.open) ws.setOpen(false)` â€?v13 reversal: file tree opens without closing the sidebar',
    );
  });

  it('the topbar sidebar onClick does NOT close the file tree', () => {
    assert.doesNotMatch(
      TOPBAR_CODE,
      /if\s*\(\s*next\s*&&\s*fileTreeOpen\s*\)\s*setFileTreeOpen\(\s*false\s*\)/,
      'UnifiedTopBar sidebar onClick must NOT contain `if (next && fileTreeOpen) setFileTreeOpen(false)` â€?v13 reversal: sidebar opens without closing the file tree',
    );
  });

  it('both topbar buttons still toggle their own panel (the only behavior left after v13 reversal)', () => {
    // Defensive: removing the mutex line shouldn't accidentally drop
    // the toggle itself. Each onClick body must call its own setter
    // (positive contract) â€?fileTree button calls setFileTreeOpen,
    // sidebar button calls ws.setOpen.
    assert.match(
      TOPBAR_CODE,
      /setFileTreeOpen\(\s*!fileTreeOpen\s*\)/,
      'UnifiedTopBar fileTree onClick must still call setFileTreeOpen(!fileTreeOpen) â€?v13 keeps the toggle, only removes the mutex line',
    );
    assert.match(
      TOPBAR_CODE,
      /ws\.setOpen\(\s*!ws\.state\.open\s*\)/,
      'UnifiedTopBar sidebar onClick must still call ws.setOpen(!ws.state.open) â€?v13 keeps the toggle, only removes the mutex line',
    );
  });

  it('the AppShell layout still renders both rails as siblings so they can be open simultaneously', () => {
    // The flexbox layout in ChatContentRow places <WorkspaceSidebar/>
    // and <PanelZone/> as siblings; both can be visible at the same
    // time and the inner <main> shrinks.
    //
    // Phase 7c-C update: WorkspaceSidebar is now nested inside a
    // <CardFrame kind="workspace"> + <CardSurface kind="workspace">
    // pair and guarded by an additional `ws.state.open` check. The
    // sidebar deliberately mounts for the new-chat `/chat` route too,
    // so a first-turn sub-agent card can open Details before navigation
    // settles; PanelZone remains detail-route-only. Both stay siblings
    // in ChatContentRow and can coexist on a detail route.
    assert.match(
      APPSHELL,
      /isChatRoute[\s\S]{0,400}<WorkspaceSidebar\s*\/>/,
      'AppShell must render <WorkspaceSidebar /> under an isChatRoute guard so first-turn Details can open',
    );
    assert.match(
      APPSHELL,
      /isChatDetailRoute\s*&&\s*<PanelZone\s*\/>/,
      'AppShell must render <PanelZone /> under the same guard so it can coexist with the sidebar',
    );
  });

  // Round 7+ (2026-05-23): the previous "rail-visible flag uses `||`"
  // assertion was removed. ChatContentRow no longer derives such a
  // flag â€?the wrapper card ships unconditional top/bottom borders
  // regardless of which rails are open. See the file header for
  // context.
});
