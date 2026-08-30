/**
 * Title provenance + CAS (Phase 1).
 *
 * The invariant under test, in one line: a title written by a human or by a
 * system that knows what the session IS must never be silently replaced by an
 * automatic writer. Everything below is a way for that to go wrong.
 *
 * Isolated temp DB — same pattern as session-search.test.ts.
 */

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-title-provenance-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

/* eslint-disable @typescript-eslint/no-require-imports */
const {
  createSession,
  getSession,
  deleteSession,
  updateSessionTitle,
  closeDb,
} = require('../../lib/db') as typeof import('../../lib/db');

const {
  claimTitleGeneration,
  commitGeneratedTitle,
  releaseTitleGeneration,
  __resetTitleClaimsForTest,
} = require('../../lib/title-generation-claim') as typeof import('../../lib/title-generation-claim');

const wd = tmpDir;

/** A normal user session: created as a placeholder, no title yet. */
const newPlaceholderSession = () => createSession(undefined, undefined, undefined, wd, 'code');

describe('createSession — origin at birth', () => {
  beforeEach(() => __resetTitleClaimsForTest());

  it('a session created with no title is a placeholder', () => {
    const s = newPlaceholderSession();
    assert.equal(s.title, 'New Chat');
    assert.equal(s.title_origin, 'placeholder');
  });

  it('a session created WITH a title defaults to manual (explicit intent)', () => {
    const s = createSession('My named chat', undefined, undefined, wd, 'code');
    assert.equal(s.title_origin, 'manual');
  });

  it('system callers record system origin', () => {
    const s = createSession('Bridge: alice', undefined, undefined, wd, 'code', undefined, undefined, undefined, 'system');
    assert.equal(s.title_origin, 'system');
  });

  it('the importer records import origin', () => {
    const s = createSession('Imported thing', undefined, undefined, wd, 'code', undefined, undefined, undefined, 'import');
    assert.equal(s.title_origin, 'import');
  });
});

describe('updateSessionTitle — CAS semantics', () => {
  beforeEach(() => __resetTitleClaimsForTest());

  it('fallback fills in a placeholder', () => {
    const s = newPlaceholderSession();
    const ok = updateSessionTitle(s.id, 'Fix login', 'fallback', { expectOrigin: ['placeholder'] });
    assert.equal(ok, true);
    const after = getSession(s.id);
    assert.equal(after?.title, 'Fix login');
    assert.equal(after?.title_origin, 'fallback');
  });

  it('a second fallback does NOT overwrite the first (only the first message names the chat)', () => {
    const s = newPlaceholderSession();
    updateSessionTitle(s.id, 'First message', 'fallback', { expectOrigin: ['placeholder'] });
    const ok = updateSessionTitle(s.id, 'Second message', 'fallback', { expectOrigin: ['placeholder'] });
    assert.equal(ok, false);
    assert.equal(getSession(s.id)?.title, 'First message');
  });

  it('fallback NEVER overwrites manual / system / import', () => {
    for (const origin of ['manual', 'system', 'import'] as const) {
      const s = createSession(`Kept ${origin}`, undefined, undefined, wd, 'code', undefined, undefined, undefined, origin);
      const ok = updateSessionTitle(s.id, 'clobbered', 'fallback', { expectOrigin: ['placeholder'] });
      assert.equal(ok, false, `${origin} must not accept a fallback`);
      const after = getSession(s.id);
      assert.equal(after?.title, `Kept ${origin}`);
      assert.equal(after?.title_origin, origin);
    }
  });

  it('a manual rename is an unconditional write and flips origin to manual', () => {
    const s = newPlaceholderSession();
    updateSessionTitle(s.id, 'auto title', 'fallback', { expectOrigin: ['placeholder'] });
    const ok = updateSessionTitle(s.id, 'My name for it', 'manual');
    assert.equal(ok, true);
    const after = getSession(s.id);
    assert.equal(after?.title, 'My name for it');
    assert.equal(after?.title_origin, 'manual');
  });

  it('a CAS write against a deleted session is a no-op, not a crash', () => {
    const s = newPlaceholderSession();
    deleteSession(s.id);
    assert.equal(updateSessionTitle(s.id, 'ghost', 'fallback', { expectOrigin: ['placeholder'] }), false);
    assert.equal(getSession(s.id), undefined);
  });

  it('an unconditional write against a deleted session reports false', () => {
    const s = newPlaceholderSession();
    deleteSession(s.id);
    assert.equal(updateSessionTitle(s.id, 'ghost', 'manual'), false);
  });
});

