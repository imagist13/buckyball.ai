/**
 * agent-loop-anthropic-wire.test.ts — executable behavior test for the native
 * Agent Loop's Anthropic `providerOptions` wire shape (model plan Phase 2 / s05,
 * 2026-07-18).
 *
 * Codex review (round #1) flagged that s05 was only source-pinned: tests
 * asserted the sanitizer returned effort and that the source text mentioned
 * `anthropicOpts.effort`, but nothing ran the wire-construction path and
 * captured the object that reaches `streamText({ providerOptions })`.
 *
 * buildAnthropicProviderOptions is that exact construction path (agent-loop.ts
 * calls it and assigns its `.anthropic` straight to `providerOptions`). Feeding
 * it real sanitized options and asserting on the returned object IS asserting on
 * the real request shape. This covers the s05 contract: Sonnet 5 + xhigh on the
 * OFFICIAL Anthropic Native path sends providerOptions.anthropic.effort='xhigh'
 * with NO effort-ignored signal, while the third-party PROXY path drops it and
 * raises the drop signal (RUNTIME_EFFORT_IGNORED, keyed off effortDroppedForProxy).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAnthropicProviderOptions } from '../../lib/agent-loop-anthropic-wire';
import {
  anthropicApiSupportsEffortLevel,
  getAnthropicApiSupportedEffortLevels,
  sanitizeClaudeModelOptions,
} from '../../lib/claude-model-options';

// Mirror agent-loop.ts: sanitize the user's model options, then build the wire.
function wireFor(opts: {
  model: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  isThirdPartyProxy: boolean;
  thinking?: { type: 'adaptive' } | { type: 'enabled'; budgetTokens?: number } | { type: 'disabled' };
  context1m?: boolean;
}) {
  const sanitized = sanitizeClaudeModelOptions({
    model: opts.model,
    effort: opts.effort,
    thinking: opts.thinking,
    context1m: opts.context1m,
  });
  return buildAnthropicProviderOptions({
    isThirdPartyProxy: opts.isThirdPartyProxy,
    model: opts.model,
    sanitized,
  });
}

describe('s05 — Sonnet 5 effort reaches the OFFICIAL Anthropic Native wire', () => {
  it('sonnet-5 + xhigh → providerOptions.anthropic.effort=xhigh, no drop signal', () => {
    const wire = wireFor({ model: 'claude-sonnet-5', effort: 'xhigh', isThirdPartyProxy: false });
    // This IS the object assigned to providerOptions.anthropic in streamText.
    assert.equal(wire.anthropic?.effort, 'xhigh',
      'the composer xhigh pick must reach the wire on the official path');
    assert.equal(wire.effortDroppedForProxy, false,
      'official path never raises the proxy drop signal');
    assert.equal(wire.effortDroppedUnsupportedModel, false,
      'sonnet-5 IS on the effort list — no unsupported-model toast');
  });

  it('sonnet-5 sends adaptive thinking alongside effort (both survive)', () => {
    const wire = wireFor({
      model: 'claude-sonnet-5', effort: 'high',
      thinking: { type: 'enabled', budgetTokens: 8000 }, isThirdPartyProxy: false,
    });
    assert.equal(wire.anthropic?.effort, 'high');
    // manual thinking is converted to adaptive/summarized by the sanitizer.
    assert.deepEqual(wire.anthropic?.thinking, { type: 'adaptive', display: 'summarized' });
    // 1M is default for the adaptive family → no context-1m beta header.
    assert.equal(wire.anthropic?.anthropicBeta, undefined);
  });

  // Codex review P1 round #7 (2026-07-18): Sonnet 4.6 IS on Anthropic's effort
  // list (low/medium/high/max) and the catalog offers the picker for it, but the
  // allowlist had omitted it — the pick was dropped and the user was told the
  // model "doesn't support effort", contradicting both UI and provider.
  // Effort and adaptive-thinking are separate axes: 4.6 gets effort AND keeps
  // manual extended thinking.
  it('sonnet 4.6 + high → effort on the wire, no drop signal, manual thinking intact', () => {
    const wire = wireFor({
      model: 'claude-sonnet-4-6', effort: 'high',
      thinking: { type: 'enabled', budgetTokens: 4000 }, isThirdPartyProxy: false,
    });
    assert.equal(wire.anthropic?.effort, 'high',
      'Sonnet 4.6 is effort-capable — the composer pick must reach the wire');
    assert.equal(wire.effortDroppedUnsupportedModel, false,
      'no drop → no contradictory "not supported" toast');
    // 4.6 is NOT in the adaptive family: manual extended thinking survives.
    assert.deepEqual(wire.anthropic?.thinking, { type: 'enabled', budgetTokens: 4000 });
  });

  it('sonnet 4.6 + max remains valid, but xhigh is omitted with exact tier evidence', () => {
    const max = wireFor({
      model: 'claude-sonnet-4-6', effort: 'max', isThirdPartyProxy: false,
    });
    assert.equal(max.anthropic?.effort, 'max');
    assert.equal(max.effortDroppedUnsupportedTier, undefined);

    const xhigh = wireFor({
      model: 'claude-sonnet-4-6', effort: 'xhigh', isThirdPartyProxy: false,
    });
    assert.equal(xhigh.anthropic?.effort, undefined,
      'Sonnet 4.6 supports effort but does not accept xhigh');
    assert.deepEqual(xhigh.effortDroppedUnsupportedTier, {
      requested: 'xhigh',
      supported: ['low', 'medium', 'high', 'max'],
    });
    assert.equal(xhigh.effortDroppedUnsupportedModel, false,
      'the model supports effort; this is specifically a tier mismatch');
    assert.equal(anthropicApiSupportsEffortLevel('claude-sonnet-4-6', 'xhigh'), false);
    assert.equal(anthropicApiSupportsEffortLevel('claude-sonnet-4-6', 'max'), true);
    assert.deepEqual(
      getAnthropicApiSupportedEffortLevels('claude-sonnet-4-6'),
      ['low', 'medium', 'high', 'max'],
    );
  });

  it('the rest of the adaptive family also sends effort on the official path', () => {
    for (const model of ['claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7']) {
      const wire = wireFor({ model, effort: 'max', isThirdPartyProxy: false });
      assert.equal(wire.anthropic?.effort, 'max', `${model} must send effort officially`);
      assert.equal(wire.effortDroppedForProxy, false);
    }
  });
});

describe('s05 — models NOT on Anthropic\'s effort list omit effort officially', () => {
  // Codex review P1 (2026-07-18) reproduced the regression this covers: the
  // official-path helper took no model, so claude-haiku-4-5-20251001 + max
  // reached the wire as {"effort":"max"} even though Haiku 4.5 is absent from
  // Anthropic's effort-capable model list.
  it('haiku 4.5 + max → NO effort field on the wire, unsupported-model signal true', () => {
    const wire = wireFor({
      model: 'claude-haiku-4-5-20251001', effort: 'max', isThirdPartyProxy: false,
    });
    assert.equal(wire.anthropic?.effort, undefined,
      'Haiku 4.5 is not effort-capable — effort must not reach the wire');
    assert.ok(
      !wire.anthropic || !('effort' in wire.anthropic),
      'the key must be ABSENT, not present-and-undefined (it would serialize)',
    );
    assert.equal(wire.effortDroppedUnsupportedModel, true,
      'the omission must raise RUNTIME_EFFORT_IGNORED — never a silent drop');
    assert.equal(wire.effortDroppedForProxy, false,
      'this is the official path, not a proxy — the two signals stay distinct');
  });

  it('an unknown model fails closed the same way', () => {
    const wire = wireFor({
      model: 'some-unreleased-model-9', effort: 'high', isThirdPartyProxy: false,
    });
    assert.equal(wire.anthropic?.effort, undefined,
      'unknown models must not be assumed effort-capable');
    assert.equal(wire.effortDroppedUnsupportedModel, true);
  });

  // Codex review P1 round #7 (2026-07-18): near-miss IDs. An unbounded
  // `/sonnet-?5/i` matches `claude-sonnet-50`, and `/opus-?4[-.]?7/i` matches
  // `claude-opus-4-70` — both would hand an unverified model a capability claim.
  // Unknown must fail closed, so these omit effort and raise the drop signal.
  for (const model of ['claude-sonnet-50', 'claude-opus-4-70', 'claude-fable-55', 'claude-sonnet-46']) {
    it(`near-miss unknown ID ${model} is NOT treated as effort-capable`, () => {
      const wire = wireFor({ model, effort: 'high', isThirdPartyProxy: false });
      assert.equal(wire.anthropic?.effort, undefined,
        `${model} is not on the official list — a boundary-less regex must not claim it`);
      assert.equal(wire.effortDroppedUnsupportedModel, true);
    });
  }

  it('no effort selected on an unsupported model raises no signal', () => {
    const wire = wireFor({ model: 'claude-haiku-4-5-20251001', isThirdPartyProxy: false });
    assert.equal(wire.effortDroppedUnsupportedModel, false,
      'nothing was dropped → no misleading toast');
  });
});

describe('s05 — both native paths gate on the model and announce the drop', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), 'src/lib', rel), 'utf8');

  it('agent-loop passes the resolved model into the wire builder', () => {
    const src = read('agent-loop.ts');
    assert.match(src, /buildAnthropicProviderOptions\(\{[\s\S]{0,120}model: config\.modelId/,
      'without a model the gate cannot exist — this is the exact P1 regression');
    assert.match(src, /wire\.effortDroppedUnsupportedModel[\s\S]{0,600}RUNTIME_EFFORT_IGNORED/,
      'the omission must raise the one-shot notification, not vanish');
    assert.match(src, /wire\.effortDroppedUnsupportedTier[\s\S]{0,900}unsupported-tier/,
      'an unsupported tier must be announced separately from an unsupported model');
  });

  it('the toolloop POC shares the same builder (no drift between native paths)', () => {
    const src = read('experimental/agent-loop-toolloop-poc.ts');
    assert.match(src, /buildAnthropicProviderOptions\(\{[\s\S]{0,120}model: config\.modelId/);
    assert.match(src, /wire\.effortDroppedUnsupportedModel[\s\S]{0,600}RUNTIME_EFFORT_IGNORED/);
    assert.match(src, /wire\.effortDroppedUnsupportedTier[\s\S]{0,900}unsupported-tier/);
  });

  it('the allowlist is NOT sourced from catalog supportedEffortLevels', () => {
    // The catalog declares haiku 4.5 effort-capable for the UI picker / SDK CLI;
    // the Anthropic API's effort list does not include it. Deriving the wire
    // gate from the catalog would re-introduce the finding.
    const src = read('claude-model-options.ts');
    assert.doesNotMatch(src, /^import .*provider-catalog/m,
      'the wire allowlist must not read the UI capability feed');
    assert.match(src, /ANTHROPIC_API_EFFORT_MODELS/);
    // Every entry must carry the official source it was verified against.
    const block = src.slice(src.indexOf('ANTHROPIC_API_EFFORT_MODELS:'));
    const entries = block.slice(0, block.indexOf('\n];'));
    assert.equal(
      (entries.match(/pattern:/g) || []).length,
      (entries.match(/breadcrumb:/g) || []).length,
      'an allowlist entry without a breadcrumb is an unsourced capability claim',
    );
    assert.equal(
      (entries.match(/pattern:/g) || []).length,
      (entries.match(/levels:/g) || []).length,
      'every verified model must enforce its exact API effort tiers',
    );
    assert.ok((entries.match(/pattern:/g) || []).length >= 5);
    // Every pattern must be bounded on both sides or near-miss IDs slip in.
    for (const p of entries.match(/pattern: \/[^/]+\//g) || []) {
      assert.ok(p.includes('(?:^|[^a-z0-9])') && p.includes('(?![0-9])'),
        `allowlist pattern lacks token boundaries — unknown IDs would match: ${p}`);
    }
  });
});

describe('s05 — third-party proxy still DROPS effort and raises the signal', () => {
  it('sonnet-5 + xhigh on a proxy → no effort on the wire, drop signal true', () => {
    const wire = wireFor({ model: 'claude-sonnet-5', effort: 'xhigh', isThirdPartyProxy: true });
    assert.equal(wire.anthropic?.effort, undefined,
      'proxies may not accept effort — it must not reach the wire');
    assert.equal(wire.effortDroppedForProxy, true,
      'the drop must raise RUNTIME_EFFORT_IGNORED via effortDroppedForProxy');
    assert.equal(wire.effortDroppedForProxyRequested, 'xhigh');
  });

  it('Opus 5 Auto + thinking off is a compatibility default, not a user-picked High', () => {
    const sanitized = sanitizeClaudeModelOptions({
      model: 'claude-opus-5',
      thinking: { type: 'disabled' },
    });
    assert.equal(sanitized.effort, 'high');
    assert.deepEqual(sanitized.effortProvenance, {
      source: 'compatibility-default',
      reason: 'thinking-disabled-cap',
    });

    const wire = buildAnthropicProviderOptions({
      isThirdPartyProxy: true,
      model: 'claude-opus-5',
      sanitized,
    });
    assert.equal(wire.anthropic?.effort, undefined);
    assert.equal(wire.effortDroppedForProxy, false,
      'a system compatibility default must not produce "your High choice was ignored"');
    assert.equal(wire.effortDroppedForProxyRequested, undefined);
  });

  it('an adjusted explicit tier preserves the user\'s original choice in the proxy notice', () => {
    const sanitized = sanitizeClaudeModelOptions({
      model: 'claude-opus-5',
      thinking: { type: 'disabled' },
      effort: 'xhigh',
    });
    assert.equal(sanitized.effort, 'high');
    assert.deepEqual(sanitized.effortProvenance, {
      source: 'explicit',
      requested: 'xhigh',
    });

    const wire = buildAnthropicProviderOptions({
      isThirdPartyProxy: true,
      model: 'claude-opus-5',
      sanitized,
    });
    assert.equal(wire.effortDroppedForProxy, true);
    assert.equal(wire.effortDroppedForProxyRequested, 'xhigh',
      'the notice must name the user input, not the sanitizer\'s intermediate High');
  });

  it('a proxy with no effort selected raises no drop signal', () => {
    const wire = wireFor({ model: 'claude-sonnet-5', isThirdPartyProxy: true });
    assert.equal(wire.effortDroppedForProxy, false,
      'nothing to drop → no misleading toast');
    // no thinking / effort / beta assembled → undefined providerOptions.anthropic
    assert.equal(wire.anthropic, undefined);
  });

  it('proxy passes explicit (non-adaptive) thinking but never effort', () => {
    const wire = wireFor({
      model: 'claude-sonnet-4-6', effort: 'high',
      thinking: { type: 'enabled', budgetTokens: 4000 }, isThirdPartyProxy: true,
    });
    // sonnet-4-6 is non-adaptive: manual thinking stays as enabled and a proxy
    // forwards it. Effort is dropped even though 4.6 IS effort-capable on the
    // official API — the proxy axis is about the endpoint, not the model.
    assert.deepEqual(wire.anthropic?.thinking, { type: 'enabled', budgetTokens: 4000 });
    assert.equal(wire.anthropic?.effort, undefined);
    assert.equal(wire.effortDroppedForProxy, true);
  });
});
