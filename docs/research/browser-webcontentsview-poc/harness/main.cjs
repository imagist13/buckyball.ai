const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { buildPocPartition, validateBounds, isAllowedBrowserUrl } = require('./contract.cjs');

const runNonce = process.env.BROWSER_POC_RUN_NONCE || `run_${Date.now()}`;
const workspaceKey = process.env.BROWSER_POC_WORKSPACE_KEY;
const auto = process.env.BROWSER_POC_AUTO === '1';
const skipCrash = process.env.BROWSER_POC_SKIP_CRASH === '1';
const reportPath = process.env.BROWSER_POC_REPORT || path.join(os.tmpdir(), `codepilot-browser-poc-${runNonce}.json`);
const evidencePath = process.env.BROWSER_POC_SCREENSHOT || path.join(os.tmpdir(), `codepilot-browser-poc-${runNonce}.png`);
const guestEvidencePath = evidencePath.replace(/(\.[^.]+)?$/, '-guest$1');
const isolatedUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-browser-poc-userdata-'));
app.setPath('userData', isolatedUserData);

const ledger = {
  schema: 1,
  startedAt: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  window: {},
  checks: [],
  events: [],
  manual: {
    ime: 'not run',
    focusRoundTrip: 'not run',
    overlayVisual: 'not run',
    packaged: 'not run',
  },
};

function record(name, result, detail) {
  ledger.checks.push({ name, result, ...(detail ? { detail } : {}) });
}

function checkpoint(stage) {
  ledger.stage = stage;
  fs.writeFileSync(reportPath, JSON.stringify(ledger, null, 2));
}

