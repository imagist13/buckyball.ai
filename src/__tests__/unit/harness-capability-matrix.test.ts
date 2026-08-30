/**
 * Phase 5e Phase 2 (2026-05-18) — Capability matrix derivation tests.
 *
 * Pins:
 *   1. Matrix is **pure derivation** from capability-contract.ts —
 *      not allowed to maintain a parallel hand-written table that
 *      could drift. Matrix is the source for Settings UI; the test
 *      pins this via a structural property: every matrix cell's
 *      capabilityId must resolve in HARNESS_CAPABILITIES.
 *   2. Every Runtime × every capability produces exactly one cell.
 *   3. `executable` cells carry toolNames; non-executable cells
 *      carry an empty toolNames + a non-empty statusLine.
 *   4. `perception_only` cells carry suggestedRuntime when at least
 *      one Runtime in the catalog supports the capability.
 *   5. Round 7 (2026-05-18) — derivation is **per-runtime exposure**,
 *      NOT top-level `status`. A capability whose top-level status is
 *      `deferred` can still be executable on a runtime whose
 *      `exposure.kind !== 'unsupported'` (e.g. dashboard / cli_tools
 *      are deferred for codex_proxy but mcp_server-real / ai_sdk_tool-real
 *      on claude_code + native). Removing the `cap.status === 'deferred'`
 *      short-circuit was the round 7 fix; the test below pins that.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCapabilityMatrix,
  capabilityMatrixForRuntime,
  capabilityMatrixForRuntimeProvider,
  flattenMatrix,
} from '@/lib/harness/capability-matrix';
import { HARNESS_CAPABILITIES, getCapability } from '@/lib/harness/capability-contract';
import { getCapabilityNote } from '@/lib/harness/capability-display-text';

const RUNTIMES = ['claude_code', 'codepilot_runtime', 'codex_runtime'] as const;

describe('Capability matrix — derivation contract', () => {
  it('emits exactly one cell per Runtime × Capability', () => {
    const matrix = buildCapabilityMatrix();
    for (const runtime of RUNTIMES) {
      assert.equal(
        matrix[runtime].length,
        HARNESS_CAPABILITIES.length,
        `${runtime} should have ${HARNESS_CAPABILITIES.length} cells`,
      );
    }
  });

  it('every cell references a real capability in HARNESS_CAPABILITIES', () => {
    for (const cell of flattenMatrix()) {
      assert.ok(
        getCapability(cell.capabilityId),
        `dangling capabilityId in matrix: ${cell.capabilityId}`,
      );
    }
  });

  it('every cell has a non-empty statusLine (Settings UI never renders blank)', () => {
    for (const cell of flattenMatrix()) {
      assert.ok(
        cell.statusLine.length > 0,
        `cell ${cell.runtimeId}/${cell.capabilityId} has empty statusLine`,
      );
    }
  });
});

describe('Capability matrix — status semantics', () => {
  it('executable cells carry non-empty toolNames', () => {
    for (const cell of flattenMatrix()) {
      if (cell.status === 'executable') {
        assert.ok(
          cell.toolNames.length > 0,
          `${cell.runtimeId}/${cell.capabilityId} marked executable but toolNames is empty`,
        );
      }
    }
  });

  it('non-executable cells have empty toolNames (model must not see tool names it cant call)', () => {
    for (const cell of flattenMatrix()) {
      if (cell.status !== 'executable') {
        assert.deepEqual(
          cell.toolNames,
          [],
          `${cell.runtimeId}/${cell.capabilityId} has status=${cell.status} but exposes toolNames — leaks "visible but uncallable" tools`,
        );
      }
    }
  });

  it('perception_only cells carry a suggestedRuntime where one exists', () => {
    for (const cell of flattenMatrix()) {
      if (cell.status !== 'perception_only') continue;
      // If ANY runtime supports this capability, suggestedRuntime must
      // be populated. If no runtime supports it, the cell would be
      // 'unavailable' instead.
      assert.ok(
        cell.suggestedRuntime,
        `${cell.runtimeId}/${cell.capabilityId} is perception_only without suggestedRuntime — Settings UI cant tell user where to switch`,
      );
    }
  });
});

describe('Capability matrix — per-runtime exposure derivation (round 7)', () => {
  // Documented exceptions: matrix-layer promotions where the codex_proxy
  // contract.kind is `unsupported` (because the LEGACY provider-proxy
  // bridge is genuinely unsupported for these capabilities) but the new
  // mutation-level MCP split injection makes them callable. See
  // capability-matrix.ts `CODEX_NATIVE_PROMOTED_BY_CAP`. Tracked as
  // tech-debt: the contract schema could grow a per-runtime promotion
  // kind to absorb these without an exception list.
  const MATRIX_LAYER_PROMOTIONS = new Set<string>([
    'codex_runtime/dashboard',
    'codex_runtime/cli_tools',
  ]);

  it('matrix status is derived from exposure.kind (with documented matrix-layer promotions)', () => {
    // Round 7 fix: removed the `cap.status === 'deferred'` short-circuit
    // in deriveCell. A capability marked deferred at the top level can
    // still be executable on a runtime whose exposure.kind is real (e.g.
    // dashboard.exposure.claudecode_sdk.kind === 'mcp_server' is real
    // wiring — only codex_proxy is unsupported). The contract is:
    // exposure.kind === 'unsupported' → perception_only / unavailable,
    // UNLESS the matrix layer promotes (see MATRIX_LAYER_PROMOTIONS above).
    // exposure.kind !== 'unsupported' → executable. Nothing else may
    // gate this transition.
    for (const cell of flattenMatrix()) {
      const cap = getCapability(cell.capabilityId);
      assert.ok(cap);
      const exposureKey =
        cell.runtimeId === 'claude_code'
          ? 'claudecode_sdk'
          : cell.runtimeId === 'codepilot_runtime'
            ? 'native'
            : 'codex_proxy';
      const exposureKind = cap!.exposure[exposureKey].kind;
      const key = `${cell.runtimeId}/${cell.capabilityId}`;
      if (exposureKind === 'unsupported') {
        if (MATRIX_LAYER_PROMOTIONS.has(key)) {
          // Promoted via the codex_runtime MCP split — must be executable
          // with the mixed trust badge + a non-empty noteKey.
          assert.equal(
            cell.status,
            'executable',
            `${key} is in MATRIX_LAYER_PROMOTIONS but matrix marked it ${cell.status} — promotion regressed`,
          );
          assert.equal(cell.trustBoundary, 'mixed', `${key} promoted cells must carry mixed trust`);
          assert.ok(cell.noteKey, `${key} promoted cells must carry a noteKey`);
        } else {
          assert.notEqual(
            cell.status,
            'executable',
            `${key} has exposure.kind=unsupported but matrix marked it executable — add to MATRIX_LAYER_PROMOTIONS if intentional, else the matrix is lying`,
          );
        }
      } else {
        assert.equal(
          cell.status,
          'executable',
          `${key} has real exposure.kind=${exposureKind} but matrix marked it ${cell.status} — top-level status must NOT gate per-runtime executability`,
        );
      }
    }
  });

  it('dashboard is executable on every Runtime (codex_runtime via the mutation-level split, 2026-05-28)', () => {
    // Round 7 specific pin — dashboard is the canonical case where the
    // OLD short-circuit (cap.status === 'deferred' → all runtimes
    // unavailable) was wrong. dashboard exposure: claudecode_sdk=mcp_server
    // (real wiring to src/lib/dashboard-mcp.ts), native=ai_sdk_tool (real
    // wiring to src/lib/builtin-tools/dashboard.ts), codex_proxy=unsupported
    // — but for codex_runtime the matrix now promotes via the read+write
    // MCP split (see capability-matrix.ts promoteCodexNativeSplitIfApplicable).
    const claudeCells = capabilityMatrixForRuntime('claude_code');
    const claudeDashboard = claudeCells.find((c) => c.capabilityId === 'dashboard');
    assert.equal(claudeDashboard!.status, 'executable');

    const nativeCells = capabilityMatrixForRuntime('codepilot_runtime');
    const nativeDashboard = nativeCells.find((c) => c.capabilityId === 'dashboard');
    assert.equal(nativeDashboard!.status, 'executable');

    const codexCells = capabilityMatrixForRuntime('codex_runtime');
    const codexDashboard = codexCells.find((c) => c.capabilityId === 'dashboard');
    // Codex review P1 (2026-05-28): codex_proxy.kind === 'unsupported' in the
    // contract, but the matrix layer promotes dashboard to executable via the
    // mutation-level MCP split (read auto_accept + write user_approval). The
    // promotion applies under ANY codex_runtime provider so the matrix never
    // disagrees with the actual injection in runtime.ts.
    assert.equal(codexDashboard!.status, 'executable');
    assert.equal(codexDashboard!.trustBoundary, 'mixed');
    assert.equal(codexDashboard!.suggestedRuntime, undefined, 'promoted cell drops suggestedRuntime');
  });

  it('cli_tools mirrors dashboard pattern: executable on every Runtime (codex_runtime via the mutation-level split)', () => {
    const claudeCells = capabilityMatrixForRuntime('claude_code');
    const claudeCli = claudeCells.find((c) => c.capabilityId === 'cli_tools');
    assert.equal(claudeCli!.status, 'executable');

    const nativeCells = capabilityMatrixForRuntime('codepilot_runtime');
    const nativeCli = nativeCells.find((c) => c.capabilityId === 'cli_tools');
    assert.equal(nativeCli!.status, 'executable');

    const codexCells = capabilityMatrixForRuntime('codex_runtime');
    const codexCli = codexCells.find((c) => c.capabilityId === 'cli_tools');
    // Codex review P1 (2026-05-28): promoted via mutation-level split, same
    // promotion the runtime injection mirrors. mixed trust, no suggestedRuntime.
    assert.equal(codexCli!.status, 'executable');
    assert.equal(codexCli!.trustBoundary, 'mixed');
    assert.equal(codexCli!.suggestedRuntime, undefined);
  });

  it('assistant_buddy is executable on claude_code + codepilot_runtime; perception_only on codex_runtime', () => {
    // Phase 5e round 8 follow-up (2026-05-18) — Native parity shipped.
    // `src/lib/builtin-tools/notification.ts` now mounts
    // `codepilot_hatch_buddy` mirroring the MCP authority. Codex
    // Runtime proxy still doesn't bridge the hatch flow (no entry in
    // `createCodePilotBuiltinTools`), so it stays perception_only.
    const claudeCells = capabilityMatrixForRuntime('claude_code');
    const claudeBuddy = claudeCells.find((c) => c.capabilityId === 'assistant_buddy');
    assert.equal(claudeBuddy!.status, 'executable');

    const nativeCells = capabilityMatrixForRuntime('codepilot_runtime');
    const nativeBuddy = nativeCells.find((c) => c.capabilityId === 'assistant_buddy');
    assert.equal(nativeBuddy!.status, 'executable',
      'round 8 Native parity — codepilot_hatch_buddy now mounted via createNotificationTools');

    const codexCells = capabilityMatrixForRuntime('codex_runtime');
    const codexBuddy = codexCells.find((c) => c.capabilityId === 'assistant_buddy');
    assert.equal(codexBuddy!.status, 'perception_only');
    assert.ok(
      codexBuddy!.suggestedRuntime === 'claude_code' || codexBuddy!.suggestedRuntime === 'codepilot_runtime',
      'suggested runtime should be one of the two executable paths',
    );
  });

  it('executable count differs across runtimes (claude_code ≥ codepilot_runtime > codex_runtime)', () => {
    // Direct anti-regression for round 7 user complaint "三个引擎数量
    // 不能都写 5/8". The fix makes the matrix count reflect per-runtime
    // exposure, so ClaudeCode (mcp_server everywhere) > Native (most
    // ai_sdk_tool, no assistant_buddy) > Codex proxy (only bridged
    // capabilities: widget / memory / tasks_and_notify / image_generation /
    // media_import).
    const claudeExec = capabilityMatrixForRuntime('claude_code').filter(
      (c) => c.status === 'executable',
    ).length;
    const nativeExec = capabilityMatrixForRuntime('codepilot_runtime').filter(
      (c) => c.status === 'executable',
    ).length;
    const codexExec = capabilityMatrixForRuntime('codex_runtime').filter(
      (c) => c.status === 'executable',
    ).length;
    assert.ok(
      claudeExec >= nativeExec,
      `claude_code (${claudeExec}) should be >= codepilot_runtime (${nativeExec})`,
    );
    assert.ok(
      nativeExec > codexExec,
      `codepilot_runtime (${nativeExec}) should be > codex_runtime (${codexExec})`,
    );
  });
});

describe('Capability matrix — live capability invariants', () => {
  it('widget is executable on all three runtimes (all live + exposed)', () => {
    for (const runtime of RUNTIMES) {
      const cells = capabilityMatrixForRuntime(runtime);
      const widget = cells.find((c) => c.capabilityId === 'widget');
      assert.ok(widget);
      assert.equal(
        widget!.status,
        'executable',
        `widget must be executable on ${runtime}`,
      );
    }
  });

  it('every live + cross-runtime-supported capability is executable on every runtime', () => {
    const live = HARNESS_CAPABILITIES.filter((c) => c.status === 'live');
    for (const cap of live) {
      const allExecutable =
        cap.exposure.claudecode_sdk.kind !== 'unsupported' &&
        cap.exposure.native.kind !== 'unsupported' &&
        cap.exposure.codex_proxy.kind !== 'unsupported';
      if (!allExecutable) continue;
      for (const runtime of RUNTIMES) {
        const cells = capabilityMatrixForRuntime(runtime);
        const cell = cells.find((c) => c.capabilityId === cap.id);
        assert.ok(cell);
        assert.equal(
          cell!.status,
          'executable',
          `${cap.id} is live + all-runtime-supported but matrix marks it ${cell!.status} on ${runtime}`,
        );
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase 5e review fix P2 #5 — trustBoundary derivation from mutation-level
// ─────────────────────────────────────────────────────────────────────

describe('Capability matrix — trustBoundary derivation', () => {
  it('widget (single safe_read tool) → auto_safe', () => {
    const cells = capabilityMatrixForRuntime('claude_code');
    const widget = cells.find((c) => c.capabilityId === 'widget');
    assert.ok(widget);
    assert.equal(widget!.trustBoundary, 'auto_safe');
  });

  it('memory (all 3 tools safe_read) → auto_safe', () => {
    const cells = capabilityMatrixForRuntime('claude_code');
    const memory = cells.find((c) => c.capabilityId === 'memory');
    assert.ok(memory);
    assert.equal(memory!.trustBoundary, 'auto_safe');
  });

  it('tasks_and_notify (list:safe_read + schedule/cancel:mutating_local + notify:side_effect) → mixed', () => {
    const cells = capabilityMatrixForRuntime('claude_code');
    const tasks = cells.find((c) => c.capabilityId === 'tasks_and_notify');
    assert.ok(tasks);
    assert.equal(
      tasks!.trustBoundary,
      'mixed',
      'tasks_and_notify mixes safe + mutating + side_effect tools — boundary must reflect that',
    );
  });

  it('image_generation (mutating_external) → requires_approval', () => {
    const cells = capabilityMatrixForRuntime('claude_code');
    const imageGen = cells.find((c) => c.capabilityId === 'image_generation');
    assert.ok(imageGen);
    assert.equal(imageGen!.trustBoundary, 'requires_approval');
  });

  it('media_import (mutating_local) → requires_approval', () => {
    const cells = capabilityMatrixForRuntime('claude_code');
    const mediaImport = cells.find((c) => c.capabilityId === 'media_import');
    assert.ok(mediaImport);
    assert.equal(mediaImport!.trustBoundary, 'requires_approval');
  });

  it('non-executable cells have no trustBoundary (model cant call them, so no boundary to display)', () => {
    for (const cell of flattenMatrix()) {
      if (cell.status !== 'executable') {
        assert.equal(
          cell.trustBoundary,
          undefined,
          `${cell.runtimeId}/${cell.capabilityId} is ${cell.status} but exposes trustBoundary=${cell.trustBoundary} — non-executable cells should not advertise approval rules`,
        );
      }
    }
  });

  it('executable cells with tools always have a trustBoundary', () => {
    for (const cell of flattenMatrix()) {
      if (cell.status === 'executable' && cell.toolNames.length > 0) {
        assert.ok(
          cell.trustBoundary,
          `executable cell ${cell.runtimeId}/${cell.capabilityId} missing trustBoundary — derivation broken`,
        );
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Phase 5e Phase 3 — Codex Account provider downgrade
// ─────────────────────────────────────────────────────────────────────

describe('Capability matrix — Codex Account provider downgrade', () => {
  it('codex_runtime + codex_account demotes image_generation / media_import to perception_only (bridge-only, no native injection yet)', () => {
    const cells = capabilityMatrixForRuntimeProvider('codex_runtime', 'codex_account');
    // Phase 8 — memory (P4), widget + tasks_and_notify (#31) are NO LONGER
    // demoted; they reach Codex Account via native injection (asserted below).
    for (const capId of ['image_generation', 'media_import']) {
      const cell = cells.find((c) => c.capabilityId === capId);
      assert.ok(cell, `${capId} should be in matrix`);
      assert.equal(
        cell!.status,
        'perception_only',
        `${capId} must be perception_only under codex_account (provider doesnt support CodePilot bridge)`,
      );
      assert.equal(
        cell!.toolNames.length,
        0,
        `${capId} under codex_account must NOT expose toolNames (would lead to "model sees tool name but cant call it")`,
      );
      assert.match(
        cell!.statusLine,
        /Codex Account/,
        `${capId} status line must explain Codex Account limitation`,
      );
      assert.equal(
        cell!.suggestedRuntime,
        'codepilot_runtime',
        `${capId} must suggest CodePilot Native as alternative`,
      );
    }
  });

  it('codex_runtime + codex_account keeps memory EXECUTABLE (native MCP injection) with an honest caveat note', () => {
    const cells = capabilityMatrixForRuntimeProvider('codex_runtime', 'codex_account');
    const memory = cells.find((c) => c.capabilityId === 'memory');
    assert.ok(memory, 'memory should be in matrix');
    // Phase 8: Memory is injected via native config.mcp_servers (validated
    // end-to-end), so it stays executable under Codex Account — NOT demoted
    // like the bridge-only built-ins above.
    assert.equal(memory!.status, 'executable');
    assert.ok(memory!.toolNames.length > 0, 'executable memory must expose its tool names');
    // ...but carries a caveat key so the UI is honest that autonomous model
    // use is pending the real-account smoke (Phase 5).
    assert.equal(memory!.noteKey, 'memory_codex_native');
    // The noteKey MUST resolve to real bilingual copy (else the UI renders
    // nothing). Copy stays outcome-oriented — no internal vocabulary.
    for (const lang of ['zh', 'en'] as const) {
      const note = getCapabilityNote(memory!.noteKey!, lang);
      assert.ok(note && note.length > 0, `note must resolve for ${lang}`);
      assert.doesNotMatch(note!, /MCP|config\.mcp_servers|Phase\s*5/i, `${lang} note must not leak internal vocabulary`);
    }
  });

  it('codex_runtime + codex_account keeps widget EXECUTABLE (native MCP injection, #31) with a caveat note', () => {
    const cells = capabilityMatrixForRuntimeProvider('codex_runtime', 'codex_account');
    const widget = cells.find((c) => c.capabilityId === 'widget');
    assert.ok(widget, 'widget should be in matrix');
    // #31: widget reaches Codex Account via native (keyword-gated) injection,
    // so it stays executable — not demoted like the remaining bridge-only caps.
    assert.equal(widget!.status, 'executable');
    assert.equal(widget!.noteKey, 'widget_codex_native');
    for (const lang of ['zh', 'en'] as const) {
      const note = getCapabilityNote(widget!.noteKey!, lang);
      assert.ok(note && note.length > 0, `widget note must resolve for ${lang}`);
      assert.doesNotMatch(note!, /MCP|config\.mcp_servers|Phase\s*5/i, `${lang} widget note must not leak internal vocabulary`);
    }
  });

  it('codex_runtime + codex_account keeps tasks_and_notify EXECUTABLE (native injection, #31) with a caveat note', () => {
    const cells = capabilityMatrixForRuntimeProvider('codex_runtime', 'codex_account');
    const tasks = cells.find((c) => c.capabilityId === 'tasks_and_notify');
    assert.ok(tasks, 'tasks_and_notify should be in matrix');
    // #31: always-on native injection; its mutating tools route to user
    // approval at call time, so the capability stays executable here.
    assert.equal(tasks!.status, 'executable');
    assert.equal(tasks!.noteKey, 'tasks_codex_native');
    for (const lang of ['zh', 'en'] as const) {
      const note = getCapabilityNote(tasks!.noteKey!, lang);
      assert.ok(note && note.length > 0, `tasks note must resolve for ${lang}`);
      assert.doesNotMatch(note!, /MCP|config\.mcp_servers|Phase\s*5/i, `${lang} tasks note must not leak internal vocabulary`);
    }
  });

  it('codex_runtime + codex_account promotes dashboard EXECUTABLE via mutation-level split (mixed trust)', () => {
    const cells = capabilityMatrixForRuntimeProvider('codex_runtime', 'codex_account');
    const dashboard = cells.find((c) => c.capabilityId === 'dashboard');
    assert.ok(dashboard, 'dashboard should be in matrix');
    // Codex review next slice (2026-05-28): dashboard is unsupported in the
    // codex_proxy contract (perception_only by default), but Codex Account
    // splits the MCP into read (auto_accept) + write (user_approval) and
    // injects both. The capability IS callable here, just gated.
    assert.equal(dashboard!.status, 'executable');
    assert.equal(dashboard!.trustBoundary, 'mixed');
    assert.equal(dashboard!.noteKey, 'dashboard_codex_native');
    assert.equal(dashboard!.suggestedRuntime, undefined, 'promoted cell must not carry a suggestedRuntime');
    for (const lang of ['zh', 'en'] as const) {
      const note = getCapabilityNote(dashboard!.noteKey!, lang);
      assert.ok(note && note.length > 0, `dashboard note must resolve for ${lang}`);
      assert.doesNotMatch(note!, /MCP|config\.mcp_servers|elicitation|auto_accept|user_approval/i, `${lang} dashboard note must not leak internal vocabulary`);
    }
  });

  it('codex_runtime + codex_account promotes cli_tools EXECUTABLE via mutation-level split (mixed trust)', () => {
    const cells = capabilityMatrixForRuntimeProvider('codex_runtime', 'codex_account');
    const cli = cells.find((c) => c.capabilityId === 'cli_tools');
    assert.ok(cli, 'cli_tools should be in matrix');
    assert.equal(cli!.status, 'executable');
    assert.equal(cli!.trustBoundary, 'mixed');
    assert.equal(cli!.noteKey, 'cli_tools_codex_native');
    assert.equal(cli!.suggestedRuntime, undefined, 'promoted cell must not carry a suggestedRuntime');
    for (const lang of ['zh', 'en'] as const) {
      const note = getCapabilityNote(cli!.noteKey!, lang);
      assert.ok(note && note.length > 0, `cli_tools note must resolve for ${lang}`);
      assert.doesNotMatch(note!, /MCP|config\.mcp_servers|elicitation|auto_accept|user_approval/i, `${lang} cli_tools note must not leak internal vocabulary`);
    }
  });

  it('codex_runtime + non-codex_account provider keeps the bridge-executable status', () => {
    const cells = capabilityMatrixForRuntimeProvider('codex_runtime', 'some_glm_provider');
    const widget = cells.find((c) => c.capabilityId === 'widget');
    assert.ok(widget);
    // For GLM-via-proxy, widget IS executable through the bridge
    assert.equal(widget!.status, 'executable');
  });

  it('codex_runtime + non-codex_account provider STILL promotes dashboard/cli (P1 fix, 2026-05-28)', () => {
    // Codex review P1.2: the runtime injects dashboard/cli split MCPs for
    // ANY codex_runtime provider (see runtime.ts injection blocks; no
    // provider gate). The matrix must mirror that — otherwise non-account
    // paths get the drift "Settings says not callable, model can call it".
    const cells = capabilityMatrixForRuntimeProvider('codex_runtime', 'some_glm_provider');
    for (const capId of ['dashboard', 'cli_tools']) {
      const cell = cells.find((c) => c.capabilityId === capId);
      assert.ok(cell, `${capId} must be in matrix`);
      assert.equal(cell!.status, 'executable', `${capId} must be executable on non-account Codex providers`);
      assert.equal(cell!.trustBoundary, 'mixed', `${capId} must carry mixed trust`);
      assert.equal(cell!.noteKey, `${capId === 'cli_tools' ? 'cli_tools' : 'dashboard'}_codex_native`);
    }
  });

  it('claude_code + codex_account is unaffected by the downgrade', () => {
    // Defensive: the downgrade is scoped to codex_runtime. Calling
    // it with claude_code + codex_account (a non-real combo) should
    // not trip the downgrade logic.
    const cells = capabilityMatrixForRuntimeProvider('claude_code', 'codex_account');
    const widget = cells.find((c) => c.capabilityId === 'widget');
    assert.ok(widget);
    assert.equal(widget!.status, 'executable');
  });

  it('capabilityMatrixForRuntimeProvider with no providerId === capabilityMatrixForRuntime', () => {
    const noProvider = capabilityMatrixForRuntimeProvider('codex_runtime');
    const direct = capabilityMatrixForRuntime('codex_runtime');
    assert.deepEqual(
      noProvider.map((c) => c.status),
      direct.map((c) => c.status),
      'without providerId, the provider-aware function must match the Runtime-only baseline',
    );
  });
});
