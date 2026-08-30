#!/usr/bin/env node
/**
 * Issue #629 POC — determine the ERROR SHAPE of a bad / stale Claude Code resume.
 *
 * #629: a resume-400 (stale / corrupt `sdk_session_id`) leaves the bad id in the
 * DB, so every following message in that session retries the broken resume.
 * `src/lib/claude-client.ts` already handles ONE shape but not the other:
 *   - HANDLED   : resume peek THROWS → catch clears the id + falls back fresh
 *                 (claude-client.ts:1568-1595).
 *   - GAP (#629): the turn ends as an `is_error` *result* (no throw) → the
 *                 is_error branch (claude-client.ts:1934-1945) never clears the
 *                 id, AND the crash-cleanup at :2348 is suppressed because
 *                 `resultEmitted = true` was set at :1932 → bad id survives to
 *                 the next turn.
 *
 * THE question this POC answers — when resume hits a bad session id, does the SDK:
 *   (A) THROW at the first `iter.next()`              → already handled, OR
 *   (B) YIELD an SDKResultError (is_error=true,
 *       subtype='error_during_execution')             → the unhandled gap.
 *
 * If (B): subtype alone CANNOT tell session-state from transient — it is one of
 * 4 generic enums (sdk.d.ts:2715: error_during_execution / error_max_turns /
 * error_max_budget_usd / error_max_structured_output_retries), none session-
 * specific. The ONLY per-result text channel is `errors: string[]` (sdk.d.ts:2724),
 * which claude-client currently never reads. So the real unknown is:
 *   does `errors[]` contain text we can feed classifyError() to distinguish
 *   "clear the id" (RESUME_FAILED / SESSION_STATE_ERROR) from "keep the id"
 *   (RATE_LIMITED / AUTH / BUDGET)?  Type defs can't say — only a live run can.
 *
 * SAFETY / cost:
 *   - credentials read ONLY from env (ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL);
 *     never hardcoded, never printed in full (only a masked tail).
 *   - cwd is forced to a throwaway temp dir; maxTurns:1 + a 'ping' prompt. A bad
 *     resume fails BEFORE the model turn really runs, so a live run is ~free; the
 *     cap is only a backstop.
 *   - run `--selftest` first (no creds, no network) to prove the inspect logic.
 *
 * Run (selftest — zero creds, zero network):
 *   node docs/research/issue-629-resume-error-shape-poc/drive-resume-error-shape.mjs --selftest
 *
 * Run (LIVE third-party proxy — most likely to reproduce #629's 400):
 *   ANTHROPIC_API_KEY=... ANTHROPIC_BASE_URL=https://your-proxy/v1 \
 *   MODEL=glm-5-turbo \
 *   node docs/research/issue-629-resume-error-shape-poc/drive-resume-error-shape.mjs
 *
 * Run (LIVE first-party — expect (A) local CLI throw, ~free):
 *   ANTHROPIC_API_KEY=sk-ant-... \
 *   node docs/research/issue-629-resume-error-shape-poc/drive-resume-error-shape.mjs
 */

import process from 'node:process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// Session-signal patterns mirrored from src/lib/error-classifier.ts so the POC
// can answer "is errors[] classifiable?" without importing the TS product code.
// Source of truth stays error-classifier.ts; this is a plain-text approximation
// (the product also has regex variants) — enough to detect presence of a signal.
//   RESUME_FAILED      patterns  (error-classifier.ts ~295-303)
//   SESSION_STATE_ERROR patterns (error-classifier.ts ~318-329)
const SESSION_SIGNAL_PATTERNS = [
  'resume failed', 'session not found', 'invalid session', 'session expired',
  'could not resume', 'failed to resume', 'resume_failed', 'conversation not found',
  'stale session', 'stale sdk_session', 'session state', 'session_state',
  'corrupt session', 'session mismatch', 'session context',
];

// Transient signals that MUST keep the id (clearing would drop conversation
// context). Used only to label the verdict, not to drive it.
const TRANSIENT_SIGNAL_PATTERNS = [
  'rate limit', 'rate_limit', '429', 'overloaded', 'unauthorized', '401',
  'authentication', 'invalid api key', 'budget', 'quota',
];

function detect(text, patterns) {
  const lc = String(text || '').toLowerCase();
  return patterns.filter((p) => lc.includes(p));
}

function describeError(err) {
  const message = err instanceof Error ? err.message : String(err);
  const matched = detect(message, SESSION_SIGNAL_PATTERNS);
  const transient = detect(message, TRANSIENT_SIGNAL_PATTERNS);
  return {
    name: err && err.constructor ? err.constructor.name : typeof err,
    message,
    stackHead: (err && err.stack ? String(err.stack) : '').split('\n').slice(0, 4),
    sessionSignalDetected: matched.length > 0,
    matchedSessionPatterns: matched,
    transientSignalDetected: transient.length > 0,
    matchedTransientPatterns: transient,
  };
}

