import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FileHarnessRepository,
  TASTE_MEMORY_MEDIA_TYPE,
  addCreativeDirections,
  attachCreativeAsset,
  createCreativeProject,
  hashBytes,
  inspectTasteMemories,
  listCreativeMethods,
  listCreativeProjects,
  listTasteMemories,
  markCreativeStageUnsupported,
  projectCanonicalRepository,
  recordCreativeDecision,
  renderCanonicalHarnessFragment,
  resolveTasteMemoryProjection,
  revokeTasteMemory,
  selectCreativeMethods,
  switchCreativeExecution,
  writeCreativeMethod,
  writeCreativeProject,
  writeTasteMemory,
  type CreativeMethodRecord,
  type PortableContentRef,
} from '@/lib/harness-home';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function repository(): FileHarnessRepository {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-design-method-'));
  roots.push(root);
  return FileHarnessRepository.create(root, 'design-method-fixture', {
    mode: 'require-writable',
    instanceId: 'design-method-test',
  });
}

function methodInput(
  status: 'candidate' | 'confirmed' = 'candidate',
  confirmationEvidenceRef:
    | PortableContentRef
    | { readonly assetId: string; readonly kind?: string }
    = { assetId: 'asset-confirmation', kind: 'image' },
) {
  return {
    id: 'web.hierarchy',
    version: '0.1.0',
    status,
    title: 'Hierarchy before decoration',
    summary: 'Establish information hierarchy before styling details.',
    scope: { kind: 'user' } as const,
    triggers: ['landing page', 'web layout'],
    nonTriggers: ['data migration'],
    inputs: ['brief', 'content inventory'],
    outputs: ['distinct directions', 'html_bundle'],
    steps: ['Clarify the brief.', 'Create structurally distinct directions.'],
    modalities: ['text', 'image', 'html_bundle'],
    referenceRefs: [{ assetId: 'asset-reference', kind: 'image' }],
    counterexampleRefs: [{ assetId: 'asset-counterexample', kind: 'image' }],
    critiqueCriteria: ['Hierarchy is clear.', 'Directions differ structurally.'],
    changelog: [{
      version: '0.1.0',
      changedAt: '2026-07-30T12:00:00.000Z',
      summary: 'Initial evidence-backed candidate.',
    }],
    overridePolicy: {
      userEditable: true,
      projectOverride: true,
    },
    ...(status === 'confirmed'
      ? {
        confirmationEvidenceRef,
        confirmedAt: '2026-07-30T12:05:00.000Z',
      }
      : {}),
    sourceRef: 'user-review:golden-brief-1',
    observedAt: '2026-07-30T12:05:00.000Z',
  } as const;
}

function indexEvidence(repo: FileHarnessRepository): PortableContentRef {
  const content = 'User confirmed the hierarchy method after comparing two briefs.';
  const ref: PortableContentRef = {
    id: 'evidence:method-confirmation',
    path: 'state/feedback/method-confirmation.md',
    contentHash: hashBytes(content),
    mediaType: 'text/markdown',
    provenance: {
      sourceKind: 'user_file',
      sourceRef: 'user-review:golden-brief-1',
      observedAt: '2026-07-30T12:04:00.000Z',
      secretMaterial: 'absent',
    },
  };
  const manifest = repo.manifest;
  repo.commit({
    expectedGeneration: manifest.generation,
    manifest: {
      ...manifest,
      generation: manifest.generation + 1,
      writtenAt: '2026-07-30T12:04:00.000Z',
      state: {
        ...manifest.state,
        feedbackRefs: [...manifest.state.feedbackRefs, ref],
      },
    },
    writes: [{ path: ref.path, content }],
  });
  return ref;
}

