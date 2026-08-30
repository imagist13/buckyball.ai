#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HARNESS_HOME_PREFIX = 'src/lib/harness-home';
const CANONICAL_EXCLUDED_ROOT_FILES = new Set([
  // Product composition roots are intentionally allowed to bind the neutral
  // domain to runtime and secret-store integrations.
  'index.ts',
  'codepilot-secret-store.ts',
]);
const CANONICAL_EXCLUDED_DIRECTORIES = new Set([
  'adapters',
  'runtime',
]);
const FRAMEWORK_IDENTITY =
  /\b(?:claude|codex|codepilot)(?:[-_.][a-z0-9]+)*\b/i;
const RUNTIME_SPECIFIC_IMPORT =
  /\bfrom\s+['"][^'"]*(?:\/(?:adapters|runtime|codex|claude)(?:\/[^'"]*)?|codepilot-secret-store)['"]/i;

function walkTypeScriptFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTypeScriptFiles(target));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(target);
    }
  }
  return files;
}

export function canonicalHarnessFiles(projectDir = process.cwd()) {
  const root = path.resolve(projectDir, HARNESS_HOME_PREFIX);
  return walkTypeScriptFiles(root).filter((file) => {
    const relative = path.relative(root, file).split(path.sep);
    if (relative.length === 1 && CANONICAL_EXCLUDED_ROOT_FILES.has(relative[0])) {
      return false;
    }
    return !CANONICAL_EXCLUDED_DIRECTORIES.has(relative[0]);
  });
}

export function checkCanonicalNeutrality(projectDir = process.cwd()) {
  const root = path.resolve(projectDir);
  const violations = [];
  for (const file of canonicalHarnessFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const [label, expression] of [
      ['runtime-specific import', RUNTIME_SPECIFIC_IMPORT],
      ['framework identity in canonical source', FRAMEWORK_IDENTITY],
    ]) {
      const match = source.match(expression);
      if (!match || match.index === undefined) continue;
      const line = source.slice(0, match.index).split('\n').length;
      violations.push({
        file: path.relative(root, file).split(path.sep).join('/'),
        line,
        label,
        match: match[0],
      });
    }
  }
  return violations;
}

function valuesFor(flag) {
  const values = [];
  for (let index = 0; index < process.argv.length; index++) {
    if (process.argv[index] === flag && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
}

function runCanonicalCheck() {
  const violations = checkCanonicalNeutrality();
  if (violations.length > 0) {
    console.error(
      'Harness canonical neutrality failed:\n'
      + violations.map((violation) => (
        `  - ${violation.file}:${violation.line} `
        + `${violation.label}: ${JSON.stringify(violation.match)}`
      )).join('\n'),
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    '[harness-adapter-boundary] ok — canonical Harness Home is '
    + `framework-neutral across ${canonicalHarnessFiles().length} file(s).`,
  );
}

function runChangedAdapterCheck() {
  const base = valuesFor('--base')[0];
  const adapterId = valuesFor('--adapter-id')[0];
  const explicitAllow = valuesFor('--allow');

  if (!base || !adapterId) {
    console.error(
      'Usage: node scripts/check-harness-adapter-boundary.mjs '
      + '--base <explicit-commit> --adapter-id <id> [--allow <path>]...\n'
      + '   or: node scripts/check-harness-adapter-boundary.mjs '
      + '--check-canonical',
    );
    process.exitCode = 2;
    return;
  }
  if (!/^[A-Za-z0-9._-]+$/.test(adapterId)) {
    console.error(`Invalid adapter id: ${adapterId}`);
    process.exitCode = 2;
    return;
  }

  try {
    execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], {
      stdio: 'ignore',
    });
  } catch {
    console.error(`Base commit is not resolvable: ${base}`);
    process.exitCode = 2;
    return;
  }

  const changed = execFileSync(
    'git',
    ['diff', '--name-only', `${base}...HEAD`],
    { encoding: 'utf8' },
  )
    .split(/\r?\n/)
    .filter(Boolean);

  const adapterPrefix = path.posix.join(
    HARNESS_HOME_PREFIX,
    'adapters',
    adapterId,
  ) + '/';
  const fixedAllow = new Set([
    `${HARNESS_HOME_PREFIX}/adapters/registry.ts`,
    'src/__tests__/unit/harness-home-adapter-conformance.test.ts',
    ...explicitAllow,
  ]);
  const violations = changed.filter((file) =>
    !file.startsWith(adapterPrefix) && !fixedAllow.has(file));

  if (violations.length > 0) {
    console.error(
      `Harness adapter boundary failed for "${adapterId}" from ${base}:\n`
      + violations.map((file) => `  - ${file}`).join('\n'),
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[harness-adapter-boundary] ok — ${adapterId}; `
    + `${changed.length} changed file(s), explicit base ${base}`,
  );
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  if (process.argv.includes('--check-canonical')) {
    runCanonicalCheck();
  } else {
    runChangedAdapterCheck();
  }
}
