/**
 * Source-pin guardrails for two Loop-1 Electron security fixes (audit 2026-07).
 *
 * These invariants can't be exercised behaviorally in a node:test unit run
 * (Electron isn't loadable here), so — like `instrumentation-shape.test.ts`
 * and `sentry-dev-guard.test.ts` — we assert them against the source text,
 * stripping comments first so the explanatory comments (which necessarily
 * mention `outPath` / `http/https`) don't defeat the checks.
 *
 *  1.1  `artifact:export-long-shot` must never write to a renderer-supplied
 *       path. A compromised renderer could otherwise overwrite any file with
 *       PNG bytes. `outPath` is gone from the handler + preload; the handler
 *       only returns base64.
 *  1.7  The main window's `will-navigate` handler must whitelist http/https
 *       before `shell.openExternal`, mirroring `setWindowOpenHandler`, and
 *       guard URL parsing with try/catch.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  deriveHtmlThumbnailRequestScope,
  HtmlThumbnailCaptureTimeoutError,
  isHtmlThumbnailRequestAllowed,
  SerializedDeadlineQueue,
} from '../../../electron/html-thumbnail-security';

const MAIN = path.resolve(__dirname, '../../../electron/main.ts');
const PRELOAD = path.resolve(__dirname, '../../../electron/preload.ts');
const OPEN_ROUTE = path.resolve(__dirname, '../../app/api/files/open/route.ts');

/** Strip line + block comments (same approach as sentry-dev-guard.test.ts). */
function stripComments(src: string): string {
  return src
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/** From the first `{` at/after `fromIndex`, return the brace-balanced block. */
function balancedBlock(src: string, fromIndex: number): string {
  const open = src.indexOf('{', fromIndex);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

describe('electron main security guardrails (audit 2026-07 Loop 1)', () => {
  const rawMain = readFileSync(MAIN, 'utf-8');
  const main = stripComments(rawMain);
  const preload = stripComments(readFileSync(PRELOAD, 'utf-8'));
  const openRoute = stripComments(readFileSync(OPEN_ROUTE, 'utf-8'));

  it('1.1 — artifact export never accepts or writes a renderer-supplied outPath', () => {
    assert.doesNotMatch(
      main,
      /outPath/,
      'electron/main.ts must not reference outPath (removed for finding 1.1)',
    );
    assert.doesNotMatch(
      preload,
      /outPath/,
      'electron/preload.ts must not expose outPath on artifact.exportLongShot',
    );
    assert.doesNotMatch(
      main,
      /writeFile\(\s*outPath/,
      'the artifact handler must not fs.writeFile a renderer path',
    );
  });

  it('1.7 — mainWindow will-navigate delegates to classifyNavigation and only opens on the open-external decision', () => {
    const idx = main.indexOf("mainWindow.webContents.on('will-navigate'");
    assert.ok(idx >= 0, 'mainWindow will-navigate handler must exist');
    const body = balancedBlock(main, idx);

    // The http/https policy lives in the pure helper (behavior-tested in
    // navigation-policy.test.ts). The handler must route through it and must
    // NOT do an origin-only same-origin allow inline (that was the Codex
    // blocker: data: opaque origins bypassing the whitelist).
    assert.match(body, /classifyNavigation/, 'will-navigate must use the classifyNavigation policy helper');
    assert.match(body, /openExternal/, 'sanity: handler still opens external links');
    assert.match(
      body,
      /decision\s*===\s*['"]open-external['"]/,
      'openExternal must be gated on the open-external decision',
    );

    // The open-external gate must PRECEDE openExternal — it cannot be called
    // unconditionally on any path.
    const gateIdx = body.search(/decision\s*===\s*['"]open-external['"]/);
    const openIdx = body.indexOf('openExternal');
    assert.ok(
      gateIdx >= 0 && gateIdx < openIdx,
      'the open-external decision check must precede shell.openExternal',
    );
  });

  it('the embedded browser is partition-gated and hardened again at attachment time', () => {
    assert.match(main, /webviewTag:\s*true/);
    assert.match(main, /sandbox:\s*true/);
    const attachIndex = main.indexOf("mainWindow.webContents.on('will-attach-webview'");
    assert.ok(attachIndex >= 0, 'main window must guard every guest attachment');
    const attachBody = balancedBlock(main, attachIndex);
    assert.match(attachBody, /issuedBrowserPartitions\.has\(partition\)/);
    assert.match(attachBody, /isAllowedBrowserGuestUrl\(params\.src\)/);
    assert.match(attachBody, /delete webPreferences\.preload/);
    assert.match(attachBody, /webPreferences\.sandbox\s*=\s*true/);
    assert.match(attachBody, /webPreferences\.contextIsolation\s*=\s*true/);
    assert.match(attachBody, /webPreferences\.nodeIntegration\s*=\s*false/);
    assert.match(attachBody, /webPreferences\.nodeIntegrationInSubFrames\s*=\s*false/);
    assert.match(attachBody, /webPreferences\.nodeIntegrationInWorker\s*=\s*false/);
    assert.match(attachBody, /webPreferences\.webviewTag\s*=\s*false/);
    assert.match(attachBody, /webPreferences\.webSecurity\s*=\s*true/);

    const configIndex = main.indexOf("ipcMain.handle('browser:get-config'");
    assert.ok(configIndex >= 0, 'browser config IPC must exist');
    const configBody = balancedBlock(main, configIndex);
    assert.match(configBody, /isTrustedMainWindowSender\(event\)/);
    assert.match(configBody, /isCanonicalBrowserWorkspaceId\(workspaceId\)/);
    assert.match(main, /setPermissionRequestHandler\([^]*callback\(false\)/);
    assert.match(main, /setPermissionCheckHandler\(\(\)\s*=>\s*false\)/);
    assert.match(preload, /browser:get-config/);
    const preloadBrowserIndex = preload.indexOf('browser: {');
    assert.ok(preloadBrowserIndex >= 0, 'browser preload namespace must exist');
    const preloadBrowserBody = balancedBlock(preload, preloadBrowserIndex);
    assert.doesNotMatch(preloadBrowserBody, /executeJavaScript|debugger|sendCommand/);
  });

  it('local paths expose no generic openPath bridge and directories are reveal-only', () => {
    assert.doesNotMatch(main, /ipcMain\.handle\(['"]shell:open-path['"]/);
    assert.doesNotMatch(preload, /openPath\s*:/);

    const revealIndex = main.indexOf("ipcMain.handle('shell:reveal-path'");
    assert.ok(revealIndex >= 0, 'the scoped reveal handler must exist');
    const revealBody = balancedBlock(main, revealIndex);
    assert.match(revealBody, /resolveScopedSystemPath/);
    assert.match(revealBody, /showItemInFolder/);
    assert.doesNotMatch(revealBody, /openPath/);

    const htmlIndex = main.indexOf("ipcMain.handle('shell:open-html-file'");
    assert.ok(htmlIndex >= 0, 'the HTML-only open handler must exist');
    const htmlBody = balancedBlock(main, htmlIndex);
    assert.match(htmlBody, /resolveScopedSystemPath/);
    assert.match(htmlBody, /openPath/);
    assert.match(preload, /shell:reveal-path/);
    assert.match(preload, /shell:open-html-file/);
  });

  it('the non-Electron reveal fallback uses fixed argv with the shell disabled', () => {
    assert.doesNotMatch(openRoute, /\bexec\s*\(/);
    assert.match(openRoute, /spawn\(command, args/);
    assert.match(openRoute, /shell:\s*false/);
    assert.match(openRoute, /buildFileManagerRevealCommand/);
    assert.match(openRoute, /getSession\(body\.sessionId\)/);
  });

  it('Asset HTML capture is origin-bound, scope-bound, and returns bytes without a path write', () => {
    const idx = rawMain.indexOf("ipcMain.handle('asset:capture-html-thumbnail'");
    assert.ok(idx >= 0, 'the static HTML thumbnail capture handler must exist');
    const callbackStart = rawMain.indexOf(') => {', idx);
    const body = balancedBlock(rawMain, callbackStart);
    assert.match(body, /senderUrl\.hostname\s*!==\s*['"]127\.0\.0\.1['"]/);
    assert.match(body, /targetUrl\.origin\s*!==\s*senderUrl\.origin/);
    assert.match(
      body,
      /deriveHtmlThumbnailRequestScope\(targetUrl\)/,
    );
    assert.doesNotMatch(
      body,
      /pathname\.startsWith\(['"]\/api\/files\/html-preview\/ws\./,
    );
    assert.match(body, /searchParams\.has\(['"]interactive['"]\)/);
    assert.match(body, /capturePage/);
    assert.match(body, /toPNG\(\)\.toString\(['"]base64['"]\)/);
    assert.doesNotMatch(body, /writeFile|outPath/);
    assert.match(body, /isHtmlThumbnailRequestAllowed/);
    assert.match(body, /setPermissionRequestHandler/);
    assert.match(body, /HTML_THUMBNAIL_CAPTURE_TIMEOUT_MS/);
    assert.match(preload, /asset:capture-html-thumbnail/);
  });

  it('allows only the exact local preview scope and rejects every external request', () => {
    const scopeToken = `ws.${Buffer.from('/Users/test').toString('base64url')}`;
    const target = new URL(
      `http://127.0.0.1:3001/api/files/html-preview/${scopeToken}/`
        + 'Users/test/.codepilot-assets/asset/bundle/index.html',
    );
    const scope = deriveHtmlThumbnailRequestScope(target);
    assert.equal(isHtmlThumbnailRequestAllowed(target.toString(), scope), true);
    assert.equal(
      isHtmlThumbnailRequestAllowed(
        `http://127.0.0.1:3001/api/files/html-preview/${scopeToken}/`
          + 'Users/test/.codepilot-assets/asset/bundle/style.css',
        scope,
      ),
      true,
    );
    assert.equal(
      isHtmlThumbnailRequestAllowed('https://attacker.example/pixel.png', scope),
      false,
    );
    assert.equal(
      isHtmlThumbnailRequestAllowed(
        'http://127.0.0.1:3001/api/chat/sessions',
        scope,
      ),
      false,
    );
    assert.equal(
      isHtmlThumbnailRequestAllowed(
        'http://127.0.0.1:3001/api/files/html-preview/ws.other-token/'
          + 'Users/test/private.png',
        scope,
      ),
      false,
    );
    assert.equal(isHtmlThumbnailRequestAllowed('file:///etc/passwd', scope), false);
  });

  it('rejects non-canonical, containing, and encoded-delimiter workspace tokens', () => {
    const encoded = Buffer.from('/Users/test').toString('base64url');
    const preview = (token: string) => new URL(
      `http://127.0.0.1:3001/api/files/html-preview/${token}/Users/test/index.html`,
    );
    assert.throws(
      () => deriveHtmlThumbnailRequestScope(preview('ws.scope-token')),
      /canonical base64url/,
    );
    assert.throws(
      () => deriveHtmlThumbnailRequestScope(preview(`ws.${encoded}suffix`)),
      /canonical base64url/,
    );
    assert.throws(
      () => deriveHtmlThumbnailRequestScope(preview(`ws.${encoded}%2Fsibling`)),
      /invalid workspace scope segment/,
    );
    assert.throws(
      () => deriveHtmlThumbnailRequestScope(preview('ws.')),
      /invalid workspace scope segment/,
    );
  });

  it('times out a stuck capture and releases the serialized queue', async () => {
    const queue = new SerializedDeadlineQueue();
    let timeoutCleanupCalled = false;
    const stuck = queue.run(
      () => new Promise<string>(() => {}),
      {
        timeoutMs: 20,
        onTimeout: () => {
          timeoutCleanupCalled = true;
        },
      },
    );
    const next = queue.run(
      async () => 'next-capture-completed',
      { timeoutMs: 200 },
    );

    await assert.rejects(stuck, HtmlThumbnailCaptureTimeoutError);
    assert.equal(timeoutCleanupCalled, true);
    assert.equal(await next, 'next-capture-completed');
  });
});
