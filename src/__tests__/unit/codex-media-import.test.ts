/**
 * Phase 5b smoke round 9 (2026-05-16) — Codex media import bridge.
 *
 * Pins the path that makes Codex `imageGeneration.savedPath` and
 * `imageView.path` actually renderable through `/api/media/serve`
 * without registering every view as a second durable Asset:
 *
 *   raw FS path (/tmp/foo.webp) → materializeCodexEventMedia
 *   → imageGeneration imports once; imageView reuses that Asset or stages
 *     a content-addressed preview-only copy
 *   → MediaBlock.localPath rewritten to a served path
 *   → /api/media/serve?path=<imported> returns 200
 *
 * Pre-fix the mapper handed `MediaBlock.localPath` = raw Codex path
 * straight to the chat side. `/api/media/serve` allows ONLY paths
 * under `~/.codepilot/.codepilot-media` (directory-traversal
 * protection), so the request 403'd and the image rendered as a
 * broken card.
 *
 * Tests cover:
 *   - savedPath outside the media dir → imported, localPath rewritten,
 *     mediaId stamped, file actually copied to disk.
 *   - imageView.path is preview-only unless it can reuse a durable import.
 *   - repeated generation/view events produce one durable DB row.
 *   - localPath already inside the media dir → pass through unchanged.
 *   - data-only block (no localPath) → pass through unchanged.
 *   - source missing → block dropped, console.warn, event still
 *     emitted (with the surviving blocks or media undefined).
 *   - Route-level integration: imported path is served 200 by the
 *     /api/media/serve route handler.
 */

// CRITICAL — this side-effect import MUST be first. It sets
// CLAUDE_GUI_DATA_DIR to a fresh test root BEFORE any @/lib import
// chain triggers `src/lib/db.ts` module-load (which captures the env
// var at module-load time). Without this, db.ts captures the user's
// real ~/.codepilot path and tests leak rows into the real DB
// (tech-debt #25). See _codex-media-import-env.ts for full background.
import { CODEX_MEDIA_TEST_ROOT, REAL_USER_DB_PATH } from './_codex-media-import-env';

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';
import { materializeCodexEventMedia } from '@/lib/codex/media-import';
import type { RuntimeRunEvent } from '@/lib/runtime/contract';

// `tempDir` now resolves to the SAME test root (which is the dataDir
// db.ts captured). Tests that previously assumed a fresh dataDir per
// test still get a fresh source-file subdir; the DB + media dir are
// shared across tests in this file (intentionally — distinct sessionIds
// keep rows separate, and a single shared DB is faster).
const tempDir = CODEX_MEDIA_TEST_ROOT;

// Minimal PNG (8x8 transparent) we drop in a temp dir as the
// "Codex-handed-to-us" source file. importFileToLibrary needs a real
// file on disk; this stays well under the size where copy speed
// would matter.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFklEQVR4AWMAAQAABQABDQottAAAAABJRU5ErkJggg==';

/** Regression guard (tech-debt #25): snapshot the user's REAL DB codex
 *  row count at suite start so the `after` hook can prove this file
 *  did NOT leak any new rows into it. If the real DB doesn't exist
 *  (fresh machine / CI), the guard short-circuits. */
let realDbCodexRowsBefore: number | null = null;

