import '../db-isolation.setup';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import {
  GET as methodsGET,
  POST as methodsPOST,
} from '@/app/api/harness-home/design-methods/route';
import {
  DELETE as tasteDELETE,
  GET as tasteGET,
  POST as tastePOST,
} from '@/app/api/harness-home/taste-memory/route';
import {
  POST as projectsPOST,
} from '@/app/api/harness-home/creative-projects/route';
import {
  FileHarnessRepository,
  hashBytes,
} from '@/lib/harness-home/repository';
import type { PortableContentRef } from '@/lib/harness-home';
import {
  HARNESS_HOME_ROOT_SETTING,
} from '@/lib/harness-home/runtime/configured';
import { setSetting } from '@/lib/db';

const roots: string[] = [];

afterEach(() => {
  setSetting(HARNESS_HOME_ROOT_SETTING, '');
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function configureRepository(): {
  root: string;
  evidenceRef: PortableContentRef;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-design-api-'));
  roots.push(root);
  const repository = FileHarnessRepository.create(root, 'design-api', {
    mode: 'require-writable',
    instanceId: 'design-api-setup',
  });
  const evidenceContent = 'User selected variation 2 and rejected variation 1.';
  const evidenceRef: PortableContentRef = {
    id: 'review:variation-2',
    path: 'state/feedback/variation-2.md',
    contentHash: hashBytes(evidenceContent),
    mediaType: 'text/markdown',
    provenance: {
      sourceKind: 'user_file',
      sourceRef: 'user-review:variation-2',
      observedAt: '2026-07-30T12:00:00.000Z',
      secretMaterial: 'absent',
    },
  };
  const manifest = repository.manifest;
  repository.commit({
    expectedGeneration: manifest.generation,
    manifest: {
      ...manifest,
      generation: manifest.generation + 1,
      writtenAt: '2026-07-30T12:00:00.000Z',
      state: {
        ...manifest.state,
        feedbackRefs: [evidenceRef],
      },
    },
    writes: [{ path: evidenceRef.path, content: evidenceContent }],
  });
  repository.close();
  setSetting(HARNESS_HOME_ROOT_SETTING, root);
  return { root, evidenceRef };
}

function jsonRequest(url: string, method: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Harness Home Design APIs', () => {
  it('exposes candidate Method metadata without making it active', async () => {
    configureRepository();
    const response = await methodsPOST(jsonRequest(
      '/api/harness-home/design-methods',
      'POST',
      {
        id: 'candidate.web',
        version: '0.1.0',
        status: 'candidate',
        title: 'Candidate web method',
        summary: 'A candidate awaiting user review.',
        scope: { kind: 'user' },
        triggers: ['landing page'],
        nonTriggers: [],
        inputs: ['brief'],
        outputs: ['directions'],
        steps: ['Clarify the brief.'],
        modalities: ['text'],
        referenceRefs: [],
        counterexampleRefs: [],
        critiqueCriteria: ['The direction answers the brief.'],
        changelog: [{
          version: '0.1.0',
          changedAt: '2026-07-30T12:00:00.000Z',
          summary: 'Candidate created from a real review packet.',
        }],
        overridePolicy: {
          userEditable: true,
          projectOverride: true,
        },
        sourceRef: 'review-packet:candidate-web',
        observedAt: '2026-07-30T12:00:00.000Z',
      },
    ));
    assert.equal(response.status, 201);

    const list = await methodsGET();
    const payload = await list.json() as {
      methods: { id: string; status: string; guideRef: { path: string } }[];
    };
    assert.deepEqual(
      payload.methods.map(({ id, status }) => ({ id, status })),
      [{ id: 'candidate.web', status: 'candidate' }],
    );
    assert.match(payload.methods[0]?.guideRef.path ?? '', /\.md$/);
  });

  it('lets the user view and revoke evidence-backed Taste Memory', async () => {
    const { evidenceRef } = configureRepository();
    const create = await tastePOST(jsonRequest(
      '/api/harness-home/taste-memory',
      'POST',
      {
        id: 'taste-one-off',
        preferenceKey: 'hero.composition',
        classification: 'one_off',
        statement: 'Use the left-aligned hero for this variation.',
        evidenceRef,
        scope: { kind: 'project', projectId: '/workspace/launch' },
        confidence: 1,
        affectedMethodIds: ['candidate.web'],
        sourceRef: 'user-selection:variation-2',
        observedAt: '2026-07-30T12:00:00.000Z',
      },
    ));
    assert.equal(create.status, 201);

    let list = await tasteGET();
    let payload = await list.json() as {
      tasteMemories: {
        id: string;
        revokedAt?: string;
        contentHash: string;
      }[];
    };
    assert.equal(payload.tasteMemories[0]?.id, 'taste-one-off');
    assert.equal(payload.tasteMemories[0]?.revokedAt, undefined);

    const remove = await tasteDELETE(jsonRequest(
      '/api/harness-home/taste-memory',
      'DELETE',
      {
        id: 'taste-one-off',
        reason: 'This was only for one discarded variation.',
        expectedContentHash: payload.tasteMemories[0]?.contentHash,
      },
    ));
    assert.equal(remove.status, 200);

    list = await tasteGET();
    payload = await list.json() as typeof payload;
    assert.ok(payload.tasteMemories[0]?.revokedAt);
  });

  it('rejects made-up evidence ids at the application write boundary', async () => {
    configureRepository();
    const response = await tastePOST(jsonRequest(
      '/api/harness-home/taste-memory',
      'POST',
      {
        id: 'taste-fake',
        preferenceKey: 'hero.composition',
        classification: 'one_off',
        statement: 'Pretend this preference has evidence.',
        evidenceRef: { assetId: 'asset-does-not-exist', kind: 'image' },
        scope: { kind: 'user' },
        confidence: 1,
        affectedMethodIds: [],
        sourceRef: 'test:fake-evidence',
      },
    ));
    assert.equal(response.status, 409);
    assert.match(
      String((await response.json() as { error?: string }).error),
      /does not exist/,
    );
  });

  it('rejects unknown Taste classifications and malformed scopes', async () => {
    const { evidenceRef } = configureRepository();
    for (const [classification, scope] of [
      ['durable-user-preference', { kind: 'user' }],
      ['one_off', { kind: 'project' }],
      ['one_off', undefined],
    ] as const) {
      const response = await tastePOST(jsonRequest(
        '/api/harness-home/taste-memory',
        'POST',
        {
          id: `taste-invalid-${classification}-${scope?.kind || 'missing'}`,
          preferenceKey: 'hero.composition',
          classification,
          statement: 'This invalid record must never reach the repository.',
          evidenceRef,
          scope,
          confidence: 1,
          affectedMethodIds: [],
          sourceRef: 'test:invalid-contract',
        },
      ));
      assert.equal(response.status, 409);
      assert.match(
        String((await response.json() as { error?: string }).error),
        /classification|scope|projectId/i,
      );
    }
  });

  it('rejects creative projects with unresolved methods or decision evidence', async () => {
    const { evidenceRef } = configureRepository();
    const method = await methodsPOST(jsonRequest(
      '/api/harness-home/design-methods',
      'POST',
      {
        id: 'candidate.web',
        version: '0.1.0',
        status: 'candidate',
        title: 'Candidate web method',
        summary: 'A candidate awaiting user review.',
        scope: { kind: 'user' },
        triggers: ['landing page'],
        nonTriggers: [],
        inputs: ['brief'],
        outputs: ['directions'],
        steps: ['Clarify the brief.'],
        modalities: ['text'],
        referenceRefs: [],
        counterexampleRefs: [],
        critiqueCriteria: ['The direction answers the brief.'],
        changelog: [{
          version: '0.1.0',
          changedAt: '2026-07-30T12:00:00.000Z',
          summary: 'Candidate created from a real review packet.',
        }],
        overridePolicy: { userEditable: true, projectOverride: true },
        sourceRef: 'review-packet:candidate-web',
        observedAt: '2026-07-30T12:00:00.000Z',
      },
    ));
    assert.equal(method.status, 201);

    const baseProject = {
      id: 'launch-site',
      brief: 'Create the launch site.',
      scope: { kind: 'project', projectId: '/workspace/launch' },
      methodRef: 'candidate.web',
      methodVersion: '0.1.0',
      createdAt: '2026-07-30T12:00:00.000Z',
      updatedAt: '2026-07-30T12:01:00.000Z',
      directions: [{
        id: 'direction-a',
        title: 'Editorial',
        rationale: 'Use an editorial hierarchy.',
        criterionRefs: ['hierarchy'],
      }],
      decisions: [{
        directionId: 'direction-a',
        outcome: 'selected',
        reason: 'The user selected this direction.',
        evidenceRef,
        decidedAt: '2026-07-30T12:01:00.000Z',
      }],
      assets: [],
      executionHistory: [{
        runtimeId: 'codepilot_runtime',
        providerId: 'provider',
        modelId: 'model',
        changedAt: '2026-07-30T12:00:00.000Z',
      }],
      unsupported: [],
    } as const;

    const unknownMethod = await projectsPOST(jsonRequest(
      '/api/harness-home/creative-projects',
      'POST',
      {
        project: { ...baseProject, methodRef: 'missing.method' },
        sourceRef: 'test:unknown-method',
      },
    ));
    assert.equal(unknownMethod.status, 409);
    assert.match(
      String((await unknownMethod.json() as { error?: string }).error),
      /method .* does not exist/i,
    );

    const fakeEvidence = await projectsPOST(jsonRequest(
      '/api/harness-home/creative-projects',
      'POST',
      {
        project: {
          ...baseProject,
          decisions: [{
            ...baseProject.decisions[0],
            evidenceRef: { assetId: 'asset-does-not-exist' },
          }],
        },
        sourceRef: 'test:fake-decision-evidence',
      },
    ));
    assert.equal(fakeEvidence.status, 409);
    assert.match(
      String((await fakeEvidence.json() as { error?: string }).error),
      /does not exist/,
    );
  });
});
