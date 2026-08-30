import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  anthropicApiSupportsEffort,
  isOpus5Model,
  isOpusAdaptiveThinkingModel,
  sanitizeClaudeModelOptions,
} from '../../lib/claude-model-options';
import { buildAnthropicProviderOptions } from '../../lib/agent-loop-anthropic-wire';
import { buildEffortAdjustmentNotice } from '../../lib/anthropic-effort-adjustment-notice';
import { getContextWindow } from '../../lib/model-context';
import { ENV_CLAUDE_CODE_MODELS, VENDOR_PRESETS } from '../../lib/provider-catalog';
import { listClaudeSubagentRoutes } from '../../lib/claude-subagent-mcp';

describe('Claude Opus 5 — catalog and Claude Code route', () => {
  const model = ENV_CLAUDE_CODE_MODELS.find(entry => entry.modelId === 'opus-5');

  it('ships an explicit first-party/env option without repinning the opus role', () => {
    assert.ok(model);
    assert.equal(model.upstreamModelId, 'claude-opus-5');
    assert.equal(model.displayName, 'Opus 5');
    assert.deepEqual(model.capabilities?.supportedEffortLevels, [
      'low', 'medium', 'high', 'xhigh', 'max',
    ]);

    const official = VENDOR_PRESETS.find(preset => preset.key === 'anthropic-official');
    const role = official?.defaultModels.find(entry => entry.modelId === 'opus');
    assert.equal(role?.upstreamModelId, 'claude-opus-4-7',
      'existing opus sessions must not silently migrate to Opus 5');
  });

  it('does not invent an unverified OpenRouter Opus 5 slug', () => {
    const openrouter = VENDOR_PRESETS.find(preset => preset.key === 'openrouter');
    assert.equal(openrouter?.defaultModels.some(entry => entry.modelId === 'opus-5'), false);
  });

  it('resolves the documented 1M context window', () => {
    assert.equal(getContextWindow('claude-opus-5'), 1_000_000);
    assert.equal(getContextWindow('opus-5', { upstream: 'claude-opus-5' }), 1_000_000);
  });

  it('exposes the same explicit model to Claude Code managed Sub-agents', () => {
    const route = listClaudeSubagentRoutes().find(entry =>
      entry.providerId === 'env' && entry.modelId === 'opus-5');
    assert.ok(route);
    assert.equal(route.upstreamModelId, 'claude-opus-5');
    assert.equal(route.displayName, 'Opus 5');
  });
});

