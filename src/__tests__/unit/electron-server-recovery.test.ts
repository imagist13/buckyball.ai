import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  SERVER_HEALTHY_RESET_MS,
  SERVER_RESTART_WINDOW_MS,
  ServerRecoverySupervisor,
} from '../../../electron/server-supervisor';
import {
  parseServerDescendantLifecycleMessage,
  ServerDescendantRegistry,
} from '../../../electron/server-descendant-registry';
import { buildServerRecoveryHtml } from '../../../electron/server-recovery-page';
import { isServerRecoverySafeMode } from '../../lib/server-recovery-safe-mode';
import { parseServerRuntimeObservabilityMessage } from '../../lib/server-runtime-observability';

test('server supervisor uses bounded 1s/2s/4s backoff then stops', () => {
  const supervisor = new ServerRecoverySupervisor();
  assert.deepEqual(supervisor.recordUnexpectedExit(0), {
    allowed: true, attempt: 1, delayMs: 1_000, reason: 'restart_scheduled',
  });
  assert.equal(supervisor.safeMode, true);
  assert.equal(supervisor.recordUnexpectedExit(1_000).delayMs, 2_000);
  assert.equal(supervisor.recordUnexpectedExit(2_000).delayMs, 4_000);
  assert.deepEqual(supervisor.recordUnexpectedExit(3_000), {
    allowed: false, attempt: 4, delayMs: null, reason: 'restart_budget_exhausted',
  });
});

test('server supervisor resets its budget after a sustained healthy interval', () => {
  const supervisor = new ServerRecoverySupervisor();
  supervisor.recordUnexpectedExit(0);
  supervisor.recordUnexpectedExit(1_000);
  supervisor.markHealthy(2_000);
  const next = supervisor.recordUnexpectedExit(2_000 + SERVER_HEALTHY_RESET_MS);
  assert.equal(next.attempt, 1);
  assert.equal(next.delayMs, 1_000);
});

test('server supervisor rolling window expires old crashes', () => {
  const supervisor = new ServerRecoverySupervisor();
  supervisor.recordUnexpectedExit(0);
  const next = supervisor.recordUnexpectedExit(SERVER_RESTART_WINDOW_MS);
  assert.equal(next.attempt, 1);
});

test('descendant registry rejects malformed and wrong-generation messages', () => {
  assert.equal(parseServerDescendantLifecycleMessage({}), null);
  const registry = new ServerDescendantRegistry(7);
  const message = parseServerDescendantLifecycleMessage({
    channel: 'codepilot:server-lifecycle',
    version: 1,
    generation: 8,
    action: 'register',
    role: 'codex-app-server',
    pid: 123,
    startIdentity: 'instance_123', executableBasename: 'codex',
    descendantsVerifiable: false,
  });
  assert.ok(message);
  assert.equal(registry.apply(message), false);
});

test('descendant registry fails closed for live and unverifiable trees', () => {
  const registry = new ServerDescendantRegistry(7);
  const register = parseServerDescendantLifecycleMessage({
    channel: 'codepilot:server-lifecycle', version: 1, generation: 7,
    action: 'register', role: 'codex-app-server', pid: 123,
    startIdentity: 'instance_123', executableBasename: 'codex', descendantsVerifiable: false,
  });
  assert.ok(register);
  registry.apply(register);
  assert.equal(registry.evaluateRestartOwnership((pid) => pid === 123).reason, 'live_registered_descendant');

  assert.equal(registry.evaluateRestartOwnership(() => false).reason, 'descendant_tree_unverifiable');

  const unregister = parseServerDescendantLifecycleMessage({ ...register, action: 'unregister' });
  assert.ok(unregister);
  registry.apply(unregister);
  assert.equal(registry.evaluateRestartOwnership(() => false).reason, 'ownership_clear');
});

test('descendant registry does not unregister a reused PID with a different start identity', () => {
  const registry = new ServerDescendantRegistry(9);
  const register = parseServerDescendantLifecycleMessage({
    channel: 'codepilot:server-lifecycle', version: 1, generation: 9,
    action: 'register', role: 'codex-app-server', pid: 456,
    startIdentity: 'first_identity', executableBasename: 'codex', descendantsVerifiable: true,
  });
  const forgedUnregister = parseServerDescendantLifecycleMessage({
    channel: 'codepilot:server-lifecycle', version: 1, generation: 9,
    action: 'unregister', role: 'codex-app-server', pid: 456,
    startIdentity: 'second_identity', executableBasename: 'codex', descendantsVerifiable: true,
  });
  assert.ok(register);
  assert.ok(forgedUnregister);
  assert.equal(registry.apply(register), true);
  assert.equal(registry.apply(forgedUnregister), false);
  assert.equal(registry.evaluateRestartOwnership(() => true).reason, 'live_registered_descendant');
});

