#!/usr/bin/env node

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { resolveMacosSigningMode } = require('./macos-signing-policy.cjs');

const releaseRoot = process.argv[2] ? path.resolve(process.argv[2]) : '';
const expectedCount = Number.parseInt(process.argv[3] || '', 10);
const keyPath = process.env.APPLE_API_KEY || '';
const keyId = process.env.APPLE_API_KEY_ID || '';
const issuer = process.env.APPLE_API_ISSUER || '';
const expectedTeamId = process.env.CODEPILOT_APPLE_TEAM_ID || '';
if (!releaseRoot || !Number.isSafeInteger(expectedCount) || expectedCount < 1) {
  throw new Error('Usage: node scripts/notarize-macos-dmgs.mjs <release-root> <expected-count>');
}
if (!keyPath || !keyId || !issuer) {
  throw new Error('Apple notarization API key environment is incomplete');
}
if (!expectedTeamId) {
  throw new Error('CODEPILOT_APPLE_TEAM_ID is required to notarize DMGs');
}

function run(executable, args, timeout) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    timeout,
    killSignal: 'SIGKILL',
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${path.basename(executable)} failed`).trim());
  }
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

const dmgs = fs.readdirSync(releaseRoot)
  .filter((name) => /^CodePilot-.*\.dmg$/.test(name))
  .map((name) => path.join(releaseRoot, name))
  .sort();
if (dmgs.length !== expectedCount) {
  throw new Error(`Expected ${expectedCount} DMG files, found ${dmgs.length}`);
}

for (const dmg of dmgs) {
  run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=4', dmg], 60_000);
  const signatureOutput = run('/usr/bin/codesign', ['-d', '--verbose=4', dmg], 15_000);
  resolveMacosSigningMode({
    signatureOutput,
    requireDeveloperId: true,
    allowAdhoc: false,
    expectedTeamId,
  });
  console.log(`Developer ID DMG signature OK: ${path.basename(dmg)}`);

  run('/usr/bin/xcrun', [
    'notarytool', 'submit', dmg,
    '--key', keyPath,
    '--key-id', keyId,
    '--issuer', issuer,
    '--wait',
  ], 20 * 60 * 1000);
  run('/usr/bin/xcrun', ['stapler', 'staple', '-v', dmg], 2 * 60 * 1000);
  console.log(`Notarized and stapled DMG: ${path.basename(dmg)}`);
}
