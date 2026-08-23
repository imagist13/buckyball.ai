import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  applyMacosKeychainGuard,
  buildMacosKeychainEnvironment,
  MACOS_KEYCHAIN_GUARD_ACTIVE_ENV,
  MACOS_KEYCHAIN_REASON_ENV,
  MACOS_KEYCHAIN_STATE_ENV,
  MACOS_SECURITY_SHIM_DIR_ENV,
  probeMacosDefaultKeychain,
} from '../../lib/macos-keychain-guard';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const shimPath = path.join(repoRoot, 'resources', 'macos-keychain-guard', 'security');

describe('macOS default-keychain probe', () => {
  it('does nothing off macOS without invoking security', () => {
    let invoked = false;
    const result = probeMacosDefaultKeychain({
      platform: 'win32',
      runSecurity: () => {
        invoked = true;
        return { status: 0, stdout: '' };
      },
    });
    assert.deepEqual(result, { status: 'not_applicable', reason: 'not_macos' });
    assert.equal(invoked, false);
  });

  it('accepts an existing absolute default keychain path', () => {
    const defaultPath = path.resolve('fixtures', 'login.keychain-db');
    const result = probeMacosDefaultKeychain({
      platform: 'darwin',
      runSecurity: () => ({ status: 0, stdout: `  "${defaultPath}"\n` }),
      pathExists: (candidate) => candidate === defaultPath,
    });
    assert.deepEqual(result, { status: 'available', reason: 'default_keychain_available' });
  });

  it('classifies a stale configured path without reading credential items', () => {
    const result = probeMacosDefaultKeychain({
      platform: 'darwin',
      runSecurity: () => ({ status: 0, stdout: '"/missing/login.keychain-db"\n' }),
      pathExists: () => false,
    });
    assert.deepEqual(result, { status: 'unavailable', reason: 'default_keychain_missing' });
  });

  it('classifies an unconfigured default keychain and a failed probe', () => {
    assert.deepEqual(
      probeMacosDefaultKeychain({
        platform: 'darwin',
        runSecurity: () => ({ status: 44, stdout: '' }),
      }),
      { status: 'unavailable', reason: 'default_keychain_unconfigured' },
    );
    assert.deepEqual(
      probeMacosDefaultKeychain({
        platform: 'darwin',
        runSecurity: () => ({ status: null, stdout: '', errorCode: 'ETIMEDOUT' }),
      }),
      { status: 'unavailable', reason: 'security_probe_failed' },
    );
  });
});

describe('Claude credential guard environment', () => {
  it('activates the narrow security shim only for an unavailable keychain', () => {
    const guardDir = path.resolve('fixtures', 'macos-keychain-guard');
    const env: Record<string, string> = {
      PATH: ['/usr/local/bin', '/usr/bin'].join(path.delimiter),
      ...buildMacosKeychainEnvironment(
        { status: 'unavailable', reason: 'default_keychain_missing' },
        guardDir,
      ),
    };
    const result = applyMacosKeychainGuard(env, {
      platform: 'darwin',
      pathExists: (candidate) => candidate === path.join(guardDir, 'security'),
    });

    assert.equal(result.active, true);
    assert.equal(env.PATH?.split(path.delimiter)[0], guardDir);
    assert.equal(env[MACOS_KEYCHAIN_GUARD_ACTIVE_ENV], '1');
    assert.equal(env[MACOS_KEYCHAIN_STATE_ENV], 'unavailable');
    assert.equal(env[MACOS_KEYCHAIN_REASON_ENV], 'default_keychain_missing');
    assert.equal(env[MACOS_SECURITY_SHIM_DIR_ENV], guardDir);
  });

  it('leaves PATH unchanged when the keychain is available', () => {
    const env: Record<string, string> = { PATH: '/usr/bin' };
    const result = applyMacosKeychainGuard(env, {
      platform: 'darwin',
      probe: { status: 'available', reason: 'default_keychain_available' },
      pathExists: () => true,
    });
    assert.equal(result.active, false);
    assert.equal(env.PATH, '/usr/bin');
    assert.equal(env[MACOS_KEYCHAIN_GUARD_ACTIVE_ENV], undefined);
  });
});

it('the packaged shim blocks only Claude credential operations without shell interpolation', {
  skip: process.platform === 'win32',
}, () => {
  for (const command of [
    ['find-generic-password', '-a', 'tester', '-w', '-s', 'Claude Code-credentials'],
    ['add-generic-password', '-a', 'tester', '-s', 'Claude Code', '-w', 'secret'],
    ['delete-generic-password', '-a', 'tester', '-s', 'Claude Code-credentials'],
    ['show-keychain-info'],
  ]) {
    const result = spawnSync(shimPath, command, { encoding: 'utf8', timeout: 1_000 });
    assert.equal(result.status, 44, `${command[0]} must fail noninteractively`);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }

  const source = fs.readFileSync(shimPath, 'utf8');
  assert.match(source, /"Claude Code"\*\) exit 44/);
  assert.match(source, /exec \/usr\/bin\/security "\$@"/);
  assert.doesNotMatch(source, /\beval\b/);
});

it('the bundled Claude CLI still resolves its eager credential probe through PATH', () => {
  const cliSource = fs.readFileSync(
    path.join(repoRoot, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'cli.js'),
    'utf8',
  );
  assert.match(cliSource, /"security",\["find-generic-password"/);
  assert.match(cliSource, /`Claude Code\$\{/);

  const sdkEnvSource = fs.readFileSync(path.join(repoRoot, 'src', 'lib', 'sdk-subprocess-env.ts'), 'utf8');
  const guardSource = fs.readFileSync(path.join(repoRoot, 'src', 'lib', 'macos-keychain-guard.ts'), 'utf8');
  const claudeClientSource = fs.readFileSync(path.join(repoRoot, 'src', 'lib', 'claude-client.ts'), 'utf8');
  const doctorSource = fs.readFileSync(path.join(repoRoot, 'src', 'lib', 'provider-doctor.ts'), 'utf8');
  assert.match(
    guardSource,
    /spawnSync\(\s*'\/usr\/bin\/security',\s*\['default-keychain', '-d', 'user'\]/,
    'the preflight may inspect only the configured default-keychain path',
  );
  assert.doesNotMatch(guardSource, /spawnSync\([\s\S]{0,300}find-generic-password/);
  assert.match(sdkEnvSource, /applyMacosKeychainGuard\(sdkEnv\)/);
  assert.match(claudeClientSource, /env:\s*\{ \.\.\.sdkSubprocessEnv \}/);
  assert.doesNotMatch(
    claudeClientSource,
    /env:\s*\{ \.\.\.process\.env as Record<string, string> \}/,
    'reactive retries must not bypass the guarded SDK subprocess environment',
  );
  assert.match(doctorSource, /auth\.macos-default-keychain-unavailable/);
});
