/**
 * Phase 0.5 Slice B — `getModelCompat` populates `supportedRuntimes`
 * for every provider compat tier.
 *
 * Pins the migration from the two legacy `*_compatible` booleans to
 * the canonical `supportedRuntimes[]` field. Once readers (API route
 * filter, Slice E adapters) consume `supportedRuntimes` exclusively,
 * the legacy booleans become read-only back-compat input.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getModelCompat } from '@/lib/runtime-compat';
import type { ProviderRuntimeCompat } from '@/types';

function compatFor(tier: ProviderRuntimeCompat) {
  return getModelCompat({
    modelId: 'sample',
    providerCompat: tier,
  });
}

describe('getModelCompat → supportedRuntimes', () => {
  it('claude_code_ready exposes all three runtimes (Phase 5b proxy adapter ready)', () => {
    // Phase 5b (2026-05-15) — Codex Runtime reach lit up after the
    // unified provider-proxy translator landed. claude_code_ready
    // (Anthropic-shape wire) routes through the proxy's Anthropic-
    // compat path, so codex_runtime joins the supported set and the
    // proxy-pending reason is gone.
    const cap = compatFor('claude_code_ready');
    assert.deepEqual([...(cap.supportedRuntimes ?? [])].sort(), [
      'claude_code',
      'codepilot_runtime',
      'codex_runtime',
    ]);
    assert.equal(cap.unsupportedReasonByRuntime?.codex_runtime, undefined);
  });

  it('claude_code_verified exposes all three runtimes', () => {
    const cap = compatFor('claude_code_verified');
    assert.deepEqual([...(cap.supportedRuntimes ?? [])].sort(), [
      'claude_code',
      'codepilot_runtime',
      'codex_runtime',
    ]);
  });

  it('claude_code_experimental exposes all three runtimes', () => {
    const cap = compatFor('claude_code_experimental');
    assert.deepEqual([...(cap.supportedRuntimes ?? [])].sort(), [
      'claude_code',
      'codepilot_runtime',
      'codex_runtime',
    ]);
  });

  it('openrouter_anthropic_skin reaches Claude Code + Codex Runtime; CodePilot Runtime stays gated on /v1 skin', () => {
    const cap = compatFor('openrouter_anthropic_skin');
    assert.deepEqual([...(cap.supportedRuntimes ?? [])].sort(), [
      'claude_code',
      'codex_runtime',
    ]);
    assert.ok(cap.unsupportedReasonByRuntime?.codepilot_runtime);
    assert.match(
      cap.unsupportedReasonByRuntime!.codepilot_runtime!,
      /OpenRouter|skin|\/v1/,
    );
  });

  it('codepilot_only reaches CodePilot Runtime + Codex Runtime; Claude Code stays gated on Anthropic wire', () => {
    const cap = compatFor('codepilot_only');
    assert.deepEqual([...(cap.supportedRuntimes ?? [])].sort(), [
      'codepilot_runtime',
      'codex_runtime',
    ]);
    assert.ok(cap.unsupportedReasonByRuntime?.claude_code);
    assert.match(
      cap.unsupportedReasonByRuntime!.claude_code!,
      /OpenAI|compatible|Claude Code/,
    );
  });

  it('unknown defaults to both legacy runtimes visible; codex_runtime stays gated (wire format unknown)', () => {
    const cap = compatFor('unknown');
    assert.deepEqual([...(cap.supportedRuntimes ?? [])].sort(), [
      'claude_code',
      'codepilot_runtime',
    ]);
    assert.match(
      cap.unsupportedReasonByRuntime?.codex_runtime ?? '',
      /Codex provider proxy/,
    );
  });

  it('media_only short-circuits — no supportedRuntimes set', () => {
    const cap = compatFor('media_only');
    assert.equal(cap.media, true);
    assert.equal(cap.supportedRuntimes, undefined);
  });

  it('codex_account exposes ONLY codex_runtime + carries reasons for the others', () => {
    // Phase 5 Phase 2 (2026-05-13) — Codex account models flow only
    // through Codex Runtime; legacy compat booleans stay unset.
    const cap = compatFor('codex_account');
    assert.deepEqual(cap.supportedRuntimes, ['codex_runtime']);
    assert.equal(cap.claude_code_compatible, undefined);
    assert.equal(cap.codepilot_runtime_compatible, undefined);
    assert.ok(cap.unsupportedReasonByRuntime?.claude_code);
    assert.ok(cap.unsupportedReasonByRuntime?.codepilot_runtime);
    assert.match(cap.unsupportedReasonByRuntime!.claude_code!, /Codex/);
  });

  it('legacy booleans still mirror supportedRuntimes (back-compat input)', () => {
    const cap = compatFor('claude_code_verified');
    assert.equal(cap.claude_code_compatible, true);
    assert.equal(cap.codepilot_runtime_compatible, true);
  });
});
