/**
 * Process-boundary proxy environment helpers.
 *
 * CodePilot keeps a user's proxy for outbound traffic, but every child process
 * must reach CodePilot's own loopback servers directly. This helper is shared
 * by Electron -> packaged Next and Next -> Codex app-server so either launch
 * path remains safe on its own.
 */

export type ProxyProcessEnvironment = Record<string, string | undefined>;

export const LOOPBACK_NO_PROXY_ENTRIES = [
  '127.0.0.1',
  'localhost',
  '::1',
] as const;

const OUTBOUND_PROXY_KEY_FAMILIES = [
  'http_proxy',
  'https_proxy',
  'all_proxy',
] as const;

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function entriesForFamily(
  env: ProxyProcessEnvironment,
  family: string,
): Array<[string, string]> {
  return Object.entries(env).filter(
    (entry): entry is [string, string] =>
      entry[0].toLowerCase() === family && nonEmpty(entry[1]),
  );
}

function preferredFamilyValue(
  env: ProxyProcessEnvironment,
  family: string,
): string | undefined {
  // Match the server-side proxy resolver: an explicitly lowercase value wins,
  // then uppercase, then any unusual casing inherited from Windows.
  const lower = env[family];
  if (nonEmpty(lower)) return lower.trim();
  const upper = env[family.toUpperCase()];
  if (nonEmpty(upper)) return upper.trim();
  return entriesForFamily(env, family)[0]?.[1].trim();
}

/** Whether the environment already contains an explicit outbound proxy. */
export function hasConfiguredProxy(env: ProxyProcessEnvironment): boolean {
  return OUTBOUND_PROXY_KEY_FAMILIES.some(
    family => preferredFamilyValue(env, family) !== undefined,
  );
}

function mergeNoProxyValues(env: ProxyProcessEnvironment): string {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const [, value] of entriesForFamily(env, 'no_proxy')) {
    for (const rawEntry of value.split(',')) {
      const entry = rawEntry.trim();
      const identity = entry.toLowerCase();
      if (!entry || seen.has(identity)) continue;
      seen.add(identity);
      merged.push(entry);
    }
  }

  for (const entry of LOOPBACK_NO_PROXY_ENTRIES) {
    const identity = entry.toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);
    merged.push(entry);
  }

  return merged.join(',');
}

function deleteFamilyKeys(env: ProxyProcessEnvironment, family: string): void {
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === family) delete env[key];
  }
}

/**
 * Preserve all existing NO_PROXY rules and add CodePilot's loopback boundary.
 *
 * Windows environment keys are case-insensitive, while Node child_process
 * sorts duplicate case variants and passes only one of them. Canonicalize all
 * proxy families to one uppercase key there so the selected value is explicit.
 */
export function withLoopbackProxyBypass(
  source: ProxyProcessEnvironment,
  platform: NodeJS.Platform = process.platform,
): ProxyProcessEnvironment {
  const env = { ...source };
  const noProxy = mergeNoProxyValues(source);

  if (platform === 'win32') {
    for (const family of OUTBOUND_PROXY_KEY_FAMILIES) {
      const value = preferredFamilyValue(source, family);
      deleteFamilyKeys(env, family);
      if (value !== undefined) env[family.toUpperCase()] = value;
    }
    deleteFamilyKeys(env, 'no_proxy');
    env.NO_PROXY = noProxy;
    return env;
  }

  // POSIX keys are case-sensitive and different clients prefer different
  // variants. Give both variants the same merged value to prevent drift.
  env.NO_PROXY = noProxy;
  env.no_proxy = noProxy;
  return env;
}

export interface ProxySafeEnvironmentOptions {
  baseEnv: ProxyProcessEnvironment;
  fallbackProxyEnv?: ProxyProcessEnvironment;
  overrides?: ProxyProcessEnvironment;
  platform?: NodeJS.Platform;
}

/**
 * Build a child environment without replacing an explicit user proxy.
 *
 * `fallbackProxyEnv` is Electron's Chromium-resolved system proxy. It is used
 * only when the already-combined process + shell environment has no proxy in
 * either casing.
 */
export function buildProxySafeEnvironment(
  options: ProxySafeEnvironmentOptions,
): ProxyProcessEnvironment {
  const fallback = hasConfiguredProxy(options.baseEnv)
    ? {}
    : (options.fallbackProxyEnv ?? {});
  return withLoopbackProxyBypass(
    {
      ...fallback,
      ...options.baseEnv,
      ...(options.overrides ?? {}),
    },
    options.platform,
  );
}
