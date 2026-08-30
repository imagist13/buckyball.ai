import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PROVIDER_SECRET_ISOLATED_SMOKE_ENV = 'CODEPILOT_PROVIDER_SECRET_ISOLATED_SMOKE';

interface ProviderSecretStartupPolicyInput {
  flag: string | undefined;
  isPackaged: boolean;
  userDataDir: string;
  tempDir?: string;
}

/**
 * The packaged recovery smoke uses an isolated, disposable user-data root and
 * must not touch the developer's real macOS Safe Storage item. The flag alone
 * is insufficient: only a packaged app whose userData parent is the dedicated
 * temporary smoke directory may bypass provider-secret initialization.
 */
export function shouldSkipProviderSecretForIsolatedSmoke({
  flag,
  isPackaged,
  userDataDir,
  tempDir = os.tmpdir(),
}: ProviderSecretStartupPolicyInput): boolean {
  if (flag !== '1' || !isPackaged) return false;
  let resolvedTemp: string;
  let resolvedUserData: string;
  try {
    resolvedTemp = fs.realpathSync.native(tempDir);
    resolvedUserData = fs.realpathSync.native(userDataDir);
  } catch {
    return false;
  }
  const smokeRoot = path.dirname(resolvedUserData);
  const relative = path.relative(resolvedTemp, smokeRoot);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return false;
  }
  return path.basename(smokeRoot).startsWith('codepilot-packaged-recovery-');
}
