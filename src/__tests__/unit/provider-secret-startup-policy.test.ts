import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  shouldSkipProviderSecretForIsolatedSmoke,
} from '../../../electron/provider-secret-startup-policy';

describe('provider-secret startup policy', () => {
  const tempDir = fs.realpathSync.native(os.tmpdir());
  const isolatedRoot = fs.mkdtempSync(path.join(tempDir, 'codepilot-packaged-recovery-test-'));
  const isolatedUserData = path.join(isolatedRoot, 'user-data');
  const unrelatedRoot = fs.mkdtempSync(path.join(tempDir, 'codepilot-unrelated-test-'));
  const unrelatedUserData = path.join(unrelatedRoot, 'user-data');
  fs.mkdirSync(isolatedUserData);
  fs.mkdirSync(unrelatedUserData);

  after(() => {
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
    fs.rmSync(unrelatedRoot, { recursive: true, force: true });
  });

  it('skips Safe Storage only for an exact packaged isolated-smoke contract', () => {
    assert.equal(shouldSkipProviderSecretForIsolatedSmoke({
      flag: '1',
      isPackaged: true,
      userDataDir: isolatedUserData,
      tempDir,
    }), true);
  });

  it('does not let the environment flag bypass Safe Storage for real user data', () => {
    assert.equal(shouldSkipProviderSecretForIsolatedSmoke({
      flag: '1',
      isPackaged: true,
      userDataDir: unrelatedUserData,
      tempDir,
    }), false);
    assert.equal(shouldSkipProviderSecretForIsolatedSmoke({
      flag: '1',
      isPackaged: true,
      userDataDir: path.join(tempDir, 'missing', 'user-data'),
      tempDir,
    }), false);
  });

  it('rejects dev mode, near-miss flags, and temp-root traversal', () => {
    assert.equal(shouldSkipProviderSecretForIsolatedSmoke({
      flag: 'true',
      isPackaged: true,
      userDataDir: isolatedUserData,
      tempDir,
    }), false);
    assert.equal(shouldSkipProviderSecretForIsolatedSmoke({
      flag: '1',
      isPackaged: false,
      userDataDir: isolatedUserData,
      tempDir,
    }), false);
    const symlinkPath = path.join(isolatedRoot, 'linked-user-data');
    fs.symlinkSync(unrelatedUserData, symlinkPath, 'dir');
    assert.equal(shouldSkipProviderSecretForIsolatedSmoke({
      flag: '1',
      isPackaged: true,
      userDataDir: symlinkPath,
      tempDir,
    }), false);
  });
});
