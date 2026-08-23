import { getHeapStatistics } from 'node:v8';

export const SERVER_OBSERVABILITY_CHANNEL = 'codepilot:server-observability';
export const SERVER_OBSERVABILITY_VERSION = 1;
const SERVER_OBSERVABILITY_INTERVAL_MS = 60_000;

export interface ServerRuntimeObservabilityMessage {
  channel: typeof SERVER_OBSERVABILITY_CHANNEL;
  version: typeof SERVER_OBSERVABILITY_VERSION;
  generation: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  heapLimitBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
}

type ElectronUtilityParentPort = { postMessage: (message: unknown) => void };

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function parseServerRuntimeObservabilityMessage(
  value: unknown,
): ServerRuntimeObservabilityMessage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.channel !== SERVER_OBSERVABILITY_CHANNEL) return null;
  if (record.version !== SERVER_OBSERVABILITY_VERSION) return null;
  if (!Number.isSafeInteger(record.generation) || (record.generation as number) <= 0) return null;
  for (const key of [
    'rssBytes',
    'heapUsedBytes',
    'heapTotalBytes',
    'heapLimitBytes',
    'externalBytes',
    'arrayBuffersBytes',
  ] as const) {
    if (!finiteNonNegative(record[key])) return null;
  }
  return record as unknown as ServerRuntimeObservabilityMessage;
}

const TIMER_KEY = Symbol.for('codepilot.serverRuntimeObservabilityTimer');

/**
 * Emit low-frequency, content-free memory facts from the Next utility process
 * to Electron Main. No paths, request bodies, model names, or protocol frames
 * cross this channel.
 */
export function startServerRuntimeObservability(): void {
  const generation = Number.parseInt(process.env.CODEPILOT_SERVER_GENERATION ?? '', 10);
  const parentPort = (process as NodeJS.Process & { parentPort?: ElectronUtilityParentPort }).parentPort;
  if (!Number.isSafeInteger(generation) || generation <= 0 || !parentPort) return;

  const globalState = globalThis as typeof globalThis & { [TIMER_KEY]?: ReturnType<typeof setInterval> };
  if (globalState[TIMER_KEY]) return;

  const report = () => {
    const memory = process.memoryUsage();
    const heap = getHeapStatistics();
    const message: ServerRuntimeObservabilityMessage = {
      channel: SERVER_OBSERVABILITY_CHANNEL,
      version: SERVER_OBSERVABILITY_VERSION,
      generation,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      heapLimitBytes: heap.heap_size_limit,
      externalBytes: memory.external,
      arrayBuffersBytes: memory.arrayBuffers,
    };
    try { parentPort.postMessage(message); } catch { /* parent already gone */ }
  };

  report();
  const timer = setInterval(report, SERVER_OBSERVABILITY_INTERVAL_MS);
  timer.unref();
  globalState[TIMER_KEY] = timer;
}
