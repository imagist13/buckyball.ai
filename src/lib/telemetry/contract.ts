/**
 * Stable telemetry contract shared by the renderer, Next server, and Electron
 * main process. Keep this module free of Sentry imports so the contract can be
 * tested without loading an SDK or its OpenTelemetry dependency graph.
 */

export type TelemetryLayer = 'renderer' | 'next_server' | 'electron_main';
export type TelemetryChannel = 'stable' | 'preview' | 'local' | 'unknown';
export type TelemetryOutcomeKind =
  | 'product_fault'
  | 'provider_protocol_fault'
  | 'transient_upstream'
  | 'user_action_required'
  | 'provider_test_result'
  | 'user_cancelled'
  | 'expected_lifecycle'
  | 'unknown';

export interface TelemetryConfigInput {
  dsn?: string;
  channel?: string;
  version?: string;
  nodeEnv?: string;
  optedOut?: boolean;
}

export interface TelemetryConfig {
  enabled: boolean;
  dsn?: string;
  channel: TelemetryChannel;
  release: string;
  environment: string;
}

const REPORTABLE_OUTCOMES = new Set<TelemetryOutcomeKind>([
  'product_fault',
  'provider_protocol_fault',
  'transient_upstream',
  'unknown',
]);

const USER_ACTION_CATEGORIES = new Set([
  'CLI_NOT_FOUND',
  'CLI_INSTALL_CONFLICT',
  'MISSING_GIT_BASH',
  'NO_CREDENTIALS',
  'AUTH_REJECTED',
  'AUTH_FORBIDDEN',
  'AUTH_STYLE_MISMATCH',
  'OPENAI_AUTH_FAILED',
  'MODEL_NOT_AVAILABLE',
  'ENDPOINT_NOT_FOUND',
  'CONTEXT_TOO_LONG',
  'UNSUPPORTED_FEATURE',
  'CLI_VERSION_TOO_OLD',
  'RESUME_FAILED',
]);

const PRODUCT_FAULT_CATEGORIES = new Set([
  'PROVIDER_NOT_APPLIED',
  'SESSION_STATE_ERROR',
]);

const PROVIDER_PROTOCOL_CATEGORIES = new Set([
  'EMPTY_RESPONSE',
]);

export function normalizeTelemetryChannel(value?: string): TelemetryChannel {
  if (value === 'stable' || value === 'preview' || value === 'local') return value;
  return 'unknown';
}

export function telemetryRelease(version?: string): string {
  return `codepilot@${version?.trim() || 'unknown'}`;
}

/**
 * U0 is deliberately stable-channel only. Preview and local builds must opt in
 * through a future, separately-reviewed contract instead of inheriting a DSN.
 */
export function resolveTelemetryConfig(input: TelemetryConfigInput): TelemetryConfig {
  const channel = normalizeTelemetryChannel(input.channel);
  const enabled = Boolean(
    input.dsn
      && input.nodeEnv === 'production'
      && channel === 'stable'
      && !input.optedOut,
  );
  return {
    enabled,
    dsn: enabled ? input.dsn : undefined,
    channel,
    release: telemetryRelease(input.version),
    environment: channel === 'stable'
      ? 'production'
      : channel === 'preview'
        ? 'preview'
        : 'development',
  };
}

export function classifyTelemetryOutcome(
  category: string,
  error: unknown,
  options: {
    retryExhausted?: boolean;
    providerTest?: boolean;
    statusCode?: number;
  } = {},
): TelemetryOutcomeKind {
  if (options.providerTest) return 'provider_test_result';

  if (
    options.statusCode !== undefined
    && options.statusCode >= 400
    && options.statusCode <= 499
  ) return 'user_action_required';
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|cancel/i.test(message) && !category.startsWith('TIMEOUT_')) {
    return 'user_cancelled';
  }
  if (USER_ACTION_CATEGORIES.has(category)) return 'user_action_required';
  if (PRODUCT_FAULT_CATEGORIES.has(category)) return 'product_fault';
  if (PROVIDER_PROTOCOL_CATEGORIES.has(category)) return 'provider_protocol_fault';
  if (category.startsWith('TIMEOUT_')) return 'transient_upstream';
  if (category === 'NETWORK_UNREACHABLE') {
    return options.retryExhausted ? 'transient_upstream' : 'user_action_required';
  }
  if (category === 'RATE_LIMITED') {
    // Claude Code's RATE_LIMITED category also covers quota/plan exhaustion;
    // unlike the AI SDK shared boundary it cannot prove a retryable 429.
    return 'user_action_required';
  }
  if (category === 'PROCESS_CRASH') return 'expected_lifecycle';
  return 'unknown';
}

