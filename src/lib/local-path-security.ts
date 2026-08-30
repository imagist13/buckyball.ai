import path from 'node:path';

export type ScopedSystemPathRequest = {
  path: string;
  sessionId?: string;
  scope?: 'home';
};

export type ScopedPathInspection = {
  kind: 'file' | 'directory' | 'other';
  realPath: string;
};

export type SystemPathPurpose = 'reveal' | 'open-html';

export type FileManagerRevealCommand = {
  command: string;
  args: string[];
};

const BUNDLE_DIRECTORY_EXTENSIONS = new Set([
  '.app',
  '.appex',
  '.bundle',
  '.framework',
  '.kext',
  '.mdimporter',
  '.plugin',
  '.prefpane',
  '.qlgenerator',
  '.saver',
  '.workflow',
]);

const HTML_FILE_EXTENSIONS = new Set(['.html', '.htm']);

export function isBundleDirectoryPath(candidate: string): boolean {
  return BUNDLE_DIRECTORY_EXTENSIONS.has(path.extname(candidate).toLowerCase());
}

/**
 * Build a fixed executable plus an argv array. Keeping the user-controlled
 * path in a single argv entry prevents shell metacharacters from becoming
 * commands when the Next fallback reveals a file.
 */
export function buildFileManagerRevealCommand(
  platform: NodeJS.Platform,
  realPath: string,
): FileManagerRevealCommand {
  if (!path.isAbsolute(realPath) || realPath.includes('\0')) {
    throw new Error('invalid_path');
  }
  if (platform === 'darwin') {
    return { command: '/usr/bin/open', args: ['-R', realPath] };
  }
  if (platform === 'win32') {
    return { command: 'explorer.exe', args: [`/select,${realPath}`] };
  }
  return { command: 'xdg-open', args: [path.dirname(realPath)] };
}

/**
 * Build the only renderer-controlled filesystem probe Electron main accepts.
 * The renderer supplies a session id or the fixed home scope — never an
 * arbitrary base directory. The Next route derives the actual root.
 */
export function buildScopedPathInspectionUrl(
  senderUrl: string,
  request: ScopedSystemPathRequest,
  purpose: SystemPathPurpose,
): URL {
  const sender = new URL(senderUrl);
  if (sender.protocol !== 'http:' || sender.hostname !== '127.0.0.1') {
    throw new Error('untrusted_renderer');
  }
  if (
    !request
    || typeof request.path !== 'string'
    || request.path.length === 0
    || request.path.length > 32_768
    || request.path.includes('\0')
    || !path.isAbsolute(request.path)
  ) {
    throw new Error('invalid_path');
  }

  const hasSession = typeof request.sessionId === 'string'
    && request.sessionId.length > 0
    && request.sessionId.length <= 256;
  const hasHomeScope = request.scope === 'home';
  const hasUnknownScope = request.scope !== undefined && !hasHomeScope;
  if (hasUnknownScope || hasSession === hasHomeScope) {
    throw new Error('invalid_scope');
  }
  if (purpose === 'open-html' && !hasSession) {
    throw new Error('workspace_required');
  }

  const url = new URL('/api/files/inspect', sender.origin);
  url.searchParams.set('path', request.path);
  if (hasSession) url.searchParams.set('sessionId', request.sessionId!);
  else url.searchParams.set('scope', 'home');
  return url;
}

/** Validate the server result before it reaches an OS API. */
export function validateScopedPathInspection(
  value: unknown,
  purpose: SystemPathPurpose,
): ScopedPathInspection {
  if (!value || typeof value !== 'object') throw new Error('invalid_inspection');
  const candidate = value as Partial<ScopedPathInspection>;
  if (
    (candidate.kind !== 'file'
      && candidate.kind !== 'directory'
      && candidate.kind !== 'other')
    || typeof candidate.realPath !== 'string'
    || !path.isAbsolute(candidate.realPath)
    || candidate.realPath.includes('\0')
  ) {
    throw new Error('invalid_inspection');
  }
  if (candidate.kind === 'directory' && isBundleDirectoryPath(candidate.realPath)) {
    throw new Error('bundle_directory_blocked');
  }
  if (candidate.kind === 'other') {
    throw new Error('unsupported_path_kind');
  }
  if (
    purpose === 'open-html'
    && (candidate.kind !== 'file'
      || !HTML_FILE_EXTENSIONS.has(path.extname(candidate.realPath).toLowerCase()))
  ) {
    throw new Error('html_file_required');
  }
  return candidate as ScopedPathInspection;
}
