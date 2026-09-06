/**
 * `POST /api/providers/[id]/openrouter-legacy-cleanup`
 *
 * Opt-in cleanup for users whose DB still carries the 300+ rows from the
 * old OpenRouter auto-materialize behavior. Only affects rows that were
 * left by the legacy flow (`enable_source='recommended' AND user_edited=0`).
 * `manual_enabled` / `manual_hidden` and any user-edited rows are excluded
 * by the WHERE clause — there is no path through this route that touches
 * a user's deliberate choice.
 *
 * Body: `{ mode: 'preview' | 'commit' }`
 *   - `preview` returns the rows that *would* be hidden, no DB write
 *   - `commit`  hides them (`enabled=0`, `enable_source='manual_hidden'`,
 *               `user_edited=1`) and returns the count
 *
 * Auth gate: `isOpenRouterProviderRecord(provider)`. Other providers get
 * a 400 — this is OpenRouter-scoped, not a general "tidy" feature.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getProvider,
  getRecommendedNotEditedRows,
  hideRecommendedNotEditedRows,
} from '@/lib/db';
import { isOpenRouterProviderRecord } from '@/lib/provider-catalog';
import type { ErrorResponse, ProviderModel } from '@/types';

interface PreviewResponse {
  mode: 'preview';
  candidates: Array<Pick<ProviderModel, 'model_id' | 'display_name' | 'source' | 'enable_source'>>;
  count: number;
}

interface CommitResponse {
  mode: 'commit';
  hiddenCount: number;
}

export async function POST(
  request: NextRequest,
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
          error: 'openrouter-legacy-cleanup is only available for OpenRouter providers',
          code: 'NOT_OPENROUTER',
        },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => null)) as { mode?: 'preview' | 'commit' } | null;
    const mode = body?.mode;
    if (mode !== 'preview' && mode !== 'commit') {
      return NextResponse.json<ErrorResponse>(
        { error: "Body must be { mode: 'preview' | 'commit' }" },
        { status: 400 },
      );
    }

    if (mode === 'preview') {
      const rows = getRecommendedNotEditedRows(provider.id);
      const result: PreviewResponse = {
        mode: 'preview',
        candidates: rows.map(r => ({
          model_id: r.model_id,
          display_name: r.display_name,
          source: r.source,
          enable_source: r.enable_source,
        })),
        count: rows.length,
      };
      return NextResponse.json(result);
    }

    // commit
    const hiddenCount = hideRecommendedNotEditedRows(provider.id);
    const result: CommitResponse = { mode: 'commit', hiddenCount };
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'openrouter-legacy-cleanup failed' },
      { status: 500 },
    );
  }
}
