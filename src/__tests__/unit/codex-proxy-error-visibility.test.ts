/**
 * Phase 5c slice 5 (2026-05-16, post-smoke) — proxy preflight errors
 * survive a chat refresh.
 *
 * Smoke evidence: GLM-5 Turbo + Codex Runtime + image request 400'd
 * at the proxy because of an unrecognised `namespace` tool. The user
 * saw the inline error on screen at the time, but refreshing the
 * chat showed only the user bubble — no assistant trace of the
 * failure. Root cause: the server-side collect path only persists
 * when `contentBlocks.length > 0`. An `event.type === 'error'`
 * SSE event sets `hasError` + `errorMessage` but doesn't push
 * anything into contentBlocks, so the DB save site is a no-op.
 *
 * Fix: when the loop exits with `hasError` set and `contentBlocks`
 * empty, push a fallback `**Error:** <message>` text block so the
 * assistant message exists on reload. Mirrors the format
 * `stream-session-manager.ts:864` uses on the client side so the
 * post-refresh transcript matches what the live SSE showed.
 *
 * Source-pin: testing the full chat route end-to-end means booting
 * a real Codex app-server + provider stack — well beyond what unit
 * tests should carry. The pin below asserts the two fallback sites
 * exist in the collect module with the right wording. Real-credential
 * smoke will exercise the behaviour end-to-end after this slice
 * lands.
 *
 * Session ownership rework: `collectStreamResponse` (which owns these
 * fallback sites) moved out of `route.ts` into
 * `src/lib/chat-collect-stream-response.ts` — Next App Router forbids
 * non-method exports from a route module. The pins follow the code;
 * the assertions are unchanged.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const COLLECT_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../lib/chat-collect-stream-response.ts'),
  'utf-8',
);

describe('chat route — proxy preflight error message persists across refresh', () => {
  it('happy-path block pushes a fallback error text block when contentBlocks is empty + hasError set', () => {
    // The fallback MUST land BEFORE the existing
    // `if (contentBlocks.length > 0)` persistence guard, otherwise
    // adding the block to contentBlocks after the guard runs is
    // dead code.
    assert.match(
      COLLECT_SRC,
      /if \(hasError && contentBlocks\.length === 0 && errorMessage\) \{[\s\S]{0,200}contentBlocks\.push\(\{ type: 'text', text: `\*\*Error:\*\* \$\{errorMessage\}` \}\);[\s\S]{0,200}\}\s*\n\s*if \(contentBlocks\.length > 0\) \{/,
      'happy-path fallback must push a "**Error:** <message>" text block before the persistence guard fires',
    );
  });

  it('catch block (stream reading throw path) has the same fallback so transient stream errors also persist', () => {
    // Two separate branches converge on the same idea: if the only
    // signal we got from the turn is an error, save it.
    const catchBlockRegex =
      /\} catch \(e\) \{[\s\S]*?errorMessage = e instanceof Error \? e\.message : 'Stream reading error'[\s\S]*?if \(contentBlocks\.length === 0 && errorMessage\) \{[\s\S]{0,200}contentBlocks\.push\(\{ type: 'text', text: `\*\*Error:\*\* \$\{errorMessage\}` \}\);[\s\S]{0,200}\}\s*\n\s*if \(contentBlocks\.length > 0\) \{/;
    assert.match(
      COLLECT_SRC,
      catchBlockRegex,
      'catch-block fallback must also persist the error before the structured-blocks branch runs',
    );
  });

  it('fallback wording matches stream-session-manager client-side format (**Error:** <message>)', () => {
    // Cross-file consistency check: both the server-side persist
    // AND the client-side snapshot use the same surface wording.
    // If a future refactor changes one side without the other, the
    // live SSE and the post-refresh transcript would render
    // differently. Pin the shared format.
    const sessionMgrSrc = fs.readFileSync(
      path.resolve(__dirname, '../../lib/stream-session-manager.ts'),
      'utf-8',
    );
    assert.match(sessionMgrSrc, /\*\*Error:\*\* \$\{errMsg\}/, 'client-side snapshot must use the same prefix');
    assert.match(COLLECT_SRC, /\*\*Error:\*\* \$\{errorMessage\}/, 'server-side persistence must use the same prefix');
  });
});
