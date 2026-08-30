/**
 * Global unit-test DB isolation — D2 flake fix (tech-debt #11 / #25 / #30 family).
 *
 * ROOT CAUSE of the "apply-discovery-diff / stale-default-provider pass in
 * isolation but flake under the full suite" problem: `tsx --test *.test.ts`
 * runs test FILES in PARALLEL worker processes (node:test default concurrency
 * = CPU count). Before this setup, unit tests did NOT set
 * `CLAUDE_GUI_DATA_DIR`, so EVERY DB-touching test read/wrote the user's REAL
 * `~/.codepilot/codepilot.db` CONCURRENTLY. Two consequences:
 *   1. **Flake** — parallel access to one SQLite file races (uncommitted /
 *      cross-test row visibility, lock contention) → intermittent failures
 *      under full-suite load that vanish when a file runs alone. This blocked
 *      commits repeatedly and forced `--no-verify`.
 *   2. **Real-DB pollution** (#25 family) — uncleaned test rows leaked into the
 *      user's real gallery / providers DB.
 *
 * FIX: the repository test command preloads this module once per worker before
 * its test files. Each worker gets its own fresh temp DB, so the normal full
 * suite has no shared-file race and cannot touch the real DB. Tests that are
 * intentionally runnable outside that command still import this setup first.
 *
 * `CODEPILOT_DISABLE_DB_MIGRATION_IN_TESTS=1` makes the empty temp directory a
 * fresh install without copying the real DB. Do not pre-touch a zero-byte DB:
 * SQLite can initialize that existing file as an empty valid database, which
 * changes the code path from "new install" to "existing DB" and hides legacy-
 * copy/bootstrap mistakes from tests.
 *
 * Guarded on `!CLAUDE_GUI_DATA_DIR` so a file that sets its own test root
 * first (e.g. codex-media-import) or an explicit CI override still wins.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Independent migration-copy guard: a test may deliberately re-point the data
// directory after db-isolation has loaded. That empty test directory is still
// a fresh install and must never trigger production legacy-path discovery.
// This does not depend on pre-creating an empty SQLite file (which SQLite may
// accept and initialize, changing the bootstrap branch under test).
process.env.CODEPILOT_DISABLE_DB_MIGRATION_IN_TESTS = '1';
// Exercise the production envelope-encryption path in every DB-touching unit
// test while keeping the deterministic test key isolated to this worker.
process.env.CODEPILOT_PROVIDER_SECRET_KEY ??= Buffer.alloc(32, 0x42).toString('base64');
process.env.CODEPILOT_PROVIDER_SECRET_BACKEND ??= 'test';
process.env.CODEPILOT_PROVIDER_SECRET_LEVEL ??= 'test';

if (!process.env.CLAUDE_GUI_DATA_DIR) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-unit-db-'));
  process.env.CLAUDE_GUI_DATA_DIR = root;
}
