/**
 * anthropic-sampling-notice.test.ts — executable behavior test for the sampling
 *告知链 (model plan Phase 2 / s04, Codex review P2 2026-07-18).
 *
 * The finding: `sanitizeClaudeModelOptions` stripped Sonnet 5's non-default
 * temperature/topP/topK and reported it in `strippedSamplingParams`, but that
 * field had ZERO production consumers — grep hit only the sanitizer itself and
 * its unit tests. So the strip was SILENT: only tests could see the signal, and
 * neither Runtime passed real sampling fields into the sanitizer at all.
 *
 * These tests assert the notification DECISION on the shared builder both
 * runtimes call (not just that the sanitizer returns an object), plus source
 * pins that each runtime actually consumes it and threads real request fields in.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSamplingIgnoredNotice } from '../../lib/anthropic-sampling-notice';
import { sanitizeClaudeModelOptions } from '../../lib/claude-model-options';

const read = (rel: string) => readFileSync(join(process.cwd(), 'src/lib', rel), 'utf8');

// Mirror the production call: sanitize the REAL request fields, then decide.
function noticeFor(opts: {
  runtime: 'native' | 'sdk';
  model: string;
  temperature?: number;
  topP?: number;
  topK?: number;
}) {
  const sanitized = sanitizeClaudeModelOptions({
    model: opts.model,
    temperature: opts.temperature,
    topP: opts.topP,
    topK: opts.topK,
  });
  return buildSamplingIgnoredNotice({ runtime: opts.runtime, model: opts.model, sanitized });
}

describe('s04 — stripped sampling params raise a real notification (native)', () => {
  it('sonnet-5 + temperature 0.7 → SAMPLING_PARAMS_IGNORED naming temperature', () => {
    const notice = noticeFor({ runtime: 'native', model: 'claude-sonnet-5', temperature: 0.7 });
    assert.ok(notice, 'a stripped param MUST produce a notice — silence is the bug');
    assert.equal(notice.code, 'SAMPLING_PARAMS_IGNORED');
    assert.equal(notice.reason, 'model-rejects');
    assert.deepEqual(notice.unsent, ['temperature']);
    assert.equal(notice.params.names, 'temperature');
    assert.equal(notice.params.model, 'claude-sonnet-5',
      'the model must ride in params so the copy can name it in any locale');
  });

  it('the notice carries NO rendered prose (server must not pick a language)', () => {
    const notice = noticeFor({ runtime: 'native', model: 'claude-sonnet-5', temperature: 0.7 });
    assert.ok(notice);
    // Codex review P2 (2026-07-18): the builder used to hardcode English
    // title/message, so zh users got an English toast for a decision the app
    // made for them. The payload is now decision + params only.
    assert.equal('message' in notice, false);
    assert.equal('title' in notice, false);
  });

  it('all three params stripped → all three named, plural copy', () => {
    const notice = noticeFor({
      runtime: 'native', model: 'claude-sonnet-5', temperature: 0.2, topP: 0.9, topK: 40,
    });
    assert.ok(notice);
    assert.deepEqual(notice.unsent, ['temperature', 'topP', 'topK']);
    assert.equal(notice.params.count, 3, 'count drives plural key selection on the client');
    assert.equal(notice.params.names, 'temperature, topP, topK');
  });

  it('the whole adaptive family notifies, not just sonnet-5', () => {
    for (const model of ['claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7']) {
      const notice = noticeFor({ runtime: 'native', model, temperature: 0.5 });
      assert.ok(notice, `${model} strips sampling — it must notify`);
    }
  });

  it('default temperature (1) is sent, so NO notice fires', () => {
    assert.equal(noticeFor({ runtime: 'native', model: 'claude-sonnet-5', temperature: 1 }), null,
      'temperature=1 is Anthropic default — nothing dropped, no misleading toast');
  });

  it('no sampling params at all → no notice (today\'s default path is unchanged)', () => {
    assert.equal(noticeFor({ runtime: 'native', model: 'claude-sonnet-5' }), null);
  });

  it('non-adaptive sonnet-4-6 keeps its sampling AND stays silent on native', () => {
    // Survivors are forwarded to streamText on this runtime, so there is
    // genuinely nothing to announce — the guard must not misfire.
    assert.equal(noticeFor({ runtime: 'native', model: 'claude-sonnet-4-6', temperature: 0.3 }), null);
  });
});

describe('s04 — SDK runtime announces every unsent param (it can send none)', () => {
  it('sonnet-4-6 + temperature → notice, because query() has no sampling knobs', () => {
    const notice = noticeFor({ runtime: 'sdk', model: 'claude-sonnet-4-6', temperature: 0.3 });
    assert.ok(notice, 'a param that survives sanitization is still unsent on the SDK runtime');
    assert.deepEqual(notice.unsent, ['temperature']);
    assert.equal(notice.reason, 'runtime-cannot-send',
      'the SDK failure mode is distinct from "the model rejects it" — different copy');
  });

  it('sonnet-5 + stripped params → same code as native, runtime-accurate copy', () => {
    const notice = noticeFor({ runtime: 'sdk', model: 'claude-sonnet-5', topP: 0.5 });
    assert.ok(notice);
    assert.equal(notice.code, 'SAMPLING_PARAMS_IGNORED',
      'both runtimes use one code so the toast whitelist covers both');
    assert.deepEqual(notice.unsent, ['topP']);
  });

  it('no sampling params → no notice on the SDK runtime either', () => {
    assert.equal(noticeFor({ runtime: 'sdk', model: 'claude-sonnet-5' }), null);
  });
});

describe('s04 — production wiring (the finding was zero consumers)', () => {
  it('agent-loop threads REAL request sampling fields into the sanitizer', () => {
    const src = read('agent-loop.ts');
    assert.match(src, /sanitizeClaudeModelOptions\(\{[\s\S]{0,220}temperature,[\s\S]{0,60}topP,[\s\S]{0,60}topK,/,
      'the sanitizer must receive the turn\'s real sampling params, not nothing');
    assert.match(src, /buildSamplingIgnoredNotice\(\{/,
      'agent-loop must consume the notice builder');
    assert.match(src, /code: samplingNotice\.code/,
      'the notice must be emitted as an SSE status notification');
    assert.match(src, /reason: samplingNotice\.reason/,
      'the SSE payload must carry the localizable reason, not English prose');
    assert.match(src, /\.\.\.sanitized\.sampling,/,
      'sanitized survivors must reach streamText on the native path');
  });

  it('claude-client (SDK runtime) does the same', () => {
    const src = read('claude-client.ts');
    assert.match(src, /sanitizeClaudeModelOptions\(\{[\s\S]{0,220}temperature,[\s\S]{0,60}topP,[\s\S]{0,60}topK,/);
    assert.match(src, /buildSamplingIgnoredNotice\(\{[\s\S]{0,80}runtime: 'sdk'/);
    assert.match(src, /code: samplingNotice\.code/);
  });

  it('strippedSamplingParams now has production consumers (regression guard)', () => {
    // The finding was literally "grep only hits the sanitizer and its tests".
    const notice = read('anthropic-sampling-notice.ts');
    assert.match(notice, /strippedSamplingParams/,
      'the shared builder is the production consumer both runtimes route through');
  });

  it('the toast whitelist carries the new code (otherwise the toast never shows)', () => {
    const sse = readFileSync(join(process.cwd(), 'src/hooks/useSSEStream.ts'), 'utf8');
    assert.match(sse, /'SAMPLING_PARAMS_IGNORED'/,
      'a status code outside TOAST_STATUS_CODES is dropped by the next status update');
  });
});
