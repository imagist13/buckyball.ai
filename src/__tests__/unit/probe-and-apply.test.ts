/**
 * Tests for probeAndApplyProvider — the pure (toast-free) variant that
 * the batch refresh-all driver uses to aggregate outcomes.
 *
 * Specifically locks in the up-to-date split: when probe succeeds and
 * every diff entry is `unchanged`, we still apply (so last_refreshed_at
 * advances) and report `outcome: 'up-to-date'` instead of the
 * misleading `'no-models'` (which previously suppressed the apply call,
 * leaving the section's "Last sync" stuck on the prior probe time).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { probeAndApplyProvider } from '../../lib/auto-discover-models';

const ORIGINAL_FETCH = global.fetch;

interface MockResponse {
  ok: boolean;
  status?: number;
  statusText?: string;
  body: unknown;
}

/**
 * Mock fetch that returns the next queued response for each call.
 * Used to script the two-call sequence (discover-models then apply).
 */
function stubFetchSequence(responses: MockResponse[]) {
  const queue = [...responses];
  global.fetch = (async (input: string | URL | Request) => {
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected fetch call: ${String(input)}`);
    return {
      ok: next.ok,
      status: next.status ?? (next.ok ? 200 : 500),
      statusText: next.statusText ?? (next.ok ? 'OK' : 'Error'),
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    };
  }) as unknown as typeof fetch;
}

function restoreFetch() {
  global.fetch = ORIGINAL_FETCH;
}

describe('probeAndApplyProvider outcome split', () => {
  beforeEach(() => { /* fresh stub per test */ });
  afterEach(restoreFetch);

  it('returns `up-to-date` when diff has only unchanged rows (still calls apply)', async () => {
    let applyCalled = false;
    let applyBody: unknown = null;

    stubFetchSequence([
      // 1st call: /discover-models — probe ok, only `unchanged` entries
      {
        ok: true,
        body: {
          ok: true,
          modelCount: 2,
          diff: [
            { modelId: 'sonnet', upstreamModelId: 'sonnet', status: 'unchanged' },
            { modelId: 'opus', upstreamModelId: 'opus', status: 'unchanged' },
          ],
        },
      },
      // 2nd call: /apply — should be invoked with the unchanged rows so
      // last_refreshed_at advances. Records that fetch happened.
      {
        ok: true,
        body: {
          providerId: 'p1',
          inserted: 0,
          refreshedPristine: 2,
          refreshedPreserved: 0,
          recommendedEnabled: 0,
          discoveredHidden: 0,
        },
      },
    ]);

    // Wrap fetch to capture the apply payload
    const originalStub = global.fetch;
    global.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (typeof input === 'string' && input.includes('/discover-models/apply')) {
        applyCalled = true;
        applyBody = init?.body ? JSON.parse(init.body as string) : null;
      }
      return originalStub(input, init);
    }) as typeof fetch;

    const result = await probeAndApplyProvider({ providerId: 'p1', providerName: 'Test' });

    assert.equal(result.outcome, 'up-to-date',
      'unchanged-only diff must report up-to-date, not no-models');
    assert.equal(result.total, 2);
    assert.equal(applyCalled, true,
      'apply MUST be called even for up-to-date so last_refreshed_at advances');
    assert.ok(applyBody, 'apply received a body');
    const applyParsed = applyBody as { upstreamModels: unknown[] };
    assert.equal(applyParsed.upstreamModels.length, 2,
      'unchanged rows are forwarded to apply for last_refreshed_at update');
  });

  it('returns `success` (not up-to-date) when at least one row was writeable', async () => {
    stubFetchSequence([
      {
        ok: true,
        body: {
          ok: true,
          modelCount: 2,
          diff: [
            { modelId: 'new-one', upstreamModelId: 'new-one', status: 'new' },
            { modelId: 'sonnet', upstreamModelId: 'sonnet', status: 'unchanged' },
          ],
        },
      },
      {
        ok: true,
        body: {
          providerId: 'p1',
          inserted: 1,
          refreshedPristine: 1,
          refreshedPreserved: 0,
          recommendedEnabled: 1,
          discoveredHidden: 0,
        },
      },
    ]);

    const result = await probeAndApplyProvider({ providerId: 'p1', providerName: 'Test' });

    assert.equal(result.outcome, 'success',
      'mixed diff with at least one writeable row → success, not up-to-date');
    assert.equal(result.recommendedEnabled, 1);
  });

  it('returns `no-models` only when probe ok but diff is genuinely empty (no upstream rows)', async () => {
    stubFetchSequence([
      {
        ok: true,
        body: {
          ok: true,
          modelCount: 0,
          diff: [], // truly nothing on upstream side
        },
      },
      // 2nd call would NOT happen — we don't even attempt apply when there's
      // nothing in the apply set. If the function makes a 2nd fetch, it'll
      // throw because the queue is empty.
    ]);

    const result = await probeAndApplyProvider({ providerId: 'p1', providerName: 'Test' });

    assert.equal(result.outcome, 'no-models');
    assert.equal(result.total, 0);
  });

  it('orphan-only diff (DB rows not seen upstream) also returns no-models — no apply call', async () => {
    // discover-models route emits orphans for DB rows missing from upstream.
    // Our applicable filter excludes orphans; if there's nothing on the
    // upstream side at all, we should treat this as no-models, not
    // up-to-date (last_refreshed_at would have nothing to anchor to).
    stubFetchSequence([
      {
        ok: true,
        body: {
          ok: true,
          modelCount: 0,
          diff: [
            { modelId: 'old-row', upstreamModelId: 'old-row', status: 'orphan' },
          ],
        },
      },
    ]);

    const result = await probeAndApplyProvider({ providerId: 'p1', providerName: 'Test' });

    assert.equal(result.outcome, 'no-models',
      'orphan-only means no upstream-sided rows → no-models, no apply call');
  });
});
