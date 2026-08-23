/**
 * Fail fast when the Claude Code subprocess cannot possibly reach its provider
 * because the host OS has no working DNS configuration.
 *
 * The Agent SDK can otherwise remain silent until the UI's ten-minute
 * pre-first-token fuse expires. This probe is intentionally narrow: HTTP(S)
 * hostnames only, no request/body, and skipped when an HTTP proxy may resolve
 * the destination on the user's behalf.
 */

import { lookup as nodeLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

type Lookup = (hostname: string) => Promise<unknown>;

export interface ProviderDnsPreflightOptions {
  baseUrl?: string;
  env: Record<string, string | undefined>;
  lookup?: Lookup;
  timeoutMs?: number;
}

const PROXY_KEYS = [
  'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY',
  'https_proxy', 'http_proxy', 'all_proxy',
] as const;

function proxyConfigured(env: Record<string, string | undefined>): boolean {
  return PROXY_KEYS.some((key) => typeof env[key] === 'string' && env[key]!.trim().length > 0);
}

function noProxyEntryHost(entry: string): string {
  const value = entry.trim().toLowerCase();
  if (value.startsWith('[')) {
    const bracket = value.indexOf(']');
    return bracket >= 0 ? value.slice(1, bracket) : value;
  }
  // Unbracketed IPv6 (including the loopback form we inject for child
  // processes) contains colons that are part of the address, not a port.
  if (isIP(value) === 6) return value;
  return value.replace(/:\d+$/, '');
}

/** Whether the configured proxy explicitly bypasses this hostname. */
export function hostMatchesNoProxy(
  hostname: string,
  env: Record<string, string | undefined>,
): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const entries = [env.NO_PROXY, env.no_proxy]
    .filter((value): value is string => typeof value === 'string')
    .flatMap((value) => value.split(','));
  return entries.some((rawEntry) => {
    const entry = noProxyEntryHost(rawEntry);
    if (!entry) return false;
    if (entry === '*') return true;
    const suffix = entry.startsWith('.') ? entry.slice(1) : entry;
    return host === suffix || host.endsWith(`.${suffix}`);
  });
}

function providerHostname(baseUrl?: string): string | null {
  try {
    const url = new URL(baseUrl || 'https://api.anthropic.com');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.hostname || null;
  } catch {
    // Let the SDK's existing endpoint/config error path describe malformed URLs.
    return null;
  }
}

function isLocalOrNumericHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === 'localhost' || lower.endsWith('.localhost') || isIP(hostname) !== 0;
}

export async function assertProviderDnsResolvable(
  options: ProviderDnsPreflightOptions,
): Promise<'resolved' | 'skipped'> {
  const hostname = providerHostname(options.baseUrl);
  if (!hostname || isLocalOrNumericHost(hostname)) return 'skipped';
  // A configured proxy may own DNS resolution, except when NO_PROXY says this
  // destination goes direct. Skipping the lookup for a bypassed host would
  // recreate the long silent SDK timeout this preflight exists to prevent.
  if (proxyConfigured(options.env) && !hostMatchesNoProxy(hostname, options.env)) return 'skipped';

  const timeoutMs = options.timeoutMs ?? 3_000;
  const lookup = options.lookup ?? (async (host: string) => nodeLookup(host));
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      lookup(hostname),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const timeout = new Error('DNS lookup timed out for the selected provider');
          (timeout as NodeJS.ErrnoException).code = 'EAI_AGAIN';
          reject(timeout);
        }, timeoutMs);
      }),
    ]);
    return 'resolved';
  } catch (cause) {
    const error = new Error(
      'DNS lookup failed for the selected provider. Check the system DNS or VPN connection and retry.',
      { cause },
    );
    // Existing error-classifier maps both codes to NETWORK_UNREACHABLE.
    (error as NodeJS.ErrnoException).code =
      (cause as NodeJS.ErrnoException | undefined)?.code === 'EAI_AGAIN'
        ? 'EAI_AGAIN'
        : 'ENOTFOUND';
    error.name = 'ProviderDnsError';
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
