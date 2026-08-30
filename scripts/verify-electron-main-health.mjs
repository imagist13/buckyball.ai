#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright';

const executablePath = process.argv[2] ? path.resolve(process.argv[2]) : '';
if (!executablePath) {
  console.error('Usage: node scripts/verify-electron-main-health.mjs <packaged-electron-binary>');
  process.exit(2);
}

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codepilot-packaged-recovery-main-health-'));
const userDataDir = path.join(tempRoot, 'user-data');
const dataDir = path.join(tempRoot, 'data');
const codexHome = path.join(tempRoot, 'codex-home');
await Promise.all([
  fs.mkdir(userDataDir, { recursive: true }),
  fs.mkdir(dataDir, { recursive: true }),
  fs.mkdir(codexHome, { recursive: true }),
]);

let electronApp;
try {
  electronApp = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      CLAUDE_GUI_DATA_DIR: dataDir,
      CODEPILOT_CODEX_HOME: codexHome,
      CODEPILOT_PROVIDER_SECRET_ISOLATED_SMOKE: '1',
      CODEX_DISABLED: '1',
      NEXT_PUBLIC_SENTRY_DSN: '',
    },
    timeout: 60_000,
  });

  const page = await electronApp.firstWindow({ timeout: 60_000 });
  await page.waitForURL((url) => url.protocol === 'http:', { timeout: 60_000 });
  const health = await page.evaluate(async () => {
    const response = await fetch('/api/health', { cache: 'no-store' });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
  assert.equal(health.body.database, 'healthy');
  assert.match(String(health.body.nodeModuleVersion), /^\d+$/);

  const mainFacts = await electronApp.evaluate(({ app }) => ({
    modules: process.versions.modules,
    platform: process.platform,
    arch: process.arch,
    utility: app.getAppMetrics()
      .filter((metric) => metric.type === 'Utility')
      .map((metric) => ({ name: metric.name ?? '', serviceName: metric.serviceName ?? '' })),
  }));
  assert.equal(
    String(health.body.nodeModuleVersion),
    String(mainFacts.modules),
    'Electron Main and packaged Next utility must use the same native module ABI',
  );
  assert.ok(
    mainFacts.utility.some((metric) => (
      metric.name === 'codepilot-server' || metric.serviceName === 'codepilot-server'
    )),
    'Electron Main must own a live codepilot-server utilityProcess',
  );
  console.log(
    `Packaged Main→utilityProcess→SQLite health OK platform=${mainFacts.platform} arch=${mainFacts.arch} ABI=${mainFacts.modules}`,
  );
} finally {
  await electronApp?.close().catch(() => {});
  await fs.rm(tempRoot, { recursive: true, force: true });
}
