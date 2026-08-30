import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildNormalizedFingerprint,
  classifyTelemetryOutcome,
  configureElectronMainIntegrations,
  configureNextServerIntegrations,
  filterTelemetryIntegrations,
  resolveTelemetryConfig,
  shouldSendErrorEnvelope,
  shouldUseDefaultStackGrouping,
} from '../../lib/telemetry/contract';

describe('telemetry U0 contract', () => {
  it('enables only opted-in official stable production builds', () => {
    const valid = {
      dsn: 'https://public@example.invalid/1',
      channel: 'stable',
      version: '0.63.0',
      nodeEnv: 'production',
    };
    assert.equal(resolveTelemetryConfig(valid).enabled, true);
    assert.equal(resolveTelemetryConfig({ ...valid, optedOut: true }).enabled, false);
    assert.equal(resolveTelemetryConfig({ ...valid, channel: 'preview' }).enabled, false);
    assert.equal(resolveTelemetryConfig({ ...valid, nodeEnv: 'development' }).enabled, false);
    assert.equal(resolveTelemetryConfig({ ...valid, dsn: '' }).enabled, false);
    assert.equal(resolveTelemetryConfig(valid).release, 'codepilot@0.63.0');
    assert.equal(resolveTelemetryConfig(valid).environment, 'production');
    assert.equal(resolveTelemetryConfig({ ...valid, channel: 'preview' }).environment, 'preview');
  });

  it('disables both real Node v10 session producers while retaining Http', async () => {
    const Sentry = await import('@sentry/node');
    const envelopes: unknown[] = [];
    let defaultsSeen: string[] = [];
    let configuredSeen: string[] = [];
    const client = Sentry.init({
      dsn: 'https://public@example.invalid/1',
      tracesSampleRate: 0,
      transport: () => ({
        send(envelope) {
          envelopes.push(envelope);
          return Promise.resolve({ statusCode: 200 });
        },
        flush() {
          return Promise.resolve(true);
        },
      }),
      integrations(defaults) {
        defaultsSeen = defaults.map((item) => item.name);
        const configured = configureNextServerIntegrations(
          defaults,
          Sentry.httpIntegration({
            trackIncomingRequestsAsSessions: false,
            sessionFlushingDelayMS: 1,
            maxIncomingRequestBodySize: 'none',
          }),
        );
        configuredSeen = configured.map((item) => item.name);
        return configured;
      },
    });

    try {
      assert.ok(client, 'expected a real Node client');
      assert.ok(defaultsSeen.includes('ProcessSession'));
      assert.ok(defaultsSeen.includes('Http'));
      assert.equal(configuredSeen.includes('ProcessSession'), false);
      assert.equal(configuredSeen.filter((name) => name === 'Http').length, 1);

      const http = await import('node:http');
      const server = http.createServer((_request, response) => response.end('ok'));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const address = server.address();
        assert.ok(address && typeof address === 'object');
        await new Promise<void>((resolve, reject) => {
          http.get(`http://127.0.0.1:${address.port}/health`, (response) => {
            response.resume();
            response.on('end', resolve);
          }).on('error', reject);
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        await Sentry.flush(1_000);
        const envelopeItemTypes = envelopes.flatMap((envelope) => {
          if (!Array.isArray(envelope) || !Array.isArray(envelope[1])) return [];
          return envelope[1].map((item) => Array.isArray(item) && item[0] && typeof item[0] === 'object'
            ? String((item[0] as { type?: unknown }).type ?? '')
            : '');
        });
        assert.equal(envelopeItemTypes.includes('session'), false);
        assert.equal(envelopeItemTypes.includes('sessions'), false);
      } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    } finally {
      await Sentry.close(1_000);
    }
  });

  it('keeps exactly one default session producer', () => {
    const integrations = [
      { name: 'BrowserSession' },
      { name: 'ProcessSession' },
      { name: 'MainProcessSession' },
      { name: 'Console' },
      { name: 'Screenshots' },
      { name: 'InboundFilters' },
    ];
    assert.deepEqual(
      filterTelemetryIntegrations('renderer', integrations).map((item) => item.name),
      ['ProcessSession', 'MainProcessSession', 'Console', 'Screenshots', 'InboundFilters'],
    );
    assert.deepEqual(
      filterTelemetryIntegrations('next_server', integrations).map((item) => item.name),
      ['BrowserSession', 'MainProcessSession', 'Screenshots', 'InboundFilters'],
    );
    assert.deepEqual(
      filterTelemetryIntegrations('electron_main', integrations).map((item) => item.name),
      ['BrowserSession', 'ProcessSession', 'MainProcessSession', 'InboundFilters'],
    );
  });

  it('replaces Electron session and ChildProcess producers with one controlled instance each', () => {
    const eager: { name: string; eager?: boolean } = { name: 'MainProcessSession', eager: true };
    const breadcrumbsOnly: { name: string; events?: string[] } = { name: 'ChildProcess', events: [] };
    const configured = configureElectronMainIntegrations([
      { name: 'InboundFilters' },
      { name: 'ChildProcess' },
      { name: 'MainProcessSession' },
      { name: 'ChildProcess' },
      { name: 'MainProcessSession' },
      { name: 'Console' },
    ], eager, breadcrumbsOnly);
    assert.deepEqual(configured, [
      { name: 'InboundFilters' },
      breadcrumbsOnly,
      eager,
    ]);
    assert.equal(configured.filter((item) => item.name === 'MainProcessSession').length, 1);
    assert.equal(configured.filter((item) => item.name === 'ChildProcess').length, 1);
  });

  it('adds controlled Electron integrations when SDK defaults are absent', () => {
    const eager: { name: string; eager?: boolean } = { name: 'MainProcessSession', eager: true };
    const breadcrumbsOnly: { name: string; events?: string[] } = { name: 'ChildProcess', events: [] };
    const configured = configureElectronMainIntegrations([
      { name: 'InboundFilters' },
    ], eager, breadcrumbsOnly);
    assert.deepEqual(configured, [{ name: 'InboundFilters' }, eager, breadcrumbsOnly]);
  });

  it('drops raw native minidump attachments unless the isolated smoke build opts in', () => {
    const eager = { name: 'MainProcessSession' };
    const breadcrumbsOnly = { name: 'ChildProcess' };
    const defaults = [
      { name: 'InboundFilters' },
      { name: 'SentryMinidump' },
    ];

    assert.equal(
      configureElectronMainIntegrations(defaults, eager, breadcrumbsOnly)
        .some((integration) => integration.name === 'SentryMinidump'),
      false,
    );
    assert.equal(
      configureElectronMainIntegrations(
        defaults,
        eager,
        breadcrumbsOnly,
        { allowNativeMinidumps: true },
      ).some((integration) => integration.name === 'SentryMinidump'),
      true,
    );
  });

  it('separates product faults from expected/user-action outcomes', () => {
    assert.equal(classifyTelemetryOutcome('SESSION_STATE_ERROR', new Error('bad state')), 'product_fault');
    assert.equal(classifyTelemetryOutcome('EMPTY_RESPONSE', new Error('empty')), 'provider_protocol_fault');
    assert.equal(classifyTelemetryOutcome('TIMEOUT_FIRST_TOKEN', new Error('aborted')), 'transient_upstream');
    assert.equal(classifyTelemetryOutcome('NO_CREDENTIALS', new Error('no key')), 'user_action_required');
    assert.equal(
      classifyTelemetryOutcome('UNKNOWN', new Error('500'), { providerTest: true }),
      'provider_test_result',
    );
    assert.equal(classifyTelemetryOutcome('UNKNOWN', new Error('request cancelled')), 'user_cancelled');
    assert.equal(classifyTelemetryOutcome('CONTEXT_TOO_LONG', new Error('too long')), 'user_action_required');
    assert.equal(classifyTelemetryOutcome('RESUME_FAILED', new Error('stale session')), 'user_action_required');
    assert.equal(classifyTelemetryOutcome('CLI_VERSION_TOO_OLD', new Error('upgrade')), 'user_action_required');
    assert.equal(classifyTelemetryOutcome('UNSUPPORTED_FEATURE', new Error('unsupported')), 'user_action_required');
    assert.equal(
      classifyTelemetryOutcome('NETWORK_UNREACHABLE', new Error('offline')),
      'user_action_required',
    );
    assert.equal(
      classifyTelemetryOutcome('NETWORK_UNREACHABLE', new Error('offline'), { retryExhausted: true }),
      'transient_upstream',
    );
    assert.equal(
      classifyTelemetryOutcome('RATE_LIMITED', new Error('429 quota'), { retryExhausted: true }),
      'user_action_required',
    );
    assert.equal(shouldSendErrorEnvelope('user_action_required'), false);
    assert.equal(shouldSendErrorEnvelope('product_fault'), true);
    assert.equal(shouldUseDefaultStackGrouping('unknown', new Error('unclassified bug')), true);
    assert.equal(shouldUseDefaultStackGrouping('unknown', 'no stack'), false);
    assert.equal(shouldUseDefaultStackGrouping('provider_protocol_fault', new Error('bad wire')), false);
  });

  it('builds bounded fingerprints from enums instead of message text or IDs', () => {
    assert.deepEqual(buildNormalizedFingerprint({
      category: 'EMPTY_RESPONSE',
      layer: 'next_server',
      runtimeId: 'codepilot_runtime',
      providerProtocol: 'openai_responses',
      providerClass: 'official',
      statusCode: 502,
    }), [
      'normalized-v1',
      'empty_response',
      'next_server',
      'codepilot_runtime',
      'openai_responses',
      'official',
      '5xx',
    ]);
    assert.equal(
      buildNormalizedFingerprint({
        category: 'EMPTY_RESPONSE',
        layer: 'next_server',
        runtimeId: 'session-123/../../secret',
      })[3],
      'other',
    );
  });

  it('freezes every HTTP 4xx as user action, including 400/422/429', () => {
    for (const statusCode of [400, 401, 402, 403, 404, 418, 422, 429]) {
      assert.equal(
        classifyTelemetryOutcome('INVALID_REQUEST', new Error('invalid'), { statusCode }),
        'user_action_required',
        String(statusCode),
      );
    }
  });
});
