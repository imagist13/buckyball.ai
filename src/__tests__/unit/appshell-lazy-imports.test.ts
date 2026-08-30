/**
 * AppShell static-import contract — Phase A memory cut (2026-05-08, refined 2026-05-09).
 *
 * Six components used to be statically imported at the top of AppShell:
 *
 *   • SetupCenter            — onboarding modal, gated by `setupOpen`
 *   • SplitChatContainer     — split-view chat, gated by `isSplitActive`
 *   • WorkspaceSidebar       — right rail, gated by `isChatDetailRoute`
 *   • PanelZone              — file/assistant rail, gated by `isChatDetailRoute`
 *   • UpdateDialog           — update modal, gated by `showDialog && updateAvailable`
 *   • FeatureAnnouncementDialog — one-shot announcement, localStorage gate
 *
 * They are all conditionally rendered, but a static `import` still pulled
 * their full dev compile graphs into the initial /chat boot — first-paint
 * RSS hit ~2.3 GB just from the AppShell chain. Phase A switched the imports
 * to `next/dynamic` with `ssr: false` and added explicit AppShell-level
 * state gates for the two dialogs that previously always-mounted.
 *
 * The static-import check anchors on the *module path*, not the export
 * name: a regression could re-introduce the same module via `import X
 * from "..."` (default), `import * as X from "..."` (namespace), or
 * `import "..."` (side-effect-only) and a name-based regex would miss
 * all three. We block any line that begins with `import` and references
 * the module path in quotes, while leaving `dynamic(() => import(...))`
 * expressions untouched (those don't start a line with the `import`
 * keyword).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const APPSHELL = readFileSync(
  path.resolve(__dirname, '../../components/layout/AppShell.tsx'),
  'utf-8',
);

interface LazyTarget {
  /** Bare component name as it appears in JSX. */
  name: string;
  /** Module path used in the dynamic loader. The static-import check
   *  anchors on this, so it stays comprehensive against named / default
   *  / namespace / side-effect import forms. */
  modulePath: string;
}

const LAZY_TARGETS: LazyTarget[] = [
  { name: 'SetupCenter', modulePath: '@/components/setup/SetupCenter' },
  { name: 'SplitChatContainer', modulePath: './SplitChatContainer' },
  { name: 'WorkspaceSidebar', modulePath: './WorkspaceSidebar' },
  { name: 'PanelZone', modulePath: './PanelZone' },
  { name: 'UpdateDialog', modulePath: './UpdateDialog' },
  { name: 'FeatureAnnouncementDialog', modulePath: './FeatureAnnouncementDialog' },
];

function escapeRegex(s: string): string {
  return s.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Find every static `import` statement that references the given module
 * path. Catches all four canonical forms:
 *
 *   import { X } from "modulePath";          // named
 *   import X from "modulePath";              // default
 *   import * as X from "modulePath";         // namespace
 *   import "modulePath";                     // side-effect
 *
 * Strategy: enumerate every top-level static import statement first
 * (`^[ \t]*import\b[^;]*;` bounds each one at its terminating
 * semicolon, so multi-line imports stay in a single match and we never
 * span across two adjacent imports), then test each statement for the
 * quoted module path. This is robust against a lazy `[\s\S]*?` running
 * past one import into the next when the FIRST import does not contain
 * the target path.
 *
 * `dynamic(() => import("modulePath").then(...))` is NOT matched —
 * those expressions never start a line with the bare `import` keyword
 * (the line begins with `() =>` or `const X = dynamic(`).
 */
function findStaticImports(src: string, modulePath: string): { line: number; text: string }[] {
  // Each match is one full import statement. `[^;]*` stays inside the
  // statement because static imports always terminate with `;` in this
  // codebase (style enforced by lint).
  const stmtRe = /^[ \t]*import\b[^;]*;/gm;
  const out: { line: number; text: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = stmtRe.exec(src)) !== null) {
    const stmt = m[0];
    if (stmt.includes(`"${modulePath}"`) || stmt.includes(`'${modulePath}'`)) {
      const before = src.slice(0, m.index);
      const line = before.split('\n').length;
      out.push({ line, text: stmt.trim().replace(/\s+/g, ' ').slice(0, 120) });
    }
  }
  return out;
}

