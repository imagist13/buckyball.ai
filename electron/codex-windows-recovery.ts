import fs from 'node:fs';
import path from 'node:path';

export const CODEX_WINDOWS_INSTALL_COMMAND = 'irm https://chatgpt.com/codex/install.ps1 | iex';
export const CODEX_WINDOWS_NPM_INSTALL_COMMAND = 'npm.cmd install -g @openai/codex';

export type CodexWindowsInstallMethod = 'npm' | 'standalone_script';

export interface CodexWindowsInstallSelection {
  command: string;
  method: CodexWindowsInstallMethod;
}

export interface CodexPowerShellLaunchSpec {
  command: string;
  args: string[];
  windowsHide: true;
  shell: false;
  windowsVerbatimArguments: true;
}

/**
 * Use cmd.exe's built-in `start` to create an independent visible console.
 * The transient cmd window stays hidden, and no installer command is passed.
 */
export function buildCodexPowerShellLaunchSpec(
  platform: NodeJS.Platform = process.platform,
  systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows',
): CodexPowerShellLaunchSpec {
  if (platform !== 'win32') throw new Error('unsupported_platform');
  const powershell = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const commandLine = `start "" "${powershell}" -NoLogo -NoExit`;
  return {
    command: path.win32.join(systemRoot, 'System32', 'cmd.exe'),
    // cmd /s /c strips the outer quote pair. Forward the already-quoted line
    // verbatim so Node does not re-escape the empty START window title.
    args: ['/d', '/s', '/c', `"${commandLine}"`],
    windowsHide: true,
    shell: false,
    windowsVerbatimArguments: true,
  };
}

/** Find a real npm.cmd without invoking a shell or trusting renderer input. */
export function findWindowsNpmCommand(
  env: NodeJS.ProcessEnv = process.env,
  exists: (candidate: string) => boolean = fs.existsSync,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (platform !== 'win32') return null;
  const pathValues = [env.PATH, env.Path, env.path].filter((value): value is string => !!value);
  const directories = pathValues.flatMap(value => value.split(path.win32.delimiter))
    .map(value => value.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  for (const programFiles of [env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)']]) {
    if (programFiles) directories.push(path.win32.join(programFiles, 'nodejs'));
  }

  const seen = new Set<string>();
  for (const directory of directories) {
    const candidate = path.win32.join(directory, 'npm.cmd');
    const key = candidate.toLocaleLowerCase('en-US');
    if (seen.has(key)) continue;
    seen.add(key);
    if (exists(candidate)) return candidate;
  }
  return null;
}

/** Prefer the official npm path when available; it avoids PS 5.1 script bugs. */
export function selectCodexWindowsInstallCommand(npmCommand: string | null): CodexWindowsInstallSelection {
  return npmCommand
    ? { command: CODEX_WINDOWS_NPM_INSTALL_COMMAND, method: 'npm' }
    : { command: CODEX_WINDOWS_INSTALL_COMMAND, method: 'standalone_script' };
}

export function isTrustedCodexRecoverySender(senderUrl: string, expectedPort: number | null): boolean {
  try {
    const parsed = new URL(senderUrl);
    return parsed.protocol === 'http:'
      && parsed.hostname === '127.0.0.1'
      && expectedPort !== null
      && parsed.port === String(expectedPort);
  } catch {
    return false;
  }
}
