/**
 * DeepSeek V4 Flash 0731 + V4 Pro 0813 adaptation contract.
 *
 * Pins the distinction between first-party DeepSeek and aggregators that list
 * the same model: only the first-party preset owns verified effort and native
 * Codex Responses capabilities. The request-shape probe uses the production
 * Responses factory with a synthetic capture fetch; no real key or user data
 * enters this test.
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
  resolveProvider,
  toClaudeCodeEnv,
  toAiSdkConfig,
  type ResolvedProvider,
} from '../../lib/provider-resolver';
import { createProvider } from '../../lib/db';
import { createApiKeyResponsesLanguageModel } from '../../lib/ai-provider';
import { sanitizeClaudeModelOptions } from '../../lib/claude-model-options';
import { buildAnthropicProviderOptions } from '../../lib/agent-loop-anthropic-wire';
import { buildBody } from '../../lib/claude-code-compat/request-builder';
import { buildProviderOptions } from '../../lib/codex/proxy/unified-adapter';
import { normalizeModelCapabilitySurface } from '../../app/api/providers/models/route';

const DEEPSEEK_BASE = 'https://api.deepseek.com/anthropic';
const FLASH = 'deepseek-v4-flash';
const PRO = 'deepseek-v4-pro';
const FAKE_KEY = 'deepseek-test-key-not-real';

function resolvedDeepSeek(modelId = FLASH): ResolvedProvider {
  const preset = getPreset('deepseek');
  assert.ok(preset);
  return {
    provider: {
      id: 'deepseek-test-provider',
      preset_key: 'deepseek',
      provider_type: 'anthropic',
      protocol: 'anthropic',
      base_url: DEEPSEEK_BASE,
      api_key: FAKE_KEY,
    } as ResolvedProvider['provider'],
    protocol: 'anthropic',
    authStyle: 'auth_token',
    model: modelId,
    upstreamModel: modelId,
    modelDisplayName: modelId,
    headers: {},
    envOverrides: {},
    roleModels: preset.defaultRoleModels ?? {},
    hasCredentials: true,
    availableModels: preset.defaultModels,
    settingSources: ['user'],
  };
}

function completedResponsesPayload(model = FLASH): Record<string, unknown> {
  return {
    id: 'resp_deepseek_fixture',
    object: 'response',
    created_at: 1,
    status: 'completed',
    error: null,
    incomplete_details: null,
    model,
    output: [{
      type: 'message',
      id: 'msg_deepseek_fixture',
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

describe('DeepSeek catalog + identity boundary', () => {
  it('publishes the current Flash capability contract without changing the model id', () => {
    const preset = getPreset('deepseek');
    assert.ok(preset);
    PresetSchema.parse(preset);

    const flash = preset.defaultModels.find(model => model.modelId === FLASH);
    assert.ok(flash);
    assert.equal(flash.upstreamModelId, FLASH);
    assert.equal(flash.capabilities?.contextWindow, 1_048_576);
    assert.deepEqual(flash.capabilities?.supportedEffortLevels, ['low', 'high', 'max']);
    assert.equal(flash.capabilities?.defaultEffortLevel, 'high');
    assert.equal(preset.defaultEnvOverrides.CLAUDE_CODE_SUBAGENT_MODEL, FLASH);

    const apiSurface = normalizeModelCapabilitySurface({
      value: FLASH,
      label: 'DeepSeek V4 Flash',
      capabilities: flash.capabilities,
    });
    assert.equal(apiSurface.contextWindow, 1_048_576);
    assert.deepEqual(apiSurface.supportedEffortLevels, ['low', 'high', 'max']);

    const pro = preset.defaultModels.find(model => model.modelId === PRO);
    assert.ok(pro);
    assert.equal(pro.displayName, 'DeepSeek V4 Pro');
    assert.equal(pro.upstreamModelId, PRO, '0813 is a server-side version, not a new API id');
    assert.equal(pro.capabilities?.contextWindow, 1_048_576);
    assert.deepEqual(pro.capabilities?.supportedEffortLevels, ['low', 'high', 'max']);

    const pro1m = preset.defaultModels.find(model => model.modelId === `${PRO}[1m]`);
    assert.ok(pro1m);
    assert.equal(pro1m.displayName, 'DeepSeek V4 Pro (1M)');
  });

  it('keeps ClinePass and OpenCode Go DeepSeek entries tool-use-only', () => {
    for (const key of ['cline-pass', 'opencode-go-openai', 'opencode-go-anthropic']) {
      const preset = getPreset(key);
      assert.ok(preset, key);
      const deepseek = preset.defaultModels.find(model => model.modelId.includes('deepseek-v4-flash'));
      if (!deepseek) continue;
      assert.equal(deepseek.capabilities?.toolUse, true, key);
      assert.equal(deepseek.capabilities?.supportsEffort, undefined, key);
      assert.equal(preset.wireCapabilities, undefined, key);
    }
  });

  it('resolves verified wires only for the first-party preset + exact model', () => {
    const direct = getVerifiedProviderWireCapabilities({
      preset_key: 'deepseek',
      provider_type: 'anthropic',
      protocol: 'anthropic',
      base_url: DEEPSEEK_BASE,
    }, FLASH);
    assert.deepEqual(direct.anthropicEffortLevels, ['low', 'high', 'max']);
    assert.equal(direct.codexResponses?.baseUrl, 'https://api.deepseek.com');

    const directPro = getVerifiedProviderWireCapabilities({
      preset_key: 'deepseek',
      provider_type: 'anthropic',
      protocol: 'anthropic',
      base_url: DEEPSEEK_BASE,
    }, PRO);
    assert.deepEqual(directPro.anthropicEffortLevels, ['low', 'high', 'max']);
    assert.equal(directPro.codexResponses?.baseUrl, 'https://api.deepseek.com');

    const claudeAlias = getVerifiedProviderWireCapabilities({
      preset_key: 'deepseek',
      provider_type: 'anthropic',
      protocol: 'anthropic',
      base_url: DEEPSEEK_BASE,
    }, 'deepseek-v4-pro[1m]');
    assert.equal(claudeAlias.codexResponses, undefined, 'Responses uses the stable non-suffixed API id');

    const aggregator = getVerifiedProviderWireCapabilities({
      preset_key: 'cline-pass',
      provider_type: 'openai-compatible',
      protocol: 'openai-compatible',
      base_url: 'https://api.cline.bot/api/v1',
    }, 'cline-pass/deepseek-v4-flash');
    assert.deepEqual(aggregator, {});
  });
});

describe('DeepSeek runtime transport selection', () => {
  it('layers current preset defaults onto legacy rows while preserving user overrides', () => {
    const legacy = createProvider({
      name: 'Legacy DeepSeek fixture',
      provider_type: 'anthropic',
      protocol: 'anthropic',
      base_url: DEEPSEEK_BASE,
      api_key: FAKE_KEY,
      env_overrides_json: '{}',
    });
    const legacyResolved = resolveProvider({
      callScene: 'interactive_chat',
      providerId: legacy.id,
      model: FLASH,
    });
    assert.equal(legacyResolved.envOverrides.CLAUDE_CODE_SUBAGENT_MODEL, FLASH);
    assert.equal(
      toClaudeCodeEnv({ CLAUDE_CODE_SUBAGENT_MODEL: 'stale-cross-provider' }, legacyResolved)
        .CLAUDE_CODE_SUBAGENT_MODEL,
      FLASH,
    );

    const customized = createProvider({
      name: 'Customized DeepSeek fixture',
      provider_type: 'anthropic',
      preset_key: 'deepseek',
      protocol: 'anthropic',
      base_url: DEEPSEEK_BASE,
      api_key: FAKE_KEY,
      env_overrides_json: JSON.stringify({ CLAUDE_CODE_SUBAGENT_MODEL: 'my-flash-alias' }),
    });
    const customizedResolved = resolveProvider({
      callScene: 'interactive_chat',
      providerId: customized.id,
      model: FLASH,
    });
    assert.equal(customizedResolved.envOverrides.CLAUDE_CODE_SUBAGENT_MODEL, 'my-flash-alias');
  });

  it('uses native Responses for Flash and the stable Pro id under Codex Runtime', () => {
    const flashCodex = toAiSdkConfig(resolvedDeepSeek(), FLASH, { runtime: 'codex_runtime' });
    assert.equal(flashCodex.sdkType, 'openai');
    assert.equal(flashCodex.baseUrl, 'https://api.deepseek.com');
    assert.equal(flashCodex.useResponsesApi, true);
    assert.equal(flashCodex.responsesApiAuth, 'api_key');
    assert.deepEqual(flashCodex.verifiedResponsesEffortLevels, ['low', 'high', 'max']);

    const flashNative = toAiSdkConfig(resolvedDeepSeek(), FLASH, { runtime: 'codepilot_runtime' });
    assert.equal(flashNative.sdkType, 'claude-code-compat');
    assert.equal(flashNative.baseUrl, DEEPSEEK_BASE);

    const proCodex = toAiSdkConfig(
      resolvedDeepSeek(PRO),
      PRO,
      { runtime: 'codex_runtime' },
    );
    assert.equal(proCodex.sdkType, 'openai');
    assert.equal(proCodex.baseUrl, 'https://api.deepseek.com');
    assert.equal(proCodex.useResponsesApi, true);
    assert.deepEqual(proCodex.verifiedResponsesEffortLevels, ['low', 'high', 'max']);

    const proNative = toAiSdkConfig(resolvedDeepSeek(PRO), PRO, { runtime: 'codepilot_runtime' });
    assert.equal(proNative.sdkType, 'claude-code-compat');

    const proClaudeAlias = toAiSdkConfig(
      resolvedDeepSeek('deepseek-v4-pro[1m]'),
      'deepseek-v4-pro[1m]',
      { runtime: 'codex_runtime' },
    );
    assert.equal(proClaudeAlias.sdkType, 'claude-code-compat');
    assert.equal(proClaudeAlias.useResponsesApi, undefined);
  });

  it('production Responses factory sends Pro 0813 through /responses with bearer auth and max effort', async () => {
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
      return new Response(JSON.stringify(completedResponsesPayload(PRO)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const model = createApiKeyResponsesLanguageModel({
      apiKey: FAKE_KEY,
      baseUrl: 'https://api.deepseek.com',
      modelId: PRO,
      headers: {},
      supportsResponsesReasoningSummary: false,
    }, captureFetch);
    const result = await generateText({
      model,
      prompt: 'synthetic DeepSeek transport probe',
      providerOptions: {
        openai: { store: false, forceReasoning: true, reasoningEffort: 'max' },
      },
    });

    assert.equal(result.text, 'ok');
    assert.equal(capturedUrl, 'https://api.deepseek.com/responses');
    assert.equal(capturedAuth, `Bearer ${FAKE_KEY}`);
    assert.equal(capturedBody.model, PRO);
    assert.deepEqual(capturedBody.reasoning, { effort: 'max' });
  });
});

describe('DeepSeek effort wire formats', () => {
  it('sends verified Anthropic effort and keeps unverified proxies fail-closed', () => {
    const sanitized = sanitizeClaudeModelOptions({
      model: FLASH,
      thinking: { type: 'enabled', budgetTokens: 4096 },
      effort: 'max',
    });
    const verified = buildAnthropicProviderOptions({
      isThirdPartyProxy: true,
      model: FLASH,
      sanitized,
      verifiedEffortLevels: ['low', 'high', 'max'],
    });
    assert.deepEqual(verified.anthropic, {
      thinking: { type: 'enabled', budgetTokens: 4096 },
      effort: 'max',
    });
    assert.equal(verified.effortDroppedForProxy, false);

    const unknown = buildAnthropicProviderOptions({
      isThirdPartyProxy: true,
      model: FLASH,
      sanitized,
    });
    assert.equal(unknown.anthropic?.effort, undefined);
    assert.equal(unknown.effortDroppedForProxy, true);
  });

  it('maps compat effort to Anthropic output_config.effort', () => {
    const body = buildBody({
      prompt: [],
      providerOptions: { anthropic: { effort: 'max' } },
    } as never, {
      authToken: FAKE_KEY,
      baseUrl: DEEPSEEK_BASE,
      modelId: FLASH,
    });
    assert.deepEqual(body.output_config, { effort: 'max' });
  });

  it('preserves max on the verified Responses wire and maps xhigh to high', () => {
    const context = {
      responses: {
        verifiedEffortLevels: ['low', 'high', 'max'] as const,
        effortAliases: { xhigh: 'high' } as const,
      },
    };
    const max = buildProviderOptions({
      model: FLASH,
      input: [],
      reasoning: { effort: 'max' },
    }, context);
    assert.equal((max?.openai as Record<string, unknown>).reasoningEffort, 'max');
    assert.equal((max?.openai as Record<string, unknown>).forceReasoning, true);

    const xhigh = buildProviderOptions({
      model: FLASH,
      input: [],
      reasoning: { effort: 'xhigh' },
    }, context);
    assert.equal((xhigh?.openai as Record<string, unknown>).reasoningEffort, 'high');

    const medium = buildProviderOptions({
      model: FLASH,
      input: [],
      reasoning: { effort: 'medium' },
    }, context);
    assert.equal((medium?.openai as Record<string, unknown>).reasoningEffort, undefined);
  });
});