function countRealCodexRows(): number | null {
  if (!fs.existsSync(REAL_USER_DB_PATH)) return null;
  const db = new Database(REAL_USER_DB_PATH, { readonly: true });
  try {
    // Guard against "DB file exists but media_generations table doesn't"
    // (fresh installs / partial migrations). Without this, the COUNT(*)
    // throws "no such table" and the regression guard fails for the
    // wrong reason. Codex review P2 follow-up (2026-05-28).
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='media_generations'")
      .get();
    if (!tableExists) return 0;
    const row = db
      .prepare("SELECT COUNT(*) AS n FROM media_generations WHERE provider = 'codex'")
      .get() as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

before(() => {
  realDbCodexRowsBefore = countRealCodexRows();
});

after(() => {
  // Close the test-DB handle so the test root can be removed.
  try {
    // Dynamic import — closeDb may not exist on all branches.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { closeDb } = require('../../lib/db');
    closeDb?.();
  } catch {
    /* ignore */
  }
  // Regression guard: assert the REAL DB has NOT gained any codex rows
  // during this test file. If it has, the isolation broke again and
  // every future `npm test` run will keep adding garbage to the user's
  // media library. (tech-debt #25 root cause guard.)
  const after = countRealCodexRows();
  if (realDbCodexRowsBefore !== null && after !== null) {
    assert.equal(
      after,
      realDbCodexRowsBefore,
      `codex-media-import.test.ts leaked ${after - realDbCodexRowsBefore} provider='codex' rows into the REAL user DB at ${REAL_USER_DB_PATH}. Tech-debt #25 regressed — investigate _codex-media-import-env.ts ordering / db.ts capture behavior.`,
    );
  }
  // Best-effort cleanup of the shared test root.
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function buildSourcePng(): string {
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-media-source-'));
  const src = path.join(sourceDir, 'codex-out.webp');
  fs.writeFileSync(src, Buffer.from(TINY_PNG_BASE64, 'base64'));
  return src;
}

function makeImageGenerationEvent(localPath: string): RuntimeRunEvent {
  return {
    type: 'tool_completed',
    runtimeId: 'codex_runtime',
    sessionId: 's-1',
    toolId: 'img-1',
    output: { type: 'imageGeneration', id: 'img-1', result: '<base64>', savedPath: localPath },
    media: [{ type: 'image', mimeType: 'image/webp', localPath }],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Foreign path → imported + rewritten
// ─────────────────────────────────────────────────────────────────────

describe('materializeCodexEventMedia — Codex savedPath imported into the media library', () => {
  it('rewrites localPath to a path under .codepilot-media and stamps a mediaId', () => {
    const src = buildSourcePng();
    const event = makeImageGenerationEvent(src);
    const out = materializeCodexEventMedia(event, { sessionId: 's-1' });
    if (out.type !== 'tool_completed') throw new Error('unreachable');
    assert.ok(out.media && out.media.length === 1, 'media must survive the import');
    const block = out.media![0];
    assert.notEqual(block.localPath, src, 'localPath must NOT be the raw Codex path — that\'s what 403s through /api/media/serve');
    assert.ok(
      block.localPath!.startsWith(path.join(tempDir, '.codepilot-media') + path.sep),
      `imported localPath must live under <dataDir>/.codepilot-media; got ${block.localPath}`,
    );
    assert.ok(block.mediaId, 'mediaId must be stamped after import');
    assert.equal(block.mimeType, 'image/webp', 'mimeType passes through');
    // File actually exists on disk at the new path.
    assert.ok(fs.existsSync(block.localPath!), 'imported file must exist on disk');
  });

  it('Codex imageGeneration with revisedPrompt: library row gets prompt=revisedPrompt + model=codex-image (not filename, 2026-05-28)', async () => {
    // Real user concern: a Codex-generated image must land in the gallery
    // searchable by its actual prompt — not by the temp filename that
    // Codex's savedPath uses. buildImageGenerationMedia threads
    // `revisedPrompt` into block.sourceMetadata; materializeCodexEventMedia
    // passes that into importFileToLibrary as prompt + model.
    const src = buildSourcePng();
    const revisedPrompt = 'a calm pond at dusk with floating lanterns';
    const event: RuntimeRunEvent = {
      type: 'tool_completed',
      runtimeId: 'codex_runtime',
      sessionId: 's-prompted',
      toolId: 'img-prompted',
      output: { type: 'imageGeneration', id: 'img-prompted', result: '<base64>', savedPath: src, revisedPrompt },
      media: [{
        type: 'image',
        mimeType: 'image/webp',
        localPath: src,
        sourceMetadata: { prompt: revisedPrompt, model: 'codex-image' },
      }],
    };
    const out = materializeCodexEventMedia(event, { sessionId: 's-prompted' });
    if (out.type !== 'tool_completed') throw new Error('unreachable');
    const block = out.media![0];
    assert.ok(block.mediaId, 'import must stamp a mediaId');

    // Verify the DB row uses the real prompt + model + provider.
    const { getDb } = await import('../../lib/db');
    const row = getDb()
      .prepare('SELECT prompt, model, provider FROM media_generations WHERE id = ?')
      .get(block.mediaId!) as { prompt: string; model: string; provider: string } | undefined;
    assert.ok(row, 'media_generations row must exist');
    assert.equal(row!.prompt, revisedPrompt, 'prompt must be the Codex revisedPrompt, not the filename');
    assert.equal(row!.model, 'codex-image', 'model must be tagged so the UI can label the engine');
    assert.equal(row!.provider, 'codex', 'provider stays codex');
  });

  it('Codex imageGeneration WITHOUT revisedPrompt: falls back to filename (no regression for current behavior)', async () => {
    // Defensive fallback — if Codex omits revisedPrompt (failed generation,
    // older protocol), the library still gets an importable row, just with
    // the prior filename-as-prompt behavior. No drift in error paths.
    const src = buildSourcePng();
    const event = makeImageGenerationEvent(src); // no sourceMetadata on the block
    const out = materializeCodexEventMedia(event, { sessionId: 's-bare' });
    if (out.type !== 'tool_completed') throw new Error('unreachable');
    const block = out.media![0];
    const { getDb } = await import('../../lib/db');
    const row = getDb()
      .prepare('SELECT prompt, model FROM media_generations WHERE id = ?')
      .get(block.mediaId!) as { prompt: string; model: string } | undefined;
    assert.ok(row);
    assert.equal(row!.prompt, 'codex-out.webp', 'fallback prompt is the filename when no sourceMetadata is provided');
    assert.equal(row!.model, '', 'fallback model stays empty');
  });

  it('imageView path is staged for preview without creating a durable DB row', async () => {
    const src = buildSourcePng();
    const { getDb } = await import('../../lib/db');
    const countBefore = (getDb().prepare(
      "SELECT COUNT(*) AS count FROM media_generations WHERE provider = 'codex'",
    ).get() as { count: number }).count;
    const event: RuntimeRunEvent = {
      type: 'tool_completed',
      runtimeId: 'codex_runtime',
      sessionId: 's-1',
      toolId: 'view-1',
      output: { type: 'imageView', id: 'view-1', path: src },
      media: [{
        type: 'image',
        mimeType: 'image/webp',
        localPath: src,
        sourceMetadata: { persistence: 'preview_only' },
      }],
    };
    const out = materializeCodexEventMedia(event, { sessionId: 's-1' });
    if (out.type !== 'tool_completed') throw new Error('unreachable');
    const block = out.media![0];
    assert.ok(
      block.localPath!.startsWith(
        path.join(tempDir, '.codepilot-media', '.previews') + path.sep,
      ),
    );
    assert.equal(block.mediaId, undefined);
    const countAfter = (getDb().prepare(
      "SELECT COUNT(*) AS count FROM media_generations WHERE provider = 'codex'",
    ).get() as { count: number }).count;
    assert.equal(countAfter, countBefore);
  });

  it('repeated imageGeneration events reuse one durable Asset row', async () => {
    const src = buildSourcePng();
    const first = materializeCodexEventMedia(
      makeImageGenerationEvent(src),
      { sessionId: 's-dedup-generation' },
    );
    const second = materializeCodexEventMedia(
      makeImageGenerationEvent(src),
      { sessionId: 's-dedup-generation' },
    );
    if (first.type !== 'tool_completed' || second.type !== 'tool_completed') {
      throw new Error('unreachable');
    }
    assert.equal(second.media![0].mediaId, first.media![0].mediaId);
    assert.equal(second.media![0].localPath, first.media![0].localPath);
    const { getDb } = await import('../../lib/db');
    const count = (getDb().prepare(
      `SELECT COUNT(*) AS count FROM media_generations
       WHERE provider = 'codex' AND session_id = ?`,
    ).get('s-dedup-generation') as { count: number }).count;
    assert.equal(count, 1);
  });

  it('imageView reuses the durable generation instead of creating an ID-only duplicate', async () => {
    const src = buildSourcePng();
    const generated = materializeCodexEventMedia(
      makeImageGenerationEvent(src),
      { sessionId: 's-generation-view' },
    );
    if (generated.type !== 'tool_completed') throw new Error('unreachable');
    const viewed = materializeCodexEventMedia({
      type: 'tool_completed',
      runtimeId: 'codex_runtime',
      sessionId: 's-generation-view',
      toolId: 'view-after-generation',
      output: { type: 'imageView', id: 'view-after-generation', path: src },
      media: [{
        type: 'image',
        mimeType: 'image/webp',
        localPath: src,
        sourceMetadata: { persistence: 'preview_only' },
      }],
    }, { sessionId: 's-generation-view' });
    if (viewed.type !== 'tool_completed') throw new Error('unreachable');
    assert.equal(viewed.media![0].mediaId, generated.media![0].mediaId);
    assert.equal(viewed.media![0].localPath, generated.media![0].localPath);

    const { getDb } = await import('../../lib/db');
    const count = (getDb().prepare(
      `SELECT COUNT(*) AS count FROM media_generations
       WHERE provider = 'codex' AND session_id = ?`,
    ).get('s-generation-view') as { count: number }).count;
    assert.equal(count, 1);
  });

  it('block ALREADY inside .codepilot-media is passed through unchanged (no re-import)', () => {
    // First import to get a path inside the served dir.
    const src = buildSourcePng();
    const firstEvent = makeImageGenerationEvent(src);
    const firstOut = materializeCodexEventMedia(firstEvent, { sessionId: 's-1' });
    if (firstOut.type !== 'tool_completed') throw new Error('unreachable');
    const importedPath = firstOut.media![0].localPath!;
    const importedMediaId = firstOut.media![0].mediaId;

    // Now feed the imported block back in.
    const secondEvent: RuntimeRunEvent = {
      type: 'tool_completed',
      runtimeId: 'codex_runtime',
      sessionId: 's-1',
      toolId: 'img-2',
      media: [{ type: 'image', mimeType: 'image/webp', localPath: importedPath, mediaId: importedMediaId }],
    };
    const secondOut = materializeCodexEventMedia(secondEvent, { sessionId: 's-1' });
    if (secondOut.type !== 'tool_completed') throw new Error('unreachable');
    const block = secondOut.media![0];
    assert.equal(block.localPath, importedPath, 'localPath unchanged when already in media dir');
    assert.equal(block.mediaId, importedMediaId, 'mediaId unchanged when already in media dir');
  });

  it('data-only block (no localPath) is passed through unchanged', () => {
    const event: RuntimeRunEvent = {
      type: 'tool_completed',
      runtimeId: 'codex_runtime',
      sessionId: 's-1',
      toolId: 'img-3',
      media: [{ type: 'image', mimeType: 'image/png', data: TINY_PNG_BASE64 }],
    };
    const out = materializeCodexEventMedia(event, { sessionId: 's-1' });
    if (out.type !== 'tool_completed') throw new Error('unreachable');
    const block = out.media![0];
    assert.equal(block.data, TINY_PNG_BASE64, 'inline data stays — MediaPreview renders via data: URL');
    assert.equal(block.localPath, undefined);
    assert.equal(block.mediaId, undefined);
  });

  it('non-tool_completed events are passed through unchanged', () => {
    const event: RuntimeRunEvent = {
      type: 'assistant_delta',
      runtimeId: 'codex_runtime',
      sessionId: 's-1',
      text: 'hello',
    };
    const out = materializeCodexEventMedia(event, { sessionId: 's-1' });
    assert.equal(out, event, 'no-media events are passed by reference (no rewrite)');
  });

  it('tool_completed without media is passed through unchanged', () => {
    const event: RuntimeRunEvent = {
      type: 'tool_completed',
      runtimeId: 'codex_runtime',
      sessionId: 's-1',
      toolId: 'cmd-1',
      output: 'shell output',
    };
    const out = materializeCodexEventMedia(event, { sessionId: 's-1' });
    assert.equal(out, event);
  });

  it('source file missing → block dropped, console.warn fires, event survives', () => {
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(a => String(a)).join(' '));
    };
    try {
      const event = makeImageGenerationEvent('/tmp/this-file-does-not-exist-12345.png');
      const out = materializeCodexEventMedia(event, { sessionId: 's-1' });
      if (out.type !== 'tool_completed') throw new Error('unreachable');
      assert.equal(out.media, undefined, 'every block failed → media field is dropped so MediaPreview skips the row');
      // The rest of the event survives so the chat side still surfaces
      // the structured output JSON for debugging.
      assert.equal(out.toolId, 'img-1');
      assert.ok(
        warnings.some(w => w.includes('codex.media-import') && w.includes('this-file-does-not-exist')),
        `failure must emit a console.warn naming the source path; got: ${JSON.stringify(warnings)}`,
      );
    } finally {
      console.warn = originalWarn;
    }
  });

  it('partial failure: one block fails, one succeeds → survivor kept', () => {
    const originalWarn = console.warn;
    const stub = () => {};
    console.warn = stub;
    try {
      const goodSrc = buildSourcePng();
      const event: RuntimeRunEvent = {
        type: 'tool_completed',
        runtimeId: 'codex_runtime',
        sessionId: 's-1',
        toolId: 'mix-1',
        media: [
          { type: 'image', mimeType: 'image/webp', localPath: '/tmp/nope-missing-x.png' },
          { type: 'image', mimeType: 'image/webp', localPath: goodSrc },
        ],
      };
      const out = materializeCodexEventMedia(event, { sessionId: 's-1' });
      if (out.type !== 'tool_completed') throw new Error('unreachable');
      assert.equal(out.media?.length, 1, 'only the successful import survives');
      assert.ok(out.media![0].localPath!.startsWith(path.join(tempDir, '.codepilot-media') + path.sep));
    } finally {
      console.warn = originalWarn;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Route-level integration — /api/media/serve must accept the import
// ─────────────────────────────────────────────────────────────────────

describe('imported MediaBlock.localPath is accepted by /api/media/serve', () => {
  it('GET /api/media/serve?path=<imported> returns 200 with the file body', async () => {
    const src = buildSourcePng();
    const event = makeImageGenerationEvent(src);
    const out = materializeCodexEventMedia(event, { sessionId: 's-1' });
    if (out.type !== 'tool_completed') throw new Error('unreachable');
    const importedPath = out.media![0].localPath!;

    // Invoke the route handler directly. Mirrors how
    // codex-phase-6-wiring.test.ts exercises the providers/models
    // route — same NextRequest pattern.
    const { GET } = await import('@/app/api/media/serve/route');
    const { NextRequest } = await import('next/server');
    const url = `http://test.local/api/media/serve?path=${encodeURIComponent(importedPath)}`;
    const req = new NextRequest(url);
    const res = await GET(req);
    assert.equal(res.status, 200, 'imported path MUST be served — that\'s the whole point of the import bridge');
    assert.equal(res.headers.get('Content-Type'), 'image/webp');
    const body = await res.arrayBuffer();
    assert.ok(body.byteLength > 0, 'response carries the file bytes');
  });

  it('GET /api/media/serve refuses the RAW Codex path (regression guard for the pre-fix behaviour)', async () => {
    // This is the failure mode the import bridge fixes: the chat side
    // would request the raw path and hit 403. Pin it so a future
    // "let's broaden the serve route" diff doesn't reintroduce the
    // sandbox escape.
    const src = buildSourcePng();
    const { GET } = await import('@/app/api/media/serve/route');
    const { NextRequest } = await import('next/server');
    const url = `http://test.local/api/media/serve?path=${encodeURIComponent(src)}`;
    const req = new NextRequest(url);
    const res = await GET(req);
    assert.equal(res.status, 403, 'paths outside .codepilot-media MUST 403; serve route is the security boundary');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Source-pin: the env setup MUST be the first import (tech-debt #25 guard)
// ─────────────────────────────────────────────────────────────────────

describe('import order — env setup must run before any @/lib import', () => {
  it('the first `import` line in this file must be ./_codex-media-import-env', () => {
    // ESM imports execute in declaration order (siblings of the same
    // parent module). If anything triggering `@/lib/db` module-load
    // (directly or transitively) is imported BEFORE the env setup,
    // db.ts captures the user's real ~/.codepilot path and the test
    // silently re-pollutes the real DB — the exact failure mode
    // tech-debt #25 was about. A comment alone isn't enforcement;
    // this source pin will fail loudly if someone reorders.
    const src = fs.readFileSync(__filename, 'utf-8');
    const firstImportLine = src.split('\n').find((l) => l.trimStart().startsWith('import '));
    assert.ok(firstImportLine, 'test file must have at least one `import`');
    assert.match(
      firstImportLine!,
      /from\s+['"]\.\/_codex-media-import-env['"]/,
      `the FIRST import in codex-media-import.test.ts MUST be ./_codex-media-import-env (sets CLAUDE_GUI_DATA_DIR + pre-touches an empty DB before @/lib/db module-load). Got: ${firstImportLine}. Reordering will silently re-pollute the real ~/.codepilot/codepilot.db — see tech-debt #25.`,
    );
  });
});
