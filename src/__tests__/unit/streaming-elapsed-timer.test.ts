/**
 * StreamingMessage's ElapsedTimer must not render "NaNs" or other
 * arithmetic-garbage display when `startedAt` is not yet a real
 * positive timestamp.
 *
 * User-caught (2026-05-15): right after Send is clicked, the parent
 * sets `isStreaming = true` before the stream snapshot has latched
 * a `startedAt`. During that single render tick, ElapsedTimer
 * received `startedAt` as `0` / `undefined` / `NaN`, and rendered
 * `${secs}s` where `secs = NaN`, producing the visible "NaNs"
 * flash next to the "Thinking" shimmer.
 *
 * Pin the guard so a future refactor can't strip it and re-introduce
 * the flash. Pure source-grep — the helper is internal to the
 * StreamingMessage module (not exported), so we read the source and
 * assert the structural shape rather than calling it directly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../../components/chat/StreamingMessage.tsx'),
  'utf8',
);

describe('ElapsedTimer — guards against pre-stream startedAt flash', () => {
  it('declares a startedAtIsReady gate using Number.isFinite + positive check', () => {
    // The gate must be a real numeric validation, not just `startedAt
    // > 0` (which would let `NaN > 0` slip through as `false`, but
    // `undefined > 0` also slips through — Number.isFinite is the
    // load-bearing piece because it rejects both NaN and undefined).
    assert.match(
      SRC,
      /startedAtIsReady\s*=\s*Number\.isFinite\(startedAt\)\s*&&\s*startedAt\s*>\s*0/,
    );
  });

  it('ElapsedTimer early-returns null when startedAt is not ready', () => {
    // Without this early return the JSX still renders the
    // `${secs}s` span — even if the elapsed state was clamped to
    // 0 in the useState init, the user would see a static "0s"
    // flash next to "Thinking", which is just as wrong (the timer
    // shouldn't appear until streaming has actually started).
    assert.match(
      SRC,
      /if\s*\(\s*!startedAtIsReady\s*\)\s*return\s+null/,
    );
  });

  it('useState initialiser respects the gate so elapsed never starts as NaN', () => {
    // Pre-fix the init was `Math.floor((Date.now() - startedAt) /
    // 1000)` — with `startedAt = undefined`, that's NaN. With
    // `startedAt = 0`, that's a 1.7e9 huge number. Both bad.
    // (Regex uses `[\s\S]*?` because the init body contains nested
    // parens — a `[^)]*` token would stop at the first `)`.)
    assert.match(
      SRC,
      /useState\([\s\S]*?startedAtIsReady\s*\?\s*Math\.floor\(\(Date\.now\(\)\s*-\s*startedAt\)\s*\/\s*1000\)\s*:\s*0/,
    );
  });

  it('interval / reset effects also skip when startedAt is not ready', () => {
    // Without the gate inside the effects, setInterval would keep
    // calling setElapsed with NaN until startedAt landed. The
    // visible flash would persist for at least one tick of the
    // 1000ms interval — not the single-render flicker we want.
    const intervalGate = SRC.match(
      /useEffect\([\s\S]{0,200}?if\s*\(\s*!startedAtIsReady\s*\)\s*return\s*;[\s\S]{0,200}?setInterval/,
    );
    assert.ok(
      intervalGate,
      'the setInterval-driven effect must early-return when startedAtIsReady is false',
    );
  });
});
