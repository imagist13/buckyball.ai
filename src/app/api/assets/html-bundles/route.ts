import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/db';
import { resolveRuntimeForSession } from '@/lib/chat-runtime';
import {
  getHtmlBundlePreviewLocation,
  getHtmlBundleThumbnailPath,
  materializeHtmlBundle,
} from '@/lib/assets/html-bundle-materializer';
import { buildHtmlPreviewUrl } from '@/lib/html-preview-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface HtmlBundleRequest {
  sessionId?: unknown;
  source?: unknown;
  html?: unknown;
  filePath?: unknown;
  prompt?: unknown;
  methodRef?: unknown;
  parentAssetIds?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as HtmlBundleRequest;
    if (typeof body.sessionId !== 'string' || !body.sessionId) {
      return NextResponse.json(
        { error: 'A real sessionId is required.', code: 'session_required' },
        { status: 400 },
      );
    }
    const session = getSession(body.sessionId);
    if (!session || !session.working_directory) {
      return NextResponse.json(
        { error: 'Session workspace not found.', code: 'session_not_found' },
        { status: 404 },
      );
    }
    const parentAssetIds = Array.isArray(body.parentAssetIds)
      ? body.parentAssetIds.filter(
        (value): value is string => typeof value === 'string' && !!value,
      )
      : [];
    const common = {
      terminalState: 'completed' as const,
      sessionId: session.id,
      projectId: session.project_name || session.working_directory,
      runtimeId: resolveRuntimeForSession(session),
      providerId: session.provider_id || '',
      modelId: session.model || '',
      prompt: typeof body.prompt === 'string' ? body.prompt : '',
      methodRef: typeof body.methodRef === 'string' ? body.methodRef : '',
      parentAssetIds,
    };
    const asset = body.source === 'inline'
      ? materializeHtmlBundle({
        ...common,
        source: {
          kind: 'inline',
          html: typeof body.html === 'string' ? body.html : '',
        },
      })
      : materializeHtmlBundle({
        ...common,
        source: {
          kind: 'workspace',
          sourceDir:
            typeof body.filePath === 'string'
              ? path.dirname(body.filePath)
              : '',
          entryFile:
            typeof body.filePath === 'string'
              ? path.basename(body.filePath)
              : '',
          scopeRoot: session.working_directory,
        },
      });
    const previewLocation = getHtmlBundlePreviewLocation(asset);
    const thumbnailPath = getHtmlBundleThumbnailPath(asset);

    return NextResponse.json({
      asset: {
        id: asset.id,
        kind: asset.kind,
        contentHash: asset.content_hash,
        lifecycleState: asset.lifecycle_state,
        integrityState: asset.integrity_state,
        previewUrl: buildHtmlPreviewUrl(
          previewLocation.entryPath,
          { kind: 'workspace', baseDir: previewLocation.bundleRoot },
        ),
        thumbnailUrl: thumbnailPath
          ? `/api/assets/${encodeURIComponent(asset.id)}/thumbnail`
          : undefined,
      },
    });
  } catch (error) {
    console.warn(
      '[assets/html-bundles] materialization rejected:',
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to archive HTML bundle.',
        code: 'materialization_failed',
      },
      { status: 400 },
    );
  }
}
