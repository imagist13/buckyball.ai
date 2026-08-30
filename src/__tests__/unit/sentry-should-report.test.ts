/**
 * Locks the semantics of `shouldReportToSentry` — the pure predicate behind
 * `reportToSentry` / `reportNativeError`.
 *
 * Regression it guards (audit 2026-07 "Sentry blind spot 1"): the native
 * runtime calls `reportNativeError('EMPTY_RESPONSE' | 'TIMEOUT_*', ...)`, but
 * those categories were absent from the reportable allow-list, so the calls
 * were silent no-ops. Timeouts were doubly hidden: the native runtime raises
 * a fired timeout budget as an AbortError, which the `/abort|cancel/` message
 * filter also swallowed.
 *
 * This test imports only the pure predicate — never `@sentry/node` — so it
 * doesn't pull the @opentelemetry chain into the test compile graph (that
 * separation is the whole reason `shouldReportToSentry` is factored out).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { shouldReportToSentry } from '../../lib/error-classifier';
import { shouldUseDefaultStackGrouping } from '../../lib/telemetry/contract';

describe('shouldReportToSentry — Sentry blind spot 1 (audit 2026-07)', () => {
  it('EMPTY_RESPONSE is reportable', () => {
    assert.equal(
      shouldReportToSentry('EMPTY_RESPONSE', new Error('Empty response: finishReason=stop')),
      true,
    );
  });

  it('all TIMEOUT_* categories wait for retry exhaustion', () => {
    for (const cat of [
      'TIMEOUT_CONNECT',
      'TIMEOUT_FIRST_TOKEN',
      'TIMEOUT_TOOL_EXECUTION',
      'TIMEOUT_TOTAL_RUN',
    ]) {
      assert.equal(shouldReportToSentry(cat, new Error('boom')), false, `${cat} must not report early`);
      assert.equal(
        shouldReportToSentry(cat, new Error('boom'), { retryExhausted: true }),
        true,
        `${cat} should report after retry exhaustion`,
      );
    }
  });

  it('TIMEOUT_* is still reported even when the error is an AbortError', () => {
    // A fired timeout budget aborts the combined signal, so it surfaces as an
    // AbortError (agent-loop.ts:728). The abort/cancel filter must NOT swallow
    // it — this was the blind spot.
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    assert.equal(
      shouldReportToSentry('TIMEOUT_FIRST_TOKEN', abortErr, { retryExhausted: true }),
      true,
    );
    assert.equal(
      shouldReportToSentry(
        'TIMEOUT_TOTAL_RUN',
        new Error('signal is aborted without reason'),
        { retryExhausted: true },
      ),
      true,
    );
  });

  it('a plain user abort/cancel under a reportable category is NOT reported', () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    // NATIVE_STREAM_ERROR / UNKNOWN are reportable, but a user cancellation
    // under them must be dropped (expected, non-actionable).
    assert.equal(shouldReportToSentry('NATIVE_STREAM_ERROR', abortErr), false);
    assert.equal(shouldReportToSentry('UNKNOWN', new Error('request was cancelled')), false);
  });

  it('user-action categories do not create Error Issues', () => {
    assert.equal(shouldReportToSentry('RATE_LIMITED', new Error('429')), false);
    assert.equal(shouldReportToSentry('NO_CREDENTIALS', new Error('no key')), false);
    assert.equal(shouldReportToSentry('CLI_NOT_FOUND', new Error('missing binary')), false);
    assert.equal(
      shouldReportToSentry('EXECUTION_PERMISSION_DENIED', new Error('spawn claude EPERM')),
      false,
    );
  });

  it('all structured 4xx values create zero Error/info/message Issues', () => {
    for (const statusCode of [400, 401, 402, 403, 404, 418, 422, 429]) {
      assert.equal(
        shouldReportToSentry('NATIVE_STREAM_ERROR', { statusCode }, { retryExhausted: true }),
        false,
        String(statusCode),
      );
    }

    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/error-classifier.ts'), 'utf8');
    assert.doesNotMatch(source, /telemetry\.health_summary|health-summary/);
    assert.doesNotMatch(source, /captureMessage\([^\n]+['"]info['"]/);
    assert.doesNotMatch(source, /captureMessage\(String\(error\)/);
    assert.match(source, /captureMessage\('telemetry\.normalized_failure'/);
  });

  it('keeps product/unknown Error stacks on default grouping', () => {
    assert.equal(shouldUseDefaultStackGrouping('product_fault', new Error('bug')), true);
    assert.equal(shouldUseDefaultStackGrouping('unknown', new Error('bug')), true);
    assert.equal(shouldUseDefaultStackGrouping('unknown', { message: 'no stack' }), false);
  });

  it('non-Error values are handled (string abort still filtered for non-timeout)', () => {
    assert.equal(shouldReportToSentry('UNKNOWN', 'aborted by user'), false);
    assert.equal(shouldReportToSentry('EMPTY_RESPONSE', 'weird string'), true);
  });
});
