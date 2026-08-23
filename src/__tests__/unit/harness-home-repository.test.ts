import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CompositeSecretStore,
  FileHarnessRepository,
  RepositoryLockedError,
  TASTE_MEMORY_MEDIA_TYPE,
  acquireWriterLease,
  applyHarnessImportPlan,
  createEnvironmentSecretBackend,
  createExternalOwnedSecretBackend,
  createKeyValueSecretBackend,
  createProvenance,
  hashBytes,
  getRepositoryConsistencyCacheStats,
  listTransactionJournals,
  planHarnessImport,
  prepareRepositoryTransaction,
  applyPreparedTransaction,
  assertSafeRepositoryPath,
  takeoverDeadWriterLease,
  type HarnessImportCandidate,
  type SecretRef,
} from '@/lib/harness-home';

const tempRoots: string[] = [];

function tempRoot(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `harness-home-${name}-`));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function memoryCandidate(
  content = '# Memory\n\nA durable fact.\n',
): HarnessImportCandidate {
  return {
    id: 'memory/main',
    index: 'memoryRefs',
    targetPath: 'state/memory.md',
    content,
    mediaType: 'text/markdown',
    provenance: createProvenance({
      sourceKind: 'migration',
      sourceRef: 'fixture://assistant/memory.md',
      contentHash: hashBytes(content),
      observedAt: '2026-07-30T12:00:00.000Z',
    }),
  };
}

