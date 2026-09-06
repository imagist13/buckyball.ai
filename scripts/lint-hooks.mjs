import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK_PATH = process.env.LINT_HOOKS_PATH || path.join(REPO_ROOT, '.husky', 'pre-commit');

// Test-runner command fragments that must carry the CODEX_DISABLED=1 guard.
// Extend this list if the project's test runner changes (e.g. vitest, jest).
const TEST_RUNNER_HINTS = ['run-node-tests.mjs unit', 'tsx --test', 'vitest', 'jest'];

function fail(message) {
  console.error('\n[lint:hooks] FAILED — pre-commit hook is missing required guards:\n');
  console.error('  - ' + message);
  console.error(
    '\nFix: edit .husky/pre-commit so the test-runner command line carries `CODEX_DISABLED=1` (the value in comments alone does not count).\n',
  );
  process.exit(1);
}

if (!fs.existsSync(HOOK_PATH)) {
  fail(`.husky/pre-commit not found at ${HOOK_PATH}`);
}

const hook = fs.readFileSync(HOOK_PATH, 'utf8');

// Codex review P2 (2026-05-19): the previous version was a whole-file grep for
// the literal "CODEX_DISABLED=1". It passed even if the token survived only in
// a comment while the actual test command-line had been edited to drop the env
// var. We now require the guard to sit on a real executable line next to a
// recognised test runner.
const executableLines = hook
  .split('\n')
  .filter((line) => {
    const trimmed = line.trimStart();
    return trimmed.length > 0 && !trimmed.startsWith('#');
  });

const hasGuardedTestLine = executableLines.some(
  (line) =>
    line.includes('CODEX_DISABLED=1') &&
    TEST_RUNNER_HINTS.some((hint) => line.includes(hint)),
);

if (!hasGuardedTestLine) {
  fail(
    `No executable line in .husky/pre-commit has 'CODEX_DISABLED=1' alongside a known test runner (${TEST_RUNNER_HINTS.join(', ')}). ` +
      'The token may exist only in comments. Without the runtime guard the hook spawns the real Codex app-server during unit tests, ' +
      'which fights for SQLite locks with the dev server. Observed in Phase 5b round-6: every commit wedged for 30+ minutes.',
  );
}

console.log(
  '[lint:hooks] ok — .husky/pre-commit guards CODEX_DISABLED=1 on an executable test-runner line.',
);
