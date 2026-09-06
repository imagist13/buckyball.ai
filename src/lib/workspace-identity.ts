import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolvePathIdentity, type PathIdentity } from '@/lib/path-identity';

export type CanonicalWorkspaceScope = 'git-repository' | 'directory';

export interface CanonicalWorkspaceIdentity {
  id: string;
  scope: CanonicalWorkspaceScope;
  /** Server-only: callers must not expose this field to renderer storage,
   * telemetry, partition names, or user-visible diagnostics. */
  comparisonKey: string;
  version: 1;
}
export interface WorkspaceIdentityDependencies {
  resolvePath?: (value: string) => PathIdentity;
  probeGitCommonDir?: (absolutePath: string) => string | null;
}

function workspaceGitProbeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  return env;
}

export function buildCanonicalWorkspaceIdentity(
  scope: CanonicalWorkspaceScope,
  comparisonKey: string,
): CanonicalWorkspaceIdentity {
  const id = createHash('sha256')
    .update(`workspace-v1\u0000${scope}\u0000${comparisonKey}`)
    .digest('hex');
  return { id, scope, comparisonKey, version: 1 };
}

function defaultGitCommonDirProbe(absolutePath: string): string | null {
  try {
    const output = execFileSync(
      'git',
      ['-C', absolutePath, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        encoding: 'utf8',
        shell: false,
        timeout: 2_000,
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024,
        env: workspaceGitProbeEnv(),
      },
    );
    const value = output.trim();
    return value || null;
  } catch {
    // Not a repository, git missing, timeout, or permissions failure all fail
    // closed to the verified directory identity. Never surface stderr/path.
    return null;
  }
}

export function resolveCanonicalWorkspaceIdentity(
  workingDirectory: string,
  dependencies: WorkspaceIdentityDependencies = {},
): CanonicalWorkspaceIdentity {
  const resolvePath = dependencies.resolvePath ?? resolvePathIdentity;
  const directory = resolvePath(workingDirectory);
  if (!directory.exists || directory.kind !== 'directory') {
    throw new Error('Workspace must be an existing directory');
  }

  const commonDirValue = (dependencies.probeGitCommonDir ?? defaultGitCommonDirProbe)(
    directory.nativeRealPath ?? directory.absolutePath,
  );
  if (commonDirValue) {
    const commonDir = resolvePath(commonDirValue);
    if (commonDir.exists && commonDir.kind === 'directory') {
      return buildCanonicalWorkspaceIdentity('git-repository', commonDir.comparisonKey);
    }
  }

  return buildCanonicalWorkspaceIdentity('directory', directory.comparisonKey);
}

export function publicWorkspaceIdentity(identity: CanonicalWorkspaceIdentity): Omit<CanonicalWorkspaceIdentity, 'comparisonKey'> {
  return {
    id: identity.id,
    scope: identity.scope,
    version: identity.version,
  };
}
