import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../../..');
const { resolveMacosSigningMode } = require('../../../scripts/macos-signing-policy.cjs') as {
  resolveMacosSigningMode(input: {
    signatureOutput: string;
    requireDeveloperId: boolean;
    allowAdhoc: boolean;
    expectedTeamId: string;
  }): { mode: 'developer_id' | 'adhoc'; teamId: string | null };
};

const DEVELOPER_ID_SIGNATURE = [
  'Authority=Developer ID Application: CodePilot Team (TEAM123456)',
  'TeamIdentifier=TEAM123456',
].join('\n');

describe('macOS signing policy', () => {
  it('accepts only the configured Developer ID Team for distributable packages', () => {
    assert.deepEqual(resolveMacosSigningMode({
      signatureOutput: DEVELOPER_ID_SIGNATURE,
      requireDeveloperId: true,
      allowAdhoc: false,
      expectedTeamId: 'TEAM123456',
    }), { mode: 'developer_id', teamId: 'TEAM123456' });

    assert.throws(() => resolveMacosSigningMode({
      signatureOutput: DEVELOPER_ID_SIGNATURE,
      requireDeveloperId: true,
      allowAdhoc: false,
      expectedTeamId: 'OTHERTEAM1',
    }), /TeamIdentifier mismatch/);
  });

  it('fails closed when a distributable package is unsigned or ad-hoc', () => {
    assert.throws(() => resolveMacosSigningMode({
      signatureOutput: 'Signature=adhoc\nTeamIdentifier=not set',
      requireDeveloperId: true,
      allowAdhoc: true,
      expectedTeamId: 'TEAM123456',
    }), /Developer ID Application signature required/);
  });

  it('permits ad-hoc signing only through the explicit isolated-local flag', () => {
    assert.throws(() => resolveMacosSigningMode({
      signatureOutput: '',
      requireDeveloperId: false,
      allowAdhoc: false,
      expectedTeamId: '',
    }), /CODEPILOT_ALLOW_ADHOC_SIGNING=1/);

    assert.deepEqual(resolveMacosSigningMode({
      signatureOutput: '',
      requireDeveloperId: false,
      allowAdhoc: true,
      expectedTeamId: '',
    }), { mode: 'adhoc', teamId: null });
  });

  it('wires stable and preview macOS workflows to certificate secrets and a post-package gate', () => {
    for (const relative of [
      '.github/workflows/build.yml',
      '.github/workflows/preview-build.yml',
      '.github/workflows/preview-release.yml',
    ]) {
      const workflow = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
      assert.match(workflow, /CSC_LINK:\s*\$\{\{ secrets\.MAC_CERT_P12_BASE64 \}\}/);
      assert.match(workflow, /CSC_KEY_PASSWORD:\s*\$\{\{ secrets\.MAC_CERT_PASSWORD \}\}/);
      assert.match(workflow, /CODEPILOT_APPLE_TEAM_ID:\s*\$\{\{ secrets\.APPLE_TEAM_ID \}\}/);
      assert.match(workflow, /CODEPILOT_REQUIRE_DEVELOPER_ID:\s*["']1["']/);
      assert.match(workflow, /verify-macos-developer-id\.mjs release/);

      const certificateBackedSteps = workflow
        .split(/\n(?=\s+- name:)/)
        .filter((step) => /CSC_LINK:\s*\$\{\{ secrets\.MAC_CERT_P12_BASE64 \}\}/.test(step));
      assert.ok(certificateBackedSteps.length > 0, `${relative} must package with CSC_LINK`);
      for (const step of certificateBackedSteps) {
        assert.doesNotMatch(
          step,
          /CSC_IDENTITY_AUTO_DISCOVERY:\s*["']false["']/,
          `${relative} must allow electron-builder to select the imported Developer ID identity`,
        );
      }
    }
  });

  it('keeps afterSign and the final artifact verifier on the shared fail-closed policy', () => {
    const afterSign = fs.readFileSync(path.join(repoRoot, 'scripts/after-sign.js'), 'utf8');
    const finalVerifier = fs.readFileSync(
      path.join(repoRoot, 'scripts/verify-macos-developer-id.mjs'),
      'utf8',
    );
    assert.match(afterSign, /resolveMacosSigningMode\(\{/);
    assert.match(afterSign, /CODEPILOT_REQUIRE_DEVELOPER_ID === '1'/);
    assert.match(afterSign, /CODEPILOT_ALLOW_ADHOC_SIGNING === '1'/);
    assert.doesNotMatch(afterSign, /Signature verification FAILED/);
    assert.match(finalVerifier, /requireDeveloperId:\s*true/);
    assert.match(finalVerifier, /allowAdhoc:\s*false/);
    assert.match(finalVerifier, /--verify', '--deep', '--strict/);
    assert.match(finalVerifier, /CODESIGN_INSPECT_TIMEOUT_MS\s*=\s*15_000/);
    assert.match(finalVerifier, /CODESIGN_VERIFY_TIMEOUT_MS\s*=\s*60_000/);
    assert.match(finalVerifier, /spawnSync\('\/usr\/bin\/codesign',[\s\S]*?timeout,[\s\S]*?killSignal:\s*'SIGKILL'/);
    assert.match(finalVerifier, /result\.error\?\.code === 'ETIMEDOUT'/);
    assert.match(
      finalVerifier,
      /\['-d', '--verbose=4', appPath\],[\s\S]*?CODESIGN_INSPECT_TIMEOUT_MS/,
    );
    assert.match(
      finalVerifier,
      /\['--verify', '--deep', '--strict', '--verbose=4', appPath\],[\s\S]*?CODESIGN_VERIFY_TIMEOUT_MS/,
    );
  });
});
