import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb } from '@/lib/db';
import type {
  AssetIntegrityState,
  AssetLineageRecord,
  AssetLineageRelation,
  AssetRecord,
  AssetReferenceRecord,
} from '@/types';
import {
  assertRegisteredAssetProducer,
  getAssetKind,
  requireAssetKind,
} from './kind-registry';
import { inspectHtmlBundle } from './html-bundle-security';

interface MediaGenerationRow {
  id: string;
  type: string;
  status: string;
  provider: string;
  model: string;
  prompt: string;
  local_path: string;
  thumbnail_path: string;
  session_id: string | null;
  message_id: string | null;
  tags: string;
  metadata: string;
  created_at: string;
}

export interface AssetConsumer {
  readonly type: 'asset_lineage' | 'reference';
  readonly id: string;
  readonly label: string;
}

export class AssetInUseError extends Error {
  readonly consumers: readonly AssetConsumer[];

  constructor(assetId: string, consumers: readonly AssetConsumer[]) {
    super(
      `Asset "${assetId}" has ${consumers.length} active consumer(s) and `
      + 'cannot be deleted until they are released.',
    );
    this.name = 'AssetInUseError';
    this.consumers = consumers;
  }
}

function canonicalMediaDir(): string {
  const dataDir =
    process.env.CLAUDE_GUI_DATA_DIR
    || path.join(os.homedir(), '.codepilot');
  return path.resolve(dataDir, '.codepilot-media');
}

function canonicalAssetsDir(): string {
  const dataDir =
    process.env.CLAUDE_GUI_DATA_DIR
    || path.join(os.homedir(), '.codepilot');
  return path.resolve(dataDir, '.codepilot-assets');
}

function safeJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

const MAX_ASSET_TAGS = 20;
const MAX_ASSET_TAG_LENGTH = 32;

export function normalizeAssetTags(tags: readonly string[]): string[] {
  if (tags.length > MAX_ASSET_TAGS) {
    throw new Error(`An Asset can have at most ${MAX_ASSET_TAGS} tags.`);
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const rawTag of tags) {
    if (typeof rawTag !== 'string') {
      throw new Error('Every Asset tag must be a string.');
    }
    const tag = rawTag.normalize('NFKC').trim();
    if (!tag) throw new Error('Asset tags cannot be empty.');
    if (tag.length > MAX_ASSET_TAG_LENGTH) {
      throw new Error(
        `Asset tags can contain at most ${MAX_ASSET_TAG_LENGTH} characters.`,
      );
    }
    if (/[\u0000-\u001f\u007f,]/u.test(tag)) {
      throw new Error('Asset tags cannot contain control characters or commas.');
    }
    const key = tag.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(tag);
  }
  return normalized;
}

export function parseStoredAssetTags(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    const salvaged: string[] = [];
    const seen = new Set<string>();
    for (const entry of parsed) {
      if (typeof entry !== 'string') continue;
      try {
        const [tag] = normalizeAssetTags([entry]);
        const key = tag.toLocaleLowerCase('en-US');
        if (!seen.has(key)) {
          seen.add(key);
          salvaged.push(tag);
        }
      } catch {
        // Migration is per-item conservative: one legacy comma/control/long
        // tag must not erase every valid tag stored beside it.
      }
      if (salvaged.length >= MAX_ASSET_TAGS) break;
    }
    return salvaged;
  } catch {
    return [];
  }
}

const EXTENSION_MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
};

function inferMimeType(row: MediaGenerationRow): string {
  const metadata = safeJsonObject(row.metadata);
  if (typeof metadata.mimeType === 'string' && metadata.mimeType) {
    return metadata.mimeType;
  }
  return EXTENSION_MIME[path.extname(row.local_path).toLowerCase()] || '';
}

function hashFile(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const file = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let offset = 0;
    while (true) {
      const bytesRead = fs.readSync(file, buffer, 0, buffer.length, offset);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
  } finally {
    fs.closeSync(file);
  }
  return `sha256:${hash.digest('hex')}`;
}