describe('AppShell static-import contract — Phase A memory guardrail', () => {
  it('next/dynamic is imported (the lazy mechanism is wired)', () => {
    assert.match(APPSHELL, /import\s+dynamic\s+from\s+["']next\/dynamic["']/);
  });

  it('every lazy target is loaded via next/dynamic, not ANY static import form', () => {
    for (const target of LAZY_TARGETS) {
      // Path-based lookup: catches `import { X }`, `import X`,
      // `import * as X`, and `import "path"`. The point of Phase A is
      // that AppShell's compile graph never reaches these modules on
      // boot — re-introducing any static import form regresses memory.
      const offenders = findStaticImports(APPSHELL, target.modulePath);
      assert.equal(
        offenders.length,
        0,
        `${target.name} (${target.modulePath}) is statically imported in AppShell — ` +
          `convert to next/dynamic to keep its compile graph off the boot path. ` +
          `Offenders:\n${offenders.map((o) => `  AppShell.tsx:${o.line} → ${o.text}`).join('\n')}`,
      );

      // Positive assertion: the dynamic loader expression itself must
      // exist and reach the same module path.
      const dynamicLoader = new RegExp(
        `dynamic\\([\\s\\S]*?import\\(\\s*["']${escapeRegex(target.modulePath)}["']\\s*\\)`,
      );
      assert.match(
        APPSHELL,
        dynamicLoader,
        `${target.name} is missing its dynamic() loader — every Phase A target ` +
          `must be wrapped in next/dynamic with ssr:false`,
      );
    }
  });

  it('every Phase A lazy target uses ssr:false', () => {
    // These six are client-only renderers (modals, conditional rails,
    // browser-state gated dialogs). Setting ssr:true would defeat the
    // boot-path cut because Next would still need to resolve them
    // server-side on every request.
    //
    // Anchor on the `m.<Name>` selector and look ahead for ssr:false
    // within the next ~250 chars — far enough to cover the canonical
    // shape `dynamic(() => import(...).then((m) => ({ default: m.X })),
    // { ssr: false })` without false-positively matching a sibling
    // dynamic loader.
    for (const target of LAZY_TARGETS) {
      const re = new RegExp(`m\\.${target.name}[\\s\\S]{0,250}?ssr:\\s*false`);
      assert.match(
        APPSHELL,
        re,
        `${target.name} must use ssr:false in its dynamic() options — it is ` +
          `a client-only conditional renderer; ssr:true would resolve the ` +
          `chunk server-side on every request and defeat the boot-path cut`,
      );
    }
  });

  it('UpdateDialog is mounted only when the modal should actually be open', () => {
    // Phase A originally gated on `updateAvailable` only — but the user
    // can dismiss the modal (Later button → showDialog=false) without
    // changing updateAvailable, so the chunk stayed mounted for the rest
    // of the session. The tightened gate (P3 review) requires BOTH:
    // showDialog (the user hasn't dismissed) AND updateAvailable.
    // UpdateBanner remains the always-on lightweight reminder.
    assert.match(
      APPSHELL,
      /updateContextValue\.showDialog[\s\S]{0,100}?updateContextValue\.updateInfo\?\.updateAvailable[\s\S]{0,40}?<UpdateDialog\s*\/>/,
      'UpdateDialog must be guarded by BOTH updateContextValue.showDialog AND ' +
        'updateContextValue.updateInfo?.updateAvailable. A bare updateAvailable ' +
        'gate keeps the chunk live after dismiss.',
    );
  });

  it('FeatureAnnouncementDialog is mounted only when its dismiss flag is missing', () => {
    // The dialog used to always render and decide internally whether to
    // open. Phase A reads the localStorage dismiss key in AppShell first
    // and only mounts the dialog when the user hasn't dismissed it yet.
    assert.match(
      APPSHELL,
      /announcementMaybeVisible\s*&&\s*<FeatureAnnouncementDialog\s*\/>/,
      'FeatureAnnouncementDialog must be guarded by the announcementMaybeVisible state',
    );
    // The state gate must read the same localStorage key the dialog uses
    // to persist its dismissal (extracted to feature-announcement-key.ts
    // so the gate doesn't have to import the dialog itself).
    assert.match(
      APPSHELL,
      /from\s+["']\.\/feature-announcement-key["']/,
      'AppShell must import ANNOUNCEMENT_KEY from the shared module ' +
        '(not from FeatureAnnouncementDialog, which would defeat the lazy load)',
    );
  });
});
