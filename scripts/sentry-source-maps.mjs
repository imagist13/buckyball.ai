import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import pkg from '../package.json' with { type: 'json' };

const root = process.cwd();
const mode = process.argv[2] || '--verify';
const release = `codepilot@${pkg.version}`;
const requiredArtifactRoots = [
  '.next/static',
  '.next/standalone/.next/server',
  'dist-electron',
];
const uploadAttempts = 3;
const uploadRetryDelayMs = process.env.SENTRY_UPLOAD_RETRY_DELAY_MS === '0' ? 0 : 2_000;
const artifactRoots = requiredArtifactRoots.filter((relative) => fs.existsSync(path.join(root, relative)));

function walkMaps(dir, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkMaps(full, output);
    else if (entry.name.endsWith('.map')) output.push(full);
  }
  return output;
}

function fail(message) {
  console.error(`[sentry-source-maps] ${message}`);
  process.exit(1);
}

if (process.env.CODEPILOT_APP_CHANNEL !== 'stable') {
  fail('CODEPILOT_APP_CHANNEL must be "stable" for source-map upload');
}
if (process.env.CODEPILOT_SOURCE_MAPS !== '1') {
  fail('CODEPILOT_SOURCE_MAPS=1 is required for official source-map builds');
}
if (process.env.GITHUB_REF_TYPE === 'tag') {
  const tagVersion = (process.env.GITHUB_REF_NAME || '').replace(/^v/, '');
  if (tagVersion !== pkg.version) fail(`tag ${tagVersion} does not match package version ${pkg.version}`);
}
if (artifactRoots.length !== requiredArtifactRoots.length) {
  fail(`missing built artifact roots: ${requiredArtifactRoots.filter((item) => !artifactRoots.includes(item)).join(', ')}`);
}

const mapsByRoot = Object.fromEntries(artifactRoots.map((relative) => [
  relative,
  walkMaps(path.join(root, relative)).filter((file) => fs.statSync(file).size > 128),
]));
for (const [relative, maps] of Object.entries(mapsByRoot)) {
  if (maps.length === 0) fail(`no non-placeholder source maps found in ${relative}`);
}
const maps = Object.values(mapsByRoot).flat();

console.log(`[sentry-source-maps] verified ${maps.length} non-placeholder maps for ${release}`);
if (mode === '--verify') process.exit(0);
if (mode !== '--upload') fail(`unknown mode: ${mode}`);

for (const name of ['SENTRY_AUTH_TOKEN', 'SENTRY_DSN', 'SENTRY_ORG', 'SENTRY_PROJECT']) {
  if (!process.env[name]) fail(`${name} is required for stable upload`);
}
try {
  const dsn = new URL(process.env.SENTRY_DSN);
  if (dsn.protocol !== 'https:' || !dsn.username || !dsn.host) throw new Error('invalid');
} catch {
  fail('SENTRY_DSN must be a valid HTTPS Sentry DSN');
}

const cli = path.join(root, 'node_modules', '@sentry', 'cli', 'bin', 'sentry-cli');
if (!fs.existsSync(cli)) fail('@sentry/cli is not installed');

const cliEnv = {
  ...process.env,
  SENTRY_RELEASE: release,
};
const common = ['--org', process.env.SENTRY_ORG, '--project', process.env.SENTRY_PROJECT, '--release', release];

// Injection must mutate the same JavaScript files that electron-builder later
// packages. The paired maps remain only in the CI workspace.
execFileSync(process.execPath, [cli, 'sourcemaps', 'inject', ...common, ...artifactRoots], {
  cwd: root,
  env: cliEnv,
  stdio: 'inherit',
});

const uploadArgs = [
  cli,
  'sourcemaps',
  'upload',
  ...common,
  '--validate',
  '--strict',
  '--wait',
];
if (process.env.SENTRY_DIST) uploadArgs.push('--dist', process.env.SENTRY_DIST);
uploadArgs.push(...artifactRoots);

for (let attempt = 1; attempt <= uploadAttempts; attempt += 1) {
  try {
    execFileSync(process.execPath, uploadArgs, {
      cwd: root,
      env: cliEnv,
      stdio: 'inherit',
    });
    break;
  } catch (error) {
    if (attempt === uploadAttempts) throw error;
    console.warn(
      `[sentry-source-maps] upload attempt ${attempt}/${uploadAttempts} failed; retrying in ${uploadRetryDelayMs}ms`,
    );
    if (uploadRetryDelayMs > 0) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, uploadRetryDelayMs);
    }
  }
}

console.log(`[sentry-source-maps] uploaded ${release}${process.env.SENTRY_DIST ? ` (${process.env.SENTRY_DIST})` : ''}`);
