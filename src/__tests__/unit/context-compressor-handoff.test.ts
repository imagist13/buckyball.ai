import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  planStreamHandoffAfterCompaction,
  buildContextCompressedStatus,
  filterHistoryByCompactBoundary,
  resolveReactiveCompactBoundaryRowid,
} from '../../lib/context-compressor';

describe('planStreamHandoffAfterCompaction', () => {
  const historyMsgs = [
    { role: 'user' as const, content: 'hello 1' },
    { role: 'assistant' as const, content: 'hi 1' },
    { role: 'user' as const, content: 'hello 2' },
    { role: 'assistant' as const, content: 'hi 2' },
    { role: 'user' as const, content: 'hello 3' },
    { role: 'assistant' as const, content: 'hi 3' },
  ];

  it('passes through unchanged when compression did not run', () => {
    const handoff = planStreamHandoffAfterCompaction({
      compressed: false,
      originalHistory: historyMsgs,
      messagesToKeep: historyMsgs.slice(-2),
      originalSdkSessionId: 'sdk-session-abc',
    });
    assert.equal(handoff.sdkSessionId, 'sdk-session-abc');
    assert.equal(handoff.conversationHistory, historyMsgs);
  });

  it('preserves undefined sdk session id when compression did not run', () => {
    const handoff = planStreamHandoffAfterCompaction({
      compressed: false,
      originalHistory: historyMsgs,
      messagesToKeep: [],
      originalSdkSessionId: undefined,
    });
    assert.equal(handoff.sdkSessionId, undefined);
    assert.equal(handoff.conversationHistory, historyMsgs);
  });

  it('clears sdk session id when compression succeeded, even if caller passed one', () => {
    const handoff = planStreamHandoffAfterCompaction({
      compressed: true,
      originalHistory: historyMsgs,
      messagesToKeep: historyMsgs.slice(-2),
      originalSdkSessionId: 'sdk-session-abc',
    });
    assert.equal(
      handoff.sdkSessionId,
      undefined,
      'after compaction the caller must not resume the stale SDK session — ' +
      'otherwise the SDK replays its own pre-compaction transcript and our ' +
      'fresh summary never reaches the model',
    );
  });

  it('truncates history to messagesToKeep (not originalHistory) after compression', () => {
    const toKeep = historyMsgs.slice(-2);
    const handoff = planStreamHandoffAfterCompaction({
      compressed: true,
      originalHistory: historyMsgs,
      messagesToKeep: toKeep,
      originalSdkSessionId: 'sdk-session-abc',
    });
    assert.equal(
      handoff.conversationHistory,
      toKeep,
      'after compaction the fallback context must use messagesToKeep, not the ' +
      'full history — the older turns are already represented inside the summary',
    );
    assert.equal(handoff.conversationHistory.length, 2);
  });

  it('handles compressed=true with empty messagesToKeep (summary covers everything)', () => {
    const handoff = planStreamHandoffAfterCompaction({
      compressed: true,
      originalHistory: historyMsgs,
      messagesToKeep: [],
      originalSdkSessionId: 'sdk-session-abc',
    });
    assert.equal(handoff.sdkSessionId, undefined);
    assert.deepEqual(handoff.conversationHistory, []);
  });

  it('is generic over history element type', () => {
    interface Custom { id: number; text: string }
    const history: Custom[] = [
      { id: 1, text: 'a' },
      { id: 2, text: 'b' },
    ];
    const handoff = planStreamHandoffAfterCompaction<Custom>({
      compressed: true,
      originalHistory: history,
      messagesToKeep: [history[1]],
      originalSdkSessionId: 'abc',
    });
    assert.equal(handoff.conversationHistory.length, 1);
    assert.equal(handoff.conversationHistory[0].id, 2);
  });
});

// Co-locate a regression test that ensures buildContextCompressedStatus and
// planStreamHandoffAfterCompaction export from the same module — chat route
// relies on this pairing and a refactor that splits them should show up here.
describe('context-compressor post-compaction API surface', () => {
  it('exports helpers needed by the chat route post-compaction flow', () => {
    assert.equal(typeof planStreamHandoffAfterCompaction, 'function');
    assert.equal(typeof buildContextCompressedStatus, 'function');
    assert.equal(typeof filterHistoryByCompactBoundary, 'function');
  });
});

