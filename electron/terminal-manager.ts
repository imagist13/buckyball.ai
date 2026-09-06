import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

export interface TerminalCreateOptions {
  cwd: string;
  cols: number;
  rows: number;
  env?: Record<string, string>;
}

interface TerminalInstance {
  process: ChildProcessWithoutNullStreams;
  cwd: string;
}

// TerminalManager — manages terminal processes.
//
// KNOWN LIMITATION: Uses child_process.spawn with stdio: 'pipe' instead of
// a real PTY. This means:
//  - resize() is a no-op (COLUMNS/LINES env vars are set at creation only)
//  - Full-screen programs (vim, htop) won't render correctly
//  - readline line-editing may behave differently
//
// TODO: Upgrade to a real PTY library for full support. See
// docs/handover/git-terminal-layout.md for the 4-step upgrade path.
export class TerminalManager {
  private terminals = new Map<string, TerminalInstance>();
  private onData: ((id: string, data: string) => void) | null = null;
  private onExit: ((id: string, code: number) => void) | null = null;

  setOnData(handler: (id: string, data: string) => void) {
    this.onData = handler;
  }

  setOnExit(handler: (id: string, code: number) => void) {
    this.onExit = handler;
  }

  /** Whether a live terminal is currently registered under `id`. */
  has(id: string): boolean {
    return this.terminals.has(id);
  }

  create(id: string, opts: TerminalCreateOptions): void {
    if (this.terminals.has(id)) {
      this.kill(id);
    }

    const shell = this.getShell();
    const shellArgs = this.getShellArgs();

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...opts.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      COLUMNS: String(opts.cols),
      LINES: String(opts.rows),
    };
    // Allow launching Claude Code inside the terminal
    delete env.CLAUDECODE;

    const child = spawn(shell, shellArgs, {
      cwd: opts.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (data: Buffer) => {
      this.onData?.(id, data.toString());
    });

    child.stderr.on('data', (data: Buffer) => {
      this.onData?.(id, data.toString());
    });

    child.on('exit', (code) => {
      this.terminals.delete(id);
      this.onExit?.(id, code ?? 0);
    });

    child.on('error', (err) => {
      console.error(`[terminal:${id}] error:`, err);
      this.terminals.delete(id);
      this.onExit?.(id, 1);
    });

    this.terminals.set(id, { process: child, cwd: opts.cwd });
  }

  write(id: string, data: string): void {
    const terminal = this.terminals.get(id);
    if (!terminal) return;
    terminal.process.stdin.write(data);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  resize(id: string, _cols: number, _rows: number): void {
    // With spawn (non-PTY), resize is a no-op.
    // Would use pty.resize() with a real PTY library.
  }

  kill(id: string): void {
    const terminal = this.terminals.get(id);
    if (!terminal) return;
    try {
      terminal.process.kill();
    } catch {
      // already dead
    }
    this.terminals.delete(id);
  }

  killAll(): void {
    for (const [id] of this.terminals) {
      this.kill(id);
    }
  }

  private getShell(): string {
    if (process.platform === 'win32') {
      return this.findGitBash() || process.env.COMSPEC || 'cmd.exe';
    }
    return process.env.SHELL || '/bin/zsh';
  }

  private getShellArgs(): string[] {
    if (process.platform === 'win32') {
      return [];
    }
    // Interactive login shell
    return ['-il'];
  }

  private findGitBash(): string | null {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');

    // Check env var
    const envBash = process.env.CLAUDE_CODE_GIT_BASH_PATH;
    if (envBash && fs.existsSync(envBash)) return envBash;

    // Common paths
    const commonPaths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    ];
    for (const p of commonPaths) {
      if (fs.existsSync(p)) return p;
    }

    // Try to find via 'where git'
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { execFileSync } = require('child_process');
      const whereResult = execFileSync('where', ['git'], {
        timeout: 3000, encoding: 'utf-8', shell: true, stdio: 'pipe',
      });
      for (const line of whereResult.trim().split(/\r?\n/)) {
        const gitExe = line.trim();
        if (!gitExe) continue;
        const gitDir = path.dirname(path.dirname(gitExe));
        const bashPath = path.join(gitDir, 'bin', 'bash.exe');
        if (fs.existsSync(bashPath)) return bashPath;
      }
    } catch {
      // ignore
    }

    return null;
  }
}
