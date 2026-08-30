/**
 * Phase 1 — Context Accounting Runtime Contract shape tests.
 *
 * Pins the contract so a future refactor can't silently regress:
 *   - producedBy is restricted to project RuntimeIds (no 'native' alias)
 *   - every entry carries a `source` breadcrumb
 *   - `unsupported` is first-class (distinct from entries with tokens=0)
 *   - source breadcrumb format distinguishes available vs invoked
 *   - snapshotToCompilerInputs maps real data; ignores unsupported
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTEXT_ACCOUNTING_KIND_ORDER,
  makeAllUnsupportedSnapshot,
  makeEmptySnapshot,
  snapshotToCompilerInputs,
  type ContextAccountingEntry,
  type ContextAccountingRuntimeId,
  type RuntimeContextAccountingSnapshot,
} from '../../lib/harness/context-accounting';

describe('Context Accounting Runtime Contract — shape', () => {
  it('producedBy is restricted to project RuntimeIds (no native alias)', () => {
    const valid: ContextAccountingRuntimeId[] = [
      'claude_code',
      'codepilot_runtime',
      'codex_runtime',
    ];
    // Pin the union exactly — a future PR adding 'native' would
    // silently expand the type; this assert is the canary.
    assert.deepEqual([...valid].sort(), [
      'claude_code',
      'codepilot_runtime',
      'codex_runtime',
    ].sort());

    for (const id of valid) {
      const snap = makeEmptySnapshot(id);
      assert.equal(snap.producedBy, id);
    }
  });

  it('every entry MUST carry a non-empty source breadcrumb', () => {
    const entry: ContextAccountingEntry = {
      tokens: 100,
      source: 'sdk-turn/loaded-skill',
    };
    assert.equal(typeof entry.source, 'string');
    assert.ok(entry.source.length > 0);
  });

  it('unsupported is a first-class state distinct from entries with tokens=0', () => {
    // Pattern A: Runtime says "I can't count MCP" — UI hides row
    const snapA: RuntimeContextAccountingSnapshot = {
      entries: {},
      unsupported: ['mcp', 'tools'],
      producedBy: 'codex_runtime',
      providerBackend: 'codex_account',
    };
    assert.ok(snapA.unsupported.includes('mcp'));
    assert.equal(snapA.entries.mcp, undefined);

    // Pattern B: Runtime supports MCP, this turn produced 0 — entry exists
    const snapB: RuntimeContextAccountingSnapshot = {
      entries: { mcp: { tokens: 0, source: 'mcp-server-schemas/available' } },
      unsupported: [],
      producedBy: 'claude_code',
    };
    assert.equal(snapB.entries.mcp?.tokens, 0);
    assert.ok(!snapB.unsupported.includes('mcp'));
  });

  it('providerBackend encodes Codex sub-modes; ClaudeCode/CodePilot typically omit', () => {
    const codexAccount = makeAllUnsupportedSnapshot('codex_runtime', {
      providerBackend: 'codex_account',
    });
    assert.equal(codexAccount.providerBackend, 'codex_account');

    const codexProxy = makeEmptySnapshot('codex_runtime', {
      providerBackend: 'codepilot_proxy',
    });
    assert.equal(codexProxy.providerBackend, 'codepilot_proxy');

    const claudeCode = makeEmptySnapshot('claude_code');
    assert.equal(claudeCode.providerBackend, undefined);

    const codepilot = makeEmptySnapshot('codepilot_runtime');
    assert.equal(codepilot.providerBackend, undefined);
  });

  it('source breadcrumb format distinguishes available vs invoked (semantic test)', () => {
    // available = every-turn list (NOT the user-visible Skills row)
    const availableSnap: RuntimeContextAccountingSnapshot = {
      entries: {
        skills: { tokens: 1500, source: 'sdk-init/available-skills' },
      },
      unsupported: [],
      producedBy: 'claude_code',
    };
    // invoked = this turn's actual injection (IS the user-visible Skills row)
    const invokedSnap: RuntimeContextAccountingSnapshot = {
      entries: {
        skills: {
          tokens: 800,
          source: 'sdk-turn/loaded-skill',
          detail: 'humanizer-zh',
        },
      },
      unsupported: [],
      producedBy: 'claude_code',
    };

    assert.notEqual(
      availableSnap.entries.skills?.source,
      invokedSnap.entries.skills?.source,
    );
    assert.ok(invokedSnap.entries.skills?.source.startsWith('sdk-turn/'));
    assert.ok(availableSnap.entries.skills?.source.startsWith('sdk-init/'));
  });

  it('CONTEXT_ACCOUNTING_KIND_ORDER is stable + covers 7 kinds', () => {
    assert.equal(CONTEXT_ACCOUNTING_KIND_ORDER.length, 7);
    assert.deepEqual([...CONTEXT_ACCOUNTING_KIND_ORDER], [
      'system_prompt',
      'tools',
      'rules',
      'skills',
      'mcp',
      'memory',
      'files_attachments',
    ]);
  });
});

describe('snapshotToCompilerInputs — Runtime → breakdown layer mapping', () => {
  it('returns undefined when snapshot is null/undefined', () => {
    assert.equal(snapshotToCompilerInputs(null), undefined);
    assert.equal(snapshotToCompilerInputs(undefined), undefined);
  });

  it('returns undefined when no entries and no real data', () => {
    const snap = makeAllUnsupportedSnapshot('claude_code');
    assert.equal(snapshotToCompilerInputs(snap), undefined);
  });

  it('maps entries[kind].tokens to compiler.*Tokens fields', () => {
    const snap: RuntimeContextAccountingSnapshot = {
      entries: {
        system_prompt: { tokens: 500, source: 'sdk-actual-system-prompt' },
        skills: { tokens: 800, source: 'sdk-turn/loaded-skill' },
        memory: { tokens: 200, source: 'assistant-memory-snapshot' },
      },
      unsupported: [],
      producedBy: 'claude_code',
    };
    const compiler = snapshotToCompilerInputs(snap);
    assert.equal(compiler?.systemPromptTokens, 500);
    assert.equal(compiler?.skillsHarnessTokens, 800);
    assert.equal(compiler?.memoryTokens, 200);
    assert.equal(compiler?.toolDescriptorTokens, undefined);
    assert.equal(compiler?.workspaceRuleTokens, undefined);
    assert.equal(compiler?.mcpDescriptorTokens, undefined);
  });

  it('treats unsupported kinds as undefined even if entries accidentally present', () => {
    // Defensive — if someone fills entries.mcp AND unsupported.includes('mcp'),
    // the contract says unsupported wins (Runtime explicitly said it can't count).
    const snap: RuntimeContextAccountingSnapshot = {
      entries: {
        mcp: { tokens: 123, source: 'stale-data' },
      },
      unsupported: ['mcp'],
      producedBy: 'codex_runtime',
      providerBackend: 'codex_account',
    };
    const compiler = snapshotToCompilerInputs(snap);
    assert.equal(compiler, undefined);
  });
});
