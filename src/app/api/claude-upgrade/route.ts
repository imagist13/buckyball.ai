import { NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getUpgradeCommand, getExpandedPath, invalidateWingetCache } from '@/lib/platform';
import { invalidateClaudeClientCache } from '@/lib/claude-client';
import type { ClaudeInstallType } from '@/lib/platform';

const execFileAsync = promisify(execFile);

const VALID_INSTALL_TYPES = new Set<ClaudeInstallType>(['native', 'homebrew', 'npm', 'bun', 'winget', 'unknown']);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const installType = body.installType as ClaudeInstallType;

    if (!installType || !VALID_INSTALL_TYPES.has(installType)) {
      return NextResponse.json({ success: false, error: 'Invalid installType' }, { status: 400 });
    }

    const { command, args, shell } = getUpgradeCommand(installType);

    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 120_000,
      env: { ...process.env, PATH: getExpandedPath() },
      shell,
    });

    // Invalidate all caches so next status check picks up the new version
    invalidateClaudeClientCache();
    invalidateWingetCache();

    return NextResponse.json({
      success: true,
      output: (stdout + '\n' + stderr).trim(),
    });
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    return NextResponse.json({
      success: false,
      output: ((error.stdout || '') + '\n' + (error.stderr || '')).trim(),
      error: error.message || 'Upgrade failed',
    });
  }
}
