/**
 * Phase 5e Phase 1 (2026-05-17) — HarnessBundle contract tests.
 *
 * Pins:
 *   1. Three-layer round-trip: builtin / user / external must each be
 *      addressable in the bundle.
 *   2. `executable === false` requires `perceptionHint` — builder
 *      throws on missing hint. Phase 5e contract: 感知 ≠ 可执行,
 *      but UI / model MUST get a string saying why and where to
 *      switch.
 *   3. `forceUnavailable` honoured — Phase 3 Codex Account degradation
 *      flips capabilities to unavailable with `reason` + optional
 *      `suggestedRuntime`.
 *   4. Diagnostics count perception-only entries across BOTH user
 *      and external layers (Settings UI needs the count to show a
 *      banner).
 *   5. Capability decisions cover every attempted capability — no
 *      silent omissions.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHarnessBundle,
  bundleExecutableCapabilities,
  bundlePerceptionOnlyExtensions,
} from '@/lib/harness/harness-bundle';
import {
  HARNESS_CAPABILITIES,
} from '@/lib/harness/capability-contract';

const baseInput = {
  runtimeId: 'claude_code' as const,
  providerId: 'test-prov',
  attemptedCapabilities: new Set(['widget', 'memory']),
};

describe('HarnessBundle — three-layer round-trip', () => {
  it('builds with empty user + external layers (built-in only path)', () => {
    const bundle = buildHarnessBundle(baseInput);
    assert.ok(bundle.builtinCapabilities.length >= 1);
    assert.deepEqual(bundle.userCapabilities, []);
    assert.deepEqual(bundle.externalExtensions, []);
    assert.equal(bundle.diagnostics.perceptionOnlyCount, 0);
  });

  it('preserves user extensions in the bundle (executable=true case)', () => {
    const bundle = buildHarnessBundle({
      ...baseInput,
      userCapabilities: [
        {
          kind: 'mcp_server',
          origin: 'codepilot_settings',
          id: 'mcp:my-server',
          displayName: 'my-server',
          executable: true,
        },
      ],
    });
    assert.equal(bundle.userCapabilities.length, 1);
    assert.equal(bundle.userCapabilities[0].id, 'mcp:my-server');
  });

  it('preserves external extensions (executable=true case — same framework as Runtime)', () => {
    const bundle = buildHarnessBundle({
      ...baseInput,
      externalExtensions: [
        {
          framework: 'claude_code',
          kind: 'mcp_server',
          origin: '/home/user/.claude/mcp.json',
          id: 'claude:mcp:weather',
          displayName: 'weather (ClaudeCode MCP)',
          executable: true,
        },
      ],
    });
    assert.equal(bundle.externalExtensions.length, 1);
  });
});

describe('HarnessBundle — executable=false requires perceptionHint', () => {
  it('throws when a UserHarnessExtension has executable=false but no hint', () => {
    assert.throws(
      () =>
        buildHarnessBundle({
          ...baseInput,
          userCapabilities: [
            {
              kind: 'mcp_server',
              origin: 'codepilot_settings',
              id: 'mcp:x',
              displayName: 'x',
              executable: false,
              // missing perceptionHint
            },
          ],
        }),
      /perceptionHint/,
      'Builder must reject perception-only user extension without hint',
    );
  });

  it('throws when an ExternalFrameworkHarnessRef has executable=false but no hint', () => {
    assert.throws(
      () =>
        buildHarnessBundle({
          ...baseInput,
          externalExtensions: [
            {
              framework: 'claude_code',
              kind: 'mcp_server',
              origin: '/x',
              id: 'claude:mcp:y',
              displayName: 'y',
              executable: false,
              // missing perceptionHint
            },
          ],
        }),
      /perceptionHint/,
    );
  });

  it('accepts perception-only entry WITH hint + counts toward perceptionOnlyCount', () => {
    const bundle = buildHarnessBundle({
      ...baseInput,
      externalExtensions: [
        {
          framework: 'codex',
          kind: 'plugin',
          origin: '/home/user/.codex/plugins/foo',
          id: 'codex:plugin:foo',
          displayName: 'foo (Codex plugin)',
          executable: false,
          perceptionHint:
            '检测到 ~/.codex/plugins/foo；当前 Runtime 不可调用，请切到 Codex Runtime。',
        },
      ],
    });
    assert.equal(bundle.externalExtensions.length, 1);
    assert.equal(bundle.diagnostics.perceptionOnlyCount, 1);
  });

  it('counts BOTH user and external perception-only entries (split helper)', () => {
    const bundle = buildHarnessBundle({
      ...baseInput,
      userCapabilities: [
        {
          kind: 'skill',
          origin: 'codepilot_settings',
          id: 'skill:x',
          displayName: 'x',
          executable: false,
          perceptionHint: '切到 Native Runtime 才能运行。',
        },
      ],
      externalExtensions: [
        {
          framework: 'codex',
          kind: 'cli',
          origin: '/x',
          id: 'codex:cli:y',
          displayName: 'y',
          executable: false,
          perceptionHint: '切到 Codex Runtime 才能运行。',
        },
      ],
    });
    assert.equal(bundle.diagnostics.perceptionOnlyCount, 2);
    const split = bundlePerceptionOnlyExtensions(bundle);
    assert.equal(split.user.length, 1);
    assert.equal(split.external.length, 1);
  });
});

describe('HarnessBundle — forceUnavailable (Codex Account degradation)', () => {
  it('flips a capability to unavailable with the supplied reason + suggested runtime', () => {
    const bundle = buildHarnessBundle({
      runtimeId: 'codex_runtime',
      providerId: 'codex_account',
      attemptedCapabilities: new Set(['widget', 'memory']),
      forceUnavailable: new Map([
        [
          'widget',
          {
            reason:
              'Codex Account 协议不支持挂载第三方工具。如需 Widget，请切到 Native Runtime 或 ClaudeCode SDK。',
            suggestedRuntime: 'codepilot_runtime' as const,
          },
        ],
      ]),
    });
    const widgetCell = bundle.unavailableCapabilities.find(
      (c) => c.capabilityId === 'widget',
    );
    assert.ok(widgetCell);
    assert.equal(widgetCell!.suggestedRuntime, 'codepilot_runtime');
    assert.match(widgetCell!.reason, /Codex Account/);

    // widget MUST NOT appear in builtinCapabilities (forced
    // unavailable overrides exposure).
    assert.equal(
      bundle.builtinCapabilities.find((b) => b.capabilityId === 'widget'),
      undefined,
    );
  });
});

describe('HarnessBundle — diagnostic decisions', () => {
  it('records a decision for every attempted capability', () => {
    const attempted = new Set(['widget', 'memory', 'tasks_and_notify']);
    const bundle = buildHarnessBundle({
      runtimeId: 'claude_code',
      providerId: 'test',
      attemptedCapabilities: attempted,
    });
    const ids = new Set(
      bundle.diagnostics.capabilityDecisions
        .filter((d) => d.outcome !== 'user_extension' && d.outcome !== 'external_perception_only')
        .map((d) => d.capabilityId),
    );
    for (const id of attempted) {
      assert.ok(ids.has(id), `no decision recorded for "${id}"`);
    }
  });

  it('omits capabilities the caller did not attempt (no silent decisions)', () => {
    const bundle = buildHarnessBundle({
      runtimeId: 'claude_code',
      providerId: 'test',
      attemptedCapabilities: new Set(['widget']),
    });
    // memory wasn't attempted; bundle must NOT emit a decision for it.
    const memDecision = bundle.diagnostics.capabilityDecisions.find(
      (d) => d.capabilityId === 'memory',
    );
    assert.equal(memDecision, undefined);
  });
});

describe('HarnessBundle — deferred + unsupported capabilities', () => {
  it('emits deferred capabilities (e.g. dashboard) as unavailable when attempted', () => {
    const bundle = buildHarnessBundle({
      runtimeId: 'codex_runtime',
      providerId: 'codex_account',
      attemptedCapabilities: new Set(['dashboard']),
    });
    // dashboard.status === 'deferred' in capability-contract → must
    // be in unavailable, not in builtinCapabilities.
    assert.equal(
      bundle.builtinCapabilities.find((b) => b.capabilityId === 'dashboard'),
      undefined,
    );
    const cell = bundle.unavailableCapabilities.find((c) => c.capabilityId === 'dashboard');
    assert.ok(cell, 'dashboard must surface in unavailableCapabilities');
    assert.ok(cell!.reason.length > 0);
  });

  it('every live capability is reachable as builtin or unavailable (no silent drop)', () => {
    const live = HARNESS_CAPABILITIES.filter((c) => c.status === 'live').map((c) => c.id);
    const bundle = buildHarnessBundle({
      runtimeId: 'claude_code',
      providerId: 'test',
      attemptedCapabilities: new Set(live),
    });
    const built = new Set(bundle.builtinCapabilities.map((b) => b.capabilityId));
    const unavail = new Set(bundle.unavailableCapabilities.map((u) => u.capabilityId));
    for (const id of live) {
      assert.ok(
        built.has(id) || unavail.has(id),
        `live capability "${id}" must be in builtin or unavailable (got dropped silently)`,
      );
    }
  });
});

describe('HarnessBundle — accessors', () => {
  it('bundleExecutableCapabilities returns only executable=true entries', () => {
    const bundle = buildHarnessBundle({
      runtimeId: 'claude_code',
      providerId: 'test',
      attemptedCapabilities: new Set(['widget']),
    });
    const all = bundleExecutableCapabilities(bundle);
    for (const c of all) assert.equal(c.executable, true);
  });
});
