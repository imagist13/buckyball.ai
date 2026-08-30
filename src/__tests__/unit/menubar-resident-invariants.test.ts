/**
 * Source-grep invariants for the menubar-resident lifecycle in
 * `electron/main.ts`. Electron-runtime behavior (Tray, Notification,
 * BrowserWindow.hide) cannot be exercised from a Node unit test, so we
 * lock the structural contract on the source file instead. If a future
 * change accidentally couples the tray to Bridge again, or removes the
 * close-to-hide handler, these tests fail loudly.
 *
 * Manual smoke (Electron required) covers the runtime side:
 *   1. Close main window → tray icon stays, app stays alive
 *   2. Tray "Open CodePilot" → window returns
 *   3. Tray "Quit CodePilot" → process exits
 *   4. With Bridge inactive, fire a 1-min reminder and confirm a native
 *      macOS notification appears while the window is hidden.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MAIN_RAW = readFileSync(
  path.resolve(__dirname, '../../../electron/main.ts'),
  'utf-8',
);

/**
 * Strip TS line and block comments so source-grep assertions only inspect
 * the executed code. Several invariants explicitly call out the old
 * (bridge-coupled) behavior in JSDoc, and we don't want those mentions
 * to trip the "no Bridge in tray" / "no app.quit() in window-all-closed"
 * checks.
 */
