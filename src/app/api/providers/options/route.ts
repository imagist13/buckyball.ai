import { NextRequest, NextResponse } from 'next/server';
import { getProviderOptions, setProviderOptions } from '@/lib/db';
import type { ProviderOptions } from '@/types';

/**
 * GET /api/providers/options?providerId=xxx
 * Returns per-provider options (thinking_mode, context_1m).
 */
export async function GET(request: NextRequest) {
  const providerId = request.nextUrl.searchParams.get('providerId') || 'env';
  const options = getProviderOptions(providerId);
  return NextResponse.json({ options });
}

/**
 * PUT /api/providers/options
 * Update per-provider options. Body: { providerId, options: { thinking_mode?, context_1m? } }
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { providerId = 'env', options } = body as { providerId?: string; options: ProviderOptions };

    if (!options || typeof options !== 'object') {
      return NextResponse.json({ error: 'Invalid options' }, { status: 400 });
    }

    // Merge with existing options (partial update)
    const existing = getProviderOptions(providerId);
    const merged: ProviderOptions = { ...existing, ...options };
    setProviderOptions(providerId, merged);

    // Re-read after write. For `__global__` with `default_mode: 'auto'`,
    // `setProviderOptions` atomically clears the pinned keys at db.ts:1680
    // even though `merged` still carries them (the route's generic merge
    // can't know about Auto's clear semantics). Returning `merged`
    // directly would lie to the client — the response would still show
    // a pinned provider/model that no longer exists in the DB. Refetch
    // so the response always matches what the resolver sees next.
    const persisted = getProviderOptions(providerId);
    return NextResponse.json({ options: persisted });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update options' },
      { status: 500 },
    );
  }
}
