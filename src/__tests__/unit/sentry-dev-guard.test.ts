/**
 * Repo-wide `@sentry/node` dev-init contract — dev-server memory guardrail.
 *
 * `instrumentation.ts` was the obvious entry, but ANY src file that touches
 * `@sentry/node` is a leak: in dev, the moment Turbopack resolves the
 * import (eagerly at compile, or lazily on first error), it pulls the
 * full `@opentelemetry/*` instrumentation chain (HTTP / fs / dns /
 * undici / …) into the dev compile graph and inflates RSS by 100+ MB.
 *
 * The contract: every `@sentry/node` reference in src/ MUST sit inside
 * an `if (process.env.NODE_ENV !== 'development') { ... }` block. The
 * test scans the whole tree, finds every file that mentions the package,
 * extracts the union of guard blocks, and asserts the package only
 * appears inside that union.
 *
 * Comments / JSDoc that mention `@sentry/node` to explain *why* the
 * guard exists are tolerated — we strip comments before scanning, the
 * same way `instrumentation-shape.test.ts` does.
 *
 * Why a wrapping `if (... !== 'development') { body }` and not an early
 * `return` style? Because the static-analysis story is much cleaner:
 * the guard's brace-balanced body is a single contiguous span we can
 * hand to a regex. An early-return form ("everything below in this
 * function is non-dev") would require finding the enclosing function's
 * scope, which is brittle. Standardize on the wrap form across the repo.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') continue;        // tests reference the literal in assertions
    if (entry === 'node_modules') continue;
    if (entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

function stripComments(src: string): string {
  // Order matters: strip line comments FIRST. Otherwise a JSDoc-style
  // explanation that mentions `@opentelemetry/*` (legitimate prose, but
  // the literal text contains `/*`) would inject a false start-of-block
  // marker into a `//` line; the block regex would then lazy-match all
  // the way to the next `*/` (often inside a real inline block comment
  // like `/* Sentry not available */` later in the file), eating real
  // code between. Killing line comments first removes those embedded
  // `/*` fragments before the block pass ever runs.
  return src
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Find every `if (process.env.NODE_ENV !== 'development') { … }` block
 * in `src` and return their bodies. Brace-balanced extraction handles
 * nested braces inside the body (object literals, nested ifs, etc.).
 */
function extractDevGuardBlocks(src: string): string[] {
  const guardRe = /if\s*\(\s*process\.env\.NODE_ENV\s*!==\s*['"]development['"]\s*\)\s*\{/g;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = guardRe.exec(src)) !== null) {
    const openBrace = m.index + m[0].length - 1;
    let depth = 1;
    let i = openBrace + 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    if (depth === 0) {
      blocks.push(src.slice(openBrace + 1, i - 1));
    }
  }
  return blocks;
}

const SENTRY_NODE_RE = /@sentry\/node/;

interface FileScan {
  rel: string;
  stripped: string;
  blocks: string[];
}

function scanRepo(): FileScan[] {
  const out: FileScan[] = [];
  for (const file of walk(SRC)) {
    const raw = readFileSync(file, 'utf-8');
    const stripped = stripComments(raw);
    if (!SENTRY_NODE_RE.test(stripped)) continue;
    out.push({
      rel: path.relative(SRC, file).replaceAll(path.sep, '/'),
      stripped,
      blocks: extractDevGuardBlocks(stripped),
    });
  }
  return out;
}

describe('@sentry/node repo-wide dev-guard contract', () => {
  const scans = scanRepo();

  it('the two known callers (instrumentation.ts + error-classifier.ts) are present', () => {
    // Sanity check that the test machinery actually finds the files —
    // a regression that turns the regex stale would make every per-file
    // test pass vacuously by skipping. Pin the expected callers.
    const rels = new Set(scans.map((s) => s.rel));
    assert.ok(
      rels.has('instrumentation.ts'),
      `expected instrumentation.ts to be scanned; saw: ${[...rels].join(', ')}`,
    );
    assert.ok(
      rels.has('lib/error-classifier.ts'),
      `expected lib/error-classifier.ts to be scanned; saw: ${[...rels].join(', ')}`,
    );
  });

  it('every file that mentions @sentry/node has a dev guard', () => {
    for (const s of scans) {
      assert.ok(
        s.blocks.length > 0,
        `${s.rel} mentions @sentry/node but has no ` +
          `\`if (process.env.NODE_ENV !== 'development') { … }\` guard. ` +
          `In dev this leaks the @opentelemetry/* graph into Turbopack's ` +
          `compile (~100+ MB RSS regression).`,
      );
    }
  });

  it('every @sentry/node reference is INSIDE the dev guard, never outside', () => {
    for (const s of scans) {
      // Replace each guard block with whitespace of equal length so line
      // numbers stay roughly intact in the residual `outside` text.
      let outside = s.stripped;
      for (const b of s.blocks) {
        outside = outside.replace(b, ' '.repeat(b.length));
      }
      assert.doesNotMatch(
        outside,
        SENTRY_NODE_RE,
        `${s.rel} has a reference to @sentry/node OUTSIDE the dev guard. ` +
          `Move every import / usage inside the ` +
          `\`if (process.env.NODE_ENV !== 'development') { … }\` block. ` +
          `One unguarded path on the error / lazy-init flow is enough to ` +
          `pull @opentelemetry/* into dev memory.`,
      );

      // Positive assertion: at least one guard block actually contains the
      // package. Otherwise the file declares a guard but the import sits
      // somewhere else entirely (likely a refactor accident).
      const insideAnyGuard = s.blocks.some((b) => SENTRY_NODE_RE.test(b));
      assert.ok(
        insideAnyGuard,
        `${s.rel} declares a dev guard but no @sentry/node reference is ` +
          `inside it — verify the guard wraps the right code`,
      );
    }
  });
});
