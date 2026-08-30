const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-electron-ready-probe-'));
app.setPath('userData', userData);

const startedAt = Date.now();
const log = (event) => {
  process.stderr.write(JSON.stringify({
    event,
    elapsedMs: Date.now() - startedAt,
    ready: app.isReady(),
    electron: process.versions.electron,
    platform: process.platform,
  }) + '\n');
};

log('script-started');
app.on('will-finish-launching', () => log('will-finish-launching'));
app.on('ready', () => log('ready-event'));
app.on('before-quit', () => log('before-quit'));

const watchdog = setTimeout(() => {
  log('ready-timeout');
  app.exit(2);
}, 15_000);

app.whenReady().then(() => {
  clearTimeout(watchdog);
  log('when-ready-resolved');
  app.quit();
}).catch((error) => {
  clearTimeout(watchdog);
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  app.exit(1);
});
