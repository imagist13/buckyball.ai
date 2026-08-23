/**
 * GLM-5.3 CodePlan adaptation contract.
 *
 * The vendor exposes the same flagship under different wire IDs:
 * Claude/Anthropic uses `glm-5.3[1m]`, while Codex/Responses uses
 * `glm-5.3`. These tests drive the production resolver and Responses factory
 * so the picker label, selected transport, effort mapping and outbound body
 * cannot drift independently.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateText } from 'ai';
import {
  getPreset,
  getVerifiedProviderWireCapabilities,
  PresetSchema,
} from '../../lib/provider-catalog';
import {
  toAiSdkConfig,
  toClaudeCodeEnv,
  getResolvedModelEffortContract,
  type ResolvedProvider,
} from '../../lib/provider-resolver';
import { createApiKeyResponsesLanguageModel } from '../../lib/ai-provider';
import { sanitizeClaudeModelOptions } from '../../lib/claude-model-options';
import { buildAnthropicProviderOptions } from '../../lib/agent-loop-anthropic-wire';
import { buildBody } from '../../lib/claude-code-compat/request-builder';
import { buildProviderOptions } from '../../lib/codex/proxy/unified-adapter';
import { resolveCodexProviderEffort } from '../../lib/codex/effort';

const CN_ANTHROPIC_BASE = 'https://open.bigmodel.cn/api/anthropic';
const CN_RESPONSES_BASE = 'https://open.bigmodel.cn/api/v1';
const GLOBAL_ANTHROPIC_BASE = 'https://api.z.ai/api/anthropic';
const GLOBAL_RESPONSES_BASE = 'https://api.z.ai/api/v1';
const FLAGSHIP = 'glm-5.3[1m]';
const RESPONSES_FLAGSHIP = 'glm-5.3';
const FAKE_KEY = 'glm-codeplan-test-key-not-real';

function resolvedGlm(
  presetKey: 'glm-cn' | 'glm-global' = 'glm-cn',
  modelId = 'sonnet',
): ResolvedProvider {
  const preset = getPreset(presetKey);
  assert.ok(preset);
  const model = preset.defaultModels.find(candidate => candidate.modelId === modelId);
  assert.ok(model);
  return {
    provider: {
      id: `${presetKey}-test-provider`,
      preset_key: presetKey,
      provider_type: 'anthropic',
      protocol: 'anthropic',
      base_url: preset.baseUrl,
      api_key: FAKE_KEY,
    } as ResolvedProvider['provider'],
    protocol: 'anthropic',
    authStyle: 'auth_token',
    model: modelId,
    upstreamModel: model.upstreamModelId ?? model.modelId,
    modelDisplayName: model.displayName,
    headers: {},
    envOverrides: preset.defaultEnvOverrides,
    roleModels: preset.defaultRoleModels ?? {},
    hasCredentials: true,
    availableModels: preset.defaultModels,
    settingSources: ['user'],
  };
}

function completedResponsesPayload(): Record<string, unknown> {
  return {
    id: 'resp_glm_fixture',
    object: 'response',
    created_at: 1,
    status: 'completed',
    error: null,
    incomplete_details: null,
    model: RESPONSES_FLAGSHIP,
    output: [{
      type: 'message',
      id: 'msg_glm_fixture',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'ok', annotations: [] }],
    }],
    usage: {
      input_tokens: 1,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 1,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 2,
    },
  };
}

describe('GLM-5.3 CodePlan catalog', () => {
  it('publishes the official current lineup and no stale 5.2/4.5 entries', () => {
    for (const key of ['glm-cn', 'glm-global'] as const) {
      const preset = getPreset(key);
      assert.ok(preset);
      PresetSchema.parse(preset);
      assert.deepEqual(
        preset.defaultModels.map(model => [model.modelId, model.upstreamModelId, model.displayName]),
        [
          ['sonnet', FLAGSHIP, 'GLM-5.3'],
          ['glm-5-turbo', 'glm-5-turbo', 'GLM-5-Turbo'],
          ['haiku', 'glm-4.7', 'GLM-4.7'],
        ],
      );
      assert.ok(!preset.defaultModels.some(model => /GLM-5\.2|GLM-4\.5-Air/.test(model.displayName)));
      assert.deepEqual(preset.defaultRoleModels, {
        default: FLAGSHIP,
        sonnet: FLAGSHIP,
        opus: FLAGSHIP,
        haiku: 'glm-4.7',
      });
      assert.equal(preset.defaultEnvOverrides.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '1000000');
    }
  });

  it('exposes only the documented flagship effort levels and 1M text context', () => {
    const flagship = getPreset('glm-cn')?.defaultModels[0];
    assert.ok(flagship);
    assert.equal(flagship.capabilities?.reasoning, true);
    assert.equal(flagship.capabilities?.toolUse, true);
    assert.equal(flagship.capabilities?.vision, undefined, 'GLM-5.3 is text-only; Vision MCP is separate');
    assert.equal(flagship.capabilities?.contextWindow, 1_048_576);
    assert.deepEqual(flagship.capabilities?.supportedEffortLevels, ['low', 'high', 'max']);
    assert.equal(flagship.capabilities?.defaultEffortLevel, 'max');
    assert.equal(flagship.capabilities?.effortNoteKey, 'messageInput.effort.note.glmCodePlan');

    const turbo = getPreset('glm-cn')?.defaultModels.find(model => model.modelId === 'glm-5-turbo');
    assert.ok(turbo);
    assert.equal(turbo.capabilities?.contextWindow, 204_800);
    assert.equal(turbo.capabilities?.supportsEffort, undefined, 'Codex catalog declares no selectable Turbo effort tiers');
  });
});

describe('GLM-5.3 transport identity', () => {
  it('keeps exact first-party capability gates and per-region Responses endpoints', () => {
    const cn = getVerifiedProviderWireCapabilities({
      preset_key: 'glm-cn',
      provider_type: 'anthropic',
      protocol: 'anthropic',
      base_url: CN_ANTHROPIC_BASE,
    }, FLAGSHIP);
    assert.deepEqual(cn.anthropicEffortLevels, ['low', 'high', 'max']);
    assert.equal(cn.codexResponses?.baseUrl, CN_RESPONSES_BASE);
    assert.equal(cn.codexResponses?.modelId, RESPONSES_FLAGSHIP);
    assert.deepEqual(cn.codexResponses?.effortAliases, {
      minimal: 'low',
      medium: 'high',
      xhigh: 'max',
    });

    const global = getVerifiedProviderWireCapabilities({
      preset_key: 'glm-global',
      provider_type: 'anthropic',
      protocol: 'anthropic',
      base_url: GLOBAL_ANTHROPIC_BASE,
    }, 'sonnet');
    assert.equal(global.codexResponses?.baseUrl, GLOBAL_RESPONSES_BASE);
    assert.equal(global.codexResponses?.modelId, RESPONSES_FLAGSHIP);

    const aggregator = getVerifiedProviderWireCapabilities({
      preset_key: 'anthropic-thirdparty',
      provider_type: 'anthropic',
      protocol: 'anthropic',
      base_url: 'https://proxy.example/anthropic',
    }, FLAGSHIP);
    assert.deepEqual(aggregator, {});
  });

  it('uses [1m] on Claude and the bare model ID on native Codex Responses', () => {
    const cnResolved = resolvedGlm('glm-cn');
    const claude = toAiSdkConfig(cnResolved, 'sonnet', { runtime: 'claude_code' });
    assert.equal(claude.sdkType, 'claude-code-compat');
    assert.equal(claude.baseUrl, CN_ANTHROPIC_BASE);
    assert.equal(claude.modelId, FLAGSHIP);
    assert.deepEqual(claude.verifiedAnthropicEffortLevels, ['low', 'high', 'max']);

    const codex = toAiSdkConfig(cnResolved, 'sonnet', { runtime: 'codex_runtime' });
    assert.equal(codex.sdkType, 'openai');
    assert.equal(codex.baseUrl, CN_RESPONSES_BASE);
    assert.equal(codex.modelId, RESPONSES_FLAGSHIP);
    assert.equal(codex.useResponsesApi, true);
    assert.deepEqual(codex.verifiedResponsesEffortLevels, ['low', 'high', 'max']);
    assert.deepEqual(codex.verifiedResponsesEffortAliases, {
      minimal: 'low',
      medium: 'high',
      xhigh: 'max',
    });

    const globalCodex = toAiSdkConfig(resolvedGlm('glm-global'), 'sonnet', { runtime: 'codex_runtime' });
    assert.equal(globalCodex.baseUrl, GLOBAL_RESPONSES_BASE);
    assert.equal(globalCodex.modelId, RESPONSES_FLAGSHIP);
  });

  it('uses native Responses for Turbo but leaves GLM-4.7 on the Anthropic route', () => {
    const turbo = toAiSdkConfig(
      resolvedGlm('glm-cn', 'glm-5-turbo'),
      'glm-5-turbo',
      { runtime: 'codex_runtime' },
    );
    assert.equal(turbo.sdkType, 'openai');
    assert.equal(turbo.baseUrl, CN_RESPONSES_BASE);
    assert.equal(turbo.modelId, 'glm-5-turbo');
    assert.equal(turbo.verifiedResponsesEffortLevels, undefined);
    assert.equal(turbo.verifiedResponsesTransport, true);

    const small = toAiSdkConfig(resolvedGlm('glm-cn', 'haiku'), 'haiku', { runtime: 'codex_runtime' });
    assert.equal(small.sdkType, 'claude-code-compat');
    assert.equal(small.modelId, 'glm-4.7');
    assert.equal(small.useResponsesApi, undefined);
  });

  it('injects current Claude role mappings and the official 1M compact window', () => {
    const env = toClaudeCodeEnv({ CLAUDE_CODE_AUTO_COMPACT_WINDOW: 'stale' }, resolvedGlm('glm-cn'));
    assert.equal(env.ANTHROPIC_MODEL, FLAGSHIP);
    assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, FLAGSHIP);
    assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL, FLAGSHIP);
    assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'glm-4.7');
    assert.equal(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '1000000');
  });
});

describe('GLM-5.3 effort wire formats', () => {
  it('routes explicit Max and Auto through the provider catalog without a silent High downgrade', () => {
    const contract = getResolvedModelEffortContract(resolvedGlm('glm-cn'), 'sonnet');
    const appServerVocabulary = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    assert.deepEqual(contract, {
      supportedLevels: ['low', 'high', 'max'],
      defaultLevel: 'max',
    });
    assert.equal(resolveCodexProviderEffort('max', contract, appServerVocabulary), 'max');
    assert.equal(resolveCodexProviderEffort(undefined, contract, appServerVocabulary), 'max');
    assert.equal(
      resolveCodexProviderEffort(undefined, contract, undefined, 'codex-cli 0.144.2'),
      'max',
      'a current binary is sufficient evidence even when no Codex Account cache exists',
    );
    assert.throws(
      () => resolveCodexProviderEffort('max', contract, ['minimal', 'low', 'medium', 'high']),
      /has not advertised support for the "max" effort token/,
    );

    const turboContract = getResolvedModelEffortContract(
      resolvedGlm('glm-cn', 'glm-5-turbo'),
      'glm-5-turbo',
    );
    assert.equal(
      resolveCodexProviderEffort(undefined, turboContract, appServerVocabulary),
      undefined,
      'Turbo has no vendor effort allowlist, so its catalog default must not leak as an unsupported wire field',
    );
  });

  it('preserves Low/High/Max on Anthropic output_config and omits unsupported tiers', () => {
    for (const effort of ['low', 'high', 'max'] as const) {
      const sanitized = sanitizeClaudeModelOptions({ model: FLAGSHIP, effort });
      const verified = buildAnthropicProviderOptions({
        isThirdPartyProxy: true,
        model: FLAGSHIP,
        sanitized,
        verifiedEffortLevels: ['low', 'high', 'max'],
      });
      const body = buildBody({
        prompt: [],
        providerOptions: { anthropic: verified.anthropic },
      } as never, {
        authToken: FAKE_KEY,
        baseUrl: CN_ANTHROPIC_BASE,
        modelId: FLAGSHIP,
      });
      assert.deepEqual(body.output_config, { effort });
    }
  });

  it('maps Codex compatibility tokens to the documented Responses tiers', () => {
    const context = {
      responses: {
        verifiedEffortLevels: ['low', 'high', 'max'] as const,
        effortAliases: { minimal: 'low', medium: 'high', xhigh: 'max' } as const,
      },
    };
    for (const [requested, expected] of [
      ['minimal', 'low'],
      ['low', 'low'],
      ['medium', 'high'],
      ['high', 'high'],
      ['xhigh', 'max'],
      ['max', 'max'],
    ] as const) {
      const options = buildProviderOptions({
        model: RESPONSES_FLAGSHIP,
        input: [],
        reasoning: { effort: requested },
      }, context);
      assert.equal((options?.openai as Record<string, unknown>).reasoningEffort, expected);
    }
  });

  it('production Responses factory sends the bare model ID and max effort', async () => {
    const config = toAiSdkConfig(resolvedGlm('glm-cn'), 'sonnet', { runtime: 'codex_runtime' });
    let capturedUrl = '';
    let capturedAuth = '';
    let capturedBody: Record<string, unknown> = {};
    const captureFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      capturedAuth = new Headers(init?.headers).get('authorization') ?? '';
      capturedBody = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      return new Response(JSON.stringify(completedResponsesPayload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const model = createApiKeyResponsesLanguageModel(config, captureFetch);
    const providerOptions = buildProviderOptions({
      model: RESPONSES_FLAGSHIP,
      input: [],
      reasoning: { effort: 'max' },
    }, {
      responses: {
        verifiedEffortLevels: config.verifiedResponsesEffortLevels!,
        effortAliases: config.verifiedResponsesEffortAliases,
      },
    });
    const result = await generateText({
      model,
      prompt: 'synthetic GLM transport probe',
      providerOptions,
    });

    assert.equal(result.text, 'ok');
    assert.equal(capturedUrl, `${CN_RESPONSES_BASE}/responses`);
    assert.equal(capturedAuth, `Bearer ${FAKE_KEY}`);
    assert.equal(capturedBody.model, RESPONSES_FLAGSHIP);
    assert.deepEqual(capturedBody.reasoning, { effort: 'max', summary: 'detailed' });
  });

  it('Turbo keeps the verified Responses reasoning path but omits unsupported effort', async () => {
    const config = toAiSdkConfig(
      resolvedGlm('glm-cn', 'glm-5-turbo'),
      'glm-5-turbo',
      { runtime: 'codex_runtime' },
    );
    let capturedBody: Record<string, unknown> = {};
    const model = createApiKeyResponsesLanguageModel(config, (async (_input, init) => {
      capturedBody = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      return new Response(JSON.stringify(completedResponsesPayload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);
    const providerOptions = buildProviderOptions({
      model: 'glm-5-turbo',
      input: [],
      reasoning: { effort: 'medium' },
    }, { responses: { supportsReasoningSummary: true } });
    await generateText({ model, prompt: 'synthetic Turbo probe', providerOptions });

    assert.equal(capturedBody.model, 'glm-5-turbo');
    assert.deepEqual(capturedBody.reasoning, { summary: 'detailed' });
  });
});