describe('CodePilot Design Method', () => {
  it('persists versioned method metadata and a separate progressive guide', () => {
    const repo = repository();
    try {
      const created = writeCreativeMethod(repo, methodInput());
      assert.equal(created.status, 'created');
      assert.equal(created.record.definition.status, 'candidate');
      assert.notEqual(
        created.record.definitionRef.path,
        created.record.guideRef.path,
      );
      assert.match(
        repo.read(created.record.guideRef.path).toString('utf8'),
        /Hierarchy before decoration/,
      );
      assert.equal(listCreativeMethods(repo).length, 1);
      assert.equal(
        repo.scanConsistency().length,
        0,
        'both definition and guide are part of one consistent generation',
      );
    } finally {
      repo.close();
    }
  });

  it('never activates candidates and lets non-triggers override a match', () => {
    const candidate = {
      definition: {
        ...methodInput(),
        source: {
          sourceKind: 'host_application' as const,
          sourceRef: 'test',
          observedAt: '2026-07-30T12:00:00.000Z',
          secretMaterial: 'absent' as const,
        },
        progressiveDisclosureRef: {
          id: 'guide',
          path: 'methods/guide.md',
          contentHash: 'sha256:guide',
        },
      },
      definitionRef: {
        id: 'definition',
        path: 'methods/definition.json',
        contentHash: 'sha256:definition',
      },
      guideRef: {
        id: 'guide',
        path: 'methods/guide.md',
        contentHash: 'sha256:guide',
      },
    } as CreativeMethodRecord;
    assert.deepEqual(
      selectCreativeMethods({
        records: [candidate],
        userPrompt: 'Design a landing page',
        scopeContext: {},
      }).selected,
      [],
    );

    const confirmed = {
      ...candidate,
      definition: {
        ...candidate.definition,
        status: 'confirmed' as const,
        confirmationEvidenceRef: { assetId: 'asset-confirmation' },
        confirmedAt: '2026-07-30T12:05:00.000Z',
      },
    };
    assert.equal(
      selectCreativeMethods({
        records: [confirmed],
        userPrompt: 'Design a landing page',
        scopeContext: {},
      }).selected.length,
      1,
    );
    const blocked = selectCreativeMethods({
      records: [confirmed],
      userPrompt: 'Use a landing page example for data migration',
      scopeContext: {},
    });
    assert.equal(blocked.selected.length, 0);
    assert.equal(blocked.rejected[0]?.reason, 'non_trigger');
  });

  it('rejects empty/control activation phrases on write and historical read', () => {
    const repo = repository();
    try {
      assert.throws(
        () => writeCreativeMethod(repo, {
          ...methodInput(),
          triggers: ['   '],
        }),
        /triggers must be 1-240 characters/,
      );
      assert.throws(
        () => writeCreativeMethod(repo, {
          ...methodInput(),
          nonTriggers: ['never\u0000use'],
        }),
        /non-triggers must be 1-240 characters/,
      );

      const created = writeCreativeMethod(repo, methodInput());
      const persisted = JSON.parse(
        repo.read(created.record.definitionRef.path).toString('utf8'),
      ) as { triggers: string[] };
      persisted.triggers = [''];
      fs.writeFileSync(
        path.join(repo.root, created.record.definitionRef.path),
        `${JSON.stringify(persisted)}\n`,
        'utf8',
      );
      assert.throws(
        () => listCreativeMethods(repo),
        /triggers must be 1-240 characters/,
      );
    } finally {
      repo.close();
    }
  });

  it('injects confirmed methods only when the prompt triggers progressive disclosure', () => {
    const repo = repository();
    try {
      const confirmationEvidenceRef = indexEvidence(repo);
      writeCreativeMethod(
        repo,
        methodInput('confirmed', confirmationEvidenceRef),
      );
      const unrelated = projectCanonicalRepository({
        repository: repo,
        runtimeId: 'codepilot_runtime',
        userPrompt: 'Summarize this log.',
      });
      assert.deepEqual(unrelated.diagnostics.selectedMethodIds, []);
      assert.doesNotMatch(
        renderCanonicalHarnessFragment(unrelated),
        /Hierarchy before decoration/,
      );

      const relevant = projectCanonicalRepository({
        repository: repo,
        runtimeId: 'codepilot_runtime',
        userPrompt: 'Create a landing page for this product.',
      });
      assert.deepEqual(relevant.diagnostics.selectedMethodIds, ['web.hierarchy']);
      assert.match(
        renderCanonicalHarnessFragment(relevant),
        /Hierarchy before decoration/,
      );
    } finally {
      repo.close();
    }
  });

  it('withholds imported methods and preferences whose evidence is unavailable', () => {
    const repo = repository();
    try {
      writeCreativeMethod(repo, methodInput('confirmed'));
      writeTasteMemory(repo, {
        id: 'taste-unresolved',
        preferenceKey: 'layout.density',
        classification: 'one_off',
        statement: 'Use a compact layout for this variation.',
        evidenceRef: { assetId: 'asset-unresolved' },
        scope: { kind: 'user' },
        confidence: 0.8,
        affectedMethodIds: ['web.hierarchy'],
        sourceRef: 'import:unresolved-evidence',
        observedAt: '2026-07-30T12:06:00.000Z',
      });
      const projection = projectCanonicalRepository({
        repository: repo,
        runtimeId: 'codepilot_runtime',
        userPrompt: 'Create a landing page.',
      });
      assert.deepEqual(projection.diagnostics.selectedMethodIds, []);
      assert.deepEqual(
        new Set(projection.diagnostics.unavailableEvidenceIds),
        new Set(['web.hierarchy', 'taste-unresolved']),
      );
      assert.doesNotMatch(
        renderCanonicalHarnessFragment(projection),
        /Use a compact layout/,
      );
    } finally {
      repo.close();
    }
  });
});

