import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type PathDialect =
  | 'posix'
  | 'windows_drive'
  | 'unc'
  | 'file_url'
  | 'wsl'
  | 'relative';

export type PathIdentityKind =
  | 'file'
  | 'directory'
  | 'other'
  | 'missing'
  | 'inaccessible';

/**
 * One path has three deliberately separate identities:
 *
 * - displayPath: the user's spelling, for UI and diagnostics;
 * - absolutePath/nativeRealPath: the host filesystem spelling;
 * - comparisonKey: lookup/cache only. It must never replace realpath-based
 *   containment at a security boundary (Windows directories can opt into
 *   case-sensitive semantics and reparse points can change object identity).
 */
export interface PathIdentity {
  displayPath: string;
  absolutePath: string;
  nativeRealPath?: string;
  comparisonKey: string;
  dialect: PathDialect;
  exists: boolean;
  kind: PathIdentityKind;
  volume: string;
}

export interface ResolvePathIdentityOptions {
  baseDir?: string;
  platform?: NodeJS.Platform;
  isWsl?: boolean;
}

const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/;
const BACKSLASH_UNC_RE = /^\\\\[^\\/]+[\\/][^\\/]+/;
const FORWARD_UNC_RE = /^\/\/[^\\/]+[\\/][^\\/]+/;
const WSL_UNC_RE = /^(?:\\\\|\/\/)(?:wsl\$|wsl\.localhost)[\\/]/i;
const WSL_MOUNT_RE = /^\/mnt\/[a-z](?:\/|$)/i;

export function detectPathDialect(
  value: string,
  platform: NodeJS.Platform = process.platform,
  isWsl: boolean = platform === 'linux'
    && (!!process.env.WSL_DISTRO_NAME || !!process.env.WSL_INTEROP),
): PathDialect {
  const trimmed = value.trim();
  if (/^file:/i.test(trimmed)) return 'file_url';
  if (WSL_UNC_RE.test(trimmed) && (trimmed.startsWith('\\\\') || platform === 'win32')) {
    return 'wsl';
  }
  if (WSL_MOUNT_RE.test(trimmed) && (platform === 'win32' || isWsl)) return 'wsl';
  if (BACKSLASH_UNC_RE.test(trimmed) || (platform === 'win32' && FORWARD_UNC_RE.test(trimmed))) {
    return 'unc';
  }
  if (WINDOWS_DRIVE_RE.test(trimmed)) return 'windows_drive';
  if (trimmed.startsWith('/')) return 'posix';
  return 'relative';
}

function decodeWindowsFileUrl(value: string): string {
  const parsed = new URL(value);
  const decodedPath = decodeURIComponent(parsed.pathname);
  if (parsed.hostname) {
    return path.win32.normalize(`\\\\${parsed.hostname}${decodedPath.replace(/\//g, '\\')}`);
  }
  const withoutLeadingSlash = /^\/[a-zA-Z]:\//.test(decodedPath)
    ? decodedPath.slice(1)
    : decodedPath;
  return path.win32.normalize(withoutLeadingSlash.replace(/\//g, '\\'));
}

function decodeWslMountOnWindows(value: string): string {
  const match = /^\/mnt\/([a-z])(?:\/(.*))?$/i.exec(value);
  if (!match) return value;
  const drive = `${match[1].toUpperCase()}:\\`;
  return path.win32.normalize(match[2]
    ? path.win32.join(drive, match[2].replace(/\//g, '\\'))
    : drive);
}

function toAbsolutePath(
  displayPath: string,
  dialect: PathDialect,
  platform: NodeJS.Platform,
  baseDir: string,
): string {
  if (dialect === 'file_url') {
    return platform === 'win32'
      ? decodeWindowsFileUrl(displayPath)
      : path.resolve(fileURLToPath(displayPath));
  }


  if (dialect === 'wsl' && platform === 'win32' && WSL_MOUNT_RE.test(displayPath)) {
    return decodeWslMountOnWindows(displayPath);
  }

  if (dialect === 'windows_drive' || dialect === 'unc' || (dialect === 'wsl' && WSL_UNC_RE.test(displayPath))) {
    return path.win32.normalize(displayPath.replace(/\//g, '\\'));
  }


  if (dialect === 'posix' || dialect === 'wsl') {
    return path.posix.resolve(displayPath);
  }

  const implementation = platform === 'win32' ? path.win32 : path.posix;
  return implementation.resolve(baseDir, displayPath);
}

function canProbeOnHost(
  displayPath: string,
  dialect: PathDialect,
  platform: NodeJS.Platform,
): boolean {
  if (dialect === 'wsl') {
    return platform === 'win32'
      ? WSL_UNC_RE.test(displayPath) || WSL_MOUNT_RE.test(displayPath)
      : WSL_MOUNT_RE.test(displayPath);
  }
  const isWindowsSyntax = dialect === 'windows_drive' || dialect === 'unc';
  return platform === 'win32' ? dialect !== 'posix' : !isWindowsSyntax;
}

function comparisonKeyFor(value: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    return path.win32.normalize(value).replace(/\//g, '\\').toLocaleLowerCase('en-US');
  }
  return path.posix.normalize(value);
}

export function resolvePathIdentity(
  input: string,
  options: ResolvePathIdentityOptions = {},
): PathIdentity {
  const displayPath = input.trim();
  if (!displayPath) throw new Error('Path must be a non-empty string');
   
  if (/[\x00-\x1f]/.test(displayPath)) throw new Error('Path contains control characters');

  const platform = options.platform ?? process.platform;
  const dialect = detectPathDialect(displayPath, platform, options.isWsl);
  const baseDir = options.baseDir ?? process.cwd();
  const absolutePath = toAbsolutePath(displayPath, dialect, platform, baseDir);
  const volume = platform === 'win32' || ['windows_drive', 'unc'].includes(dialect)
    ? path.win32.parse(absolutePath).root
    : path.posix.parse(absolutePath).root;

  let nativeRealPath: string | undefined;
  let kind: PathIdentityKind = 'missing';
  if (canProbeOnHost(displayPath, dialect, platform)) {
    try {
      const stat = fs.statSync(absolutePath);
      nativeRealPath = fs.realpathSync.native(absolutePath);
      kind = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      kind = code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'inaccessible';
    }
  }

  return {
    displayPath,
    absolutePath,
    nativeRealPath,
    comparisonKey: comparisonKeyFor(nativeRealPath ?? absolutePath, platform),
    dialect,
    exists: nativeRealPath !== undefined,
    kind,
    volume,
  };
}

export function samePathIdentity(a: PathIdentity, b: PathIdentity): boolean {
  return a.comparisonKey === b.comparisonKey;
}
