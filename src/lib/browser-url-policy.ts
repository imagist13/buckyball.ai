export type BrowserNavigationBlockReason =
  | 'invalid_url'
  | 'unsupported_scheme'
  | 'insecure_remote_http'
  | 'embedded_credentials';

export type BrowserUrlDecision =
  | { allowed: true; url: string }
  | { allowed: false; reason: BrowserNavigationBlockReason };

const MAX_BROWSER_URL_LENGTH = 8_192;

export function isLoopbackBrowserHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1';
}

/**
 * Browser guests may navigate to HTTPS or explicit loopback HTTP only.
 * The one non-network URL is an exact about:blank used for a new tab.
 */
export function classifyBrowserUrl(value: string): BrowserUrlDecision {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_BROWSER_URL_LENGTH) {
    return { allowed: false, reason: 'invalid_url' };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { allowed: false, reason: 'invalid_url' };
  }

  if (parsed.href === 'about:blank') return { allowed: true, url: parsed.href };
  if (parsed.username || parsed.password) {
    return { allowed: false, reason: 'embedded_credentials' };
  }
  if (parsed.protocol === 'https:' && parsed.hostname) {
    return { allowed: true, url: parsed.href };
  }
  if (parsed.protocol === 'http:' && isLoopbackBrowserHostname(parsed.hostname)) {
    return { allowed: true, url: parsed.href };
  }
  if (parsed.protocol === 'http:') {
    return { allowed: false, reason: 'insecure_remote_http' };
  }
  return { allowed: false, reason: 'unsupported_scheme' };
}

/** Turn address-bar input into the same canonical URL Main will validate. */
export function resolveBrowserAddressInput(value: string): BrowserUrlDecision {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_BROWSER_URL_LENGTH || /[\r\n\t]/.test(trimmed)) {
    return { allowed: false, reason: 'invalid_url' };
  }

  if (/^about:blank$/i.test(trimmed)) return classifyBrowserUrl('about:blank');

  let candidate = trimmed;
  const loopbackInput = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(candidate);
  const hasScheme = !loopbackInput && /^[a-z][a-z\d+.-]*:/i.test(candidate);
  if (!hasScheme) {
    candidate = `${loopbackInput ? 'http' : 'https'}://${candidate}`;
  }
  return classifyBrowserUrl(candidate);
}

/** System-browser handoff remains narrower than a generic protocol opener. */
export function isSafeExternalBrowserUrl(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_BROWSER_URL_LENGTH) return false;
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && Boolean(parsed.hostname)
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}
