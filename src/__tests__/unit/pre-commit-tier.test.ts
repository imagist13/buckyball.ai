/**
 * Script-level test for the pre-commit verification tiering
 * (scripts/pre-commit-tier.mjs).
 *
 * The hook skips the ~300s tsc + unit gate ONLY when this classifier returns
 * 'docs'. So the whole safety story rests on: (a) an all-docs set is 'docs',
 * (b) anything else — mixed, code, deps, build scripts, config, empty, or an
 * unknown extension — is 'code' (fail-closed). This test pins both directions
 * so a future edit can't quietly widen the docs fast-path into a silent skip
 * (the pre-2026-05-29 "prerequisite fails, commit passes" class of bug).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
// scripts/ is excluded from tsconfig but allowJs pulls this in as a typed dep.
import { classifyCommitTier, isDocPath } from '../../../scripts/pre-commit-tier.mjs';

const gitLocalEnvVars = execFileSync('git', ['rev-parse', '--local-env-vars'], {
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .filter(Boolean);

/**
 * Git exports repository-local GIT_* variables to hooks. A nested `git init`
 * that inherits them can mutate the real repository instead of its cwd.
 */
function scrubbedGitEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const clean = { ...source };
  for (const name of [...gitLocalEnvVars, 'GIT_NAMESPACE']) {
    delete clean[name];
  }
  return clean;
}

describe('classifyCommitTier — docs fast-path', () => {
  it('all-docs set (docs/**, nested *.md, README) → docs', () => {
    assert.equal(
      classifyCommitTier([
        'docs/exec-plans/active/some-plan.md',
        'README.md',
        'a/deeply/nested/guide.md',
        'vendor/pkg/notes.md',
      ]),
      'docs',
    );
  });

  it('markdown anywhere in the tree → docs', () => {
    assert.equal(classifyCommitTier(['CLAUDE.md', 'AGENTS.md']), 'docs');
  });

  it('non-markdown assets UNDER docs/ (screenshots) still count as docs', () => {
    assert.equal(classifyCommitTier(['docs/exec-plans/screenshots/a.png']), 'docs');
  });

  it('LICENSE / NOTICE basenames → docs', () => {
    assert.equal(classifyCommitTier(['LICENSE']), 'docs');
  });
});

describe('classifyCommitTier — full-gate (fail-closed)', () => {
  it('mixed docs + product code → code', () => {
    assert.equal(classifyCommitTier(['docs/x.md', 'src/lib/db.ts']), 'code');
  });

  it('product code only → code', () => {
    assert.equal(classifyCommitTier(['src/components/chat/MessageList.tsx']), 'code');
  });

  it('dependency changes (package.json / lockfile) → code', () => {
    assert.equal(classifyCommitTier(['package.json']), 'code');
    assert.equal(classifyCommitTier(['package-lock.json']), 'code');
  });

  it('build scripts / hooks → code', () => {
    assert.equal(classifyCommitTier(['scripts/lint-hooks.mjs']), 'code');
    assert.equal(classifyCommitTier(['.husky/pre-commit']), 'code');
  });

  it('a nested build script (.mjs) → code, not docs', () => {
    assert.equal(
      classifyCommitTier(['tools/gen/build-something.mjs']),
      'code',
    );
  });

  it('config files → code', () => {
    assert.equal(classifyCommitTier(['tsconfig.json']), 'code');
  });

  it('empty staged set → code (nothing/edge is not a docs fast-path)', () => {
    assert.equal(classifyCommitTier([]), 'code');
  });

  it('unknown extension → code (fail-closed on anything not clearly docs)', () => {
    assert.equal(classifyCommitTier(['data/blob.bin']), 'code');
  });
});

describe('isDocPath — unit', () => {
  it('classifies doc extensions and docs/ prefix; rejects code/config', () => {
    for (const p of ['a.md', 'b.mdx', 'notes.txt', 'docs/anything.png', 'LICENSE', './c.md']) {
      assert.equal(isDocPath(p), true, `${p} should be doc`);
    }
    for (const p of ['src/a.ts', 'scripts/x.mjs', 'package.json', '.husky/pre-commit', 'x.bin', '']) {
      assert.equal(isDocPath(p), false, `${p} should NOT be doc`);
    }
  });
});

