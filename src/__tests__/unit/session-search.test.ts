/**
 * Unit tests for searchMessages (db) and codepilot_session_search tool.
 *
 * Uses CLAUDE_GUI_DATA_DIR to point at a temp directory so the test has an
 * isolated SQLite DB. Same pattern as db-shutdown.test.ts.
 */

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Set a temp data dir before importing db module
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-session-search-test-'));
process.env.CLAUDE_GUI_DATA_DIR = tmpDir;

// Use require to avoid top-level await issues with CJS output
/* eslint-disable @typescript-eslint/no-require-imports */
const {
  createSession,
  addMessage,
  clearSessionMessages,
  searchMessages,
  closeDb,
} = require('../../lib/db') as typeof import('../../lib/db');

describe('searchMessages (db)', () => {
  let sessionA: string;
  let sessionB: string;

  before(() => {
    // Seed the DB with two sessions and a handful of messages
    const a = createSession('Planning session', 'sonnet', '', tmpDir);
    const b = createSession('Bug triage', 'sonnet', '', tmpDir);
    sessionA = a.id;
    sessionB = b.id;

    addMessage(sessionA, 'user', 'Let us plan the authentication rewrite');
    addMessage(sessionA, 'assistant', 'Here is the proposed authentication approach with PKCE flow');
    addMessage(sessionA, 'user', 'What about refresh tokens?');
    addMessage(sessionA, 'assistant', 'Refresh tokens should be rotated every session');

    addMessage(sessionB, 'user', 'I hit a bug in authentication when token expires');
    addMessage(sessionB, 'assistant', 'That sounds like a PKCE state mismatch');
  });

  after(() => {
    try {
      closeDb();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* best effort */ }
  });

  it('returns results matching the query across all sessions', () => {
    const results = searchMessages('authentication');
    assert.ok(results.length >= 3, `expected at least 3 results, got ${results.length}`);
    assert.ok(results.every(r => r.snippet.toLowerCase().includes('authentication')));
  });

  it('results include session title from chat_sessions join', () => {
    const results = searchMessages('PKCE');
    assert.ok(results.length >= 1);
    const titles = new Set(results.map(r => r.sessionTitle));
    assert.ok(
      titles.has('Planning session') || titles.has('Bug triage'),
      `expected to find titled sessions, got ${[...titles]}`,
    );
  });

  it('sessionId filter restricts results to one session', () => {
    const results = searchMessages('authentication', { sessionId: sessionA });
    assert.ok(results.length > 0);
    assert.ok(results.every(r => r.sessionId === sessionA));
  });

  it('limit is respected', () => {
    const results = searchMessages('authentication', { limit: 1 });
    assert.equal(results.length, 1);
  });

  it('limit default is 5', () => {
    // seed more messages to exceed 5
    for (let i = 0; i < 10; i++) {
      addMessage(sessionA, 'user', `authentication test message ${i}`);
    }
    try {
      const results = searchMessages('authentication');
      assert.ok(results.length <= 5, `expected ≤5 with default limit, got ${results.length}`);
    } finally {
      // clean up the extra messages
      clearSessionMessages(sessionA);
      // Re-seed the original messages
      addMessage(sessionA, 'user', 'Let us plan the authentication rewrite');
      addMessage(sessionA, 'assistant', 'Here is the proposed authentication approach with PKCE flow');
    }
  });

  it('empty query returns empty results', () => {
    const results = searchMessages('');
    assert.equal(results.length, 0);
  });

  it('whitespace-only query returns empty results', () => {
    const results = searchMessages('   ');
    assert.equal(results.length, 0);
  });

  it('no-match query returns empty array', () => {
    const results = searchMessages('totallyuniquestringnowayitsinmessages');
    assert.equal(results.length, 0);
  });

  it('most recent results come first', () => {
    const results = searchMessages('authentication');
    for (let i = 0; i < results.length - 1; i++) {
      assert.ok(
        results[i].createdAt >= results[i + 1].createdAt,
        `results not sorted: ${results[i].createdAt} vs ${results[i + 1].createdAt}`,
      );
    }
  });

  it('snippet contains the match', () => {
    const results = searchMessages('PKCE');
    assert.ok(results.length >= 1);
    assert.ok(results[0].snippet.includes('PKCE'));
  });

  it('LIKE wildcards in query are treated as literals', () => {
    // Add a message with a literal % character
    addMessage(sessionB, 'user', 'The progress was 80% complete');
    const results = searchMessages('80%');
    assert.ok(results.some(r => r.snippet.includes('80%')));
    // A query like '%' alone should match literal % (not everything)
    const wildcardOnly = searchMessages('100%');
    assert.equal(
      wildcardOnly.length,
      0,
      'query "100%" should not match "80%" via wildcard',
    );
  });

  it('returns role and timestamps as documented fields', () => {
    const results = searchMessages('authentication', { limit: 1 });
    assert.equal(results.length, 1);
    const r = results[0];
    assert.ok(['user', 'assistant'].includes(r.role));
    assert.ok(typeof r.createdAt === 'string');
    assert.ok(typeof r.messageId === 'string');
    assert.ok(typeof r.sessionId === 'string');
    assert.ok(typeof r.sessionTitle === 'string');
  });
});
