#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from 'playwright';

const executablePath = path.resolve(process.argv[2] ?? '');
const scenario = process.argv[3] ?? 'single';
const allowedScenarios = new Set(['single', 'budget', 'blocked']);

if (!process.argv[2] || !allowedScenarios.has(scenario)) {
  console.error(
    'Usage: node scripts/smoke-packaged-server-recovery.mjs '
      + '<electron-binary> <single|budget|blocked>',
  );
  process.exit(2);
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codepilot-packaged-recovery-'));
const userDataDir = path.join(tempRoot, 'user-data');
const dataDir = path.join(tempRoot, 'data');
const codexHome = path.join(tempRoot, 'codex-home');
await Promise.all([
  mkdir(userDataDir, { recursive: true }),
  mkdir(dataDir, { recursive: true }),
  mkdir(codexHome, { recursive: true }),
]);

let electronApp = null;
let appExited = false;
let appOutput = '';

function appendBoundedOutput(chunk) {
  appOutput += String(chunk);
  if (appOutput.length > 2 * 1024 * 1024) {
    appOutput = appOutput.slice(-1024 * 1024);
  }
}

async function poll(label, callback, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await callback();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `${label} timed out${lastError instanceof Error ? `: ${lastError.message}` : ''}`,
  );
}

async function appMetrics() {
  return electronApp.evaluate(({ app }) => app.getAppMetrics().map((metric) => ({
    pid: metric.pid,
    type: metric.type,
    name: metric.name ?? null,
    serviceName: metric.serviceName ?? null,
    creationTime: metric.creationTime,
  })));
}

function isServerUtilityMetric(metric) {
  return metric.type === 'Utility'
    && (metric.serviceName === 'codepilot-server' || metric.name === 'codepilot-server');
}

async function serverUtility() {
  return poll('packaged Next utility', async () => {
    const metrics = await appMetrics();
    return metrics.find(isServerUtilityMetric) ?? null;
  });
}

async function killServerUtility() {
  const utility = await serverUtility();
  process.kill(utility.pid, 'SIGKILL');
  return utility.pid;
}

async function waitForRecoverySurface(page) {
  await page.waitForURL((url) => url.protocol === 'data:', { timeout: 15_000 });
}

async function waitForRecoveredRoute(page, expectedUrl) {
  await page.waitForURL((url) => url.protocol === 'http:', { timeout: 30_000 });
  assert.equal(page.url(), expectedUrl, 'recovery must restore the exact stable-port route');
}

function isolatedCodexPids() {
  let processList = '';
  try {
    processList = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  } catch {
    return [];
  }
  return processList
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('app-server') && line.includes(codexHome))
    .map((line) => Number.parseInt(line.split(/\s+/, 1)[0], 10))
    .filter((pid) => Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid);
}

async function launch() {
  electronApp = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      CLAUDE_GUI_DATA_DIR: dataDir,
      CODEPILOT_CODEX_HOME: codexHome,
      CODEPILOT_PROVIDER_SECRET_ISOLATED_SMOKE: '1',
      CODEX_DISABLED: scenario === 'blocked' ? '0' : '1',
      NEXT_PUBLIC_SENTRY_DSN: '',
    },
    timeout: 45_000,
  });
  electronApp.process().once('exit', () => { appExited = true; });
  electronApp.process().stdout?.on('data', appendBoundedOutput);
  electronApp.process().stderr?.on('data', appendBoundedOutput);

  const actualUserData = await electronApp.evaluate(({ app }) => app.getPath('userData'));
  assert.equal(
    await realpath(actualUserData),
    await realpath(userDataDir),
    'smoke must not use the real CodePilot user-data directory',
  );

  const page = await electronApp.firstWindow({ timeout: 45_000 });
  await page.waitForURL((url) => url.protocol === 'http:', { timeout: 45_000 });
  const origin = new URL(page.url()).origin;
  const route = `${origin}/settings/about?packaged-recovery-smoke=1#route`;
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await serverUtility();
  return { page, route };
}

async function runSingle(page, route) {
  const firstPid = await killServerUtility();
  await waitForRecoverySurface(page);
  await waitForRecoveredRoute(page, route);
  const replacement = await serverUtility();
  assert.notEqual(replacement.pid, firstPid, 'recovery must replace the killed utility');
  assert.equal(
    (await appMetrics()).filter(isServerUtilityMetric).length,
    1,
    'recovery must leave exactly one packaged Next utility owner',
  );
  console.log(`PASS single: utility ${firstPid} -> ${replacement.pid}, route restored`);
}

async function runBudget(page, route) {
  const killed = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    killed.push(await killServerUtility());
    await waitForRecoverySurface(page);
    await waitForRecoveredRoute(page, route);
  }

  // Three automatic restarts consume the 1s/2s/4s budget. The next crash is
  // the first one that cannot be restarted; this is the observable boundary
  // for the "at most three restarts per ten minutes" contract.
  killed.push(await killServerUtility());
  await waitForRecoverySurface(page);
  await page.locator('#retry').waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await page.locator('#restart').count(), 1);
  assert.equal(await page.locator('#quit').count(), 0);
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  assert.equal(new URL(page.url()).protocol, 'data:');
  assert.equal(
    (await appMetrics()).filter(isServerUtilityMetric).length,
    0,
    'exhausted recovery budget must not spawn another utility',
  );
  console.log(`PASS budget: killed ${killed.join(', ')}, fourth crash stopped`);
}

async function runBlocked(page) {
  await page.evaluate(async () => {
    await fetch('/api/codex/models?refresh=1', { cache: 'no-store' });
  });
  await poll(
    'Codex descendant registration',
    () => appOutput.includes('[server-lifecycle] descendant update'),
    45_000,
  );

  const utilityPid = await killServerUtility();
  await waitForRecoverySurface(page);
  await page.locator('#quit').waitFor({ state: 'visible', timeout: 15_000 });
  assert.equal(await page.locator('#restart').count(), 0);
  assert.equal(await page.locator('#retry').count(), 0);

  const restartResult = await page.evaluate(
    () => window.electronAPI?.serverRecovery?.restartApp(),
  );
  assert.equal(restartResult, false, 'blocked renderer must be unable to relaunch');
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(appExited, false, 'rejected relaunch must leave the blocked app running');

  await page.evaluate(() => {
    void window.electronAPI?.serverRecovery?.quitApp();
  }).catch((error) => {
    // A successful quit can destroy the renderer before Electron delivers the
    // invoke result back to Playwright. The authoritative assertion is the
    // Main process exit below; propagate unrelated evaluation failures.
    if (!(error instanceof Error) || !error.message.includes('has been closed')) throw error;
  });
  await poll('plain app quit', () => appExited, 15_000);
  console.log(`PASS blocked: utility ${utilityPid}, relaunch rejected, plain quit succeeded`);
}

try {
  const { page, route } = await launch();
  if (scenario === 'single') await runSingle(page, route);
  if (scenario === 'budget') await runBudget(page, route);
  if (scenario === 'blocked') await runBlocked(page);
} finally {
  if (electronApp && !appExited) {
    await electronApp.close().catch(() => {});
  }
  for (const pid of isolatedCodexPids()) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ }
  }
  const expectedPrefix = `${os.tmpdir()}${path.sep}codepilot-packaged-recovery-`;
  if (tempRoot.startsWith(expectedPrefix)) {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
