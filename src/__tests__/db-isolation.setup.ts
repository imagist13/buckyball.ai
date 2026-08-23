/**
 * Global unit-test DB isolation â€?D2 flake fix (tech-debt #11 / #25 / #30 family).
 *
 * ROOT CAUSE of the "apply-discovery-diff / stale-default-provider pass in
 * isolation but flake under the full suite" problem: `tsx --test *.test.ts`
 * runs test FILES in PARALLEL worker processes (node:test default concurrency
 * = CPU count). Before this setup, unit tests did NOT set
 * `CLAUDE_GUI_DATA_DIR`, so EVERY DB-touching test read/wrote the user's REAL
 * `~/.codepilot/codepilot.db` CONCURRENTLY. Two consequences:
 *   1. **Flake** â€?parallel access to one SQLite file races (uncommitted /
 *      cross-test row visibility, lock contention) â†?intermittent failures
 *      under full-suite load that vanish when a file runs alone. This blocked
 *      commits repeatedly and forced `--no-verify`.
 *   2. **Real-DB pollution** (#25 family) â€?uncleaned test rows leaked into the
 *      user's real gallery / providers DB.
 *
 * FIX: preloaded via `tsx --test --import ./src/__tests__/db-isolation.setup.ts`,
 * this module runs ONCE PER WORKER PROCESS *before any test file loads
 * `@/lib/db`* (which captures `CLAUDE_GUI_DATA_DIR` at module-load time). Each
 * worker therefore gets its OWN fresh temp DB â†?no shared-file races, no
 * real-DB pollution.
 *
 * Pre-touches an empty `codepilot.db` so db.ts's first-run branch treats the
 * temp dir as a fresh install instead of COPYING the real DB from
 * `~/Library/Application Support/...` (same trick as the per-file
 * `_codex-media-import-env.ts`; this generalises it to the whole suite).
 *
 * Guarded on `!CLAUDE_GUI_DATA_DIR` so a file that sets its own test root
 * first (e.g. codex-media-import) or an explicit CI override still wins.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Worker-wide backstop against real-DB leakage. Even if a test re-points
// CLAUDE_GUI_DATA_DIR to its own temp dir in beforeEach WITHOUT pre-touching
// an empty codepilot.db, db.ts must never copy the user's real
// ~/Library/.../codepilot.db into it. This flag makes db.ts skip the
// legacy-migration copy for the whole process (see db.ts getDb()). Set
// unconditionally â€?it must hold no matter who owns CLAUDE_GUI_DATA_DIR.
process.env.CODEPILOT_DISABLE_DB_MIGRATION_IN_TESTS = '1';
// Exercise the production envelope-encryption path in every DB-touching unit
// test while keeping the deterministic test key isolated to this worker.
process.env.CODEPILOT_PROVIDER_SECRET_KEY ??= Buffer.alloc(32, 0x42).toString('base64');
process.env.CODEPILOT_PROVIDER_SECRET_BACKEND ??= 'test';
process.env.CODEPILOT_PROVIDER_SECRET_LEVEL ??= 'test';

if (!process.env.CLAUDE_GUI_DATA_DIR) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-unit-db-'));
  process.env.CLAUDE_GUI_DATA_DIR = root;
  try {
    // Empty file â†?SQLite/db.ts treats it as a brand-new DB and CREATEs the
    // schema, short-circuiting the "copy real DB into fresh dataDir" migration.
    fs.writeFileSync(path.join(root, 'codepilot.db'), '');
  } catch {
    /* best effort â€?if the touch fails db.ts still uses the temp dir */
  }
}
