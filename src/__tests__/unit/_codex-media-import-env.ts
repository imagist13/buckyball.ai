/**
 * Side-effect setup module — MUST be the first import in
 * `codex-media-import.test.ts`. Two responsibilities, in order:
 *
 * 1. Set `CLAUDE_GUI_DATA_DIR` to a fresh temp root so that when the
 *    @/lib chain transitively loads `src/lib/db.ts` (which captures
 *    `process.env.CLAUDE_GUI_DATA_DIR` at module-load time, not
 *    per-call), the DB path lands inside the test root — NOT the user's
 *    real `~/.codepilot/codepilot.db`.
 *
 * 2. **Pre-touch an empty `codepilot.db`** at the test root path. Without
 *    this, db.ts's first-time-setup branch (db.ts ~line 59) sees the new
 *    dataDir has no DB and auto-migrates from `~/Library/Application
 *    Support/CodePilot/codepilot.db` — copying the user's REAL DB
 *    contents (rows + WAL + SHM) into the temp dir. That doesn't corrupt
 *    the real DB, but it (a) leaks real user data into /tmp on every
 *    test run (residue on interrupt), and (b) couples the test against
 *    real DB contents. Touching a 0-byte file first short-circuits the
 *    migration: SQLite treats the empty file as a fresh DB and db.ts
 *    creates its own schema. (Codex review P1 follow-up, 2026-05-28.)
 *
 * Tech-debt #25 root cause: the previous test set the env var inside
 * `beforeEach`, but ESM imports are hoisted, so `@/lib/db` had already
 * captured the real path before the env swap fired. Media files (read
 * env per-call) went to the temp dir; DB rows (captured path) went to
 * the real DB → 1896 dangling rows accumulated by 2026-05-28.
 *
 * Importing this module FIRST guarantees env-before-import (ES module
 * side effects run in declaration order across separate modules).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CODEX_MEDIA_TEST_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), 'codex-media-import-root-'),
);

process.env.CLAUDE_GUI_DATA_DIR = CODEX_MEDIA_TEST_ROOT;

// Pre-touch a 0-byte codepilot.db so db.ts's migration probe
// (`!fs.existsSync(DB_PATH)`) sees the DB "exists" and skips the
// auto-copy from `~/Library/Application Support/CodePilot/`. SQLite
// opens a 0-byte file as a brand-new DB; db.ts then runs its CREATE
// TABLE IF NOT EXISTS migrations against the empty file, so tests
// start from a clean, test-local schema with no real user data leaked.
fs.writeFileSync(path.join(CODEX_MEDIA_TEST_ROOT, 'codepilot.db'), '');

/** Path to the user's REAL DB — used by the regression guard to assert
 *  this test file does NOT leak any new rows into it. */
export const REAL_USER_DB_PATH = path.join(os.homedir(), '.codepilot', 'codepilot.db');
