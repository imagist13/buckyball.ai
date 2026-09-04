import { NextRequest } from 'next/server';
import { generateSingleImage, NoImageGeneratedError } from '@/lib/image-generator';

interface GenerateRequest {
  prompt: string;
  model?: string;
  /** Optional explicit provider row id; overrides the model-family + active-setting fallback chain. */
  providerId?: string;
  aspectRatio?: string;
  imageSize?: string;
  referenceImages?: { mimeType: string; data: string }[];
  referenceImagePaths?: string[];
  sessionId?: string;
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  // bbagent Phase 7 — imageGeneration feature flag off → 410 Gone
  // 旧数据保留（db 表不动），但 API 入口关闭，避免上游用户
  // 通过老 API 路径绕过 UI 隐藏。
  try {
    const { isBbFeatureEnabled } = await import('@/lib/bbagent/features');
    if (!isBbFeatureEnabled('imageGeneration')) {
      return new Response(
        JSON.stringify({
          error: 'imageGeneration feature is disabled in buckyball.ai',
          disabled: true,
        }),
        { status: 410, headers: { 'Content-Type': 'application/json' } }
      );
    }
  } catch {
    // bbagent import 失败 = 二开层挂了，按"feature 默认关闭"处理
    return new Response(
      JSON.stringify({ error: 'feature flag unavailable', disabled: true }),
      { status: 410, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body: GenerateRequest = await request.json();

    if (!body.prompt) {
      return new Response(
        JSON.stringify({ error: 'Missing required field: prompt' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const result = await generateSingleImage({
      prompt: body.prompt,
      model: body.model,
      providerId: body.providerId,
      aspectRatio: body.aspectRatio,
      imageSize: body.imageSize,
      referenceImages: body.referenceImages,
      referenceImagePaths: body.referenceImagePaths,
      sessionId: body.sessionId,
      abortSignal: request.signal,
    });

    return new Response(
      JSON.stringify({
        id: result.mediaGenerationId,
        text: '',
        images: result.images,
        model: result.model,
        family: result.family,
        imageSize: body.imageSize || '1K',
        elapsedMs: result.elapsedMs,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[media/generate] Failed:', error);

    if (NoImageGeneratedError.isInstance(error)) {
      return new Response(
        JSON.stringify({ error: 'No images were generated. Try a different prompt.' }),
        { status: 422, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const message = error instanceof Error ? error.message : 'Failed to generate image';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
