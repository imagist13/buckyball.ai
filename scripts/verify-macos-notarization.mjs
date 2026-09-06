#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const releaseRoot = process.argv[2] ? path.resolve(process.argv[2]) : '';
const expectedCount = Number.parseInt(process.argv[3] || '', 10);
if (!releaseRoot || !Number.isSafeInteger(expectedCount) || expectedCount < 1) {
  throw new Error('Usage: node scripts/verify-macos-notarization.mjs <release-root> <expected-arch-count>');
}

function run(executable, args, timeout = 120_000) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8',
    timeout,
    killSignal: 'SIGKILL',
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${path.basename(executable)} failed`).trim());
  }
}

function findApps(root) {
  const apps = [];
  const pending = [{ directory: root, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || current.depth > 5) continue;
    for (const entry of fs.readdirSync(current.directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const absolute = path.join(current.directory, entry.name);
      if (entry.name === 'CodePilot.app') apps.push(absolute);
      else pending.push({ directory: absolute, depth: current.depth + 1 });
    }
  }
  return apps.sort();
}

const apps = findApps(releaseRoot);
const dmgs = fs.readdirSync(releaseRoot).filter((name) => name.endsWith('.dmg')).sort();
const zips = fs.readdirSync(releaseRoot).filter((name) => name.endsWith('.zip')).sort();
if (apps.length !== expectedCount || dmgs.length !== expectedCount || zips.length !== expectedCount) {
  throw new Error(`Expected ${expectedCount} app/DMG/ZIP artifacts; found app=${apps.length} dmg=${dmgs.length} zip=${zips.length}`);
}

for (const appPath of apps) {
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', appPath]);
  run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', appPath]);
  run('/usr/bin/xcrun', ['stapler', 'validate', '-v', appPath]);
}
for (const name of dmgs) {
  const dmg = path.join(releaseRoot, name);
  run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=4', dmg]);
  run('/usr/bin/xcrun', ['stapler', 'validate', '-v', dmg]);
  run('/usr/sbin/spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=4', dmg]);
}
for (const name of zips) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-notarized-zip-'));
  try {
    run('/usr/bin/ditto', ['-x', '-k', path.join(releaseRoot, name), temp]);
    const extracted = findApps(temp);
    if (extracted.length !== 1) throw new Error(`ZIP ${name} must contain one CodePilot.app`);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', extracted[0]]);
    run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=4', extracted[0]]);
    run('/usr/bin/xcrun', ['stapler', 'validate', '-v', extracted[0]]);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
console.log(`macOS notarization/stapling/Gatekeeper OK: ${expectedCount} architecture(s)`);