describe('Claude Opus 5 — adaptive thinking and effort contract', () => {
  it('matches exact, short, and tagged IDs without claiming Opus 50', () => {
    for (const id of ['claude-opus-5', 'opus-5', 'claude-opus-5[1m]']) {
      assert.equal(isOpus5Model(id), true);
      assert.equal(isOpusAdaptiveThinkingModel(id), true);
      assert.equal(anthropicApiSupportsEffort(id), true);
    }
    assert.equal(isOpus5Model('claude-opus-50'), false);
    assert.equal(isOpusAdaptiveThinkingModel('claude-opus-50'), false);
    assert.equal(anthropicApiSupportsEffort('claude-opus-50'), false);
  });

  it('converts manual extended thinking to adaptive summarized', () => {
    const out = sanitizeClaudeModelOptions({
      model: 'claude-opus-5',
      thinking: { type: 'enabled', budgetTokens: 32_000 },
      effort: 'xhigh',
      context1m: true,
    });
    assert.deepEqual(out.thinking, { type: 'adaptive', display: 'summarized' });
    assert.equal(out.effort, 'xhigh');
    assert.equal(out.applyContext1mBeta, false);
    assert.equal(out.effortAdjustedForThinking, undefined);
  });

  it('keeps disabled thinking with low/medium/high effort unchanged', () => {
    for (const effort of ['low', 'medium', 'high'] as const) {
      const out = sanitizeClaudeModelOptions({
        model: 'claude-opus-5',
        thinking: { type: 'disabled' },
        effort,
      });
      assert.deepEqual(out.thinking, { type: 'disabled' });
      assert.equal(out.effort, effort);
      assert.equal(out.effortAdjustedForThinking, undefined);
    }
  });

  it('pins Auto to high when thinking is disabled instead of trusting a mutable CLI default', () => {
    const sanitized = sanitizeClaudeModelOptions({
      model: 'claude-opus-5',
      thinking: { type: 'disabled' },
    });
    assert.deepEqual(sanitized.thinking, { type: 'disabled' });
    assert.equal(sanitized.effort, 'high');
    assert.deepEqual(sanitized.effortProvenance, {
      source: 'compatibility-default',
      reason: 'thinking-disabled-cap',
    });
    assert.equal(sanitized.effortAdjustedForThinking, undefined,
      'Auto did not request a conflicting tier, so this compatibility pin is not an adjustment warning');

    const wire = buildAnthropicProviderOptions({
      isThirdPartyProxy: false,
      model: 'claude-opus-5',
      sanitized,
    });
    assert.deepEqual(wire.anthropic, {
      thinking: { type: 'disabled' },
      effort: 'high',
    });
  });

  for (const requested of ['xhigh', 'max'] as const) {
    it(`keeps thinking off and lowers ${requested} to high instead of sending a 400 shape`, () => {
      const sanitized = sanitizeClaudeModelOptions({
        model: 'claude-opus-5',
        thinking: { type: 'disabled' },
        effort: requested,
      });
      assert.deepEqual(sanitized.thinking, { type: 'disabled' });
      assert.equal(sanitized.effort, 'high');
      assert.deepEqual(sanitized.effortProvenance, {
        source: 'explicit',
        requested,
      });
      assert.deepEqual(sanitized.effortAdjustedForThinking, {
        requested,
        effective: 'high',
      });

      const wire = buildAnthropicProviderOptions({
        isThirdPartyProxy: false,
        model: 'claude-opus-5',
        sanitized,
      });
      assert.deepEqual(wire.anthropic, {
        thinking: { type: 'disabled' },
        effort: 'high',
      });

      assert.deepEqual(buildEffortAdjustmentNotice({
        model: 'claude-opus-5',
        sanitized,
      }), {
        code: 'RUNTIME_EFFORT_ADJUSTED',
        reason: 'thinking-disabled-cap',
        params: {
          model: 'claude-opus-5',
          requested,
          effective: 'high',
        },
      });
    });
  }

  it('strips non-default sampling like the rest of the adaptive family', () => {
    const out = sanitizeClaudeModelOptions({
      model: 'claude-opus-5',
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
    });
    assert.deepEqual(out.sampling, {});
    assert.deepEqual(out.strippedSamplingParams, ['temperature', 'topP', 'topK']);
  });
});

describe('Claude Opus 5 — Runtime notice wiring', () => {
  const read = (relative: string) => readFileSync(join(process.cwd(), 'src', relative), 'utf8');

  it('both production Runtime paths consume the shared adjustment fact', () => {
    for (const relative of ['lib/agent-loop.ts', 'lib/claude-client.ts']) {
      const source = read(relative);
      assert.match(source, /buildEffortAdjustmentNotice/);
      assert.match(source, /effortAdjustmentNotice/);
    }
  });

  it('the Codex proxy passes the resolved Anthropic model through the shared contract', () => {
    const proxy = read('lib/codex/proxy/unified-adapter.ts');
    assert.match(proxy, /modelConfig\.sdkType === 'anthropic'/);
    assert.match(proxy, /model:\s*modelConfig\.modelId/);
    assert.match(proxy, /sanitizeClaudeModelOptions/);
    assert.match(proxy, /buildAnthropicProviderOptions/);
  });

  it('the adjustment notice is persistent and localized', () => {
    const stream = read('hooks/useSSEStream.ts');
    const i18n = read('lib/status-notice-i18n.ts');
    assert.match(stream, /'RUNTIME_EFFORT_ADJUSTED'/);
    assert.match(i18n, /RUNTIME_EFFORT_ADJUSTED:thinking-disabled-cap/);
  });

  it('does not misname a future model when a caller omits the model label', () => {
    const sanitized = sanitizeClaudeModelOptions({
      model: 'claude-opus-5',
      thinking: { type: 'disabled' },
      effort: 'max',
    });
    assert.equal(
      buildEffortAdjustmentNotice({ model: undefined, sanitized })?.params.model,
      'unknown',
    );
  });
});
