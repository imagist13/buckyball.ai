import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getSession } from '@/lib/db';
import { assertRealPathInBase, FileIOError, isPathSafe } from '@/lib/files';
import {
  buildFileManagerRevealCommand,
  isBundleDirectoryPath,
} from '@/lib/local-path-security';

function revealInFileManager(realPath: string): Promise<void> {
  const { command, args } = buildFileManagerRevealCommand(process.platform, realPath);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      shell: false,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    path?: unknown;
    sessionId?: unknown;
  };
  if (
    typeof body.path !== 'string'
    || !path.isAbsolute(body.path)
    || typeof body.sessionId !== 'string'
    || body.sessionId.length === 0
  ) {
    return NextResponse.json({ error: 'Absolute path and sessionId are required' }, { status: 400 });
  }

  const session = getSession(body.sessionId);
  if (!session?.working_directory) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  const baseDir = path.resolve(session.working_directory);
  const requestedPath = path.resolve(body.path);
  if (!isPathSafe(baseDir, requestedPath)) {
    return NextResponse.json({ error: 'Path is outside the project scope' }, { status: 403 });
  }

  try {
    const realPath = await assertRealPathInBase(requestedPath, baseDir);
    if (!realPath) {
      return NextResponse.json({ error: 'Path does not exist' }, { status: 404 });
    }
    const stat = await fs.stat(realPath);
    if ((!stat.isFile() && !stat.isDirectory()) || (stat.isDirectory() && isBundleDirectoryPath(realPath))) {
      return NextResponse.json({ error: 'Path type is not supported' }, { status: 400 });
    }
    await revealInFileManager(realPath);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof FileIOError) {
      const status = error.code === 'not_found'
        ? 404
        : error.code === 'path_unsafe' || error.code === 'symlink_detected'
          ? 403
          : 500;
      return NextResponse.json(
        {
          error: status === 404
            ? 'Path does not exist'
            : status === 403
              ? 'Path is outside the project scope'
              : 'Could not reveal this path',
        },
        { status },
      );
    }
    return NextResponse.json({ error: 'Could not reveal this path' }, { status: 500 });
  }
}
