/**
 * extract-token-usage-context-window.test.ts — contract for the wiring
 * between `SDKResultMessage.modelUsage` and `TokenUsage.context_window`
 * inside `claude-client.ts`.
 *
 * The behavioral piece — picking the right modelUsage entry — has its
 * own test (`sdk-model-usage.test.ts`) since `pickModelUsage` lives in
 * `sdk-model-usage.ts` (extracted so unit tests don't need to import
 * claude-client's full dependency graph). What this file locks in is
 * that `claude-client.ts` actually USES that helper and writes the
 * three new fields onto TokenUsage:
 *
 *   - context_window
 *   - max_output_tokens
 *   - usage_model_id
 *
 * Without this contract a future "trim unused TokenUsage fields"
 * refactor could quietly drop the SDK window plumbing. The window is
 * persisted only for a first-party Anthropic endpoint (#632 — third-party
 * proxies like GLM / Bailian / MiniMax / Kimi / Volcengine intentionally fall
 * back to "capacity unknown"); max_output_tokens / usage_model_id flow
 * regardless.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.join(__dirname, '..', '..');
const src = fs.readFileSync(
  path.join(repoRoot, 'lib/claude-client.ts'),
  'utf8',
);

describe('extractTokenUsage — SDK contextWindow wiring', () => {
  it('imports pickModelUsage from sdk-model-usage', () => {
    assert.match(
      src,
      /import\s*\{\s*pickModelUsage\s*\}\s*from\s*['\"]\.\/sdk-model-usage['\"]/,
      'claude-client must import pickModelUsage from the helper module so the picking logic stays unit-testable',
    );
  });

  it('reads msg.modelUsage in the result-handler path', () => {
    assert.match(
      src,
      /modelUsage\s*\?:\s*Record<string,\s*SdkModelUsage>/,
      'extractTokenUsage must type-cast msg.modelUsage as Record<string, SdkModelUsage> so the picker can run on real result messages',
    );
  });

  it('writes context_window / max_output_tokens / usage_model_id onto TokenUsage', () => {
    // Three independent assertions — each field is a separate contract.
    // Inline so a typo in one doesn't silently swallow another.
    assert.match(
      src,
      /context_window\s*=\s*usage\.contextWindow/,
      'extractTokenUsage must surface ModelUsage.contextWindow as TokenUsage.context_window',
    );
    assert.match(
      src,
      /max_output_tokens\s*=\s*usage\.maxOutputTokens/,
      'extractTokenUsage must surface ModelUsage.maxOutputTokens as TokenUsage.max_output_tokens',
    );
    assert.match(
      src,
      /usage_model_id\s*=\s*key/,
      'extractTokenUsage must record which modelUsage key it picked (usage_model_id) so debugging multi-model proxy responses is possible',
    );
  });

  it('only fills context_window when the SDK window is positive — zero / missing still falls back to catalog later', () => {
    // useContextUsage prefers token_usage.context_window when
    // typeof === 'number' && > 0. Writing 0 (instead of leaving it
    // undefined) would defeat the catalog fallback for models the SDK
    // didn't populate. Match the source guard.
    assert.match(
      src,
      /usage\.contextWindow\s*>\s*0/,
      'extractTokenUsage must guard `if (usage.contextWindow > 0)` before writing context_window — zero from a partial adapter must not override the catalog window',
    );
  });

  it('forwards model hints (requested + upstream) at every extractTokenUsage call site', () => {
    // Both call sites in streamClaudeSdk must pass `requested: model`
    // and `upstream: resolved.upstreamModel`. We count call sites by
    // excluding the function declaration line so a future rename of
    // the function doesn't false-fail this. Without forwarded hints,
    // third-party-proxy modelUsage maps fall through to single-entry /
    // first-with-window paths, which is fine, but matching by key is
    // faster and more robust.
    const allOccurrences = src.match(/extractTokenUsage\(/g) || [];
    // Subtract the one declaration line `function extractTokenUsage(`.
    const declCount = (src.match(/function\s+extractTokenUsage\(/g) || []).length;
    const calls = allOccurrences.length - declCount;
    assert.equal(calls, 2, `expected exactly 2 extractTokenUsage() call sites in claude-client.ts (start + retry result handlers); found ${calls}`);
    const withHints = src.match(/extractTokenUsage\([^)]*,\s*\{\s*[\s\S]*?requested:\s*model[\s\S]*?upstream:\s*resolved\.upstreamModel[\s\S]*?\}/g) || [];
    assert.equal(
      withHints.length,
      2,
      'every extractTokenUsage call must forward { requested: model, upstream: resolved.upstreamModel } so pickModelUsage has the hints it needs',
    );
  });

  // #632: the SDK's modelUsage.contextWindow is the SDK's bundled-catalog
  // value, reliable only for first-party Anthropic. These pins keep the
  // first-party gate from being silently dropped (which resurfaced GLM "200K").
  it('gates the context_window write on trustContextWindow (first-party only)', () => {
    assert.match(
      src,
      /trustWindow\s*=\s*modelHints\.trustContextWindow\s*!==\s*false/,
      'extractTokenUsage must derive a trustWindow flag from modelHints.trustContextWindow',
    );
    assert.match(
      src,
      /if\s*\(\s*trustWindow\s*&&\s*usage\.contextWindow\s*>\s*0\s*\)\s*base\.context_window/,
      'context_window must only be written when trustWindow is true — a third-party SDK default must not be persisted',
    );
  });

  it('imports the effective-base-URL resolver and the first-party endpoint helper', () => {
    assert.match(
      src,
      /import\s*\{[^}]*\bisFirstPartyAnthropicEndpoint\b[^}]*\}\s*from\s*['"]\.\/ai-provider['"]/,
      'claude-client must import the first-party endpoint helper',
    );
    assert.match(
      src,
      /import\s*\{[^}]*\bresolveEffectiveAnthropicBaseUrl\b[^}]*\}\s*from\s*['"]\.\/provider-resolver['"]/,
      'claude-client must import resolveEffectiveAnthropicBaseUrl so the trust gate keys on the EFFECTIVE SDK base URL, not just the provider row',
    );
  });

  // #632 P1: env / legacy / cc-switch sessions have resolved.provider === undefined
  // but can STILL route through a third-party proxy via settings.anthropic_base_url
  // or process.env.ANTHROPIC_BASE_URL. The original fix gated on
  // resolved.provider?.base_url alone, and isFirstPartyAnthropicEndpoint(undefined)
  // === true — so those third-party windows were re-trusted (GLM "200K" returns).
  // The flag must derive from resolveEffectiveAnthropicBaseUrl(resolved), which
  // mirrors toClaudeCodeEnv's precedence (provider → settings → process.env).
  it('derives the trust flag once from the EFFECTIVE base URL (covers env / legacy ANTHROPIC_BASE_URL)', () => {
    assert.match(
      src,
      /const\s+trustSdkContextWindow\s*=\s*isFirstPartyAnthropicEndpoint\(\s*resolveEffectiveAnthropicBaseUrl\(resolved\)\s*,?\s*\)/,
      'trustSdkContextWindow must be isFirstPartyAnthropicEndpoint(resolveEffectiveAnthropicBaseUrl(resolved))',
    );
  });

  it('does NOT gate trust on the provider row alone (regression guard for the env/legacy hole)', () => {
    assert.doesNotMatch(
      src,
      /trustContextWindow:\s*isFirstPartyAnthropicEndpoint\(resolved\.provider\?\.base_url\)/,
      'the provider-row-only gate re-trusts third-party env/legacy ANTHROPIC_BASE_URL windows (#632 P1) — must use the precomputed effective-URL flag',
    );
  });

  it('both call sites pass the single precomputed trustSdkContextWindow flag', () => {
    const trustCalls = src.match(/trustContextWindow:\s*trustSdkContextWindow\b/g) || [];
    assert.equal(
      trustCalls.length,
      2,
      'both extractTokenUsage call sites must forward the precomputed trustSdkContextWindow flag',
    );
  });
});
