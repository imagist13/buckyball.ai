import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContextUsageBreakdown,
  CONTEXT_BREAKDOWN_KIND_ORDER,
  DEFAULT_LABELS,
  PENDING_BREAKDOWN_KINDS,
  type ContextBreakdownKind,
} from '../../lib/context-breakdown';

const PENDING_SET = new Set<ContextBreakdownKind>(PENDING_BREAKDOWN_KINDS);

describe('buildContextUsageBreakdown — shape and ordering', () => {
  it('returns 10 parts in stable CONTEXT_BREAKDOWN_KIND_ORDER', () => {
    const result = buildContextUsageBreakdown({});
    assert.equal(result.parts.length, 10);
    assert.deepEqual(
      result.parts.map((p) => p.kind),
      [...CONTEXT_BREAKDOWN_KIND_ORDER],
    );
  });

  it('returns all-zero tokens when inputs empty', () => {
    const result = buildContextUsageBreakdown({});
    assert.equal(result.usedTokens, 0);
    for (const part of result.parts) {
      assert.equal(part.tokens, 0, `${part.kind} expected 0, got ${part.tokens}`);
    }
  });

  it('every part has user-facing label matching DEFAULT_LABELS', () => {
    const result = buildContextUsageBreakdown({});
    for (const part of result.parts) {
      assert.equal(part.label, DEFAULT_LABELS[part.kind]);
    }
  });

  it('every part has a non-empty source breadcrumb', () => {
    const result = buildContextUsageBreakdown({});
    for (const part of result.parts) {
      assert.ok(part.source.length > 0, `${part.kind} missing source`);
    }
  });

  it('does NOT expose any confidence / measured / estimated / derived field', () => {
    // Per user 2026-05-19: confidence labels are deliberately not exposed.
    const result = buildContextUsageBreakdown({
      baseline: {
        used: 1000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
      },
      compiler: { systemPromptTokens: 500 },
    });
    for (const part of result.parts) {
      assert.equal(
        'confidence' in part,
        false,
        `${part.kind} unexpectedly carries a confidence field`,
      );
    }
  });
});

describe('buildContextUsageBreakdown — usedTokens accounting', () => {
  it('sums all USED (non-pending) parts to usedTokens when known parts ≤ used', () => {
    const result = buildContextUsageBreakdown({
      baseline: {
        used: 10000,
        cacheReadTokens: 2000,
        cacheCreationTokens: 0,
        outputTokens: 0,
      },
      compiler: {
        systemPromptTokens: 1000,
        toolDescriptorTokens: 500,
        workspaceRuleTokens: 200,
        skillsHarnessTokens: 300,
        mcpDescriptorTokens: 0,
        memoryTokens: 1000,
      },
    });

    const usedParts = result.parts.filter((p) => !PENDING_SET.has(p.kind));
    const sum = usedParts.reduce((s, p) => s + p.tokens, 0);
    assert.equal(sum, 10000, 'used parts must sum to usedTokens');
  });

  it('clamps conversation to 0 when known parts exceed used', () => {
    const result = buildContextUsageBreakdown({
      baseline: {
        used: 1000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
      },
      compiler: { systemPromptTokens: 5000 }, // over-estimated
    });
    const conv = result.parts.find((p) => p.kind === 'conversation');
    assert.equal(conv?.tokens, 0, 'conversation clamps to 0 instead of going negative');
  });

  it('when known parts exceed reported used, usedTokens promotes to match (Phase 7 fix)', () => {
    // Updated 2026-05-20: previously usedTokens stayed at baseline.used (1000)
    // while breakdown summed to known parts (5000) — visually inconsistent
    // ("header says 1K but rows total 5K"). The old behavior also broke
    // Native+Codex via provider proxies which report input_tokens=0; the
    // popover showed used=0 with empty dot-matrix even though entries had
    // real per-turn token cost.
    // New: usedTokens = max(reportedUsedTokens, knownNonConv + output). On
    // ClaudeCode where reportedUsedTokens already includes everything,
    // max() picks the larger (typically reported, no double-count). On
    // Native+Codex with reportedUsedTokens=0, knownParts wins.
    const result = buildContextUsageBreakdown({
      baseline: {
        used: 1000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
      },
      compiler: { systemPromptTokens: 5000 },
    });
    const usedParts = result.parts.filter((p) => !PENDING_SET.has(p.kind));
    const sum = usedParts.reduce((s, p) => s + p.tokens, 0);
    assert.equal(sum, 5000, 'breakdown rows sum to known parts');
    assert.equal(result.usedTokens, 5000, 'usedTokens promoted to match breakdown sum');
  });

  it('Native/Codex regression: reportedUsedTokens=0 + entries.tools > 0 → effective used = entries sum + output', () => {
    // Provider-proxy (Codex+GLM, Native+OpenRouter) reports input_tokens=0
    // even on substantive turns. Without this promotion, popover showed
    // "used: 0" + empty dot-matrix even when entries.tools surfaced real
    // per-turn token cost via auto-invoke-accounting (Phase 7).
    const result = buildContextUsageBreakdown({
      baseline: {
        used: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 2552,
      },
      compiler: {
        toolDescriptorTokens: 813,
        workspaceRuleTokens: 93,
      },
    });
    assert.equal(result.usedTokens, 813 + 93 + 2552, 'usedTokens reflects entries + output');
    const conv = result.parts.find((p) => p.kind === 'conversation');
    assert.equal(conv?.tokens, 2552, 'conversation absorbs outputTokens residual');
  });

  it('clamps negative baseline.used to 0', () => {
    const result = buildContextUsageBreakdown({
      baseline: {
        used: -100,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
      },
    });
    assert.equal(result.usedTokens, 0);
  });

  it('floors fractional baseline.used to integer', () => {
    const result = buildContextUsageBreakdown({
      baseline: {
        used: 1234.7,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
      },
    });
    assert.equal(result.usedTokens, 1234);
  });
});

