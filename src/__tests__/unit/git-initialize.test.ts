import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { getRepoRoot, initializeRepo, isGitRepo } from '@/lib/git/service';

describe('explicit Git initialization', () => {
  it('initializes only the supplied existing directory and is idempotent', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'codepilot-git-init-'));
    try {
      assert.equal(await isGitRepo(workspace), false);
      const firstRoot = await initializeRepo(workspace);
      assert.equal(await isGitRepo(workspace), true);
      assert.equal(firstRoot, await getRepoRoot(workspace));
      assert.equal(await initializeRepo(workspace), firstRoot);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('rejects relative paths before invoking Git', async () => {
    await assert.rejects(() => initializeRepo('relative/workspace'), /cwd must be absolute/);
  });
});