// End-to-end CLI test: the pure classifier is fine, but the git invocation that
// FEEDS it must include staged deletions, else `docs edit + git rm code` looks
// docs-only and skips the gate (Codex P1). This exercises the real script in a
// throwaway git repo so the --diff-filter regression can't come back silently.
describe('pre-commit-tier CLI — staged deletions must count (Codex P1)', () => {
  const SCRIPT = path.resolve(__dirname, '../../../scripts/pre-commit-tier.mjs');
  const childEnv = scrubbedGitEnv();
  const git = (cwd: string, args: string[]) =>
    execFileSync('git', args, { cwd, env: childEnv, stdio: 'pipe' });
  const commit = (cwd: string, msg: string) =>
    git(cwd, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', msg]);
  const tierIn = (cwd: string) =>
    execFileSync('node', [SCRIPT], {
      cwd,
      encoding: 'utf8',
      env: childEnv,
    }).trim();

  it('docs edit + DELETED code file → code (deletion is not invisible)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-del-'));
    try {
      git(tmp, ['init', '-q']);
      fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'src', 'foo.ts'), 'export const x = 1;\n');
      fs.writeFileSync(path.join(tmp, 'docs', 'x.md'), '# doc\n');
      git(tmp, ['add', '-A']);
      commit(tmp, 'init');
      fs.appendFileSync(path.join(tmp, 'docs', 'x.md'), 'more\n');
      git(tmp, ['add', 'docs/x.md']);
      git(tmp, ['rm', '-q', 'src/foo.ts']); // stages a deletion of a code file
      assert.equal(tierIn(tmp), 'code');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('deleted docs only → docs (deleting a doc stays on the fast path)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-del2-'));
    try {
      git(tmp, ['init', '-q']);
      fs.mkdirSync(path.join(tmp, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'docs', 'a.md'), '# a\n');
      fs.writeFileSync(path.join(tmp, 'docs', 'b.md'), '# b\n');
      git(tmp, ['add', '-A']);
      commit(tmp, 'init');
      git(tmp, ['rm', '-q', 'docs/a.md']);
      assert.equal(tierIn(tmp), 'docs');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('pre-commit-tier CLI — nested repositories must not inherit hook Git state', () => {
  it('scrubs every repository-local variable reported by Git', () => {
    const poisoned: NodeJS.ProcessEnv = { ...process.env };
    for (const name of [...gitLocalEnvVars, 'GIT_NAMESPACE']) {
      poisoned[name] = `/tmp/poison-${name}`;
    }

    const clean = scrubbedGitEnv(poisoned);
    for (const name of gitLocalEnvVars) {
      assert.equal(clean[name], undefined, `${name} must be scrubbed`);
    }
    assert.equal(clean.GIT_NAMESPACE, undefined);
  });

  it('keeps an external repository unchanged when cwd initializes another repo', () => {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-external-'));
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'tier-target-'));
    const clean = scrubbedGitEnv();
    const run = (
      cwd: string,
      args: string[],
      env: NodeJS.ProcessEnv = clean,
    ) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();

    try {
      run(external, ['init', '-q']);
      fs.writeFileSync(path.join(external, 'sentinel.txt'), 'unchanged\n');
      run(external, ['add', 'sentinel.txt']);
      run(external, [
        '-c',
        'user.email=t@t',
        '-c',
        'user.name=t',
        'commit',
        '-q',
        '-m',
        'sentinel',
      ]);
      run(external, ['config', 'core.bare', 'false']);

      const poisoned: NodeJS.ProcessEnv = {
        ...process.env,
        GIT_DIR: path.join(external, '.git'),
        GIT_WORK_TREE: external,
        GIT_INDEX_FILE: path.join(external, '.git', 'index'),
        GIT_NAMESPACE: 'must-not-leak',
      };
      run(target, ['init', '-q'], scrubbedGitEnv(poisoned));

      assert.equal(fs.existsSync(path.join(target, '.git')), true);
      assert.equal(run(external, ['config', '--bool', 'core.bare']), 'false');
      assert.equal(run(external, ['rev-list', '--count', 'HEAD']), '1');
      assert.equal(
        fs.readFileSync(path.join(external, 'sentinel.txt'), 'utf8'),
        'unchanged\n',
      );
    } finally {
      fs.rmSync(external, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  });
});
