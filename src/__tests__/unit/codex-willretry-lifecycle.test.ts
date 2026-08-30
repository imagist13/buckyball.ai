/**
 * Phase 5b smoke round 6 (2026-05-18) — Codex `error willRetry=true`
 * non-terminal lifecycle contract.
 *
 * Real Codex behaviour the user surfaced via real-credential smoke:
 *
 *   POST /api/codex/proxy/v1/responses → 200
 *   ... assistant_delta chunks ...
 *   error notification { willRetry: true, error: { ... }, turnId }
 *   ⇣ app-server keeps retrying internally ("stream disconnected —
 *     retrying sampling request (n/5)") up to 5 times
 *   ⇣ eventually: turn/completed status=completed | failed
 *
 * Pre-fix: the event-mapper unconditionally translated the `error`
 * notification to `run_failed`, and the runtime wildcard handler
 * closed the stream on any `run_failed`. CodePilot's chat UI saw
 * error + done while Codex was still working — and the next
 * `thread/resume` could trip "config overrides ignored for running
 * thread".
 *
 * Fix shape:
 *   1. event-mapper.ts: when `params.willRetry === true`, return
 *      `unknown_item` (sourceType='codex_retry') instead of
 *      `run_failed`. Terminal mapping is gated strictly on
 *      `willRetry !== true` (false / undefined / missing all keep
 *      the old terminal behaviour — defensive: never assume
 *      recovery).
 *   2. runtime.ts: existing wildcard handler closes stream only on
 *      `run_completed | run_failed`. `unknown_item` does NOT close
 *      — verified via source-pin below — so the stream stays open
 *      for the upcoming retry + eventual turn/completed.
 *
 * Tests:
 *   - Runtime semantics pinned via the existing source-grep in
 *     `codex-interrupt-contract.test.ts` (close condition is
 *     literally `run_completed || run_failed`) — adding an
 *     anti-regression here so a refactor can't insert
 *     `|| 'unknown_item'` without intent.
 *   - Per-shape mapper assertions live in
 *     `codex-event-mapper.test.ts` (three new pins around willRetry
 *     true / false / undefined).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const runtimeSrc = fs.readFileSync(
  path.resolve(__dirname, '../../lib/codex/runtime.ts'),
  'utf8',
);
const mapperSrc = fs.readFileSync(
  path.resolve(__dirname, '../../lib/codex/event-mapper.ts'),
  'utf8',
);

describe('Codex willRetry lifecycle — round 6 contract', () => {
  it('runtime wildcard close condition is EXACTLY run_completed | run_failed (no unknown_item leak)', () => {
    // The Phase 5b round 6 fix relies on `unknown_item` NOT closing
    // the stream. If a future refactor adds another terminal type
    // here, the willRetry stream-stays-open contract breaks.
    assert.match(
      runtimeSrc,
      /if\s*\(event\?\.type\s*===\s*'run_completed'\s*\|\|\s*event\?\.type\s*===\s*'run_failed'\)\s*\{/,
      'runtime wildcard close condition has drifted — must be strictly `run_completed || run_failed`',
    );
    // Anti-leak — confirm the close branch does NOT mention `unknown_item`.
    const closeBlockMatch = runtimeSrc.match(
      /if\s*\(event\?\.type\s*===\s*'run_completed'\s*\|\|\s*event\?\.type\s*===\s*'run_failed'\)\s*\{[\s\S]{0,400}?closeStream\(\)/,
    );
    assert.ok(closeBlockMatch, 'cannot locate the close branch');
    assert.ok(
      !closeBlockMatch![0].includes('unknown_item'),
      'close branch must NOT reference unknown_item — willRetry retries depend on unknown_item being non-terminal',
    );
  });

  it('event-mapper has an explicit willRetry===true guard (terminal fallback still wired)', () => {
    // Source-grep pin — make sure a refactor can't quietly delete the
    // willRetry check. Ordering against `makeRunFailed` isn't pinned
    // here because the file has two makeRunFailed sites (turn/completed
    // failed AND the terminal error fallback); the per-shape ordering
    // is exercised by the unit tests in codex-event-mapper.test.ts:
    // willRetry=true → unknown_item, willRetry=false → run_failed,
    // willRetry=undefined → run_failed. Those are the behavioural
    // anchors; this is the structural belt.
    assert.match(
      mapperSrc,
      /p\.willRetry\s*===\s*true/,
      'event-mapper must check `p.willRetry === true` explicitly so willRetry stays non-terminal',
    );
    assert.match(
      mapperSrc,
      /makeRunFailed\(base/,
      'event-mapper must still call makeRunFailed for terminal errors (regression — both behaviours coexist)',
    );
  });

  it('event-mapper willRetry branch tags unknown_item with sourceType=codex_retry', () => {
    // Pin the canonical shape — the runtime treats sourceType as the
    // adapter-defined display key. If a refactor changes the key,
    // the chat UI hint won't fire even though the stream stays open.
    // Tests in codex-event-mapper.test.ts pin the actual emitted
    // event object; this is just a source-grep belt.
    assert.match(
      mapperSrc,
      /sourceType:\s*['"]codex_retry['"]/,
      "willRetry branch must tag sourceType='codex_retry'",
    );
    assert.match(
      mapperSrc,
      /type:\s*['"]unknown_item['"]/,
      'willRetry branch must emit type=unknown_item',
    );
  });
});