describe('evidence-backed Taste Memory', () => {
  it('requires confirmation for durable preferences', () => {
    const repo = repository();
    try {
      assert.throws(
        () => writeTasteMemory(repo, {
          id: 'taste-density',
          preferenceKey: 'layout.density',
          classification: 'durable_user_preference',
          statement: 'Prefer compact layouts.',
          evidenceRef: { assetId: 'asset-choice' },
          scope: { kind: 'user' },
          confidence: 0.8,
          affectedMethodIds: ['web.hierarchy'],
          sourceRef: 'user-choice:brief-1',
          observedAt: '2026-07-30T12:00:00.000Z',
        }),
        /confirmation timestamp/,
      );
    } finally {
      repo.close();
    }
  });

  it('applies project precedence, withholds same-scope conflicts and honors revoke', () => {
    const repo = repository();
    try {
      writeTasteMemory(repo, {
        id: 'taste-user-density',
        preferenceKey: 'layout.density',
        classification: 'durable_user_preference',
        statement: 'Prefer compact layouts.',
        evidenceRef: { assetId: 'asset-user-choice' },
        scope: { kind: 'user' },
        confidence: 0.9,
        affectedMethodIds: ['web.hierarchy'],
        lastConfirmedAt: '2026-07-30T12:00:00.000Z',
        sourceRef: 'user-choice:global',
        observedAt: '2026-07-30T12:00:00.000Z',
      });
      writeTasteMemory(repo, {
        id: 'taste-project-density-a',
        preferenceKey: 'layout.density',
        classification: 'project_preference',
        statement: 'Use spacious layouts for this launch.',
        evidenceRef: { assetId: 'asset-project-choice-a' },
        scope: { kind: 'project', projectId: '/workspace/launch' },
        confidence: 0.8,
        affectedMethodIds: ['web.hierarchy'],
        sourceRef: 'user-choice:launch-a',
        observedAt: '2026-07-30T12:01:00.000Z',
      });
      let projection = resolveTasteMemoryProjection({
        records: listTasteMemories(repo),
        scopeContext: { projectId: '/workspace/launch' },
      });
      assert.deepEqual(
        projection.selected.map((record) => record.evidence.id),
        ['taste-project-density-a'],
      );
      assert.equal(
        projection.ignored.find(
          (entry) => entry.id === 'taste-user-density',
        )?.reason,
        'overridden',
      );

      writeTasteMemory(repo, {
        id: 'taste-project-density-b',
        preferenceKey: 'layout.density',
        classification: 'project_preference',
        statement: 'Use an extremely dense layout for this launch.',
        evidenceRef: { assetId: 'asset-project-choice-b' },
        scope: { kind: 'project', projectId: '/workspace/launch' },
        confidence: 0.7,
        affectedMethodIds: ['web.hierarchy'],
        sourceRef: 'user-choice:launch-b',
        observedAt: '2026-07-30T12:02:00.000Z',
      });
      projection = resolveTasteMemoryProjection({
        records: listTasteMemories(repo),
        scopeContext: { projectId: '/workspace/launch' },
      });
      assert.equal(projection.selected.length, 0);
      assert.deepEqual(projection.conflicts[0]?.evidenceIds, [
        'taste-project-density-a',
        'taste-project-density-b',
      ]);

      const record = listTasteMemories(repo).find(
        (entry) => entry.evidence.id === 'taste-project-density-b',
      );
      assert.ok(record);
      revokeTasteMemory(repo, {
        id: record.evidence.id,
        reason: 'User rejected this inference.',
        expectedContentHash: record.ref.contentHash,
        revokedAt: '2026-07-30T12:03:00.000Z',
      });
      projection = resolveTasteMemoryProjection({
        records: listTasteMemories(repo),
        scopeContext: { projectId: '/workspace/launch' },
      });
      assert.deepEqual(
        projection.selected.map((entry) => entry.evidence.id),
        ['taste-project-density-a'],
      );
      assert.equal(
        projection.ignored.find(
          (entry) => entry.id === 'taste-project-density-b',
        )?.reason,
        'revoked',
      );
    } finally {
      repo.close();
    }
  });

  it('isolates a persisted poison record without blocking valid projection', () => {
    const repo = repository();
    try {
      const evidenceRef = indexEvidence(repo);
      writeTasteMemory(repo, {
        id: 'taste-valid-layout',
        preferenceKey: 'layout.composition',
        classification: 'one_off',
        statement: 'Prefer an asymmetric composition for this variation.',
        evidenceRef,
        scope: { kind: 'user' },
        confidence: 0.85,
        affectedMethodIds: [],
        sourceRef: 'user-choice:valid-layout',
        observedAt: '2026-07-31T00:00:00.000Z',
      });

      const poisonEvidence = {
        id: 'taste-poison-layout',
        preferenceKey: 'layout.density',
        classification: 'one_off',
        statement: '',
        evidenceRef,
        scope: { kind: 'user' },
        confidence: 0.5,
        createdAt: '2026-07-31T00:01:00.000Z',
        updatedAt: '2026-07-31T00:01:00.000Z',
        affectedMethodIds: [],
      };
      const content = `${JSON.stringify(poisonEvidence, null, 2)}\n`;
      const contentHash = hashBytes(content);
      const current = repo.manifest;
      repo.commit({
        expectedGeneration: current.generation,
        manifest: {
          ...current,
          generation: current.generation + 1,
          writtenAt: '2026-07-31T00:01:00.000Z',
          state: {
            ...current.state,
            preferenceRefs: [
              ...current.state.preferenceRefs,
              {
                id: poisonEvidence.id,
                path: 'state/taste/poison-layout.json',
                contentHash,
                mediaType: TASTE_MEMORY_MEDIA_TYPE,
                provenance: {
                  sourceKind: 'migration',
                  sourceRef: 'fixture://taste/poison-layout',
                  observedAt: '2026-07-31T00:01:00.000Z',
                  contentHash,
                  secretMaterial: 'absent',
                },
              },
            ],
          },
        },
        writes: [{
          path: 'state/taste/poison-layout.json',
          content,
          expectedOldHash: null,
        }],
      });

      const inspection = inspectTasteMemories(repo);
      assert.deepEqual(
        inspection.records.map((record) => record.evidence.id),
        ['taste-valid-layout'],
      );
      assert.equal(inspection.invalid[0]?.id, 'taste-poison-layout');
      assert.match(inspection.invalid[0]?.reason ?? '', /statement must not be empty/);

      const projection = projectCanonicalRepository({
        repository: repo,
        runtimeId: 'codepilot_runtime',
      });
      assert.deepEqual(
        projection.diagnostics.invalidTasteMemoryIds,
        ['taste-poison-layout'],
      );
      assert.match(
        renderCanonicalHarnessFragment(projection),
        /Prefer an asymmetric composition/,
      );
    } finally {
      repo.close();
    }
  });
});

