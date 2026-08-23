import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  detectPathDialect,
  resolvePathIdentity,
  samePathIdentity,
} from '../../lib/path-identity';
import { resolveWorkingDirectory } from '../../lib/working-directory';
import { validateWorkingDirectory } from '../../lib/bridge/security/validators';

test('detectPathDialect distinguishes drive, UNC, WSL, file URL and POSIX paths', () => {
  assert.equal(detectPathDialect('C:\\项目\\game'), 'windows_drive');
  assert.equal(detectPathDialect('\\\\server\\share\\项目'), 'unc');
  assert.equal(detectPathDialect('\\\\wsl.localhost\\Ubuntu\\home\\me'), 'wsl');
  assert.equal(detectPathDialect('/mnt/c/项目', 'linux'), 'posix');
  assert.equal(detectPathDialect('/mnt/c/项目', 'linux', true), 'wsl');
  assert.equal(detectPathDialect('/mnt/c/项目', 'darwin'), 'posix');
  assert.equal(detectPathDialect('//server/share/项目', 'win32'), 'unc');
  assert.equal(detectPathDialect('//server/share/项目', 'darwin'), 'posix');
  assert.equal(detectPathDialect('file:///C:/Users/me/project'), 'file_url');
  assert.equal(detectPathDialect('/Users/me/project'), 'posix');
  assert.equal(detectPathDialect('relative/project'), 'relative');
});

test('Windows comparison keys normalize separators and case without changing display paths', () => {
  const upper = resolvePathIdentity('C:\\Users\\ME\\项目', { platform: 'win32' });
  const lower = resolvePathIdentity('c:/users/me/项目', { platform: 'win32' });
  assert.equal(upper.displayPath, 'C:\\Users\\ME\\项目');
  assert.equal(lower.displayPath, 'c:/users/me/项目');
  assert.equal(samePathIdentity(upper, lower), true);
  assert.equal(upper.exists, false, 'cross-platform fixture must not pretend the host object exists');
});

test('Windows file URLs and UNC paths preserve their native volumes', () => {
  const drive = resolvePathIdentity('file:///C:/Users/me/Project%20A', { platform: 'win32' });
  assert.equal(drive.absolutePath, 'C:\\Users\\me\\Project A');
  assert.equal(drive.volume, 'C:\\');

  const unc = resolvePathIdentity('\\\\server\\share\\项目', { platform: 'win32' });
  assert.equal(unc.volume.toLocaleLowerCase('en-US'), '\\\\server\\share\\');
});

test('Windows resolves WSL drive mounts to the matching native drive identity', () => {
  const wsl = resolvePathIdentity('/mnt/c/Users/me/中文 项目', { platform: 'win32' });
  const native = resolvePathIdentity('C:\\Users\\me\\中文 项目', { platform: 'win32' });
  assert.equal(wsl.absolutePath, 'C:\\Users\\me\\中文 项目');
  assert.equal(wsl.volume, 'C:\\');
  assert.equal(samePathIdentity(wsl, native), true);
});

test('macOS keeps /mnt drive-like paths and double-slash roots in the POSIX dialect', () => {
  const mountLike = resolvePathIdentity('/mnt/c/Users/me/project', { platform: 'darwin' });
  assert.equal(mountLike.dialect, 'posix');
  assert.equal(mountLike.absolutePath, '/mnt/c/Users/me/project');

  const doubleSlash = resolvePathIdentity('//var/folders/project', { platform: 'darwin' });
  assert.equal(doubleSlash.dialect, 'posix');
  assert.equal(doubleSlash.absolutePath, '/var/folders/project');
});

test('double-slash POSIX working directories do not fall back to HOME', {
  skip: process.platform === 'win32',
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-double-slash-'));
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  const doubleSlashProject = `/${project}`;
  try {
    const result = resolveWorkingDirectory([{ path: doubleSlashProject, source: 'requested' }]);
    assert.equal(result.source, 'requested');
    assert.equal(result.identity.dialect, 'posix');
    assert.equal(result.identity.kind, 'directory');
    assert.equal(result.identity.nativeRealPath, fs.realpathSync.native(project));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('working-directory resolution preserves Unicode, spaces and legal shell characters as filesystem input', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-path-identity-'));
  const project = path.join(root, '中文 项目 & data');
  fs.mkdirSync(project);
  try {
    const result = resolveWorkingDirectory([{ path: project, source: 'requested' }]);
    assert.equal(result.source, 'requested');
    assert.equal(result.identity.kind, 'directory');
    assert.equal(result.identity.nativeRealPath, fs.realpathSync.native(project));
    assert.equal(validateWorkingDirectory(project), path.resolve(project));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('working-directory resolution records invalid identity before falling back', () => {
  const missing = path.join(os.tmpdir(), 'codepilot-does-not-exist', '中文');
  const result = resolveWorkingDirectory([{ path: missing, source: 'requested' }]);
  assert.notEqual(result.source, 'requested');
  assert.equal(result.invalidCandidates[0]?.path, missing);
  assert.equal(result.invalidCandidates[0]?.identity?.kind, 'missing');
});
