/**
 * Phase 5b foundation — Codex Responses proxy.
 *
 * Three units pinned here:
 *
 *   1. Request parser (`parseResponsesRequest`) — happy path +
 *      every field-level failure must produce a clean `field`
 *      identifier so the route can echo it back to Codex's reader.
 *
 *   2. Provider parity inventory (`getProxyParityEntry` /
 *      `ADAPTER_FAMILY_BY_COMPAT` / `ADAPTER_STATUS_BY_COMPAT`) —
 *      every ProviderRuntimeCompat tier in the union MUST have a
 *      family + status entry. Adding a new compat tier without
 *      registering its adapter mapping fails this test.
 *
 *   3. Route dispatch — covered via the adapter entry point
 *      `handleProxyRequest`. Provider not targeted / not found /
 *      credentials missing / adapter pending all return the
 *      structured Responses error (no raw 501 anywhere).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseResponsesRequest } from '@/lib/codex/proxy/parse-request';
import {
  ADAPTER_FAMILY_BY_COMPAT,
  ADAPTER_STATUS_BY_COMPAT,
  getProxyParityEntry,
  pickerDisabledReason,
} from '@/lib/codex/proxy/provider-parity';
import { handleProxyRequest, registerAdapter } from '@/lib/codex/proxy/adapter';
import { makeErrorResult, classifyUpstreamError } from '@/lib/codex/proxy/errors';
import { serializeCodexProxyResult } from '@/lib/codex/proxy/http-response';
import type { ResponsesRequestBody } from '@/lib/codex/proxy/types';
import type { ProviderRuntimeCompat, ApiProvider } from '@/types';

// ─────────────────────────────────────────────────────────────────────
// Request parser
// ─────────────────────────────────────────────────────────────────────

describe('parseResponsesRequest — happy path + field-level failures', () => {
  it('parses a minimal valid request (model + empty input)', () => {
    const r = parseResponsesRequest({ model: 'gpt-4o', input: [] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.body.model, 'gpt-4o');
    assert.deepEqual(r.body.input, []);
    assert.equal(r.body.stream, true); // default
  });

  it('parses a message item with input_text + output_text content blocks', () => {
    const r = parseResponsesRequest({
      model: 'gpt-4o',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: 'hello' },
            { type: 'input_image', image_url: 'https://example.com/x.png' },
          ],
        },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'hi there' }],
        },
      ],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.body.input.length, 2);
    assert.equal(r.body.input[0].type, 'message');
  });

  it('parses function_call + function_call_output items round-trip', () => {
    const r = parseResponsesRequest({
      model: 'gpt-4o',
      input: [
        { type: 'function_call', call_id: 'fc_1', name: 'read', arguments: '{"path":"a.md"}' },
        { type: 'function_call_output', call_id: 'fc_1', output: 'file contents' },
      ],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.body.input[0].type, 'function_call');
    assert.equal(r.body.input[1].type, 'function_call_output');
  });

  it('parses tools[] with optional description + parameters', () => {
    const r = parseResponsesRequest({
      model: 'gpt-4o',
      input: [],
      tools: [
        { type: 'function', name: 'read', description: 'Read a file', parameters: { type: 'object' } },
        { type: 'function', name: 'noschema' }, // parameters optional
      ],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.body.tools?.length, 2);
    assert.equal(r.body.tools?.[0].description, 'Read a file');
  });

  it('rejects non-object body', () => {
    const r = parseResponsesRequest('hello');
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.message, /JSON object/);
  });

  it('rejects missing model with field=model', () => {
    const r = parseResponsesRequest({ input: [] });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.field, 'model');
  });

  it('rejects missing input with field=input', () => {
    const r = parseResponsesRequest({ model: 'x' });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.field, 'input');
  });

  it('rejects unsupported content block type with field path', () => {
    const r = parseResponsesRequest({
      model: 'x',
      input: [{ type: 'message', role: 'user', content: [{ type: 'audio', url: 'x' }] }],
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.field || '', /content\[0\]\.type/);
  });

  it('silently drops non-function tools instead of rejecting (Phase 5b smoke fix 2026-05-15)', () => {
    // Codex's real `turn/start` payload mixes function tools with
    // Codex-specific custom tools (e.g. `{ type: 'custom' }` for
    // Codex's own shell / apply_patch surface). The pre-fix parser
    // returned a 400 on those, blocking every real Codex chat that
    // surfaced non-trivial tools. Phase 5b's scope is chat parity,
    // not full custom-tool bridging — so non-function tools are
    // filtered out silently. The function tools survive.
    const r = parseResponsesRequest({
      model: 'x',
      input: [],
      tools: [
        { type: 'function', name: 'lookup', parameters: { type: 'object', properties: {} } },
        { type: 'custom', name: 'apply_patch' }, // Codex's custom tool
        { type: 'function', name: 'search' },
        { type: 'web_search' }, // unknown future kind
      ],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    // Only the two function-typed tools survive; the custom + unknown
    // entries are silently dropped.
    assert.equal(r.body.tools?.length, 2, 'only the function-typed tools survive the filter');
    assert.deepEqual(
      r.body.tools?.map(t => t.name).sort(),
      ['lookup', 'search'],
      'the surviving tools must be the function-typed ones, in original order',
    );
  });

  it('treats "all tools were filtered out" the same as no tools (undefined, not [])', () => {
    // ai-sdk distinguishes undefined from an empty array — passing []
    // disables tool calling explicitly. The post-filter empty case
    // should look identical to "Codex sent no tools at all".
    const r = parseResponsesRequest({
      model: 'x',
      input: [],
      tools: [{ type: 'custom' }, { type: 'web_search' }],
    });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.body.tools, undefined, 'empty-after-filter must collapse to undefined');
  });

  it('still rejects malformed tools arrays at the structural level', () => {
    // The filter only kicks in for `type !== 'function'`. Other
    // structural problems (tools not an array, function tool missing
    // name) still fail with the field-level error so the parser
    // doesn't quietly swallow real bugs.
    const notArray = parseResponsesRequest({ model: 'x', input: [], tools: 'oops' });
    assert.equal(notArray.ok, false);
    if (notArray.ok) return;
    assert.equal(notArray.field, 'tools');

    const missingName = parseResponsesRequest({
      model: 'x',
      input: [],
      tools: [{ type: 'function' }],
    });
    assert.equal(missingName.ok, false);
    if (missingName.ok) return;
    assert.match(missingName.field || '', /tools\[0\]\.name/);
  });

  it('preserves boolean `store` field on the parsed body (Phase 5b smoke fix 2026-05-15)', () => {
    // Codex's openai-oauth path (chatgpt.com/backend-api/codex/responses)
    // requires `store: false` upstream. Codex's HTTP client always
    // sends it; we must preserve the field so the unified adapter can
    // forward it via providerOptions.openai.store. Pre-fix the parser
    // dropped the field entirely.
    const r = parseResponsesRequest({ model: 'x', input: [], store: false });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.body.store, false, 'store:false must survive parsing');

    const rTrue = parseResponsesRequest({ model: 'x', input: [], store: true });
    assert.equal(rTrue.ok, true);
    if (!rTrue.ok) return;
    assert.equal(rTrue.body.store, true, 'store:true also survives — the adapter decides what to do');

    const rOmitted = parseResponsesRequest({ model: 'x', input: [] });
    assert.equal(rOmitted.ok, true);
    if (!rOmitted.ok) return;
    assert.equal(rOmitted.body.store, undefined, 'omitted store stays undefined so the adapter can pick a default');
  });

  it('defaults stream=true when omitted (Codex sends stream:true by convention)', () => {
    const r = parseResponsesRequest({ model: 'x', input: [] });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.body.stream, true);
  });

  it('respects explicit stream:false', () => {
    const r = parseResponsesRequest({ model: 'x', input: [], stream: false });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.body.stream, false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Provider parity inventory
// ─────────────────────────────────────────────────────────────────────

describe('Provider parity inventory — every compat tier maps to a family + status', () => {
  // The full ProviderRuntimeCompat union as documented in types/index.ts.
  // Adding a new tier upstream MUST be registered here AND in the two
  // maps; the test below catches the omission.
  const ALL_COMPAT_TIERS: ProviderRuntimeCompat[] = [
    'claude_code_ready',
    'claude_code_verified',
    'claude_code_experimental',
    'openrouter_anthropic_skin',
    'codepilot_only',
    'codex_account',
    'media_only',
    'unknown',
  ];

  it('ADAPTER_FAMILY_BY_COMPAT covers every ProviderRuntimeCompat tier', () => {
    for (const tier of ALL_COMPAT_TIERS) {
      const family = ADAPTER_FAMILY_BY_COMPAT[tier];
      assert.ok(family, `tier "${tier}" must map to an AdapterFamily`);
    }
  });

  it('ADAPTER_STATUS_BY_COMPAT covers every ProviderRuntimeCompat tier', () => {
    for (const tier of ALL_COMPAT_TIERS) {
      const status = ADAPTER_STATUS_BY_COMPAT[tier];
      assert.ok(status, `tier "${tier}" must declare an adapter status`);
    }
  });

  it('codex_account + media_only map to family=native AND status=not_applicable', () => {
    // These tiers don't go through the proxy by design. Misroute
    // surfaces as a clear error rather than silently dispatching.
    assert.equal(ADAPTER_FAMILY_BY_COMPAT.codex_account, 'native');
    assert.equal(ADAPTER_STATUS_BY_COMPAT.codex_account, 'not_applicable');
    assert.equal(ADAPTER_FAMILY_BY_COMPAT.media_only, 'native');
    assert.equal(ADAPTER_STATUS_BY_COMPAT.media_only, 'not_applicable');
  });

  it('claude_code_verified + claude_code_experimental route to the codeplan family', () => {
    // Brand-specific subscription tiers (GLM / Kimi / 百炼 / MiniMax
    // / DeepSeek) all speak Anthropic wire but carry per-brand alias
    // mapping the CodePlan adapter is responsible for. Verified +
    // experimental both classify there so the brand-specific quirks
    // get the dedicated handler.
    assert.equal(ADAPTER_FAMILY_BY_COMPAT.claude_code_verified, 'codeplan');
    assert.equal(ADAPTER_FAMILY_BY_COMPAT.claude_code_experimental, 'codeplan');
  });

  it('getProxyParityEntry: ready tiers have no excluded_reason; unknown tier still surfaces one', () => {
    // Phase 5b: GLM is a CodePlan-family provider (claude_code_experimental
    // tier) and the adapter is now wired, so excluded_reason is gone.
    const glm: ApiProvider = {
      id: 'glm-test',
      name: 'GLM (CN)',
      provider_type: 'glm',
      base_url: 'https://open.bigmodel.cn/api/anthropic',
      protocol: 'anthropic-thirdparty',
      api_key: 'sk-test',
      enabled: 1,
      sort_order: 0,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    } as unknown as ApiProvider;
    const glmEntry = getProxyParityEntry(glm);
    assert.equal(glmEntry.provider_id, 'glm-test');
    assert.equal(glmEntry.adapter_status, 'ready');
    assert.equal(glmEntry.excluded_reason, undefined, 'ready tier must NOT carry excluded_reason — picker should re-enable the row');

    // An `unknown`-tier provider still surfaces excluded_reason — the
    // proxy can't pick a wire format without more info. Phase 5b
    // shipped the unified translator for every recognised tier, so the
    // copy shifted from "正在接入" / "being wired" (sweep-pending) to
    // "暂未识别 wire format" / "wire format unidentified" — the proxy
    // is live, it just can't fingerprint the wire format for this row.
    const unknownProv: ApiProvider = {
      id: 'mystery-test',
      name: 'Mystery Provider',
      provider_type: 'custom-mystery',
      base_url: 'https://mystery.example/v1',
      protocol: 'openai-compat',
      api_key: 'sk-test',
      enabled: 1,
      sort_order: 0,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    } as unknown as ApiProvider;
    const unknownEntry = getProxyParityEntry(unknownProv);
    assert.equal(unknownEntry.adapter_status, 'pending');
    assert.ok(unknownEntry.excluded_reason, 'pending tier must carry an excluded_reason for the picker tooltip');
    assert.match(pickerDisabledReason(unknownEntry.adapter_family, true), /暂未识别|wire format/);
    assert.match(pickerDisabledReason(unknownEntry.adapter_family, false), /unidentified|wire format/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Adapter dispatch
// ─────────────────────────────────────────────────────────────────────

describe('handleProxyRequest — pre-stream errors are structured Responses errors, not 501', () => {
  const validBody = {
    model: 'gpt-4o',
    input: [{ type: 'message' as const, role: 'user' as const, content: [{ type: 'input_text' as const, text: 'hi' }] }],
    stream: true,
  };

  it('returns provider_not_targeted when the header is missing', async () => {
    const result = await handleProxyRequest({
      targetProviderId: '',
      sessionId: '',
      workspacePath: '',
      body: validBody,
      signal: new AbortController().signal,
    });
    assert.equal(result.kind, 'error');
    if (result.kind !== 'error') return;
    assert.equal(result.error.code, 'provider_not_targeted');
    assert.equal(result.status, 400);
  });

  it('returns provider_not_found when the DB row is missing', async () => {
    const result = await handleProxyRequest({
      targetProviderId: 'this-id-does-not-exist-in-db',
      sessionId: '',
      workspacePath: '',
      body: validBody,
      signal: new AbortController().signal,
    });
    assert.equal(result.kind, 'error');
    if (result.kind !== 'error') return;
    assert.equal(result.error.code, 'provider_not_found');
    assert.equal(result.status, 404);
  });
});

describe('classifyUpstreamError — maps ai-sdk / fetch errors to ResponsesErrorCode', () => {
  it('classifies AbortError to upstream_timeout', () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    const c = classifyUpstreamError(err);
    assert.equal(c.code, 'upstream_timeout');
  });

  it('classifies HTTP 401 to upstream_unauthorized', () => {
    const err = Object.assign(new Error('Bad key'), { statusCode: 401 });
    const c = classifyUpstreamError(err);
    assert.equal(c.code, 'upstream_unauthorized');
  });

  it('classifies HTTP 429 to upstream_rate_limited', () => {
    const err = Object.assign(new Error('too many'), { statusCode: 429 });
    const c = classifyUpstreamError(err);
    assert.equal(c.code, 'upstream_rate_limited');
  });

  it('classifies HTTP 5xx to upstream_server_error', () => {
    const err = Object.assign(new Error('boom'), { statusCode: 503 });
    const c = classifyUpstreamError(err);
    assert.equal(c.code, 'upstream_server_error');
  });

  it('classifies timeout messages to upstream_timeout', () => {
    const err = new Error('ETIMEDOUT');
    const c = classifyUpstreamError(err);
    assert.equal(c.code, 'upstream_timeout');
  });

  it('falls back to internal_error for anything unclassified', () => {
    const c = classifyUpstreamError(new Error('something weird'));
    assert.equal(c.code, 'internal_error');
  });
});

describe('makeErrorResult — default status by code', () => {
  it('credentials_missing → 401', () => {
    assert.equal(makeErrorResult('credentials_missing', 'm').status, 401);
  });
  it('provider_not_found → 404', () => {
    assert.equal(makeErrorResult('provider_not_found', 'm').status, 404);
  });
  it('adapter_not_implemented → 501', () => {
    // This is the one place 501 is still used — for the
    // adapter-pending case. It still encodes the structured error
    // body though, NOT the bare "unsupported_yet" the pre-5b
    // scaffold returned. Codex's HTTP client reads
    // `error.code === 'adapter_not_implemented'` and can branch on
    // family from `error.context`.
    assert.equal(makeErrorResult('adapter_not_implemented', 'm').status, 501);
  });
  it('upstream_rate_limited → 429', () => {
    assert.equal(makeErrorResult('upstream_rate_limited', 'm').status, 429);
  });
  it('upstream_timeout → 504', () => {
    assert.equal(makeErrorResult('upstream_timeout', 'm').status, 504);
  });
});

describe('serializeCodexProxyResult — transport status is not Provider status', () => {
  const body: ResponsesRequestBody = {
    model: 'gpt-4o',
    input: [],
    stream: true,
  };

  it('returns an upstream 502 as HTTP 200 response.failed for a streaming Codex request', async () => {
    const response = serializeCodexProxyResult(
      makeErrorResult('upstream_server_error', 'Provider is unavailable'),
      body,
      () => 'resp_test',
    );

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
    const text = await response.text();
    assert.match(text, /event: response\.failed/);
    assert.match(text, /"code":"upstream_server_error"/);
    assert.match(text, /Provider is unavailable/);
    assert.match(text, /data: \[DONE\]/);
  });

  it('keeps HTTP status + structured JSON for an explicit non-stream request', async () => {
    const response = serializeCodexProxyResult(
      makeErrorResult('upstream_server_error', 'Provider is unavailable'),
      { ...body, stream: false },
      () => 'unused',
    );

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: {
        code: 'upstream_server_error',
        message: 'Provider is unavailable',
      },
    });
  });
});

describe('registerAdapter — runtime override stays available for tests', () => {
  it('exposes a function that swaps the family adapter at runtime', () => {
    // Phase 5b shipped a unified adapter wired statically at module
    // init. The registerAdapter escape hatch is retained so tests
    // (or a future hot-fix path) can swap in a stub for a single
    // family without recompiling. Pre-5b sub-commits used this to
    // land per-family adapters incrementally; the unified translator
    // made that flow unnecessary, but keeping the hook costs nothing
    // and unblocks targeted unit testing.
    let called = false;
    registerAdapter('openai_compatible', async () => {
      called = true;
      return makeErrorResult('internal_error', 'test stub');
    });
    assert.equal(typeof registerAdapter, 'function');
    assert.equal(called, false);
  });
});
