import type { TelemetryLayer } from './contract';

const SMOKE_MESSAGES: Record<TelemetryLayer, string> = {
  renderer: 'CODEPILOT_TELEMETRY_SMOKE_RENDERER',
  next_server: 'CODEPILOT_TELEMETRY_SMOKE_NEXT_SERVER',
  electron_main: 'CODEPILOT_TELEMETRY_SMOKE_ELECTRON_MAIN',
};

/**
 * Build-time-only fixture used by the manually dispatched stable telemetry
 * smoke. Official tags and ordinary local builds compile this branch off.
 */
export function telemetrySmokeEnabled(value?: string): boolean {
  return value === '1';
}

/** Keep one named source location per layer so Sentry symbolication is exact. */
export function createTelemetrySmokeError(layer: TelemetryLayer): Error {
  switch (layer) {
    case 'renderer':
      return new Error(SMOKE_MESSAGES.renderer);
    case 'next_server':
      return new Error(SMOKE_MESSAGES.next_server);
    case 'electron_main':
      return new Error(SMOKE_MESSAGES.electron_main);
  }
}

