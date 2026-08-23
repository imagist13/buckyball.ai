import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { streamText } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { NativeStreamTelemetryState } from '@/lib/telemetry/native-stream-boundary';
import { isProviderFailureHandled } from '@/lib/telemetry/provider-marker';
import { normalizeTelemetryFailure } from '@/lib/telemetry/root-cause';

type ModelStreamPart = Record<string, unknown>;

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

function modelFor(parts: ModelStreamPart[]) {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({
            type: 'response-metadata',
            id: 'stream-boundary-probe',
            modelId: 'test-model',
            timestamp: new Date(0),
          });
          for (const part of parts) controller.enqueue(part as never);
          controller.close();
        },
      }),
    }),
  });
}

function finish(reason: 'stop' | 'error'): ModelStreamPart {
  return {
    type: 'finish',
    finishReason: { unified: reason, raw: reason },
    usage: USAGE,
  };
}

function inBandParts(error: unknown, text?: string): ModelStreamPart[] {
  return [
    ...(text === undefined ? [] : [
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: text },
      { type: 'text-end', id: 'text-1' },
    ]),
    { type: 'error', error },
    finish('error'),
  ];
}

async function driveSdkLifecycle(parts: ModelStreamPart[], state: NativeStreamTelemetryState) {
  const result = streamText({
    model: modelFor(parts),
    prompt: 'stream boundary probe',
    onError: ({ error }) => state.observe(error),
  });
  const seen: Array<{ type: string; text?: string }> = [];
  for await (const part of result.fullStream) {
    seen.push({
      type: part.type,
      text: part.type === 'text-delta' ? part.text : undefined,
    });
  }
  // The regression depends on both promises resolving after an in-band error.
  const response = await result.response;
  const finishReason = await result.finishReason;
  return { seen, response, finishReason };
}

describe('native stream terminal telemetry boundary', () => {
  it('keeps in-band 403 structured through resolved SDK promises and emits zero Issue', async () => {
    const upstream = { type: 'permission_error', message: 'permission denied' };
    const state = new NativeStreamTelemetryState();
    const lifecycle = await driveSdkLifecycle(inBandParts(upstream), state);

    assert.equal(lifecycle.finishReason, 'error');
    assert.equal(lifecycle.response.modelId, 'test-model');
    const terminal = state.takeTerminalFailure();
    assert.equal(terminal?.error, upstream);
    assert.equal(isProviderFailureHandled(upstream), true);
    assert.equal(state.takeTerminalFailure(), null, 'terminal boundary must be one-shot');

    const normalized = normalizeTelemetryFailure('NATIVE_STREAM_ERROR', terminal?.error, {
      retryExhausted: true,
    });
    assert.deepEqual(
      { category: normalized.category, outcome: normalized.outcome, shouldReport: normalized.shouldReport },
      { category: 'PROVIDER_HTTP_4XX', outcome: 'user_action_required', shouldReport: false },
    );
  });

  it('routes in-band 5xx, DNS, and timeout into retry-exhausted transient buckets', async () => {
    const fixtures = [
      { error: Object.assign(new Error('overloaded'), { statusCode: 529 }), category: 'PROVIDER_HTTP_5XX' },
      { error: Object.assign(new Error('lookup failed'), { code: 'ENOTFOUND' }), category: 'PROVIDER_DNS_FAILURE' },
      { error: Object.assign(new Error('socket failed'), { code: 'ETIMEDOUT' }), category: 'PROVIDER_TIMEOUT' },
    ];

    for (const fixture of fixtures) {
      const state = new NativeStreamTelemetryState();
      await driveSdkLifecycle(inBandParts(fixture.error), state);
      const terminal = state.takeTerminalFailure();
      assert.equal(terminal?.error, fixture.error);
      const normalized = normalizeTelemetryFailure('NATIVE_STREAM_ERROR', terminal?.error, {
        retryExhausted: true,
      });
      assert.equal(normalized.category, fixture.category);
      assert.equal(normalized.outcome, 'transient_upstream');
      assert.equal(normalized.shouldReport, true);
    }
  });

  it('retains a partial response and still reports its terminal in-band upstream failure', async () => {
    const upstream = Object.assign(new Error('upstream unavailable'), { statusCode: 503 });
    const state = new NativeStreamTelemetryState();
    const lifecycle = await driveSdkLifecycle(inBandParts(upstream, 'partial answer'), state);

    assert.equal(
      lifecycle.seen.filter((part) => part.type === 'text-delta').map((part) => part.text).join(''),
      'partial answer',
    );
    const terminal = state.takeTerminalFailure();
    assert.equal(terminal?.error, upstream, 'partial content must not erase the terminal failure');
    assert.equal(
      normalizeTelemetryFailure('NATIVE_STREAM_ERROR', terminal?.error, { retryExhausted: true }).category,
      'PROVIDER_HTTP_5XX',
    );
  });

  it('leaves a true error-free empty stream for the stable protocol-fault fallback', async () => {
    const state = new NativeStreamTelemetryState();
    const lifecycle = await driveSdkLifecycle([finish('stop')], state);

    assert.equal(lifecycle.finishReason, 'stop');
    assert.equal(state.takeTerminalFailure(), null);
    const normalized = normalizeTelemetryFailure(
      'EMPTY_RESPONSE',
      new Error('Empty response: finishReason=stop'),
      { retryExhausted: true },
    );
    assert.equal(normalized.category, 'EMPTY_RESPONSE');
    assert.equal(normalized.outcome, 'provider_protocol_fault');
    assert.equal(normalized.shouldReport, true);
  });

  it('deduplicates catch rethrows of a terminal failure but preserves unrelated faults', () => {
    const upstream = new Error('upstream');
    const state = new NativeStreamTelemetryState();
    state.observe(upstream);
    assert.equal(state.takeTerminalFailure()?.error, upstream);

    const wrapper = new Error('No output generated');
    Object.defineProperty(wrapper, 'cause', { value: upstream, enumerable: false });
    assert.equal(state.takeCatchFailure(wrapper), null, 'one-hop wrapper must not double-capture');

    const productFault = new Error('accounting failed');
    assert.equal(state.takeCatchFailure(productFault)?.error, productFault);
  });
});