describe('resolveReactiveCompactBoundaryRowid', () => {
  it('picks the last _rowid present in conversationHistory when rowids are plumbed through', () => {
    const history = [
      { role: 'user', content: 'q1', _rowid: 10 },
      { role: 'assistant', content: 'a1', _rowid: 11 },
      { role: 'user', content: 'q2', _rowid: 12 },
    ];
    const result = resolveReactiveCompactBoundaryRowid({
      history,
      existingBoundaryRowid: 0,
    });
    assert.equal(result, 12,
      'reactive compact hands whole history to compressor, so last rowid = last covered rowid');
  });

  it('scans past trailing synthetic rows and returns the last known rowid', () => {
    const history = [
      { role: 'user', content: 'q1', _rowid: 50 },
      { role: 'assistant', content: 'a1', _rowid: 51 },
      { role: 'user', content: 'synthetic tail' }, // no _rowid
      { role: 'assistant', content: 'another synthetic' }, // no _rowid
    ];
    const result = resolveReactiveCompactBoundaryRowid({
      history,
      existingBoundaryRowid: 0,
    });
    assert.equal(result, 51, 'trailing rows without _rowid should not mask earlier known rowids');
  });

  // The critical guard: a degraded reactive compact (no _rowid plumbed
  // through) must NOT reset a previously-established boundary to 0.
  // Otherwise the next turn's filterHistoryByCompactBoundary would silently
  // regress to passthrough and CodePilot would re-feed summarized rows.
  it('preserves existing boundary when history has no _rowid at all', () => {
    const history: Array<{ _rowid?: number }> = [
      { /* no _rowid */ },
      { /* no _rowid */ },
    ];
    const result = resolveReactiveCompactBoundaryRowid({
      history,
      existingBoundaryRowid: 88,
    });
    assert.equal(result, 88,
      'degraded reactive compact must NEVER regress a real boundary to 0');
  });

  it('returns 0 only when both history rowids and existing boundary are absent', () => {
    const history: Array<{ _rowid?: number }> = [{}, {}];
    const result = resolveReactiveCompactBoundaryRowid({
      history,
      existingBoundaryRowid: 0,
    });
    assert.equal(result, 0);
  });

  it('treats _rowid === 0 as "unknown" (SQLite rowid is 1-indexed)', () => {
    const history = [
      { role: 'user', content: 'q1', _rowid: 0 },
      { role: 'assistant', content: 'a1' },
    ];
    const result = resolveReactiveCompactBoundaryRowid({
      history,
      existingBoundaryRowid: 99,
    });
    assert.equal(result, 99, '_rowid=0 is a sentinel, not a real boundary');
  });

  it('handles empty history by falling back to existing boundary', () => {
    const result = resolveReactiveCompactBoundaryRowid({
      history: [],
      existingBoundaryRowid: 42,
    });
    assert.equal(result, 42);
  });

  // Non-blocking hardening (Codex iteration 10): defence in depth against a
  // future caller handing in unfiltered / mixed history. Today the route
  // always filters by boundary before passing to streamClaude so this path
  // never fires in-repo, but the helper itself is a public export and
  // should make "boundary only advances" a property of the helper, not of
  // its callers.
  it('returns existingBoundaryRowid when the last history rowid is lower (never retreats)', () => {
    const staleHistory: Array<{ _rowid?: number }> = [
      { _rowid: 3 },
      { _rowid: 5 },
    ];
    const result = resolveReactiveCompactBoundaryRowid({
      history: staleHistory,
      existingBoundaryRowid: 88,
    });
    assert.equal(
      result,
      88,
      'even with a known rowid in history, the boundary must not retreat below the existing one',
    );
  });

  it('picks the max when history rowid > existing (advance wins normally)', () => {
    const history: Array<{ _rowid?: number }> = [{ _rowid: 200 }];
    const result = resolveReactiveCompactBoundaryRowid({
      history,
      existingBoundaryRowid: 150,
    });
    assert.equal(result, 200);
  });
});

