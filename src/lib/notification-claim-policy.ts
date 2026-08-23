const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export type LocalNotificationConsumer = 'electron-main' | 'renderer';

export function validateNotificationConsumerRequest(
  request: Request,
  channel: unknown,
): { ok: true; consumer: LocalNotificationConsumer } | { ok: false; status: number; error: string } {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return { ok: false, status: 415, error: 'Content-Type must be application/json.' };
  }
  if (channel !== 'electron-native' && channel !== 'renderer-toast') {
    return { ok: false, status: 400, error: 'Unsupported notification channel.' };
  }

  let target: URL;
  try {
    const requestUrl = new URL(request.url);
    const host = request.headers.get('host')?.trim();
    target = host ? new URL(`${requestUrl.protocol}//${host}`) : requestUrl;
  } catch {
    return { ok: false, status: 403, error: 'Invalid request host.' };
  }
  if (!LOOPBACK.has(target.hostname.toLowerCase())) {
    return { ok: false, status: 403, error: 'Notification consumers must use loopback.' };
  }

  const declaredConsumer = request.headers.get('x-codepilot-consumer');
  const origin = request.headers.get('origin');
  if (channel === 'electron-native') {
    if (declaredConsumer !== 'electron-main' || origin) {
      return { ok: false, status: 403, error: 'electron-native is owned by Electron Main.' };
    }
    return { ok: true, consumer: 'electron-main' };
  }

  if (declaredConsumer) {
    return { ok: false, status: 403, error: 'Renderer claims cannot impersonate Electron Main.' };
  }
  if (!origin) return { ok: false, status: 403, error: 'A same-origin renderer request is required.' };
  try {
    if (new URL(origin).origin !== target.origin) {
      return { ok: false, status: 403, error: 'Cross-origin requests are not allowed.' };
    }
  } catch {
    return { ok: false, status: 403, error: 'Invalid request origin.' };
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin') {
    return { ok: false, status: 403, error: 'Cross-site requests are not allowed.' };
  }
  return { ok: true, consumer: 'renderer' };
}
