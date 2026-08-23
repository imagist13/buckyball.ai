import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FileHarnessRepository,
  applyExplicitExportPlan,
  applyHarnessImportPlan,
  findSecretLeaks,
  hashBytes,
  listHarnessAdapters,
  requireHarnessAdapter,
  safeResolveExternalPath,
  type HarnessAdapter,
} from '@/lib/harness-home';

const tempRoots: string[] = [];

function tempRoot(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `harness-adapter-${name}-`));
  tempRoots.push(root);
  return root;
}

function write(root: string, relativePath: string, content: string): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function directorySnapshot(root: string): string {
  const records: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isSymbolicLink()) {
        records.push(`${relative}:symlink:${fs.readlinkSync(absolute)}`);
      } else {
        records.push(
          `${relative}:file:${crypto.createHash('sha256')
            .update(fs.readFileSync(absolute))
            .digest('hex')}`,
        );
      }
    }
  };
  visit(root);
  return records.join('\n');
}

function setupClaudeFixture(): { homeRoot: string; projectRoot: string } {
  const homeRoot = tempRoot('claude-home');
  const projectRoot = tempRoot('claude-project');
  write(homeRoot, '.claude/CLAUDE.md', '# User rules\n');
  write(homeRoot, '.claude/skills/review/SKILL.md', '# Review Skill\n');
  write(homeRoot, '.claude/commands/check.md', '# Check Command\n');
  write(homeRoot, '.claude/auth.json', '{"accessToken":"never-read-this-secret"}');
  write(homeRoot, '.claude/settings.json', JSON.stringify({
    mcpServers: {
      browser: {
        command: 'browser-server',
        args: ['--stdio'],
        env: { BROWSER_TOKEN: 'literal-secret-not-portable' },
        headers: { Authorization: 'Bearer never-copy-this' },
      },
    },
  }));
  write(homeRoot, '.claude.json', JSON.stringify({
    mcpServers: {
      remote: {
        type: 'http',
        url: 'https://example.test/mcp?api_key=never-copy-query',
      },
    },
  }));
  write(projectRoot, '.claude/CLAUDE.md', '# Project rules\n');
  write(projectRoot, '.claude/skills/project-skill/SKILL.md', '# Project Skill\n');
  write(projectRoot, '.mcp.json', JSON.stringify({
    mcpServers: {
      project: { command: 'project-server' },
    },
  }));
  return { homeRoot, projectRoot };
}

function setupCodexFixture(): { homeRoot: string; projectRoot: string } {
  const homeRoot = tempRoot('codex-home');
  const projectRoot = tempRoot('codex-project');
  write(homeRoot, '.codex/AGENTS.md', '# User Codex rules\n');
  write(homeRoot, '.codex/skills/review/SKILL.md', '# Codex Review Skill\n');
  write(homeRoot, '.codex/prompts/check.md', '# Codex Prompt\n');
  write(homeRoot, '.codex/config.toml', 'api_key = "must-not-be-imported"\n');
  write(projectRoot, 'AGENTS.md', '# Project agents\n');
  write(projectRoot, '.codex/skills/project/SKILL.md', '# Project Codex Skill\n');
  return { homeRoot, projectRoot };
}

function setupWorkspaceFixture(): { homeRoot: string; projectRoot: string } {
  const homeRoot = tempRoot('workspace-home');
  const projectRoot = tempRoot('workspace-project');
  write(projectRoot, 'soul.md', '# Soul\n');
  write(projectRoot, 'user.md', '# User\n');
  write(projectRoot, 'AGENTS.md', '# Rules\n');
  write(projectRoot, 'memory.md', '# Memory\n');
  write(projectRoot, 'memory/daily/2026-07-30.md', '# Daily\n');
  return { homeRoot, projectRoot };
}

