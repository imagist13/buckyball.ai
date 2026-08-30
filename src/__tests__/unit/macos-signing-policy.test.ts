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
    const builder = fs.readFileSync(path.join(repoRoot, 'electron-builder.yml'), 'utf8');
    assert.match(builder, /dmg:[\s\S]*?sign:\s*true[\s\S]*?writeUpdateInfo:\s*false/);

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
      assert.match(workflow, /APPLE_NOTARIZATION_KEY_BASE64/);
      assert.match(workflow, /APPLE_API_KEY_ID/);
      assert.match(workflow, /APPLE_API_ISSUER/);
      assert.match(workflow, /notarize-macos-dmgs\.mjs release/);
      assert.match(workflow, /verify-macos-notarization\.mjs release/);

      const notarizationStep = workflow
        .split(/\n(?=\s+- name:)/)
        .find((step) => /notarize-macos-dmgs\.mjs release/.test(step));
      assert.ok(notarizationStep, `${relative} must include the final DMG notarization step`);
      assert.match(
        notarizationStep,
        /CODEPILOT_APPLE_TEAM_ID:\s*\$\{\{ secrets\.APPLE_TEAM_ID \}\}/,
        `${relative} must pass the expected Team ID to the DMG notarization precheck`,
      );

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

    const dmgNotarizer = fs.readFileSync(
      path.join(repoRoot, 'scripts/notarize-macos-dmgs.mjs'),
      'utf8',
    );
    const notarizationVerifier = fs.readFileSync(
      path.join(repoRoot, 'scripts/verify-macos-notarization.mjs'),
      'utf8',
    );
    assert.match(dmgNotarizer, /resolveMacosSigningMode\(\{[\s\S]*?requireDeveloperId:\s*true/);
    assert.match(dmgNotarizer, /CODEPILOT_APPLE_TEAM_ID/);
    assert.match(dmgNotarizer, /codesign', \['--verify', '--strict', '--verbose=4', dmg\]/);
    assert.match(notarizationVerifier, /codesign', \['--verify', '--strict', '--verbose=4', dmg\]/);
    assert.match(notarizationVerifier, /'--type', 'open', '--context', 'context:primary-signature'/);
    assert.doesNotMatch(notarizationVerifier, /'--type', 'install'/);
  });

  it('gives native, universal and notarization work independent bounded timeouts', () => {
    for (const relative of [
      '.github/workflows/build.yml',
      '.github/workflows/preview-build.yml',
      '.github/workflows/preview-release.yml',
    ]) {
      const workflow = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
      assert.match(workflow, /name: Package native macOS[\s\S]{0,180}timeout-minutes: 45/);
      assert.match(workflow, /name: Package universal macOS[\s\S]{0,180}timeout-minutes: 45/);
      assert.match(workflow, /name: Notarize and staple[\s\S]{0,100}timeout-minutes: 45/);
    }
  });
});
