import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyCliInstallPath, pathIsInside } from '../../lib/cli-install-channel';

describe('CLI install channel path evidence', () => {
  it('recognizes Windows npm cmd shims without pretending realpath traversed them', () => {
    assert.deepEqual(classifyCliInstallPath({
      provider: 'claude',
      binaryPath: 'C:\\Users\\Test User\\AppData\\Roaming\\npm\\claude.cmd',
      realPath: 'C:\\Users\\Test User\\AppData\\Roaming\\npm\\claude.cmd',
      platform: 'win32',
      homeDir: 'C:\\Users\\Test User',
    }), { channel: 'npm', confidence: 'ambiguous' });
  });

  it('keeps the overlapping Windows Claude native and WinGet layout ambiguous', () => {
    assert.deepEqual(classifyCliInstallPath({
      provider: 'claude',
      binaryPath: 'C:\\Users\\alice\\.local\\bin\\claude.exe',
      realPath: 'C:\\Users\\alice\\.local\\bin\\claude.exe',
      platform: 'win32',
      homeDir: 'C:\\Users\\alice',
    }), { channel: 'unknown', confidence: 'ambiguous' });
  });

  it('only treats paths inside the exact platform root as owned', () => {
    assert.equal(pathIsInside('C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js', 'C:\\npm\\node_modules\\@openai\\codex', 'win32'), true);
    assert.equal(pathIsInside('C:\\other\\node_modules\\@openai\\codex\\bin\\codex.js', 'C:\\npm\\node_modules\\@openai\\codex', 'win32'), false);
    assert.equal(pathIsInside('/opt/homebrew/Caskroom/codex/1/bin/codex', '/opt/homebrew/Caskroom/codex', 'darwin'), true);
    assert.equal(pathIsInside('/usr/local/bin/codex', '/opt/homebrew/Caskroom/codex', 'darwin'), false);
  });
});
