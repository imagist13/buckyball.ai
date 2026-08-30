/**
 * Phase 4 / #577B (2026-06-02) — a correct answer followed by an "**Error:**"
 * bubble on a new session.
 *
 * Root cause: claude-client's SDK stream emits the `result` SSE and then keeps
 * awaiting `iter.next()` inside the same try; a post-result rejection (control
 * channel teardown racing capability capture, late stderr, etc.) falls into the
 * catch, which emits a structured `error` SSE AFTER the result. The frontend
 * faithfully renders it as an error bubble. (Native + Codex runtimes are
 * structurally safe — only the SDK path keeps awaiting after result.)
 *
 * Fix: a `resultEmitted` flag set right after the result enqueue. Once the turn
 * has produced a result it SUCCEEDED, so the catch must not (a) emit an error
 * event, (b) clear sdk_session_id, or (c) trigger the CONTEXT_TOO_LONG retry.
 *
 * Source pins (the SDK stream can't be unit-driven without mocking the whole
 * Agent SDK conversation iterator; a real "result-then-error suppressed" smoke
 * is a Phase 7 item).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const src = readFileSync(
  path.resolve(__dirname, '../../lib/claude-client.ts'),
  'utf8',
);

describe('claude-client — result-authoritative guard (#577B)', () => {
  it('declares the resultEmitted flag in the stream scope', () => {
    assert.match(src, /let resultEmitted = false;/);
  });

  it('sets resultEmitted = true immediately after the main result enqueue', () => {
    // The result SSE block ends with the terminal_reason spread; resultEmitted
    // must be set right after it so any later throw is treated as post-success.
    assert.match(
      src,
      /terminal_reason: terminalReason[\s\S]{0,160}resultEmitted = true;/,
      'resultEmitted must be set true right after the main-path result is enqueued',
    );
  });

  it('also sets resultEmitted = true after the compaction-retry (alt) result', () => {
    assert.match(
      src,
      /session_id: rMsg\.session_id[\s\S]{0,120}resultEmitted = true;/,
      'the retry path must set resultEmitted too',
    );
  });

  it('gates the catch error SSE on !resultEmitted (no error bubble after a result)', () => {
    assert.match(
      src,
      /if \(!resultEmitted\)\s*\{[\s\S]{0,400}type: 'error'/,
      'the structured error event must only be emitted when the turn had NOT already produced a result',
    );
  });

  it('does NOT clear sdk_session_id when a result was already produced', () => {
    // A succeeded turn's SDK session is valid and should resume next turn;
    // only a genuine crash (no result) clears it.
    assert.match(
      src,
      /if \(sessionId && !resultEmitted\)/,
      'sdk_session_id clear must be guarded by !resultEmitted',
    );
  });

  it('does NOT trigger the CONTEXT_TOO_LONG retry after a result (no double result)', () => {
    assert.match(
      src,
      /CONTEXT_TOO_LONG'[\s\S]{0,80}!resultEmitted/,
      'the reactive-compact retry must not fire once a result has been emitted',
    );
  });

  it('still always emits the terminal done event (stream is closed cleanly either way)', () => {
    // done is emitted unconditionally after the (now-gated) error block.
    assert.match(src, /type: 'done', data: '' \}\)\);\n\n        \/\/ Clear sdk_session_id/);
  });
});
