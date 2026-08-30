import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  buildCanonicalWorkspaceIdentity,
  publicWorkspaceIdentity,
  resolveCanonicalWorkspaceIdentity,
} from '@/lib/workspace-identity';

const gitFixtureEnv: NodeJS.ProcessEnv = { ...process.env };
for (const key of Object.keys(gitFixtureEnv)) {
  if (key.startsWith('GIT_')) delete gitFixtureEnv[key];
}

function runFixtureGit(args: string[]) {
  execFileSync('git', args, { env: gitFixtureEnv, stdio: 'ignore' });
}

describe('canonical workspace identity pure contract', () => {
  it('is versioned, deterministic and scope-separated', () => {
    const first = buildCanonicalWorkspaceIdentity('directory', '/repo');
    const second = buildCanonicalWorkspaceIdentity('directory', '/repo');
    const repository = buildCanonicalWorkspaceIdentity('git-repository', '/repo');
    assert.equal(first.id, second.id);
    assert.notEqual(first.id, repository.id);
    assert.equal(first.version, 1);
  });

  it('keeps the comparison key server-only at the public boundary', () => {
    const identity = buildCanonicalWorkspaceIdentity('directory', '/secret/absolute/path');
    const publicValue = publicWorkspaceIdentity(identity);
    assert.deepEqual(Object.keys(publicValue).sort(), ['id', 'scope', 'version']);
    assert.doesNotMatch(JSON.stringify(publicValue), /secret|absolute|path/);
  });

  it('falls back to a verified directory when git is missing/timed out', () => {
    const identity = resolveCanonicalWorkspaceIdentity(process.cwd(), {
      probeGitCommonDir: () => null,
    });
    assert.equal(identity.scope, 'directory');
  });
});

describe('canonical workspace identity against real git common dirs', () => {
  let root = '';
  let repo = '';
  let worktree = '';
  let clone = '';
  let plain = '';

  before(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-workspace-identity-'));
    repo = path.join(root, 'repo');
    worktree = path.join(root, 'worktree');
    clone = path.join(root, 'clone');
    plain = path.join(root, 'plain');
    fs.mkdirSync(repo);
    fs.mkdirSync(plain);
    runFixtureGit(['init', repo]);
    runFixtureGit(['-C', repo, 'config', 'user.email', 'test@example.com']);
    runFixtureGit(['-C', repo, 'config', 'user.name', 'CodePilot Test']);
    fs.writeFileSync(path.join(repo, 'README.md'), 'test');
    runFixtureGit(['-C', repo, 'add', 'README.md']);
    runFixtureGit(['-C', repo, 'commit', '-m', 'init']);
    runFixtureGit(['-C', repo, 'worktree', 'add', worktree, '-b', 'linked']);
    runFixtureGit(['clone', repo, clone]);
  });

  after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('shares project identity across linked worktrees', () => {
    assert.equal(
      resolveCanonicalWorkspaceIdentity(repo).id,
      resolveCanonicalWorkspaceIdentity(worktree).id,
    );
  });

  it('does not merge an independent clone by remote URL', () => {
    assert.notEqual(
      resolveCanonicalWorkspaceIdentity(repo).id,
      resolveCanonicalWorkspaceIdentity(clone).id,
    );
  });

  it('ignores repository-routing GIT_* variables inherited from a parent process', () => {
    const previousGitDir = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(repo, '.git');
    try {
      assert.notEqual(
        resolveCanonicalWorkspaceIdentity(repo).id,
        resolveCanonicalWorkspaceIdentity(clone).id,
      );
    } finally {
      if (previousGitDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previousGitDir;
    }
  });

  it('keeps non-git folders in directory scope', () => {
    assert.equal(resolveCanonicalWorkspaceIdentity(plain).scope, 'directory');
  });

  it('normalizes symlink and trailing slash spellings', () => {
    const link = path.join(root, 'repo-link');
    fs.symlinkSync(repo, link, 'dir');
    assert.equal(
      resolveCanonicalWorkspaceIdentity(`${link}${path.sep}`).id,
      resolveCanonicalWorkspaceIdentity(repo).id,
    );
  });
});
