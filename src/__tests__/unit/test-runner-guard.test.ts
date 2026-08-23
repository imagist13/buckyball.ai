import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('canonical Node test runner fails closed on zero matches', () => {
  const runner = fs.readFileSync(path.join(repoRoot, 'scripts/run-node-tests.mjs'), 'utf8');
  const zeroGuard = runner.indexOf('if (testFiles.length === 0)');
  const spawn = runner.indexOf('spawnSync(process.execPath');
  assert.ok(zeroGuard >= 0);
  assert.ok(zeroGuard < spawn, 'zero-match guard must run before Node test discovery starts');
  assert.match(runner.slice(zeroGuard, spawn), /process\.exit\(1\)/);
});

test('pre-commit uses the same cross-platform runner as package scripts', () => {
  const hook = fs.readFileSync(path.join(repoRoot, '.husky/pre-commit'), 'utf8');
  const lint = fs.readFileSync(path.join(repoRoot, 'scripts/lint-hooks.mjs'), 'utf8');
  assert.match(hook, /CODEX_DISABLED=1 node scripts\/run-node-tests\.mjs unit/);
  assert.doesNotMatch(hook, /npx tsx --test/);
  assert.match(lint, /run-node-tests\.mjs unit/);
});
