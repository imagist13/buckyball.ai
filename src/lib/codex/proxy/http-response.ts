import { failedEventFromError, makeResponseId } from './adapter';
import { makeFailureStream } from './sse';
import type { ProxyResult, ResponsesRequestBody } from './types';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
} as const;

/**
 * Serialize a parsed Codex proxy request without confusing transport status
 * with Provider status.
 *
 * A streaming Responses client must always receive HTTP 200 plus a structured
 * `response.failed` event for application/upstream failures. That leaves an
 * HTTP-level 502 at CodePilot's loopback URL as evidence that the request did
 * not complete the managed proxy protocol (for example, a system proxy
 * intercepted it before the Next route).
 */
export function serializeCodexProxyResult(
  result: ProxyResult,
  requestBody: ResponsesRequestBody,
  responseIdFactory: () => string = makeResponseId,
): Response {
  if (result.kind === 'error') {
    if (requestBody.stream) {
      return new Response(
        makeFailureStream(failedEventFromError(responseIdFactory(), result.error)),
        { status: 200, headers: SSE_HEADERS },
      );
    }
    return Response.json(
      { error: result.error },
      { status: result.status },
    );
  }

  if (result.kind === 'json') {
    return Response.json(result.body, { status: 200 });
  }

  return new Response(result.body, {
    status: 200,
    headers: SSE_HEADERS,
  });
}
