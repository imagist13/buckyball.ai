/**
 * Phase 5.2 (2026-06-02) — Windows provider-edit "two close buttons" overlap.
 *
 * ProviderForm renders <DialogContent fullscreen> (fixed inset-0). The
 * fullscreen close button sat at top-5 / right-5 (20px), which on Windows lands
 * inside the system Window Controls Overlay band (electron/main.ts sets
 * titleBarOverlay height 44) — right beside the OS close button ("两个 X 太近").
 *
 * Fix: a --platform-titlebar-safe-area token (0 off Windows, 44px on win32
 * electron) nudges the fullscreen close button below the WCO band. macOS
 * (traffic lights are top-LEFT) and the web shell keep 0 → no change.
 *
 * Source/config pins only; the real Windows top-bar visual is a Phase 7 smoke
 * item (can't be verified off a Windows machine).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const dialogSrc = readFileSync(path.join(root, 'src/components/ui/dialog.tsx'), 'utf8');
const globalsCss = readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');
const mainSrc = readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const providerFormSrc = readFileSync(path.join(root, 'src/components/settings/ProviderForm.tsx'), 'utf8');

describe('Phase 5.2 — fullscreen dialog close button clears the Windows WCO', () => {
  it('the fullscreen close button offsets its top by the titlebar safe-area token', () => {
    assert.match(
      dialogSrc,
      /top-\[calc\(1\.25rem_\+_var\(--platform-titlebar-safe-area\)\)\][\s\S]{0,80}right-5/,
      'fullscreen close button must offset top by --platform-titlebar-safe-area',
    );
  });

  it('the non-fullscreen (centered) close button is unchanged — stays top-4, no token', () => {
    assert.match(dialogSrc, /"top-4 right-4 rounded-xs/);
  });

  it('globals.css defaults the token to 0px (macOS / web unaffected)', () => {
    assert.match(globalsCss, /--platform-titlebar-safe-area:\s*0px/);
  });

  it('globals.css sets 44px ONLY under win32 + electron', () => {
    assert.match(
      globalsCss,
      /html\[data-platform="win32"\]\[data-shell="electron"\]\s*\{[\s\S]*?--platform-titlebar-safe-area:\s*44px/,
      'the 44px safe-area must be scoped to the win32 electron shell',
    );
  });

  it('the 44px safe-area matches the titleBarOverlay height in electron/main.ts', () => {
    const overlay = mainSrc.match(/titleBarOverlay\s*=\s*\{[\s\S]*?height:\s*(\d+)/);
    assert.ok(overlay, 'titleBarOverlay height must be declared in main.ts');
    assert.equal(overlay![1], '44', 'token must stay in sync with the WCO height');
  });

  it('ProviderForm is the fullscreen dialog this fix targets', () => {
    assert.match(providerFormSrc, /<DialogContent fullscreen>/);
  });
});
