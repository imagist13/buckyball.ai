import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DescriptorRegistry,
  HARNESS_HOME_SCHEMA_VERSION,
  assertNoSecretMaterial,
  buildRuntimeProjection,
  formatSecretRef,
  highestPrecedenceValue,
  parseHarnessHomeManifest,
  parseSecretRef,
  resolveScopedValues,
  serializeHarnessHomeManifest,
  validateCanonicalCapability,
  validateTasteMemoryEvidence,
  type HarnessHomeManifest,
  type SecretRef,
} from '@/lib/harness-home';

function manifestFixture(): HarnessHomeManifest {
  return {
    schemaVersion: HARNESS_HOME_SCHEMA_VERSION,
    harnessId: 'user-harness',
    generation: 3,
    writtenAt: '2026-07-30T12:00:00.000Z',
    definition: {
      identityRefs: [],
      ruleRefs: [],
      skillRefs: [],
      mcpRefs: [],
      creativeMethodRefs: [],
    },
    state: {
      memoryRefs: [],
      preferenceRefs: [],
      feedbackRefs: [],
    },
    assetRefs: [],
    runtimeOverlays: {
      'future-runtime': {
        runtimeId: 'future-runtime',
        definitionRefs: [],
        stateRefs: [],
        data: { unknownProtocolField: 'preserve-me' },
        adapterPrivateFlag: true,
      },
    },
    secretRefs: [],
    futureTopLevel: { nested: ['preserve-me'] },
  };
}

describe('Harness Home contract', () => {
  it('keeps the core contract framework-neutral', () => {
    const contractDir = path.resolve(__dirname, '../../lib/harness-home');
    const sources = fs.readdirSync(contractDir)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => fs.readFileSync(path.join(contractDir, name), 'utf8'))
      .join('\n');

    assert.doesNotMatch(sources, /\.(?:claude|codex)(?:[\\/`'"]|$)/i);
    assert.doesNotMatch(
      sources,
      /readonly\s+(?:claude_code|codepilot_runtime|codex_runtime)\s*:/,
    );
  });

  it('round-trips unknown Runtime overlays and manifest fields', () => {
    const original = manifestFixture();
    const serialized = serializeHarnessHomeManifest(original);
    const parsed = parseHarnessHomeManifest(JSON.parse(serialized));

    assert.deepEqual(parsed, original);
    assert.equal(
      parsed.runtimeOverlays['future-runtime'].data?.unknownProtocolField,
      'preserve-me',
    );
  });

  it('rejects unsafe relative content paths', () => {
    const fixture = manifestFixture() as unknown as Record<string, unknown>;
    const definition = fixture.definition as Record<string, unknown>;
    definition.skillRefs = [{
      id: 'escape',
      path: '../outside/SKILL.md',
      contentHash: 'sha256:abc',
    }];
    assert.throws(
      () => parseHarnessHomeManifest(fixture),
      /repository-relative safe path/,
    );
  });

  it('fails closed when a manifest contains inline Secret material', () => {
    const fixture = {
      ...manifestFixture(),
      provider: { apiKey: 'sk-exampleSecretValue12345' },
    };
    assert.throws(
      () => parseHarnessHomeManifest(fixture),
      /forbidden secret material/,
    );
    assert.throws(
      () => assertNoSecretMaterial({ header: 'Bearer abcdefghijklmnop' }),
      /forbidden secret material/,
    );
  });

  it('serializes SecretRef metadata without resolving it', () => {
    const ref: SecretRef = {
      scheme: 'secret',
      namespace: 'codepilot-provider',
      key: 'provider/primary',
      scope: 'user',
      version: 1,
    };
    const wire = formatSecretRef(ref);
    assert.deepEqual(parseSecretRef(wire), ref);
    assert.doesNotMatch(wire, /api[_-]?key|Bearer/i);
  });

  it('requires stable canonical capabilities to be executable', () => {
    assert.throws(
      () => validateCanonicalCapability({
        id: 'future-capability',
        maturity: 'stable',
        referenceStatus: 'pending',
      }),
      /must be executable/,
    );
    assert.doesNotThrow(() => validateCanonicalCapability({
      id: 'future-capability',
      maturity: 'draft',
      referenceStatus: 'pending',
    }));
  });

  it('keeps pending capabilities perceptible-only in projections', () => {
    const projection = buildRuntimeProjection({
      runtimeId: 'runtime-x',
      capabilities: [
        {
          id: 'stable-live',
          maturity: 'stable',
          referenceStatus: 'executable',
        },
        {
          id: 'draft-pending',
          maturity: 'draft',
          referenceStatus: 'pending',
        },
      ],
      executableCapabilityIds: new Set(['stable-live', 'draft-pending']),
    });
    assert.deepEqual(
      projection.executableCapabilities.map((capability) => capability.id),
      ['stable-live'],
    );
    assert.deepEqual(
      projection.perceptibleOnlyCapabilities.map((capability) => capability.id),
      ['draft-pending'],
    );
  });

  it('resolves project and matching Runtime overlay after user defaults', () => {
    const candidates = [
      { scope: { kind: 'builtin' } as const, value: 'builtin' },
      { scope: { kind: 'user' } as const, value: 'user' },
      {
        scope: { kind: 'assistant', assistantId: 'assistant-1' } as const,
        value: 'assistant',
      },
      {
        scope: { kind: 'project', projectId: 'project-1' } as const,
        value: 'project',
      },
      {
        scope: {
          kind: 'runtime_overlay',
          runtimeId: 'runtime-x',
          base: { kind: 'project', projectId: 'project-1' },
        } as const,
        value: 'runtime-overlay',
      },
    ];
    const context = {
      assistantId: 'assistant-1',
      projectId: 'project-1',
      runtimeId: 'runtime-x',
    };
    assert.deepEqual(
      resolveScopedValues(candidates, context).map(({ value }) => value),
      ['builtin', 'user', 'assistant', 'project', 'runtime-overlay'],
    );
    assert.equal(
      highestPrecedenceValue(candidates, {
        ...context,
        runtimeId: 'another-runtime',
      })?.value,
      'project',
    );
  });

  it('registers opaque descriptor ids and rejects duplicates/unknown ids', () => {
    const registry = new DescriptorRegistry([
      { id: 'framework-a', displayName: 'Framework A' },
    ]);
    registry.register({ id: 'framework-b', displayName: 'Framework B' });
    assert.equal(registry.require('framework-b').displayName, 'Framework B');
    assert.throws(
      () => registry.register({ id: 'framework-a', displayName: 'Again' }),
      /already registered/,
    );
    assert.throws(() => registry.require('missing'), /not registered/);
  });

  it('does not promote unconfirmed taste evidence to durable preference', () => {
    assert.throws(
      () => validateTasteMemoryEvidence({
        id: 'taste-1',
        preferenceKey: 'layout.density',
        classification: 'durable_user_preference',
        statement: 'Prefer compact hierarchy.',
        evidenceRef: { assetId: 'asset-1' },
        scope: { kind: 'user' },
        confidence: 0.8,
        createdAt: '2026-07-30T12:00:00.000Z',
        updatedAt: '2026-07-30T12:00:00.000Z',
        affectedMethodIds: [],
      }),
      /confirmation timestamp/,
    );
  });
});
