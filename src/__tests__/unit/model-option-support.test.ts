import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildComposerModelCapabilityDescriptor,
  isContext1mBetaModelId,
  normalizeContext1mSelection,
} from '@/lib/model-option-support';
import { sanitizeClaudeModelOptions } from '@/lib/claude-model-options';

describe('composer model capability descriptor', () => {
  it('derives selectable effort only from sourced levels', () => {
    const descriptor = buildComposerModelCapabilityDescriptor({
      runtime: 'claude_code',
      protocol: 'anthropic',
      modelIds: ['opus'],
      supportsEffort: true,
      supportedEffortLevels: ['low', 'high'],
      contextWindow: 200_000,
    });
    assert.equal(descriptor.effort.state, 'selectable');
    assert.deepEqual(descriptor.effort.values, ['low', 'high']);
    assert.equal(descriptor.effort.source, 'providers/models.supportedEffortLevels');
  });

  it('keeps absent capabilities unknown instead of guessing controls', () => {
    const descriptor = buildComposerModelCapabilityDescriptor({
      modelIds: ['unknown-model'],
    });
    assert.equal(descriptor.effort.state, 'unknown');
    assert.equal(descriptor.context1m.state, 'unknown');
  });

  it('marks a sourced default 1M window fixed, never selectable', () => {
    const descriptor = buildComposerModelCapabilityDescriptor({
      runtime: 'claude_code',
      protocol: 'anthropic',
      modelIds: ['claude-opus-5'],
      contextWindow: 1_000_000,
    });
    assert.deepEqual(descriptor.context1m, {
      state: 'fixed',
      runtime: 'claude_code',
      protocol: 'anthropic',
      modelIds: ['claude-opus-5'],
      fixedValue: true,
      source: 'providers/models.contextWindow',
    });
  });

  it('offers the existing provider option only for an explicit compatible 4.6 route', () => {
    assert.equal(buildComposerModelCapabilityDescriptor({
      runtime: 'codepilot_runtime',
      protocol: 'anthropic',
      modelIds: ['claude-opus-4-6'],
      contextWindow: 200_000,
    }).context1m.state, 'selectable');
    assert.equal(buildComposerModelCapabilityDescriptor({
      runtime: 'codex_runtime',
      protocol: 'openai-compatible',
      modelIds: ['gpt'],
      contextWindow: 200_000,
    }).context1m.state, 'unsupported');
  });

  it('does not invent a 1M switch for other Anthropic 200K models or ambiguous aliases', () => {
    for (const modelIds of [
      ['claude-haiku-4-5-20251001'],
      ['sonnet'],
      ['opus'],
    ]) {
      const descriptor = buildComposerModelCapabilityDescriptor({
        runtime: 'claude_code',
        protocol: 'anthropic',
        modelIds,
        contextWindow: 200_000,
      });
      assert.equal(descriptor.context1m.state, 'unsupported');
    }
  });

  it('uses the same fail-closed upstream-ID rule in descriptor and outbound sanitizer', () => {
    assert.equal(isContext1mBetaModelId('claude-sonnet-4-6'), true);
    assert.equal(isContext1mBetaModelId('sonnet'), false);
    assert.equal(isContext1mBetaModelId('claude-sonnet-4-60'), false);
    assert.equal(isContext1mBetaModelId('claude-opus-4-6001'), false);

    for (const model of [
      'claude-haiku-4-5-20251001',
      'claude-sonnet-4-60',
      'sonnet',
      'opus',
    ]) {
      assert.equal(sanitizeClaudeModelOptions({
        model,
        context1m: true,
      }).applyContext1mBeta, false);
    }

    assert.equal(sanitizeClaudeModelOptions({
      model: 'claude-sonnet-4-6',
      context1m: true,
    }).applyContext1mBeta, true);
  });

  it('removes a stale requested beta flag for fixed, unsupported and unknown routes', () => {
    for (const state of ['fixed', 'unsupported', 'unknown'] as const) {
      const normalized = normalizeContext1mSelection({
        state,
        runtime: 'test',
        protocol: 'test',
        modelIds: ['m'],
        source: state,
        ...(state === 'fixed' ? { fixedValue: true } : {}),
      }, true);
      assert.equal(normalized.requested, true);
      assert.equal(normalized.effective, false);
      assert.equal(normalized.adjusted, true);
    }
  });
});
