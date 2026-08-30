import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildProxySafeEnvironment,
  hasConfiguredProxy,
  withLoopbackProxyBypass,
} from '@/lib/process-proxy-env';
import {
  buildCodexAppServerArgs,
  buildCodexAppServerEnv,
} from '@/lib/codex/app-server-manager';

describe('process proxy environment — loopback boundary', () => {
  it('preserves user NO_PROXY rules, appends all loopback forms, and is idempotent on POSIX', () => {
    const first = withLoopbackProxyBypass({
      HTTP_PROXY: 'http://proxy.example.test:8080',
      NO_PROXY: '.corp.test,localhost',
      no_proxy: 'metadata.internal,.corp.test',
    }, 'linux');

    assert.equal(
      first.NO_PROXY,
      '.corp.test,localhost,metadata.internal,127.0.0.1,::1',
    );
    assert.equal(first.no_proxy, first.NO_PROXY);
    assert.equal(first.HTTP_PROXY, 'http://proxy.example.test:8080');

    const second = withLoopbackProxyBypass(first, 'linux');
    assert.deepEqual(second, first);
  });

  it('canonicalizes Windows proxy key variants and gives explicit lowercase values precedence', () => {
    const env = withLoopbackProxyBypass({
      HTTP_PROXY: 'http://system-proxy.example.test:9000',
      http_proxy: 'http://explicit-proxy.example.test:8000',
      HtTpS_PrOxY: 'http://mixed-case.example.test:7000',
      no_proxy: '.corp.test',
      NO_PROXY: 'localhost',
    }, 'win32');

    assert.equal(env.HTTP_PROXY, 'http://explicit-proxy.example.test:8000');
    assert.equal(env.HTTPS_PROXY, 'http://mixed-case.example.test:7000');
    assert.equal(env.http_proxy, undefined);
    assert.equal(env.HtTpS_PrOxY, undefined);
    assert.equal(env.no_proxy, undefined);
    assert.equal(env.NO_PROXY, '.corp.test,localhost,127.0.0.1,::1');
  });

  it('detects explicit proxies in either casing and ignores empty values', () => {
    assert.equal(hasConfiguredProxy({ https_proxy: 'http://127.0.0.1:7892' }), true);
    assert.equal(hasConfiguredProxy({ ALL_PROXY: 'socks5://127.0.0.1:7892' }), true);
    assert.equal(hasConfiguredProxy({ HTTP_PROXY: '  ', HTTPS_PROXY: '' }), false);
  });

  it('treats explicitly empty HTTP/HTTPS variables as a stable proxy disable at merge time', () => {
    const env = buildProxySafeEnvironment({
      baseEnv: { HTTP_PROXY: '', HTTPS_PROXY: '' },
      fallbackProxyEnv: {
        HTTP_PROXY: 'http://system.example.test:9000',
        HTTPS_PROXY: 'http://system.example.test:9000',
      },
      platform: 'win32',
    });

    assert.equal(env.HTTP_PROXY, undefined);
    assert.equal(env.HTTPS_PROXY, undefined);
    assert.match(env.NO_PROXY ?? '', /localhost/);
  });

  it('uses the Chromium system proxy only as a fallback, never over an inherited explicit proxy', () => {
    const explicit = buildProxySafeEnvironment({
      baseEnv: { http_proxy: 'http://explicit.example.test:8000' },
      fallbackProxyEnv: {
        HTTP_PROXY: 'http://system.example.test:9000',
        HTTPS_PROXY: 'http://system.example.test:9000',
      },
      platform: 'win32',
    });
    assert.equal(explicit.HTTP_PROXY, 'http://explicit.example.test:8000');
    assert.equal(explicit.HTTPS_PROXY, undefined);

    const fallback = buildProxySafeEnvironment({
      baseEnv: { PATH: 'C:\\Windows\\System32' },
      fallbackProxyEnv: {
        HTTP_PROXY: 'http://system.example.test:9000',
        HTTPS_PROXY: 'http://system.example.test:9000',
      },
      platform: 'win32',
    });
    assert.equal(fallback.HTTP_PROXY, 'http://system.example.test:9000');
    assert.equal(fallback.HTTPS_PROXY, 'http://system.example.test:9000');
    assert.match(fallback.NO_PROXY ?? '', /127\.0\.0\.1/);
  });

  it('re-applies the bypass at the Codex app-server process boundary', () => {
    const isolatedHome = path.join(path.sep, 'codepilot-data', 'codex-home');
    const env = buildCodexAppServerEnv({
      HTTP_PROXY: 'http://127.0.0.1:7892',
      NO_PROXY: '.corp.test',
      RUST_LOG: 'error',
      CODEX_SQLITE_HOME: path.join(path.sep, 'shared-codex-state'),
    }, 'win32', isolatedHome);

    assert.equal(env.HTTP_PROXY, 'http://127.0.0.1:7892');
    assert.equal(env.NO_PROXY, '.corp.test,127.0.0.1,localhost,::1');
    assert.equal(env.RUST_LOG, 'error');
    assert.equal(env.CODEX_HOME, isolatedHome);
    assert.equal(env.CODEX_SQLITE_HOME, isolatedHome);
  });

  it('forces the isolated SQLite home above a mirrored user config value', () => {
    const isolatedHome = path.join(path.sep, 'CodePilot Data', 'codex-home');
    assert.deepEqual(buildCodexAppServerArgs(isolatedHome), [
      'app-server',
      '-c',
      `sqlite_home=${JSON.stringify(isolatedHome)}`,
    ]);
  });

  it('wires the shared builder into Electron packaged-server startup', () => {
    const electronMain = fs.readFileSync(
      path.resolve(process.cwd(), 'electron/main.ts'),
      'utf8',
    );
    assert.match(electronMain, /import \{ buildProxySafeEnvironment \} from '\.\.\/src\/lib\/process-proxy-env'/);
    assert.match(
      electronMain,
      /function startServer\(port: number, recoverySafeMode = false\)[\s\S]*?buildProxySafeEnvironment\(\{[\s\S]*?fallbackProxyEnv: resolvedProxyEnv/,
    );
    assert.doesNotMatch(
      electronMain,
      /!userShellEnv\.HTTP_PROXY && !userShellEnv\.HTTPS_PROXY/,
      'Windows must not decide proxy precedence from the always-empty userShellEnv alone',
    );
  });
});
