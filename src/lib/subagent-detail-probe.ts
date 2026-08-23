export type SubagentDetailProbeFailureKind = 'not_found' | 'transient';

export interface SubagentDetailProbeDecision {
  delayMs: number;
  burstExhausted: boolean;
}

interface SubagentDetailProbeEntry {
  consecutiveFailures: number;
  nextProbeAt: number;
  cooldownMode: boolean;
}

export const SUBAGENT_DETAIL_FAST_RETRY_MS = 1_000;
export const SUBAGENT_DETAIL_FAST_RETRY_LIMIT = 5;
export const SUBAGENT_DETAIL_COOLDOWN_MS = 30_000;

const MAX_SUBAGENT_DETAIL_PROBE_KEYS = 512;
const probeEntries = new Map<string, SubagentDetailProbeEntry>();

function touchProbeEntry(key: string, entry: SubagentDetailProbeEntry): void {
  probeEntries.delete(key);
  probeEntries.set(key, entry);
  if (probeEntries.size <= MAX_SUBAGENT_DETAIL_PROBE_KEYS) return;
  const oldest = probeEntries.keys().next().value;
  if (oldest) probeEntries.delete(oldest);
}

/**
 * Return how long a newly mounted card should wait before probing.
 *
 * Probe state intentionally survives React remounts so streaming message
 * reconstruction cannot restart a request storm. Unlike the old permanent
 * miss counter, an exhausted burst only enters a cooldown: a durable row that
 * appears late, or a details API that recovers from a transient 5xx, remains
 * discoverable without a full-page refresh.
 */
export function getSubagentDetailInitialProbeDelay(
  key: string,
  now = Date.now(),
): number {
  const entry = probeEntries.get(key);
  if (!entry) return 0;
  touchProbeEntry(key, entry);
  return Math.max(0, entry.nextProbeAt - now);
}

/**
 * Record an unverified details response and schedule the next probe.
 *
 * 404 and transport/5xx failures share the same load-shedding budget, but the
 * caller still owns their different UI meaning: only a confirmed 404 may set
 * durableEvidence="missing"; a transient failure must remain "unknown".
 */
export function recordSubagentDetailProbeFailure(
  key: string,
  _kind: SubagentDetailProbeFailureKind,
  now = Date.now(),
): SubagentDetailProbeDecision {
  const previous = probeEntries.get(key);
  if (previous?.cooldownMode) {
    touchProbeEntry(key, {
      consecutiveFailures: 0,
      nextProbeAt: now + SUBAGENT_DETAIL_COOLDOWN_MS,
      cooldownMode: true,
    });
    return {
      delayMs: SUBAGENT_DETAIL_COOLDOWN_MS,
      burstExhausted: true,
    };
  }
  const consecutiveFailures = (previous?.consecutiveFailures || 0) + 1;
  const burstExhausted = consecutiveFailures >= SUBAGENT_DETAIL_FAST_RETRY_LIMIT;
  const delayMs = burstExhausted
    ? SUBAGENT_DETAIL_COOLDOWN_MS
    : SUBAGENT_DETAIL_FAST_RETRY_MS;
  touchProbeEntry(key, {
    consecutiveFailures: burstExhausted ? 0 : consecutiveFailures,
    nextProbeAt: now + delayMs,
    cooldownMode: burstExhausted,
  });
  return { delayMs, burstExhausted };
}

export function recordSubagentDetailProbeSuccess(key: string): void {
  probeEntries.delete(key);
}

export function resetSubagentDetailProbeStateForTests(): void {
  probeEntries.clear();
}
