import { spawn, type ChildProcess } from 'node:child_process';

const MAX_SOURCE_LENGTH = 2048;
const MAX_SKILL_NAME_LENGTH = 256;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9@][A-Za-z0-9._@+-]*$/;
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface MarketplaceRequestError {
  readonly status: 400 | 403 | 415;
  readonly error: string;
}

export interface SkillsProcessSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly shell: false;
}

function hasSafeSegments(value: string, minimum: number): boolean {
  const normalized = value.replace(/^\/+|\/+$/g, '');
  if (!normalized || normalized.includes('//')) return false;
  const segments = normalized.split('/');
  return segments.length >= minimum
    && segments.every((segment) =>
      segment !== '.' && segment !== '..' && SAFE_PATH_SEGMENT.test(segment));
}

/**
 * Marketplace search results are GitHub repository identifiers. Keep this
 * deliberately narrower than the underlying CLI's generic source grammar:
 * remote marketplace data must never become an option, local path, or shell
 * fragment merely because a future CLI version accepts one.
 */
export function isValidMarketplaceSource(source: unknown): source is string {
  if (
    typeof source !== 'string'
    || source.length === 0
    || source.length > MAX_SOURCE_LENGTH
    || source.trim() !== source
  ) {
    return false;
  }

  if (source.startsWith('https://')) {
    try {
      const url = new URL(source);
      return url.protocol === 'https:'
        && url.hostname.toLowerCase() === 'github.com'
        && !url.username
        && !url.password
        && !url.port
        && !url.search
        && !url.hash
        && hasSafeSegments(url.pathname, 2);
    } catch {
      return false;
    }
  }

  return hasSafeSegments(source, 2) && !source.startsWith('/');
}

export function isValidMarketplaceSkillName(skill: unknown): skill is string {
  return typeof skill === 'string'
    && skill.length > 0
    && skill.length <= MAX_SKILL_NAME_LENGTH
    && skill.trim() === skill
    && !skill.startsWith('/')
    && hasSafeSegments(skill, 1);
}

/**
 * Reject cross-origin and simple-content-type POSTs before parsing JSON. The
 * UI always calls these routes with same-origin fetch + application/json.
 */
export function validateMarketplaceMutationRequest(
  request: Request,
): MarketplaceRequestError | null {
  const contentType = request.headers.get('content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    return { status: 415, error: 'Content-Type must be application/json.' };
  }

  const originHeader = request.headers.get('origin');
  if (!originHeader) {
    return { status: 403, error: 'A same-origin request is required.' };
  }
  try {
    const requestUrl = new URL(request.url);
    // Next dev can canonicalize request.url to localhost even when Electron
    // loaded 127.0.0.1. Host retains the browser's actual destination.
    const requestHost = request.headers.get('host')?.trim();
    const targetUrl = requestHost
      ? new URL(`${requestUrl.protocol}//${requestHost}`)
      : requestUrl;
    if (!LOOPBACK_HOSTNAMES.has(targetUrl.hostname.toLowerCase())) {
      return { status: 403, error: 'Marketplace mutations require a loopback host.' };
    }
    if (new URL(originHeader).origin !== targetUrl.origin) {
      return { status: 403, error: 'Cross-origin requests are not allowed.' };
    }
  } catch {
    return { status: 403, error: 'A valid same-origin request is required.' };
  }

  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') {
    return { status: 403, error: 'Cross-site requests are not allowed.' };
  }
  return null;
}

/**
 * Windows cannot execute npx.cmd without cmd.exe. The outer spawn still has
 * shell disabled and every request-derived argument has already passed the
 * strict marketplace grammar above, so cmd receives only fixed/safe tokens.
 */
export function buildSkillsProcessSpec(
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): SkillsProcessSpec {
  if (platform === 'win32') {
    return {
      command: process.env.ComSpec?.trim() || 'cmd.exe',
      args: ['/d', '/s', '/c', 'npx.cmd', ...args],
      shell: false,
    };
  }
  return { command: 'npx', args: [...args], shell: false };
}

export function spawnSkillsProcess(args: readonly string[]): ChildProcess {
  const spec = buildSkillsProcessSpec(args);
  return spawn(spec.command, spec.args, {
    env: { ...process.env },
    shell: spec.shell,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}
