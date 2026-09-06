/**
 * POST /api/codex/proxy/v1/responses
 *
 * Phase 5b — CodePilot provider proxy entry point.
 *
 * Codex's HTTP client routes here when a thread's `model_provider`
 * is the injected `codepilot_proxy` (see
 * `src/lib/codex/provider-proxy.ts` for the injection shape). The
 * route is intentionally a thin HTTP shell:
 *
 *   1. Read target provider header.
 *   2. Parse + validate the Responses request body.
 *   3. Hand off to the proxy adapter (`handleProxyRequest`).
 *   4. Serialise the ProxyResult into either an SSE stream
 *      (`Content-Type: text/event-stream`) or a JSON body.
 *
 * Once a valid request declares `stream:true` (Codex's default), every
 * application/upstream failure is returned as HTTP 200 SSE with a structured
 * `response.failed` event. Non-stream requests keep HTTP status + JSON. This
 * distinction prevents a Provider 502 from becoming indistinguishable from a
 * system proxy intercepting CodePilot's loopback transport.
 *
 * Phase 5b adapter status: SHIPPED. The unified translator at
 * `src/lib/codex/proxy/unified-adapter.ts` handles all three families
 * (OpenAI-compatible, Anthropic-compatible / ClaudeCode-compatible,
 * CodePlan / 套餐型) via ai-sdk's `createModel()` + `streamText`.
 * Only the `unknown` provider tier still hits `adapter_not_implemented`
 * because the proxy can't fingerprint the wire format without more
 * info; everything else flows through.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { handleProxyRequest } from '@/lib/codex/proxy/adapter';
import { parseResponsesRequest } from '@/lib/codex/proxy/parse-request';
import { makeErrorResult, toNonStreamErrorBody } from '@/lib/codex/proxy/errors';
import { serializeCodexProxyResult } from '@/lib/codex/proxy/http-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const targetProviderId = request.headers.get('x-codepilot-target-provider') ?? '';
  // Phase 5c (2026-05-16) — `x-codepilot-session-id` +
  // `x-codepilot-workspace-path` come from the runtime injection
  // (`provider-proxy.ts buildCodexProviderProxyInjection`). They're
  // not load-bearing for the chat-only path; when absent the proxy
  // falls back to the pre-5c behaviour with no built-in tool bridge.
  const sessionId = request.headers.get('x-codepilot-session-id') ?? '';
  const workspacePath = request.headers.get('x-codepilot-workspace-path') ?? '';

  // Parse body — fail fast with a JSON 400 if it's not valid JSON or
  // doesn't satisfy the Responses shape. The error body is the same
  // shape every error returns so Codex's HTTP client only has one
  // error envelope to recognise.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch (err) {
    const result = makeErrorResult(
      'invalid_request',
      `Request body is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
    return NextResponse.json(toNonStreamErrorBody(result.error), { status: result.status });
  }

  const parseResult = parseResponsesRequest(rawBody);
  if (!parseResult.ok) {
    const result = makeErrorResult(
      'invalid_request',
      parseResult.message,
      parseResult.field ? { field: parseResult.field } : undefined,
    );
    return NextResponse.json(toNonStreamErrorBody(result.error), { status: result.status });
  }

  // Dispatch to the adapter. The adapter contract guarantees it
  // never throws — but the route wraps defensively so an unexpected
  // bug doesn't crash Codex's HTTP read loop.
  let proxyResult;
  try {
    proxyResult = await handleProxyRequest({
      targetProviderId,
      sessionId,
      workspacePath,
      body: parseResult.body,
      signal: request.signal,
    });
  } catch (err) {
    const result = makeErrorResult(
      'internal_error',
      `Unexpected proxy error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return NextResponse.json(toNonStreamErrorBody(result.error), { status: result.status });
  }

  return serializeCodexProxyResult(proxyResult, parseResult.body);
}
