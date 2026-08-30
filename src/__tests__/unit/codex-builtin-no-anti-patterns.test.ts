/**
 * Phase 5c (2026-05-16) — anti-pattern source-grep guards.
 *
 * The user's smoke evidence (2026-05-16) showed GLM/Kimi via Codex
 * Runtime fabricating recovery chains: `OPENAI_API_KEY` lookup,
 * reading `~/.codex/auth.json`, `npm install openai`, then running
 * `scripts/image_gen.py`. None of those are legitimate CodePilot
 * code paths; they were the model improvising because no real tool
 * was reachable.
 *
 * These tests grep the Codex proxy source files for the four
 * anti-patterns. If a future commit reintroduces ANY of them as a
 * product code path (string literal in a path / fetch URL / shell
 * exec), the test fires. Source grep is the cheapest defence — we
 * don't have to mock the filesystem, and a regression shows up in
 * `npm run test` instantly.
 *
 * Allowed exception: this test file itself + the bridge file's
 * DOCSTRING (which describes the anti-patterns as "MUST NOT do").
 * Both are excluded from the grep by file path or context.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const PROXY_DIR = path.resolve(__dirname, '../../lib/codex/proxy');
const BRIDGE_FILE = path.join(PROXY_DIR, 'builtin-bridge.ts');

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkTs(full, out);
    else if (entry.isFile() && full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Returns lines containing `needle` that are NOT inside JSDoc-style
 * comment blocks. The bridge's docstring intentionally lists these
 * strings as "MUST NOT do"; that's not a regression, it's the
 * guardrail itself. Strip comment context before asserting.
 */
function nonCommentHitsOf(src: string, needle: string): string[] {
  const hits: string[] = [];
  let inBlockComment = false;
  for (const rawLine of src.split('\n')) {
    const line = rawLine;
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false;
      continue;
    }
    if (line.trimStart().startsWith('/*')) {
      // Multi-line block comment start. Skip until closing.
      if (!line.includes('*/')) inBlockComment = true;
      continue;
    }
    // Skip lines that are entirely a line comment.
    if (line.trimStart().startsWith('//')) continue;
    // Skip JSDoc continuation lines (`   *  ...`).
    if (line.trimStart().startsWith('*')) continue;
    // Strip trailing line comments.
    const idx = line.indexOf('//');
    const code = idx >= 0 ? line.slice(0, idx) : line;
    if (code.includes(needle)) hits.push(line);
  }
  return hits;
}

describe('codex/proxy/** source — anti-pattern guards', () => {
  const files = walkTs(PROXY_DIR);

  it('NO product path reads ~/.codex/auth.json', () => {
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf-8');
      const hits = nonCommentHitsOf(src, '.codex/auth.json');
      assert.deepEqual(hits, [], `Found auth.json reference in code (not comment) at ${f}: ${hits.join(' | ')}`);
    }
  });

  it('NO product path runs scripts/image_gen.py (or similar shell fallback)', () => {
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf-8');
      // Same exclusion logic as auth.json — comments allowed.
      const hits = nonCommentHitsOf(src, 'image_gen.py');
      assert.deepEqual(hits, [], `Found scripts/image_gen.py reference in code at ${f}: ${hits.join(' | ')}`);
    }
  });

  it('NO product path triggers npm install on the fly', () => {
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf-8');
      const hits = nonCommentHitsOf(src, 'npm install');
      assert.deepEqual(hits, [], `Found npm install reference in code at ${f}: ${hits.join(' | ')}`);
    }
  });

  it('NO product path treats OPENAI_API_KEY as a recovery fallback', () => {
    // This guard is more nuanced: OPENAI_API_KEY may legitimately be
    // *referenced* (e.g. when reading the env to pass through to an
    // upstream model). The anti-pattern is treating its ABSENCE as
    // "try the CLI / install openai / read auth.json". We grep for
    // the substring "OPENAI_API_KEY" but the previous three guards
    // catch the rescue-path strings — so we don't have to outlaw
    // the env var name itself.
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf-8');
      const hits = nonCommentHitsOf(src, 'OPENAI_API_KEY');
      // Bridge file is allowed to mention the env var name in
      // docstrings (already filtered above). If we find a hit OUTSIDE
      // the bridge file, surface it for review.
      if (hits.length > 0 && f !== BRIDGE_FILE) {
        assert.fail(`Unexpected OPENAI_API_KEY reference in code at ${f}: ${hits.join(' | ')}. If legitimate (e.g. provider config), update this allow-list.`);
      }
    }
  });
});

describe('codex/proxy/** source — positive bridge presence pins', () => {
  it('builtin-bridge.ts exports createCodePilotBuiltinTools', () => {
    const src = fs.readFileSync(BRIDGE_FILE, 'utf-8');
    assert.match(src, /export function createCodePilotBuiltinTools/);
  });

  it('builtin-bridge.ts mounts codepilot_generate_image AND emits MediaBlock', () => {
    // The image tool's execute MUST construct an array of MediaBlock
    // objects (type/mimeType/localPath/mediaId fields) — the smoke
    // matrix's "image card live in current chat" pass-criterion
    // depends on this.
    const src = fs.readFileSync(BRIDGE_FILE, 'utf-8');
    assert.match(src, /codepilot_generate_image/);
    assert.match(src, /MediaBlock/);
    assert.match(src, /localPath:/);
  });
});