describe('generated titles — single-flight + claim gating', () => {
  beforeEach(() => __resetTitleClaimsForTest());

  /** A session that has a fallback title — the only state generation may act on. */
  const sessionWithFallback = () => {
    const s = newPlaceholderSession();
    updateSessionTitle(s.id, 'fallback title', 'fallback', { expectOrigin: ['placeholder'] });
    return s;
  };

  it('generated replaces fallback', () => {
    const s = sessionWithFallback();
    const token = claimTitleGeneration(s.id);
    assert.notEqual(token, null);
    assert.equal(commitGeneratedTitle(s.id, token!, 'Semantic summary'), true);
    const after = getSession(s.id);
    assert.equal(after?.title, 'Semantic summary');
    assert.equal(after?.title_origin, 'generated');
  });

  it('only one generation may be in flight per session', () => {
    const s = sessionWithFallback();
    const first = claimTitleGeneration(s.id);
    const second = claimTitleGeneration(s.id);
    assert.notEqual(first, null);
    assert.equal(second, null, 'second concurrent claim must be refused');
  });

  it('a second result cannot overwrite the first', () => {
    const s = sessionWithFallback();
    const token = claimTitleGeneration(s.id)!;
    assert.equal(commitGeneratedTitle(s.id, token, 'First result'), true);
    // Same token replayed (a retried callback): claim was released at commit.
    assert.equal(commitGeneratedTitle(s.id, token, 'Second result'), false);
    assert.equal(getSession(s.id)?.title, 'First result');
  });

  it('an expired / superseded claim cannot write', () => {
    const s = sessionWithFallback();
    const stale = claimTitleGeneration(s.id)!;
    releaseTitleGeneration(s.id, stale); // e.g. timed out and gave up
    const fresh = claimTitleGeneration(s.id)!;
    assert.equal(commitGeneratedTitle(s.id, stale, 'Stale result'), false);
    assert.equal(getSession(s.id)?.title, 'fallback title', 'stale writer must not land');
    assert.equal(commitGeneratedTitle(s.id, fresh, 'Fresh result'), true);
  });

  it('a manual rename that lands mid-generation WINS', () => {
    const s = sessionWithFallback();
    const token = claimTitleGeneration(s.id)!;
    // ...user renames while the provider call is in flight...
    updateSessionTitle(s.id, 'User decides', 'manual');
    // ...generation comes back and must lose.
    assert.equal(commitGeneratedTitle(s.id, token, 'Model decides'), false);
    const after = getSession(s.id);
    assert.equal(after?.title, 'User decides');
    assert.equal(after?.title_origin, 'manual');
  });

  it('generation cannot touch a system or import session even with a valid claim', () => {
    for (const origin of ['system', 'import'] as const) {
      const s = createSession(`Kept ${origin}`, undefined, undefined, wd, 'code', undefined, undefined, undefined, origin);
      const token = claimTitleGeneration(s.id)!;
      assert.equal(commitGeneratedTitle(s.id, token, 'Model rename'), false);
      assert.equal(getSession(s.id)?.title, `Kept ${origin}`);
    }
  });

  it('a deleted session is a no-op', () => {
    const s = sessionWithFallback();
    const token = claimTitleGeneration(s.id)!;
    deleteSession(s.id);
    assert.equal(commitGeneratedTitle(s.id, token, 'Ghost title'), false);
  });

  it('empty / junk model output keeps the fallback', () => {
    for (const junk of ['', '   ', '\n\n']) {
      const s = sessionWithFallback();
      const token = claimTitleGeneration(s.id)!;
      assert.equal(commitGeneratedTitle(s.id, token, junk), false);
      assert.equal(getSession(s.id)?.title, 'fallback title');
    }
  });

  it('generated output is cleaned through the same pure function', () => {
    const s = sessionWithFallback();
    const token = claimTitleGeneration(s.id)!;
    commitGeneratedTitle(s.id, token, '  Multi\nline   model output  ');
    assert.equal(getSession(s.id)?.title, 'Multi line model output');
  });

  it('a failed commit releases the claim so the session is not wedged', () => {
    const s = sessionWithFallback();
    const first = claimTitleGeneration(s.id)!;
    commitGeneratedTitle(s.id, first, ''); // fails on empty output
    assert.notEqual(claimTitleGeneration(s.id), null, 'slot must be free again');
  });
});

