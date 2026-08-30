import '../db-isolation.setup';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { getDb, migrateAssetLibrarySchema } from '@/lib/db';
import {
  addAssetLineage,
  addAssetReference,
  AssetInUseError,
  backfillMediaAssets,
  classifyAssetBackfillError,
  deleteAssetPermanently,
  findActiveAssetIdsByStablePaths,
  getAssetLineage,
  getAssetRecord,
  listAssetConsumers,
  parseStoredAssetTags,
  registerMediaGenerationAsset,
  releaseAssetReference,
  restoreAsset,
  toTypedAssetRef,
} from '@/lib/assets/service';
import { getAssetKind, listAssetKinds } from '@/lib/assets/kind-registry';
import {
  getMediaDir,
  importFileToLibrary,
  saveMediaToLibrary,
} from '@/lib/media-saver';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function minimalWav(): Buffer {
  const buffer = Buffer.alloc(44);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8_000, 24);
  buffer.writeUInt32LE(16_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(0, 40);
  return buffer;
}

function insertLegacyMedia(input: {
  id: string;
  type: 'image' | 'video' | 'audio';
  status?: 'completed' | 'failed' | 'processing';
  localPath: string;
  mimeType: string;
  tags?: readonly string[];
}): void {
  getDb().prepare(
    `INSERT INTO media_generations (
       id, type, status, provider, model, prompt, local_path,
       thumbnail_path, tags, metadata, created_at, completed_at
     ) VALUES (?, ?, ?, 'legacy', 'legacy-model', 'legacy prompt', ?,
       '', ?, ?, datetime('now'), datetime('now'))`,
  ).run(
    input.id,
    input.type,
    input.status ?? 'completed',
    input.localPath,
    JSON.stringify(input.tags ?? []),
    JSON.stringify({ mimeType: input.mimeType }),
  );
}

