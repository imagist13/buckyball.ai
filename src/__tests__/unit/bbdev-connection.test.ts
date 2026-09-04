/**
 * bbdev connection config — unit tests
 *
 * 覆盖：
 * - parseBbdevConnectionConfig（无效输入 → null）
 * - normalizeBbdevConnectionConfig（默认值 / 字段补齐）
 * - buildBbdevMcpServerConfig（local + remote 两种模式）
 * - serializeBbdevConnectionConfig（往返）
 * - canRunLocalBbdev（Windows 不支持）
 *
 * 不验证 db-isolation.setup 路径，因为这些函数不读写数据库。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBbdevConnectionConfig,
  normalizeBbdevConnectionConfig,
  defaultBbdevConnectionConfig,
  serializeBbdevConnectionConfig,
  buildBbdevMcpServerConfig,
  canRunLocalBbdev,
  detectDefaultRepoRoot,
  BBDEV_MCP_SERVER_NAME,
} from '../../lib/bbdev/connection';

describe('bbdev/connection — config normalization', () => {
  it('parseBbdevConnectionConfig returns null on invalid JSON', () => {
    assert.equal(parseBbdevConnectionConfig('not-json'), null);
    assert.equal(parseBbdevConnectionConfig(''), null);
    assert.equal(parseBbdevConnectionConfig(undefined), null);
  });

  it('parseBbdevConnectionConfig returns null on non-object', () => {
    assert.equal(parseBbdevConnectionConfig('"a string"'), null);
    assert.equal(parseBbdevConnectionConfig('42'), null);
  });

  it('normalizeBbdevConnectionConfig fills chipName default to "toy"', () => {
    const out = normalizeBbdevConnectionConfig({});
    assert.equal(out.chipName, 'toy');
    assert.equal(out.mode, 'local');
    assert.equal(out.autoStartLocal, true);
  });

  it('normalizeBbdevConnectionConfig trims string fields', () => {
    const out = normalizeBbdevConnectionConfig({
      repoRoot: '  /path/to/repo  ',
      chipName: '  custom  ',
      balldomain: '  bd  ',
      remoteUrl: '  https://example.com  ',
    });
    assert.equal(out.repoRoot, '/path/to/repo');
    assert.equal(out.chipName, 'custom');
    assert.equal(out.balldomain, 'bd');
    assert.equal(out.remoteUrl, 'https://example.com');
  });

  it('serialize → parse round-trip preserves fields', () => {
    const original = defaultBbdevConnectionConfig();
    original.repoRoot = '/x/y/z';
    original.chipName = 'riscv';
    original.balldomain = 'matmul';
    original.remoteUrl = 'https://bbdev.example.com';
    original.autoStartLocal = false;

    const json = serializeBbdevConnectionConfig(original);
    const parsed = parseBbdevConnectionConfig(json);

    assert.ok(parsed);
    assert.equal(parsed.repoRoot, '/x/y/z');
    assert.equal(parsed.chipName, 'riscv');
    assert.equal(parsed.balldomain, 'matmul');
    assert.equal(parsed.remoteUrl, 'https://bbdev.example.com');
    assert.equal(parsed.autoStartLocal, false);
  });
});

describe('bbdev/connection — buildBbdevMcpServerConfig', () => {
  it('returns null for remote mode without remoteUrl', () => {
    const out = buildBbdevMcpServerConfig({
      mode: 'remote',
      repoRoot: '',
      chipName: 'toy',
      autoStartLocal: true,
    });
    assert.equal(out, null);
  });

  it('returns null for local mode without valid repoRoot', () => {
    const out = buildBbdevMcpServerConfig({
      mode: 'local',
      repoRoot: '/nonexistent/path/that/should/not/exist',
      chipName: 'toy',
      autoStartLocal: true,
    });
    assert.equal(out, null);
  });

  it('builds stdio config for local mode with valid repoRoot', { skip: process.platform === 'win32' }, () => {
    // Use process.cwd() as a guaranteed-existing path; we won't actually run the script.
    const out = buildBbdevMcpServerConfig({
      mode: 'local',
      repoRoot: process.cwd(),
      chipName: 'toy',
      autoStartLocal: true,
    });
    assert.ok(out);
    assert.equal(out.type, 'stdio');
    assert.equal(out.enabled, true);
    assert.equal(out.command, 'bash');
    assert.ok(Array.isArray(out.args));
    assert.ok(out.env?.BUCKYBALL_REPO_ROOT);
  });

  it('builds sse config for remote mode', () => {
    const out = buildBbdevMcpServerConfig({
      mode: 'remote',
      repoRoot: '',
      chipName: 'toy',
      autoStartLocal: true,
      remoteUrl: 'https://bbdev.example.com/sse',
      remoteToken: 'test-token',
    });
    assert.ok(out);
    assert.equal(out.type, 'sse');
    assert.equal(out.url, 'https://bbdev.example.com/sse');
    assert.equal(out.headers?.Authorization, 'Bearer test-token');
  });

  it('remote mode without token omits Authorization header', () => {
    const out = buildBbdevMcpServerConfig({
      mode: 'remote',
      repoRoot: '',
      chipName: 'toy',
      autoStartLocal: true,
      remoteUrl: 'https://bbdev.example.com/sse',
    });
    assert.ok(out);
    assert.equal(out.type, 'sse');
    assert.equal(out.headers?.Authorization, undefined);
  });
});

describe('bbdev/connection — environment', () => {
  it('canRunLocalBbdev reports Windows unsupported', { skip: process.platform !== 'win32' }, () => {
    const r = canRunLocalBbdev();
    assert.equal(r.supported, false);
    assert.ok(r.reason);
  });

  it('canRunLocalBbdev reports POSIX supported', { skip: process.platform === 'win32' }, () => {
    const r = canRunLocalBbdev();
    assert.equal(r.supported, true);
  });

  it('BBDEV_MCP_SERVER_NAME is "bbdev"', () => {
    assert.equal(BBDEV_MCP_SERVER_NAME, 'bbdev');
  });

  it('detectDefaultRepoRoot returns string (may be empty)', () => {
    const out = detectDefaultRepoRoot();
    assert.equal(typeof out, 'string');
  });
});
