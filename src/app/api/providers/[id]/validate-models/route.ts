/**
 * `POST /api/providers/[id]/validate-models`
 *
 * OpenRouter "刷新" button replacement. Force-refetches `/v1/models` from
 * upstream (bypassing the 5-min cache TTL — refresh must actually re-hit
 * the source) and returns `{ verified, missing, cachedAt }`. Updates only
 * `last_refreshed_at` on existing `provider_models` rows; does NOT change
 * `enabled`, `enable_source`, `source`, `display_name`, or any other
 * business field. There is no INSERT path.
 *
 * Auth gate: `isOpenRouterProviderRecord(provider)` — defense in depth on
 * top of the UI gate.
 *
 * Side effect: warms the cache for the next `/search-models` call so the
 * search dialog opened right after a refresh sees the freshest list.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getProvider, getAllModelsForProvider, touchProviderModelsRefreshed } from '@/lib/db';
import { isOpenRouterProviderRecord } from '@/lib/provider-catalog';
import { getOpenRouterCatalog } from '@/lib/openrouter-catalog';
import type { ErrorResponse } from '@/types';

interface ValidateModelsResponse {
  verified: number;
  missing: string[];
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
    if (!isOpenRouterProviderRecord(provider)) {
      return NextResponse.json<ErrorResponse>(
        {
          error: 'validate-models is only available for OpenRouter providers',
          code: 'NOT_OPENROUTER',
        },
        { status: 400 },
      );
    }

    // Force refetch — refresh must actually re-hit upstream, not return
    // a stale cached list. The cache write inside the helper means the
    // next /search-models call benefits from the fresh data automatically.
    const { candidates, cachedAt } = await getOpenRouterCatalog(provider, { force: true });
    const upstreamIds = new Set(candidates.map(c => c.modelId));

    // Skip `source='catalog'` rows. These are local Claude Code aliases
    // (sonnet/opus/haiku) seeded at Add-Service time — they intentionally
    // carry short alias names rather than full OpenRouter IDs (which look
    // like `anthropic/claude-3.5-sonnet`). Validating them against
    // upstream by `model_id` would always miss and falsely mark every
    // default alias as "no longer upstream" right after a fresh Add.
    // Real upstream IDs live on `source IN ('manual', 'api')` rows,
    // which is what this loop is designed to verify.
    const localModels = getAllModelsForProvider(provider.id).filter(
      row => row.source !== 'catalog',
    );
    const missing: string[] = [];
    let verified = 0;
    for (const row of localModels) {
      if (upstreamIds.has(row.model_id)) {
        verified += 1;
      } else {
        missing.push(row.model_id);
      }
    }

    // Bump the timestamp on all rows; no other field touched.
    touchProviderModelsRefreshed(provider.id);

    const result: ValidateModelsResponse = { verified, missing, cachedAt };
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'validate-models failed' },
      { status: 500 },
    );
  }
}
