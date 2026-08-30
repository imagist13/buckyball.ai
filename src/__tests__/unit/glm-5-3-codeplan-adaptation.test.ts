/**
 * GLM-5.3 / GLM-5.3-Flash Coding Plan adaptation contract.
 *
 * Claude/Anthropic uses `[1m]` wire IDs while Codex/Responses uses bare
 * model IDs. These tests drive the real resolver and provider factories so
 * catalog labels, vision metadata, transport selection, effort mapping and
 * outbound bodies cannot drift independently.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateText, type ModelMessage } from 'ai';
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
const FLASH = 'glm-5.3-flash[1m]';
const RESPONSES_FLASH = 'glm-5.3-flash';
const FAKE_KEY = 'glm-codeplan-test-key-not-real';
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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
    roleModels: {
      ...(preset.defaultRoleModels ?? {}),
      default: model.upstreamModelId ?? model.modelId,
    },
    hasCredentials: true,
    availableModels: preset.defaultModels,
    settingSources: ['user'],
  };
}

function completedResponsesPayload(model: string): Record<string, unknown> {
  return {
    id: 'resp_glm_fixture',
    object: 'response',
    created_at: 1,
    status: 'completed',
    error: null,
    incomplete_details: null,
    model,
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

describe('GLM-5.3 Coding Plan catalog', () => {
  it('publishes only the current GLM-5.3 / GLM-5.3-Flash lineup in both regions', () => {
    for (const key of ['glm-cn', 'glm-global'] as const) {
      const preset = getPreset(key);
      assert.ok(preset);
      PresetSchema.parse(preset);
      assert.deepEqual(
        preset.defaultModels.map(model => [model.modelId, model.upstreamModelId, model.displayName]),
        [
          ['sonnet', FLAGSHIP, 'GLM-5.3'],
          ['haiku', FLASH, 'GLM-5.3-Flash'],
        ],
      );
      assert.ok(!preset.defaultModels.some(model =>
        /GLM-5\.2|GLM-5-Turbo|GLM-4\.7|GLM-4\.5-Air/.test(model.displayName)));
      assert.deepEqual(preset.defaultRoleModels, {
        default: FLAGSHIP,
        sonnet: FLAGSHIP,
        opus: FLAGSHIP,
        haiku: FLASH,
      });
      assert.equal(preset.defaultEnvOverrides.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '1000000');
      assert.equal(preset.defaultEnvOverrides.ANTHROPIC_DEFAULT_HAIKU_MODEL, FLASH);
    }
  });

  it('models both products as always-thinking 1M models and marks only Flash as visual', () => {
    const preset = getPreset('glm-cn');
    assert.ok(preset);
    const flagship = preset.defaultModels.find(model => model.modelId === 'sonnet');
    const flash = preset.defaultModels.find(model => model.modelId === 'haiku');
    assert.ok(flagship);
    assert.ok(flash);

    for (const model of [flagship, flash]) {
      assert.equal(model.capabilities?.reasoning, true);
      assert.equal(model.capabilities?.toolUse, true);
      assert.equal(model.capabilities?.contextWindow, 1_000_000);
      assert.equal(model.capabilities?.supportsEffort, true);
      assert.deepEqual(model.capabilities?.supportedEffortLevels, ['low', 'high', 'max']);
      assert.equal(model.capabilities?.defaultEffortLevel, 'max');
      assert.equal(model.capabilities?.effortNoteKey, 'messageInput.effort.note.glmCodePlan');
      assert.equal(model.capabilities?.thinkingMode, 'always');
    }
    assert.equal(flagship.capabilities?.vision, undefined, 'GLM-5.3 remains text-only');
    assert.equal(flash.capabilities?.vision, true, 'Flash accepts native image input');
  });

  it('shows the current points contract without inventing a percentage or plan balance', () => {
    for (const key of ['glm-cn', 'glm-global'] as const) {
      const preset = getPreset(key);
      assert.ok(preset);
      assert.ok(preset.meta?.notes?.some(note =>
        note.includes('GLM-5.3-Flash points: input 2.3, cached input 0.56, output 8')));
      assert.ok(preset.meta?.notesZh?.some(note =>
        note.includes('GLM-5.3-Flash 积分倍率：输入 2.3、缓存输入 0.56、输出 8')));
    }
  });
});

describe('GLM-5.3 transport identity', () => {
  it('keeps exact first-party capability gates and per-region Responses endpoints', () => {
    for (const [model, responseModel] of [
      [FLAGSHIP, RESPONSES_FLAGSHIP],
      [FLASH, RESPONSES_FLASH],
    ] as const) {
      const cn = getVerifiedProviderWireCapabilities({
        preset_key: 'glm-cn',
        provider_type: 'anthropic',
        protocol: 'anthropic',
        base_url: CN_ANTHROPIC_BASE,
      }, model);
      assert.deepEqual(cn.anthropicEffortLevels, ['low', 'high', 'max']);
      assert.equal(cn.codexResponses?.baseUrl, CN_RESPONSES_BASE);
      assert.equal(cn.codexResponses?.modelId, responseModel);
      assert.deepEqual(cn.codexResponses?.effortAliases, {
        minimal: 'low',
        medium: 'high',
        xhigh: 'max',
      });
    }

    const global = getVerifiedProviderWireCapabilities({
      preset_key: 'glm-global',
      provider_type: 'anthropic',
      protocol: 'anthropic',
      base_url: GLOBAL_ANTHROPIC_BASE,
    }, 'haiku');
    assert.equal(global.codexResponses?.baseUrl, GLOBAL_RESPONSES_BASE);
    assert.equal(global.codexResponses?.modelId, RESPONSES_FLASH);

    const aggregator = getVerifiedProviderWireCapabilities({
      preset_key: 'anthropic-thirdparty',
      provider_type: 'anthropic',
      protocol: 'anthropic',
      base_url: 'https://proxy.example/anthropic',
    }, FLASH);
    assert.deepEqual(aggregator, {});
  });

  it('uses [1m] on Claude and bare IDs on native Codex Responses for both models', () => {
    for (const [modelId, anthropicModel, responsesModel] of [
      ['sonnet', FLAGSHIP, RESPONSES_FLAGSHIP],
      ['haiku', FLASH, RESPONSES_FLASH],
    ] as const) {
      const resolved = resolvedGlm('glm-cn', modelId);
      const claude = toAiSdkConfig(resolved, modelId, { runtime: 'claude_code' });
      assert.equal(claude.sdkType, 'claude-code-compat');
      assert.equal(claude.baseUrl, CN_ANTHROPIC_BASE);
      assert.equal(claude.modelId, anthropicModel);
      assert.deepEqual(claude.verifiedAnthropicEffortLevels, ['low', 'high', 'max']);

      const codex = toAiSdkConfig(resolved, modelId, { runtime: 'codex_runtime' });
      assert.equal(codex.sdkType, 'openai');
      assert.equal(codex.baseUrl, CN_RESPONSES_BASE);
      assert.equal(codex.modelId, responsesModel);
      assert.equal(codex.useResponsesApi, true);
      assert.deepEqual(codex.verifiedResponsesEffortLevels, ['low', 'high', 'max']);
    }
  });

  it('injects auth, endpoint and exact upstream model for every current picker entry', () => {
    for (const [modelId, upstreamModelId] of [
      ['sonnet', FLAGSHIP],
      ['haiku', FLASH],
    ] as const) {
      const env = toClaudeCodeEnv({
        ANTHROPIC_API_KEY: 'stale-other-provider',
        ANTHROPIC_AUTH_TOKEN: 'stale-other-provider',
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: 'stale',
      }, resolvedGlm('glm-cn', modelId));
      assert.equal(env.ANTHROPIC_AUTH_TOKEN, FAKE_KEY);
      assert.equal(env.ANTHROPIC_API_KEY, '');
      assert.equal(env.ANTHROPIC_BASE_URL, CN_ANTHROPIC_BASE);
      assert.equal(env.ANTHROPIC_MODEL, upstreamModelId);
      assert.equal(env.ANTHROPIC_DEFAULT_SONNET_MODEL, FLAGSHIP);
      assert.equal(env.ANTHROPIC_DEFAULT_OPUS_MODEL, FLAGSHIP);
      assert.equal(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, FLASH);
      assert.equal(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, '1000000');
    }
  });
});

describe('GLM-5.3 effort and multimodal wire formats', () => {
  it('routes explicit Max and Auto through both catalog entries without a silent High downgrade', () => {
    const appServerVocabulary = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    for (const modelId of ['sonnet', 'haiku']) {
      const contract = getResolvedModelEffortContract(resolvedGlm('glm-cn', modelId), modelId);
      assert.deepEqual(contract, {
        supportedLevels: ['low', 'high', 'max'],
        defaultLevel: 'max',
      });
      assert.equal(resolveCodexProviderEffort('max', contract, appServerVocabulary), 'max');
      assert.equal(resolveCodexProviderEffort(undefined, contract, appServerVocabulary), 'max');
      assert.equal(
        resolveCodexProviderEffort(undefined, contract, undefined, 'codex-cli 0.144.2'),
        'max',
      );
      assert.throws(
        () => resolveCodexProviderEffort('max', contract, ['minimal', 'low', 'medium', 'high']),
        /has not advertised support for the "max" effort token/,
      );
    }
  });

  it('preserves Low/High/Max on Anthropic output_config for both wire IDs', () => {
    for (const model of [FLAGSHIP, FLASH]) {
      for (const effort of ['low', 'high', 'max'] as const) {
        const sanitized = sanitizeClaudeModelOptions({ model, effort });
        const verified = buildAnthropicProviderOptions({
          isThirdPartyProxy: true,
          model,
          sanitized,
          verifiedEffortLevels: ['low', 'high', 'max'],
        });
        const body = buildBody({
          prompt: [],
          providerOptions: { anthropic: verified.anthropic },
        } as never, {
          authToken: FAKE_KEY,
          baseUrl: CN_ANTHROPIC_BASE,
          modelId: model,
        });
        assert.deepEqual(body.output_config, { effort });
      }
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
        model: RESPONSES_FLASH,
        input: [],
        reasoning: { effort: requested },
      }, context);
      assert.equal((options?.openai as Record<string, unknown>).reasoningEffort, expected);
    }
  });

  it('production Responses factory sends the flagship bare ID and max effort', async () => {
    const config = toAiSdkConfig(resolvedGlm('glm-cn'), 'sonnet', { runtime: 'codex_runtime' });
    let capturedUrl = '';
    let capturedAuth = '';
    let capturedBody: Record<string, unknown> = {};
    const model = createApiKeyResponsesLanguageModel(config, (async (input, init) => {
      capturedUrl = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      capturedAuth = new Headers(init?.headers).get('authorization') ?? '';
      capturedBody = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      return new Response(JSON.stringify(completedResponsesPayload(RESPONSES_FLAGSHIP)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);
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

  it('Flash sends native image input through Anthropic and Responses paths', async () => {
    const imageDataUrl = `data:image/png;base64,${PNG_1PX}`;
    const anthropicBody = buildBody({
      prompt: [{
        role: 'user',
        content: [{ type: 'image', image: imageDataUrl, mimeType: 'image/png' }],
      }],
    } as never, {
      authToken: FAKE_KEY,
      baseUrl: CN_ANTHROPIC_BASE,
      modelId: FLASH,
    });
    const anthropicContent = (anthropicBody.messages as Array<{
      content: Array<Record<string, unknown>>;
    }>)[0].content[0];
    assert.deepEqual(anthropicContent, {
      type: 'image',
      source: { type: 'url', url: imageDataUrl },
    });

    const config = toAiSdkConfig(resolvedGlm('glm-cn', 'haiku'), 'haiku', {
      runtime: 'codex_runtime',
    });
    let capturedBody: Record<string, unknown> = {};
    const model = createApiKeyResponsesLanguageModel(config, (async (_input, init) => {
      capturedBody = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      return new Response(JSON.stringify(completedResponsesPayload(RESPONSES_FLASH)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch);
    const messages: ModelMessage[] = [{
      role: 'user',
      content: [
        { type: 'text', text: 'synthetic GLM visual probe' },
        { type: 'file', data: PNG_1PX, mediaType: 'image/png' },
      ],
    }];
    const providerOptions = buildProviderOptions({
      model: RESPONSES_FLASH,
      input: [],
      reasoning: { effort: 'max' },
    }, {
      responses: {
        verifiedEffortLevels: config.verifiedResponsesEffortLevels!,
        effortAliases: config.verifiedResponsesEffortAliases,
      },
    });
    await generateText({ model, messages, providerOptions });

    assert.equal(capturedBody.model, RESPONSES_FLASH);
    const input = capturedBody.input as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    const image = input.find(message => message.role === 'user')?.content
      .find(part => part.type === 'input_image');
    assert.deepEqual(image, {
      type: 'input_image',
      image_url: imageDataUrl,
    });
    assert.deepEqual(capturedBody.reasoning, { effort: 'max', summary: 'detailed' });
  });
});
