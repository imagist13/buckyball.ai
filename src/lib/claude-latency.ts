import type { TokenUsage } from '@/types';

/**
 * Latency facts emitted by Claude Agent SDK for one user-visible turn.
 * Stored inside the existing token_usage JSON so no schema migration or fake
 * values are needed. Missing SDK fields remain absent.
 */
export interface ClaudeRuntimeLatencySample {
  ttftMs?: number;
  durationMs?: number;
  durationApiMs?: number;
  wallMs: number;
  apiRetryCount: number;
  terminalType: string;
  resumeAttempted: boolean;
  resumeFallback: boolean;
}

function nonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

/** Add only measured fields; never invent a zero for a value the SDK omitted. */
export function attachClaudeRuntimeLatency(
  usage: TokenUsage | null | undefined,
  sample: ClaudeRuntimeLatencySample,
): TokenUsage | null {
  if (!usage) return null;

  const ttftMs = nonNegativeInteger(sample.ttftMs);
  const durationMs = nonNegativeInteger(sample.durationMs);
  const durationApiMs = nonNegativeInteger(sample.durationApiMs);
  const wallMs = nonNegativeInteger(sample.wallMs);
  const apiRetryCount = nonNegativeInteger(sample.apiRetryCount) ?? 0;

  return {
    ...usage,
    runtime_latency: {
      source: 'claude-agent-sdk',
      ...(ttftMs !== undefined ? { ttft_ms: ttftMs } : {}),
      ...(durationMs !== undefined ? { duration_ms: durationMs } : {}),
      ...(durationApiMs !== undefined ? { duration_api_ms: durationApiMs } : {}),
      ...(wallMs !== undefined ? { wall_ms: wallMs } : {}),
      api_retry_count: apiRetryCount,
      terminal_type: sample.terminalType,
      resume_attempted: sample.resumeAttempted,
      resume_fallback: sample.resumeFallback,
    },
  };
}

/** Shape-only log payload. It deliberately contains no prompt, title or URL. */
export function logClaudeRuntimeLatency(usage: TokenUsage | null): void {
  if (!usage?.runtime_latency) return;
  console.info('[claude-client.latency]', usage.runtime_latency);
}
