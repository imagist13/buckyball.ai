import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { createTelemetrySmokeError, telemetrySmokeEnabled } from '../../lib/telemetry/smoke';

const root = path.resolve(__dirname, '../../..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('isolated Sentry telemetry smoke', () => {
  it('requires an exact opt-in and keeps one stable error per runtime layer', () => {
    assert.equal(telemetrySmokeEnabled('1'), true);
    for (const value of [undefined, '', '0', 'true', 'TRUE', ' 1 ']) {
      assert.equal(telemetrySmokeEnabled(value), false);
    }

    assert.equal(createTelemetrySmokeError('renderer').message, 'CODEPILOT_TELEMETRY_SMOKE_RENDERER');
    assert.equal(createTelemetrySmokeError('next_server').message, 'CODEPILOT_TELEMETRY_SMOKE_NEXT_SERVER');
    assert.equal(createTelemetrySmokeError('electron_main').message, 'CODEPILOT_TELEMETRY_SMOKE_ELECTRON_MAIN');
  });

  it('compiles the fixture only for an explicit manual macOS smoke', () => {
    const workflow = read('.github/workflows/build.yml');
    const nextConfig = read('next.config.ts');
    const electronBuild = read('scripts/build-electron.mjs');

    assert.match(workflow, /telemetry_smoke:[\s\S]*?default:\s*false[\s\S]*?type:\s*boolean/);
    assert.match(workflow, /Build macOS release bundles[\s\S]*?CODEPILOT_TELEMETRY_SMOKE:\s*\$\{\{ inputs\.telemetry_smoke && '1' \|\| '0' \}\}/);

    const windowsJob = workflow.slice(
      workflow.indexOf('  build-windows:'),
      workflow.indexOf('  build-linux:'),
    );
    assert.doesNotMatch(windowsJob, /CODEPILOT_TELEMETRY_SMOKE/);
    const linuxJob = workflow.slice(
      workflow.indexOf('  build-linux:'),
      workflow.indexOf('  release:'),
    );
    assert.match(linuxJob, /CODEPILOT_TELEMETRY_SMOKE:\s*"0"/);
    assert.doesNotMatch(linuxJob, /CODEPILOT_TELEMETRY_SMOKE:\s*\$\{\{\s*inputs/);
    assert.match(nextConfig, /process\.env\.CODEPILOT_TELEMETRY_SMOKE === '1' \? '1' : '0'/);
    assert.match(electronBuild, /CODEPILOT_TELEMETRY_SMOKE === '1' \? '1' : '0'/);
  });

  it('keeps native crash behind compile-time and runtime gates and never publishes smoke artifacts', () => {
    const workflow = read('.github/workflows/build.yml');
    const main = read('electron/main.ts');

    assert.match(main, /telemetrySmokeEnabled\(process\.env\.CODEPILOT_TELEMETRY_SMOKE\)[\s\S]*?process\.env\.CODEPILOT_NATIVE_CRASH_SMOKE === '1'/);
    assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.telemetry_smoke/);
    assert.match(workflow, /CODEPILOT_NATIVE_CRASH_SMOKE=1/);
    assert.match(workflow, /!\(github\.event_name == 'workflow_dispatch' && inputs\.telemetry_smoke\)/);
  });

  it('relaunches after the native crash so SentryMinidump can drain the completed dump', () => {
    const workflow = read('.github/workflows/build.yml');
    const nativeStep = workflow.slice(
      workflow.indexOf('- name: Run packaged Sentry native crash fixture'),
      workflow.indexOf('\n      - name: Checksums'),
    );

    assert.match(nativeStep, /uploadToServer=false/);
    assert.equal((nativeStep.match(/CODEPILOT_NATIVE_CRASH_SMOKE=1/g) ?? []).length, 1);
    assert.equal((nativeStep.match(/"\$APP\/Contents\/MacOS\/CodePilot"/g) ?? []).length, 2);
    assert.match(nativeStep, /RECOVERY_PID=\$!/);
    assert.match(nativeStep, /grep -q "layer=electron_main" "\$RECOVERY_LOG"/);
    assert.match(nativeStep, /recovery launch drained pending minidumps/);
  });
});
