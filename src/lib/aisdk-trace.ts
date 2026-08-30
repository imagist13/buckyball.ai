/**
 * aisdk-trace — redacted-by-default AI SDK telemetry trace (AI SDK 7 exec
 * plan Phase 4 ③).
 *
 * ai@7 exposes a callback-based `Telemetry` integration surface
 * (`streamText({ telemetry: { integrations: [...] } })`) whose events carry
 * the FULL prompt messages in provider format, tool inputs/outputs, and
 * request/response bodies. Piping those events anywhere unredacted would
 * leak prompts and credentials into logs — exactly what the log-sanitize /
 * doctor-export sanitizers exist to prevent.
 *
 * This module is the ONLY sanctioned way to enable that trace:
 *
 *   - **Default OFF.** `isAiSdkTraceEnabled()` requires the explicit
 *     `CODEPILOT_AISDK_TRACE=1` env switch (same pattern as
 *     `CODEPILOT_CODEX_TRACE` from the log-bloat plan). Without it the
 *     production agent-loop passes NO telemetry option — wire-identical to
 *     before this module existed.
 *   - **Redaction is structural and fail-closed.** Values survive only via
 *     an ALLOWLIST of known-safe metadata keys (model ids, tool names, step
 *     numbers, finish reasons, token counts, durations). Every other string
 *     — including any field a future SDK version adds — is replaced by a
 *     `[redacted sha256:… len:…]` digest placeholder. Content-bearing
 *     subtrees (messages / prompt / input / output / request / response /
 *     error bodies) are collapsed to a single digest before recursion could
 *     even see them. The digest lets a developer correlate "same content"
 *     across events without revealing it.
 *   - **Belt-and-suspenders string scrub.** Even allowlisted values and the
 *     final serialized line pass through `sanitizeLogLine` (the same
 *     credential scrubber the persistent main-process log uses), so a key
 *     smuggled into a "safe" field still gets masked.
 *   - **No raw mode.** A "trace with prompts visible" switch would move the
 *     log-redaction boundary and is intentionally NOT implemented here —
 *     that is a human-gate decision (see plan Phase 4 stop conditions).
 *
 * Trace destination: stdout lines prefixed `[aisdk-trace]` (JSONL). In the
 * packaged app stdout already flows through the main-process log pipeline
 * (which sanitizes and rotates); in dev it stays in the terminal.
 */

import crypto from 'crypto';
import type { Telemetry } from 'ai';
import { sanitizeLogLine } from '../../electron/log-sanitize';

// ── Policy tables ────────────────────────────────────────────────

/**
 * Keys whose PRIMITIVE string values are safe diagnostic metadata. Anything
 * not listed here is redacted to a digest — fail-closed for unknown fields.
 */
const SAFE_STRING_KEYS = new Set([
  'operationId',
  'functionId',
  'model',
  'modelId',
  'provider',
  'providerId',
  'toolName',
  'toolCallId',
  'stepType',
  'finishReason',
  'rawFinishReason',
  'stopReason',
  'type',
  'event',
  'runId',
  'callId',
  'requestId',
  'responseId',
  'version',
  'specificationVersion',
]);

/**
 * Keys whose ENTIRE subtree is content (prompts, tool payloads, wire
 * bodies). Collapsed to one digest without recursing — the shape of a
 * user's conversation is already information.
 */
const CONTENT_SUBTREE_KEYS = new Set([
  'prompt',
  'messages',
  'system',
  'content',
  'input',
  'inputs',
  'output',
  'outputs',
  'text',
  'reasoning',
  'delta',
  'body',
  'request',
  'response',
  'error',
  'args',
  'arguments',
  'result',
  'results',
  'toolCalls',
  'toolResults',
  'steps',
  'headers',
  'providerOptions',
  'providerMetadata',
]);

const MAX_DEPTH = 8;

// ── Redaction core ───────────────────────────────────────────────

function digest(value: unknown): string {
  const s = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  const hash = crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);
  return `[redacted sha256:${hash} len:${s.length}]`;
}

/**
 * Structurally redact one telemetry event payload. Pure; never throws
 * (a trace failure must never break the run).
 */
export function redactTraceValue(value: unknown, key?: string, depth = 0): unknown {
  try {
    if (value === null || value === undefined) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (depth > MAX_DEPTH) return digest(value);
    if (key && CONTENT_SUBTREE_KEYS.has(key)) return digest(value);
    if (typeof value === 'string') {
      if (key && SAFE_STRING_KEYS.has(key)) return sanitizeLogLine(value);
      return digest(value);
    }
    if (Array.isArray(value)) {
      return value.map((v) => redactTraceValue(v, undefined, depth + 1));
    }
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = redactTraceValue(v, k, depth + 1);
      }
      return out;
    }
    // functions / symbols / bigints — nothing a trace needs verbatim
    return digest(String(value));
  } catch {
    return '[redacted: redaction-error]';
  }
}

// ── Enablement + integration ─────────────────────────────────────

export function isAiSdkTraceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CODEPILOT_AISDK_TRACE === '1';
}

export type TraceSink = (line: string) => void;

const defaultSink: TraceSink = (line) => {
  console.log(`[aisdk-trace] ${line}`);
};

/**
 * Build an ai@7 `Telemetry` integration whose every event is structurally
 * redacted before it reaches the sink. The serialized line additionally
 * passes through `sanitizeLogLine` as a final scrub.
 */
export function createRedactedTraceTelemetry(sink: TraceSink = defaultSink): Telemetry {
  const emit = (event: string, payload: unknown) => {
    try {
      const redacted = redactTraceValue(payload) as Record<string, unknown>;
      const line = sanitizeLogLine(JSON.stringify({ event, ...redacted }));
      sink(line);
    } catch {
      // trace must never break the run
    }
  };
  return {
    onStart: (e) => emit('start', e),
    onStepStart: (e) => emit('step-start', e),
    onLanguageModelCallStart: (e) => emit('model-call-start', e),
    onLanguageModelCallEnd: (e) => emit('model-call-end', e),
    onToolExecutionStart: (e) => emit('tool-execution-start', e),
    onToolExecutionEnd: (e) => emit('tool-execution-end', e),
    onStepEnd: (e) => emit('step-end', e),
  };
}
