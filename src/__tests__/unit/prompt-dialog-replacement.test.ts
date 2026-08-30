/**
 * Regression guard for the replacement of `window.prompt()` with the
 * custom PromptDialog component.
 *
 * Background: window.prompt() is disabled in Electron renderers and throws
 * `TypeError: prompt() is not supported`. The Sentry bucket
 * JAVASCRIPT-NEXTJS-C collected 134 hits from codepilot@0.47.0 before the
 * `ignoreErrors` filter was added in v0.48.0. Even though Sentry no longer
 * surfaces the error on 0.48.x, the two call sites still fail silently for
 * users (menu click does nothing, no toast, no dialog).
 *
 * These are structural tests — we can't render React in node:test, so we
 * verify the source files no longer contain the old prompt() call and do
 * import PromptDialog. Paired with the component-level tests in
 * prompt-dialog.tsx itself (when/if we add them via a smoke harness) this
 * is enough to catch regressions.
 *
 * See docs/exec-plans/active/v0.48-post-release-issues.md §5.6.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promptDialogSelectionRange } from '../../components/ui/prompt-dialog';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8');
}

describe('window.prompt() replacement — regression guard', () => {
  describe('PromptDialog component', () => {
    it('src/components/ui/prompt-dialog.tsx exists and exports PromptDialog', () => {
      const source = readSource('src/components/ui/prompt-dialog.tsx');
      assert.ok(
        source.includes('export function PromptDialog'),
        'should export PromptDialog as a named function',
      );
      assert.ok(
        source.includes('export interface PromptDialogProps'),
        'should export PromptDialogProps interface',
      );
    });

    it('PromptDialog wires onOpenAutoFocus to select the input', () => {
      const source = readSource('src/components/ui/prompt-dialog.tsx');
      assert.ok(
        source.includes('onOpenAutoFocus'),
        'should override Radix Dialog initial focus',
      );
      assert.ok(
        source.match(/input\.select\(\)|inputRef\.current\?\.select\(\)/),
        'should select the input contents on open for instant replace',
      );
    });

    it('PromptDialog handles async onConfirm errors without closing', () => {
      const source = readSource('src/components/ui/prompt-dialog.tsx');
      // Error path must setError and NOT close the dialog. We use negated
      // character classes ([^}]) so the regex matches across newlines
      // without needing the /s flag (unavailable under ES2017 target).
      const errorBlock = source.match(/catch\s*\([^)]*\)\s*\{[^}]*setError[^}]*setSubmitting[^}]*\}/);
      assert.ok(
        errorBlock,
        'should catch onConfirm errors, surface via setError, and keep dialog open',
      );
    });

    it('can preserve the final extension when selecting a default filename', () => {
      assert.deepEqual(promptDialogSelectionRange('untitled.md', true), [0, 8]);
      assert.deepEqual(promptDialogSelectionRange('archive.tar.md', true), [0, 11]);
      assert.deepEqual(promptDialogSelectionRange('.env', true), [0, 4]);
      assert.deepEqual(promptDialogSelectionRange('new-folder', false), [0, 10]);
    });
  });

  describe('SessionListItem rename flow', () => {
    const source = readSource('src/components/layout/SessionListItem.tsx');

    it('does not invoke window.prompt() for rename', () => {
      // Look for the original unsafe call pattern. We're deliberately
      // matching the specific literal ("Rename conversation:") instead of a
      // bare `prompt(` regex, because the file now contains comments that
      // mention the old prompt() call in explanatory text.
      assert.ok(
        !source.includes('prompt("Rename conversation:"'),
        'should not call prompt("Rename conversation:") — replaced by PromptDialog',
      );
      assert.ok(
        !source.match(/=\s*prompt\s*\(/),
        'no remaining `= prompt(` assignment — all prompts should use PromptDialog',
      );
    });

    it('imports and renders PromptDialog', () => {
      assert.ok(
        source.includes('import { PromptDialog }'),
        'should import PromptDialog from @/components/ui/prompt-dialog',
      );
      assert.ok(
        source.includes('<PromptDialog'),
        'should render a PromptDialog element in JSX',
      );
    });

    it('rename menu item sets dialog open state via setRenameOpen', () => {
      assert.ok(
        source.includes('setRenameOpen(true)'),
        'menu item click should open the rename dialog',
      );
      assert.ok(
        source.includes('useState(false)'),
        'should have local open state for the rename dialog',
      );
    });

    it('still calls onRename when the user confirms a new title', () => {
      // Structural check: the onConfirm handler must reference onRename and
      // guard against no-op (same title). Uses negated-class [^}] to match
      // across newlines without /s flag.
      assert.ok(
        source.match(/onConfirm=\{\(value\)\s*=>\s*\{[^}]*onRename\(session\.id,\s*value\)/),
        'onConfirm should call onRename(session.id, value)',
      );
      assert.ok(
        source.match(/value\s*!==\s*session\.title/),
        'should skip onRename when the value is unchanged',
      );
    });
  });

  describe('AssistantWorkspaceSection folder picker fallback', () => {
    const source = readSource('src/components/settings/AssistantWorkspaceSection.tsx');

    it('does not invoke window.prompt() in the fallback branch', () => {
      assert.ok(
        !source.includes('prompt("Enter workspace directory path:")'),
        'should not call prompt("Enter workspace directory path:") — replaced by PromptDialog',
      );
      assert.ok(
        !source.match(/=\s*prompt\s*\(/),
        'no remaining `= prompt(` assignment — all prompts should use PromptDialog',
      );
    });

    it('imports and renders PromptDialog', () => {
      assert.ok(
        source.includes('import { PromptDialog }'),
        'should import PromptDialog',
      );
      assert.ok(
        source.includes('<PromptDialog'),
        'should render PromptDialog for the web fallback path',
      );
    });

    it('still prefers the native Electron dialog when available', () => {
      // Don't regress the primary path — Electron users should continue
      // hitting window.electronAPI.dialog.openFolder.
      assert.ok(
        source.includes('window.electronAPI?.dialog?.openFolder'),
        'should keep the native electronAPI folder dialog as the primary path',
      );
      assert.ok(
        source.includes('setPathPromptOpen(true)'),
        'fallback branch should open the PromptDialog',
      );
    });
  });

  describe('i18n keys for PromptDialog', () => {
    const en = readSource('src/i18n/en.ts');
    const zh = readSource('src/i18n/zh.ts');

    const requiredKeys = [
      'common.confirm',
      'prompt.rename.title',
      'prompt.rename.placeholder',
      'prompt.workspacePath.title',
      'prompt.workspacePath.description',
      'prompt.workspacePath.placeholder',
    ];

    for (const key of requiredKeys) {
      it(`en.ts defines '${key}'`, () => {
        assert.ok(en.includes(`'${key}'`), `en.ts missing key: ${key}`);
      });
      it(`zh.ts defines '${key}'`, () => {
        assert.ok(zh.includes(`'${key}'`), `zh.ts missing key: ${key}`);
      });
    }
  });
});
