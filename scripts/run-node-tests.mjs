import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];
const forwarded = process.argv.slice(3);

const configurations = {
  unit: {
    directory: path.join(repositoryRoot, 'src', '__tests__', 'unit'),
    suffix: '.test.ts',
    env: { CODEX_DISABLED: '1' },
    setup: './src/__tests__/db-isolation.setup.ts',
  },
  'sdk-poc': {
    directory: path.join(repositoryRoot, 'src', '__tests__', 'integration'),
    suffix: '-poc.test.ts',
    env: { CLAUDE_SDK_POC: '1' },
  },
};

const configuration = configurations[mode];
if (!configuration) {
  console.error('Usage: node scripts/run-node-tests.mjs unit|sdk-poc [node:test options]');
  process.exit(2);
}

const testFiles = fs.readdirSync(configuration.directory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(configuration.suffix))
  .map((entry) => path.join(configuration.directory, entry.name))
  .sort((a, b) => a.localeCompare(b));

if (testFiles.length === 0) {
  console.error(
    `No test files matched ${configuration.suffix} in ${configuration.directory}; refusing Node default discovery.`,
  );
  process.exit(1);
}

const args = [];
if (process.platform === 'win32') {
  args.push('--require', './scripts/node-user-info-compat.cjs');
}
args.push('--import', 'tsx', '--test');
if (configuration.setup) args.push('--import', configuration.setup);
// Node's default test concurrency follows the host CPU count. On Windows a
// large suite (currently 370+ files) can otherwise exhaust process/user-info
// resources and produce unrelated ENOMEM, cancelled hooks, and flaky global
// telemetry assertions. Keep a small amount of parallelism, while respecting
// an explicit caller override.
if (
  process.platform === 'win32'
  && !forwarded.some((arg) => arg.startsWith('--test-concurrency'))
) {
  args.push('--test-concurrency=4');
}
args.push(...forwarded, ...testFiles);

const result = spawnSync(process.execPath, args, {
  cwd: repositoryRoot,
  env: { ...process.env, ...configuration.env },
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