export function shouldSendErrorEnvelope(outcome: TelemetryOutcomeKind): boolean {
  return REPORTABLE_OUTCOMES.has(outcome);
}

export interface NormalizedFingerprintInput {
  category: string;
  layer: TelemetryLayer;
  runtimeId?: string;
  providerProtocol?: string;
  providerClass?: string;
  statusCode?: number;
}

function stableToken(value: string | undefined): string {
  if (!value) return 'unknown';
  return /^[a-z0-9_.-]{1,64}$/i.test(value) ? value.toLowerCase() : 'other';
}

export function statusClass(statusCode?: number): string {
  if (!Number.isFinite(statusCode)) return 'none';
  const hundreds = Math.floor(Number(statusCode) / 100);
  return hundreds >= 1 && hundreds <= 5 ? `${hundreds}xx` : 'other';
}

export function buildNormalizedFingerprint(input: NormalizedFingerprintInput): string[] {
  return [
    'normalized-v1',
    stableToken(input.category),
    input.layer,
    stableToken(input.runtimeId),
    stableToken(input.providerProtocol),
    stableToken(input.providerClass),
    statusClass(input.statusCode),
  ];
}

export interface NamedIntegration {
  name?: string;
}

const DISABLED_INTEGRATIONS: Record<TelemetryLayer, ReadonlySet<string>> = {
  renderer: new Set(['BrowserSession']),
  next_server: new Set(['ProcessSession', 'Console', 'LocalVariablesAsync']),
  electron_main: new Set(['Console', 'LocalVariablesAsync', 'Screenshots']),
};

/** Keep only the Electron main-process session so U0 has one denominator. */
export function filterTelemetryIntegrations<T extends NamedIntegration>(
  layer: TelemetryLayer,
  integrations: T[],
): T[] {
  const denied = DISABLED_INTEGRATIONS[layer];
  return integrations.filter((integration) => !integration.name || !denied.has(integration.name));
}

/**
 * Keep exactly one Electron main-process session producer, but send its
 * initial session immediately. Also keep exactly one ChildProcess integration
 * whose automatic events are disabled: its process-exit breadcrumbs remain
 * useful, while utility failures are owned by the normalized generation
 * one-shot boundary instead of being emitted a second time as SDK messages.
 */
export function configureElectronMainIntegrations<T extends NamedIntegration>(
  integrations: T[],
  eagerMainProcessSession: T,
  breadcrumbOnlyChildProcess: T,
): T[] {
  const filtered = filterTelemetryIntegrations('electron_main', integrations);
  let replacedSession = false;
  let replacedChildProcess = false;
  const configured = filtered.map((integration) => {
    if (integration.name === 'MainProcessSession') {
      if (replacedSession) return null;
      replacedSession = true;
      return eagerMainProcessSession;
    }
    if (integration.name === 'ChildProcess') {
      if (replacedChildProcess) return null;
      replacedChildProcess = true;
      return breadcrumbOnlyChildProcess;
    }
    return integration;
  }).filter((integration): integration is T => integration !== null);
  if (!replacedSession) configured.push(eagerMainProcessSession);
  if (!replacedChildProcess) configured.push(breadcrumbOnlyChildProcess);
  return configured;
}

/**
 * Node v10 has two independent Release Health producers: ProcessSession and
 * incoming-request sessions inside the Http integration. Keep Http request
 * isolation/breadcrumbs, but replace the default integration with an
 * explicitly configured instance whose request-session tracking is disabled.
 */
export function configureNextServerIntegrations<T extends NamedIntegration>(
  integrations: T[],
  httpWithoutRequestSessions: T,
): T[] {
  const filtered = filterTelemetryIntegrations('next_server', integrations);
  let replacedHttp = false;
  const configured = filtered.map((integration) => {
    if (integration.name !== 'Http') return integration;
    replacedHttp = true;
    return httpWithoutRequestSessions;
  });
  if (!replacedHttp) configured.push(httpWithoutRequestSessions);
  return configured;
}

/** Stack-bearing unknowns need classification, not a synthetic mega-bucket. */
export function shouldUseDefaultStackGrouping(
  outcome: TelemetryOutcomeKind,
  error: unknown,
): boolean {
  return error instanceof Error && (outcome === 'product_fault' || outcome === 'unknown');
}

export const TELEMETRY_IGNORE_ERRORS: Array<string | RegExp> = [
  'AbortError',
  'Operation aborted',
  'The operation was aborted',
  'signal is aborted',
  'prompt() is not supported',
  'ResizeObserver loop',
  /^Object \[object Object\] has no method/,
];