describe('buildContextUsageBreakdown — pending parts do NOT pollute usedTokens', () => {
  it('files_attachments sums attachment + mention + directory', () => {
    const result = buildContextUsageBreakdown({
      baseline: {
        used: 1000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
      },
      pending: { attachmentTokens: 500, mentionTokens: 300, directoryTokens: 200 },
    });
    assert.equal(result.usedTokens, 1000, 'usedTokens unaffected by pending');
    const files = result.parts.find((p) => p.kind === 'files_attachments');
    assert.equal(files?.tokens, 1000); // 500 + 300 + 200
  });

  it('pending_next_turn captures composer text estimate separately', () => {
    const result = buildContextUsageBreakdown({
      baseline: {
        used: 1000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
      },
      pending: { composerTextTokens: 250 },
    });
    assert.equal(result.usedTokens, 1000, 'usedTokens unaffected');
    const pendingTurn = result.parts.find((p) => p.kind === 'pending_next_turn');
    assert.equal(pendingTurn?.tokens, 250);
  });

  it('PENDING_BREAKDOWN_KINDS lists exactly the two pending kinds', () => {
    assert.deepEqual(
      [...PENDING_BREAKDOWN_KINDS],
      ['files_attachments', 'pending_next_turn'],
    );
  });
});

describe('buildContextUsageBreakdown — context window branches', () => {
  it('omits ratio and remainingTokens when contextWindow undefined', () => {
    const result = buildContextUsageBreakdown({
      baseline: {
        used: 5000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
      },
    });
    assert.equal(result.ratio, undefined);
    assert.equal(result.remainingTokens, undefined);
    assert.equal(result.contextWindow, undefined);
  });

  it('omits ratio when contextWindow is 0 or negative', () => {
    const zero = buildContextUsageBreakdown({
      baseline: {
        used: 5000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
      },
      contextWindow: 0,
    });
    assert.equal(zero.ratio, undefined);
    assert.equal(zero.contextWindow, undefined);

    const neg = buildContextUsageBreakdown({
      baseline: {
        used: 5000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
      },
      contextWindow: -1000,
    });
    assert.equal(neg.ratio, undefined);
  });

  it('computes ratio and remainingTokens when contextWindow valid', () => {
    const result = buildContextUsageBreakdown({
      baseline: {
        used: 14000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
      },
      contextWindow: 100000,
    });
    assert.ok(result.ratio !== undefined);
    assert.ok(Math.abs((result.ratio as number) - 0.14) < 0.0001);
    assert.equal(result.remainingTokens, 86000);
    assert.equal(result.contextWindow, 100000);
  });

  it('clamps ratio to 1.0 and remaining to 0 when over budget', () => {
    const result = buildContextUsageBreakdown({
      baseline: {
        used: 250000,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
      },
      contextWindow: 200000,
    });
    assert.equal(result.ratio, 1);
    assert.equal(result.remainingTokens, 0);
  });
});

describe('buildContextUsageBreakdown — cache accounting', () => {
  it('cache_or_previous = cacheReadTokens + cacheCreationTokens', () => {
    const result = buildContextUsageBreakdown({
      baseline: {
        used: 10000,
        cacheReadTokens: 3000,
        cacheCreationTokens: 1500,
        outputTokens: 0,
      },
    });
    const cache = result.parts.find((p) => p.kind === 'cache_or_previous');
    assert.equal(cache?.tokens, 4500);
  });

  it('cache counts into usedTokens — conversation residual excludes cache', () => {
    const result = buildContextUsageBreakdown({
      baseline: {
        used: 10000,
        cacheReadTokens: 4000,
        cacheCreationTokens: 0,
        outputTokens: 0,
      },
      compiler: { systemPromptTokens: 1000 },
    });
    const conv = result.parts.find((p) => p.kind === 'conversation');
    // 10000 - 4000 cache - 1000 system = 5000
    assert.equal(conv?.tokens, 5000);
  });
});