function inspectMediaFile(
  filePath: string,
  kind: string,
  mimeType: string,
): {
  stablePath: string;
  contentHash: string;
  byteSize: number;
  integrityState: AssetIntegrityState;
  integrityReason: string;
} {
  if (!filePath) {
    return {
      stablePath: '',
      contentHash: '',
      byteSize: 0,
      integrityState: 'missing',
      integrityReason: 'Legacy media row has no local_path.',
    };
  }
  const resolved = path.resolve(filePath);
  const mediaDir = canonicalMediaDir();
  if (
    resolved !== mediaDir
    && !resolved.startsWith(`${mediaDir}${path.sep}`)
  ) {
    throw new Error(
      `Asset path "${resolved}" is outside the canonical media directory.`,
    );
  }
  if (!fs.existsSync(resolved)) {
    return {
      stablePath: resolved,
      contentHash: '',
      byteSize: 0,
      integrityState: 'missing',
      integrityReason: 'The source media file is missing.',
    };
  }
  const realPath = fs.realpathSync.native(resolved);
  const realMediaDir = fs.existsSync(mediaDir)
    ? fs.realpathSync.native(mediaDir)
    : mediaDir;
  if (
    realPath !== realMediaDir
    && !realPath.startsWith(`${realMediaDir}${path.sep}`)
  ) {
    throw new Error('Asset path escapes the canonical media directory via symlink.');
  }
  if (!mimeType.startsWith(`${kind}/`)) {
    throw new Error(
      `Asset kind "${kind}" does not match MIME type "${mimeType || 'unknown'}".`,
    );
  }
  const stat = fs.statSync(realPath);
  if (!stat.isFile()) throw new Error('Asset stable path must be a file.');
  return {
    stablePath: realPath,
    contentHash: hashFile(realPath),
    byteSize: stat.size,
    integrityState: 'valid',
    integrityReason: '',
  };
}

function mediaRow(id: string): MediaGenerationRow | undefined {
  return getDb().prepare(
    `SELECT id, type, status, provider, model, prompt, local_path,
            thumbnail_path, session_id, message_id, tags, metadata, created_at
     FROM media_generations WHERE id = ?`,
  ).get(id) as MediaGenerationRow | undefined;
}

function projectIdForSession(sessionId: string | null): string {
  if (!sessionId) return '';
  const row = getDb().prepare(
    'SELECT project_name, working_directory FROM chat_sessions WHERE id = ?',
  ).get(sessionId) as {
    project_name?: string;
    working_directory?: string;
  } | undefined;
  return row?.project_name || row?.working_directory || '';
}

export function getAssetRecord(id: string): AssetRecord | undefined {
  return getDb().prepare(
    'SELECT * FROM asset_records WHERE id = ?',
  ).get(id) as AssetRecord | undefined;
}

export function setAssetTags(
  assetId: string,
  tags: readonly string[],
): readonly string[] {
  const asset = getAssetRecord(assetId);
  if (!asset || asset.lifecycle_state !== 'active') {
    throw new Error(`Active Asset "${assetId}" does not exist.`);
  }
  const normalized = normalizeAssetTags(tags);
  const encoded = JSON.stringify(normalized);
  getDb().transaction(() => {
    getDb().prepare(
      `UPDATE asset_records
       SET tags = ?, updated_at = datetime('now')
       WHERE id = ? AND lifecycle_state = 'active'`,
    ).run(encoded, assetId);
    if (asset.source_media_generation_id) {
      getDb().prepare(
        'UPDATE media_generations SET tags = ? WHERE id = ?',
      ).run(encoded, asset.source_media_generation_id);
    }
  })();
  return normalized;
}

export function findActiveAssetIdsByStablePaths(
  filePaths: readonly string[],
): readonly string[] {
  const normalized = Array.from(new Set(filePaths.map((filePath) => {
    const resolved = path.resolve(filePath);
    return fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
  })));
  if (normalized.length === 0) return [];
  const placeholders = normalized.map(() => '?').join(', ');
  const rows = getDb().prepare(
    `SELECT id, stable_path FROM asset_records
     WHERE lifecycle_state = 'active'
       AND integrity_state = 'valid'
       AND stable_path IN (${placeholders})`,
  ).all(...normalized) as { id: string; stable_path: string }[];
  const idByPath = new Map(rows.map((row) => [row.stable_path, row.id]));
  return normalized
    .map((stablePath) => idByPath.get(stablePath))
    .filter((id): id is string => !!id);
}

