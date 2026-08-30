import '../db-isolation.setup';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RUNTIME_IDS,
  isRuntimeId,
  parseRuntimeId,
  serializeRuntimeId,
} from '@/lib/runtime/runtime-id';
import {
  BUILTIN_RUNTIME_REGISTRATIONS,
  assertPackagedRuntimeDrivers,
} from '@/lib/runtime/runtime-catalog';
import {
  buildCapabilityMatrix,
} from '@/lib/harness/capability-matrix';
import {
  adaptForClaudeCode,
  adaptForCodexProxy,
  adaptForNative,
} from '@/lib/harness/runtime-adapter';
import {
  HARNESS_HOME_SCHEMA_VERSION,
  FileHarnessRepository,
  assertCodePilotFullReference,
  hashBytes,
  listRuntimeDescriptors,
  projectCanonicalRepository,
  renderCanonicalHarnessFragment,
  requireRuntimeDescriptor,
  writeCanonicalDefinition,
  type HarnessHomeManifest,
  type PortableContentRef,
  type Provenance,
} from '@/lib/harness-home';
import {
  HARNESS_HOME_ROOT_SETTING,
  loadConfiguredHarnessHome,
} from '@/lib/harness-home/runtime/configured';
import { setSetting } from '@/lib/db';

const tempRoots: string[] = [];

