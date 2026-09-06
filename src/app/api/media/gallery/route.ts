import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '@/lib/db';
import { backfillMediaAssets } from '@/lib/assets/service';
import { getAssetKind } from '@/lib/assets/kind-registry';
import { getMediaDir } from '@/lib/media-saver';
import {
  getHtmlBundleDisplayTitle,
  getHtmlBundlePreviewLocation,
  getHtmlBundleThumbnailPath,
} from '@/lib/assets/html-bundle-materializer';
import { buildHtmlPreviewUrl } from '@/lib/html-preview-url';
import type { AssetRecord } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AssetGalleryRow extends AssetRecord {
  media_provider: string | null;
  media_model: string | null;
  aspect_ratio: string | null;
  image_size: string | null;
  media_tags: string | null;
  favorited: number | null;
  media_metadata: string | null;
}

interface LegacyGalleryRow {
  id: string;
  type: string;
  status: string;
  provider: string;
  model: string;
  prompt: string;
  aspect_ratio: string;
  image_size: string;
  local_path: string;
  session_id: string | null;
  tags: string;
  metadata: string;
  favorited: number;
  error: string | null;
  created_at: string;
}

function safeArray(value: string | null): string[] {
  try {
    const parsed = JSON.parse(value || '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

function hasRenderableMediaMime(row: AssetGalleryRow): boolean {
  const extension = row.stable_path
    .slice(row.stable_path.lastIndexOf('.'))
    .toLowerCase();
  if (row.kind === 'image') {
    return row.mime_type.startsWith('image/')
      && ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp'].includes(extension);
  }
  if (row.kind === 'video') {
    return row.mime_type.startsWith('video/')
      && ['.mp4', '.webm', '.mov', '.m4v'].includes(extension);
  }
  if (row.kind === 'audio') {
    return row.mime_type.startsWith('audio/')
      && ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac'].includes(extension);
  }
  return false;
}

function legacyMimeType(row: LegacyGalleryRow): string {
  try {
    const metadata = JSON.parse(row.metadata || '{}') as { mimeType?: unknown };
    if (typeof metadata.mimeType === 'string') return metadata.mimeType;
  } catch {
    // Fall through to the extension map.
  }
  const extension = path.extname(row.local_path).toLowerCase();
  return {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.m4v': 'video/x-m4v',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
  }[extension] || '';
}

function inspectLegacyPreview(row: LegacyGalleryRow): {
  integrityState: 'valid' | 'missing' | 'modified';
  integrityReason: string;
  localPath?: string;
  mimeType: string;
} {
  const mimeType = legacyMimeType(row);
  if (row.status !== 'completed') {
    return {
      integrityState: 'modified',
      integrityReason:
        `Legacy generation status is "${row.status}". `
        + 'It was not promoted to a durable Asset.',
      mimeType,
    };
  }
  if (!row.local_path) {
    return {
      integrityState: 'missing',
      integrityReason: 'The legacy media file is missing.',
      mimeType,
    };
  }
  let resolved: string;
  try {
    // One syscall closes the former existsSync → realpathSync deletion race.
    resolved = fs.realpathSync.native(row.local_path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      integrityState: code === 'ENOENT' ? 'missing' : 'modified',
      integrityReason: code === 'ENOENT'
        ? 'The legacy media file is missing.'
        : 'The legacy media file could not be safely inspected.',
      mimeType,
    };
  }
  let mediaRoot: string;
  try {
    mediaRoot = fs.realpathSync.native(getMediaDir());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return {
        integrityState: 'modified',
        integrityReason: 'The Asset Library root could not be safely inspected.',
        mimeType,
      };
    }
    mediaRoot = path.resolve(getMediaDir());
  }
  if (
    resolved === mediaRoot
    || !resolved.startsWith(`${mediaRoot}${path.sep}`)
  ) {
    return {
      integrityState: 'modified',
      integrityReason:
        'This legacy record points outside the current Asset Library. '
        + 'The external file will not be loaded or deleted.',
      mimeType,
    };
  }
  const kindMatches = mimeType.startsWith(`${row.type}/`);
  if (!kindMatches) {
    return {
      integrityState: 'modified',
      integrityReason: `Legacy MIME type "${mimeType || 'unknown'}" does not match "${row.type}".`,
      mimeType,
    };
  }
  return {
    integrityState: 'valid',
    integrityReason: '',
    localPath: resolved,
    mimeType,
  };
}

function mapLegacyRow(row: LegacyGalleryRow) {
  const preview = inspectLegacyPreview(row);
  return {
    id: row.id,
    type: row.type,
    kind: row.type,
    producerId: 'legacy-media-unmaterialized',
    provider: row.provider || undefined,
    prompt: row.prompt || row.id,
    title: row.prompt || row.id,
    images: preview.localPath
      ? [{ mimeType: preview.mimeType, localPath: preview.localPath }]
      : [],
    model: row.model || undefined,
    aspectRatio: row.aspect_ratio || undefined,
    imageSize: row.image_size || undefined,
    tags: safeArray(row.tags),
    favorited: !!row.favorited,
    created_at: row.created_at,
    session_id: row.session_id || undefined,
    contentHash: '',
    integrityState: preview.integrityState,
    integrityReason: preview.integrityReason || row.error || undefined,
    trustTier: 'legacy_unmaterialized',
    generationStatus: row.status,
    legacyOnly: true,
  };
}

function mapRow(row: AssetGalleryRow) {
  const images: Array<{ mimeType: string; localPath: string }> = [];
  if (
    row.integrity_state === 'valid'
    && ['image', 'video', 'audio'].includes(row.kind)
    && hasRenderableMediaMime(row)
    && row.stable_path
  ) {
    images.push({
      mimeType: row.mime_type,
      localPath: row.stable_path,
    });
  }
  let referenceImages:
    | Array<{ mimeType: string; localPath: string }>
    | undefined;
  try {
    const metadata = JSON.parse(row.media_metadata || '{}') as {
      referenceImages?: unknown;
    };
    if (Array.isArray(metadata.referenceImages)) {
      referenceImages = metadata.referenceImages.filter(
        (entry): entry is { mimeType: string; localPath: string } => (
          !!entry
          && typeof entry === 'object'
          && typeof (entry as { mimeType?: unknown }).mimeType === 'string'
          && typeof (entry as { localPath?: unknown }).localPath === 'string'
        ),
      );
    }
  } catch {
    // Legacy malformed metadata remains visible without reference images.
  }
  let previewUrl: string | undefined;
  let thumbnailUrl: string | undefined;
  let title = row.prompt;
  if (row.kind === 'html_bundle') {
    try {
      title = getHtmlBundleDisplayTitle(row);
    } catch {
      title = row.prompt;
    }
  }
  if (row.kind === 'html_bundle' && row.integrity_state === 'valid') {
    try {
      const location = getHtmlBundlePreviewLocation(row);
      previewUrl = buildHtmlPreviewUrl(
        location.entryPath,
        { kind: 'workspace', baseDir: location.bundleRoot },
      );
      if (getHtmlBundleThumbnailPath(row)) {
        thumbnailUrl = `/api/assets/${encodeURIComponent(row.id)}/thumbnail`;
      }
    } catch {
      previewUrl = undefined;
      thumbnailUrl = undefined;
    }
  }
  const assetTags = safeArray(row.tags);
  let externalUrls: string[] | undefined;
  try {
    const metadata = JSON.parse(row.metadata || '{}') as {
      externalUrls?: unknown;
    };
    if (Array.isArray(metadata.externalUrls)) {
      externalUrls = metadata.externalUrls.filter(
        (entry): entry is string => typeof entry === 'string',
      );
    }
  } catch {
    externalUrls = undefined;
  }

  return {
    id: row.id,
    type: row.kind,
    kind: row.kind,
    producerId: row.producer_id,
    provider: row.provider_id || row.media_provider || undefined,
    prompt: row.prompt,
    title,
    images,
    previewUrl,
    thumbnailUrl,
    model: row.model_id || row.media_model || undefined,
    aspectRatio: row.aspect_ratio || undefined,
    imageSize: row.image_size || undefined,
    tags: assetTags.length > 0 ? assetTags : safeArray(row.media_tags),
    favorited: !!row.favorited || row.curation_state === 'selected',
    created_at: row.created_at,
    session_id: row.session_id || undefined,
    projectId: row.project_id || undefined,
    runtimeId: row.runtime_id || undefined,
    methodRef: row.method_ref || undefined,
    contentHash: row.content_hash,
    integrityState: row.integrity_state,
    integrityReason: row.integrity_reason || undefined,
    trustTier: row.trust_tier,
    externalUrls,
    referenceImages,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const tags = searchParams.get('tags');
    const favoritesOnly = searchParams.get('favoritesOnly') === '1';
    const sort = searchParams.get('sort') || 'newest';
    const kind = searchParams.get('kind');
    const query = searchParams.get('query')?.trim() || '';
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50),
    );
    const offset = Math.max(
      0,
      parseInt(searchParams.get('offset') || '0', 10) || 0,
    );
    if (kind && !getAssetKind(kind)) {
      return NextResponse.json(
        { error: `Asset kind "${kind}" is not registered.`, code: 'kind_unregistered' },
        { status: 400 },
      );
    }

    // Bounded on-read migration: old Gallery bytes remain untouched. Repeated
    // page loads continue the idempotent journal if a library is very large.
    backfillMediaAssets(100, {
      maxBytes: 32 * 1024 * 1024,
      maxSingleFileBytes: 32 * 1024 * 1024,
      maxDurationMs: 75,
    });

    const conditions = ["ar.lifecycle_state = 'active'"];
    const params: unknown[] = [];
    if (favoritesOnly) {
      conditions.push(
        `COALESCE(
           mg.favorited,
           CASE WHEN ar.curation_state = 'selected' THEN 1 ELSE 0 END
         ) = 1`,
      );
    }
    if (kind) {
      conditions.push('ar.kind = ?');
      params.push(kind);
    }
    if (query) {
      const search = `%${query}%`;
      conditions.push(
        `(ar.prompt LIKE ? OR ar.project_id LIKE ? OR ar.provider_id LIKE ?
          OR ar.model_id LIKE ? OR ar.method_ref LIKE ? OR ar.producer_id LIKE ?
          OR ar.metadata LIKE ? OR EXISTS (
            SELECT 1
            FROM json_each(COALESCE(ar.tags, '[]')) query_tag
            WHERE query_tag.value LIKE ?
          ))`,
      );
      params.push(
        search,
        search,
        search,
        search,
        search,
        search,
        search,
        search,
      );
    }
    const tagList = tags
      ? tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      : [];
    if (tagList.length > 0) {
      const placeholders = tagList.map(() => '?').join(', ');
      conditions.push(
        `EXISTS (
           SELECT 1 FROM json_each(COALESCE(ar.tags, '[]')) asset_tag
           WHERE asset_tag.value IN (${placeholders})
         )`,
      );
      params.push(...tagList);
    }
    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const orderDirection = sort === 'oldest' ? 'ASC' : 'DESC';
    const fromClause = `
      FROM asset_records ar
      LEFT JOIN media_generations mg
        ON mg.id = ar.source_media_generation_id
    `;
    const countResult = getDb().prepare(
      `SELECT COUNT(*) AS total ${fromClause} ${whereClause}`,
    ).get(...params) as { total: number };
    const fetchLimit = offset + limit;
    const rows = getDb().prepare(
      `SELECT
         ar.*,
         mg.provider AS media_provider,
         mg.model AS media_model,
         mg.aspect_ratio,
         mg.image_size,
         mg.tags AS media_tags,
         mg.favorited,
         mg.metadata AS media_metadata
       ${fromClause}
       ${whereClause}
       ORDER BY ar.created_at ${orderDirection}, ar.id ${orderDirection}
       LIMIT ?`,
    ).all(...params, fetchLimit) as AssetGalleryRow[];

    const legacyConditions = [
      'ar.id IS NULL',
      "mg.type IN ('image','video','audio')",
    ];
    const legacyParams: unknown[] = [];
    if (favoritesOnly) {
      legacyConditions.push('mg.favorited = 1');
    }
    if (kind) {
      legacyConditions.push('mg.type = ?');
      legacyParams.push(kind);
    }
    if (query) {
      const search = `%${query}%`;
      legacyConditions.push(
        `(mg.id LIKE ? OR mg.prompt LIKE ? OR mg.provider LIKE ?
          OR mg.model LIKE ? OR mg.metadata LIKE ? OR EXISTS (
            SELECT 1 FROM json_each(
              CASE WHEN json_valid(mg.tags) THEN mg.tags ELSE '[]' END
            ) legacy_query_tag
            WHERE legacy_query_tag.value LIKE ?
          ))`,
      );
      legacyParams.push(search, search, search, search, search, search);
    }
    if (tagList.length > 0) {
      const placeholders = tagList.map(() => '?').join(', ');
      legacyConditions.push(
        `EXISTS (
           SELECT 1 FROM json_each(
             CASE WHEN json_valid(mg.tags) THEN mg.tags ELSE '[]' END
           ) legacy_asset_tag
           WHERE legacy_asset_tag.value IN (${placeholders})
         )`,
      );
      legacyParams.push(...tagList);
    }
    const legacyFrom = `
      FROM media_generations mg
      LEFT JOIN asset_records ar
        ON ar.source_media_generation_id = mg.id
    `;
    const legacyWhere = `WHERE ${legacyConditions.join(' AND ')}`;
    const legacyCount = getDb().prepare(
      `SELECT COUNT(*) AS total ${legacyFrom} ${legacyWhere}`,
    ).get(...legacyParams) as { total: number };
    const legacyRows = getDb().prepare(
      `SELECT
         mg.id, mg.type, mg.status, mg.provider, mg.model, mg.prompt,
         mg.aspect_ratio, mg.image_size, mg.local_path, mg.session_id,
         mg.tags, mg.metadata, mg.favorited, mg.error, mg.created_at
       ${legacyFrom}
       ${legacyWhere}
       ORDER BY mg.created_at ${orderDirection}, mg.id ${orderDirection}
       LIMIT ?`,
    ).all(...legacyParams, fetchLimit) as LegacyGalleryRow[];

    const direction = orderDirection === 'ASC' ? 1 : -1;
    const items = [
      ...rows.map(mapRow),
      ...legacyRows.map(mapLegacyRow),
    ].sort((left, right) => {
      const leftTime = Date.parse(left.created_at);
      const rightTime = Date.parse(right.created_at);
      const timeDiff = (
        Number.isFinite(leftTime) && Number.isFinite(rightTime)
          ? leftTime - rightTime
          : left.created_at.localeCompare(right.created_at)
      );
      if (timeDiff !== 0) return timeDiff * direction;
      return left.id.localeCompare(right.id) * direction;
    }).slice(offset, offset + limit);

    return NextResponse.json({
      items,
      total: countResult.total + legacyCount.total,
    });
  } catch (error) {
    console.error('[media/gallery] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch Asset Library' },
      { status: 500 },
    );
  }
}
