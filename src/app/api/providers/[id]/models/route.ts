import { NextRequest, NextResponse } from 'next/server';
import {
  getProvider,
  getModelsForProvider,
  getAllModelsForProvider,
  upsertProviderModel,
  deleteProviderModel,
  updateProviderModelUserFields,
  seedCatalogModelsIfEmpty,
  mergeCatalogManagedModels,
} from '@/lib/db';
import {
  getCatalogDefaultModelsForRecord,
  isCatalogOnlyPlanProviderRecord,
} from '@/lib/provider-catalog';
import type { ErrorResponse } from '@/types';

/**
 * GET /api/providers/[id]/models
 *
 * Default: enabled-only (back-compat for the chat layer).
 * `?all=1`: all rows including hidden — used by Settings > Models page.
 *
 * Backfill: when the table is empty for this provider, seed the matched
 * preset's catalog defaults (rows tagged source='catalog'). For catalog-only
 * plan providers, also merge current catalog metadata/new ids into pristine
 * catalog rows. This upgrades old installations (for example GLM-5.2 → 5.3)
 * without touching manual/user-edited rows or performing the destructive
 * disable/prune behavior of a full catalog align.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const provider = getProvider(id);
  if (!provider) {
    return NextResponse.json<ErrorResponse>({ error: 'Provider not found' }, { status: 404 });
  }
  const catalogDefaults = getCatalogDefaultModelsForRecord(provider);
  if (catalogDefaults.length > 0) {
    const seeded = seedCatalogModelsIfEmpty(id, catalogDefaults);
    if (seeded === 0 && isCatalogOnlyPlanProviderRecord(provider)) {
      mergeCatalogManagedModels(id, catalogDefaults);
    }
  }
  const includeHidden = request.nextUrl.searchParams.get('all') === '1';
  const models = includeHidden ? getAllModelsForProvider(id) : getModelsForProvider(id);
  return NextResponse.json({ models });
}

/**
 * POST /api/providers/[id]/models
 *
 * Add a model. Arbitrary ids use the manual ownership contract. Exact ids
 * from a catalog-only plan are re-materialized from the server-side catalog
 * instead, so deleting/re-adding GLM-5.3 cannot erase its effort/context
 * capabilities or permanently opt the row out of future catalog upgrades.
 *
 * On the arbitrary-id branch, both `user_edited` and
 * `enable_source='manual_enabled'` independently gate the row out of refresh
 * apply / catalog align (defense in depth); setting both keeps the badge in
 * the Models page accurate ("手动启用" rather than a catalog recommendation).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const provider = getProvider(id);
  if (!provider) {
    return NextResponse.json<ErrorResponse>({ error: 'Provider not found' }, { status: 404 });
  }

  const body = await request.json();
  const { model_id, upstream_model_id, display_name, capabilities_json, sort_order } = body;

  if (!model_id) {
    return NextResponse.json<ErrorResponse>({ error: 'model_id is required' }, { status: 400 });
  }

  const catalogDefaults = getCatalogDefaultModelsForRecord(provider);
  const catalogModel = isCatalogOnlyPlanProviderRecord(provider)
    ? catalogDefaults.find(model => model.modelId === model_id)
    : undefined;

  if (catalogModel) {
    // Reuse the same ownership, de-duplication, ordering and conflict contract
    // as Models GET. This also makes a stale dialog response safe when another
    // process inserted the candidate before the click reached this route.
    mergeCatalogManagedModels(id, catalogDefaults);
  } else {
    upsertProviderModel({
      provider_id: id,
      model_id,
      upstream_model_id: upstream_model_id || model_id,
      display_name: display_name || model_id,
      capabilities_json: capabilities_json || '{}',
      sort_order: sort_order ?? 0,
      source: 'manual',
      user_edited: 1,
      enable_source: 'manual_enabled',
    });
  }

  const models = getAllModelsForProvider(id);
  return NextResponse.json({ models });
}

/**
 * PATCH /api/providers/[id]/models
 *
 * Update user-controllable fields (display_name / enabled / sort_order /
 * capabilities) on an existing model. Sets `user_edited=1` so the next
 * refresh apply preserves these fields.
 *
 * Body: { model_id: string, display_name?, enabled?, sort_order?, capabilities_json? }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const provider = getProvider(id);
  if (!provider) {
    return NextResponse.json<ErrorResponse>({ error: 'Provider not found' }, { status: 404 });
  }

  const body = await request.json();
  const { model_id, display_name, enabled, sort_order, capabilities_json } = body;
  if (!model_id) {
    return NextResponse.json<ErrorResponse>({ error: 'model_id is required' }, { status: 400 });
  }

  const ok = updateProviderModelUserFields(id, model_id, {
    display_name,
    enabled,
    sort_order,
    capabilities_json,
  });
  if (!ok) {
    return NextResponse.json<ErrorResponse>({ error: 'Model not found' }, { status: 404 });
  }
  const models = getAllModelsForProvider(id);
  return NextResponse.json({ models });
}

/**
 * DELETE /api/providers/[id]/models
 *
 * Body: { model_id: string }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const provider = getProvider(id);
  if (!provider) {
    return NextResponse.json<ErrorResponse>({ error: 'Provider not found' }, { status: 404 });
  }

  const body = await request.json();
  const { model_id } = body;

  if (!model_id) {
    return NextResponse.json<ErrorResponse>({ error: 'model_id is required' }, { status: 400 });
  }

  const deleted = deleteProviderModel(id, model_id);
  if (!deleted) {
    return NextResponse.json<ErrorResponse>({ error: 'Model not found' }, { status: 404 });
  }

  const models = getAllModelsForProvider(id);
  return NextResponse.json({ models });
}