afterEach(() => {
  setSetting(HARNESS_HOME_ROOT_SETTING, '');
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const provenance: Provenance = {
  sourceKind: 'host_application',
  sourceRef: 'harness-home-runtime-conformance',
  observedAt: '2026-07-30T12:00:00.000Z',
  secretMaterial: 'absent',
};

function contentRef(
  id: string,
  relativePath: string,
  content: string,
): PortableContentRef {
  return {
    id,
    path: relativePath,
    contentHash: hashBytes(content),
    provenance,
  };
}

function createCanonicalFixture(): {
  repository: FileHarnessRepository;
  root: string;
  contents: Readonly<Record<string, string>>;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-runtime-'));
  tempRoots.push(root);
  const repository = FileHarnessRepository.create(root, 'runtime-fixture', {
    mode: 'require-writable',
    instanceId: 'runtime-conformance',
  });
  const contents = {
    'identity/user.md': 'You are the user-owned research assistant.',
    'rules/concise.md': 'Prefer concise, source-backed answers.',
    'memory/current.md': 'The current project is Harness Home.',
    'methods/visual.md': 'Use hierarchy before decoration.',
    'skills/private/SKILL.md': 'DO_NOT_INJECT_UNMOUNTED_SKILL_BODY',
    'mcp/catalog.json': '{"name":"catalog-only","command":"catalog-command"}',
    'overlays/codepilot.md': 'CodePilot overlay: use the native artifact path.',
  } as const;
  const refs = Object.fromEntries(
    Object.entries(contents).map(([relativePath, content]) => [
      relativePath,
      contentRef(relativePath, relativePath, content),
    ]),
  ) as Record<keyof typeof contents, PortableContentRef>;
  const current = repository.manifest;
  const manifest: HarnessHomeManifest = {
    ...current,
    schemaVersion: HARNESS_HOME_SCHEMA_VERSION,
    generation: 1,
    writtenAt: '2026-07-30T12:01:00.000Z',
    definition: {
      ...current.definition,
      identityRefs: [refs['identity/user.md']],
      ruleRefs: [refs['rules/concise.md']],
      skillRefs: [refs['skills/private/SKILL.md']],
      mcpRefs: [refs['mcp/catalog.json']],
      creativeMethodRefs: [refs['methods/visual.md']],
    },
    state: {
      ...current.state,
      memoryRefs: [refs['memory/current.md']],
    },
    assetRefs: [{ assetId: 'asset-image-1', kind: 'image' }],
    runtimeOverlays: {
      codepilot_runtime: {
        runtimeId: 'codepilot_runtime',
        definitionRefs: [refs['overlays/codepilot.md']],
        stateRefs: [],
      },
    },
    secretRefs: [{
      scheme: 'secret',
      namespace: 'environment',
      key: 'HARNESS_FIXTURE_TOKEN',
      scope: 'user',
      version: 1,
    }],
  };
  repository.commit({
    expectedGeneration: 0,
    manifest,
    writes: Object.entries(contents).map(([relativePath, content]) => ({
      path: relativePath,
      content,
    })),
  });
  return { repository, root, contents };
}

describe('Harness Home Runtime descriptor conformance', () => {
  it('derives the wire ID set from explicit packaged registrations', () => {
    assert.deepEqual(
      RUNTIME_IDS,
      BUILTIN_RUNTIME_REGISTRATIONS.map((entry) => entry.id),
    );
    assert.deepEqual(
      listRuntimeDescriptors().map((entry) => entry.id),
      RUNTIME_IDS,
    );
    for (const id of RUNTIME_IDS) {
      assert.equal(isRuntimeId(id), true);
      assert.equal(parseRuntimeId(id), id);
      assert.equal(serializeRuntimeId(id), id);
    }
    assert.equal(isRuntimeId('unregistered-runtime'), false);
    assert.throws(
      () => parseRuntimeId('unregistered-runtime'),
      /not registered/,
    );
  });

  it('fails packaged startup when a descriptor driver is missing', () => {
    const drivers = new Set<string>(
      BUILTIN_RUNTIME_REGISTRATIONS.map((entry) => entry.driverId),
    );
    assert.doesNotThrow(() =>
      assertPackagedRuntimeDrivers((driverId) => drivers.has(driverId)));
    drivers.delete('native');
    assert.throws(
      () => assertPackagedRuntimeDrivers((driverId) => drivers.has(driverId)),
      /missing packaged driver "native"/,
    );
  });

  it('makes CodePilot the full reference and keeps stable capabilities real', () => {
    assert.doesNotThrow(assertCodePilotFullReference);
    const reference = requireRuntimeDescriptor('codepilot_runtime');
    assert.equal(reference.integrationLevel, 'full');
    assert.ok(reference.capabilities.length > 0);
    for (const capability of reference.capabilities) {
      if (capability.maturity === 'stable') {
        assert.equal(capability.referenceStatus, 'executable');
        assert.equal(capability.execution, 'executable');
      }
    }
    assert.throws(
      () => requireRuntimeDescriptor('future-runtime'),
      /not registered/,
    );
  });

  it('derives capability rows and Settings metadata from registered descriptors', () => {
    const matrix = buildCapabilityMatrix();
    assert.deepEqual(Object.keys(matrix), RUNTIME_IDS);
    for (const descriptor of listRuntimeDescriptors()) {
      assert.equal(descriptor.packagedRegistration, 'explicit');
      assert.equal(descriptor.eventContract, 'canonical-runtime-events-v1');
      assert.equal(
        descriptor.permissionContract,
        'canonical-runtime-permissions-v1',
      );
      assert.equal(descriptor.artifactContract, 'canonical-artifacts-v1');
      assert.equal(
        descriptor.capabilities.length,
        matrix[descriptor.id as keyof typeof matrix].length,
      );
    }
  });
});

describe('Canonical repository Runtime projection', () => {
  it('projects traceable context, overlay, assets and perceptible-only definitions', () => {
    const fixture = createCanonicalFixture();
    try {
      const harness = projectCanonicalRepository({
        repository: fixture.repository,
        runtimeId: 'codepilot_runtime',
      });
      assert.deepEqual(
        harness.sections.map((section) => section.kind),
        [
          'identity',
          'rule',
          'memory',
          'runtime_overlay',
        ],
      );
      assert.equal(harness.projection.assetRefs[0]?.assetId, 'asset-image-1');
      assert.deepEqual(
        harness.definitions.map((entry) => [entry.kind, entry.execution]),
        [
          ['skill', 'perceptible_only'],
          ['mcp', 'perceptible_only'],
        ],
      );
      assert.ok(
        harness.projection.executableCapabilities.every(
          (capability) => capability.referenceStatus === 'executable',
        ),
      );
    } finally {
      fixture.repository.close();
    }
  });

  it('renders real canonical context but never injects unmounted definition bodies', () => {
    const fixture = createCanonicalFixture();
    try {
      const harness = projectCanonicalRepository({
        repository: fixture.repository,
        runtimeId: 'codepilot_runtime',
      });
      const rendered = renderCanonicalHarnessFragment(harness);
      assert.match(rendered, /user-owned research assistant/);
      assert.match(rendered, /Source file: identity\/user\.md/);
      assert.match(rendered, /catalogued, not mounted by this projection/);
      assert.match(rendered, /skills\/private\/SKILL\.md/);
      assert.doesNotMatch(rendered, /DO_NOT_INJECT_UNMOUNTED_SKILL_BODY/);
      assert.doesNotMatch(rendered, /catalog-command/);
    } finally {
      fixture.repository.close();
    }
  });

  it('injects the same canonical generation through all three Runtime facades', () => {
    const fixture = createCanonicalFixture();
    try {
      const nativeHarness = projectCanonicalRepository({
        repository: fixture.repository,
        runtimeId: 'codepilot_runtime',
      });
      const claudeHarness = projectCanonicalRepository({
        repository: fixture.repository,
        runtimeId: 'claude_code',
      });
      const codexHarness = projectCanonicalRepository({
        repository: fixture.repository,
        runtimeId: 'codex_runtime',
      });
      const common = {
        sessionId: 'session-runtime-conformance',
        providerId: 'fixture-provider',
        model: 'fixture-model',
        userPrompt: 'hello',
        enabledCapabilities: new Set<string>(),
      };
      assert.match(
        adaptForNative({ ...common, canonicalHarness: nativeHarness })
          .systemPromptText,
        /Your canonical Harness Home/,
      );
      assert.match(
        adaptForClaudeCode({ ...common, canonicalHarness: claudeHarness })
          .systemPromptAppend,
        /Your canonical Harness Home/,
      );
      assert.match(
        adaptForCodexProxy({ ...common, canonicalHarness: codexHarness })
          .systemPromptInstructions,
        /Your canonical Harness Home/,
      );
      assert.throws(
        () => adaptForClaudeCode({
          ...common,
          canonicalHarness: nativeHarness,
        }),
        /targets "codepilot_runtime", not "claude_code"/,
      );
    } finally {
      fixture.repository.close();
    }
  });

  it('does not rewrite canonical data when the Runtime changes', () => {
    const fixture = createCanonicalFixture();
    try {
      const before = fixture.repository.manifest;
      projectCanonicalRepository({
        repository: fixture.repository,
        runtimeId: 'claude_code',
      });
      projectCanonicalRepository({
        repository: fixture.repository,
        runtimeId: 'codex_runtime',
      });
      assert.deepEqual(fixture.repository.manifest, before);
    } finally {
      fixture.repository.close();
    }
  });

  it('fails closed on external edits instead of projecting a mixed generation', () => {
    const fixture = createCanonicalFixture();
    try {
      fs.writeFileSync(
        path.join(fixture.root, 'memory/current.md'),
        'externally changed without a manifest generation',
      );
      assert.throws(
        () => projectCanonicalRepository({
          repository: fixture.repository,
          runtimeId: 'codepilot_runtime',
        }),
        /repository is stale/,
      );
    } finally {
      fixture.repository.close();
    }
  });

  it('loads configured roots read-only and reports unresolved Secret metadata only', () => {
    const fixture = createCanonicalFixture();
    fixture.repository.close();
    setSetting(HARNESS_HOME_ROOT_SETTING, fixture.root);
    const result = loadConfiguredHarnessHome('codepilot_runtime');
    assert.equal(result.status, 'loaded');
    if (result.status !== 'loaded') return;
    assert.equal(result.harness.repositoryRoot, fs.realpathSync.native(fixture.root));
    assert.equal(result.secrets[0]?.status, 'unresolved');
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.secrets[0] ?? {}, 'value'),
      false,
    );
  });

  it('creates Skill/MCP definitions canonically with idempotency and hash conflicts', () => {
    const fixture = createCanonicalFixture();
    try {
      const created = writeCanonicalDefinition(fixture.repository, {
        kind: 'skill',
        id: 'visual-review',
        content: '# Visual review\n\nCheck hierarchy and spacing.',
        observedAt: '2026-07-30T12:02:00.000Z',
      });
      assert.equal(created.status, 'created');
      assert.match(created.ref.path, /^definitions\/skill\//);
      const unchanged = writeCanonicalDefinition(fixture.repository, {
        kind: 'skill',
        id: 'visual-review',
        content: '# Visual review\n\nCheck hierarchy and spacing.',
      });
      assert.equal(unchanged.status, 'unchanged');
      assert.equal(unchanged.generation, created.generation);
      assert.throws(
        () => writeCanonicalDefinition(fixture.repository, {
          kind: 'skill',
          id: 'visual-review',
          content: '# Changed without an editor hash',
        }),
        /expectedContentHash/,
      );
      const updated = writeCanonicalDefinition(fixture.repository, {
        kind: 'skill',
        id: 'visual-review',
        content: '# Visual review\n\nCheck hierarchy, spacing and contrast.',
        expectedContentHash: created.ref.contentHash,
      });
      assert.equal(updated.status, 'updated');
      const mcp = writeCanonicalDefinition(fixture.repository, {
        kind: 'mcp',
        id: 'design-catalog',
        content: '{"name":"design-catalog","command":"catalog"}',
      });
      assert.equal(mcp.status, 'created');
      assert.match(mcp.ref.path, /^definitions\/mcp\//);
      assert.throws(
        () => writeCanonicalDefinition(fixture.repository, {
          kind: 'mcp',
          id: 'leaky',
          content: '{"api_key":"sk-exampleSecretValue12345"}',
        }),
        /forbidden secret material/,
      );
    } finally {
      fixture.repository.close();
    }
  });
});

describe('A4 integration boundaries', () => {
  it('wires configured canonical projection at each real Runtime call site', () => {
    const repoRoot = path.resolve(__dirname, '../..');
    for (const relativePath of [
      'lib/claude-client.ts',
      'lib/builtin-tools/index.ts',
      'lib/codex/proxy/unified-adapter.ts',
    ]) {
      const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
      assert.match(source, /loadConfiguredHarnessHome/);
      assert.match(source, /canonicalHarness/);
    }
  });

  it('keeps diagnostics metadata-only and never returns section content', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/harness-home/route.ts'),
      'utf8',
    );
    assert.doesNotMatch(source, /content:\s*section\.content/);
    assert.match(source, /repositoryDeleted:\s*false/);
  });

  it('keeps canonical definition creation separate from external export', () => {
    const source = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../lib/harness-home/runtime/definitions.ts',
      ),
      'utf8',
    );
    assert.match(source, /writeCanonicalDefinition/);
    assert.doesNotMatch(source, /\.(?:claude|codex)[/\\]/i);
    assert.doesNotMatch(source, /exportPlan|writeFileSync/);
  });
});