describe('Harness Home Asset Library conformance', () => {
  it('registers only real producer → materializer → validator → consumer chains', () => {
    const kinds = listAssetKinds();
    assert.deepEqual(
      kinds.map((kind) => kind.id),
      ['image', 'video', 'audio', 'html_bundle'],
    );
    assert.equal(getAssetKind('component'), undefined);
    assert.equal(getAssetKind('document'), undefined);
    for (const kind of kinds) {
      assert.ok(kind.producers.length > 0);
      assert.ok(kind.materializer);
      assert.ok(kind.validator);
      assert.ok(kind.previewConsumer);
      assert.ok(kind.inputConsumers.length > 0);
      assert.ok(kind.trustPolicy);
      assert.ok(kind.conformanceSuite);
    }
  });

  it('materializes image, video, and real WAV fixtures with provenance and hashes', () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-conformance-'));
    const videoPath = path.join(sourceDir, 'sample.mp4');
    const audioPath = path.join(sourceDir, 'sample.wav');
    fs.writeFileSync(videoPath, Buffer.from('real-test-video-bytes'));
    fs.writeFileSync(audioPath, minimalWav());

    try {
      const image = saveMediaToLibrary(
        { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
        {
          source: 'mcp',
          producerId: 'media-saver:base64',
          runtimeId: 'codepilot_runtime',
          methodRef: 'method:test-image',
          prompt: 'one pixel',
        },
      );
      const video = importFileToLibrary(videoPath, {
        mimeType: 'video/mp4',
        producerId: 'media-saver:file-import',
        source: 'test-import',
      });
      const audio = importFileToLibrary(audioPath, {
        mimeType: 'audio/wav',
        producerId: 'media-saver:file-import',
        source: 'test-import',
      });

      const imageAsset = getAssetRecord(image.assetId)!;
      const videoAsset = getAssetRecord(video.assetId)!;
      const audioAsset = getAssetRecord(audio.assetId)!;
      assert.equal(imageAsset.kind, 'image');
      assert.equal(videoAsset.kind, 'video');
      assert.equal(audioAsset.kind, 'audio');
      assert.equal(imageAsset.runtime_id, 'codepilot_runtime');
      assert.equal(imageAsset.method_ref, 'method:test-image');
      assert.equal(imageAsset.integrity_state, 'valid');
      assert.match(imageAsset.content_hash, /^sha256:[a-f0-9]{64}$/);
      assert.ok(imageAsset.stable_path.startsWith(fs.realpathSync.native(getMediaDir())));
      assert.equal(fs.readFileSync(audioAsset.stable_path).subarray(0, 4).toString(), 'RIFF');
      assert.deepEqual(toTypedAssetRef(videoAsset), {
        assetId: videoAsset.id,
        kind: 'video',
        contentHash: videoAsset.content_hash,
      });
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it('keeps duplicate bytes as distinct provenance records with the same hash', () => {
    const first = saveMediaToLibrary(
      { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
      { prompt: 'first provenance' },
    );
    const second = saveMediaToLibrary(
      { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
      { prompt: 'second provenance' },
    );
    const firstAsset = getAssetRecord(first.assetId)!;
    const secondAsset = getAssetRecord(second.assetId)!;
    assert.notEqual(firstAsset.id, secondAsset.id);
    assert.equal(firstAsset.content_hash, secondAsset.content_hash);
    assert.notEqual(firstAsset.prompt, secondAsset.prompt);
  });

  it('retains bytes that are still owned by another media row', () => {
    const sharedPath = path.join(getMediaDir(), 'shared-delete-guard.png');
    fs.mkdirSync(path.dirname(sharedPath), { recursive: true });
    fs.writeFileSync(sharedPath, Buffer.from(PNG_BASE64, 'base64'));
    insertLegacyMedia({
      id: 'shared-delete-owner',
      type: 'image',
      localPath: sharedPath,
      mimeType: 'image/png',
    });
    insertLegacyMedia({
      id: 'shared-delete-consumer',
      type: 'image',
      status: 'processing',
      localPath: sharedPath,
      mimeType: 'image/png',
    });
    const asset = registerMediaGenerationAsset({
      mediaGenerationId: 'shared-delete-owner',
      producerId: 'legacy-media-backfill',
    });

    const deleted = deleteAssetPermanently(asset.id);
    assert.deepEqual(deleted.deletedPaths, []);
    assert.deepEqual(deleted.retainedSharedPaths, [asset.stable_path]);
    assert.equal(fs.existsSync(sharedPath), true);
    assert.equal(getAssetRecord(asset.id), undefined);
    assert.ok(getDb().prepare(
      'SELECT id FROM media_generations WHERE id = ?',
    ).get('shared-delete-consumer'));

    getDb().prepare(
      'DELETE FROM media_generations WHERE id = ?',
    ).run('shared-delete-consumer');
    fs.rmSync(sharedPath, { force: true });
  });

  it('rolls back bytes and media rows when kind or producer validation fails', () => {
    const mediaDir = getMediaDir();
    const rowsBefore = (getDb().prepare(
      'SELECT COUNT(*) AS count FROM media_generations',
    ).get() as { count: number }).count;
    const filesBefore = fs.readdirSync(mediaDir).length;

    assert.throws(
      () => saveMediaToLibrary(
        { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
        { producerId: 'unregistered-producer' },
      ),
      /not registered/,
    );
    assert.throws(
      () => saveMediaToLibrary(
        {
          type: 'image',
          mimeType: 'application/octet-stream',
          data: Buffer.from('not a registered media kind').toString('base64'),
        },
      ),
      /does not match MIME type/,
    );

    const rowsAfter = (getDb().prepare(
      'SELECT COUNT(*) AS count FROM media_generations',
    ).get() as { count: number }).count;
    assert.equal(rowsAfter, rowsBefore);
    assert.equal(fs.readdirSync(mediaDir).length, filesBefore);
  });

  it('backfills legacy rows idempotently without claiming missing or partial bytes are valid', () => {
    const mediaDir = getMediaDir();
    fs.mkdirSync(mediaDir, { recursive: true });
    const validPath = path.join(mediaDir, 'legacy-valid.png');
    const missingPath = path.join(mediaDir, 'legacy-missing.png');
    fs.writeFileSync(validPath, Buffer.from(PNG_BASE64, 'base64'));
    insertLegacyMedia({
      id: 'legacy-valid-asset',
      type: 'image',
      localPath: validPath,
      mimeType: 'image/png',
      tags: ['legacy-tag'],
    });
    insertLegacyMedia({
      id: 'legacy-missing-asset',
      type: 'image',
      localPath: missingPath,
      mimeType: 'image/png',
    });
    insertLegacyMedia({
      id: 'legacy-partial-asset',
      type: 'image',
      status: 'processing',
      localPath: validPath,
      mimeType: 'image/png',
    });

    const first = backfillMediaAssets(100);
    assert.ok(first.created >= 2);
    assert.equal(getAssetRecord('legacy-valid-asset')?.integrity_state, 'valid');
    assert.deepEqual(
      JSON.parse(getAssetRecord('legacy-valid-asset')!.tags),
      ['legacy-tag'],
    );
    assert.equal(getAssetRecord('legacy-missing-asset')?.integrity_state, 'missing');
    assert.equal(getAssetRecord('legacy-partial-asset'), undefined);

    const second = backfillMediaAssets(100);
    assert.equal(second.created, 0);
    assert.equal(second.remaining, 0);
  });

  it('salvages valid legacy tags instead of dropping the whole array', () => {
    assert.deepEqual(
      parseStoredAssetTags(JSON.stringify([
        'useful',
        'bad,comma',
        42,
        'also useful',
        'USEFUL',
        'x'.repeat(40),
      ])),
      ['useful', 'also useful'],
    );
  });

  it('journals a poison backfill row so later valid rows are not starved', () => {
    const outsideDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'asset-backfill-poison-'),
    );
    const outsidePath = path.join(outsideDir, 'outside.png');
    fs.writeFileSync(outsidePath, Buffer.from(PNG_BASE64, 'base64'));
    insertLegacyMedia({
      id: 'legacy-poison-first',
      type: 'image',
      localPath: outsidePath,
      mimeType: 'image/png',
    });
    getDb().prepare(
      `UPDATE media_generations SET created_at = '2000-01-01 00:00:00'
       WHERE id = ?`,
    ).run('legacy-poison-first');

    const validPath = path.join(getMediaDir(), 'legacy-after-poison.png');
    fs.mkdirSync(path.dirname(validPath), { recursive: true });
    fs.writeFileSync(validPath, Buffer.from(PNG_BASE64, 'base64'));
    insertLegacyMedia({
      id: 'legacy-valid-after-poison',
      type: 'image',
      localPath: validPath,
      mimeType: 'image/png',
    });
    getDb().prepare(
      `UPDATE media_generations SET created_at = '2030-01-01 00:00:00'
       WHERE id = ?`,
    ).run('legacy-valid-after-poison');

    try {
      const first = backfillMediaAssets(1);
      assert.equal(first.scanned, 1);
      assert.equal(first.skipped, 1);
      assert.equal(getAssetRecord('legacy-poison-first'), undefined);
      assert.ok(getDb().prepare(
        `SELECT source_id FROM asset_backfill_failures
         WHERE source_table = 'media_generations' AND source_id = ?`,
      ).get('legacy-poison-first'));

      const second = backfillMediaAssets(1);
      assert.equal(second.created, 1);
      assert.equal(
        getAssetRecord('legacy-valid-after-poison')?.integrity_state,
        'valid',
      );
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('cools down transient backfill failures, advances later rows, then retries', () => {
    const mediaDir = getMediaDir();
    fs.mkdirSync(mediaDir, { recursive: true });
    const firstPath = path.join(mediaDir, 'legacy-transient-first.png');
    const secondPath = path.join(mediaDir, 'legacy-after-transient.png');
    fs.writeFileSync(firstPath, Buffer.from(PNG_BASE64, 'base64'));
    fs.writeFileSync(secondPath, Buffer.from(PNG_BASE64, 'base64'));
    insertLegacyMedia({
      id: 'legacy-transient-first',
      type: 'image',
      localPath: firstPath,
      mimeType: 'image/png',
    });
    insertLegacyMedia({
      id: 'legacy-after-transient',
      type: 'image',
      localPath: secondPath,
      mimeType: 'image/png',
    });
    getDb().prepare(
      `UPDATE media_generations SET created_at = CASE id
         WHEN 'legacy-transient-first' THEN '1980-01-01 00:00:00'
         ELSE '1981-01-01 00:00:00'
       END
       WHERE id IN ('legacy-transient-first', 'legacy-after-transient')`,
    ).run();
    getDb().prepare(
      `INSERT INTO asset_backfill_failures (
         source_table, source_id, failure_revision, error, last_failed_at
       ) VALUES (
         'media_generations', 'legacy-transient-first', 'media-assets-v2',
         'transient: resource busy', datetime('now')
       )`,
    ).run();

    assert.equal(
      classifyAssetBackfillError(Object.assign(new Error('busy'), { code: 'EBUSY' })).kind,
      'transient',
    );
    assert.equal(
      classifyAssetBackfillError(Object.assign(new Error('invalid'), { code: 'EINVAL' })).kind,
      'permanent',
    );
    const advanced = backfillMediaAssets(1);
    assert.equal(advanced.created, 1);
    assert.ok(getAssetRecord('legacy-after-transient'));
    assert.equal(getAssetRecord('legacy-transient-first'), undefined);

    getDb().prepare(
      `UPDATE asset_backfill_failures
       SET last_failed_at = '2000-01-01 00:00:00'
       WHERE source_id = 'legacy-transient-first'`,
    ).run();
    const retried = backfillMediaAssets(1);
    assert.equal(retried.created, 1);
    assert.ok(getAssetRecord('legacy-transient-first'));
    assert.equal(getDb().prepare(
      'SELECT 1 FROM asset_backfill_failures WHERE source_id = ?',
    ).get('legacy-transient-first'), undefined);
  });

  it('bounds inline backfill by cumulative and per-file byte budgets', () => {
    const mediaDir = getMediaDir();
    fs.mkdirSync(mediaDir, { recursive: true });
    const firstPath = path.join(mediaDir, 'budget-first.png');
    const secondPath = path.join(mediaDir, 'budget-second.png');
    const oversizedPath = path.join(mediaDir, 'budget-oversized.png');
    fs.writeFileSync(firstPath, Buffer.alloc(64, 1));
    fs.writeFileSync(secondPath, Buffer.alloc(64, 2));
    fs.writeFileSync(oversizedPath, Buffer.alloc(128, 3));
    for (const [id, localPath] of [
      ['budget-first', firstPath],
      ['budget-second', secondPath],
      ['budget-oversized', oversizedPath],
    ] as const) {
      insertLegacyMedia({ id, type: 'image', localPath, mimeType: 'image/png' });
    }
    getDb().prepare(
      `UPDATE media_generations SET created_at = CASE id
         WHEN 'budget-first' THEN '1970-01-01 00:00:00'
         WHEN 'budget-second' THEN '1971-01-01 00:00:00'
         ELSE '1972-01-01 00:00:00'
       END
       WHERE id IN ('budget-first', 'budget-second', 'budget-oversized')`,
    ).run();

    const first = backfillMediaAssets(100, {
      maxBytes: 64,
      maxSingleFileBytes: 64,
      maxDurationMs: 1_000,
    });
    assert.equal(first.scanned, 1);
    assert.equal(first.created, 1);
    assert.ok(getAssetRecord('budget-first'));
    assert.equal(getAssetRecord('budget-second'), undefined);

    const second = backfillMediaAssets(100, {
      maxBytes: 64,
      maxSingleFileBytes: 64,
      maxDurationMs: 1_000,
    });
    assert.equal(second.created, 1);
    assert.equal(second.deferred, 1);
    assert.ok(getAssetRecord('budget-second'));
    assert.equal(getAssetRecord('budget-oversized'), undefined);
    assert.match(
      (getDb().prepare(
        'SELECT error FROM asset_backfill_failures WHERE source_id = ?',
      ).get('budget-oversized') as { error: string }).error,
      /^deferred:/,
    );

    const resumed = backfillMediaAssets(100);
    assert.equal(resumed.created, 1);
    assert.ok(getAssetRecord('budget-oversized'));
    assert.equal(getDb().prepare(
      'SELECT 1 FROM asset_backfill_failures WHERE source_id = ?',
    ).get('budget-oversized'), undefined);
  });

  it('tracks acyclic lineage and protects active consumers from permanent deletion', () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-lineage-'));
    const videoPath = path.join(sourceDir, 'derived.mp4');
    fs.writeFileSync(videoPath, Buffer.from('derived-video-bytes'));
    const parent = saveMediaToLibrary(
      { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
      { prompt: 'parent' },
    );
    const child = saveMediaToLibrary(
      { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
      { prompt: 'child', parentAssetIds: [parent.assetId] },
    );
    assert.deepEqual(
      findActiveAssetIdsByStablePaths([
        getAssetRecord(parent.assetId)!.stable_path,
      ]),
      [parent.assetId],
    );
    const grandchild = importFileToLibrary(videoPath, {
      mimeType: 'video/mp4',
      prompt: 'derived video',
      parentAssetIds: [child.assetId],
    });
    fs.rmSync(sourceDir, { recursive: true, force: true });
    assert.equal(getAssetLineage(child.assetId).parents.length, 1);
    assert.equal(getAssetRecord(grandchild.assetId)?.kind, 'video');
    assert.throws(
      () => addAssetLineage({
        parentAssetId: grandchild.assetId,
        childAssetId: parent.assetId,
        relation: 'derived_from',
      }),
      /cycle/,
    );
    assert.throws(
      () => deleteAssetPermanently(parent.assetId),
      (error: unknown) => (
        error instanceof AssetInUseError
        && error.consumers.some((consumer) => consumer.type === 'asset_lineage')
      ),
    );

    const standalone = saveMediaToLibrary(
      { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
      { prompt: 'referenced standalone' },
    );
    addAssetReference({
      assetId: standalone.assetId,
      consumerType: 'harness_manifest',
      consumerId: 'harness:test',
    });
    assert.equal(listAssetConsumers(standalone.assetId).length, 1);
    assert.throws(
      () => deleteAssetPermanently(standalone.assetId),
      (error: unknown) => error instanceof AssetInUseError,
    );
    assert.equal(releaseAssetReference({
      assetId: standalone.assetId,
      consumerType: 'harness_manifest',
      consumerId: 'harness:test',
    }), true);
    const stablePath = getAssetRecord(standalone.assetId)!.stable_path;
    const deleted = deleteAssetPermanently(standalone.assetId);
    assert.deepEqual(deleted.deletedPaths, [stablePath]);
    assert.equal(fs.existsSync(stablePath), false);
    assert.equal(getAssetRecord(standalone.assetId), undefined);
    assert.equal(getDb().prepare(
      'SELECT id FROM media_generations WHERE id = ?',
    ).get(standalone.mediaId), undefined);
  });

  it('keeps restore only for legacy trashed rows and rejects active Assets', () => {
    const saved = saveMediaToLibrary(
      { type: 'image', mimeType: 'image/png', data: PNG_BASE64 },
      { prompt: 'legacy restore compatibility' },
    );
    assert.throws(
      () => restoreAsset(saved.assetId),
      /not a legacy trashed record/,
    );
    getDb().prepare(
      `UPDATE asset_records
       SET lifecycle_state = 'trashed', deleted_at = datetime('now')
       WHERE id = ?`,
    ).run(saved.assetId);
    assert.equal(restoreAsset(saved.assetId).lifecycle_state, 'active');
    deleteAssetPermanently(saved.assetId);
  });

  it('applies the additive schema idempotently without mutating legacy media rows', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE media_generations (
        id TEXT PRIMARY KEY
      );
      INSERT INTO media_generations (id) VALUES ('legacy-row');
    `);
    migrateAssetLibrarySchema(db);
    migrateAssetLibrarySchema(db);
    const tables = db.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name LIKE 'asset_%'
       ORDER BY name`,
    ).all() as { name: string }[];
    assert.deepEqual(tables.map((row) => row.name), [
      'asset_backfill_failures',
      'asset_backfill_state',
      'asset_lineage',
      'asset_records',
      'asset_references',
    ]);
    assert.equal(
      (db.prepare(
        'SELECT COUNT(*) AS count FROM media_generations',
      ).get() as { count: number }).count,
      1,
    );
    const tagsColumn = db.prepare(
      `SELECT name, "notnull" AS required, dflt_value AS defaultValue
       FROM pragma_table_info('asset_records')
       WHERE name = 'tags'`,
    ).get() as {
      name: string;
      required: number;
      defaultValue: string;
    };
    assert.deepEqual(tagsColumn, {
      name: 'tags',
      required: 1,
      defaultValue: "'[]'",
    });
    db.close();
  });

  it('backfills legacy media tags when an existing Asset schema gains tags', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE media_generations (
        id TEXT PRIMARY KEY,
        tags TEXT NOT NULL DEFAULT '[]'
      );
    `);
    migrateAssetLibrarySchema(db);
    db.prepare(
      `INSERT INTO media_generations (id, tags)
       VALUES ('tagged-media', '["legacy","favorite"]')`,
    ).run();
    db.prepare(
      `INSERT INTO asset_records (
         id, kind, producer_id, stable_path, source_media_generation_id
       ) VALUES (
         'tagged-media', 'image', 'legacy-media-backfill',
         '/tmp/tagged-media.png', 'tagged-media'
       )`,
    ).run();
    db.exec('ALTER TABLE asset_records DROP COLUMN tags');

    migrateAssetLibrarySchema(db);
    migrateAssetLibrarySchema(db);

    assert.equal(
      (db.prepare(
        'SELECT tags FROM asset_records WHERE id = ?',
      ).get('tagged-media') as { tags: string }).tags,
      '["legacy","favorite"]',
    );
    assert.equal(
      (db.prepare(
        'SELECT tags FROM media_generations WHERE id = ?',
      ).get('tagged-media') as { tags: string }).tags,
      '["legacy","favorite"]',
    );
    db.close();
  });
});