function describeResult(m) {
  const errors = Array.isArray(m.errors) ? m.errors : [];
  const joined = errors.join('\n');
  const matched = detect(joined, SESSION_SIGNAL_PATTERNS);
  const transient = detect(joined, TRANSIENT_SIGNAL_PATTERNS);
  let verdict;
  if (!m.is_error) {
    verdict = 'result is NOT an error (resume unexpectedly succeeded) — re-check inputs';
  } else if (errors.length === 0) {
    verdict = 'is_error result but errors[] is EMPTY → no text channel at all; cannot classify from the result → fix must use a non-text signal (e.g. first result of a resume turn is is_error with zero assistant output)';
  } else if (matched.length > 0) {
    verdict = 'errors[] CONTAINS a session signal → classifyError(errors.join) can target the clear; fix is viable via errors[]';
  } else if (transient.length > 0) {
    verdict = 'errors[] is a TRANSIENT error (rate-limit/auth/budget) → correctly KEEP the id; this is the case a naive "clear on any is_error" would regress';
  } else {
    verdict = 'errors[] present but matches NEITHER list → inspect raw errors[] and extend classifier patterns before relying on it';
  }
  return {
    subtype: m.subtype,
    is_error: m.is_error,
    stop_reason: m.stop_reason ?? null,
    num_turns: m.num_turns ?? null,
    session_id: m.session_id ?? null,
    errorsCount: errors.length,
    errors,
    permission_denials: m.permission_denials ?? null,
    sessionSignalDetected: matched.length > 0,
    matchedSessionPatterns: matched,
    transientSignalDetected: transient.length > 0,
    matchedTransientPatterns: transient,
    verdict,
  };
}

/**
 * Core probe shared by live + selftest: peek the first message exactly like
 * claude-client.ts does (iter = conversation[Symbol.asyncIterator](); iter.next()),
 * then classify the outcome.
 */
async function inspectConversation(conversation, label) {
  const iter = conversation[Symbol.asyncIterator]();
  let first;
  try {
    first = await iter.next();
  } catch (err) {
    return { label, outcome: 'A_THROW_AT_PEEK', detail: describeError(err) };
  }

  const seen = [];
  let cur = first;
  let guard = 0;
  while (!cur.done && guard++ < 50) {
    const m = cur.value || {};
    seen.push({ type: m.type, subtype: m.subtype, is_error: m.is_error });
    if (m.type === 'result') {
      return {
        label,
        outcome: m.is_error ? 'B_RESULT_ERROR' : 'C_RESULT_SUCCESS',
        peekedFirstType: first.value ? first.value.type : null,
        messagesBeforeResult: seen,
        detail: describeResult(m),
      };
    }
    cur = await iter.next();
  }
  return { label, outcome: 'D_NO_RESULT_MESSAGE', messages: seen };
}

function printOutcome(res) {
  console.log('\n──────────────────────────────────────────────');
  console.log(`[${res.label}] outcome = ${res.outcome}`);
  console.log(JSON.stringify(res, null, 2));
  console.log('──────────────────────────────────────────────');
}

// ─────────────────────────── SELFTEST (no creds) ───────────────────────────

async function* genThrow() {
  throw new Error('Resume failed: session not found (HTTP 400)');
  // eslint-disable-next-line no-unreachable
  yield {};
}
async function* genResultErrorWithSignal() {
  yield { type: 'system', subtype: 'init' };
  yield {
    type: 'result', subtype: 'error_during_execution', is_error: true,
    stop_reason: null, num_turns: 0, session_id: 'bad-id', permission_denials: [],
    errors: ['HTTP 400 from upstream: could not resume conversation — session not found'],
  };
}
async function* genResultErrorTransient() {
  yield {
    type: 'result', subtype: 'error_during_execution', is_error: true,
    stop_reason: null, num_turns: 0, session_id: 'bad-id', permission_denials: [],
    errors: ['429 rate_limit_error: too many requests, retry later'],
  };
}
async function* genResultErrorEmpty() {
  yield {
    type: 'result', subtype: 'error_during_execution', is_error: true,
    stop_reason: null, num_turns: 0, session_id: 'bad-id', permission_denials: [],
    errors: [],
  };
}
async function* genResultSuccess() {
  yield { type: 'result', subtype: 'success', is_error: false, result: 'hi', errors: [] };
}