describe('FileHarnessRepository', () => {
  it('allows one writer and gives a second instance a read-only breadcrumb', () => {
    const root = tempRoot('lock');
    const writer = FileHarnessRepository.create(root, 'harness-1', {
      instanceId: 'writer-a',
    });
    const reader = FileHarnessRepository.open(root, {
      mode: 'prefer-writable',
      instanceId: 'writer-b',
    });

    assert.equal(writer.writable, true);
    assert.equal(reader.writable, false);
    assert.equal(reader.diagnostics().lockHolder?.instanceId, 'writer-a');
    assert.throws(
      () => FileHarnessRepository.open(root, {
        mode: 'require-writable',
        instanceId: 'writer-c',
      }),
      RepositoryLockedError,
    );
    reader.close();
    writer.close();
  });

  it('imports through dry-run, commits manifest last and is idempotent', () => {
    const root = tempRoot('import');
    const repository = FileHarnessRepository.create(root, 'harness-1');
    const candidate = memoryCandidate();

    const plan = planHarnessImport(repository, [candidate]);
    assert.equal(plan.canApply, true);
    assert.equal(plan.items[0].action, 'create');
    const journal = applyHarnessImportPlan(repository, plan);

    assert.equal(journal?.state, 'committed');
    assert.equal(repository.manifest.generation, 1);
    assert.equal(
      repository.read(candidate.targetPath).toString('utf8'),
      candidate.content,
    );
    assert.deepEqual(repository.scanConsistency(), []);

    const repeated = planHarnessImport(repository, [candidate]);
    assert.equal(repeated.items[0].action, 'skip_same');
    assert.equal(applyHarnessImportPlan(repository, repeated), undefined);
    assert.equal(repository.manifest.generation, 1);
    repository.close();
  });

  it('rejects an invalid Taste Memory at the migration boundary', () => {
    const root = tempRoot('invalid-taste-import');
    const repository = FileHarnessRepository.create(root, 'harness-1');
    const invalidTaste = JSON.stringify({
      id: 'taste-invalid-import',
      preferenceKey: 'layout.density',
      classification: 'one_off',
      statement: '',
      evidenceRef: { assetId: 'asset-evidence' },
      scope: { kind: 'user' },
      confidence: 0.5,
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
      affectedMethodIds: [],
    });
    assert.throws(
      () => planHarnessImport(repository, [{
        id: 'taste-invalid-import',
        index: 'preferenceRefs',
        targetPath: 'state/taste/invalid.json',
        content: invalidTaste,
        mediaType: TASTE_MEMORY_MEDIA_TYPE,
        provenance: createProvenance({
          sourceKind: 'migration',
          sourceRef: 'fixture://taste/invalid',
          contentHash: hashBytes(invalidTaste),
          observedAt: '2026-07-31T00:00:00.000Z',
        }),
      }]),
      /statement must not be empty/,
    );
    assert.equal(repository.manifest.generation, 0);
    repository.close();
  });

  it('restores identity, memory, Skill, MCP descriptor and Method refs in a clean root', () => {
    const root = tempRoot('portable-roundtrip');
    const repository = FileHarnessRepository.create(root, 'portable-harness');
    const candidate = (
      id: string,
      index: HarnessImportCandidate['index'],
      targetPath: string,
      content: string,
    ): HarnessImportCandidate => ({
      id,
      index,
      targetPath,
      content,
      mediaType: targetPath.endsWith('.json')
        ? 'application/json'
        : 'text/markdown',
      provenance: createProvenance({
        sourceKind: 'migration',
        sourceRef: `fixture://${id}`,
        contentHash: hashBytes(content),
        observedAt: '2026-07-30T12:00:00.000Z',
      }),
    });
    const candidates: HarnessImportCandidate[] = [
      candidate('identity/main', 'identityRefs', 'definition/identity.md', '# Identity\n'),
      candidate('memory/main', 'memoryRefs', 'state/memory.md', '# Memory\n'),
      candidate('skill/design', 'skillRefs', 'definition/skills/design/SKILL.md', '# Design Skill\n'),
      candidate(
        'mcp/browser',
        'mcpRefs',
        'definition/mcp/browser.json',
        '{"command":"browser-server","secretRef":"secret://environment/BROWSER_TOKEN?scope=machine&v=1"}',
      ),
      candidate(
        'method/critique',
        'creativeMethodRefs',
        'definition/methods/critique.md',
        '# Critique Method v1\n',
      ),
    ];

    const journal = applyHarnessImportPlan(
      repository,
      planHarnessImport(repository, candidates),
    );
    assert.equal(journal?.state, 'committed');
    const manifest = repository.manifest;
    assert.deepEqual({
      identity: manifest.definition.identityRefs.length,
      memory: manifest.state.memoryRefs.length,
      skills: manifest.definition.skillRefs.length,
      mcp: manifest.definition.mcpRefs.length,
      methods: manifest.definition.creativeMethodRefs.length,
    }, {
      identity: 1,
      memory: 1,
      skills: 1,
      mcp: 1,
      methods: 1,
    });
    assert.deepEqual(repository.scanConsistency(), []);
    repository.close();

    const reopened = FileHarnessRepository.open(root, { mode: 'readonly' });
    assert.equal(reopened.manifest.harnessId, 'portable-harness');
    assert.deepEqual(reopened.scanConsistency(), []);
    assert.match(
      reopened.read('definition/mcp/browser.json').toString('utf8'),
      /secret:\/\/environment\//,
    );
    reopened.close();
  });

  it('reuses verified hashes across read-only turns and invalidates on external edits', () => {
    const root = tempRoot('consistency-cache');
    const writer = FileHarnessRepository.create(root, 'cache-harness');
    const candidate = memoryCandidate();
    applyHarnessImportPlan(writer, planHarnessImport(writer, [candidate]));
    writer.close();

    const first = FileHarnessRepository.open(root, { mode: 'readonly' });
    const beforeFirst = getRepositoryConsistencyCacheStats().contentHashReads;
    assert.deepEqual(first.scanConsistency(), []);
    const afterFirst = getRepositoryConsistencyCacheStats().contentHashReads;
    assert.equal(afterFirst - beforeFirst, 1);
    first.close();

    const second = FileHarnessRepository.open(root, { mode: 'readonly' });
    const beforeSecond = getRepositoryConsistencyCacheStats().contentHashReads;
    assert.deepEqual(second.scanConsistency(), []);
    assert.equal(
      getRepositoryConsistencyCacheStats().contentHashReads - beforeSecond,
      0,
      'an unchanged manifest generation should use stat-backed hash cache',
    );

    fs.writeFileSync(
      path.join(root, candidate.targetPath),
      '# Memory\n\nExternally changed.\n',
    );
    const beforeChanged = getRepositoryConsistencyCacheStats().contentHashReads;
    assert.equal(second.scanConsistency()[0]?.state, 'modified');
    assert.equal(
      getRepositoryConsistencyCacheStats().contentHashReads - beforeChanged,
      1,
      'a changed stat signature must force content revalidation',
    );
    second.close();
  });

  it('reports same-identity different-content as a conflict', () => {
    const root = tempRoot('conflict');
    const repository = FileHarnessRepository.create(root, 'harness-1');
    applyHarnessImportPlan(repository, planHarnessImport(repository, [memoryCandidate()]));

    const conflict = planHarnessImport(
      repository,
      [memoryCandidate('# Memory\n\nA different fact.\n')],
    );
    assert.equal(conflict.canApply, false);
    assert.equal(conflict.items[0].action, 'conflict');
    assert.throws(
      () => applyHarnessImportPlan(repository, conflict),
      /contains conflicts/,
    );
    repository.close();
  });

  it('detects an external edit by content hash and refuses last-write-wins', () => {
    const root = tempRoot('external-edit');
    const repository = FileHarnessRepository.create(root, 'harness-1');
    const candidate = memoryCandidate();
    applyHarnessImportPlan(repository, planHarnessImport(repository, [candidate]));

    fs.writeFileSync(
      path.join(root, candidate.targetPath),
      '# Memory\n\nEdited outside CodePilot.\n',
    );
    const diagnostics = repository.diagnostics();
    assert.equal(diagnostics.stale, true);
    assert.deepEqual(
      diagnostics.consistency.map((issue) => issue.state),
      ['modified'],
    );

    const current = repository.manifest;
    assert.throws(
      () => repository.commit({
        expectedGeneration: current.generation,
        manifest: {
          ...current,
          generation: current.generation + 1,
          writtenAt: '2026-07-30T13:00:00.000Z',
        },
        writes: [],
      }),
      /expects .* found/,
    );
    repository.close();
  });

  it('recovers a prepared partial write without mixing manifest generations', () => {
    const root = tempRoot('recovery');
    let injected = false;
    const repository = FileHarnessRepository.create(root, 'harness-1', {
      instanceId: 'crashing-writer',
      faultInjector: {
        afterTargetWrite(targetPath) {
          if (!injected && targetPath !== 'manifest.json') {
            injected = true;
            throw new Error('simulated process crash');
          }
        },
      },
    });
    const candidate = memoryCandidate();
    assert.throws(
      () => applyHarnessImportPlan(
        repository,
        planHarnessImport(repository, [candidate]),
      ),
      /simulated process crash/,
    );
    assert.equal(repository.manifest.generation, 0);
    assert.equal(
      listTransactionJournals(root).filter((journal) => journal.state === 'prepared').length,
      1,
    );
    repository.close();

    const recovered = FileHarnessRepository.open(root, {
      mode: 'require-writable',
      instanceId: 'recovery-writer',
    });
    assert.equal(recovered.manifest.generation, 1);
    assert.deepEqual(recovered.scanConsistency(), []);
    assert.equal(
      listTransactionJournals(root).filter((journal) => journal.state === 'committed').length,
      1,
    );
    recovered.close();
  });

  it('isolates an unjournaled transaction directory from valid siblings', () => {
    const root = tempRoot('missing-journal-sibling');
    const repository = FileHarnessRepository.create(root, 'harness-1');
    const manifest = repository.manifest;
    const prepared = prepareRepositoryTransaction({
      root,
      baseGeneration: manifest.generation,
      targetGeneration: manifest.generation + 1,
      writes: [],
      manifestContent: `${JSON.stringify({
        ...manifest,
        generation: manifest.generation + 1,
      })}\n`,
      expectedManifestHash: hashBytes(
        fs.readFileSync(path.join(root, 'manifest.json')),
      ),
    });
    const abandoned = path.join(
      root,
      '.harness-home',
      'transactions',
      'abandoned-before-journal',
    );
    fs.mkdirSync(path.join(abandoned, 'staging'), { recursive: true });
    fs.writeFileSync(path.join(abandoned, 'staging', '0000.content'), 'orphan');

    const journals = listTransactionJournals(root);
    assert.deepEqual(
      journals.map((journal) => journal.transactionId),
      [prepared.transactionId],
    );
    assert.equal(fs.existsSync(abandoned), false);
    repository.close();
  });

  it('releases the writer lease when a damaged journal aborts recovery', () => {
    const root = tempRoot('damaged-journal-lease');
    const repository = FileHarnessRepository.create(root, 'harness-1');
    repository.close();
    const transactionDir = path.join(
      root,
      '.harness-home',
      'transactions',
      'damaged-journal',
    );
    fs.mkdirSync(transactionDir, { recursive: true });
    fs.writeFileSync(path.join(transactionDir, 'journal.json'), '{not-json', 'utf8');

    assert.throws(
      () => FileHarnessRepository.open(root, {
        mode: 'require-writable',
        instanceId: 'failed-recovery-writer',
      }),
      /JSON/,
    );
    const replacement = acquireWriterLease(root, {
      instanceId: 'replacement-after-failed-recovery',
      repositoryGeneration: 0,
    });
    replacement.release();
  });

  it('rejects writes through a repository symlink', (t) => {
    const root = tempRoot('symlink');
    const outside = tempRoot('outside');
    const repository = FileHarnessRepository.create(root, 'harness-1');
    try {
      fs.symlinkSync(outside, path.join(root, 'state'), 'junction');
    } catch (error) {
      repository.close();
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        t.skip('Windows host does not permit unprivileged symlink creation');
        return;
      }
      throw error;
    }
    const plan = planHarnessImport(repository, [memoryCandidate()]);
    assert.throws(
      () => applyHarnessImportPlan(repository, plan),
      /traverses a symlink/,
    );
    assert.equal(fs.readdirSync(outside).length, 0);
    repository.close();
  });

  it('rejects case-variant internal paths and staged journal escapes', () => {
    assert.throws(
      () => assertSafeRepositoryPath('.Harness-Home/transactions/forged.json'),
      /internal state/,
    );
    assert.throws(
      () => assertSafeRepositoryPath('state\\.HARNESS-HOME\\forged.json'),
      /internal state/,
    );

    const root = tempRoot('staged-path-escape');
    const repository = FileHarnessRepository.create(root, 'harness-1');
    const manifest = repository.manifest;
    const prepared = prepareRepositoryTransaction({
      root,
      baseGeneration: manifest.generation,
      targetGeneration: manifest.generation + 1,
      writes: [],
      manifestContent: `${JSON.stringify({
        ...manifest,
        generation: manifest.generation + 1,
      })}\n`,
      expectedManifestHash: hashBytes(
        fs.readFileSync(path.join(root, 'manifest.json')),
      ),
    });
    const outside = path.join(root, 'outside-secret.txt');
    fs.writeFileSync(outside, 'must-not-be-copied', 'utf8');
    const forged = {
      ...prepared,
      files: prepared.files.map((file, index) => (
        index === 0
          ? { ...file, stagedPath: '../../../outside-secret.txt' }
          : file
      )),
    };
    assert.throws(
      () => applyPreparedTransaction(root, forged),
      /stagedPath escapes/,
    );
    repository.close();
  });

  it('rejects direct repository writes that bypass import planning with a Secret', () => {
    const root = tempRoot('secret-write');
    const repository = FileHarnessRepository.create(root, 'harness-1');
    const current = repository.manifest;
    assert.throws(
      () => repository.commit({
        expectedGeneration: current.generation,
        manifest: {
          ...current,
          generation: current.generation + 1,
          writtenAt: '2026-07-30T14:00:00.000Z',
        },
        writes: [{
          path: 'definitions/provider.json',
          content: '{"accessToken":"secret-inline-value"}',
        }],
      }),
      /forbidden secret material/,
    );
    assert.equal(repository.manifest.generation, 0);
    repository.close();
  });

  it('requires exact, explicit confirmation before taking over a dead lease', () => {
    const root = tempRoot('takeover');
    fs.mkdirSync(root, { recursive: true });
    const original = acquireWriterLease(root, {
      instanceId: 'dead-writer',
      pid: 2_147_483_647,
      processStartedAt: '2026-07-30T00:00:00.000Z',
      repositoryGeneration: 0,
    });
    assert.throws(
      () => takeoverDeadWriterLease(root, {
        expectedInstanceId: 'dead-writer',
        confirmedByUser: false,
        instanceId: 'new-writer',
        repositoryGeneration: 0,
      }),
      /explicit user confirmation/,
    );
    const replacement = takeoverDeadWriterLease(root, {
      expectedInstanceId: 'dead-writer',
      confirmedByUser: true,
      instanceId: 'new-writer',
      repositoryGeneration: 0,
    });
    assert.equal(replacement.metadata.instanceId, 'new-writer');
    original.release();
    replacement.release();
  });

  it('reclaims a provably dead crash lease without requiring graceful close', () => {
    const root = tempRoot('crash-lease-recovery');
    const repository = FileHarnessRepository.create(root, 'harness-1');
    repository.close();
    const crashed = acquireWriterLease(root, {
      instanceId: 'crashed-process',
      pid: 2_147_483_647,
      processStartedAt: '2026-07-30T00:00:00.000Z',
      repositoryGeneration: 0,
    });

    const recovered = FileHarnessRepository.open(root, {
      mode: 'require-writable',
      instanceId: 'replacement-process',
    });
    assert.equal(recovered.writable, true);
    assert.equal(
      recovered.diagnostics().lockHolder?.instanceId,
      'replacement-process',
    );

    // The stale process never called release(); its old lease object can no
    // longer remove the replacement lock because ownership changed.
    crashed.release();
    assert.equal(recovered.writable, true);
    recovered.close();
  });

  it('never treats a PID on another machine as proof that a writer is dead', () => {
    const root = tempRoot('cross-machine-lease');
    const repository = FileHarnessRepository.create(root, 'harness-1');
    repository.close();
    const remote = acquireWriterLease(root, {
      instanceId: 'remote-writer',
      machineId: 'machine-a',
      pid: 2_147_483_647,
      processStartedAt: '2026-07-30T00:00:00.000Z',
      repositoryGeneration: 0,
    });

    assert.throws(
      () => FileHarnessRepository.open(root, {
        mode: 'require-writable',
        instanceId: 'local-writer',
        machineId: 'machine-b',
      }),
      RepositoryLockedError,
    );
    assert.throws(
      () => takeoverDeadWriterLease(root, {
        expectedInstanceId: 'remote-writer',
        confirmedByUser: true,
        instanceId: 'local-writer',
        machineId: 'machine-b',
        repositoryGeneration: 0,
      }),
      /another or unknown machine/,
    );
    assert.equal(remote.metadata.machineId, 'machine-a');
    remote.release();
  });
});

