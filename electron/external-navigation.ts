export type ExternalOpenOutcome = 'opened' | 'failed';

export interface ExternalOpenFailureCopy {
  title: string;
  message: string;
  detail: string;
}

export function externalOpenFailureCopy(locale: string): ExternalOpenFailureCopy {
  if (locale.toLowerCase().startsWith('zh')) {
    return {
      title: '无法打开链接',
      message: '系统没有成功打开这个网页链接。',
      detail: '请检查默认浏览器设置，然后重试。',
    };
  }
  return {
    title: 'Unable to open link',
    message: 'The system could not open this web link.',
    detail: 'Check your default browser settings, then try again.',
  };
}

/**
 * Own the Promise returned by Electron's shell.openExternal. The failure
 * callback deliberately receives no URL or raw OS error so callers cannot
 * accidentally log query strings, local identity, or dynamic system text.
 */
export async function openExternalSafely(
  targetUrl: string,
  openExternal: (url: string) => Promise<unknown>,
  onFailure: () => void | Promise<void>,
): Promise<ExternalOpenOutcome> {
  try {
    await openExternal(targetUrl);
    return 'opened';
  } catch {
    try {
      await onFailure();
    } catch {
      // Feedback is best-effort. Its own failure must not recreate the
      // unhandled rejection this boundary exists to eliminate.
    }
    return 'failed';
  }
}