export function registerMediaGenerationAsset(input: {
  readonly mediaGenerationId: string;
  readonly producerId: string;
  readonly runtimeId?: string;
  readonly methodRef?: string;
  readonly parentAssetIds?: readonly string[];
  readonly allowMissing?: boolean;
}): AssetRecord {
  const row = mediaRow(input.mediaGenerationId);
  if (!row) {
    throw new Error(
      `Media generation "${input.mediaGenerationId}" does not exist.`,
    );
  }
  if (row.status !== 'completed') {
    throw new Error(
      `Media generation "${row.id}" is "${row.status}", not completed.`,
    );
  }
  const descriptor = assertRegisteredAssetProducer(row.type, input.producerId);
  const mimeType = inferMimeType(row);
  const file = inspectMediaFile(row.local_path, descriptor.id, mimeType);
  if (file.integrityState !== 'valid' && !input.allowMissing) {
    throw new Error(file.integrityReason);
  }
  const existing = getAssetRecord(row.id);
  if (existing) {
    if (
      existing.stable_path !== file.stablePath
      || (
        existing.content_hash
        && file.contentHash
        && existing.content_hash !== file.contentHash
      )
    ) {
      getDb().prepare(
        `UPDATE asset_records
         SET integrity_state = 'modified',
             integrity_reason = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
      ).run(
        'Source bytes/path no longer match the registered Asset identity.',
        existing.id,
      );
    } else if (
      existing.integrity_state !== file.integrityState
      || existing.integrity_reason !== file.integrityReason
    ) {
      getDb().prepare(
        `UPDATE asset_records
         SET integrity_state = ?, integrity_reason = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
      ).run(file.integrityState, file.integrityReason, existing.id);
    }
    return getAssetRecord(row.id)!;
  }

  const metadata = safeJsonObject(row.metadata);
  const runtimeId =
    input.runtimeId
    || (typeof metadata.runtimeId === 'string' ? metadata.runtimeId : '');
  const providerId =
    typeof metadata.providerId === 'string'
      ? metadata.providerId
      : row.provider;
  const now = new Date().toISOString();
  getDb().transaction(() => {
    getDb().prepare(
      `INSERT INTO asset_records (
         id, kind, producer_id, stable_path, content_hash, mime_type,
         byte_size, preview_path, project_id, session_id, message_id,
         runtime_id, provider_id, model_id, prompt, method_ref,
         trust_tier, source_scope, tags, lifecycle_state, integrity_state,
         integrity_reason, metadata, source_media_generation_id,
         created_at, updated_at
       ) VALUES (
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, 'active', ?, ?, ?, ?, ?, ?
       )`,
    ).run(
      row.id,
      descriptor.id,
      input.producerId,
      file.stablePath,
      file.contentHash,
      mimeType,
      file.byteSize,
      row.thumbnail_path || '',
      projectIdForSession(row.session_id),
      row.session_id,
      row.message_id,
      runtimeId,
      providerId,
      row.model,
      row.prompt,
      input.methodRef || (
        typeof metadata.methodRef === 'string' ? metadata.methodRef : ''
      ),
      'local_generated',
      canonicalMediaDir(),
      JSON.stringify(parseStoredAssetTags(row.tags)),
      file.integrityState,
      file.integrityReason,
      JSON.stringify({
        sourceProvider: row.provider,
        legacyMetadata: metadata,
      }),
      row.id,
      row.created_at || now,
      now,
    );
    for (const parentAssetId of input.parentAssetIds ?? []) {
      addAssetLineage({
        parentAssetId,
        childAssetId: row.id,
        relation: 'derived_from',
      });
    }
  })();
  return getAssetRecord(row.id)!;
}

export interface AssetBackfillResult {
  readonly scanned: number;
  readonly created: number;
  readonly missing: number;
  readonly skipped: number;
  readonly deferred: number;
  readonly remaining: number;
}

export interface AssetBackfillBudget {
  readonly maxBytes?: number;
  readonly maxSingleFileBytes?: number;
  readonly maxDurationMs?: number;
}

const ASSET_BACKFILL_FAILURE_REVISION = 'media-assets-v2';
const TRANSIENT_BACKFILL_CODES = new Set([
  'EAGAIN',
  'EBUSY',
  'EIO',
  'EMFILE',
  'ENFILE',
  'ETIMEDOUT',
]);

export function classifyAssetBackfillError(error: unknown): {
  kind: 'permanent' | 'transient';
  message: string;
} {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return {
    kind: code && TRANSIENT_BACKFILL_CODES.has(code)
      ? 'transient'
      : 'permanent',
    message: error instanceof Error ? error.message : String(error),
  };
}

