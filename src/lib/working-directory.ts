import fs from 'fs';
import os from 'os';
import { resolvePathIdentity, type PathIdentity } from './path-identity';

export type WorkingDirectorySource =
  | 'requested'
  | 'binding'
  | 'session_sdk_cwd'
  | 'session_working_directory'
  | 'setting'
  | 'home'
  | 'process';

export interface WorkingDirectoryCandidate {
  path?: string | null;
  source: Exclude<WorkingDirectorySource, 'home' | 'process'>;
}

export interface ResolvedWorkingDirectory {
  path: string;
  source: WorkingDirectorySource;
  identity: PathIdentity;
  invalidCandidates: Array<{
    source: WorkingDirectoryCandidate['source'];
    path: string;
    identity?: PathIdentity;
  }>;
}

export function isExistingDirectory(pathValue?: string | null): pathValue is string {
  if (typeof pathValue !== 'string') return false;
  const trimmed = pathValue.trim();
  if (!trimmed) return false;

  try {
    return fs.statSync(trimmed).isDirectory();
  } catch {
    return false;
  }
}

export function resolveWorkingDirectory(
  candidates: WorkingDirectoryCandidate[],
): ResolvedWorkingDirectory {
  const invalidCandidates: ResolvedWorkingDirectory['invalidCandidates'] = [];

  for (const candidate of candidates) {
    const value = typeof candidate.path === 'string' ? candidate.path.trim() : '';
    if (!value) continue;

    let identity: PathIdentity | undefined;
    try {
      identity = resolvePathIdentity(value);
    } catch {
      // The invalid candidate is still surfaced below with its original
      // display spelling; callers can explain the fallback without guessing.
    }

    if (identity?.kind === 'directory') {
      return {
        path: identity.absolutePath,
        source: candidate.source,
        identity,
        invalidCandidates,
      };
    }

    invalidCandidates.push({ source: candidate.source, path: value, identity });
  }

  const homeDir = os.homedir();
  const homeIdentity = resolvePathIdentity(homeDir);
  if (homeIdentity.kind === 'directory') {
    return {
      path: homeIdentity.absolutePath,
      source: 'home',
      identity: homeIdentity,
      invalidCandidates,
    };
  }

  const processIdentity = resolvePathIdentity(process.cwd());
  return {
    path: processIdentity.absolutePath,
    source: 'process',
    identity: processIdentity,
    invalidCandidates,
  };
}
