import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {
  describeProviderFailure,
  providerFailureStatus,
  providerTelemetryIdentity,
} from '../../lib/telemetry/provider-failure';
import {
  isProviderFailureHandled,
  markProviderFailureHandled,
  toMarkableProviderFailure,
} from '../../lib/telemetry/provider-marker';
import {
  createSafeTelemetryError,
  normalizeTelemetryFailure,
} from '../../lib/telemetry/root-cause';

function sdkError(input: Record<string, unknown>): Error & Record<string, unknown> {
  const error = new Error(typeof input.message === 'string' ? input.message : 'provider failure') as Error & Record<string, unknown>;
  for (const [key, value] of Object.entries(input)) {
    Object.defineProperty(error, key, { value, enumerable: false, configurable: true });
  }
  return error;
}

function noOutput(cause?: unknown): Error {
  const error = new Error('No output generated');
  error.name = 'AI_NoOutputGeneratedError';
  if (cause !== undefined) {
    Object.defineProperty(error, 'cause', { value: cause, enumerable: false });
  }
  return error;
}

describe('provider failure telemetry boundary', () => {
  it('extracts status from a bounded cause/response allow-list without reading bodies', () => {
    assert.equal(providerFailureStatus({ statusCode: 502, responseBody: 'private prompt' }), 502);
    assert.equal(providerFailureStatus({ response: { status: 429, body: 'private' } }), 429);
    assert.equal(providerFailureStatus({ cause: { response: { statusCode: '403' } } }), 403);
    assert.equal(providerFailureStatus({ status: 'not-a-status' }), undefined);

    const hostile: Record<string, unknown> = { statusCode: 503 };
    Object.defineProperty(hostile, 'responseBody', { get: () => { throw new Error('must not read body'); } });
    Object.defineProperty(hostile, 'chunk', { get: () => { throw new Error('must not read chunk'); } });
    assert.equal(providerFailureStatus(hostile), 503);
  });

  it('maps every HTTP 4xx (including 429) to user action with zero Issue', () => {
    for (const statusCode of [400, 401, 402, 403, 404, 418, 422, 429]) {
      const result = describeProviderFailure({ statusCode }, 'automatic_title');
      assert.equal(result.outcome, 'user_action_required', String(statusCode));
      assert.equal(result.category, 'PROVIDER_HTTP_4XX', String(statusCode));
      assert.equal(result.shouldReport, false, `${statusCode} must produce zero Sentry events`);
    }
  });

  it('recovers HTTP semantics from bounded in-band provider error types', () => {
    for (const [type, statusCode] of [
      ['invalid_request_error', 400],
      ['authentication_error', 401],
      ['billing_error', 402],
      ['permission_error', 403],
      ['not_found_error', 404],
      ['request_too_large', 413],
      ['rate_limit_error', 429],
      ['api_error', 500],
      ['overloaded_error', 529],
    ] as const) {
      assert.equal(providerFailureStatus({ type, body: 'must-not-read' }), statusCode);
    }
  });

  it('keeps provider tests and user cancellations out of Issues', () => {
    assert.equal(
      describeProviderFailure({ statusCode: 500 }, 'connection_test').outcome,
      'provider_test_result',
    );
    assert.equal(
      describeProviderFailure(new Error('request cancelled'), 'automatic_title').outcome,
      'user_cancelled',
    );
    assert.equal(
      describeProviderFailure(new Error('request cancelled'), 'automatic_title').shouldReport,
      false,
    );
  });

  it('reports 5xx, DNS, and timeout only after the retry budget is exhausted', () => {
    const fixtures = [
      ...[500, 502, 503].map((statusCode) => ({ error: { statusCode }, category: 'PROVIDER_HTTP_5XX' })),
      { error: sdkError({ code: 'ENOTFOUND' }), category: 'PROVIDER_DNS_FAILURE' },
      { error: sdkError({ code: 'EAI_AGAIN' }), category: 'PROVIDER_DNS_FAILURE' },
      { error: sdkError({ code: 'ETIMEDOUT' }), category: 'PROVIDER_TIMEOUT' },
    ];

    for (const fixture of fixtures) {
      const pending = describeProviderFailure(fixture.error, 'automatic_memory_extract', {
        retryExhausted: false,
      });
      assert.equal(pending.outcome, 'transient_upstream');
      assert.equal(pending.shouldReport, false, `${fixture.category} must wait for retry exhaustion`);

      const exhausted = describeProviderFailure(fixture.error, 'automatic_memory_extract', {
        retryExhausted: true,
      });
      assert.equal(exhausted.outcome, 'transient_upstream');
      assert.equal(exhausted.category, fixture.category);
      assert.equal(exhausted.shouldReport, true);
    }
  });

  it('unwraps NoOutput to a trusted 4xx/5xx/DNS/timeout root cause', () => {
    const forbidden = normalizeTelemetryFailure(
      'NATIVE_STREAM_ERROR',
      noOutput(sdkError({ statusCode: 403, code: 'permission_denied' })),
      { retryExhausted: true },
    );
    assert.deepEqual(
      { category: forbidden.category, outcome: forbidden.outcome, shouldReport: forbidden.shouldReport },
      { category: 'PROVIDER_HTTP_4XX', outcome: 'user_action_required', shouldReport: false },
    );

    const transientFixtures = [
      { cause: sdkError({ statusCode: 503 }), category: 'PROVIDER_HTTP_5XX' },
      { cause: sdkError({ code: 'ENOTFOUND' }), category: 'PROVIDER_DNS_FAILURE' },
      { cause: sdkError({ code: 'ETIMEDOUT' }), category: 'PROVIDER_TIMEOUT' },
    ];
    for (const fixture of transientFixtures) {
      const result = normalizeTelemetryFailure('NATIVE_STREAM_ERROR', noOutput(fixture.cause), {
        retryExhausted: true,
      });
      assert.equal(result.category, fixture.category);
      assert.equal(result.outcome, 'transient_upstream');
      assert.equal(result.shouldReport, true);
    }
  });

  it('uses the stable protocol bucket only for a true root-cause-free NoOutput', () => {
    assert.deepEqual(
      normalizeTelemetryFailure('NATIVE_STREAM_ERROR', noOutput(), { retryExhausted: true }),
      {
        category: 'EMPTY_RESPONSE',
        outcome: 'provider_protocol_fault',
        rootCause: 'no_output',
        statusCode: undefined,
        retryExhausted: true,
        shouldReport: true,
      },
    );
  });

  it('bounds circular/deep/adversarial object inspection and returns enum-only data', () => {
    const circular: Record<string, unknown> = {
      name: 'AI_NoOutputGeneratedError',
      response: { status: 403, body: 'raw-secret-body' },
      responseBody: 'sk-secret-token-do-not-send',
      chunk: '/Users/alice/private/project prompt text',
    };
    circular.cause = circular;
    const normalized = normalizeTelemetryFailure('NATIVE_STREAM_ERROR', circular, {
      retryExhausted: true,
    });
    assert.equal(normalized.outcome, 'user_action_required');
    assert.doesNotMatch(JSON.stringify(normalized), /secret|prompt|Users|body|chunk/i);

    let deep: Record<string, unknown> = { statusCode: 503 };
    for (let index = 0; index < 6; index++) deep = { cause: deep };
    const bounded = normalizeTelemetryFailure('PROVIDER_FAILURE', deep, { retryExhausted: true });
    assert.equal(bounded.statusCode, undefined, 'status beyond the depth budget must be ignored');
    assert.equal(bounded.outcome, 'unknown');

    const nonError = normalizeTelemetryFailure('NATIVE_STREAM_ERROR', {
      error: { response: { status: 422, data: { prompt: 'private' } } },
    });
    assert.equal(nonError.outcome, 'user_action_required');
    assert.equal(nonError.shouldReport, false);
  });

  it('keeps stack grouping evidence while replacing unknown raw messages', () => {
    const original = new Error('secret prompt and /Users/alice/project');
    original.stack = 'Error: secret prompt\n    at providerCall (/Users/alice/project/provider.ts:10:2)';
    const safe = createSafeTelemetryError(original, 'telemetry.unknown_failure');
    assert.equal(safe.message, 'telemetry.unknown_failure');
    assert.match(safe.stack || '', /providerCall/);
    assert.doesNotMatch((safe.stack || '').split('\n')[0], /secret|alice/i);
  });

  it('drops multi-line provider messages before preserving stack frames', () => {
    const original = new Error('provider failure');
    original.stack = [
      'Error: provider failure',
      'raw response body with sk-secret and /Users/alice/private',
      'second private continuation line',
      '    at providerCall (/Users/alice/project/provider.ts:10:2)',
    ].join('\n');
    const safe = createSafeTelemetryError(original, 'telemetry.unknown_failure');
    assert.match(safe.stack || '', /providerCall/);
    assert.doesNotMatch(safe.stack || '', /raw response|secret|private continuation/i);
  });

  it('does not reclassify product faults from incidental timeout or DNS text', () => {
    for (const message of ['session state timed out', 'getaddrinfo appeared in persisted output']) {
      const normalized = normalizeTelemetryFailure('SESSION_STATE_ERROR', new Error(message), {
        retryExhausted: true,
      });
      assert.equal(normalized.outcome, 'product_fault');
      assert.equal(normalized.category, 'SESSION_STATE_ERROR');
    }
  });

  it('marks errors non-enumerably, including frozen SDK errors, to prevent double capture', () => {
    const error = new Error('upstream body remains available to the UI');
    markProviderFailureHandled(error);
    assert.equal(isProviderFailureHandled(error), true);
    assert.deepEqual(Object.keys(error), []);

    const frozen = Object.freeze(new Error('frozen provider error'));
    markProviderFailureHandled(frozen);
    assert.equal(isProviderFailureHandled(frozen), true);

    const primitive = toMarkableProviderFailure('private primitive provider failure');
    markProviderFailureHandled(primitive);
    assert.equal(isProviderFailureHandled(primitive), true);
    assert.equal(Object.prototype.propertyIsEnumerable.call(primitive, 'cause'), false);
  });

  it('derives only stable protocol/class identity for native runtime events', () => {
    const identity = providerTelemetryIdentity({
      protocol: 'openai',
      provider: { preset_key: 'openrouter' },
    } as never);
    assert.deepEqual(identity, { providerProtocol: 'openai', providerClass: 'managed' });
    assert.deepEqual(
      providerTelemetryIdentity(undefined),
      { providerProtocol: 'unknown', providerClass: 'environment' },
    );
  });

  it('marks every direct Provider Doctor classifyError call as a test result', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/claude-client.ts'), 'utf8');
    const section = source.slice(source.indexOf('export async function testProviderConnection'));
    const calls = [...section.matchAll(/classifyError\(\{[\s\S]*?\}\);/g)];
    assert.ok(calls.length >= 8, 'expected every protocol-specific connection-test error path');
    for (const call of calls) assert.match(call[0], /providerTest:\s*true/);
  });
});