describe('CompositeSecretStore', () => {
  const settingRef: SecretRef = {
    scheme: 'secret',
    namespace: 'codepilot-setting',
    key: 'provider_token',
    scope: 'user',
    version: 1,
  };

  it('keeps diagnostics value-free while resolving only on explicit request', () => {
    const values = new Map([['provider_token', 'sk-live-secret-value']]);
    const store = new CompositeSecretStore([
      createKeyValueSecretBackend({
        namespace: 'codepilot-setting',
        read: (key) => values.get(key),
        write: (key, value) => values.set(key, value),
        remove: (key) => {
          values.delete(key);
        },
      }),
    ]);

    const metadata = store.get(settingRef);
    assert.equal(metadata.status, 'available');
    assert.equal(metadata.mutable, true);
    assert.doesNotMatch(JSON.stringify(metadata), /sk-live-secret-value/);
    assert.deepEqual(store.resolve(settingRef), {
      status: 'resolved',
      value: 'sk-live-secret-value',
    });

    store.set(settingRef, 'rotated-secret');
    assert.equal(values.get('provider_token'), 'rotated-secret');
    store.delete(settingRef);
    assert.equal(store.get(settingRef).status, 'unresolved');
  });

  it('treats environment and external-owned credentials as read-only', () => {
    const store = new CompositeSecretStore([
      createEnvironmentSecretBackend({ SERVICE_TOKEN: 'env-secret' }),
      createExternalOwnedSecretBackend(),
    ]);
    const envRef: SecretRef = {
      scheme: 'secret',
      namespace: 'environment',
      key: 'SERVICE_TOKEN',
      scope: 'machine',
      version: 1,
    };
    assert.equal(store.resolve(envRef).status, 'resolved');
    assert.throws(() => store.set(envRef, 'new-value'), /read-only/);

    const externalRef: SecretRef = {
      scheme: 'secret',
      namespace: 'external-owned',
      key: 'runtime/account',
      scope: 'machine',
      version: 1,
    };
    const external = store.resolve(externalRef);
    assert.equal(external.status, 'unavailable');
    assert.equal(external.reauthorizationRequired, true);
  });

  it('fails closed for an unknown namespace', () => {
    const store = new CompositeSecretStore([]);
    assert.throws(
      () => store.resolve({
        scheme: 'secret',
        namespace: 'unknown-store',
        key: 'credential',
        scope: 'user',
        version: 1,
      }),
      /not registered/,
    );
  });
});