function recordBackfillFailure(
  sourceId: string,
  kind: 'permanent' | 'transient' | 'deferred',
  error: string,
): void {
  getDb().prepare(
    `INSERT INTO asset_backfill_failures (
       source_table, source_id, failure_revision, error
     ) VALUES ('media_generations', ?, ?, ?)
     ON CONFLICT(source_table, source_id) DO UPDATE SET
       failure_revision = excluded.failure_revision,
       error = excluded.error,
       attempt_count = asset_backfill_failures.attempt_count + 1,
       last_failed_at = datetime('now')`,
  ).run(
    sourceId,
    ASSET_BACKFILL_FAILURE_REVISION,
    `${kind}: ${error}`,
  );
}

function backfillSourceByteSize(localPath: string): number {
  if (!localPath) return 0;
  const resolved = path.resolve(localPath);
  const mediaDir = canonicalMediaDir();
  if (resolved !== mediaDir && !resolved.startsWith(`${mediaDir}${path.sep}`)) {
    return 0;
  }
  try {
    const stat = fs.lstatSync(resolved);
    return stat.isFile() ? stat.size : 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

export function backfillMediaAssets(
  limit = 100,
  budget: AssetBackfillBudget = {},
): AssetBackfillResult {
  const retryDeferred = budget.maxBytes === undefined
    && budget.maxSingleFileBytes === undefined
    && budget.maxDurationMs === undefined;
  const rows = getDb().prepare(
    `SELECT mg.id, mg.type, mg.local_path
     FROM media_generations mg
     LEFT JOIN asset_records ar ON ar.source_media_generation_id = mg.id
     LEFT JOIN asset_backfill_failures abf
       ON abf.source_table = 'media_generations'
      AND abf.source_id = mg.id
      AND abf.failure_revision = ?
     WHERE ar.id IS NULL AND mg.status = 'completed'
       AND mg.type IN ('image','video','audio')
       AND (
         abf.source_id IS NULL
         OR (
           abf.error LIKE 'transient:%'
           AND abf.last_failed_at <= datetime('now', '-30 seconds')
         )
         OR (? = 1 AND abf.error LIKE 'deferred:%')
       )
     ORDER BY mg.created_at ASC
     LIMIT ?`,
  ).all(ASSET_BACKFILL_FAILURE_REVISION, retryDeferred ? 1 : 0, limit) as {
    id: string;
    type: string;
    local_path: string;
  }[];
  const startedAt = Date.now();
  const maxBytes = budget.maxBytes ?? Number.POSITIVE_INFINITY;
  const maxSingleFileBytes = budget.maxSingleFileBytes ?? maxBytes;
  const maxDurationMs = budget.maxDurationMs ?? Number.POSITIVE_INFINITY;
  let scanned = 0;
  let inspectedBytes = 0;
  let created = 0;
  let missing = 0;
  let skipped = 0;
  let deferred = 0;
  let lastError = '';
  for (const row of rows) {
    if (scanned > 0 && Date.now() - startedAt >= maxDurationMs) break;
    let sourceBytes: number;
    try {
      sourceBytes = backfillSourceByteSize(row.local_path);
    } catch (error) {
      scanned++;
      skipped++;
      const failure = classifyAssetBackfillError(error);
      lastError = failure.message;
      recordBackfillFailure(row.id, failure.kind, failure.message);
      continue;
    }
    if (sourceBytes > maxSingleFileBytes || (scanned === 0 && sourceBytes > maxBytes)) {
      scanned++;
      skipped++;
      deferred++;
      lastError = `Source file is ${sourceBytes} bytes, above the inline backfill budget.`;
      recordBackfillFailure(row.id, 'deferred', lastError);
      continue;
    }
    if (inspectedBytes + sourceBytes > maxBytes) break;
    scanned++;
    inspectedBytes += sourceBytes;
    if (!getAssetKind(row.type)) {
      skipped++;
      recordBackfillFailure(
        row.id,
        'permanent',
        `Asset kind "${row.type}" is not registered.`,
      );
      continue;
    }
    try {
      const asset = registerMediaGenerationAsset({
        mediaGenerationId: row.id,
        producerId: 'legacy-media-backfill',
        allowMissing: true,
      });
      created++;
      if (asset.integrity_state === 'missing') missing++;
      getDb().prepare(
        `DELETE FROM asset_backfill_failures
         WHERE source_table = 'media_generations' AND source_id = ?`,
      ).run(row.id);
    } catch (error) {
      skipped++;
      const failure = classifyAssetBackfillError(error);
      lastError = failure.message;
      recordBackfillFailure(row.id, failure.kind, failure.message);
    }
  }
  const remaining = (
    getDb().prepare(
      `SELECT COUNT(*) AS count
       FROM media_generations mg
       LEFT JOIN asset_records ar ON ar.source_media_generation_id = mg.id
       LEFT JOIN asset_backfill_failures abf
         ON abf.source_table = 'media_generations'
        AND abf.source_id = mg.id
        AND abf.failure_revision = ?
       WHERE ar.id IS NULL AND mg.status = 'completed'
         AND mg.type IN ('image','video','audio')
         AND (
           abf.source_id IS NULL
           OR abf.error LIKE 'transient:%'
           OR abf.error LIKE 'deferred:%'
         )`,
    ).get(ASSET_BACKFILL_FAILURE_REVISION) as { count: number }
  ).count;
  const previous = getDb().prepare(
    'SELECT * FROM asset_backfill_state WHERE source_table = ?',
  ).get('media_generations') as {
    scanned_count: number;
    created_count: number;
    missing_count: number;
    skipped_count: number;
  } | undefined;
  getDb().prepare(
    `INSERT INTO asset_backfill_state (
       source_table, scanned_count, created_count, missing_count,
       skipped_count, last_error, last_run_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(source_table) DO UPDATE SET
       scanned_count = excluded.scanned_count,
       created_count = excluded.created_count,
       missing_count = excluded.missing_count,
       skipped_count = excluded.skipped_count,
       last_error = excluded.last_error,
       last_run_at = excluded.last_run_at,
       completed_at = excluded.completed_at`,
  ).run(
    'media_generations',
    (previous?.scanned_count ?? 0) + scanned,
    (previous?.created_count ?? 0) + created,
    (previous?.missing_count ?? 0) + missing,
    (previous?.skipped_count ?? 0) + skipped,
    lastError,
    remaining === 0 ? new Date().toISOString() : null,
  );
  return {
    scanned,
    created,
    missing,
    skipped,
    deferred,
    remaining,
  };
}

export function reconcileAssetIntegrity(assetId: string): AssetRecord {
  const asset = getAssetRecord(assetId);
  if (!asset) throw new Error(`Asset "${assetId}" does not exist.`);
  requireAssetKind(asset.kind);
  if (!asset.stable_path || !fs.existsSync(asset.stable_path)) {
    getDb().prepare(
      `UPDATE asset_records
       SET integrity_state = 'missing', integrity_reason = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
    ).run('The Asset file is missing.', assetId);
    return getAssetRecord(assetId)!;
  }
  let currentHash: string;
  try {
    if (asset.kind === 'html_bundle') {
      const metadata = safeJsonObject(asset.metadata);
      if (typeof metadata.bundleRoot !== 'string') {
        throw new Error('The HTML bundle root is missing from provenance.');
      }
      const bundleRoot = path.resolve(metadata.bundleRoot);
      const assetRoot = canonicalAssetsDir();
      if (
        bundleRoot !== assetRoot
        && !bundleRoot.startsWith(`${assetRoot}${path.sep}`)
      ) {
        throw new Error('The HTML bundle root is outside the Asset Library.');
      }
      const entryFile = path.relative(
        bundleRoot,
        asset.stable_path,
      );
      currentHash = inspectHtmlBundle(
        bundleRoot,
        entryFile,
      ).contentHash;
    } else {
      currentHash = hashFile(asset.stable_path);
    }
  } catch (error) {
    getDb().prepare(
      `UPDATE asset_records
       SET integrity_state = 'modified', integrity_reason = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      error instanceof Error ? error.message : String(error),
      assetId,
    );
    return getAssetRecord(assetId)!;
  }
  const state: AssetIntegrityState =
    currentHash === asset.content_hash ? 'valid' : 'modified';
  getDb().prepare(
    `UPDATE asset_records
     SET integrity_state = ?, integrity_reason = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    state,
    state === 'valid' ? '' : 'The Asset bytes no longer match content_hash.',
    assetId,
  );
  return getAssetRecord(assetId)!;
}

function wouldCreateLineageCycle(parentId: string, childId: string): boolean {
  const row = getDb().prepare(
    `WITH RECURSIVE descendants(id) AS (
       SELECT child_asset_id FROM asset_lineage WHERE parent_asset_id = ?
       UNION
       SELECT al.child_asset_id
       FROM asset_lineage al
       JOIN descendants d ON al.parent_asset_id = d.id
     )
     SELECT 1 AS found FROM descendants WHERE id = ? LIMIT 1`,
  ).get(childId, parentId) as { found: number } | undefined;
  return !!row;
}

export function addAssetLineage(input: {
  readonly parentAssetId: string;
  readonly childAssetId: string;
  readonly relation: AssetLineageRelation;
  readonly metadata?: Readonly<Record<string, unknown>>;
}): void {
  if (input.parentAssetId === input.childAssetId) {
    throw new Error('Asset lineage cannot reference itself.');
  }
  const parent = getAssetRecord(input.parentAssetId);
  const child = getAssetRecord(input.childAssetId);
  if (!parent || !child) {
    throw new Error('Asset lineage requires existing parent and child records.');
  }
  if (
    parent.lifecycle_state !== 'active'
    || child.lifecycle_state !== 'active'
  ) {
    throw new Error('Asset lineage requires active parent and child records.');
  }
  if (wouldCreateLineageCycle(input.parentAssetId, input.childAssetId)) {
    throw new Error('Asset lineage would create a cycle.');
  }
  getDb().prepare(
    `INSERT OR IGNORE INTO asset_lineage (
       parent_asset_id, child_asset_id, relation, metadata
     ) VALUES (?, ?, ?, ?)`,
  ).run(
    input.parentAssetId,
    input.childAssetId,
    input.relation,
    JSON.stringify(input.metadata ?? {}),
  );
}

export function getAssetLineage(assetId: string): {
  readonly parents: readonly AssetLineageRecord[];
  readonly children: readonly AssetLineageRecord[];
} {
  return {
    parents: getDb().prepare(
      'SELECT * FROM asset_lineage WHERE child_asset_id = ? ORDER BY created_at',
    ).all(assetId) as AssetLineageRecord[],
    children: getDb().prepare(
      'SELECT * FROM asset_lineage WHERE parent_asset_id = ? ORDER BY created_at',
    ).all(assetId) as AssetLineageRecord[],
  };
}

export function addAssetReference(input: {
  readonly assetId: string;
  readonly consumerType: string;
  readonly consumerId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}): AssetReferenceRecord {
  const asset = getAssetRecord(input.assetId);
  if (!asset || asset.lifecycle_state !== 'active') {
    throw new Error('Asset reference requires an active Asset.');
  }
  const id = crypto.randomUUID();
  getDb().prepare(
    `INSERT INTO asset_references (
       id, asset_id, consumer_type, consumer_id, metadata
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(asset_id, consumer_type, consumer_id) DO UPDATE SET
       metadata = excluded.metadata,
       released_at = NULL`,
  ).run(
    id,
    input.assetId,
    input.consumerType,
    input.consumerId,
    JSON.stringify(input.metadata ?? {}),
  );
  return getDb().prepare(
    `SELECT * FROM asset_references
     WHERE asset_id = ? AND consumer_type = ? AND consumer_id = ?`,
  ).get(
    input.assetId,
    input.consumerType,
    input.consumerId,
  ) as AssetReferenceRecord;
}

export function releaseAssetReference(input: {
  readonly assetId: string;
  readonly consumerType: string;
  readonly consumerId: string;
}): boolean {
  return getDb().prepare(
    `UPDATE asset_references SET released_at = datetime('now')
     WHERE asset_id = ? AND consumer_type = ? AND consumer_id = ?
       AND released_at IS NULL`,
  ).run(
    input.assetId,
    input.consumerType,
    input.consumerId,
  ).changes > 0;
}

export function listAssetConsumers(assetId: string): readonly AssetConsumer[] {
  const references = getDb().prepare(
    `SELECT id, consumer_type, consumer_id
     FROM asset_references
     WHERE asset_id = ? AND released_at IS NULL`,
  ).all(assetId) as {
    id: string;
    consumer_type: string;
    consumer_id: string;
  }[];
  const children = getDb().prepare(
    `SELECT child_asset_id, relation
     FROM asset_lineage
     WHERE parent_asset_id = ?`,
  ).all(assetId) as {
    child_asset_id: string;
    relation: string;
  }[];
  return [
    ...references.map((reference) => ({
      type: 'reference' as const,
      id: reference.id,
      label: `${reference.consumer_type}:${reference.consumer_id}`,
    })),
    ...children.map((child) => ({
      type: 'asset_lineage' as const,
      id: child.child_asset_id,
      label: `${child.relation}:${child.child_asset_id}`,
    })),
  ];
}

export interface PermanentAssetDeleteResult {
  readonly assetId: string;
  readonly deletedPaths: readonly string[];
  readonly retainedSharedPaths: readonly string[];
  readonly sourceMediaGenerationDeleted: boolean;
}

export interface PermanentLegacyMediaDeleteResult {
  readonly mediaGenerationId: string;
  readonly deletedPaths: readonly string[];
  readonly retainedSharedPaths: readonly string[];
  readonly retainedExternalPaths: readonly string[];
}

function resolveThroughExistingAncestor(inputPath: string): string {
  let existingAncestor = path.resolve(inputPath);
  const missingSegments: string[] = [];
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) break;
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
  const canonicalAncestor = fs.existsSync(existingAncestor)
    ? fs.realpathSync.native(existingAncestor)
    : existingAncestor;
  return path.join(canonicalAncestor, ...missingSegments);
}

function assertCanonicalDeleteTarget(targetPath: string, rootPath: string): string {
  // macOS exposes the same temporary directory through both `/var` and
  // `/private/var`. Resolve the nearest existing ancestor so this boundary
  // check compares filesystem identities rather than path aliases.
  const target = resolveThroughExistingAncestor(targetPath);
  const root = resolveThroughExistingAncestor(rootPath);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(
      `Refusing to delete Asset bytes "${target}" outside "${root}".`,
    );
  }
  return target;
}

function canonicalOwnedDeleteTarget(
  targetPath: string,
  rootPath: string,
): string | null {
  try {
    return assertCanonicalDeleteTarget(targetPath, rootPath);
  } catch {
    return null;
  }
}

function isAssetPathShared(
  assetId: string,
  sourceMediaGenerationId: string | null,
  targetPath: string,
): boolean {
  const mediaRoot = canonicalMediaDir();
  const canonicalMediaRoot = resolveThroughExistingAncestor(mediaRoot);
  const relativePath = path.relative(canonicalMediaRoot, targetPath);
  const equivalentPaths = Array.from(new Set([
    targetPath,
    path.join(path.resolve(mediaRoot), relativePath),
  ]));
  const placeholders = equivalentPaths.map(() => '?').join(', ');
  const assetOwner = getDb().prepare(
    `SELECT id FROM asset_records
     WHERE id != ?
       AND (
         stable_path IN (${placeholders})
         OR preview_path IN (${placeholders})
       )
     LIMIT 1`,
  ).get(assetId, ...equivalentPaths, ...equivalentPaths);
  if (assetOwner) return true;
  const mediaOwner = getDb().prepare(
    `SELECT id FROM media_generations
     WHERE id != ?
       AND (
         local_path IN (${placeholders})
         OR thumbnail_path IN (${placeholders})
       )
     LIMIT 1`,
  ).get(
    sourceMediaGenerationId || '',
    ...equivalentPaths,
    ...equivalentPaths,
  );
  return !!mediaOwner;
}

/**
 * Permanently removes an Asset after proving that no active consumer depends
 * on it. The Asset Library owns bytes only inside its canonical media/Asset
 * roots; shared media paths are retained for their other owner.
 *
 * Bytes are removed before the small, preflighted DB transaction. If an
 * unexpected DB failure occurs, the remaining record honestly reconciles to
 * `missing` and the user can retry instead of receiving a false success.
 */
export function deleteAssetPermanently(
  assetId: string,
): PermanentAssetDeleteResult {
  const asset = getAssetRecord(assetId);
  if (!asset) throw new Error(`Asset "${assetId}" does not exist.`);
  const consumers = listAssetConsumers(assetId);
  if (consumers.length > 0) throw new AssetInUseError(assetId, consumers);

  const sourceMedia = asset.source_media_generation_id
    ? mediaRow(asset.source_media_generation_id)
    : undefined;
  const candidates: string[] = [];
  if (asset.kind === 'html_bundle') {
    const assetRoot = assertCanonicalDeleteTarget(
      path.join(canonicalAssetsDir(), asset.id),
      canonicalAssetsDir(),
    );
    const stablePath = resolveThroughExistingAncestor(asset.stable_path);
    if (
      stablePath !== assetRoot
      && !stablePath.startsWith(`${assetRoot}${path.sep}`)
    ) {
      throw new Error('HTML Asset entry is outside its canonical Asset root.');
    }
    candidates.push(assetRoot);
  } else {
    for (const candidate of [
      asset.stable_path,
      asset.preview_path,
      sourceMedia?.local_path,
      sourceMedia?.thumbnail_path,
    ]) {
      if (!candidate) continue;
      candidates.push(
        assertCanonicalDeleteTarget(candidate, canonicalMediaDir()),
      );
    }
  }

  const uniqueCandidates = Array.from(new Set(candidates));
  const deletedPaths: string[] = [];
  const retainedSharedPaths: string[] = [];
  for (const targetPath of uniqueCandidates) {
    if (
      isAssetPathShared(
        asset.id,
        asset.source_media_generation_id,
        targetPath,
      )
    ) {
      retainedSharedPaths.push(targetPath);
      continue;
    }
    if (!fs.existsSync(targetPath)) continue;
    fs.rmSync(targetPath, { recursive: true, force: false });
    deletedPaths.push(targetPath);
  }

  let sourceMediaGenerationDeleted = false;
  getDb().transaction(() => {
    getDb().prepare(
      'DELETE FROM asset_references WHERE asset_id = ?',
    ).run(asset.id);
    getDb().prepare(
      `DELETE FROM asset_lineage
       WHERE child_asset_id = ? OR parent_asset_id = ?`,
    ).run(asset.id, asset.id);
    getDb().prepare(
      'DELETE FROM asset_records WHERE id = ?',
    ).run(asset.id);
    if (asset.source_media_generation_id) {
      sourceMediaGenerationDeleted = getDb().prepare(
        'DELETE FROM media_generations WHERE id = ?',
      ).run(asset.source_media_generation_id).changes > 0;
    }
  })();

  return {
    assetId: asset.id,
    deletedPaths,
    retainedSharedPaths,
    sourceMediaGenerationDeleted,
  };
}

/**
 * Removes a legacy generation that could not become an Asset. Only bytes
 * inside the current canonical media directory are owned by this library;
 * migrated/external paths are deliberately left untouched while the stale DB
 * row is still removable.
 */
export function deleteLegacyMediaGenerationPermanently(
  mediaGenerationId: string,
): PermanentLegacyMediaDeleteResult {
  if (getAssetRecord(mediaGenerationId)) {
    throw new Error(
      `Media generation "${mediaGenerationId}" is materialized as an Asset.`,
    );
  }
  const row = mediaRow(mediaGenerationId);
  if (!row) {
    throw new Error(`Media generation "${mediaGenerationId}" does not exist.`);
  }
  const deletedPaths: string[] = [];
  const retainedSharedPaths: string[] = [];
  const retainedExternalPaths: string[] = [];
  for (const candidate of Array.from(new Set([
    row.local_path,
    row.thumbnail_path,
  ].filter(Boolean)))) {
    const target = canonicalOwnedDeleteTarget(candidate, canonicalMediaDir());
    if (!target) {
      retainedExternalPaths.push(path.resolve(candidate));
      continue;
    }
    if (isAssetPathShared('', row.id, target)) {
      retainedSharedPaths.push(target);
      continue;
    }
    if (!fs.existsSync(target)) continue;
    fs.rmSync(target, { recursive: false, force: false });
    deletedPaths.push(target);
  }
  getDb().transaction(() => {
    getDb().prepare(
      `DELETE FROM asset_backfill_failures
       WHERE source_table = 'media_generations' AND source_id = ?`,
    ).run(row.id);
    getDb().prepare(
      'DELETE FROM media_generations WHERE id = ?',
    ).run(row.id);
  })();
  return {
    mediaGenerationId: row.id,
    deletedPaths,
    retainedSharedPaths,
    retainedExternalPaths,
  };
}

export function restoreAsset(assetId: string): AssetRecord {
  const existing = getAssetRecord(assetId);
  if (!existing) throw new Error(`Asset "${assetId}" does not exist.`);
  if (existing.lifecycle_state !== 'trashed') {
    throw new Error(
      `Asset "${assetId}" is not a legacy trashed record and cannot be restored.`,
    );
  }
  const asset = reconcileAssetIntegrity(assetId);
  if (asset.integrity_state !== 'valid') {
    throw new Error(
      `Asset "${assetId}" cannot be restored: ${asset.integrity_reason}`,
    );
  }
  getDb().prepare(
    `UPDATE asset_records
     SET lifecycle_state = 'active', deleted_at = NULL,
         updated_at = datetime('now')
     WHERE id = ?`,
  ).run(assetId);
  return getAssetRecord(assetId)!;
}

export function toTypedAssetRef(asset: AssetRecord): {
  readonly assetId: string;
  readonly kind: string;
  readonly contentHash: string;
} {
  if (
    asset.lifecycle_state !== 'active'
    || asset.integrity_state !== 'valid'
    || !asset.content_hash
  ) {
    throw new Error('Only active, integrity-valid Assets can become typed refs.');
  }
  requireAssetKind(asset.kind);
  return {
    assetId: asset.id,
    kind: asset.kind,
    contentHash: asset.content_hash,
  };
}
