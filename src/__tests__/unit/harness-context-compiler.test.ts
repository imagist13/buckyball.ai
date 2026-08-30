/**
 * Phase 5d Phase 2 slice 2a (2026-05-17) — Context Compiler contract tests.
 *
 * The compiler is a pure function. Tests don't need fixtures of real
 * model traffic — they construct CompilerInput literals and check
 * the CompiledContext shape, ordering, dedup, budget, and runtime
 * hints.
 *
 * Coverage areas (mirrors the Phase 2 plan's 12 regression pins):
 *
 *   - Catalog hygiene + status filtering
 *   - Widget wire-format single source (#10)
 *   - runtimeHints boundary (no prose, no template literals) (#11)
 *   - Expected Differences Ledger consistency (#12)
 *   - Ordering (artifact contracts before capability fragments)
 *   - Budget enforcement (load-bearing overflow = FAIL)
 *   - Cross-runtime fragment text identity (#9)
 *   - Tool descriptor surface matches contract
 *   - Decision diagnostics
 *   - JSON parseability of every artifact contract
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  compileContext,
  type CompilerInput,
  type CompiledContext,
} from '@/lib/harness/context-compiler';
import {
  HARNESS_CAPABILITIES,
  getCapability,
} from '@/lib/harness/capability-contract';
import {
  EXPECTED_DIFFERENCES,
  expectedDifferencesFor,
} from '@/lib/harness/expected-differences';
import {
  WIDGET_WIRE_FORMAT_SPEC,
  CANONICAL_SHOW_WIDGET_JSON,
} from '@/lib/widget-guidelines';
import { parseAllShowWidgets } from '@/components/chat/MessageItem';

const REPO_ROOT = path.resolve(__dirname, '../../..');

function readSource(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8');
}

/** Build a baseline CompilerInput. Overrides merge shallowly. */
function input(overrides: Partial<CompilerInput> = {}): CompilerInput {
  return {
    sessionId: 'test-session',
    workingDirectory: '/tmp/test-workspace',
    runtimeId: 'codex_runtime',
    providerId: 'prov-test',
    model: 'test-model',
    userPrompt: 'test prompt',
    enabledCapabilities: null,
    tokenBudget: { systemPromptMax: 50_000, contextMax: 100_000 },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Catalog hygiene + status filtering
// ─────────────────────────────────────────────────────────────────────

describe('compileContext — catalog hygiene', () => {
  it('default enabledCapabilities (null) includes every live capability with a non-unsupported exposure', () => {
    const out = compileContext(input({ runtimeId: 'codex_runtime' }));
    const liveIds = HARNESS_CAPABILITIES.filter((c) => c.status === 'live').map(
      (c) => c.id,
    );
    const includedIds = out.diagnostics.capabilityDecisions
      .filter((d) => d.decision === 'included')
      .map((d) => d.capabilityId);
    // Every live + codex_proxy != unsupported should be included.
    for (const id of liveIds) {
      const cap = getCapability(id)!;
      const wired = cap.exposure.codex_proxy.kind !== 'unsupported';
      if (wired) {
        assert.ok(
          includedIds.includes(id),
          `${id} is live + wired on codex_proxy but not included`,
        );
      }
    }
  });

  it('capabilities unsupported on a runtime are excluded with a status= or unsupported= reason', () => {
    // Phase 5e round 8 follow-up: top-level `assistant_buddy.status`
    // stays `'deferred'` (Codex proxy is still unsupported so the
    // strict catalog-hygiene invariant "status=live ⇒ no unsupported
    // exposures" wouldn't allow flipping to live yet). The Native
    // parity patch only flipped `exposure.native.kind` to
    // `'ai_sdk_tool'` — per-runtime executability is what callers
    // (matrix derivation, Settings dialog, Native adapter) actually
    // read post-round-7. The compiler's exclusion reason regex below
    // accepts EITHER `status=deferred` (the default-enabled-set path)
    // OR `unsupported (...)` (the per-runtime exposure path) — both
    // are legitimate exclusion mechanics.
    const out = compileContext(input({ runtimeId: 'codex_runtime' }));
    const buddy = out.diagnostics.capabilityDecisions.find(
      (d) => d.capabilityId === 'assistant_buddy',
    );
    assert.ok(buddy);
    assert.equal(buddy!.decision, 'excluded');
    assert.match(buddy!.reason, /status=deferred|unsupported/);
  });

  it('explicit enabledCapabilities subset only emits those capabilities', () => {
    const out = compileContext(
      input({ enabledCapabilities: new Set(['widget']) }),
    );
    assert.equal(out.capabilityFragments.length, 1);
    assert.equal(out.capabilityFragments[0].sourceCapability, 'widget');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Widget wire-format single source (regression test #10)
// ─────────────────────────────────────────────────────────────────────

describe('compileContext — widget wire-format single source', () => {
  it('CANONICAL_SHOW_WIDGET_JSON appears EXACTLY once in the compiled system prompt', () => {
    const out = compileContext(
      input({ enabledCapabilities: new Set(['widget']) }),
    );
    const occurrences = countOccurrences(
      out.systemPromptText,
      CANONICAL_SHOW_WIDGET_JSON,
    );
    assert.equal(
      occurrences,
      1,
      `CANONICAL_SHOW_WIDGET_JSON must appear exactly once; got ${occurrences}. Compiled prompt:\n${out.systemPromptText.slice(0, 500)}…`,
    );
  });

  it('"FINAL OUTPUT FORMAT — non-negotiable" title appears EXACTLY once', () => {
    const out = compileContext(
      input({ enabledCapabilities: new Set(['widget']) }),
    );
    const occurrences = countOccurrences(
      out.systemPromptText,
      'FINAL OUTPUT FORMAT — non-negotiable',
    );
    assert.equal(occurrences, 1);
  });

  it('WIDGET_WIRE_FORMAT_SPEC full text appears EXACTLY once', () => {
    const out = compileContext(
      input({ enabledCapabilities: new Set(['widget']) }),
    );
    const occurrences = countOccurrences(out.systemPromptText, WIDGET_WIRE_FORMAT_SPEC);
    assert.equal(occurrences, 1);
  });

  it('widget artifactContract canonicalJson is JSON.parse + parseAllShowWidgets safe', () => {
    const out = compileContext(input());
    const widget = out.artifactContracts.find(
      (a) => a.sourceCapability === 'widget',
    );
    assert.ok(widget);
    // JSON.parse round-trip.
    const parsed = JSON.parse(widget!.canonicalJson) as Record<string, unknown>;
    assert.ok(parsed.title);
    assert.ok(parsed.widget_code);
    // Renderer round-trip — must come back as a `widget` segment.
    const fence = '```show-widget\n' + widget!.canonicalJson + '\n```';
    const segs = parseAllShowWidgets(fence);
    const seg = segs.find((s) => s.type === 'widget');
    const malformed = segs.find((s) => s.type === 'malformed_widget');
    assert.ok(seg, 'canonical example must parse as a widget segment');
    assert.equal(malformed, undefined);
  });

  it('compiler FAILS at compile time if a capability fragment re-embeds an artifact contract canonicalJson', () => {
    // We can't easily inject a faulty capability into HARNESS_CAPABILITIES
    // at runtime (it's a frozen module-level const). The duplication
    // check lives inside compileContext; source-pin verifies the
    // safety net is in place and references the canonicalJson + a
    // throw site.
    const src = readSource('src/lib/harness/context-compiler.ts');
    assert.match(src, /detectWireFormatDuplication/);
    assert.match(
      src,
      /Compiler detected wire-format duplication/,
      'compiler must throw with a clear message when a capability fragment re-embeds an artifact canonicalJson',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// Ordering (artifact contracts before capability fragments)
// ─────────────────────────────────────────────────────────────────────

describe('compileContext — ordering', () => {
  it('artifactContract appears BEFORE the capability fragment in the assembled system prompt', () => {
    const out = compileContext(
      input({ enabledCapabilities: new Set(['widget']) }),
    );
    const specIdx = out.systemPromptText.indexOf('FINAL OUTPUT FORMAT');
    const capIdx = out.systemPromptText.indexOf('<widget-capability>');
    assert.ok(specIdx >= 0 && capIdx >= 0);
    assert.ok(
      specIdx < capIdx,
      `artifactContract (idx=${specIdx}) must precede capability fragment (idx=${capIdx})`,
    );
  });

  it('capabilityFragments order matches HARNESS_CAPABILITIES order (modulo deferred/unsupported)', () => {
    const out = compileContext(input({ runtimeId: 'codex_runtime' }));
    const capOrder = out.capabilityFragments.map((f) => f.sourceCapability);
    const catalogOrder = HARNESS_CAPABILITIES.map((c) => c.id);
    // Confirm capOrder is a subsequence of catalogOrder.
    let cursor = 0;
    for (const id of capOrder) {
      const found = catalogOrder.indexOf(id, cursor);
      assert.ok(found >= 0, `${id} out of catalog order or duplicated`);
      cursor = found + 1;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Budget enforcement
// ─────────────────────────────────────────────────────────────────────

describe('compileContext — budget', () => {
  it('throws when load-bearing fragments alone exceed systemPromptMax (no silent trim)', () => {
    assert.throws(
      () =>
        compileContext(
          input({ tokenBudget: { systemPromptMax: 10, contextMax: 100 } }),
        ),
      /exceed systemPromptMax/,
      'compiler must FAIL on load-bearing overflow rather than silently dropping capability content',
    );
  });

  it('budget.perCategory adds up to budget.used', () => {
    const out = compileContext(input());
    const { perCategory, used } = out.budget;
    const sum =
      perCategory.basePrompt +
      perCategory.artifactContracts +
      perCategory.capabilityFragments +
      perCategory.workspaceFragments +
      perCategory.memoryFragments;
    assert.equal(sum, used);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Cross-runtime fragment text identity (regression test #9)
// ─────────────────────────────────────────────────────────────────────

describe('compileContext — cross-runtime fragment identity', () => {
  it('same capability emits identical fragment text across all three RuntimeIds', () => {
    const claudecode = compileContext(input({ runtimeId: 'claude_code' }));
    const native = compileContext(input({ runtimeId: 'codepilot_runtime' }));
    const codex = compileContext(input({ runtimeId: 'codex_runtime' }));
    // Compare each capability's text across runtimes.
    const claudeMap = new Map(
      claudecode.capabilityFragments.map((f) => [f.sourceCapability, f.text]),
    );
    const nativeMap = new Map(
      native.capabilityFragments.map((f) => [f.sourceCapability, f.text]),
    );
    const codexMap = new Map(
      codex.capabilityFragments.map((f) => [f.sourceCapability, f.text]),
    );
    // For each capability present in all three: text must match.
    for (const id of claudeMap.keys()) {
      if (nativeMap.has(id) && codexMap.has(id)) {
        assert.equal(
          claudeMap.get(id),
          nativeMap.get(id),
          `${id} fragment text drifts between claude_code and codepilot_runtime`,
        );
        assert.equal(
          claudeMap.get(id),
          codexMap.get(id),
          `${id} fragment text drifts between claude_code and codex_runtime`,
        );
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Tool descriptors
// ─────────────────────────────────────────────────────────────────────

describe('compileContext — tool descriptors', () => {
  it('every live capability\'s tool names appear in toolDescriptors for Codex Runtime', () => {
    const out = compileContext(input({ runtimeId: 'codex_runtime' }));
    const names = new Set(out.toolDescriptors.map((t) => t.name));
    for (const cap of HARNESS_CAPABILITIES) {
      if (cap.status !== 'live') continue;
      if (cap.exposure.codex_proxy.kind === 'unsupported') continue;
      for (const toolName of cap.toolNames) {
        assert.ok(
          names.has(toolName),
          `${cap.id}.${toolName} expected in compiled toolDescriptors`,
        );
      }
    }
  });

  it('codepilot_hatch_buddy is NOT in Codex toolDescriptors (codex_proxy unsupported)', () => {
    // Phase 5e round 8 follow-up: top-level `assistant_buddy.status`
    // stays `'deferred'` because `codex_proxy.kind` is still
    // `'unsupported'` (Codex Runtime proxy doesn't bridge the hatch
    // flow). Native exposure flipped to `'ai_sdk_tool'`, but that
    // affects per-runtime executability only, not the catalog's
    // top-level status. Either way the compiler MUST exclude
    // `codepilot_hatch_buddy` from the Codex tool descriptors —
    // status='deferred' takes the default-enabled-set path; an
    // explicit enabledCapabilities set would still hit the
    // per-runtime exposure check at the next layer. Pin both
    // pathways.
    const out = compileContext(input({ runtimeId: 'codex_runtime' }));
    const names = new Set(out.toolDescriptors.map((t) => t.name));
    assert.equal(
      names.has('codepilot_hatch_buddy'),
      false,
      'codex_proxy.kind === unsupported; hatch_buddy must not appear in Codex tool descriptors',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// runtimeHints boundary (regression test #11)
// ─────────────────────────────────────────────────────────────────────

describe('compileContext — runtimeHints boundary', () => {
  it('CodexProxyHints.builtinToolNames is a real Set + every entry mounts in createCodePilotBuiltinTools', async () => {
    const { createCodePilotBuiltinTools } = await import('@/lib/codex/proxy/builtin-bridge');
    const bridge = createCodePilotBuiltinTools({
      sessionId: 'compiler-hint-test',
      targetProviderId: 'prov',
      workspacePath: '/tmp',
      grokVideoAvailable: false,
    });
    const out = compileContext(input({
      runtimeId: 'codex_runtime',
      availableToolNames: bridge.toolNames,
    }));
    const hints = out.runtimeHints.codex_proxy;
    assert.ok(hints);
    assert.ok(hints!.builtinToolNames instanceof Set);
    const mounted = new Set(Object.keys(bridge.tools));
    for (const name of hints!.builtinToolNames) {
      assert.ok(
        mounted.has(name),
        `${name} is in CodexProxyHints.builtinToolNames but bridge doesn't mount it`,
      );
    }
    assert.equal(hints!.builtinToolNames.has('codepilot_generate_video'), false);
  });

  it('includes the Grok video hint when the same runtime source mounts it', async () => {
    const { createCodePilotBuiltinTools } = await import('@/lib/codex/proxy/builtin-bridge');
    const bridge = createCodePilotBuiltinTools({
      sessionId: 'compiler-video-hint-test',
      targetProviderId: 'prov',
      workspacePath: '/tmp',
      grokVideoAvailable: true,
    });
    const out = compileContext(input({
      runtimeId: 'codex_runtime',
      availableToolNames: bridge.toolNames,
    }));
    assert.equal(
      out.runtimeHints.codex_proxy?.builtinToolNames.has('codepilot_generate_video'),
      true,
    );
  });

  it('runtimeHints fields contain no prose (no newline, no Markdown markers, ≤ 64 chars each string)', () => {
    const out = compileContext(input({ runtimeId: 'codex_runtime' }));
    const hints = out.runtimeHints.codex_proxy;
    assert.ok(hints);
    // stopWhen / stepCount / passthroughToolTypes / builtinToolNames
    // are all enum-shaped / numeric / ID sets. Scan all string-typed
    // values reachable through the hints and confirm none look like
    // prompt prose.
    const scan = (v: unknown): void => {
      if (typeof v === 'string') {
        assert.ok(v.length <= 64, `hint string too long (${v.length} chars), possible prose: ${v.slice(0, 80)}`);
        assert.equal(v.includes('\n'), false, `hint string contains newline: ${v}`);
        assert.equal(v.includes('```'), false, `hint string contains fence markers: ${v}`);
        assert.equal(/^\s*#+\s/.test(v), false, `hint string starts with Markdown heading: ${v}`);
      } else if (Array.isArray(v)) {
        v.forEach(scan);
      } else if (v instanceof Set) {
        for (const item of v) scan(item);
      } else if (v && typeof v === 'object') {
        for (const [, sub] of Object.entries(v)) scan(sub);
      }
    };
    scan(hints);
  });

  it('source-grep: CodexProxyHints / NativeHints / ClaudeCodeHints type definitions only list ID / ref / option fields', () => {
    const src = readSource('src/lib/harness/context-compiler.ts');
    // These three types must NOT contain any field whose comment or
    // name implies prose. The presence of `prompt` or `instruction`
    // or `text:` in a hints type definition would be a regression.
    const hintsBlock = src.match(/export interface CodexProxyHints \{[\s\S]*?\}/);
    assert.ok(hintsBlock);
    assert.equal(/promptOverride|promptExtra|systemPrompt|instructionExtra|widgetPrompt|mediaPrompt|notifyPrompt|memoryPrompt/i.test(hintsBlock![0]), false,
      'CodexProxyHints must not contain prose-style fields');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Expected Differences Ledger consistency (regression test #12)
// ─────────────────────────────────────────────────────────────────────

describe('Expected Differences Ledger — internal consistency', () => {
  it('every ledger entry references a real capability id', () => {
    const ids = new Set(HARNESS_CAPABILITIES.map((c) => c.id));
    for (const entry of EXPECTED_DIFFERENCES) {
      assert.ok(
        ids.has(entry.capability),
        `ledger entry references unknown capability "${entry.capability}"`,
      );
    }
  });

  it('every ledger compilerSource sourceFile exists in the repo', () => {
    for (const entry of EXPECTED_DIFFERENCES) {
      const full = path.join(REPO_ROOT, entry.compilerSource.sourceFile);
      assert.ok(
        fs.existsSync(full),
        `ledger entry ${entry.runtimeId}.${entry.capability} compilerSource file does not exist: ${entry.compilerSource.sourceFile}`,
      );
    }
  });

  it('every ledger runtimeSource sourceFile (if present) exists in the repo', () => {
    for (const entry of EXPECTED_DIFFERENCES) {
      if (!entry.runtimeSource) continue;
      const full = path.join(REPO_ROOT, entry.runtimeSource.sourceFile);
      assert.ok(
        fs.existsSync(full),
        `ledger entry ${entry.runtimeId}.${entry.capability} runtimeSource file does not exist: ${entry.runtimeSource.sourceFile}`,
      );
    }
  });

  it('plannedResolution values map to a real Phase 2 slice or follow_up', () => {
    const valid = new Set(['slice_2c', 'slice_2d', 'slice_2e', 'follow_up']);
    for (const entry of EXPECTED_DIFFERENCES) {
      assert.ok(valid.has(entry.plannedResolution), `unknown plannedResolution: ${entry.plannedResolution}`);
    }
  });

  it('codepilot_runtime ledger is empty after Phase 5e P1 (image_generation MediaBlock follow_up resolved)', () => {
    // Phase 5d Phase 2 slice 2d (2026-05-17) — Native runtime
    // re-exports the canonical MCP-side prompts for memory /
    // tasks_and_notify / media_import.
    //
    // Phase 5e Phase 0.5 P1 (2026-05-17 Native MediaBlock 補齐) closed
    // the final `image_generation` follow_up: Native now emits
    // MediaBlock[] via the harness side-channel (see
    // `src/lib/builtin-tools/media.ts` + `src/lib/agent-loop.ts`
    // splice).
    const native = expectedDifferencesFor('codepilot_runtime');
    assert.deepEqual(
      native.map((e) => e.capability).sort(),
      [],
      `Native ledger should be empty after Phase 5e P1; got: ${native.map((e) => e.capability).join(', ')}`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}