const FIXTURES: Readonly<Record<
string,
() => { homeRoot: string; projectRoot: string }
>> = {
  'claude-code': setupClaudeFixture,
  codex: setupCodexFixture,
  'assistant-workspace': setupWorkspaceFixture,
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('Harness adapter registry', () => {
  it('registers the three initial source adapters with complete descriptors', () => {
    const adapters = listHarnessAdapters();
    assert.deepEqual(
      adapters.map((adapter) => adapter.descriptor.id).sort(),
      ['assistant-workspace', 'claude-code', 'codex'],
    );
    for (const adapter of adapters) {
      assert.ok(adapter.descriptor.displayName);
      assert.ok(adapter.descriptor.integrationLevels.includes('discover'));
      assert.ok(adapter.descriptor.integrationLevels.includes('portable'));
      assert.ok(adapter.descriptor.sourceKinds.length > 0);
    }
  });

  it('fails closed for an unregistered adapter id', () => {
    assert.throws(() => requireHarnessAdapter('unknown'), /not registered/);
  });

  it('requires an explicit base in the changed-files guard', () => {
    const source = fs.readFileSync(
      path.resolve('scripts/check-harness-adapter-boundary.mjs'),
      'utf8',
    );
    assert.match(source, /--base <explicit-commit>/);
    assert.doesNotMatch(source, /HEAD~1/);
  });
});

for (const adapterId of Object.keys(FIXTURES)) {
  describe(`${adapterId} L0/L1 conformance`, () => {
    it('discovers read-only assets with provenance and no Secret material', async () => {
      const adapter = requireHarnessAdapter(adapterId);
      const fixture = FIXTURES[adapterId]();
      const beforeHome = directorySnapshot(fixture.homeRoot);
      const beforeProject = directorySnapshot(fixture.projectRoot);
      const discovered = await adapter.discover(fixture);

      assert.equal(discovered.adapterId, adapterId);
      assert.ok(discovered.assets.length > 0);
      assert.equal(directorySnapshot(fixture.homeRoot), beforeHome);
      assert.equal(directorySnapshot(fixture.projectRoot), beforeProject);
      for (const asset of discovered.assets) {
        assert.ok(asset.provenance.sourceRef);
        assert.ok(asset.provenance.observedAt);
        if (asset.portable) {
          assert.ok(asset.targetPath);
          assert.notEqual(asset.content, undefined);
        } else {
          assert.ok(asset.unsupportedReason);
        }
      }
      assert.deepEqual(findSecretLeaks(discovered), []);
      assert.doesNotMatch(
        JSON.stringify(discovered),
        /never-read-this-secret|literal-secret-not-portable|never-copy-this|never-copy-query|must-not-be-imported/,
      );
    });

    it('dry-runs, applies idempotently and refuses same-id conflicts', async () => {
      const adapter = requireHarnessAdapter(adapterId);
      const fixture = FIXTURES[adapterId]();
      const sourceBefore = [
        directorySnapshot(fixture.homeRoot),
        directorySnapshot(fixture.projectRoot),
      ];
      const repositoryRoot = tempRoot(`${adapterId}-repo`);
      const repository = FileHarnessRepository.create(
        repositoryRoot,
        `${adapterId}-harness`,
      );
      const discovered = await adapter.discover(fixture);
      const dryRun = await adapter.importPlan({ repository, discovered });

      assert.equal(dryRun.plan.canApply, true);
      assert.ok(dryRun.plan.items.some((item) => item.action === 'create'));
      applyHarnessImportPlan(repository, dryRun.plan);
      assert.deepEqual(repository.scanConsistency(), []);

      const repeated = await adapter.importPlan({ repository, discovered });
      assert.ok(repeated.plan.items.every((item) => item.action === 'skip_same'));
      assert.equal(applyHarnessImportPlan(repository, repeated.plan), undefined);

      const portable = discovered.assets.find((asset) => asset.portable)!;
      const changedDiscovery = {
        ...discovered,
        assets: discovered.assets.map((asset) =>
          asset.id === portable.id
            ? { ...asset, content: `${String(asset.content)}\nchanged` }
            : asset),
      };
      const conflict = await adapter.importPlan({
        repository,
        discovered: changedDiscovery,
      });
      assert.equal(conflict.plan.canApply, false);
      assert.ok(conflict.plan.items.some((item) => item.action === 'conflict'));
      assert.deepEqual([
        directorySnapshot(fixture.homeRoot),
        directorySnapshot(fixture.projectRoot),
      ], sourceBefore);
      repository.close();
    });

    it('exports only after confirmation and never overwrites a conflict', async () => {
      const adapter: HarnessAdapter = requireHarnessAdapter(adapterId);
      assert.ok(adapter.exportPlan);
      const fixture = FIXTURES[adapterId]();
      const repositoryRoot = tempRoot(`${adapterId}-export-repo`);
      const repository = FileHarnessRepository.create(
        repositoryRoot,
        `${adapterId}-harness`,
      );
      const discovered = await adapter.discover(fixture);
      const dryRun = await adapter.importPlan({ repository, discovered });
      applyHarnessImportPlan(repository, dryRun.plan);

      const exportableRef = [
        ...repository.manifest.definition.skillRefs,
        ...repository.manifest.definition.ruleRefs,
        ...repository.manifest.definition.identityRefs,
        ...repository.manifest.state.memoryRefs,
      ][0];
      assert.ok(exportableRef);
      const targetRoot = tempRoot(`${adapterId}-export-target`);
      const plan = await adapter.exportPlan!({
        repository,
        targetRoot,
        refIds: new Set([exportableRef.id]),
      });
      assert.equal(plan.canApply, true);
      assert.throws(
        () => applyExplicitExportPlan(plan, { confirmedByUser: false }),
        /explicit user confirmation/,
      );
      const result = applyExplicitExportPlan(plan, { confirmedByUser: true });
      assert.equal(result.createdPaths.length, 1);
      assert.deepEqual(
        fs.readFileSync(result.createdPaths[0]),
        repository.read(exportableRef.path),
      );

      const rediscovered = await adapter.discover({
        homeRoot: targetRoot,
        projectRoot: targetRoot,
      });
      const roundTripAsset = rediscovered.assets.find((asset) =>
        asset.portable
        && asset.content !== undefined
        && hashBytes(asset.content) === exportableRef.contentHash);
      assert.ok(roundTripAsset, 'exported content must be discoverable again');
      const roundTripRoot = tempRoot(`${adapterId}-roundtrip-repo`);
      const roundTripRepository = FileHarnessRepository.create(
        roundTripRoot,
        `${adapterId}-roundtrip`,
      );
      const roundTripPlan = await adapter.importPlan({
        repository: roundTripRepository,
        discovered: rediscovered,
      });
      applyHarnessImportPlan(roundTripRepository, roundTripPlan.plan);
      assert.ok(
        [
          ...roundTripRepository.manifest.definition.identityRefs,
          ...roundTripRepository.manifest.definition.ruleRefs,
          ...roundTripRepository.manifest.definition.skillRefs,
          ...roundTripRepository.manifest.state.memoryRefs,
        ].some((ref) => ref.contentHash === exportableRef.contentHash),
      );
      roundTripRepository.close();

      fs.writeFileSync(result.createdPaths[0], 'externally changed');
      const conflict = await adapter.exportPlan!({
        repository,
        targetRoot,
        refIds: new Set([exportableRef.id]),
      });
      assert.equal(conflict.canApply, false);
      assert.equal(conflict.writes[0].action, 'conflict');
      assert.throws(
        () => applyExplicitExportPlan(conflict, { confirmedByUser: true }),
        /contains conflicts/,
      );
      assert.equal(
        fs.readFileSync(result.createdPaths[0], 'utf8'),
        'externally changed',
      );
      repository.close();
    });

    it('rolls back files created by a partially failed explicit export', async () => {
      const adapter = requireHarnessAdapter(adapterId);
      assert.ok(adapter.exportPlan);
      const fixture = FIXTURES[adapterId]();
      const repositoryRoot = tempRoot(`${adapterId}-rollback-repo`);
      const repository = FileHarnessRepository.create(
        repositoryRoot,
        `${adapterId}-rollback`,
      );
      const discovered = await adapter.discover(fixture);
      const importPlan = await adapter.importPlan({ repository, discovered });
      applyHarnessImportPlan(repository, importPlan.plan);
      const exportable = [
        ...repository.manifest.definition.skillRefs,
        ...repository.manifest.definition.ruleRefs,
        ...repository.manifest.definition.identityRefs,
        ...repository.manifest.state.memoryRefs,
      ].slice(0, 2);
      assert.equal(exportable.length, 2);
      const targetRoot = tempRoot(`${adapterId}-rollback-target`);
      const plan = await adapter.exportPlan!({
        repository,
        targetRoot,
        refIds: new Set(exportable.map((ref) => ref.id)),
      });
      assert.equal(plan.canApply, true);
      assert.equal(plan.writes.length, 2);

      const secondTarget = safeResolveExternalPath(
        targetRoot,
        plan.writes[1].targetPath,
      );
      fs.mkdirSync(path.dirname(secondTarget), { recursive: true });
      fs.writeFileSync(secondTarget, 'appeared after dry-run');
      assert.throws(
        () => applyExplicitExportPlan(plan, { confirmedByUser: true }),
        /changed after dry-run/,
      );
      const firstTarget = safeResolveExternalPath(
        targetRoot,
        plan.writes[0].targetPath,
      );
      assert.equal(fs.existsSync(firstTarget), false);
      assert.equal(fs.readFileSync(secondTarget, 'utf8'), 'appeared after dry-run');
      repository.close();
    });

    it('does not follow a discovery symlink outside the declared root', async (t) => {
      const adapter = requireHarnessAdapter(adapterId);
      const fixture = FIXTURES[adapterId]();
      const outside = tempRoot(`${adapterId}-outside`);
      write(outside, 'SKILL.md', '# Outside Secret\nBearer should-never-be-read\n');
      const symlinkParent = adapterId === 'assistant-workspace'
        ? path.join(fixture.projectRoot, 'memory')
        : adapterId === 'claude-code'
          ? path.join(fixture.homeRoot, '.claude', 'skills')
          : path.join(fixture.homeRoot, '.codex', 'skills');
      fs.mkdirSync(symlinkParent, { recursive: true });
      try {
        fs.symlinkSync(outside, path.join(symlinkParent, 'outside-link'), 'junction');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') {
          t.skip('Windows host does not permit unprivileged symlink creation');
          return;
        }
        throw error;
      }

      const discovered = await adapter.discover(fixture);
      assert.doesNotMatch(JSON.stringify(discovered), /Outside Secret|should-never-be-read/);
    });
  });
}

describe('adapter filesystem boundary', () => {
  it('rejects parent traversal before reading or writing', () => {
    const root = tempRoot('path-boundary');
    assert.throws(
      () => safeResolveExternalPath(root, '../outside'),
      /escapes root/,
    );
  });
});