function stripComments(src: string): string {
  // Order matters: strip line comments first so embedded `/*` text in
  // `//` prose can't fake a block-comment start (the block regex would
  // then lazy-match past real code into the next `*/`).
  return src
    .replace(/(^|[^:])\/\/.*$/gm, '$1') // // line comments (skip URLs)
    .replace(/\/\*[\s\S]*?\*\//g, '');  // /* … */ block comments
}

const MAIN = stripComments(MAIN_RAW);

describe('electron/main.ts — menubar-resident invariants', () => {
  it('intercepts the main-window close event and hides instead of destroying', () => {
    // The close handler must preventDefault() + hide() unless isQuitting,
    // otherwise close-to-hide is broken and the app quits on close.
    assert.match(MAIN, /mainWindow\.on\(['"]close['"]/);
    assert.match(MAIN, /if\s*\(\s*isQuitting\s*\)\s*return/);
    assert.match(MAIN, /event\.preventDefault\(\)/);
    assert.match(MAIN, /mainWindow\?\.hide\(\)/);
  });

  it('only sets isQuitting=true through quitApp() or before-quit', () => {
    // quitApp() is the only path the tray Quit menu item calls.
    assert.match(MAIN, /function quitApp\(\)/);
    assert.match(MAIN, /isQuitting = true;\s*\n\s*app\.quit\(\)/);
  });

  it('creates the tray on app startup (both dev and prod paths)', () => {
    // ensureTray() must be reachable from app.whenReady — that is the
    // promise that "menubar icon is permanent across the app lifecycle".
    const ensureCount = (MAIN.match(/ensureTray\(\)/g) || []).length;
    assert.ok(
      ensureCount >= 2,
      `expected ensureTray() called at least twice (dev + prod), saw ${ensureCount}`,
    );
  });

  it('tray menu items are localized via getTrayMenuLabels()', () => {
    // The tray menu must build labels from getTrayMenuLabels(locale),
    // not hardcode bridge-related copy.
    assert.match(MAIN, /getTrayMenuLabels/);
    assert.match(MAIN, /labels\.open/);
    assert.match(MAIN, /labels\.quit/);
  });

  it('tray menu and tooltip do not mention Bridge', () => {
    // Phase 3 Step 2: bridge is decoupled from local notifications and
    // tray UI. The tray must not show "Bridge Active" / "Stop Bridge"
    // copy anymore — that was the old bridge-gated behavior.
    const trayBuild = MAIN.match(
      /function rebuildTrayMenu[\s\S]*?function ensureTray/,
    );
    assert.ok(trayBuild, 'rebuildTrayMenu / ensureTray block not found');
    assert.doesNotMatch(trayBuild![0], /Bridge|bridge/);
  });

  it('native notification delivery runs for the app lifetime, independent of visibility and Bridge', () => {
    assert.match(MAIN, /function startNativeDeliveryService/);
    assert.match(MAIN, /startNativeDeliveryService\(\)/);
    assert.doesNotMatch(MAIN, /mainWindow\.on\(['"]hide['"][\s\S]{0,120}Delivery/);
    assert.doesNotMatch(MAIN, /mainWindow\.on\(['"]show['"][\s\S]{0,120}Delivery/);

    const winAllClosed = MAIN.match(
      /app\.on\(['"]window-all-closed['"][\s\S]*?\}\);/,
    );
    assert.ok(winAllClosed, 'window-all-closed handler not found');
    assert.doesNotMatch(winAllClosed![0], /isBridgeActive/);
    assert.doesNotMatch(winAllClosed![0], /startNativeDeliveryService|stopNativeDeliveryService/);
  });

  it('window-all-closed does NOT call app.quit on non-Darwin', () => {
    // The old behavior quit on Linux/Windows when the last window closed.
    // In menubar-resident mode, real shutdown only comes from tray Quit /
    // before-quit. window-all-closed must not call app.quit() anywhere.
    const winAllClosed = MAIN.match(
      /app\.on\(['"]window-all-closed['"][\s\S]*?\}\);/,
    );
    assert.ok(winAllClosed, 'window-all-closed handler not found');
    assert.doesNotMatch(winAllClosed![0], /app\.quit\(\)/);
  });

  it('native delivery service re-reads serverPort each tick instead of caching at start', () => {
    const startBody = MAIN.match(
      /function startNativeDeliveryService[\s\S]*?function stopNativeDeliveryService/,
    );
    assert.ok(startBody, 'startNativeDeliveryService body not found');
    assert.doesNotMatch(startBody![0], /serverPort\s*\|\|\s*3000/);
    assert.match(
      startBody![0],
      /const poll = async \(\) => \{[\s\S]*?const port = serverPort;[\s\S]*?if\s*\(\s*!port\s*\)\s*\{[\s\S]*?return;?[\s\S]*?\}/,
    );
  });

  it('macOS tray single-click does NOT open the window (menu-only convention)', () => {
    // On macOS, tray.setContextMenu() already makes single-click pop the
    // menu. Attaching tray.on('click', showMainWindow) would also yank
    // the main window forward, contradicting the menubar-resident
    // promise. Single-click binding must be guarded by a non-darwin
    // check; double-click is bound on all platforms.
    const ensureBody = MAIN.match(
      /function ensureTray[\s\S]*?\n\}\n/,
    );
    assert.ok(ensureBody, 'ensureTray body not found');
    // The single-click binding must sit inside a non-darwin guard.
    assert.match(
      ensureBody![0],
      /process\.platform\s*!==\s*['"]darwin['"][\s\S]*?tray\.on\(['"]click['"]/,
    );
    // Double-click stays unconditional.
    assert.match(ensureBody![0], /tray\.on\(['"]double-click['"]/);
  });

  it('production startup creates the tray BEFORE awaiting the server', () => {
    // P2 review fix (2026-05-09): if the user closes the loading window
    // mid-boot, hide-on-close keeps mainWindow alive but they need a
    // visible re-entry path. The previous order awaited
    // `startServerOnStablePort()` first and only then called
    // `ensureTray()`, leaving a window where neither the loading screen
    // nor the menubar icon was reachable.
    //
    // Locate the production-path block (the `else` branch following
    // `if (isDev)` that calls `await startServerOnStablePort()`) and
    // assert `ensureTray()` appears AHEAD of the `await`.
    const prodBlock = MAIN.match(
      /} else \{[\s\S]*?await startServerOnStablePort\(\)[\s\S]*?\}/,
    );
    assert.ok(prodBlock, 'production startup else-branch not located');
    const block = prodBlock![0];
    const ensureIdx = block.indexOf('ensureTray()');
    const awaitIdx = block.indexOf('await startServerOnStablePort');
    assert.ok(ensureIdx > 0, 'ensureTray() call not found in production startup branch');
    assert.ok(
      ensureIdx < awaitIdx,
      'ensureTray() must run BEFORE await startServerOnStablePort() in the production startup ' +
        'branch — otherwise a user closing the loading window mid-boot has no menubar entry to ' +
        're-open or quit the app.',
    );
  });

  it('showMainWindow + activate handler do NOT pin to serverPort || 3000', () => {
    // P2 review fix (2026-05-09): the production server binds to a
    // stable range of 47823–47830, never 3000. With the tray now created
    // before the server is ready, a tray "Open" or dock-click in early
    // boot could land in `showMainWindow()` (or `app.on('activate')`)
    // with `serverPort == null`. The old `\`http://127.0.0.1:${serverPort
    // || 3000}\`` fallback would open a window pointing at the wrong
    // port. Both paths must use the `chatWindowUrlForRevival()` helper,
    // which returns `undefined` (→ LOADING_HTML splash) when the port
    // hasn't latched yet.
    //
    // For showMainWindow and the activate handler specifically, this fallback
    // must be gone.
    const showFn = MAIN.match(/function showMainWindow\(\)[\s\S]*?\n\}\n/);
    assert.ok(showFn, 'showMainWindow body not found');
    assert.doesNotMatch(
      showFn![0],
      /serverPort\s*\|\|\s*3000/,
      'showMainWindow must not fall back to port 3000 — production binds 47823–47830',
    );

    const activateBlock = MAIN.match(
      /app\.on\(['"]activate['"][\s\S]*?\}\);/,
    );
    assert.ok(activateBlock, 'activate handler not found');
    assert.doesNotMatch(
      activateBlock![0],
      /serverPort\s*\|\|\s*3000/,
      'app.on("activate") must not fall back to port 3000 — production binds 47823–47830',
    );

    // Positive: both paths must reach the helper instead.
    assert.match(
      MAIN,
      /chatWindowUrlForRevival\(\)/,
      'chatWindowUrlForRevival helper must exist and be used by the destroyed-window revival paths',
    );
  });
});
