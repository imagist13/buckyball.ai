/**
 * Phase 5e review fix P1 #2 (2026-05-18) — HarnessBundle extensions
 * really enter the runtime send path via `runtime-adapter`.
 *
 * Pre-fix: `scanUserCodePilotExtensions` + `scanExternalFrameworkExtensions`
 * existed but were not wired into the runtime adapters, so the User /
 * External Harness layers existed only in Settings UI / tests, never
 * in the model's system prompt. This contract test pins:
 *
 *   1. `renderHarnessExtensionFragment` produces the right shape
 *      (callable / perception sections, ordering, "DO NOT pretend"
 *      hint for perception-only entries).
 *   2. Each adapter (ClaudeCode / Native / Codex proxy) merges the
 *      fragment into its `systemPromptAppend / Text / Instructions`
 *      output when extensions are supplied.
 *   3. Adapter output without extensions is byte-identical to the
 *      pre-fix shape (no regression of existing prompt content).
 *   4. Three runtime entry-point files actually call the scanners and
 *      pass them through (source-pin against the wire-up).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  adaptForClaudeCode,
  adaptForNative,
  adaptForCodexProxy,
  renderHarnessExtensionFragment,
} from '@/lib/harness/runtime-adapter';
import {
  buildHarnessBundle,
  type UserHarnessExtension,
  type ExternalFrameworkHarnessRef,
  type HarnessBundle,
} from '@/lib/harness/harness-bundle';

function bundleWith(opts: {
  userExtensions?: readonly UserHarnessExtension[];
  externalExtensions?: readonly ExternalFrameworkHarnessRef[];
}): HarnessBundle {
  return buildHarnessBundle({
    runtimeId: 'claude_code',
    providerId: 'test',
    attemptedCapabilities: new Set<string>(),
    userCapabilities: opts.userExtensions,
    externalExtensions: opts.externalExtensions,
  });
}

const REPO_ROOT = path.resolve(__dirname, '../../..');
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8');
}

const SAMPLE_USER_EXT: UserHarnessExtension = {
  kind: 'mcp_server',
  origin: 'codepilot_settings',
  id: 'mcp:weather',
  displayName: 'weather',
  executable: true,
};

const SAMPLE_EXTERNAL_PERCEPTION: ExternalFrameworkHarnessRef = {
  framework: 'codex',
  kind: 'plugin',
  origin: '/home/u/.codex/plugins/foo',
  id: 'codex:plugin:foo',
  displayName: 'foo (Codex plugin)',
  executable: false,
  perceptionHint:
    'Detected in your Codex config (~/.codex/plugins/). Not callable in the current Runtime; switch to Codex Runtime to use it.',
};

const SAMPLE_EXTERNAL_EXECUTABLE: ExternalFrameworkHarnessRef = {
  framework: 'claude_code',
  kind: 'mcp_server',
  origin: '/home/u/.claude/mcp.json',
  id: 'claude:mcp:weather',
  displayName: 'weather (ClaudeCode MCP)',
  executable: true,
};

describe('renderHarnessExtensionFragment — shape', () => {
  it('returns empty string when no extensions supplied', () => {
    assert.equal(renderHarnessExtensionFragment(bundleWith({})), '');
    assert.equal(
      renderHarnessExtensionFragment(
        bundleWith({ userExtensions: [], externalExtensions: [] }),
      ),
      '',
    );
  });

  it('emits a "Callable in this Runtime:" section for executable entries', () => {
    const out = renderHarnessExtensionFragment(
      bundleWith({ userExtensions: [SAMPLE_USER_EXT] }),
    );
    assert.match(out, /## Your harness extensions/);
    assert.match(out, /Callable in this Runtime:/);
    assert.match(out, /weather \(user mcp_server\)/);
    assert.equal(
      /Perceptible only/.test(out),
      false,
      'with no perception-only entries the section header must not appear',
    );
  });

  it('emits a "Perceptible only" section with explicit DO-NOT-pretend warning', () => {
    const out = renderHarnessExtensionFragment(
      bundleWith({ externalExtensions: [SAMPLE_EXTERNAL_PERCEPTION] }),
    );
    assert.match(out, /Perceptible only/);
    assert.match(
      out,
      /DO NOT pretend you can invoke them/,
      'perception section must explicitly warn the model not to fabricate calls',
    );
    assert.match(out, /foo \(Codex plugin\)/);
    assert.match(out, /switch to Codex Runtime/);
  });

  it('produces both sections when entries span executable + perception', () => {
    const out = renderHarnessExtensionFragment(
      bundleWith({
        userExtensions: [SAMPLE_USER_EXT],
        externalExtensions: [SAMPLE_EXTERNAL_EXECUTABLE, SAMPLE_EXTERNAL_PERCEPTION],
      }),
    );
    const callableIdx = out.indexOf('Callable in this Runtime:');
    const perceptionIdx = out.indexOf('Perceptible only');
    assert.ok(callableIdx > 0);
    assert.ok(perceptionIdx > callableIdx, 'callable section must come before perception');
  });

  // Phase 5e review round 3 fix P1 #A — builder strong-validation:
  // executable=false WITHOUT perceptionHint must throw at the
  // buildHarnessBundle stage, NOT silently render a default fallback.
  it('builder throws when a non-executable entry lacks perceptionHint (no silent default)', () => {
    assert.throws(
      () =>
        buildHarnessBundle({
          runtimeId: 'claude_code',
          providerId: 'test',
          attemptedCapabilities: new Set<string>(),
          externalExtensions: [
            {
              framework: 'codex',
              kind: 'plugin',
              origin: '/x',
              id: 'codex:plugin:nohint',
              displayName: 'nohint',
              executable: false,
              // perceptionHint INTENTIONALLY omitted — builder must reject
            },
          ],
        }),
      /perceptionHint/,
      'builder must throw on missing perceptionHint instead of letting the fragment renderer fall back to a default',
    );
  });
});

describe('adaptForClaudeCode — extension fragment merging', () => {
  it('output without extensions matches the pre-fix capability-only shape', () => {
    const base = adaptForClaudeCode({
      sessionId: 'sess-1',
      providerId: 'env',
      model: 'm',
      userPrompt: 'hi',
      enabledCapabilities: new Set(['widget']),
    });
    // pre-fix prompt is just compiled.systemPromptText; no extension
    // fragment when none are supplied.
    assert.equal(base.systemPromptAppend, base.compiled.systemPromptText);
    assert.equal(
      /## Your harness extensions/.test(base.systemPromptAppend),
      false,
    );
  });

  it('includes extension fragment when userExtensions supplied', () => {
    const out = adaptForClaudeCode({
      sessionId: 'sess-2',
      providerId: 'env',
      model: 'm',
      userPrompt: 'hi',
      enabledCapabilities: new Set(['widget']),
      userExtensions: [SAMPLE_USER_EXT],
    });
    assert.match(out.systemPromptAppend, /## Your harness extensions/);
    assert.match(out.systemPromptAppend, /weather \(user mcp_server\)/);
    // capability content still present
    assert.ok(out.compiled.systemPromptText.length > 0);
    assert.ok(out.systemPromptAppend.includes(out.compiled.systemPromptText));
  });

  it('includes perception fragment when externalExtensions supplied with executable=false', () => {
    const out = adaptForClaudeCode({
      sessionId: 'sess-3',
      providerId: 'env',
      model: 'm',
      userPrompt: 'hi',
      enabledCapabilities: new Set(['widget']),
      externalExtensions: [SAMPLE_EXTERNAL_PERCEPTION],
    });
    assert.match(out.systemPromptAppend, /Perceptible only/);
    assert.match(out.systemPromptAppend, /DO NOT pretend/);
  });
});

describe('adaptForNative — extension fragment merging', () => {
  it('merges extension fragment into systemPromptText', () => {
    const out = adaptForNative({
      sessionId: 'sess-n',
      providerId: '',
      model: '',
      userPrompt: '',
      enabledCapabilities: new Set(['widget']),
      userExtensions: [SAMPLE_USER_EXT],
      externalExtensions: [SAMPLE_EXTERNAL_PERCEPTION],
    });
    assert.match(out.systemPromptText, /Callable in this Runtime/);
    assert.match(out.systemPromptText, /Perceptible only/);
  });

  it('output without extensions stays byte-identical to capability-only', () => {
    const out = adaptForNative({
      sessionId: 'sess-n',
      providerId: '',
      model: '',
      userPrompt: '',
      enabledCapabilities: new Set(['widget']),
    });
    assert.equal(out.systemPromptText, out.compiled.systemPromptText);
  });
});

describe('adaptForCodexProxy — extension fragment merging', () => {
  it('merges extension fragment into systemPromptInstructions', () => {
    const out = adaptForCodexProxy({
      sessionId: 'sess-c',
      providerId: 'glm',
      model: 'm',
      userPrompt: '',
      enabledCapabilities: new Set(['widget']),
      externalExtensions: [SAMPLE_EXTERNAL_EXECUTABLE],
    });
    assert.match(out.systemPromptInstructions, /Callable in this Runtime/);
    assert.match(out.systemPromptInstructions, /weather \(ClaudeCode MCP\)/);
  });

  it('output without extensions stays byte-identical to capability-only', () => {
    const out = adaptForCodexProxy({
      sessionId: 'sess-c',
      providerId: 'glm',
      model: 'm',
      userPrompt: '',
      enabledCapabilities: new Set(['widget']),
    });
    assert.equal(out.systemPromptInstructions, out.compiled.systemPromptText);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Runtime entry-point wire-up — source pin
//
// The adapter accepts extensions, but they only matter if the three
// Runtime entry points actually scan + pass them. These pins enforce
// the call sites exist; semantic verification of "what shows up in
// the wire" is covered above via direct adapter calls.
// ─────────────────────────────────────────────────────────────────────

// Phase 5e review round 4 fix P2 #1 — claude-client.ts MUST scan
// + call adapter unconditionally (not gated on enabledCapabilities.size > 0).
// Pre-fix the whole adapter branch lived inside `if (enabledCapabilities.size > 0)`,
// so a turn with no built-in capability gated in (rare but reachable)
// would skip the User / External harness perception fragment too.
describe('claude-client — harness injection NOT gated on enabledCapabilities.size', () => {
  it('claude-client.ts has no `if (enabledCapabilities.size > 0)` guard wrapping the scan + adapter block', () => {
    const src = readSrc('src/lib/claude-client.ts');
    // Strip comments so JSDoc explaining the pre-fix shape doesn't trip
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // The adapter call site is identifiable by `adaptForClaudeCode({`.
    // It must NOT be inside an enabledCapabilities.size > 0 conditional.
    const adapterIdx = stripped.indexOf('adaptForClaudeCode({');
    assert.ok(adapterIdx > 0, 'adaptForClaudeCode call must exist');
    // Walk back to find the nearest opening brace + preceding statement.
    // If a `if (enabledCapabilities.size > 0)` appears in the preceding
    // ~600 chars, it's likely the guard. Phase 5e P2 fix replaces it
    // with a bare block `{ ... }`.
    const preceding = stripped.slice(Math.max(0, adapterIdx - 800), adapterIdx);
    assert.equal(
      /if\s*\(enabledCapabilities\.size\s*>\s*0\)\s*\{[^}]*$/m.test(preceding),
      false,
      'adaptForClaudeCode must NOT be wrapped in `if (enabledCapabilities.size > 0) { ... }` — User/External harness injection has to run even when no built-in capability is gated in',
    );
  });
});

describe('Runtime entry points — scan + pass extensions to adapter', () => {
  it('claude-client.ts scans User + External and forwards to adaptForClaudeCode', () => {
    const src = readSrc('src/lib/claude-client.ts');
    assert.match(
      src,
      /scanUserCodePilotExtensions/,
      'claude-client.ts must call scanUserCodePilotExtensions',
    );
    assert.match(
      src,
      /scanExternalFrameworkExtensions/,
      'claude-client.ts must call scanExternalFrameworkExtensions',
    );
    assert.match(
      src,
      /adaptForClaudeCode\(\{[\s\S]*?userExtensions[\s\S]*?externalExtensions[\s\S]*?\}\)/,
      'claude-client.ts must forward both extension lists into adaptForClaudeCode',
    );
    assert.match(
      src,
      /activeFramework:\s*'claude_code'/,
      'claude-client.ts must tag external scan with activeFramework=claude_code so ClaudeCode-side configs render as executable',
    );
    // Phase 5e review round 3 fix P2 #C — scanner call MUST pass
    // runtimeId so skill / slash get classified per Runtime.
    assert.match(
      src,
      /scanUserCodePilotExtensions\(\{[\s\S]*?runtimeId:\s*'claude_code'[\s\S]*?\}\)/,
      'claude-client.ts must pass runtimeId:"claude_code" to scanUserCodePilotExtensions',
    );
  });

  it('builtin-tools/index.ts scans User + External and forwards to adaptForNative', () => {
    const src = readSrc('src/lib/builtin-tools/index.ts');
    assert.match(src, /scanUserCodePilotExtensions/);
    assert.match(src, /scanExternalFrameworkExtensions/);
    assert.match(
      src,
      /adaptForNative\(\{[\s\S]*?userExtensions[\s\S]*?externalExtensions[\s\S]*?\}\)/,
    );
    assert.match(
      src,
      /scanUserCodePilotExtensions\(\{[\s\S]*?runtimeId:\s*'codepilot_runtime'[\s\S]*?\}\)/,
      'builtin-tools/index.ts must pass runtimeId:"codepilot_runtime" so skill / slash render as perception_only on Native',
    );
  });

  it('codex/proxy/unified-adapter.ts scans User + External and forwards to adaptForCodexProxy', () => {
    const src = readSrc('src/lib/codex/proxy/unified-adapter.ts');
    assert.match(src, /scanUserCodePilotExtensions/);
    assert.match(src, /scanExternalFrameworkExtensions/);
    assert.match(
      src,
      /adaptForCodexProxy\(\{[\s\S]*?userExtensions[\s\S]*?externalExtensions[\s\S]*?\}\)/,
    );
    assert.match(
      src,
      /activeFramework:\s*'codex'/,
      'unified-adapter.ts must tag external scan with activeFramework=codex so Codex-side configs render as executable in Codex Runtime',
    );
    assert.match(
      src,
      /scanUserCodePilotExtensions\(\{[\s\S]*?runtimeId:\s*'codex_runtime'[\s\S]*?\}\)/,
      'unified-adapter.ts must pass runtimeId:"codex_runtime" so skill / slash render as perception_only under Codex',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase 5e review round 3 fix P1 #A — adapter MUST go through
// buildHarnessBundle() (strong-validation), not the raw-array
// renderer shortcut.
// ─────────────────────────────────────────────────────────────────────

describe('Adapter — strong-validation via buildHarnessBundle', () => {
  it('runtime-adapter.ts imports buildHarnessBundle (not just types)', () => {
    const src = readSrc('src/lib/harness/runtime-adapter.ts');
    assert.match(
      src,
      /import\s*\{[^}]*\bbuildHarnessBundle\b[^}]*\}\s*from\s*'\.\/harness-bundle'/,
      'runtime-adapter must runtime-import buildHarnessBundle to enforce the strong-validation contract',
    );
  });

  it('each facade calls buildHarnessBundle (via the shared buildBundleAndRender helper)', () => {
    const src = readSrc('src/lib/harness/runtime-adapter.ts');
    // The shared helper centralises the call. Assert both the helper
    // exists and each facade uses it for its runtime id.
    assert.match(
      src,
      /function\s+buildBundleAndRender\(/,
      'runtime-adapter must define buildBundleAndRender helper',
    );
    for (const rid of ['claude_code', 'codepilot_runtime', 'codex_runtime']) {
      assert.match(
        src,
        new RegExp(`buildBundleAndRender\\(input,\\s*'${rid}'\\)`),
        `facade for ${rid} must route through buildBundleAndRender`,
      );
    }
  });

  it('renderHarnessExtensionFragment accepts HarnessBundle (not raw arrays)', () => {
    const src = readSrc('src/lib/harness/runtime-adapter.ts');
    // Signature post-fix: `(bundle: HarnessBundle)`. Pre-fix took
    // raw-array opts which bypassed the builder; that path must be
    // gone.
    assert.match(
      src,
      /renderHarnessExtensionFragment\(bundle:\s*HarnessBundle\)/,
      'renderHarnessExtensionFragment must take HarnessBundle so its perceptionHint contract is enforced',
    );
    // Negative source pin: no fallback default for missing
    // perceptionHint. Earlier shape `perceptionHint ?? 'not callable
    // in the current Runtime'` was the silent default the builder
    // contract forbids.
    assert.equal(
      /perceptionHint\s*\?\?\s*['"]not callable in the current Runtime['"]/.test(src),
      false,
      'no default "not callable in the current Runtime" fallback — builder must enforce hints upstream',
    );
  });
});