// Regression for the plan-method-A rowid propagation: chat/route.ts MUST
// preserve _rowid when mapping historyAfterBoundary → historyMsgs AND when
// mapping rowsToKeep → messagesToKeep. Dropping _rowid silently degrades
// reactive compact on the very next fresh-SDK turn, because streamClaude
// receives conversationHistory without rowids and falls back to
// "preserve existing boundary" instead of writing the freshly-advanced
// boundary.
describe('chat route rowid propagation', () => {
  it('historyMsgs and messagesToKeep map expressions keep _rowid', () => {
    const routeSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'app', 'api', 'chat', 'route.ts'),
      'utf-8',
    );
    // The two map sites we care about. Each must include _rowid in its
    // mapped object literal. Scan line-anchored to avoid false matches on
    // unrelated .map() calls.
    const historyMsgsMatch = routeSrc.match(
      /const historyMsgs = historyAfterBoundary\.map\([\s\S]*?\);/,
    );
    assert.ok(historyMsgsMatch, 'could not locate historyMsgs map expression');
    assert.ok(/\b_rowid\b/.test(historyMsgsMatch[0]),
      `historyMsgs map must include _rowid. Found: ${historyMsgsMatch[0]}`);

    const messagesToKeepMatch = routeSrc.match(
      /const messagesToKeep = rowsToKeep\.map\([\s\S]*?\);/,
    );
    assert.ok(messagesToKeepMatch, 'could not locate messagesToKeep map expression');
    assert.ok(/\b_rowid\b/.test(messagesToKeepMatch[0]),
      `messagesToKeep map must include _rowid. Found: ${messagesToKeepMatch[0]}`);
  });
});

// Regression for iteration 7: both /compact branches (success + no-op) must
// avoid persisting slash-command feedback to DB. Rows written after
// context_summary_boundary_rowid are kept by the next turn's filter and
// leak into the model's transcript; repeated /compact invocations would
// accumulate those rows and eventually get folded back into a summary.
// Source-scan test because we don't have a route-level integration harness
// in this repo; ugly but catches accidental re-introduction of addMessage
// in this block.
describe('/compact handler — no DB transcript writes', () => {
  it('does not call addMessage/addDbMessage anywhere in the /compact block in route.ts', () => {
    const routeSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'app', 'api', 'chat', 'route.ts'),
      'utf-8',
    );
    const blockStart = routeSrc.indexOf("if (content.trim() === '/compact')");
    assert.ok(blockStart >= 0, 'could not locate the /compact block start in route.ts');
    // Walk braces from the first '{' after the condition to find the matching '}'.
    const openBraceIdx = routeSrc.indexOf('{', blockStart);
    assert.ok(openBraceIdx > blockStart);
    let depth = 0;
    let blockEnd = -1;
    for (let i = openBraceIdx; i < routeSrc.length; i++) {
      const ch = routeSrc[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { blockEnd = i; break; }
      }
    }
    assert.ok(blockEnd > openBraceIdx, 'could not find the matching end brace of the /compact block');
    const block = routeSrc.slice(blockStart, blockEnd);
    // Match a call to addMessage or addDbMessage: identifier followed by `(`.
    // Comments mentioning the name are fine — they don't match the `(`.
    const callPattern = /\b(addDbMessage|addMessage)\s*\(/;
    const match = block.match(callPattern);
    assert.equal(
      match,
      null,
      `Regression: /compact handler must not persist slash-command feedback via ` +
      `addMessage/addDbMessage. Both the success path and the no-op path are ` +
      `UI artifacts — persisting them leaks rows after context_summary_boundary_rowid ` +
      `into the model's transcript. If you need to keep a record of compact ` +
      `events, add a separate non-transcript table. Found call: ${match?.[0]}`,
    );
  });
});