async function waitUntil(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

function fixtureHtml(port) {
  return `<!doctype html><meta charset="utf-8"><title>Browser POC Fixture</title>
  <h1>Fixture</h1><label>IME <input id="ime" placeholder="输入中文"></label>
  <button id="popup" onclick="window.open('http://127.0.0.1:${port}/popup')">Popup</button>
  <button id="permission" onclick="navigator.geolocation.getCurrentPosition(()=>{},()=>{})">Permission</button>
  <a id="download" download="fixture.txt" href="http://127.0.0.1:${port}/download">Download</a>
  <a id="blocked-data" href="data:text/html,blocked">Blocked data URL</a>
  <a id="blocked-redirect" href="http://127.0.0.1:${port}/redirect-blocked">Blocked redirect</a>
  <script>localStorage.setItem('fixture','workspace'); document.cookie='fixture=workspace; SameSite=Lax';</script>`;
}

async function startFixtureServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/download') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="fixture.txt"' });
      res.end('download fixture');
      return;
    }
    if (req.url === '/redirect-blocked') {
      res.writeHead(302, { location: 'http://example.com/plaintext-blocked' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fixtureHtml(server.address().port));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

function trustedSender(event, window) {
  return event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
}

class OverlayCoordinator {
  constructor(view) { this.view = view; this.tokens = 0; }
  setOpen(open) {
    this.tokens = Math.max(0, this.tokens + (open ? 1 : -1));
    this.view.setVisible(this.tokens === 0);
    this.view.webContents.setAudioMuted(this.tokens > 0);
    ledger.events.push({ type: 'overlay', tokens: this.tokens, visible: this.tokens === 0 });
  }
  reset() {
    this.tokens = 0;
    this.view.setVisible(true);
    this.view.webContents.setAudioMuted(false);
  }
}

function forceCrashAndReload(webContents) {
  // Electron's documented recovery sequence is deliberately immediate:
  // forcefullyCrashRenderer() followed by reload() forces the navigation into
  // a new renderer process. Starting a fresh loadURL() from inside the
  // render-process-gone observer can overlap WebContents' own teardown and
  // produced a false-negative native observer assertion in the first probe.
  webContents.forcefullyCrashRenderer();
  webContents.reload();
}

async function runAutomaticChecks(window, view, fixtureUrl, partitionName, overlay) {
  checkpoint('load-fixture');
  await view.webContents.loadURL(fixtureUrl);
  record('allowed-loopback-navigation', view.webContents.getURL() === fixtureUrl ? 'pass' : 'fail');
  record(
    'native-bounds-match-slot',
    JSON.stringify(view.getBounds()) === JSON.stringify({ x: 16, y: 64, width: 1148, height: 700 }) ? 'pass' : 'fail',
  );

  const beforeBlocked = view.webContents.getURL();
  await view.webContents.executeJavaScript("void document.querySelector('#blocked-data').click(); true", true);
  await new Promise((resolve) => setTimeout(resolve, 150));
  record('blocked-data-navigation', view.webContents.getURL() === beforeBlocked ? 'pass' : 'fail');

  checkpoint('blocked-redirect');
  void view.webContents.loadURL(`${fixtureUrl}redirect-blocked`).catch(() => {});
  const redirectDenied = await waitUntil(() => ledger.events.some((event) =>
    event.type === 'navigation-blocked' && event.scheme === 'http:'));
  record(
    'blocked-remote-http-redirect',
    redirectDenied && view.webContents.getURL() !== 'http://example.com/plaintext-blocked' ? 'pass' : 'fail',
  );
  view.webContents.stop();
  await view.webContents.loadURL(fixtureUrl);

  checkpoint('popup');
  await view.webContents.executeJavaScript("void document.querySelector('#popup').click(); true", true);
  record(
    'popup-default-deny',
    await waitUntil(() => ledger.events.some((event) => event.type === 'popup-denied')) ? 'pass' : 'fail',
  );

  checkpoint('permission');
  await view.webContents.executeJavaScript("void document.querySelector('#permission').click(); true", true);
  record(
    'permission-default-deny',
    await waitUntil(() => ledger.events.some((event) =>
      event.type === 'permission-check-denied' || event.type === 'permission-denied')) ? 'pass' : 'fail',
  );

  checkpoint('download');
  await view.webContents.executeJavaScript("void document.querySelector('#download').click(); true", true);
  record(
    'download-cancelled',
    await waitUntil(() => ledger.events.some((event) => event.type === 'download-cancelled')) ? 'pass' : 'fail',
  );

  const partitionSession = session.fromPartition(partitionName);
  const cookies = await partitionSession.cookies.get({ url: fixtureUrl });
  record('isolated-partition-cookie', cookies.some((cookie) => cookie.name === 'fixture') ? 'pass' : 'fail');

  overlay.setOpen(true);
  overlay.setOpen(true);
  const hiddenState = await view.webContents.executeJavaScript("localStorage.getItem('fixture')");
  overlay.setOpen(false);
  const nestedStillHidden = overlay.tokens === 1
    && view.webContents.isAudioMuted()
    && view.getVisible() === false;
  overlay.setOpen(false);
  const restoredState = await view.webContents.executeJavaScript("localStorage.getItem('fixture')");
  record('overlay-preserves-page-state', hiddenState === 'workspace' && restoredState === 'workspace' ? 'pass' : 'fail');
  record(
    'nested-overlay-coordinator',
    nestedStillHidden && view.getVisible() && view.webContents.isAudioMuted() === false ? 'pass' : 'fail',
  );
  record('overlay-audio-muted-while-hidden', view.webContents.isAudioMuted() === false ? 'pass' : 'fail', 'restored unmuted after nested coordinator count returned to zero');

  view.webContents.setZoomFactor(1.25);
  record('guest-zoom-roundtrip', Math.abs(view.webContents.getZoomFactor() - 1.25) < 0.001 ? 'pass' : 'fail');
  view.webContents.setZoomFactor(1);

  const guestPreferences = view.webContents.getLastWebPreferences();
  record('guest-node-disabled', guestPreferences.nodeIntegration === false ? 'pass' : 'fail');
  record('guest-context-isolated', guestPreferences.contextIsolation === true ? 'pass' : 'fail');
  record('guest-sandboxed', guestPreferences.sandbox === true ? 'pass' : 'fail');
  record('guest-web-security', guestPreferences.webSecurity !== false ? 'pass' : 'fail');

  if (skipCrash) {
    record('bounded-crash-recovery', 'not run', 'run separately because the recovery probe can terminate the native host');
  } else {
    // Persist the pre-crash ledger first: a native host crash cannot execute the
    // JavaScript catch/finally path, and that outcome is itself POC evidence.
    ledger.preCrashAt = new Date().toISOString();
    fs.writeFileSync(reportPath, JSON.stringify(ledger, null, 2));
    const crashEventCount = ledger.events.filter((event) => event.type === 'renderer-process-gone').length;
    forceCrashAndReload(view.webContents);
    const crashed = await waitUntil(() =>
      ledger.events.filter((event) => event.type === 'renderer-process-gone').length > crashEventCount);
    const recovered = crashed && await waitUntil(
      () => view.webContents.getURL() === fixtureUrl && !view.webContents.isLoading(),
      4_000,
    );
    record('bounded-crash-recovery', recovered ? 'pass' : 'fail', 'one automatic reload budget; no unbounded recreate loop');
  }

  const [windowImage, guestImage] = await Promise.all([
    window.capturePage(),
    view.webContents.capturePage(),
  ]);
  fs.writeFileSync(evidencePath, windowImage.toPNG());
  fs.writeFileSync(guestEvidencePath, guestImage.toPNG());
  ledger.evidence = {
    shellScreenshot: evidencePath,
    guestScreenshot: guestEvidencePath,
    report: reportPath,
    note: 'BrowserWindow.capturePage may omit native child-view pixels; guestScreenshot is captured from the WebContentsView.',
  };
  ledger.stage = 'complete';
  ledger.completedAt = new Date().toISOString();
  fs.writeFileSync(reportPath, JSON.stringify(ledger, null, 2));
  setTimeout(() => app.quit(), 250);
}

checkpoint('waiting-app-ready');
app.whenReady().then(async () => {
  checkpoint('app-ready');
  if (!workspaceKey) throw new Error('BROWSER_POC_WORKSPACE_KEY is required');
  const partitionName = buildPocPartition(workspaceKey, runNonce);
  checkpoint('starting-fixture-server');
  const fixtureServer = await startFixtureServer();
  checkpoint('fixture-listening');
  const fixtureUrl = `http://127.0.0.1:${fixtureServer.address().port}/`;
  const windowOptions = {
    width: 1180,
    height: 780,
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: process.platform === 'darwin' ? '#00ffffff' : '#111111',
    transparent: process.platform === 'darwin',
    ...(process.platform === 'darwin' ? {
      vibrancy: 'under-window',
      visualEffectState: 'followWindow',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 20, y: 21 },
    } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  };
  ledger.window = windowOptions;
  const window = new BrowserWindow(windowOptions);
  const view = new WebContentsView({
    webPreferences: {
      partition: partitionName,
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });
  window.contentView.addChildView(view);
  view.setBounds({ x: 16, y: 64, width: 1148, height: 700 });
  const overlay = new OverlayCoordinator(view);

  const policy = (event, url) => {
    if (isAllowedBrowserUrl(url)) return;
    event.preventDefault();
    ledger.events.push({ type: 'navigation-blocked', scheme: (() => { try { return new URL(url).protocol; } catch { return 'invalid'; } })() });
  };
  view.webContents.on('will-navigate', policy);
  view.webContents.on('will-redirect', policy);
  view.webContents.setWindowOpenHandler(({ url }) => {
    ledger.events.push({ type: 'popup-denied', urlAllowedByPolicy: isAllowedBrowserUrl(url) });
    return { action: 'deny' };
  });
  view.webContents.on('render-process-gone', (_event, details) => {
    ledger.events.push({ type: 'renderer-process-gone', reason: details.reason });
  });
  view.webContents.on('unresponsive', () => ledger.events.push({ type: 'unresponsive' }));

  const guestSession = session.fromPartition(partitionName);
  guestSession.setPermissionCheckHandler((_webContents, permission) => {
    ledger.events.push({ type: 'permission-check-denied', permission });
    return false;
  });
  guestSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    ledger.events.push({ type: 'permission-denied', permission });
    callback(false);
  });
  guestSession.on('will-download', (_event, item) => {
    ledger.events.push({ type: 'download-cancelled', filename: path.basename(item.getFilename()) });
    item.cancel();
  });

  ipcMain.handle('browser-poc:set-bounds', (event, requested) => {
    if (!trustedSender(event, window)) return { ok: false, error: 'untrusted-sender' };
    const bounds = validateBounds(requested, window.getContentBounds());
    if (!bounds) return { ok: false, error: 'invalid-bounds' };
    view.setBounds(bounds);
    return { ok: true };
  });
  ipcMain.handle('browser-poc:navigate', async (event, url) => {
    if (!trustedSender(event, window) || typeof url !== 'string' || !isAllowedBrowserUrl(url)) return { ok: false, error: 'navigation-denied' };
    await view.webContents.loadURL(url);
    return { ok: true };
  });
  ipcMain.handle('browser-poc:set-overlay-open', (event, open) => {
    if (!trustedSender(event, window) || typeof open !== 'boolean') return { ok: false, error: 'invalid-request' };
    overlay.setOpen(open);
    return { ok: true };
  });
  ipcMain.handle('browser-poc:crash-guest', (event) => {
    if (!trustedSender(event, window)) return { ok: false };
    forceCrashAndReload(view.webContents);
    return { ok: true };
  });
  ipcMain.handle('browser-poc:get-status', (event) => {
    if (!trustedSender(event, window)) return {};
    return { url: fixtureUrl, platform: process.platform, electron: process.versions.electron, partition: partitionName };
  });

  window.on('closed', () => {
    overlay.reset();
    if (!view.webContents.isDestroyed()) view.webContents.close();
    fixtureServer.close();
  });
  await window.loadFile(path.join(__dirname, 'shell.html'));
  if (auto) {
    void runAutomaticChecks(window, view, fixtureUrl, partitionName, overlay).catch((error) => {
      ledger.events.push({ type: 'automatic-check-failed', message: error instanceof Error ? error.message : String(error) });
      ledger.completedAt = new Date().toISOString();
      fs.writeFileSync(reportPath, JSON.stringify(ledger, null, 2));
      setTimeout(() => app.quit(), 250);
    });
  }
  else await view.webContents.loadURL(fixtureUrl);
});

app.on('window-all-closed', () => app.quit());
