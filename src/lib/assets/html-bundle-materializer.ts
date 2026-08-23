import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb } from '@/lib/db';
import { sanitizeDisplayText } from '@/lib/display-text-sanitizer';
import type { AssetRecord } from '@/types';
import { addAssetLineage, getAssetRecord } from './service';
import { assertRegisteredAssetProducer } from './kind-registry';
import {
  copyInspectedHtmlBundle,
  inspectHtmlEntryClosure,
  inspectHtmlBundle,
  type HtmlBundleInspection,
} from './html-bundle-security';

export type HtmlBundleSource =
  | {
    readonly kind: 'workspace';
    readonly sourceDir: string;
    readonly entryFile: string;
    readonly scopeRoot: string;
  }
  | {
    readonly kind: 'inline';
    readonly html: string;
    readonly entryFile?: string;
  };

export interface MaterializeHtmlBundleInput {
  readonly terminalState: 'completed' | 'partial' | 'failed';
  readonly source: HtmlBundleSource;
  readonly sessionId?: string;
  readonly projectId?: string;
  readonly runtimeId?: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly prompt?: string;
  readonly methodRef?: string;
  readonly parentAssetIds?: readonly string[];
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const MAX_HTML_THUMBNAIL_BYTES = 8 * 1024 * 1024;

function assetsRoot(): string {
  const dataDir =
    process.env.CLAUDE_GUI_DATA_DIR
    || path.join(os.homedir(), '.codepilot');
  return path.resolve(dataDir, '.codepilot-assets');
}

function isWithin(target: string, root: string): boolean {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function readPngDimensions(bytes: Buffer): { width: number; height: number } {
  if (
    bytes.length < 24
    || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    || bytes.toString('ascii', 12, 16) !== 'IHDR'
  ) {
    throw new Error('HTML thumbnail must be a valid PNG.');
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (
    width < 320
    || width > 3840
    || height < 180
    || height > 2160
    || Math.abs((width / height) - (16 / 9)) > 0.01
  ) {
    throw new Error('HTML thumbnail must use a bounded 16:9 viewport.');
  }
  let offset = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  let sawImageData = false;
  let sawEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const nextOffset = offset + 12 + length;
    if (nextOffset > bytes.length) {
      throw new Error('HTML thumbnail has a truncated PNG chunk.');
    }
    if (chunkIndex === 0 && (type !== 'IHDR' || length !== 13)) {
      throw new Error('HTML thumbnail has an invalid PNG header.');
    }
    if (type === 'IDAT' && length > 0) sawImageData = true;
    if (type === 'IEND') {
      if (length !== 0 || nextOffset !== bytes.length) {
        throw new Error('HTML thumbnail has an invalid PNG terminator.');
      }
      sawEnd = true;
      break;
    }
    offset = nextOffset;
    chunkIndex += 1;
  }
  if (!sawImageData || !sawEnd) {
    throw new Error('HTML thumbnail PNG is incomplete.');
  }
  return { width, height };
}

function decodeHtmlTitle(value: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return sanitizeDisplayText(value
    .replace(/<[^>]*>/g, ' ')
    .replace(
      /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
      (match, decimal: string, hexadecimal: string, entity: string) => {
        const codePoint = decimal
          ? Number.parseInt(decimal, 10)
          : hexadecimal
            ? Number.parseInt(hexadecimal, 16)
            : NaN;
        if (Number.isFinite(codePoint)) {
          try {
            return String.fromCodePoint(codePoint);
          } catch {
            return match;
          }
        }
        return named[entity?.toLowerCase()] ?? match;
      },
    ));
}

function readHtmlDocumentTitle(entryPath: string): string {
  const file = fs.openSync(entryPath, 'r');
  try {
    const stat = fs.fstatSync(file);
    const length = Math.min(stat.size, 256 * 1024);
    const buffer = Buffer.alloc(length);
    fs.readSync(file, buffer, 0, length, 0);
    const match = buffer
      .toString('utf8')
      .match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
    return match ? decodeHtmlTitle(match[1]) : '';
  } finally {
    fs.closeSync(file);
  }
}

function prepareSource(input: HtmlBundleSource, stagingRoot: string): {
  inspection: HtmlBundleInspection;
  sourceScope: string;
  producerId: string;
  cleanup?: () => void;
} {
  if (input.kind === 'inline') {
    if (!input.html.trim()) throw new Error('Inline HTML bundle is empty.');
    if (Buffer.byteLength(input.html, 'utf8') > 2 * 1024 * 1024) {
      throw new Error('Inline HTML bundle exceeds 2 MiB.');
    }
    const inlineRoot = path.join(stagingRoot, 'inline-source');
    const entryFile = input.entryFile || 'index.html';
    if (path.basename(entryFile) !== entryFile) {
      throw new Error('Inline HTML entry file must be a filename.');
    }
    fs.mkdirSync(inlineRoot, { recursive: true });
    fs.writeFileSync(path.join(inlineRoot, entryFile), input.html, 'utf8');
    return {
      inspection: inspectHtmlBundle(inlineRoot, entryFile),
      sourceScope: 'inline:user-selected',
      producerId: 'html-bundle:user-selected-inline',
      cleanup: () => fs.rmSync(inlineRoot, { recursive: true, force: true }),
    };
  }

  const scopeRoot = fs.realpathSync.native(path.resolve(input.scopeRoot));
  const sourceDir = fs.realpathSync.native(path.resolve(input.sourceDir));
  if (!isWithin(sourceDir, scopeRoot)) {
    throw new Error('HTML bundle source directory is outside the session workspace.');
  }
  return {
    inspection: inspectHtmlEntryClosure(sourceDir, input.entryFile),
    sourceScope: sourceDir,
    producerId: 'html-bundle:workspace-materializer',
  };
}

function materializationKey(input: MaterializeHtmlBundleInput, inspection: HtmlBundleInspection): string {
  const sourceIdentity =
    input.source.kind === 'workspace'
      ? `${inspection.root}:${inspection.entryFile}`
      : `inline:${inspection.entryFile}`;
  return crypto.createHash('sha256').update(JSON.stringify({
    producer: input.source.kind,
    sourceIdentity,
    contentHash: inspection.contentHash,
    sessionId: input.sessionId || '',
  })).digest('hex');
}

export function materializeHtmlBundle(
  input: MaterializeHtmlBundleInput,
): AssetRecord {
  if (input.terminalState !== 'completed') {
    throw new Error(
      `HTML bundle cannot materialize terminal state "${input.terminalState}".`,
    );
  }
  const root = assetsRoot();
  fs.mkdirSync(root, { recursive: true });
  const stagingRoot = path.join(root, `.tmp-${crypto.randomUUID()}`);
  fs.mkdirSync(stagingRoot, { recursive: true });
  let finalRoot = '';
  try {
    const prepared = prepareSource(input.source, stagingRoot);
    const descriptor = assertRegisteredAssetProducer(
      'html_bundle',
      prepared.producerId,
    );
    const key = materializationKey(input, prepared.inspection);
    const existing = getDb().prepare(
      `SELECT id FROM asset_records
       WHERE materialization_key = ? LIMIT 1`,
    ).get(key) as { id: string } | undefined;
    if (existing) return getAssetRecord(existing.id)!;

    const assetId = crypto.randomUUID();
    finalRoot = path.join(root, assetId);
    const stagedBundle = path.join(stagingRoot, 'bundle');
    fs.mkdirSync(stagedBundle, { recursive: true });
    copyInspectedHtmlBundle(prepared.inspection, stagedBundle);
    const copied = inspectHtmlBundle(
      stagedBundle,
      prepared.inspection.entryFile,
    );
    if (copied.contentHash !== prepared.inspection.contentHash) {
      throw new Error('HTML bundle bytes changed during materialization.');
    }
    const pageTitle = readHtmlDocumentTitle(
      path.join(stagedBundle, copied.entryFile),
    );
    prepared.cleanup?.();
    const now = new Date().toISOString();
    fs.writeFileSync(
      path.join(stagingRoot, 'asset-manifest.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        assetId,
        kind: descriptor.id,
        producerId: prepared.producerId,
        entryFile: copied.entryFile,
        pageTitle,
        contentHash: copied.contentHash,
        files: copied.files,
        externalUrls: copied.externalUrls,
        createdAt: now,
      }, null, 2)}\n`,
      'utf8',
    );
    fs.renameSync(stagingRoot, finalRoot);
    const stablePath = path.join(finalRoot, 'bundle', copied.entryFile);
    try {
      getDb().transaction(() => {
        getDb().prepare(
          `INSERT INTO asset_records (
             id, kind, producer_id, stable_path, content_hash, mime_type,
             byte_size, project_id, session_id, runtime_id, provider_id,
             model_id, prompt, method_ref, trust_tier, source_scope,
             lifecycle_state, integrity_state, integrity_reason, metadata,
             materialization_key, created_at, updated_at
           ) VALUES (
             ?, 'html_bundle', ?, ?, ?, 'text/html', ?, ?, ?, ?, ?, ?,
             ?, ?, ?, ?, 'active', 'valid', '', ?, ?, ?, ?
           )`,
        ).run(
          assetId,
          prepared.producerId,
          stablePath,
          copied.contentHash,
          copied.byteSize,
          input.projectId || '',
          input.sessionId || null,
          input.runtimeId || '',
          input.providerId || '',
          input.modelId || '',
          input.prompt || copied.entryFile,
          input.methodRef || '',
          input.source.kind === 'workspace'
            ? 'workspace_generated'
            : 'user_selected_inline',
          prepared.sourceScope,
          JSON.stringify({
            bundleRoot: path.join(finalRoot, 'bundle'),
            entryFile: copied.entryFile,
            pageTitle,
            fileCount: copied.files.length,
            externalUrls: copied.externalUrls,
          }),
          key,
          now,
          now,
        );
        for (const parentAssetId of input.parentAssetIds ?? []) {
          addAssetLineage({
            parentAssetId,
            childAssetId: assetId,
            relation: 'derived_from',
          });
        }
      })();
    } catch (error) {
      fs.rmSync(finalRoot, { recursive: true, force: true });
      const concurrent = getDb().prepare(
        `SELECT id FROM asset_records
         WHERE materialization_key = ? LIMIT 1`,
      ).get(key) as { id: string } | undefined;
      if (concurrent) return getAssetRecord(concurrent.id)!;
      throw error;
    }
    return getAssetRecord(assetId)!;
  } finally {
    if (fs.existsSync(stagingRoot)) {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  }
}

export function getHtmlBundlePreviewLocation(asset: AssetRecord): {
  readonly entryPath: string;
  readonly bundleRoot: string;
} {
  if (asset.kind !== 'html_bundle') {
    throw new Error(`Asset "${asset.id}" is not an HTML bundle.`);
  }
  const metadata = JSON.parse(asset.metadata || '{}') as {
    bundleRoot?: unknown;
  };
  if (typeof metadata.bundleRoot !== 'string' || !metadata.bundleRoot) {
    throw new Error(`HTML bundle "${asset.id}" has no bundle root.`);
  }
  const bundleRoot = path.resolve(metadata.bundleRoot);
  const entryPath = path.resolve(asset.stable_path);
  const root = assetsRoot();
  if (!isWithin(bundleRoot, root)) {
    throw new Error(`HTML bundle "${asset.id}" root is outside the Asset Library.`);
  }
  if (!isWithin(entryPath, bundleRoot)) {
    throw new Error(`HTML bundle "${asset.id}" entry escapes its bundle root.`);
  }
  return { entryPath, bundleRoot };
}

export function getHtmlBundleDisplayTitle(asset: AssetRecord): string {
  const metadata = JSON.parse(asset.metadata || '{}') as {
    entryFile?: unknown;
    pageTitle?: unknown;
  };
  if (typeof metadata.pageTitle === 'string' && metadata.pageTitle.trim()) {
    const pageTitle = sanitizeDisplayText(metadata.pageTitle);
    if (pageTitle) return pageTitle;
  }
  const { entryPath } = getHtmlBundlePreviewLocation(asset);
  if (fs.existsSync(entryPath)) {
    const documentTitle = readHtmlDocumentTitle(entryPath);
    if (documentTitle) return documentTitle;
  }
  if (typeof metadata.entryFile === 'string' && metadata.entryFile.trim()) {
    return path.basename(metadata.entryFile);
  }
  return path.basename(entryPath);
}

export function storeHtmlBundleThumbnail(
  assetId: string,
  pngBytes: Buffer,
): AssetRecord {
  if (pngBytes.length > MAX_HTML_THUMBNAIL_BYTES) {
    throw new Error('HTML thumbnail exceeds 8 MiB.');
  }
  const asset = getAssetRecord(assetId);
  if (!asset) throw new Error(`Asset "${assetId}" was not found.`);
  const { bundleRoot } = getHtmlBundlePreviewLocation(asset);
  const assetRoot = path.dirname(bundleRoot);
  const root = assetsRoot();
  if (!isWithin(assetRoot, root)) {
    throw new Error(`HTML bundle "${assetId}" root is outside the Asset Library.`);
  }
  const { width, height } = readPngDimensions(pngBytes);
  const previewPath = path.join(assetRoot, 'preview.png');
  const temporaryPath = path.join(
    assetRoot,
    `.preview-${crypto.randomUUID()}.tmp`,
  );
  fs.writeFileSync(temporaryPath, pngBytes, { mode: 0o600 });
  try {
    fs.renameSync(temporaryPath, previewPath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
  getDb().prepare(
    `UPDATE asset_records
     SET preview_path = ?, width = ?, height = ?, updated_at = ?
     WHERE id = ? AND kind = 'html_bundle'`,
  ).run(previewPath, width, height, new Date().toISOString(), assetId);
  return getAssetRecord(assetId)!;
}

export function getHtmlBundleThumbnailPath(asset: AssetRecord): string | null {
  if (asset.kind !== 'html_bundle' || !asset.preview_path) return null;
  const { bundleRoot } = getHtmlBundlePreviewLocation(asset);
  const assetRoot = path.dirname(bundleRoot);
  const previewPath = path.resolve(asset.preview_path);
  if (!isWithin(previewPath, assetRoot) || path.basename(previewPath) !== 'preview.png') {
    throw new Error(`HTML bundle "${asset.id}" thumbnail path is invalid.`);
  }
  return fs.existsSync(previewPath) ? previewPath : null;
}