describe('title_origin migration', () => {
  it('is idempotent and backfills legacy rows without touching titles', () => {
    // Simulate a pre-migration DB: chat_sessions WITHOUT title_origin, holding
    // one untitled row and one row the user already sees a real title on.
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-title-legacy-'));
    const dbPath = path.join(legacyDir, 'codepilot.db');
    /* eslint-disable @typescript-eslint/no-require-imports */
    const Database = require('better-sqlite3');
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New Chat',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        model TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        working_directory TEXT NOT NULL DEFAULT '',
        sdk_session_id TEXT NOT NULL DEFAULT ''
      );
    `);
    raw.prepare("INSERT INTO chat_sessions (id, title) VALUES ('legacy-untitled', 'New Chat')").run();
    raw.prepare("INSERT INTO chat_sessions (id, title) VALUES ('legacy-named', 'My old project')").run();
    raw.prepare("INSERT INTO chat_sessions (id, title) VALUES ('legacy-empty', '')").run();
    raw.close();

    // Point a fresh module instance at it and let migrateDb run.
    const prevDir = process.env.CLAUDE_GUI_DATA_DIR;
    process.env.CLAUDE_GUI_DATA_DIR = legacyDir;
    delete require.cache[require.resolve('../../lib/db')];
    const legacyDb = require('../../lib/db') as typeof import('../../lib/db');

    const untitled = legacyDb.getSession('legacy-untitled');
    const named = legacyDb.getSession('legacy-named');
    const empty = legacyDb.getSession('legacy-empty');

    // 'New Chat' / '' never had a real title → placeholder, so the next real
    // message fills in a fallback.
    assert.equal(untitled?.title_origin, 'placeholder');
    assert.equal(empty?.title_origin, 'placeholder');
    // A legacy row with a real title is indistinguishable from a hand-typed
    // rename, so it is backfilled 'manual' — the conservative direction.
    assert.equal(named?.title_origin, 'manual');
    // No migration may rewrite a title the user can already see.
    assert.equal(named?.title, 'My old project');

    // Idempotent: re-running the migration changes nothing.
    legacyDb.closeDb();
    delete require.cache[require.resolve('../../lib/db')];
    const again = require('../../lib/db') as typeof import('../../lib/db');
    assert.equal(again.getSession('legacy-named')?.title_origin, 'manual');
    assert.equal(again.getSession('legacy-named')?.title, 'My old project');
    assert.equal(again.getSession('legacy-untitled')?.title_origin, 'placeholder');
    again.closeDb();

    process.env.CLAUDE_GUI_DATA_DIR = prevDir;
    delete require.cache[require.resolve('../../lib/db')];
  });

  it('recovers when the column exists but the backfill never ran', () => {
    // The crash window: ADD COLUMN and the backfill UPDATE are two statements.
    // If the process dies between them, the column is there and every legacy
    // row sits at '' — an origin no writer ever produces. A boot that keys the
    // backfill off "column missing?" would skip these rows forever, leaving
    // them unclassified and outside every CAS rule.
    const halfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-title-half-'));
    const dbPath = path.join(halfDir, 'codepilot.db');
    /* eslint-disable @typescript-eslint/no-require-imports */
    const Database = require('better-sqlite3');
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT 'New Chat',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        model TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        working_directory TEXT NOT NULL DEFAULT '',
        sdk_session_id TEXT NOT NULL DEFAULT '',
        title_origin TEXT NOT NULL DEFAULT ''
      );
    `);
    raw.prepare("INSERT INTO chat_sessions (id, title, title_origin) VALUES ('half-named', 'Old real title', '')").run();
    raw.prepare("INSERT INTO chat_sessions (id, title, title_origin) VALUES ('half-untitled', 'New Chat', '')").run();
    // A row that DID get classified must not be re-decided by the recovery pass.
    raw.prepare("INSERT INTO chat_sessions (id, title, title_origin) VALUES ('half-done', 'Fallback text', 'fallback')").run();
    raw.close();

    const prevDir = process.env.CLAUDE_GUI_DATA_DIR;
    process.env.CLAUDE_GUI_DATA_DIR = halfDir;
    delete require.cache[require.resolve('../../lib/db')];
    const recovered = require('../../lib/db') as typeof import('../../lib/db');

    assert.equal(recovered.getSession('half-named')?.title_origin, 'manual', 'unclassified legacy title must be recovered');
    assert.equal(recovered.getSession('half-untitled')?.title_origin, 'placeholder');
    assert.equal(recovered.getSession('half-done')?.title_origin, 'fallback', 'an already-classified row must not be re-stamped');
    recovered.closeDb();

    process.env.CLAUDE_GUI_DATA_DIR = prevDir;
    delete require.cache[require.resolve('../../lib/db')];
  });
});

describe('title_origin round-trips through the DB', () => {
  it('every origin survives a write → read cycle', () => {
    for (const origin of ['placeholder', 'fallback', 'generated', 'manual', 'system', 'import'] as const) {
      const s = createSession('roundtrip', undefined, undefined, wd, 'code', undefined, undefined, undefined, origin);
      assert.equal(getSession(s.id)?.title_origin, origin, `origin ${origin} must round-trip`);
    }
  });
});

after(() => {
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