describe('filterHistoryByCompactBoundary', () => {
  // Boundary is now the SQLite _rowid of the last covered message. rowid is
  // monotonically increasing per insert, so this is robust even when writes
  // collide within the same wall-clock second (see Codex review iteration 5
  // and the "same-second messages" regression below).
  const coveredByCompact = [
    { role: 'user', content: 'old 1', _rowid: 101 },
    { role: 'assistant', content: 'old reply 1', _rowid: 102 },
    { role: 'user', content: 'old 2', _rowid: 103 },
    { role: 'assistant', content: 'old reply 2', _rowid: 104 },
  ];
  const summaryBoundaryRowid = 104;
  const afterCompact = [
    { role: 'user', content: 'post-compact question', _rowid: 105 },
    { role: 'assistant', content: 'post-compact reply', _rowid: 106 },
  ];
  const allHistory = [...coveredByCompact, ...afterCompact];

  it('passes through unchanged when no summary exists', () => {
    const result = filterHistoryByCompactBoundary({
      history: allHistory,
      summary: '',
      summaryBoundaryRowid,
    });
    assert.equal(result, allHistory);
  });

  it('passes through unchanged when boundaryRowid is 0 (legacy/reactive-compact rows)', () => {
    const result = filterHistoryByCompactBoundary({
      history: allHistory,
      summary: 'a summary',
      summaryBoundaryRowid: 0,
    });
    assert.equal(result, allHistory, '0 means no boundary known — only safe choice is passthrough');
  });

  it('drops messages at-or-before the boundary, keeps strictly newer', () => {
    const result = filterHistoryByCompactBoundary({
      history: allHistory,
      summary: 'a real summary',
      summaryBoundaryRowid,
    });
    assert.equal(result.length, afterCompact.length);
    assert.deepEqual(result, afterCompact);
  });

  it('excludes a message at the exact boundary rowid (strict > semantics)', () => {
    const msgAtBoundary = { role: 'assistant', content: 'last covered', _rowid: summaryBoundaryRowid };
    const result = filterHistoryByCompactBoundary({
      history: [...coveredByCompact.slice(0, -1), msgAtBoundary, ...afterCompact],
      summary: 'a summary',
      summaryBoundaryRowid,
    });
    assert.ok(!result.some(m => m.content === 'last covered'));
    assert.equal(result.length, afterCompact.length);
  });

  it('keeps all history when every message is post-boundary', () => {
    const result = filterHistoryByCompactBoundary({
      history: afterCompact,
      summary: 'a summary',
      summaryBoundaryRowid,
    });
    assert.deepEqual(result, afterCompact);
  });

  it('drops everything when boundary is after all history (edge case)', () => {
    const result = filterHistoryByCompactBoundary({
      history: coveredByCompact,
      summary: 'a summary',
      summaryBoundaryRowid: 999_999,
    });
    assert.deepEqual(result, []);
  });

  // Regression for iteration 3 (commit a7598ab): filter must not branch on
  // SDK-session state. Determinism across repeat calls is the observable.
  it('filters uniformly regardless of downstream SDK-session state', () => {
    const r1 = filterHistoryByCompactBoundary({
      history: allHistory, summary: 'a real summary', summaryBoundaryRowid,
    });
    const r2 = filterHistoryByCompactBoundary({
      history: allHistory, summary: 'a real summary', summaryBoundaryRowid,
    });
    assert.deepEqual(r1, afterCompact);
    assert.deepEqual(r2, afterCompact);
  });

  // Regression for iteration 4 (6cbf1d1): the auto pre-compression path
  // must not silently drop the current unsummarized user turn. Modelled
  // with rowid here — the current user turn has _rowid strictly greater
  // than any row in messagesToCompress, so it survives the filter as long
  // as the boundary is set to "last compressed rowid" and NOT to
  // "now/write-time" (a synthetic "any future rowid" in the wrong-path
  // case below).
  it('does NOT drop an unsummarized current user turn (auto pre-compression layout)', () => {
    const oldTurn1 = { role: 'user', content: 'q1', _rowid: 201 };
    const oldTurn2 = { role: 'assistant', content: 'a1', _rowid: 202 };
    const currentUserTurn = { role: 'user', content: 'q-now (unsummarized)', _rowid: 203 };

    const correctResult = filterHistoryByCompactBoundary({
      history: [oldTurn1, oldTurn2, currentUserTurn],
      summary: 'a summary',
      summaryBoundaryRowid: oldTurn2._rowid, // last actually compressed
    });
    assert.equal(correctResult.length, 1);
    assert.equal(correctResult[0].content, 'q-now (unsummarized)');

    // If someone set boundary past the user turn (the pre-fix write-time
    // analogue), that user turn would wrongly disappear. This asserts
    // the failure mode we're guarding against is observable.
    const wrongBoundaryResult = filterHistoryByCompactBoundary({
      history: [oldTurn1, oldTurn2, currentUserTurn],
      summary: 'a summary',
      summaryBoundaryRowid: currentUserTurn._rowid + 1,
    });
    assert.equal(wrongBoundaryResult.length, 0);
  });

  // Regression for iteration 6: a second manual /compact call used to
  // feed ALL DB rows — including the ones already covered by
  // existingSummary — back into compressConversation, duplicating covered
  // context inside the new summary. The handler now pre-filters allMsgs
  // with this same helper before building msgData. This test asserts the
  // helper returns exactly the rows that should feed into the next
  // compression pass.
  it('second manual /compact: returns only rows added after the prior boundary', () => {
    // Simulate: first /compact covered rowids 1-10, user added turns
    // 11-14, now running second /compact.
    const priorlyCompacted = [
      { role: 'user', content: 'old q1', _rowid: 1 },
      { role: 'assistant', content: 'old a1', _rowid: 2 },
      // ... through 10
    ];
    const sincePriorCompact = [
      { role: 'user', content: 'new q1', _rowid: 11 },
      { role: 'assistant', content: 'new a1', _rowid: 12 },
      { role: 'user', content: 'new q2', _rowid: 13 },
      { role: 'assistant', content: 'new a2', _rowid: 14 },
    ];
    const allMsgs = [...priorlyCompacted, ...sincePriorCompact];
    const priorBoundary = 10;

    const toCompactInSecondPass = filterHistoryByCompactBoundary({
      history: allMsgs,
      summary: 'prior summary covering rowids 1..10',
      summaryBoundaryRowid: priorBoundary,
    });

    assert.equal(toCompactInSecondPass.length, sincePriorCompact.length,
      'only rows after the prior boundary should enter the second compression pass');
    assert.deepEqual(toCompactInSecondPass, sincePriorCompact);
    // The NEW boundary the handler will write is the last row in this set,
    // correctly advancing coverage from 10 to 14.
    const newBoundary = toCompactInSecondPass[toCompactInSecondPass.length - 1]._rowid;
    assert.equal(newBoundary, 14);
  });

  // Regression for iteration 5 (THIS commit): DB created_at is second
  // precision. On fast paths the last compressed message and the first
  // kept message can share a wall-clock second — any timestamp-based
  // boundary would mis-classify one of them. rowid is monotonic per insert
  // so this scenario resolves cleanly.
  it('handles same-second writes correctly (last-compressed and first-kept share created_at)', () => {
    const lastCompressed = { role: 'assistant', content: 'compressed tail', _rowid: 300, created_at: '2026-04-19 10:00:10' };
    const firstKept = { role: 'user', content: 'kept head', _rowid: 301, created_at: '2026-04-19 10:00:10' };
    const nextKept = { role: 'assistant', content: 'also kept', _rowid: 302, created_at: '2026-04-19 10:00:11' };

    const result = filterHistoryByCompactBoundary({
      history: [lastCompressed, firstKept, nextKept],
      summary: 'a summary',
      summaryBoundaryRowid: lastCompressed._rowid,
    });
    assert.equal(result.length, 2, 'same-second write after the boundary must still be kept');
    assert.equal(result[0].content, 'kept head');
    assert.equal(result[1].content, 'also kept');
  });

  // Messages synthesized without a DB origin don't have _rowid — they
  // should pass through (we can't compare them against the boundary).
  it('keeps messages without _rowid (non-DB-origin synthetic rows)', () => {
    interface Row { role: string; content: string; _rowid?: number }
    const dbMsg: Row = { role: 'user', content: 'from DB', _rowid: 50 };
    const synthetic: Row = { role: 'user', content: 'no rowid' }; // _rowid intentionally absent
    const result = filterHistoryByCompactBoundary<Row>({
      history: [dbMsg, synthetic],
      summary: 'a summary',
      summaryBoundaryRowid: 100,
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].content, 'no rowid', 'synthetic rows without _rowid are unconditionally kept');
  });

  it('is generic over history element type (only requires _rowid?: number)', () => {
    interface Msg { id: number; _rowid: number; extra: string }
    const history: Msg[] = [
      { id: 1, _rowid: 10, extra: 'a' },
      { id: 2, _rowid: 20, extra: 'b' },
    ];
    const result = filterHistoryByCompactBoundary<Msg>({
      history,
      summary: 'x',
      summaryBoundaryRowid: 15,
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 2);
    assert.equal(result[0].extra, 'b');
  });
});
