export type LocalPathKind = 'file' | 'directory' | 'other';

export type LocalPathScope =
  | { sessionId: string; scope?: never }
  | { sessionId?: never; scope: 'home' };

export type LocalPathInspection = {
  kind: LocalPathKind;
  realPath: string;
};

export class LocalPathInspectionError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'LocalPathInspectionError';
  }
}

export async function inspectLocalPath(
  filePath: string,
  scope: LocalPathScope,
  fetcher: typeof fetch = fetch,
): Promise<LocalPathInspection> {
  const params = new URLSearchParams({ path: filePath });
  if (scope.sessionId) params.set('sessionId', scope.sessionId);
  else params.set('scope', 'home');
  const response = await fetcher(`/api/files/inspect?${params}`);
  const body = await response.json().catch(() => ({})) as {
    kind?: LocalPathKind;
    realPath?: string;
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    throw new LocalPathInspectionError(
      body.error || `Path inspection failed (${response.status})`,
      body.code,
      response.status,
    );
  }
  if (
    (body.kind !== 'file' && body.kind !== 'directory' && body.kind !== 'other')
    || typeof body.realPath !== 'string'
    || body.realPath.length === 0
  ) {
    throw new LocalPathInspectionError('Path inspection returned an invalid result');
  }
  return { kind: body.kind, realPath: body.realPath };
}

export type SystemPathRequest = LocalPathScope & { path: string };

type ShellPathNavigator = {
  revealPath: (request: SystemPathRequest) => Promise<string>;
  openHtmlFile: (request: { path: string; sessionId: string }) => Promise<string>;
};

/**
 * Reveal a validated local path in Finder / Explorer without launching it.
 */
export async function revealPathWithSystem(
  request: SystemPathRequest,
  navigator?: Pick<ShellPathNavigator, 'revealPath'>,
): Promise<void> {
  const resolvedNavigator = navigator ?? (
    typeof window !== 'undefined' ? window.electronAPI?.shell : undefined
  );
  if (!resolvedNavigator?.revealPath) {
    throw new Error('System file manager is unavailable outside the desktop app');
  }
  const error = await resolvedNavigator.revealPath(request);
  if (error) throw new Error(error);
}

/** Open only a server-validated workspace HTML file with its system app. */
export async function openHtmlFileWithSystem(
  request: { path: string; sessionId: string },
  navigator?: Pick<ShellPathNavigator, 'openHtmlFile'>,
): Promise<void> {
  const resolvedNavigator = navigator ?? (
    typeof window !== 'undefined' ? window.electronAPI?.shell : undefined
  );
  if (!resolvedNavigator?.openHtmlFile) {
    throw new Error('System browser is unavailable outside the desktop app');
  }
  const error = await resolvedNavigator.openHtmlFile(request);
  if (error) throw new Error(error);
}
