export type CodexSandboxState =
  | 'unknown'
  | 'not_applicable'
  | 'setup'
  | 'degraded'
  | 'error';

export type CodexSandboxStage =
  | 'setup_helper'
  | 'command_runner'
  | 'child_spawn'
  | 'filesystem'
  | 'network';

export interface CodexSandboxReadiness {
  state: CodexSandboxState;
  probe: 'not_run' | 'passed' | 'failed';
  stage?: CodexSandboxStage;
  source: 'not_observed' | 'app_server_notification' | 'runtime_error';
  detail?: string;
  observedAt?: string;
}

const STATE_KEY = Symbol.for('codepilot.codex.sandbox-readiness');

function initialReadiness(): CodexSandboxReadiness {
  return { state: 'unknown', probe: 'not_run', source: 'not_observed' };
}

function store(): { current: CodexSandboxReadiness } {
  const root = globalThis as typeof globalThis & {
    [STATE_KEY]?: { current: CodexSandboxReadiness };
  };
  if (!root[STATE_KEY]) root[STATE_KEY] = { current: initialReadiness() };
  return root[STATE_KEY];
}

export function getCodexSandboxReadiness(): CodexSandboxReadiness {
  return { ...store().current };
}

function textFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

export function classifyCodexSandboxFailure(message: string): CodexSandboxStage | null {
  // Generic tool/runtime errors such as "spawn ENOENT" are not proof of a
  // sandbox failure. Require an explicit Windows sandbox breadcrumb before
  // applying the broader stage classifiers below.
  if (!/sandbox|windowssandbox|setup helper|command[-_ ]?runner|restricted token|appcontainer|\buac\b|\bacl\b/i.test(message)) {
    return null;
  }
  if (/setup(?:\.exe)?|setup helper|elevat|uac|acl/i.test(message)) return 'setup_helper';
  if (/command[-_ ]?runner|restricted token|appcontainer/i.test(message)) return 'command_runner';
  if (/spawn|createprocess|executable|enoent/i.test(message)) return 'child_spawn';
  if (/access denied|eperm|eacces|filesystem|reparse|working directory|cwd/i.test(message)) return 'filesystem';
  if (/network|proxy|dns|connect|socket/i.test(message)) return 'network';
  return /sandbox/i.test(message) ? 'command_runner' : null;
}

/** Observe upstream facts only; app-server readiness does not imply sandbox readiness. */
export function observeCodexSandboxNotification(method: string, params: unknown): void {
  if (process.platform !== 'win32') return;

  if (method === 'windowsSandbox/setupCompleted') {
    const payload = params && typeof params === 'object'
      ? params as Record<string, unknown>
      : {};
    const errorDetail = textFromUnknown(payload.error ?? '').trim();
    const status = typeof payload.status === 'string' ? payload.status.toLowerCase() : '';
    const failed = payload.success === false
      || payload.ok === false
      || errorDetail.length > 0
      || status === 'failed'
      || status === 'error';
    const detail = failed
      ? errorDetail || textFromUnknown(payload.message ?? '').trim()
      : '';
    store().current = failed
      ? {
          state: 'error',
          probe: 'failed',
          stage: 'setup_helper',
          source: 'app_server_notification',
          detail: detail || 'Windows sandbox setup reported failure',
          observedAt: new Date().toISOString(),
        }
      : {
          // setupCompleted proves setup only. The command runner and first
          // restricted child remain unverified until upstream exposes facts.
          state: 'setup',
          probe: 'passed',
          stage: 'setup_helper',
          source: 'app_server_notification',
          observedAt: new Date().toISOString(),
        };
    return;
  }

  if (method === 'error' || method === 'warning' || method === 'configWarning') {
    const message = textFromUnknown(params);
    const stage = classifyCodexSandboxFailure(message);
    if (!stage) return;
    store().current = {
      state: method === 'error' ? 'error' : 'degraded',
      probe: method === 'error' ? 'failed' : 'not_run',
      stage,
      source: 'runtime_error',
      detail: message.slice(0, 500),
      observedAt: new Date().toISOString(),
    };
  }
}

export function resetCodexSandboxReadiness(): void {
  store().current = initialReadiness();
}

export const resetCodexSandboxReadinessForTests = resetCodexSandboxReadiness;
