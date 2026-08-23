/**
 * `POST /api/providers/[id]/search-models`
 *
 * Returns the full upstream candidate set for the "搜索并添加模型"
 * dialog. The dialog filters client-side. Empty body; no `q` parameter.
 *
 * Never writes to `provider_models`. Adding a candidate goes through
 * the existing `POST /api/providers/[id]/models` route (manual add);
 * this route is purely a read.
 *
 * Phase 1 Step 2 收敛 round 6 (2026-05-06): generalized beyond OpenRouter.
 * Auth gate is now `isOpenRouterProviderRecord(provider) ||
 * canReliablyFetchModels(provider).reliable` — i.e. any provider whose
 * /v1/models is empirically reliable (ollama, litellm, anthropic-
 * thirdparty, openai-compatible). Plan providers, image providers,
 * cloud-direct (Bedrock/Vertex) and PAYG anthropic-compat brands stay
 * blocked — they fall through to the manual-add dialog.
 *
 *   - OpenRouter path uses `getOpenRouterCatalog` (5-min cache, includes
 *     pricing + contextWindow metadata for the candidate cards).
 *   - Generic reliable providers call `discoverModels()` directly and
 *     return the upstream id list as candidates. No pricing /
 *     contextWindow surfaced — most upstreams don't expose them, and a
 *     plain id list is enough for "pick what you want from this list".
 */
import { NextRequest, NextResponse } from 'next/server';
import { getProvider, getAllModelsForProvider } from '@/lib/db';
import {
  canSearchUpstreamModels,
  findMatchingPresetForRecord,
  isCatalogOnlyPlanProviderRecord,
  isOpenRouterProviderRecord,
} from '@/lib/provider-catalog';
import { discoverModels } from '@/lib/model-discovery';
import { getOpenRouterCatalog } from '@/lib/openrouter-catalog';
import type { ErrorResponse } from '@/types';

interface SearchModelCandidate {
  modelId: string;
  upstreamModelId?: string;
  displayName: string;
  contextWindow?: number;
  pricing?: { promptPerMillion?: number; completionPerMillion?: number };
  alreadyAdded: boolean;
  existingHidden: boolean;
  existingModelId?: string;
}

interface SearchModelsResponse {
  candidates: SearchModelCandidate[];
  total: number;
  cachedAt: string;
}

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const provider = getProvider(id);
    if (!provider) {
      return NextResponse.json<ErrorResponse>(
        { error: `Provider '${id}' not found` },
        { status: 404 },
      );
    }
    const isOpenRouter = isOpenRouterProviderRecord(provider);
    const policy = canSearchUpstreamModels(provider);
    if (!policy.reliable) {
      return NextResponse.json<ErrorResponse>(
        {
          error: 'search-models is not available for this provider',
          code: 'UNRELIABLE_PROVIDER',
        },
        { status: 400 },
      );
    }

    // Cross-reference with current provider_models. Hidden is a distinct user
    // state: presenting it as plain "Added" recreates the original complaint
    // (the picker has no row, yet the dialog offers no recovery action).
    const localModels = getAllModelsForProvider(provider.id);
    const getPresence = (modelId: string, upstreamModelId = modelId) => {
      const identities = new Set([modelId, upstreamModelId]);
      const matches = localModels.filter(model =>
        identities.has(model.model_id) || identities.has(model.upstream_model_id),
      );
      const existing = matches.find(model => model.enabled === 1)
        ?? matches.find(model => model.model_id === modelId)
        ?? matches[0];
      return {
        alreadyAdded: !!existing,
        existingHidden: !!existing && existing.enabled !== 1,
        ...(existing ? { existingModelId: existing.model_id } : {}),
      };
    };

    if (isOpenRouter) {
      // OpenRouter path — uses cached /v1/models with rich metadata
      // (pricing + context window). 5-min TTL via getOpenRouterCatalog.
      const { candidates, cachedAt } = await getOpenRouterCatalog(provider);
      const result: SearchModelsResponse = {
        candidates: candidates.map(c => ({
          modelId: c.modelId,
          displayName: c.displayName,
          contextWindow: c.contextWindow,
          pricing: c.pricing,
          ...getPresence(c.modelId),
        })),
        total: candidates.length,
        cachedAt,
      };
      return NextResponse.json(result);
    }

    const matched = findMatchingPresetForRecord(provider);

    // Coding/Token Plan providers have a curated SKU contract in the built-in
    // catalog. The user must be able to open Add Model even when DNS or the
    // vendor's optional /models endpoint is unavailable, so serve that catalog
    // directly and leave arbitrary ids to the dialog's manual-entry path.
    if (isCatalogOnlyPlanProviderRecord(provider) && matched?.defaultModels?.length) {
      const candidates: SearchModelCandidate[] = matched.defaultModels.map(model => {
        const upstreamModelId = model.upstreamModelId || model.modelId;
        return {
          // Keep the catalog's stable local identity separate from the wire
          // id. GLM-5.3 is stored as the long-lived `sonnet` row while Claude
          // sends `glm-5.3[1m]`; using the wire id as modelId would create a
          // duplicate row when the user adds a missing catalog candidate.
          modelId: model.modelId,
          upstreamModelId,
          displayName: model.displayName,
          ...getPresence(model.modelId, upstreamModelId),
        };
      });
      return NextResponse.json<SearchModelsResponse>({
        candidates,
        total: candidates.length,
        cachedAt: new Date().toISOString(),
      });
    }

    // Generic reliable provider — probe /v1/models directly. No cache:
    // dialog opens are rare (and the reliable path is tighter than
    // OpenRouter's 300+ catalog), so a per-open upstream call is fine.
    // Strip Gemini's `models/` prefix to keep ids canonical (matches
    // discover-models route's `normalizeModelId`).
    const authStyle = matched?.authStyle === 'api_key' || matched?.authStyle === 'auth_token'
      ? matched.authStyle
      : undefined;
    const probe = await discoverModels({
      protocol: matched?.protocol ?? provider.provider_type ?? 'unknown',
      baseUrl: provider.base_url || '',
      apiKey: provider.api_key || undefined,
      authStyle,
      presetKey: matched?.key,
      // Read-only path — let the prober run for plan presets (GLM,
      // MiniMax) that classifyProvider would otherwise mark
      // 'unsupported' to protect the auto-write apply path.
      // `canReliablyFetchModels` already filtered out the truly bad
      // ones (Volcengine / Bailian / Xiaomi MiMo TP / DeepSeek).
      bypassUnsupportedGate: true,
    });
    if (!probe.ok) {
      return NextResponse.json<ErrorResponse>(
        {
          error: probe.error?.message || 'upstream model list fetch failed',
          code: 'PROBE_FAILED',
        },
        { status: 502 },
      );
    }
    const upstreamIds = probe.fullModelIds && probe.fullModelIds.length > 0
      ? probe.fullModelIds
      : (probe.sampleModels ?? []);
    const candidates: SearchModelCandidate[] = upstreamIds.map(raw => {
      const modelId = raw.startsWith('models/') ? raw.slice('models/'.length) : raw;
      return {
        modelId,
        displayName: modelId,
        ...getPresence(modelId),
      };
    });
    const result: SearchModelsResponse = {
      candidates,
      total: candidates.length,
      cachedAt: new Date().toISOString(),
    };
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'search-models failed' },
      { status: 500 },
    );
  }
}