describe('creative project continuity', () => {
  it('preserves method, decisions, typed lineage and Runtime switches', () => {
    const repo = repository();
    try {
      let project = createCreativeProject({
        id: 'launch-brief',
        brief: 'Create a product launch page and motion teaser.',
        scope: { kind: 'project', projectId: '/workspace/launch' },
        methodRef: 'web.hierarchy',
        methodVersion: '0.1.0',
        runtimeId: 'codepilot_runtime',
        providerId: 'provider-a',
        modelId: 'model-a',
        createdAt: '2026-07-30T12:00:00.000Z',
      });
      project = addCreativeDirections(project, [
        {
          id: 'editorial',
          title: 'Editorial launch',
          rationale: 'Lead with narrative scale and restrained typography.',
          criterionRefs: ['hierarchy', 'typography'],
        },
        {
          id: 'product-demo',
          title: 'Product demonstration',
          rationale: 'Lead with the interaction and a compact proof sequence.',
          criterionRefs: ['clarity', 'motion'],
        },
      ], '2026-07-30T12:01:00.000Z');
      project = recordCreativeDecision(project, {
        directionId: 'editorial',
        outcome: 'selected',
        reason: 'The narrative hierarchy matches the launch brief.',
        evidenceRef: { assetId: 'asset-direction-board' },
        decidedAt: '2026-07-30T12:02:00.000Z',
      });
      project = attachCreativeAsset(project, {
        stage: 'image',
        assetRef: { assetId: 'asset-hero', kind: 'image' },
        parentAssetIds: ['asset-direction-board'],
        createdAt: '2026-07-30T12:03:00.000Z',
      });
      project = switchCreativeExecution(project, {
        runtimeId: 'codex_runtime',
        providerId: 'provider-b',
        modelId: 'model-b',
        changedAt: '2026-07-30T12:04:00.000Z',
      });
      project = markCreativeStageUnsupported(project, {
        stage: 'video',
        reason: 'The selected Provider has no video producer.',
        recordedAt: '2026-07-30T12:05:00.000Z',
      });
      const saved = writeCreativeProject(repo, {
        project,
        sourceRef: 'creative-project:test',
      });
      assert.equal(saved.status, 'created');
      const reloaded = listCreativeProjects(repo)[0]?.project;
      assert.ok(reloaded);
      assert.equal(reloaded.methodRef, 'web.hierarchy');
      assert.equal(reloaded.directions.length, 2);
      assert.deepEqual(
        reloaded.executionHistory.map((entry) => entry.runtimeId),
        ['codepilot_runtime', 'codex_runtime'],
      );
      assert.deepEqual(reloaded.assets[0]?.parentAssetIds, [
        'asset-direction-board',
      ]);
      assert.equal(reloaded.unsupported[0]?.stage, 'video');
    } finally {
      repo.close();
    }
  });
});