async function runSelftest() {
  console.log('# selftest — proving the peek/classify logic (no creds, no network)\n');
  const cases = [
    { gen: genThrow, label: 'throw-at-peek', expectOutcome: 'A_THROW_AT_PEEK', expectSession: true },
    { gen: genResultErrorWithSignal, label: 'is_error+session-signal', expectOutcome: 'B_RESULT_ERROR', expectSession: true },
    { gen: genResultErrorTransient, label: 'is_error+transient', expectOutcome: 'B_RESULT_ERROR', expectSession: false },
    { gen: genResultErrorEmpty, label: 'is_error+empty-errors', expectOutcome: 'B_RESULT_ERROR', expectSession: false },
    { gen: genResultSuccess, label: 'unexpected-success', expectOutcome: 'C_RESULT_SUCCESS', expectSession: false },
  ];
  let pass = 0;
  let fail = 0;
  for (const c of cases) {
    const res = await inspectConversation(c.gen(), c.label);
    const gotSession = res.detail ? !!res.detail.sessionSignalDetected : false;
    const ok = res.outcome === c.expectOutcome && gotSession === c.expectSession;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${c.label} → outcome=${res.outcome} sessionSignal=${gotSession}` +
        (ok ? '' : ` (expected outcome=${c.expectOutcome} sessionSignal=${c.expectSession})`),
    );
    if (res.detail && res.detail.verdict) console.log(`       verdict: ${res.detail.verdict}`);
    ok ? pass++ : fail++;
  }
  console.log(`\n# selftest: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

// ──────────────────────────────── LIVE ────────────────────────────────────

function maskTail(s) {
  if (!s) return '(unset)';
  const str = String(s);
  return str.length <= 6 ? '***' : `***${str.slice(-4)}`;
}

async function runLive() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const baseUrl = process.env.ANTHROPIC_BASE_URL || '';
  const model = process.env.MODEL || 'claude-haiku-4-5';
  const badSessionId = process.env.BAD_SESSION_ID || '00000000-0000-4000-8000-000000000629';

  if (!apiKey) {
    console.error('ERROR: set ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL for a third-party proxy).');
    console.error('       Or run with --selftest for the no-creds logic check.');
    process.exit(2);
  }

  // Isolated throwaway cwd — never the real project dir.
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-629-poc-'));

  console.log('# LIVE resume-error-shape probe');
  console.log(`  base_url : ${baseUrl || '(first-party default)'}`);
  console.log(`  model    : ${model}`);
  console.log(`  api_key  : ${maskTail(apiKey)}`);
  console.log(`  bad sid  : ${badSessionId}`);
  console.log(`  cwd      : ${cwd}`);
  console.log('  (bad resume should fail before the model turn → ~free)\n');

  let query;
  try {
    ({ query } = await import('@anthropic-ai/claude-agent-sdk'));
  } catch (err) {
    console.error('ERROR: cannot import @anthropic-ai/claude-agent-sdk from this cwd.');
    console.error('Run from the repo root so node_modules resolves:', err && err.message);
    process.exit(2);
  }

  const env = { ...process.env, ANTHROPIC_API_KEY: apiKey };
  if (baseUrl) env.ANTHROPIC_BASE_URL = baseUrl;

  const options = {
    resume: badSessionId, // ← the whole point: resume a bad/non-existent id
    model,
    cwd,
    maxTurns: 1, // backstop; a bad resume fails before a turn really runs
    env,
    permissionMode: 'plan', // read-only; no tool side effects even if it somehow proceeds
  };

  let conversation;
  try {
    conversation = query({ prompt: 'ping', options });
  } catch (err) {
    // Some failures surface synchronously at query() construction.
    printOutcome({ label: 'live', outcome: 'A_THROW_AT_QUERY_CONSTRUCT', detail: describeError(err) });
    process.exit(0);
  }

  const res = await inspectConversation(conversation, 'live');
  printOutcome(res);

  console.log('\n# interpretation');
  if (res.outcome === 'A_THROW_AT_PEEK' || res.outcome === 'A_THROW_AT_QUERY_CONSTRUCT') {
    console.log('→ Shape (A): SDK THROWS. This path is ALREADY handled by claude-client.ts:1568-1595');
    console.log('  (catch clears sdk_session_id + falls back fresh). #629 is NOT this shape for this provider.');
  } else if (res.outcome === 'B_RESULT_ERROR') {
    console.log('→ Shape (B): SDK yields an is_error RESULT — this is the #629 GAP path.');
    console.log('  Decisive question answered above by detail.verdict (does errors[] carry a session signal?).');
  } else if (res.outcome === 'C_RESULT_SUCCESS') {
    console.log('→ Resume unexpectedly SUCCEEDED — this provider tolerates the bad id. Re-pick a truly invalid id.');
  } else {
    console.log('→ No result message within guard — inspect the message stream manually.');
  }
}

// ──────────────────────────────── main ────────────────────────────────────

if (process.argv.includes('--selftest')) {
  runSelftest();
} else {
  runLive();
}
