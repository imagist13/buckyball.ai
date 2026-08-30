/**
 * Phase 5d Phase 2 slice 2b (2026-05-17) — Equivalence harness with
 * Expected Differences Ledger.
 *
 * For each capability the compiler emits, check that the source file
 * the compiler claims as authoritative actually carries the canonical
 * export AND (separately) that every "ledger entry" describing a
 * paraphrase / drift in some Runtime really exists in that Runtime's
 * source file.
 *
 * This is a SOURCE-LEVEL test (not a runtime test that boots each
 * Runtime). Source-level is sufficient because:
 *   1. The compiler reads from the catalog's authoritative file +
 *      export. If the file/export exists and the compiler reads it,
 *      the compiled prompt is correct.
 *   2. The ledger describes what each Runtime's current
 *      implementation TEXT looks like at the source level. As long as
 *      that text continues to exist, the ledger is honest about the
 *      drift; once a slice migrates the Runtime to consume the
 *      compiler, the slice MUST manually remove the ledger entry.
 *
 * Test surface:
 *
 *   - Every compiler source the catalog points at exists.
 *   - Every ledger.runtimeSource is reachable in the repo.
 *   - For every `capability_fragment_replaced` ledger entry, the
 *     Runtime's source export currently differs from the compiler's
 *     source export.
 *   - The ledger and the compiler agree on which Runtime is
 *     drifting (e.g. no Codex ledger entry referencing slice_2d).
 *
 * After slice 2d migrates Native to consume the compiler, the
 * `capability_fragment_replaced` entries for `codepilot_runtime` get
 * manually removed; this test then asserts the ledger is shrinking
 * in the expected direction.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  EXPECTED_DIFFERENCES,
  expectedDifferencesFor,
} from '@/lib/harness/expected-differences';
import { compileContext } from '@/lib/harness/context-compiler';

const REPO_ROOT = path.resolve(__dirname, '../../..');

function readSource(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8');
}

function exportLooksReal(rel: string, exportName: string): boolean {
  // Inline-in-factory exports + snapshot fields are not graspable
  // by static grep; we treat them as opaque (no false positive).
  if (exportName.startsWith('<') && exportName.endsWith('>')) return true;
  const src = readSource(rel);
  // Common shape: `export const FOO = ` / `export function foo` /
  // `export interface Foo`. Be liberal in the regex to cover all.
  const re = new RegExp(`export (?:const|function|interface|class|type|let|var) ${exportName}\\b`);
  return re.test(src);
}

// ─────────────────────────────────────────────────────────────────────
// (A) Compiler source reachability
// ─────────────────────────────────────────────────────────────────────

describe('Equivalence harness — compiler source reachability', () => {
  it('every compiler source file referenced by a ledger entry is readable', () => {
    for (const entry of EXPECTED_DIFFERENCES) {
      const full = path.join(REPO_ROOT, entry.compilerSource.sourceFile);
      assert.ok(
        fs.existsSync(full),
        `compiler source missing for ${entry.runtimeId}.${entry.capability}: ${entry.compilerSource.sourceFile}`,
      );
    }
  });

  it('every compiler source export referenced by a ledger entry is statically discoverable', () => {
    for (const entry of EXPECTED_DIFFERENCES) {
      assert.ok(
        exportLooksReal(entry.compilerSource.sourceFile, entry.compilerSource.sourceExport),
        `${entry.runtimeId}.${entry.capability}: compilerSource export ${entry.compilerSource.sourceExport} not found in ${entry.compilerSource.sourceFile}`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// (B) Runtime source drift is honest
// ─────────────────────────────────────────────────────────────────────

describe('Equivalence harness — runtime drift is honest', () => {
  it('every runtimeSource file in the ledger is readable', () => {
    for (const entry of EXPECTED_DIFFERENCES) {
      if (!entry.runtimeSource) continue;
      const full = path.join(REPO_ROOT, entry.runtimeSource.sourceFile);
      assert.ok(
        fs.existsSync(full),
        `${entry.runtimeId}.${entry.capability}: runtimeSource file does not exist: ${entry.runtimeSource.sourceFile}`,
      );
    }
  });

  it('every runtimeSource export in the ledger is statically discoverable', () => {
    for (const entry of EXPECTED_DIFFERENCES) {
      if (!entry.runtimeSource) continue;
      assert.ok(
        exportLooksReal(entry.runtimeSource.sourceFile, entry.runtimeSource.sourceExport),
        `${entry.runtimeId}.${entry.capability}: runtimeSource export ${entry.runtimeSource.sourceExport} not found in ${entry.runtimeSource.sourceFile} — if the migration removed it, also remove the ledger entry`,
      );
    }
  });

  it('capability_fragment_replaced entries: runtimeSource and compilerSource ARE different sources (otherwise the ledger lies)', () => {
    for (const entry of EXPECTED_DIFFERENCES) {
      if (entry.diff !== 'capability_fragment_replaced') continue;
      assert.ok(entry.runtimeSource);
      const same =
        entry.compilerSource.sourceFile === entry.runtimeSource!.sourceFile &&
        entry.compilerSource.sourceExport === entry.runtimeSource!.sourceExport;
      assert.equal(
        same,
        false,
        `${entry.runtimeId}.${entry.capability}: capability_fragment_replaced but both sides point at the same source — there is no drift to record`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// (C) Ledger / plan correspondence
// ─────────────────────────────────────────────────────────────────────

describe('Equivalence harness — ledger ↔ slice ownership', () => {
  it('no Codex-runtime entries currently in slice_2d (slice 2d is Native scope)', () => {
    // Phase 2 slice ownership: 2c = claude_code, 2d = codepilot_runtime,
    // 2e = codex_runtime. A Codex entry tagged slice_2d would be a
    // catalog bug (wrong slice claiming the work).
    for (const entry of EXPECTED_DIFFERENCES) {
      if (entry.runtimeId !== 'codex_runtime') continue;
      assert.notEqual(
        entry.plannedResolution,
        'slice_2d',
        `${entry.capability} is a Codex Runtime drift but tagged slice_2d (Native scope) — fix the ledger`,
      );
    }
  });

  it('no Native entries tagged slice_2e and no ClaudeCode entries tagged slice_2c→2e ownership mismatch', () => {
    for (const entry of EXPECTED_DIFFERENCES) {
      if (entry.runtimeId === 'codepilot_runtime') {
        assert.notEqual(entry.plannedResolution, 'slice_2e');
      }
      if (entry.runtimeId === 'claude_code') {
        assert.notEqual(entry.plannedResolution, 'slice_2d');
        assert.notEqual(entry.plannedResolution, 'slice_2e');
      }
    }
  });

  it('post-Phase-5e-P1: Native ledger is empty (image_generation MediaBlock follow_up resolved)', () => {
    // Phase 5d Phase 2 slice 2d consumed the three Native paraphrase
    // entries (memory / tasks_and_notify / media_import).
    //
    // Phase 5e Phase 0.5 P1 (2026-05-17 Native MediaBlock 補齐) closed
    // the final `image_generation` follow_up: `builtin-tools/media.ts`
    // now emits MediaBlock[] via the harness side-channel
    // (`@/lib/harness/builtin-event-bus`); `agent-loop.ts` splices the
    // blocks into the SSE `tool_result.media` field. Codex bridge +
    // Native + (ClaudeCode SDK marker path) all surface MediaBlock
    // consistently — no remaining tool_result_shape drift.
    //
    // Pin shifted from "exactly 1 entry (the follow_up)" to "empty";
    // any future drift must add a NEW ledger entry with explicit
    // plannedResolution + slice owner.
    const native = expectedDifferencesFor('codepilot_runtime');
    assert.equal(
      native.length,
      0,
      `expected empty Native ledger after Phase 5e P1; got ${native.length}: ${native.map((e) => e.capability).join(', ')}`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// (D) Compiler outputs the canonical for every live capability
// ─────────────────────────────────────────────────────────────────────

describe('Equivalence harness — compiler output sources align with capability-contract authority', () => {
  it('every capability fragment the compiler emits points at a real file + export (no <unknown>)', () => {
    const out = compileContext({
      sessionId: 'eq-test',
      workingDirectory: '/tmp',
      runtimeId: 'codex_runtime',
      providerId: 'prov-test',
      model: 'test',
      userPrompt: '',
      enabledCapabilities: null,
      tokenBudget: { systemPromptMax: 50_000, contextMax: 100_000 },
    });
    for (const frag of out.capabilityFragments) {
      assert.notEqual(frag.sourceFile, '<unknown>', `${frag.sourceCapability} has unknown sourceFile`);
      assert.notEqual(frag.sourceExport, '<unknown>', `${frag.sourceCapability} has unknown sourceExport`);
      assert.ok(
        fs.existsSync(path.join(REPO_ROOT, frag.sourceFile)),
        `${frag.sourceCapability} sourceFile missing: ${frag.sourceFile}`,
      );
      assert.ok(
        exportLooksReal(frag.sourceFile, frag.sourceExport),
        `${frag.sourceCapability} sourceExport not statically discoverable: ${frag.sourceFile}::${frag.sourceExport}`,
      );
    }
  });
});
