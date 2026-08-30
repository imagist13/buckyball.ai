/**
 * Phase 5e Phase 3 review round 7 (2026-05-18) — Capability display
 * text coverage.
 *
 * Pins that the user-facing copy layer (`capability-display-text.ts`)
 * stays in step with the engineering catalog (`capability-contract.ts`).
 * If a new capability is added to `HARNESS_CAPABILITIES` without a
 * matching `CAPABILITY_DISPLAY` entry, this test fails — preventing
 * the Settings dialog from rendering an engineering id ("widget" /
 * "tasks_and_notify") to the user.
 *
 * Round 7 ratchet — we explicitly *don't* allow the UI to fall back
 * to the contract's `displayName` even though `getCapabilityDisplay`
 * returns undefined gracefully. The contract `displayName` carries
 * developer language (e.g. "Generative UI widgets via show-widget
 * fence", "Dashboard pin / list / refresh"). User-facing text must
 * be deliberately authored.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_CAPABILITIES } from '@/lib/harness/capability-contract';
import {
  getCapabilityDisplay,
  knownCapabilityIds,
  buildUserReason,
  CALLABLE_STATUS_LINE,
  CODEX_ACCOUNT_HEADER_NOTE,
  USER_EXTENSIONS_SUMMARY,
  getUserExtensionsSummary,
  TOOL_NAME_TO_CAPABILITY_ID,
  CAPABILITY_EXECUTABLE_RUNTIMES,
  isToolUnsupportedError,
  buildToolUnsupportedHint,
} from '@/lib/harness/capability-display-text';
import { capabilityMatrixForRuntime } from '@/lib/harness/capability-matrix';
import type { RuntimeId } from '@/lib/runtime/runtime-id';

describe('Capability display text — coverage', () => {
  it('every capability in HARNESS_CAPABILITIES has a display text entry', () => {
    for (const cap of HARNESS_CAPABILITIES) {
      const display = getCapabilityDisplay(cap.id);
      assert.ok(
        display,
        `capability "${cap.id}" exists in the engineering catalog but has no user-facing display text. Add an entry to CAPABILITY_DISPLAY in src/lib/harness/capability-display-text.ts.`,
      );
      assert.ok(
        display!.label.zh.length > 0,
        `capability "${cap.id}" display label.zh is empty`,
      );
      assert.ok(
        display!.label.en.length > 0,
        `capability "${cap.id}" display label.en is empty`,
      );
    }
  });

  it('display text catalog has no orphan entries (every id in CAPABILITY_DISPLAY exists in HARNESS_CAPABILITIES)', () => {
    const catalogIds = new Set(HARNESS_CAPABILITIES.map((c) => c.id));
    for (const id of knownCapabilityIds()) {
      assert.ok(
        catalogIds.has(id),
        `display text references unknown capability "${id}" — remove the orphan or add it to HARNESS_CAPABILITIES`,
      );
    }
  });

  it('user-facing labels do not leak engineering jargon (MCP / bridge / SDK / Phase)', () => {
    // Round 7 user feedback explicitly called these strings out as
    // noise. Hardcoded blacklist; if a label ever needs to reference
    // these, we have a copy-review conversation first.
    const blacklist = ['MCP', 'bridge', 'SDK', 'Phase ', 'phase ', 'unsupported', 'deferred'];
    for (const cap of HARNESS_CAPABILITIES) {
      const display = getCapabilityDisplay(cap.id);
      if (!display) continue;
      for (const word of blacklist) {
        assert.ok(
          !display.label.zh.includes(word),
          `display.label.zh for "${cap.id}" leaks engineering term "${word}": ${display.label.zh}`,
        );
        assert.ok(
          !display.label.en.includes(word),
          `display.label.en for "${cap.id}" leaks engineering term "${word}": ${display.label.en}`,
        );
        if (display.description) {
          assert.ok(
            !display.description.zh.includes(word),
            `display.description.zh for "${cap.id}" leaks engineering term "${word}": ${display.description.zh}`,
          );
          assert.ok(
            !display.description.en.includes(word),
            `display.description.en for "${cap.id}" leaks engineering term "${word}": ${display.description.en}`,
          );
        }
      }
    }
  });
});

describe('Capability display text — buildUserReason', () => {
  it('returns "no runtime supports" sentence when suggestedRuntimes is empty', () => {
    const zh = buildUserReason({
      capabilityId: 'widget',
      currentRuntime: 'codex_runtime',
      suggestedRuntimes: [],
      lang: 'zh',
    });
    assert.ok(zh.includes('Codex'), 'zh reason should mention current runtime');
    assert.ok(zh.includes('生成 Widget'), 'zh reason should use the user-facing label');

    const en = buildUserReason({
      capabilityId: 'widget',
      currentRuntime: 'codex_runtime',
      suggestedRuntimes: [],
      lang: 'en',
    });
    assert.ok(en.includes('Codex'));
    assert.ok(en.includes('Generate Widget'));
  });

  it('lists suggested runtimes joined with "或" (zh) / "or" (en)', () => {
    const zh = buildUserReason({
      capabilityId: 'dashboard',
      currentRuntime: 'codex_runtime',
      suggestedRuntimes: ['claude_code', 'codepilot_runtime'],
      lang: 'zh',
    });
    assert.ok(zh.includes('Claude Code 或 CodePilot'), `unexpected zh: ${zh}`);

    const en = buildUserReason({
      capabilityId: 'dashboard',
      currentRuntime: 'codex_runtime',
      suggestedRuntimes: ['claude_code', 'codepilot_runtime'],
      lang: 'en',
    });
    assert.ok(en.includes('Claude Code or CodePilot'), `unexpected en: ${en}`);
  });

  it('falls back to the raw capabilityId only when display entry is missing (defensive)', () => {
    const zh = buildUserReason({
      capabilityId: 'definitely_not_a_real_capability',
      currentRuntime: 'claude_code',
      suggestedRuntimes: [],
      lang: 'zh',
    });
    assert.ok(zh.includes('definitely_not_a_real_capability'));
  });
});

describe('Capability display text — header notes', () => {
  it('CALLABLE_STATUS_LINE has both zh and en non-empty', () => {
    assert.ok(CALLABLE_STATUS_LINE.zh.length > 0);
    assert.ok(CALLABLE_STATUS_LINE.en.length > 0);
  });

  it('CODEX_ACCOUNT_HEADER_NOTE explains the Codex-managed scope without engineering jargon', () => {
    assert.ok(CODEX_ACCOUNT_HEADER_NOTE.zh.includes('Codex'));
    assert.ok(CODEX_ACCOUNT_HEADER_NOTE.zh.includes('CodePilot'));
    assert.ok(CODEX_ACCOUNT_HEADER_NOTE.en.includes('Codex'));
    assert.ok(CODEX_ACCOUNT_HEADER_NOTE.en.includes('CodePilot'));
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase 5e round 8 (2026-05-18) — user-extensions summary.
// The matrix lives in capability-display-text.ts (user-facing copy
// layer) and MUST stay in sync with the engineering source of truth
// in `src/lib/harness/user-codepilot-extensions.ts:executableForKind`.
// Mismatch = the Settings dialog tells one story while the runtime
// adapter tells another → exactly the "假装能调用" reviewer concern.
// ─────────────────────────────────────────────────────────────────────

describe('User-extensions summary — coverage', () => {
  const RUNTIMES: readonly RuntimeId[] = [
    'claude_code',
    'codepilot_runtime',
    'codex_runtime',
  ] as const;

  it('every Runtime has a summary entry', () => {
    for (const r of RUNTIMES) {
      assert.ok(USER_EXTENSIONS_SUMMARY[r], `missing summary for ${r}`);
    }
  });

  it('every summary has both zh and en label + description', () => {
    for (const r of RUNTIMES) {
      const s = USER_EXTENSIONS_SUMMARY[r];
      assert.ok(s.label.zh.length > 0);
      assert.ok(s.label.en.length > 0);
      assert.ok(s.description.zh.length > 0);
      assert.ok(s.description.en.length > 0);
    }
  });

  it('summary copy does not leak engineering jargon', () => {
    // Narrower blacklist than the built-in capabilities check: "MCP"
    // and "skills" / "slash commands" are user-facing terms here (the
    // section is literally called "用户自定义 MCP / Skills" — users
    // who configure these *know* what MCP is). The blacklist focuses
    // on terms that ONLY appear in internal docs: factory names,
    // phase references, bridge / contract / runtime-adapter jargon.
    const blacklist = ['factory', 'Phase ', 'phase ', 'bridge_', 'contract.ts', 'runtime-adapter'];
    for (const r of RUNTIMES) {
      const s = USER_EXTENSIONS_SUMMARY[r];
      for (const word of blacklist) {
        assert.ok(
          !s.description.zh.includes(word) && !s.description.en.includes(word),
          `${r} summary description leaks "${word}": ${s.description.zh} / ${s.description.en}`,
        );
      }
    }
  });

  it('status semantics match runtime adapter reality', () => {
    // These match the runtime-aware classification in
    // `executableForKind` in user-codepilot-extensions.ts. If either
    // file changes the per-Runtime executability of any extension
    // kind, both must update together.
    assert.equal(USER_EXTENSIONS_SUMMARY.claude_code.status, 'executable',
      'claude_code mounts mcp + skill + slash + workspace_rule — all wired');
    assert.equal(USER_EXTENSIONS_SUMMARY.codepilot_runtime.status, 'partial',
      'codepilot_runtime mounts mcp + workspace_rule; skill + slash are CC-only');
    assert.equal(USER_EXTENSIONS_SUMMARY.codex_runtime.status, 'perception_only',
      'codex_runtime: only workspace_rule cross-runtime; mcp / skill / slash not on this path');
  });

  it('codex_runtime summary explicitly points users to Claude Code / CodePilot as alternatives', () => {
    // The "perception_only" status by itself is just a label —
    // perceptive users need to know where they CAN run their stuff.
    const s = USER_EXTENSIONS_SUMMARY.codex_runtime.description;
    assert.ok(s.zh.includes('Claude Code') || s.zh.includes('CodePilot'),
      'codex zh description must name an alternative runtime');
    assert.ok(s.en.includes('Claude Code') || s.en.includes('CodePilot'),
      'codex en description must name an alternative runtime');
  });

  it('getUserExtensionsSummary falls back to codex_runtime for unknown runtime ids (conservative default)', () => {
    const fallback = getUserExtensionsSummary('not_a_real_runtime' as RuntimeId);
    assert.equal(fallback.status, 'perception_only',
      'unknown runtime → conservative perception_only (never overclaim executability)');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase 5e round 8 (2026-05-18) — tool-name → capability map +
// unsupported hint pins. Adding a new built-in tool to
// HARNESS_CAPABILITIES.toolNames must be paired with an entry in
// TOOL_NAME_TO_CAPABILITY_ID, otherwise the inline chat hint won't
// fire and users won't know where to go. Adding a new capability
// must be paired with CAPABILITY_EXECUTABLE_RUNTIMES.
// ─────────────────────────────────────────────────────────────────────

describe('Tool-name → capability map — coverage', () => {
  it('every tool name in HARNESS_CAPABILITIES.toolNames is in TOOL_NAME_TO_CAPABILITY_ID', () => {
    for (const cap of HARNESS_CAPABILITIES) {
      for (const tool of cap.toolNames) {
        const mappedCap = TOOL_NAME_TO_CAPABILITY_ID[tool];
        assert.equal(
          mappedCap,
          cap.id,
          `tool "${tool}" in HARNESS_CAPABILITIES["${cap.id}"].toolNames is not mapped (or mapped to "${mappedCap}") in TOOL_NAME_TO_CAPABILITY_ID. Add to src/lib/harness/capability-display-text.ts.`,
        );
      }
    }
  });

  it('every tool in TOOL_NAME_TO_CAPABILITY_ID maps to a real capability id', () => {
    const validIds = new Set(HARNESS_CAPABILITIES.map((c) => c.id));
    for (const [tool, capId] of Object.entries(TOOL_NAME_TO_CAPABILITY_ID)) {
      assert.ok(
        validIds.has(capId),
        `tool "${tool}" maps to "${capId}" which is not a real capability id`,
      );
    }
  });

  it('CAPABILITY_EXECUTABLE_RUNTIMES covers every capability', () => {
    for (const cap of HARNESS_CAPABILITIES) {
      assert.ok(
        CAPABILITY_EXECUTABLE_RUNTIMES[cap.id],
        `capability "${cap.id}" missing from CAPABILITY_EXECUTABLE_RUNTIMES`,
      );
    }
  });

  it('CAPABILITY_EXECUTABLE_RUNTIMES matches the matrix derivation for every capability', () => {
    // Pin the static client-safe map against the server-side matrix
    // (which derives from capability-contract.ts:exposure.kind). If
    // they diverge, the chat hint advertises wrong runtimes.
    const RUNTIMES: readonly RuntimeId[] = ['claude_code', 'codepilot_runtime', 'codex_runtime'];
    for (const cap of HARNESS_CAPABILITIES) {
      const fromMatrix: RuntimeId[] = [];
      for (const r of RUNTIMES) {
        const cells = capabilityMatrixForRuntime(r);
        const cell = cells.find((c) => c.capabilityId === cap.id);
        if (cell?.status === 'executable') fromMatrix.push(r);
      }
      const fromStatic = CAPABILITY_EXECUTABLE_RUNTIMES[cap.id] ?? [];
      assert.deepEqual(
        [...fromStatic].sort(),
        [...fromMatrix].sort(),
        `${cap.id}: static map says [${fromStatic.join(', ')}], matrix derivation says [${fromMatrix.join(', ')}]`,
      );
    }
  });
});

describe('isToolUnsupportedError — narrow false-positive avoidance', () => {
  it('returns false when isError is undefined / false', () => {
    assert.equal(isToolUnsupportedError({ toolName: 'codepilot_dashboard_pin', errorContent: 'tool not found', isError: undefined }), false);
    assert.equal(isToolUnsupportedError({ toolName: 'codepilot_dashboard_pin', errorContent: 'tool not found', isError: false }), false);
  });

  it('returns false when tool name is not in the catalog (third-party MCP)', () => {
    assert.equal(isToolUnsupportedError({ toolName: 'some_third_party_tool', errorContent: 'tool not found', isError: true }), false);
  });

  it('returns false when error message looks legitimate (NOT a "tool not found" message)', () => {
    // Real failure cases that should NOT trigger a "switch runtime" hint.
    assert.equal(isToolUnsupportedError({ toolName: 'codepilot_generate_image', errorContent: 'API key invalid', isError: true }), false);
    assert.equal(isToolUnsupportedError({ toolName: 'codepilot_generate_image', errorContent: 'rate limit exceeded', isError: true }), false);
    assert.equal(isToolUnsupportedError({ toolName: 'codepilot_import_media', errorContent: 'file not found', isError: true }), false);
  });

  it('returns true for known "tool not found" patterns', () => {
    const patterns = [
      'tool not found',
      'Tool not found',
      'Unknown tool: codepilot_dashboard_pin',
      'tool "codepilot_dashboard_pin" not found',
      'No such tool: codepilot_cli_tools_list',
      'tool unsupported on this runtime',
      'tool not registered',
    ];
    for (const p of patterns) {
      assert.equal(
        isToolUnsupportedError({ toolName: 'codepilot_dashboard_pin', errorContent: p, isError: true }),
        true,
        `pattern "${p}" should match`,
      );
    }
  });
});

describe('buildToolUnsupportedHint', () => {
  it('returns null for unknown tool names', () => {
    assert.equal(buildToolUnsupportedHint('not_a_real_tool'), null);
  });

  it('codepilot_dashboard_pin → hints "Claude Code or CodePilot"', () => {
    const h = buildToolUnsupportedHint('codepilot_dashboard_pin');
    assert.ok(h);
    assert.equal(h!.capabilityId, 'dashboard');
    assert.ok(h!.hint.zh.includes('看板操作'));
    assert.ok(h!.hint.zh.includes('Claude Code'));
    assert.ok(h!.hint.zh.includes('CodePilot'));
    assert.ok(h!.hint.en.includes('Dashboard operations'));
  });

  it('codepilot_hatch_buddy → hints "Claude Code or CodePilot" (round 8 Native parity)', () => {
    // Phase 5e round 8 follow-up: Native factory now mounts
    // codepilot_hatch_buddy, so the hint should list both Claude Code
    // AND CodePilot as alternatives (was Claude Code only pre-round-8).
    const h = buildToolUnsupportedHint('codepilot_hatch_buddy');
    assert.ok(h);
    assert.equal(h!.capabilityId, 'assistant_buddy');
    assert.deepEqual([...h!.suggestedRuntimes], ['claude_code', 'codepilot_runtime']);
    assert.ok(h!.hint.zh.includes('Claude Code'));
    assert.ok(h!.hint.zh.includes('CodePilot'));
  });

  it('widget (executable everywhere) → still produces a hint listing all runtimes (defensive)', () => {
    // If widget ever errors as "tool not found" (shouldn't happen in
    // practice since every runtime mounts it), the hint should still
    // be useful — listing where the tool DOES live.
    const h = buildToolUnsupportedHint('codepilot_load_widget_guidelines');
    assert.ok(h);
    assert.equal(h!.suggestedRuntimes.length, 3);
  });
});
