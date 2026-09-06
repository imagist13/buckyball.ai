const CODEPILOT_CODEX_PROXY_PATH = '/api/codex/proxy/';
const CODEPILOT_PROXY_ERROR_ENVELOPE =
  /["']code["']\s*:\s*["'](?:upstream_[a-z_]+|provider_[a-z_]+|credentials_missing|adapter_not_implemented|invalid_request|unknown_tool|unsupported_tool_kind|internal_error)["']/i;

export const CODEX_LOOPBACK_PROXY_ERROR_CODE = 'CODEX_LOOPBACK_PROXY_INTERCEPTED';

export interface CodexNetworkErrorDiagnosis {
  message: string;
  code?: typeof CODEX_LOOPBACK_PROXY_ERROR_CODE;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === '127.0.0.1'
    || normalized === 'localhost'
    || normalized === '::1';
}

function containsCodePilotLoopbackProxyUrl(message: string): boolean {
  const candidates = message.match(/https?:\/\/[^\s,)"']+/gi) ?? [];
  return candidates.some((candidate) => {
    try {
      const url = new URL(candidate);
      return isLoopbackHostname(url.hostname)
        && url.pathname.includes(CODEPILOT_CODEX_PROXY_PATH);
    } catch {
      return false;
    }
  });
}

/**
 * Replace only the signature produced when a system proxy intercepts the local
 * CodePilot Responses endpoint. A Provider's own 502 must remain untouched.
 */
export function diagnoseCodexNetworkError(message: string): CodexNetworkErrorDiagnosis {
  const isBadGateway = /\b502\b/i.test(message) && /bad gateway|unexpected status/i.test(message);
  if (
    !isBadGateway
    || !containsCodePilotLoopbackProxyUrl(message)
    || CODEPILOT_PROXY_ERROR_ENVELOPE.test(message)
  ) {
    return { message };
  }

  return {
    code: CODEX_LOOPBACK_PROXY_ERROR_CODE,
    message: [
      `${CODEX_LOOPBACK_PROXY_ERROR_CODE}:`,
      'CodePilot could not reach its local Codex proxy directly (HTTP 502).',
      'A system proxy may be intercepting 127.0.0.1/localhost traffic.',
      'Ensure loopback addresses bypass the proxy, restart CodePilot, and retry.',
      `Original Codex error: ${message}`,
    ].join(' '),
  };
}
