import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting, getProvider } from '@/lib/db';
import { getPreset } from '@/lib/provider-catalog';
import { getXaiOAuthStatus, isXaiOAuthUsable } from '@/lib/xai-oauth-manager';
import { XAI_IMAGINE_IMAGE_MODEL, XAI_IMAGINE_VIDEO_MODEL } from '@/lib/xai-imagine';
import type { ApiProvider } from '@/types';

const XAI_OAUTH_MEDIA_PROVIDER_ID = 'xai-oauth';

function xaiOAuthMediaInfo(stale: boolean) {
  const status = getXaiOAuthStatus();
  return {
    providerId: XAI_OAUTH_MEDIA_PROVIDER_ID,
    stale,
    providerName: 'Grok Build',
    providerType: 'xai-oauth',
    family: 'xai',
    model: XAI_IMAGINE_IMAGE_MODEL,
    modelLabel: 'Grok Imagine Image 2.0',
    videoModel: XAI_IMAGINE_VIDEO_MODEL,
    videoModelLabel: 'Grok Imagine Video 1.5',
    email: status.email,
  };
}

/**
 * Resolve the model id + friendly label a media provider would currently use.
 * Used by the image-gen UI so the Design Agent card can show the model name
 * without every client re-implementing the extra_env parse + catalog lookup.
 */
function resolveModelForProvider(provider: ApiProvider): { model: string; modelLabel: string } {
  const isOpenAI = provider.provider_type === 'openai-image';
  const envKey = isOpenAI ? 'OPENAI_IMAGE_MODEL' : 'GEMINI_IMAGE_MODEL';
  let configuredModel = isOpenAI ? 'gpt-image-2' : 'gemini-3.1-flash-image-preview';
  try {
    const env = JSON.parse(provider.extra_env || '{}');
    if (typeof env[envKey] === 'string' && env[envKey]) configuredModel = env[envKey];
  } catch { /* fall through to default */ }

  // Walk every preset under this protocol — covers both the official preset
  // and the *-thirdparty variant (same defaultModels list, different baseUrl).
  const presetKeys = isOpenAI
    ? ['openai-image', 'openai-image-thirdparty']
    : ['gemini-image', 'gemini-image-thirdparty'];
  for (const key of presetKeys) {
    const preset = getPreset(key);
    const match = preset?.defaultModels.find(m => m.modelId === configuredModel);
    if (match) return { model: configuredModel, modelLabel: match.displayName };
  }
  return { model: configuredModel, modelLabel: configuredModel };
}

/**
 * GET /api/providers/active-image
 * Returns the id of the provider currently marked active for image generation,
 * plus a `stale: true` flag when the stored id no longer resolves to a usable
 * media provider (deleted row, non-media type, or empty api_key). Callers that
 * render a UI badge can downgrade the badge in the stale case instead of
 * showing a provider as "active" while generation silently falls back.
 */
export async function GET() {
  const id = getSetting('active_image_provider_id') || '';
  if (!id) return NextResponse.json({ providerId: '', stale: false });

  // Grok Build is an OAuth-backed virtual media provider, not a row in the
  // API providers table. Keep it in the same active-image setting so the
  // settings badge and the actual generator resolve one canonical choice.
  if (id === XAI_OAUTH_MEDIA_PROVIDER_ID) {
    return NextResponse.json(xaiOAuthMediaInfo(!isXaiOAuthUsable()));
  }

  const provider = getProvider(id);
  const isMedia = !!provider
    && (provider.provider_type === 'gemini-image' || provider.provider_type === 'openai-image');
  const hasKey = !!provider?.api_key;
  const stale = !provider || !isMedia || !hasKey;

  // When the active row is still a healthy media provider, include the
  // resolved model + friendly label so the image-gen UI can display them
  // inline (the Design Agent card needs this to answer "what will run?"
  // without a second round trip).
  if (provider && isMedia) {
    const { model, modelLabel } = resolveModelForProvider(provider);
    return NextResponse.json({
      providerId: id,
      stale,
      providerName: provider.name,
      providerType: provider.provider_type,
      family: provider.provider_type === 'openai-image' ? 'openai' : 'gemini',
      model,
      modelLabel,
    });
  }
  return NextResponse.json({ providerId: id, stale });
}

/**
 * PUT /api/providers/active-image
 * Body: { providerId: string }  (empty string clears the setting)
 *
 * Validates that the provider exists, is a media provider, AND has an api_key
 * before saving. Blocking empty-key rows avoids the "looks active in the UI
 * but generateSingleImage cannot authenticate" inconsistency. The generator
 * reads through getAllProviders() so encrypted-at-rest credentials work too.
 */
export async function PUT(request: NextRequest) {
  try {
    const { providerId } = (await request.json()) as { providerId?: string };
    if (typeof providerId !== 'string') {
      return NextResponse.json({ error: 'providerId must be a string' }, { status: 400 });
    }

    if (providerId === '') {
      setSetting('active_image_provider_id', '');
      return NextResponse.json({ providerId: '', stale: false });
    }

    if (providerId === XAI_OAUTH_MEDIA_PROVIDER_ID) {
      if (!isXaiOAuthUsable()) {
        return NextResponse.json(
          {
            error: 'Grok Build OAuth is not usable. Sign in again before setting it as the image-generation default.',
            code: 'GROK_BUILD_OAUTH_REQUIRED',
          },
          { status: 401 },
        );
      }
      setSetting('active_image_provider_id', providerId);
      return NextResponse.json(xaiOAuthMediaInfo(false));
    }

    const provider = getProvider(providerId);
    if (!provider) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 });
    }
    if (provider.provider_type !== 'gemini-image' && provider.provider_type !== 'openai-image') {
      return NextResponse.json(
        { error: 'Only media providers (gemini-image, openai-image) can be marked active for images.' },
        { status: 400 },
      );
    }
    if (!provider.api_key) {
      return NextResponse.json(
        {
          error: 'This provider has no API key configured. Enter a key first, then mark it as the image-generation default.',
          code: 'MISSING_API_KEY',
        },
        { status: 400 },
      );
    }

    setSetting('active_image_provider_id', providerId);
    return NextResponse.json({ providerId, stale: false });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update active image provider' },
      { status: 500 },
    );
  }
}
