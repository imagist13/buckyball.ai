import path from 'node:path';
import type { CliInstallChannel, CliProvider } from './cli-maintenance-contract';

export interface CliPathClassification {
  channel: CliInstallChannel;
  confidence: 'proven' | 'ambiguous' | 'unknown';
}

/** Path evidence is only the first stage; package-manager channels remain
 * ambiguous until their root/cask/package ownership is proven separately. */
export function classifyCliInstallPath(input: {
  provider: CliProvider;
  binaryPath: string;
  realPath: string;
  platform: NodeJS.Platform;
  homeDir: string;
}): CliPathClassification {
  const normalized = input.binaryPath.replace(/\\/g, '/').toLowerCase();
  const real = input.realPath.replace(/\\/g, '/').toLowerCase();
  const home = input.homeDir.replace(/\\/g, '/').toLowerCase();
  const combined = `${normalized}\n${real}`;

  if (combined.includes('/caskroom/') || combined.includes('/cellar/') || combined.includes('/homebrew/')) {
    return { channel: 'homebrew', confidence: 'ambiguous' };
  }
  if (combined.includes('/.bun/') || combined.includes('/bun/install/')) {
    return { channel: 'bun', confidence: 'ambiguous' };
  }
  if (combined.includes('/pnpm/') || combined.includes('/pnpm-global/')) {
    return { channel: 'pnpm', confidence: 'ambiguous' };
  }
  if (combined.includes('/node_modules/') || combined.includes('/npm-global/') || combined.includes('/appdata/roaming/npm/')) {
    return { channel: 'npm', confidence: 'ambiguous' };
  }

  if (input.provider === 'claude') {
    const nativeRoots = [`${home}/.local/bin/`, `${home}/.claude/bin/`];
    if (nativeRoots.some((root) => normalized.startsWith(root))) {
      // Claude native and WinGet intentionally overlap under ~/.local/bin on
      // Windows. A path alone cannot choose the installer owner.
      return input.platform === 'win32'
        ? { channel: 'unknown', confidence: 'ambiguous' }
        : { channel: 'native', confidence: 'proven' };
    }
  }

  if (input.provider === 'codex') {
    const extension = path.extname(input.binaryPath).toLowerCase();
    const executableShape = input.platform === 'win32'
      ? extension === '.exe'
      : extension === '';
    if (executableShape) return { channel: 'standalone', confidence: 'proven' };
  }

  return { channel: 'unknown', confidence: 'unknown' };
}

export function pathIsInside(candidate: string, parent: string, platform: NodeJS.Platform): boolean {
  const pathApi = platform === 'win32' ? path.win32 : path;
  const relative = pathApi.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !pathApi.isAbsolute(relative));
}