test('recovery page is self-contained, localized, and contains no raw detail', () => {
  const html = buildServerRecoveryHtml({
    locale: 'zh-CN', state: 'blocked', attempt: 2, reasonCode: '<unsafe-path>',
  });
  assert.match(html, /CodePilot 需要你的操�?);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /&lt;unsafe-path&gt;/);
  assert.doesNotMatch(html, /<unsafe-path>/);
  assert.match(html, /serverRecovery/);
});

test('blocked recovery page offers plain quit only, never one-click relaunch', () => {
  // The descendant registry is per-Main memory: a relaunch boots an empty
  // registry that could spawn a second Codex app-server over the same
  // CODEX_HOME while the unverifiable old tree is still alive. Blocked must
  // therefore never render the restart (relaunch) affordance.
  for (const locale of ['zh-CN', 'en']) {
    const blocked = buildServerRecoveryHtml({ locale, state: 'blocked' });
    assert.match(blocked, /id="quit"/);
    assert.doesNotMatch(blocked, /id="restart"/);
    assert.doesNotMatch(blocked, /id="retry"/);
    assert.doesNotMatch(blocked, /restartApp\(\)/);
  }
  const recovering = buildServerRecoveryHtml({ locale: 'en', state: 'recovering' });
  assert.match(recovering, /id="restart"/);
  assert.doesNotMatch(recovering, /id="quit"/);
  const failed = buildServerRecoveryHtml({ locale: 'en', state: 'failed' });
  assert.match(failed, /id="restart"/);
  assert.match(failed, /id="retry"/);
});

test('recovery action IPCs enforce the blocked-state quit-only boundary', () => {
  const main = readFileSync(path.resolve(__dirname, '../../../electron/main.ts'), 'utf8');
  const preload = readFileSync(path.resolve(__dirname, '../../../electron/preload.ts'), 'utf8');
  assert.match(preload, /server-recovery:quit-app/);

  const restartStart = main.indexOf("ipcMain.handle('server-recovery:restart-app'");
  const quitStart = main.indexOf("ipcMain.handle('server-recovery:quit-app'");
  assert.notEqual(restartStart, -1);
  assert.notEqual(quitStart, -1);
  const restartHandler = main.slice(restartStart, quitStart);
  const quitEnd = main.indexOf('\n  });', quitStart);
  const quitHandler = main.slice(quitStart, quitEnd);

  assert.match(restartHandler, /isTrustedServerRecoverySender/);
  assert.match(restartHandler, /lastServerRecoveryPageState === 'blocked'/);
  assert.ok(
    restartHandler.indexOf("lastServerRecoveryPageState === 'blocked'")
      < restartHandler.indexOf('app.relaunch()'),
  );
  assert.match(quitHandler, /isTrustedServerRecoverySender/);
  assert.match(quitHandler, /lastServerRecoveryPageState !== 'blocked'/);
  assert.doesNotMatch(quitHandler, /relaunch/);
});

test('recovery safe mode is enabled only by the exact Main-owned flag', () => {
  assert.equal(isServerRecoverySafeMode({ CODEPILOT_RECOVERY_SAFE_MODE: '1' }), true);
  assert.equal(isServerRecoverySafeMode({ CODEPILOT_RECOVERY_SAFE_MODE: 'true' }), false);
  assert.equal(isServerRecoverySafeMode({}), false);
});

test('server observability accepts only bounded numeric facts', () => {
  const valid = {
    channel: 'codepilot:server-observability', version: 1, generation: 3,
    rssBytes: 10, heapUsedBytes: 2, heapTotalBytes: 4, heapLimitBytes: 20,
    externalBytes: 1, arrayBuffersBytes: 0,
  };
  assert.deepEqual(parseServerRuntimeObservabilityMessage(valid), valid);
  assert.equal(parseServerRuntimeObservabilityMessage({ ...valid, rssBytes: -1 }), null);
  assert.equal(parseServerRuntimeObservabilityMessage({ ...valid, heapLimitBytes: '20' }), null);
});

