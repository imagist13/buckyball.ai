import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'node:url';

const TEST_ROOT = path.join(os.tmpdir(), `codepilot-working-dir-${Date.now()}`);
const VALID_DIR = path.join(TEST_ROOT, 'valid-project');
const HOME_DIR = path.join(TEST_ROOT, 'fake-home');
const UNICODE_DIR = path.join(TEST_ROOT, '中文 游戏 (测试)&资料');

describe('working-directory helpers', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;
  let helpers: typeof import('../../lib/working-directory');

  before(async () => {
    fs.mkdirSync(VALID_DIR, { recursive: true });
    fs.mkdirSync(HOME_DIR, { recursive: true });
    fs.mkdirSync(UNICODE_DIR, { recursive: true });
    process.env.HOME = HOME_DIR;
    process.env.USERPROFILE = HOME_DIR;
    helpers = await import(pathToFileURL(
      path.resolve(__dirname, '../../lib/working-directory.ts'),
    ).href);
  });

  after(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it('accepts an existing directory', () => {
    assert.equal(helpers.isExistingDirectory(VALID_DIR), true);
  });

  it('accepts Unicode, spaces, parentheses and ampersands in a directory', () => {
    assert.equal(helpers.isExistingDirectory(UNICODE_DIR), true);
    assert.equal(helpers.resolveWorkingDirectory([
      { path: UNICODE_DIR, source: 'requested' },
    ]).path, UNICODE_DIR);
  });

  it('rejects a missing directory', () => {
    assert.equal(helpers.isExistingDirectory(path.join(TEST_ROOT, 'missing')), false);
  });

  it('picks the first valid candidate after skipping invalid ones', () => {
    const resolved = helpers.resolveWorkingDirectory([
      { path: path.join(TEST_ROOT, 'missing-a'), source: 'requested' },
      { path: VALID_DIR, source: 'binding' },
    ]);

    assert.equal(resolved.path, VALID_DIR);
    assert.equal(resolved.source, 'binding');
    assert.deepEqual(resolved.invalidCandidates.map(({ path, source }) => ({ path, source })), [
      { path: path.join(TEST_ROOT, 'missing-a'), source: 'requested' },
    ]);
    assert.equal(resolved.invalidCandidates[0]?.identity?.kind, 'missing');
  });

  it('falls back to HOME when no candidates are valid', () => {
    const resolved = helpers.resolveWorkingDirectory([
      { path: path.join(TEST_ROOT, 'missing-a'), source: 'requested' },
      { path: path.join(TEST_ROOT, 'missing-b'), source: 'setting' },
    ]);

    assert.equal(resolved.path, HOME_DIR);
    assert.equal(resolved.source, 'home');
    assert.deepEqual(resolved.invalidCandidates.map(({ path, source }) => ({ path, source })), [
      { path: path.join(TEST_ROOT, 'missing-a'), source: 'requested' },
      { path: path.join(TEST_ROOT, 'missing-b'), source: 'setting' },
    ]);
    assert.deepEqual(resolved.invalidCandidates.map(candidate => candidate.identity?.kind), [
      'missing',
      'missing',
    ]);
  });
});
