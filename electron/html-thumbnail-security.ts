import path from 'node:path';

export const HTML_THUMBNAIL_CAPTURE_TIMEOUT_MS = 12_000;

export class HtmlThumbnailCaptureTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`HTML thumbnail capture timed out after ${timeoutMs}ms.`);
    this.name = 'HtmlThumbnailCaptureTimeoutError';
  }
}

export function deriveHtmlThumbnailRequestScope(targetUrl: URL): {
  origin: string;
  pathPrefix: string;
} {
  const routePrefix = '/api/files/html-preview/';
  if (!targetUrl.pathname.startsWith(routePrefix)) {
    throw new Error('HTML thumbnail URL is outside the workspace preview route.');
  }
  const segments = targetUrl.pathname.slice(routePrefix.length).split('/');
  const [scopeToken, ...pathSegments] = segments;
  const tokenMatch = scopeToken.match(/^ws\.([A-Za-z0-9_-]+)$/u);
  if (!tokenMatch || pathSegments.length === 0 || pathSegments.some((segment) => !segment)) {
    throw new Error('HTML thumbnail URL has an invalid workspace scope segment.');
  }
  const encodedBaseDir = tokenMatch[1];
  const decodedBaseDir = Buffer.from(encodedBaseDir, 'base64url').toString('utf8');
  if (
    !path.isAbsolute(decodedBaseDir)
    || decodedBaseDir.includes('\0')
    || Buffer.from(decodedBaseDir, 'utf8').toString('base64url') !== encodedBaseDir
  ) {
    throw new Error('HTML thumbnail workspace scope is not canonical base64url.');
  }
  return {
    origin: targetUrl.origin,
    pathPrefix: `${routePrefix}${scopeToken}/`,
  };
}

export function isHtmlThumbnailRequestAllowed(
  requestUrl: string,
  scope: { origin: string; pathPrefix: string },
): boolean {
  try {
    const candidate = new URL(requestUrl);
    return (
      candidate.origin === scope.origin
      && candidate.pathname.startsWith(scope.pathPrefix)
    );
  } catch {
    return false;
  }
}

export class SerializedDeadlineQueue {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(
    task: () => Promise<T>,
    options: {
      timeoutMs: number;
      onTimeout?: () => void;
    },
  ): Promise<T> {
    const previous = this.tail;
    let release = () => {};
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        task(),
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => {
            try {
              options.onTimeout?.();
            } finally {
              reject(new HtmlThumbnailCaptureTimeoutError(options.timeoutMs));
            }
          }, options.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      release();
    }
  }
}
