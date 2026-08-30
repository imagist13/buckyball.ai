import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isRecommendedModel, __test } from '../../lib/catalog-recommend';
import type { VendorPreset } from '../../lib/provider-catalog';
import type { ProviderRuntimeCompat } from '../../types';

const minimalPreset = (defaultModels: { modelId: string }[]): VendorPreset => ({
  key: 'test',
  category: 'chat',
  brand: 'test',
  protocol: 'anthropic',
  baseUrl: '',
  authStyle: 'api_key',
  defaultEnvOverrides: {},
  defaultModels: defaultModels.map(m => ({
    modelId: m.modelId,
    upstreamModelId: m.modelId,
    displayName: m.modelId,
  })),
} as unknown as VendorPreset);

describe('catalog-recommend / isRecommendedModel', () => {
  describe('blacklist', () => {
    // The blacklist should win regardless of catalog whitelist or anthropic
    // tier — these models don't belong in the chat picker even when the
    // catalog incorrectly lists them, and even when the provider is a
    // first-party Anthropic-tier connection.
    const blacklisted = [
      'text-embedding-3-large',
      'whisper-1',
      'tts-1',
      'gpt-image-1',
      'imagen-3',
      'nano-banana-pro',
      'voyage-rerank-2',
      'gpt-4o-preview',
      'claude-sonnet-4-deprecated',
      'sonnet-test-channel',
      'gemini-2.0-pro-experimental',
      'free-gpt',
      'sandbox-test',
    ];
    for (const id of blacklisted) {
      it(`rejects '${id}' even when in catalog and anthropic-tier`, () => {
        // Whitelist contains the id and tier is claude_code_ready — the
        // blacklist is the only thing standing between this and `true`.
        const preset = minimalPreset([{ modelId: id }]);
        assert.equal(isRecommendedModel(id, preset, 'claude_code_ready'), false);
      });
    }

    it('rejects beta even though it sounds like a stable channel name', () => {
      assert.equal(isRecommendedModel('llama-beta', undefined, 'claude_code_ready'), false);
    });
  });

  describe('catalog whitelist', () => {
    it('returns true when modelId matches a defaultModels entry', () => {
      const preset = minimalPreset([{ modelId: 'sonnet' }, { modelId: 'opus' }]);
      assert.equal(isRecommendedModel('sonnet', preset, 'claude_code_ready'), true);
      assert.equal(isRecommendedModel('opus', preset, 'claude_code_ready'), true);
    });

    it('matches case-insensitively (preset has lowercased ids by convention)', () => {
      const preset = minimalPreset([{ modelId: 'sonnet' }]);
      assert.equal(isRecommendedModel('SONNET', preset, 'claude_code_ready'), true);
    });

    it('returns false for ids not in catalog (unknown tier, no Claude-alias bonus)', () => {
      const preset = minimalPreset([{ modelId: 'sonnet' }]);
      assert.equal(isRecommendedModel('gpt-4o', preset, 'unknown'), false);
    });
  });

  describe('Claude alias fallback (anthropic-tier providers)', () => {
    // A relay (anthropic-thirdparty) might surface `claude-3-opus` even
    // when the curated catalog only lists `sonnet/opus/haiku`. The alias
    // fallback exists so those auto-enable on those tiers without the
    // catalog needing a per-relay defaults entry.
    const tiers: ProviderRuntimeCompat[] = ['claude_code_ready', 'claude_code_verified', 'claude_code_experimental'];
    for (const tier of tiers) {
      it(`enables short claude alias 'sonnet' on tier '${tier}'`, () => {
        assert.equal(isRecommendedModel('sonnet', undefined, tier), true);
      });
      it(`enables 'claude-3-opus' on tier '${tier}' via prefix match`, () => {
        assert.equal(isRecommendedModel('claude-3-opus', undefined, tier), true);
      });
    }

    it('also enables alias for codepilot_only tier (OpenAI-compat relays)', () => {
      // OpenRouter exposes anthropic/claude-3-opus through OpenAI-compat
      // wire format → tier becomes codepilot_only but the user still
      // expects "Claude Opus" to surface as recommended.
      assert.equal(isRecommendedModel('anthropic/claude-3-opus', undefined, 'codepilot_only'), true);
    });

    it('does NOT enable alias on unknown tier', () => {
      // `unknown` means we couldn't classify the provider — refuse to
      // auto-enable a Claude-shaped id without positive evidence that
      // this is actually a Claude relay.
      assert.equal(isRecommendedModel('sonnet', undefined, 'unknown'), false);
    });

    it('does NOT enable alias on media_only tier', () => {
      // Media providers shouldn't surface chat-shaped models even by accident.
      assert.equal(isRecommendedModel('sonnet', undefined, 'media_only'), false);
    });
  });

  describe('default falls through to false', () => {
    it('returns false for unknown id with no preset and no anthropic tier', () => {
      assert.equal(isRecommendedModel('mystery-model', undefined, 'unknown'), false);
    });

    it('returns false for empty modelId', () => {
      assert.equal(isRecommendedModel('', undefined, 'claude_code_ready'), false);
    });
  });

  describe('exposed alias helpers', () => {
    it('looksLikeClaudeAlias accepts short aliases, claude- prefix, /claude- relay path', () => {
      assert.equal(__test.looksLikeClaudeAlias('sonnet'), true);
      assert.equal(__test.looksLikeClaudeAlias('opus'), true);
      assert.equal(__test.looksLikeClaudeAlias('haiku'), true);
      assert.equal(__test.looksLikeClaudeAlias('claude-3-opus'), true);
      assert.equal(__test.looksLikeClaudeAlias('anthropic/claude-3-opus'), true);
      assert.equal(__test.looksLikeClaudeAlias('gpt-4o'), false);
      assert.equal(__test.looksLikeClaudeAlias('llama-3'), false);
    });
  });
});
