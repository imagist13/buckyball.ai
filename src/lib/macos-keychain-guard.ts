import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const MACOS_KEYCHAIN_STATE_ENV = 'CODEPILOT_MACOS_KEYCHAIN_STATE';
export const MACOS_KEYCHAIN_REASON_ENV = 'CODEPILOT_MACOS_KEYCHAIN_REASON';
export const MACOS_SECURITY_SHIM_DIR_ENV = 'CODEPILOT_MACOS_SECURITY_SHIM_DIR';
export const MACOS_KEYCHAIN_GUARD_ACTIVE_ENV = 'CODEPILOT_MACOS_KEYCHAIN_GUARD_ACTIVE';

export type MacosDefaultKeychainProbe =
  | { status: 'not_applicable'; reason: 'not_macos' }
  | { status: 'available'; reason: 'default_keychain_available' }
  | {
      status: 'unavailable';
      reason:
        | 'security_probe_failed'
        | 'default_keychain_unconfigured'
        | 'default_keychain_output_invalid'
        | 'default_keychain_missing';
    };

interface SecurityProbeResult {
  status: number | null;
  stdout: string;
  errorCode?: string;
}

interface ProbeOptions {
  platform?: NodeJS.Platform;
  runSecurity?: () => SecurityProbeResult;
  pathExists?: (candidate: string) => boolean;
}

interface ApplyGuardOptions {
  platform?: NodeJS.Platform;
  cwd?: string;
  pathExists?: (candidate: string) => boolean;
  probe?: MacosDefaultKeychainProbe;
}

export interface MacosKeychainGuardResult {
  active: boolean;
  status: MacosDefaultKeychainProbe['status'] | 'shim_missing';
  reason: string;
}

let cachedDefaultProbe: MacosDefaultKeychainProbe | undefined;
let warnedMissingShim = false;

function runDefaultKeychainProbe(): SecurityProbeResult {
  const result = spawnSync(
    '/usr/bin/security',
    ['default-keychain', '-d', 'user'],
    {
      encoding: 'utf8',
      timeout: 1_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    errorCode: result.error && 'code' in result.error
      ? String(result.error.code)
      : undefined,
  };
}

/**
 * Inspect only the configured default-keychain path. This never reads a
 * credential item and never asks macOS to unlock, create, or repair a
 * keychain. A missing/broken default is exactly the state that makes Claude
 * Code's eager `security find-generic-password` calls surface a modal dialog.
 */
export function probeMacosDefaultKeychain(options: ProbeOptions = {}): MacosDefaultKeychainProbe {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin') return { status: 'not_applicable', reason: 'not_macos' };

  const result = (options.runSecurity ?? runDefaultKeychainProbe)();
  if (result.errorCode) {
    return { status: 'unavailable', reason: 'security_probe_failed' };
  }
  if (result.status !== 0) {
    return { status: 'unavailable', reason: 'default_keychain_unconfigured' };
  }

  const output = result.stdout.trim();
  const configuredPath = output.startsWith('"') && output.endsWith('"')
    ? output.slice(1, -1)
    : output;
  if (!configuredPath || !path.isAbsolute(configuredPath)) {
    return { status: 'unavailable', reason: 'default_keychain_output_invalid' };
  }
  if (!(options.pathExists ?? fs.existsSync)(configuredPath)) {
    return { status: 'unavailable', reason: 'default_keychain_missing' };
  }
  return { status: 'available', reason: 'default_keychain_available' };
}

export function getMacosDefaultKeychainProbe(): MacosDefaultKeychainProbe {
  cachedDefaultProbe ??= probeMacosDefaultKeychain();
  return cachedDefaultProbe;
}

export function buildMacosKeychainEnvironment(
  probe: MacosDefaultKeychainProbe,
  securityShimDir: string,
): Record<string, string> {
  if (probe.status === 'not_applicable') return {};
  return {
    [MACOS_KEYCHAIN_STATE_ENV]: probe.status,
    [MACOS_KEYCHAIN_REASON_ENV]: probe.reason,
    ...(probe.status === 'unavailable'
      ? { [MACOS_SECURITY_SHIM_DIR_ENV]: securityShimDir }
      : {}),
  };
}

function probeFromEnvironment(env: Record<string, string>): MacosDefaultKeychainProbe | undefined {
  const status = env[MACOS_KEYCHAIN_STATE_ENV];
  const reason = env[MACOS_KEYCHAIN_REASON_ENV];
  if (status === 'available') {
    return { status, reason: 'default_keychain_available' };
  }
  if (status === 'unavailable' && (
    reason === 'security_probe_failed'
    || reason === 'default_keychain_unconfigured'
    || reason === 'default_keychain_output_invalid'
    || reason === 'default_keychain_missing'
  )) {
    return { status, reason };
  }
  return undefined;
}

/**
 * When the macOS default keychain is unavailable, put CodePilot's narrow
 * `security` shim first on the Claude subprocess PATH. The shim fails only
 * Claude Code credential operations; every other invocation is forwarded to
 * `/usr/bin/security` with the original argv.
 */
export function applyMacosKeychainGuard(
  env: Record<string, string>,
  options: ApplyGuardOptions = {},
): MacosKeychainGuardResult {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin') {
    return { active: false, status: 'not_applicable', reason: 'not_macos' };
  }

  const probe = options.probe ?? probeFromEnvironment(env) ?? getMacosDefaultKeychainProbe();
  if (probe.status !== 'unavailable') {
    return { active: false, status: probe.status, reason: probe.reason };
  }

  const candidates = [
    env[MACOS_SECURITY_SHIM_DIR_ENV],
    path.resolve(options.cwd ?? process.cwd(), 'resources', 'macos-keychain-guard'),
  ].filter((candidate): candidate is string => !!candidate && path.isAbsolute(candidate));
  const pathExists = options.pathExists ?? fs.existsSync;
  const shimDir = candidates.find((candidate) => pathExists(path.join(candidate, 'security')));
  if (!shimDir) {
    if (!warnedMissingShim) {
      warnedMissingShim = true;
      console.warn(`[macos-keychain] guard shim missing; reason=${probe.reason}`);
    }
    return { active: false, status: 'shim_missing', reason: probe.reason };
  }

  const currentPath = env.PATH ?? '';
  const pathParts = currentPath.split(path.delimiter).filter(Boolean);
  env.PATH = [shimDir, ...pathParts.filter((part) => part !== shimDir)].join(path.delimiter);
  env[MACOS_KEYCHAIN_GUARD_ACTIVE_ENV] = '1';
  return { active: true, status: probe.status, reason: probe.reason };
}
