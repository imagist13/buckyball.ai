/**
 * #90 — Windows 上 CodePilot 检测不到 Claude Code CLI 的收口证据。
 *
 * 根因：GUI subsystem 的 .exe（例如 Claude Code native installer / WinGet
 * 装出来的 claude.exe）通过 AttachConsole(ATTACH_PARENT_PROCESS) +
 * WriteFile(STD_OUTPUT_HANDLE) 写 stdout。Node 用 shell:false + stdio:'pipe'
 * 启动时子进程没有 parent console，attach 返回 INVALID_HANDLE_VALUE，stdout
 * 静默丢失，exit code 仍为 0。修法：所有 Windows 后缀（.cmd/.bat/.exe）都
 * 走 shell: true，让 cmd /d /s /c 给子进程一个真实 console 供其 attach。
 *
 * 这个单测用 `opts.platform` 注入避免依赖 process.platform，让 CI 在
 * 任意主机上都能跑。真机 Windows 端到端验证需要用户在 Settings → Runtime
 * 看到「已检测到 Claude Code x.y.z」。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { needsExecShell } from '../../lib/platform';

describe('#90 needsExecShell (Windows GUI subsystem CLI detection)', () => {
  it('win32 .cmd → true (.cmd 必须 cmd /d /s /c 解释)', () => {
    assert.equal(
      needsExecShell('C:\\Users\\zhao\\AppData\\Roaming\\npm\\claude.cmd', {
        platform: 'win32',
      }),
      true,
    );
  });

  it('win32 .bat → true', () => {
    assert.equal(
      needsExecShell('C:\\tools\\claude.bat', { platform: 'win32' }),
      true,
    );
  });

  it('win32 .exe → true (GUI subsystem 需要 console 供 AttachConsole)', () => {
    // 用户实例：native installer / WinGet 装到 ~/.local/bin/claude.exe
    assert.equal(
      needsExecShell('C:\\Users\\赵雷\\.local\\bin\\claude.exe', {
        platform: 'win32',
      }),
      true,
    );
  });

  it('win32 extensionless → false (理论上 claude 没扩展名就走 CreateProcess)', () => {
    assert.equal(
      needsExecShell('C:\\Users\\zhao\\.local\\bin\\claude', {
        platform: 'win32',
      }),
      false,
    );
  });

  it('大小写不敏感（.EXE / .Cmd）', () => {
    assert.equal(
      needsExecShell('C:\\Program Files\\Claude\\CLAUDE.EXE', {
        platform: 'win32',
      }),
      true,
    );
    assert.equal(
      needsExecShell('C:\\Tools\\claude.CMD', { platform: 'win32' }),
      true,
    );
  });

  it('darwin .exe → false（macOS / Linux 不需要 shell）', () => {
    assert.equal(
      needsExecShell('/Users/zhao/.local/bin/claude', { platform: 'darwin' }),
      false,
    );
    assert.equal(
      needsExecShell('/opt/homebrew/bin/claude', { platform: 'darwin' }),
      false,
    );
  });

  it('linux .exe → false（WSL / 原生 linux 都不走 shell）', () => {
    assert.equal(
      needsExecShell('/usr/local/bin/claude', { platform: 'linux' }),
      false,
    );
    assert.equal(
      needsExecShell('/home/zhao/.local/bin/claude', { platform: 'linux' }),
      false,
    );
  });

  it('不传 opts 时回落 process.platform（在 win32 主机上 .exe → true）', () => {
    if (process.platform !== 'win32') {
      // 非 Windows 主机下，验证 fallback 行为只是不抛错且与注入结果一致
      assert.equal(needsExecShell('C:\\Tools\\claude.exe'), false);
      return;
    }
    assert.equal(needsExecShell('C:\\Tools\\claude.exe'), true);
  });
});
