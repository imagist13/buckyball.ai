/**
 * #28 — Windows shell 方言。Agent（任一 Runtime）生成/展示命令时不能默认 bash/POSIX，
 * Windows 用户在 PowerShell 里复制执行会失败。getPlatformShell 解析目标 shell，
 * platformCommandGuidance 给系统提示注入方言指引——**off-Windows-PowerShell 为空字符串**，
 * 所以注入是 no-op（mac/linux/Windows-显式-bash-opt-in 零变化），只 Windows 默认 PowerShell 时加指引。
 * （Codex P2：bash 只认显式 CLAUDE_CODE_GIT_BASH_PATH，不靠"装没装 Git Bash"。）
 *
 * 真实 Windows 机器的端到端验收见 preview-build-readiness Phase 2（本地无 Windows 不能代验）。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlatformShell, platformCommandGuidance } from '../../lib/platform';

describe('#28 getPlatformShell', () => {
  it('win32 defaults to powershell (no explicit bash opt-in)', () => {
    assert.equal(getPlatformShell({ platform: 'win32', bashOptIn: false }), 'powershell');
  });
  it('win32 with explicit bash opt-in → bash', () => {
    assert.equal(getPlatformShell({ platform: 'win32', bashOptIn: true }), 'bash');
  });
  it('win32 default keys off CLAUDE_CODE_GIT_BASH_PATH, NOT mere Git install (Codex review P2)', () => {
    const saved = process.env.CLAUDE_CODE_GIT_BASH_PATH;
    try {
      delete process.env.CLAUDE_CODE_GIT_BASH_PATH;
      assert.equal(getPlatformShell({ platform: 'win32' }), 'powershell', 'no env → PowerShell default');
      process.env.CLAUDE_CODE_GIT_BASH_PATH = 'C:\\Program Files\\Git\\bin\\bash.exe';
      assert.equal(getPlatformShell({ platform: 'win32' }), 'bash', 'explicit env opt-in → bash');
    } finally {
      if (saved === undefined) delete process.env.CLAUDE_CODE_GIT_BASH_PATH;
      else process.env.CLAUDE_CODE_GIT_BASH_PATH = saved;
    }
  });
  it('darwin → zsh by default, bash when $SHELL says bash', () => {
    assert.equal(getPlatformShell({ platform: 'darwin', shellEnv: '/bin/zsh' }), 'zsh');
    assert.equal(getPlatformShell({ platform: 'darwin', shellEnv: '/usr/local/bin/bash' }), 'bash');
  });
  it('linux (incl. WSL) → bash', () => {
    assert.equal(getPlatformShell({ platform: 'linux' }), 'bash');
  });
});

describe('#28 platformCommandGuidance', () => {
  it('Windows-PowerShell → PowerShell guidance that forbids bash-only + gives PS equivalents', () => {
    const g = platformCommandGuidance({ platform: 'win32', bashOptIn: false });
    assert.match(g, /PowerShell/);
    assert.match(g, /rm -rf|export VAR|mkdir -p/); // names the bash-only patterns to avoid
    assert.match(g, /Remove-Item|New-Item|\$env:/); // PowerShell equivalents
  });
  it('no-op (empty) on macOS / Linux / Windows-with-explicit-bash-opt-in', () => {
    assert.equal(platformCommandGuidance({ platform: 'darwin' }), '');
    assert.equal(platformCommandGuidance({ platform: 'linux' }), '');
    assert.equal(platformCommandGuidance({ platform: 'win32', bashOptIn: true }), '');
  });
});

describe('#28 shell-dialect hint injected into Native + Codex system prompts (source-pin)', () => {
  const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const read = (f: string) => fs.readFileSync(path.join(SRC, f), 'utf8');
  it('Native (agent-system-prompt) injects platformCommandGuidance()', () => {
    assert.match(read('lib/agent-system-prompt.ts'), /platformCommandGuidance\(\)/);
  });
  it('Codex (unified-adapter) injects platformCommandGuidance()', () => {
    assert.match(read('lib/codex/proxy/unified-adapter.ts'), /platformCommandGuidance\(\)/);
  });
});
