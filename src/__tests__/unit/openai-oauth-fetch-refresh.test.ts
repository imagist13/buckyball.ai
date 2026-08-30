/**
 * Phase 5b round-7 fix (2026-05-18) — `ai-provider.ts` case 'openai'
 * useResponsesApi path must refresh the OAuth token PER fetch, not
 * capture it at model-construction time.
 *
 * Why this matters: Codex real-credential smoke (round 7) showed
 * `/api/openai-oauth/status` returning `{authenticated:true,
 * needsRefresh:true}`, while a direct hit to
 * `/api/codex/proxy/v1/responses` with `provider_id=openai-oauth`
 * hard-errored with "OpenAI OAuth token expired or not available.
 * Please log in again in Settings." Pre-fix the case did:
 *
 *   const creds = getOAuthCredentialsSync();           // <- sync, returns undefined for expired
 *   if (!creds) { throw 'log in again' }
 *   const accessToken = creds.accessToken;             // <- captured in closure
 *   createOpenAI({ fetch: async () => { ...accessToken... } });
 *
 * Two failures: (1) the sync getter returns undefined for any
 * expired token, even when a refresh_token exists — so the user
 * sees "log in again" while refresh would have succeeded. (2) Even
 * with fresh creds at construction, the captured token went stale
 * over a long session.
 *
 * Post-fix: the fetch closure calls `await ensureTokenFresh()` on
 * every request — refreshes via refresh_token if past the 5-min
 * expiry buffer, persists, returns fresh creds. Only undefined when
 * there's no usable refresh path.
 *
 * Test shape: source-grep pin so a future refactor can't quietly
 * revert. (A real network-level integration test would need a live
 * OAuth state + ChatGPT backend; we cover that via the user-driven
 * smoke matrix.)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const providerSrc = fs.readFileSync(
  path.resolve(__dirname, '../../lib/ai-provider.ts'),
  'utf8',
);
const managerSrc = fs.readFileSync(
  path.resolve(__dirname, '../../lib/openai-oauth-manager.ts'),
  'utf8',
);

describe('OpenAI OAuth fetch — per-request refresh (round 7)', () => {
  it('ai-provider.ts imports ensureTokenFresh (NOT getOAuthCredentialsSync) for the Responses path', () => {
    // Pin the import shape. The sync getter is fine for read-only
    // status checks (e.g. /api/openai-oauth/status), but the
    // Responses-API fetch path must do per-request refresh — so the
    // module importing it should be ensureTokenFresh.
    assert.match(
      providerSrc,
      /import\s*\{[^}]*ensureTokenFresh[^}]*\}\s*from\s*['"]\.\/openai-oauth-manager['"]/,
      'ai-provider.ts must import ensureTokenFresh from openai-oauth-manager',
    );
    assert.ok(
      !/import\s*\{[^}]*getOAuthCredentialsSync[^}]*\}\s*from\s*['"]\.\/openai-oauth-manager['"]/.test(providerSrc),
      'ai-provider.ts must NOT import the sync getter for the Responses path — that captured tokens at construction time and went stale',
    );
  });

  it("case 'openai' useResponsesApi path calls ensureTokenFresh inside the fetch closure", () => {
    // Find the `case 'openai':` block and confirm:
    //   (a) ensureTokenFresh is called
    //   (b) it appears AFTER the createOpenAI({ fetch: ... }) line,
    //       i.e. inside the fetch closure (not pre-captured)
    const openaiCaseIdx = providerSrc.indexOf("case 'openai':");
    assert.notEqual(openaiCaseIdx, -1, "case 'openai': missing from ai-provider.ts");
    const openaiCaseSlice = providerSrc.slice(openaiCaseIdx);
    const ensureCallIdx = openaiCaseSlice.indexOf('ensureTokenFresh');
    assert.notEqual(
      ensureCallIdx,
      -1,
      "case 'openai' must call ensureTokenFresh somewhere — pre-fix it captured the sync getter at construction time",
    );
    // Pin "await ensureTokenFresh()" (NOT just calling without await, which would
    // return a Promise and never resolve to creds).
    assert.match(
      openaiCaseSlice.slice(0, 3000),
      /await\s+ensureTokenFresh\(\)/,
      'ensureTokenFresh must be awaited (otherwise the closure gets a Promise back, not creds)',
    );
  });

  it('ensureTokenFresh handles expired-but-refreshable by calling refreshTokens (canonical implementation pin)', () => {
    // Pin the shape of ensureTokenFresh itself so a future refactor
    // doesn't accidentally regress to a "return undefined on expiry"
    // behaviour like getOAuthCredentialsSync.
    const fnMatch = managerSrc.match(
      /export\s+async\s+function\s+ensureTokenFresh\(\)[\s\S]{0,2000}?\n\}/,
    );
    assert.ok(fnMatch, 'ensureTokenFresh function body not found');
    const body = fnMatch![0];
    assert.match(
      body,
      /refreshTokens\(/,
      'ensureTokenFresh must call refreshTokens when the access token is past/within the expiry buffer',
    );
    assert.match(
      body,
      /saveTokens\(/,
      'ensureTokenFresh must persist the refreshed tokens via saveTokens',
    );
  });

  it('ai-provider.ts no longer hard-fails at construction when the token is expired-but-refreshable', () => {
    // Pin the absence of the construction-time `if (!creds) throw` —
    // that synchronous early-exit was what made expired-but-
    // refreshable tokens fail outright. The error string ITSELF is
    // still allowed (it can fire inside the fetch closure when even
    // refresh fails), but the early-exit pattern is what we ban.
    const openaiCaseIdx = providerSrc.indexOf("case 'openai':");
    const openaiCaseSlice = providerSrc.slice(openaiCaseIdx, openaiCaseIdx + 4000);
    // Look for the specific anti-pattern: a sync `const creds = getOAuthCredentialsSync();`
    // immediately followed by an `if (!creds) throw` early-exit BEFORE the createOpenAI call.
    const constructionTimeSyncCheck =
      /const\s+creds\s*=\s*getOAuthCredentialsSync\(\);\s*if\s*\(!creds\)\s*\{[\s\S]{0,200}throw/.test(openaiCaseSlice);
    assert.equal(
      constructionTimeSyncCheck,
      false,
      "case 'openai' must NOT do construction-time sync OAuth presence check — round 7 moved that into the fetch closure",
    );
  });
});
