import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const root = path.resolve(__dirname, '../../..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

describe('telemetry release wiring', () => {
  it('initializes Electron Sentry before importing Electron and without a committed DSN', () => {
    const main = read('electron/main.ts');
    const sentryImport = main.indexOf("from '@sentry/electron/main'");
    const sentryInit = main.indexOf('Sentry.init(');
    const electronImport = main.indexOf("from 'electron'");
    assert.ok(sentryImport >= 0 && sentryInit > sentryImport && electronImport > sentryInit);
    assert.doesNotMatch(main, /ingest\.(?:us\.)?sentry\.io/);
    assert.match(main, /sendDefaultPii:\s*false/);
    assert.match(main, /attachScreenshot:\s*false/);
    assert.match(main, /configureElectronMainIntegrations\(/);
    assert.match(main, /mainProcessSessionIntegration\(\{\s*sendOnCreate:\s*true\s*\}\)/);
    assert.match(
      main,
      /childProcessIntegration\(\{\s*events:\s*\[\]\s*\}\)/,
      'SDK ChildProcess breadcrumbs stay enabled, but its automatic Issue events must be disabled',
    );
  });

  it('keeps auth tokens server-only and source maps private', () => {
    const config = read('next.config.ts');
    const builder = read('electron-builder.yml');
    const workflow = read('.github/workflows/build.yml');
    assert.doesNotMatch(config, /SENTRY_AUTH_TOKEN/);
    assert.doesNotMatch(config, /ingest\.(?:us\.)?sentry\.io/);
    assert.match(config, /productionBrowserSourceMaps:\s*process\.env\.CODEPILOT_SOURCE_MAPS\s*===\s*['"]1['"]/);
    assert.match(builder, /!dist-electron\/\*\*\/\*\.map/);
    assert.ok((builder.match(/!\*\*\/\*\.map/g) ?? []).length >= 3);
    assert.match(workflow, /SENTRY_AUTH_TOKEN:\s*\$\{\{\s*secrets\.SENTRY_AUTH_TOKEN\s*\}\}/);
    assert.match(workflow, /npm run sentry:sourcemaps:upload/);
    const tokenOffsets = [...workflow.matchAll(/SENTRY_AUTH_TOKEN:/g)].map((match) => match.index);
    assert.equal(
      tokenOffsets.length,
      3,
      'one least-privilege upload step per job definition (Linux is a native-arch matrix)',
    );
    for (const offset of tokenOffsets) {
      const precedingStep = workflow.lastIndexOf('- name:', offset);
      const stepNameEnd = workflow.indexOf('\n', precedingStep);
      assert.match(workflow.slice(precedingStep, stepNameEnd), /Upload .* source maps to Sentry/);
    }
    for (const buildStepName of [
      'Build macOS release bundles',
      'Build Windows release bundles',
      'Build Linux release bundle',
    ]) {
      const start = workflow.indexOf(`- name: ${buildStepName}`);
      const end = workflow.indexOf('\n      - name:', start + 1);
      assert.doesNotMatch(workflow.slice(start, end), /SENTRY_AUTH_TOKEN|SENTRY_ORG|SENTRY_PROJECT/);
    }
  });

  it('verifies map presence without credentials and fails closed before upload without Secrets', () => {
    const fixture = fs.mkdtempSync(path.join(root, '.codepilot-sentry-maps-'));
    try {
      for (const relative of [
        '.next/static',
        '.next/standalone/.next/server',
        'dist-electron',
      ]) {
        fs.mkdirSync(path.join(fixture, relative), { recursive: true });
        fs.writeFileSync(
          path.join(fixture, relative, 'main.js.map'),
          JSON.stringify({ version: 3, sources: ['src/main.ts'], sourcesContent: ['x'.repeat(256)] }),
        );
      }
      const script = path.join(root, 'scripts/sentry-source-maps.mjs');
      const env = {
        ...process.env,
        CODEPILOT_APP_CHANNEL: 'stable',
        CODEPILOT_SOURCE_MAPS: '1',
        SENTRY_AUTH_TOKEN: '',
        SENTRY_DSN: '',
        SENTRY_ORG: '',
        SENTRY_PROJECT: '',
      };
      const verified = spawnSync(process.execPath, [script, '--verify'], {
        cwd: fixture,
        env,
        encoding: 'utf8',
      });
      assert.equal(verified.status, 0, verified.stderr);
      assert.match(verified.stdout, /verified 3 non-placeholder maps/);

      const upload = spawnSync(process.execPath, [script, '--upload'], {
        cwd: fixture,
        env,
        encoding: 'utf8',
      });
      assert.notEqual(upload.status, 0);
      assert.match(upload.stderr, /SENTRY_AUTH_TOKEN is required/);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('retries transient source-map upload failures and remains fail closed', () => {
    const fixture = fs.mkdtempSync(path.join(root, '.codepilot-sentry-upload-'));
    try {
      for (const relative of [
        '.next/static',
        '.next/standalone/.next/server',
        'dist-electron',
      ]) {
        fs.mkdirSync(path.join(fixture, relative), { recursive: true });
        fs.writeFileSync(
          path.join(fixture, relative, 'main.js.map'),
          JSON.stringify({ version: 3, sources: ['src/main.ts'], sourcesContent: ['x'.repeat(256)] }),
        );
      }

      const fakeCli = path.join(fixture, 'node_modules/@sentry/cli/bin/sentry-cli');
      fs.mkdirSync(path.dirname(fakeCli), { recursive: true });
      fs.writeFileSync(fakeCli, `
const fs = require('node:fs');
const counter = process.env.FAKE_SENTRY_COUNTER;
if (process.argv.includes('inject')) process.exit(0);
const count = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) + 1 : 1;
fs.writeFileSync(counter, String(count));
if (process.env.FAKE_SENTRY_ALWAYS_FAIL === '1' || count < 3) process.exit(75);
`);

      const script = path.join(root, 'scripts/sentry-source-maps.mjs');
      const counter = path.join(fixture, 'upload-count');
      const env = {
        ...process.env,
        CODEPILOT_APP_CHANNEL: 'stable',
        CODEPILOT_SOURCE_MAPS: '1',
        SENTRY_AUTH_TOKEN: 'fixture-token',
        SENTRY_DSN: 'https://public@example.com/1',
        SENTRY_ORG: 'fixture-org',
        SENTRY_PROJECT: 'fixture-project',
        SENTRY_UPLOAD_RETRY_DELAY_MS: '0',
        FAKE_SENTRY_COUNTER: counter,
      };

      const recovered = spawnSync(process.execPath, [script, '--upload'], {
        cwd: fixture,
        env,
        encoding: 'utf8',
      });
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.equal(fs.readFileSync(counter, 'utf8'), '3');
      assert.match(recovered.stderr, /attempt 1\/3 failed/);
      assert.match(recovered.stderr, /attempt 2\/3 failed/);

      fs.rmSync(counter);
      const failed = spawnSync(process.execPath, [script, '--upload'], {
        cwd: fixture,
        env: { ...env, FAKE_SENTRY_ALWAYS_FAIL: '1' },
        encoding: 'utf8',
      });
      assert.notEqual(failed.status, 0);
      assert.equal(fs.readFileSync(counter, 'utf8'), '3');
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  });
});