test('Electron Main recovery wiring pauses poll and gates reload on health', () => {
  const main = readFileSync(path.resolve(__dirname, '../../../electron/main.ts'), 'utf8');
  const recoveryStart = main.indexOf('async function runServerRecovery');
  const recoveryEnd = main.indexOf('function beginServerRecovery', recoveryStart);
  const recovery = main.slice(recoveryStart, recoveryEnd);
  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart);
  assert.ok(recovery.indexOf('await waitForServer') < recovery.indexOf('mainWindow.loadURL'));
  assert.ok(recovery.indexOf('mainWindow.loadURL') < recovery.indexOf('startNativeDeliveryService'));

  const beginStart = main.indexOf('function beginServerRecovery');
  const beginEnd = main.indexOf('function retryServerRecoveryFromUser', beginStart);
  assert.match(main.slice(beginStart, beginEnd), /stopNativeDeliveryService\(\)/);
  assert.match(main, /CODEPILOT_RECOVERY_SAFE_MODE:\s*recoverySafeMode\s*\?\s*'1'\s*:\s*'0'/);
  assert.match(main, /!isQuitting\s*&&\s*serverLifecyclePhase === 'running'/);
});

test('utility failures emit one sanitized Sentry event per generation', () => {
  const main = readFileSync(path.resolve(__dirname, '../../../electron/main.ts'), 'utf8');
  const start = main.indexOf('function startServer');
  const end = main.indexOf('function getIconPath', start);
  const server = main.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(server, /let childFailureReported = false/);
  assert.match(server, /childFailureReported\s*\|\|\s*!electronTelemetry\.enabled/);
  assert.match(server, /Sentry\.captureEvent\(buildUtilityProcessFailureEvent\(/);
  assert.match(server, /reportUtilityFailureOnce\(childFailureReason\)/);
  assert.match(server, /reportUtilityFailureOnce\([\s\S]*'unexpected_exit'/);
  assert.match(server, /void report/);
  assert.doesNotMatch(
    server.slice(server.indexOf('const reportUtilityFailureOnce'), server.indexOf("child.stdout?.on('data'")),
    /diagnosticReport|report\s*[,}]/,
  );
});

test('recovery IPC is exposed narrowly and rejects ordinary Next renderers', () => {
  const main = readFileSync(path.resolve(__dirname, '../../../electron/main.ts'), 'utf8');
  const preload = readFileSync(path.resolve(__dirname, '../../../electron/preload.ts'), 'utf8');
  assert.match(main, /event\.sender === mainWindow\.webContents/);
  assert.match(main, /activeServerRecoveryDataUrl !== null/);
  assert.match(main, /getURL\(\) === activeServerRecoveryDataUrl/);
  assert.match(preload, /server-recovery:copy-diagnostics/);
  assert.match(preload, /server-recovery:restart-app/);
  assert.match(preload, /server-recovery:retry/);
});

test('window recreation cannot bypass a failed or recovering supervisor', () => {
  const main = readFileSync(path.resolve(__dirname, '../../../electron/main.ts'), 'utf8');
  const showStart = main.indexOf('function showMainWindow');
  const showEnd = main.indexOf('function quitApp', showStart);
  const activateStart = main.indexOf("app.on('activate'");
  const activateEnd = main.indexOf("app.on('before-quit'", activateStart);
  const failedOrRecovering = /serverLifecyclePhase === 'recovering' \|\| serverSupervisor\.state === 'failed'/;

  assert.match(main.slice(showStart, showEnd), failedOrRecovering);
  assert.match(main.slice(activateStart, activateEnd), failedOrRecovering);
});

test('an exit during recovery handoff is queued instead of being dropped', () => {
  const main = readFileSync(path.resolve(__dirname, '../../../electron/main.ts'), 'utf8');
  const finishStart = main.indexOf('function finishServerRecoveryRun');
  const beginStart = main.indexOf('function beginServerRecovery', finishStart);
  const retryStart = main.indexOf('function retryServerRecoveryFromUser', beginStart);

  assert.match(main, /serverProcess !== recoveryChild \|\| serverExited/);
  assert.match(main.slice(finishStart, beginStart), /beginServerRecovery\(queued\.generation, queued\.reason\)/);
  assert.match(main.slice(beginStart, retryStart), /queuedServerRecovery = \{ generation, reason \}/);
});

test('recovery safe mode blocks both Codex app-server and scheduler entry points', () => {
  const manager = readFileSync(
    path.resolve(__dirname, '../../lib/codex/app-server-manager.ts'),
    'utf8',
  );
  const scheduler = readFileSync(path.resolve(__dirname, '../../lib/task-scheduler.ts'), 'utf8');
  assert.match(manager, /getCodexAppServer[\s\S]{0,220}isServerRecoverySafeMode\(\)/);
  assert.match(scheduler, /ensureSchedulerRunning[\s\S]{0,500}CODEPILOT_RECOVERY_SAFE_MODE\s*===\s*'1'/);
});
