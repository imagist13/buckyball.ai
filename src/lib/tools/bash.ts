/**
 * tools/bash.ts — Execute shell commands.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { spawn } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { ToolContext } from './index';

const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB
const DEFAULT_TIMEOUT_MS = 120_000;   // 2 minutes

export interface ShellLaunch {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** Build an argv-only launch that preserves Unicode and never interpolates CWD. */
export function buildShellLaunch(
  command: string,
  options: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {},
): ShellLaunch {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (platform !== 'win32') {
    return { command: 'bash', args: ['-c', command], env: { ...env, TERM: 'dumb' } };
  }

  const explicitBash = env.CLAUDE_CODE_GIT_BASH_PATH;
  if (explicitBash && fs.existsSync(explicitBash)) {
    return { command: explicitBash, args: ['-c', command], env: { ...env, TERM: 'dumb' } };
  }

  const systemRoot = env.SystemRoot || env.SYSTEMROOT || 'C:\\Windows';
  const bundledPowerShell = path.win32.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const utf8Command = [
    '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    command,
  ].join('; ');

  return {
    // Never fall back to a bare executable name: Windows process lookup can
    // search the repository CWD before system directories, allowing an
    // untrusted workspace to shadow powershell.exe. A missing system binary
    // should fail explicitly at this absolute path.
    command: bundledPowerShell,
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      Buffer.from(utf8Command, 'utf16le').toString('base64'),
    ],
    env: { ...env, TERM: 'dumb' },
  };
}

export function createBashTool(ctx: ToolContext) {
  return tool({
    description:
      'Execute a platform shell command and return its output (stdout + stderr combined). ' +
      'The command runs in the working directory. Use for system operations, ' +
      'running tests, installing packages, git commands, etc. ' +
      'Long-running commands are automatically killed after the timeout.',
    inputSchema: z.object({
      command: z.string().describe('The platform shell command to execute'),
      timeout: z.number().int().positive().optional()
        .describe('Timeout in milliseconds (default 120000)'),
    }),
    execute: async ({ command, timeout }, { abortSignal }) => {
      const timeoutMs = timeout ?? DEFAULT_TIMEOUT_MS;

      return new Promise<string>((resolve) => {
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        let truncated = false;

        const launch = buildShellLaunch(command);
        const proc = spawn(launch.command, launch.args, {
          cwd: ctx.workingDirectory,
          env: launch.env,
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: timeoutMs,
        });

        const collect = (data: Buffer) => {
          if (truncated) return;
          totalBytes += data.length;
          if (totalBytes > MAX_OUTPUT_BYTES) {
            truncated = true;
            chunks.push(data.subarray(0, MAX_OUTPUT_BYTES - (totalBytes - data.length)));
          } else {
            chunks.push(data);
          }
        };

        proc.stdout?.on('data', collect);
        proc.stderr?.on('data', collect);

        // Handle abort
        const onAbort = () => {
          proc.kill('SIGTERM');
          setTimeout(() => proc.kill('SIGKILL'), 3000);
        };
        abortSignal?.addEventListener('abort', onAbort, { once: true });

        proc.on('close', (code, signal) => {
          abortSignal?.removeEventListener('abort', onAbort);

          let output = Buffer.concat(chunks).toString('utf-8');
          if (truncated) {
            output += '\n\n[Output truncated — exceeded 1MB limit]';
          }

          if (signal === 'SIGTERM' || signal === 'SIGKILL') {
            output += `\n\n[Process killed: ${signal}]`;
          }

          if (code !== null && code !== 0) {
            output += `\n\n[Exit code: ${code}]`;
          }

          resolve(output || '(no output)');
        });

        proc.on('error', (err) => {
          resolve(`Error executing command: ${err.message}`);
        });
      });
    },
  });
}
