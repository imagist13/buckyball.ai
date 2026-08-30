/**
 * `src/instrumentation.ts` shape contract — dev-server memory guardrail.
 *
 * `next dev` runs `register()` at server start. Importing `@sentry/node`
 * here pulls the entire `@opentelemetry/*` instrumentation graph (HTTP,
 * fs, dns, undici, …) into Turbopack's dev compile graph and inflates
 * RSS by ~hundreds of MB. We don't ship dev-only crashes anywhere, so
 * Sentry init must be gated behind a non-development guard.
 *
 * `initRuntimeLog()` and `ensureSchedulerRunning()` are different —
 * runtime-log capture is needed in dev for the Doctor export feature,
 * and the scheduler must come back online on every cold boot. Both
 * MUST stay outside the dev-guard.
 *
 * The test parses the file structurally (brace-matched extraction of
 * the `if (NODE_ENV !== 'development') { ... }` block) so a refactor
 * that smuggles `@sentry/node` back to the outer scope, or a refactor
 * that sweeps the runtime-log / scheduler calls into the guard, fails
 * loudly with a precise error.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC_RAW = readFileSync(
  path.resolve(__dirname, '../../instrumentation.ts'),
  'utf-8',
);

/**
 * Strip TS / JSX line and block comments. The "outside the guard"
 * assertions are about runtime behavior, not documentation — JSDoc that
 * mentions `@sentry/node` to explain *why* the guard exists must not
 * trip the contract.
 */
function stripComments(src: string): string {
  // Strip line comments FIRST so embedded `/*` fragments inside `//`
  // prose (e.g. a JSDoc explaining `@opentelemetry/*`) don't leak into
  // the block-stripper as fake start markers — see the same fix in
  // `sentry-dev-guard.test.ts`.
  return src
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const SRC = stripComments(SRC_RAW);

/**
 * Find the `if (process.env.NODE_ENV !== 'development') { … }` block
 * and return its body text (between the opening `{` and the matching
 * closing `}`). Returns null if the guard isn't present or its braces
 * don't balance — both should fail the contract.
 */
function extractDevGuardBlock(src: string): string | null {
  const guardRe = /if\s*\(\s*process\.env\.NODE_ENV\s*!==\s*['"]development['"]\s*\)/;
  const m = src.match(guardRe);
  if (!m) return null;
  const guardEnd = (m.index ?? 0) + m[0].length;
  const openBrace = src.indexOf('{', guardEnd);
  if (openBrace < 0) return null;
  // Scan forward, counting braces. Quotes / template literals don't
  // appear inside this guard's source, so a naive count is fine here.
  let depth = 1;
  let i = openBrace + 1;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    i++;
  }
  if (depth !== 0) return null;
  return src.slice(openBrace + 1, i - 1);
}

describe('instrumentation.ts dev-memory guardrail', () => {
  it('contains a NODE_ENV !== "development" guard', () => {
    assert.match(
      SRC,
      /if\s*\(\s*process\.env\.NODE_ENV\s*!==\s*['"]development['"]\s*\)/,
      "instrumentation.ts must guard the Sentry init block with " +
        "`if (process.env.NODE_ENV !== 'development')` — dev-mode init " +
        "of @sentry/node + the @opentelemetry/* graph is the dev RSS " +
        "regression we are trying to prevent",
    );
  });

  it('@sentry/node import lives INSIDE the dev guard', () => {
    const block = extractDevGuardBlock(SRC);
    assert.ok(
      block,
      "could not locate the `if (NODE_ENV !== 'development') { … }` block " +
        "(missing or unbalanced braces)",
    );
    assert.match(
      block!,
      /import\(\s*['"]@sentry\/node['"]\s*\)/,
      "the dynamic import('@sentry/node') must sit INSIDE the dev guard. " +
        "Hoisting it outside re-introduces the @opentelemetry/* graph in " +
        "next dev and brings the RSS regression back",
    );
    assert.match(
      block!,
      /Sentry\.init\(/,
      "Sentry.init(...) must also sit inside the dev guard — importing " +
        "without init is incomplete; the contract is `dev never touches Sentry`",
    );
  });

  it('@sentry/node is NOT imported anywhere outside the dev guard', () => {
    const block = extractDevGuardBlock(SRC) ?? '';
    // Replace the guarded block with whitespace of equal length to keep
    // line-number context intact, then assert no @sentry/node mention
    // remains in the rest of the file.
    const outside = SRC.replace(block, ' '.repeat(block.length));
    assert.doesNotMatch(
      outside,
      /@sentry\/node/,
      "@sentry/node must only appear inside the dev guard. A static or " +
        "dynamic import in the outer scope (or in a helper called from " +
        "outside) leaks the OpenTelemetry graph into next dev",
    );
  });

  it('initRuntimeLog is called OUTSIDE the dev guard (must run in dev too)', () => {
    const block = extractDevGuardBlock(SRC) ?? '';
    assert.doesNotMatch(
      block,
      /initRuntimeLog/,
      "initRuntimeLog must NOT be inside the dev guard — runtime-log " +
        "capture is needed in dev for the Doctor export feature",
    );
    // Positive: it must still appear somewhere in the file.
    assert.match(
      SRC,
      /initRuntimeLog\s*\(\s*\)/,
      "initRuntimeLog() must still be called from register() — the dev " +
        "guard refactor is not allowed to drop it",
    );
  });

  it('ensureSchedulerRunning is called OUTSIDE the dev guard (must run in dev too)', () => {
    const block = extractDevGuardBlock(SRC) ?? '';
    assert.doesNotMatch(
      block,
      /ensureSchedulerRunning/,
      "ensureSchedulerRunning must NOT be inside the dev guard — the " +
        "task scheduler has to resume on cold boot regardless of NODE_ENV",
    );
    assert.match(
      SRC,
      /ensureSchedulerRunning\s*\(\s*\)/,
      "ensureSchedulerRunning() must still be called from register() — " +
        "the dev guard refactor is not allowed to drop it",
    );
  });
});
