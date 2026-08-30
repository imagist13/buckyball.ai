/**
 * #629 — stale/bad resume returns as an is_error RESULT (not a throw).
 *
 * POC-B (2026-06-26, docs/research/issue-629-resume-error-shape-poc/): four
 * third-party Anthropic-compatible proxies (GLM / MiMo / DeepSeek / Aliyun) all
 * returned the same shape — first message is a `result`, `is_error=true`,
 * `subtype='error_during_execution'`, `errors[0]="No conversation found with
 * session ID: <sid>"`. The bad sdk_session_id was left in the DB, so the next
 * message retried the broken resume.
 *
 * Two layers pinned here:
 *   1. classifier — the real wording now maps to RESUME_FAILED (it was UNKNOWN;
 *      existing 'conversation not found' has the wrong word order, and the
 *      session-id regex needs "not found" AFTER the id) and the clear-decision
 *      helper fires ONLY for resume/session-state, never for transient
 *      rate-limit/auth/budget (the regression a naive "clear on any is_error"
 *      would cause).
 *   2. claude-client wiring — source pins (the SDK conversation iterator can't be
 *      unit-driven without mocking the whole Agent SDK; same constraint as
 *      stream-result-error-guard.test.ts).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { classifyError, isSessionStateResultError } from '../../lib/error-classifier';

const REAL = 'No conversation found with session ID: 00000000-0000-4000-8000-000000000629';

describe('#629 — classifier maps the real proxy wording to RESUME_FAILED', () => {
  it('classifies "No conversation found with session ID: <sid>" as RESUME_FAILED', () => {
    assert.equal(classifyError({ error: REAL }).category, 'RESUME_FAILED');
  });

  it('matches the wording regardless of the session id (all four proxies share it)', () => {
    for (const sid of ['abc', '00000000-0000-4000-8000-000000000629', 'deadbeef']) {
      assert.equal(
        classifyError({ error: `No conversation found with session ID: ${sid}` }).category,
        'RESUME_FAILED',
        `sid=${sid} should classify as RESUME_FAILED`,
      );
    }
  });
});

describe('#629 — isSessionStateResultError gates the sdk_session_id clear', () => {
  it('clears for the real proxy wording', () => {
    assert.equal(isSessionStateResultError([REAL]), true);
  });

  it('clears for genuine resume / session-state errors', () => {
    assert.equal(isSessionStateResultError(['could not resume conversation']), true);
    assert.equal(isSessionStateResultError(['stale session state detected']), true);
  });

  it('does NOT clear for transient errors — rate-limit / auth / budget (regression guard)', () => {
    assert.equal(isSessionStateResultError(['429 rate_limit_error: too many requests']), false);
    assert.equal(isSessionStateResultError(['401 Unauthorized: invalid api key']), false);
    assert.equal(isSessionStateResultError(['error_max_budget_usd exceeded']), false);
  });

  it('does NOT clear when errors[] is empty / null / undefined (no text signal)', () => {
    assert.equal(isSessionStateResultError([]), false);
    assert.equal(isSessionStateResultError(null), false);
    assert.equal(isSessionStateResultError(undefined), false);
  });

  it('joins multiple errors before classifying', () => {
    assert.equal(isSessionStateResultError(['turn aborted by user', REAL]), true);
  });
});

describe('#629 — claude-client wiring (source pins)', () => {
  const src = readFileSync(path.resolve(__dirname, '../../lib/claude-client.ts'), 'utf8');

  it('imports isSessionStateResultError from error-classifier', () => {
    assert.match(
      src,
      /import \{[^}]*isSessionStateResultError[^}]*\} from '\.\/error-classifier'/,
    );
  });

  it('reads resultMsg.errors via cast (SDKResultSuccess has no errors[])', () => {
    assert.match(
      src,
      /const resultErrors = \(resultMsg as SDKResultMessage & \{ errors\?: string\[\] \}\)\.errors \?\? \[\]/,
    );
  });

  it('clears sdk_session_id in the is_error branch ONLY via isSessionStateResultError (owner-gated in Phase 3 B)', () => {
    // Session ownership: the clear now goes through `clearSdkSessionIfOwner`
    // (which internally does updateSdkSessionId(sessionId, '') only when this
    // turn still owns the lock). The #629 semantic — clear ONLY for
    // session-state is_error results — is unchanged: the outer
    // `isSessionStateResultError(resultErrors …)` guard still gates it.
    assert.match(
      src,
      /if \(resultMsg\.is_error\)[\s\S]{0,900}if \(sessionId && isSessionStateResultError\(resultErrors[\s\S]{0,300}clearSdkSessionIfOwner\(sessionId, options\.lockId\)/,
      'the is_error result branch must gate the sdk_session_id clear on isSessionStateResultError, via the owner-gated helper',
    );
  });

  it('surfaces errors / stop_reason in the result event for diagnostics', () => {
    assert.match(src, /\.\.\.\(resultMsg\.is_error && resultErrors\.length \? \{ errors: resultErrors \} : \{\}\)/);
    assert.match(src, /\.\.\.\(resultMsg\.stop_reason \? \{ stop_reason: resultMsg\.stop_reason \} : \{\}\)/);
  });

  it('keeps #577 result-authoritative ordering intact (resultEmitted right after result)', () => {
    // errors / stop_reason were inserted BEFORE terminal_reason, so the
    // terminal_reason → resultEmitted distance is unchanged.
    assert.match(src, /terminal_reason: terminalReason \} : \{\}\),[\s\S]{0,80}resultEmitted = true;/);
  });
});

describe('#629 — collect-stream-response persistence wiring (source pins)', () => {
  // The clear in claude-client is not enough: the result SSE was emitted with
  // session_id, and the server-side collect path (/api/chat persistence) must
  // NOT write that bad id back (P1). It must also surface the error so a failed
  // is_error turn persists a visible bubble (P2).
  //
  // Session ownership rework: `collectStreamResponse` moved out of `route.ts`
  // into `src/lib/chat-collect-stream-response.ts` (Next App Router forbids
  // non-method exports from a route module). These pins follow the code to its
  // new home; the assertions themselves are unchanged.
  const collectSrc = readFileSync(path.resolve(__dirname, '../../lib/chat-collect-stream-response.ts'), 'utf8');

  it('imports isSessionStateResultError', () => {
    assert.match(collectSrc, /import \{ isSessionStateResultError \} from '@\/lib\/error-classifier'/);
  });

  it('P1 — clears (not writes back) the bad session_id for a stale-resume is_error result', () => {
    assert.match(
      collectSrc,
      /if \(resultData\.is_error && isSessionStateResultError\(resultData\.errors\)\) \{[\s\S]{0,160}updateSdkSessionId\(sessionId, ''\);[\s\S]{0,160}\} else if \(resultData\.session_id\) \{[\s\S]{0,160}updateSdkSessionId\(sessionId, resultData\.session_id\)/,
      'a session-state is_error result must clear sdk_session_id; only otherwise persist resultData.session_id',
    );
  });

  it('P2 — populates errorMessage from result errors/subtype for the empty-assistant fallback', () => {
    assert.match(
      collectSrc,
      /if \(resultData\.is_error\) \{[\s\S]{0,420}errorMessage =[\s\S]{0,200}resultData\.errors[\s\S]{0,80}resultData\.subtype/,
      'an is_error result must populate errorMessage (errors.join or subtype) so the **Error:** bubble persists',
    );
  });
});
