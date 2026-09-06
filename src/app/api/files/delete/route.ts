import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import trash from 'trash';
import {
  FileIOError,
  assertNoSymlinkInChain,
  assertRealPathInBase,
  assertWritablePath,
} from '@/lib/files';
import type { ErrorResponse } from '@/types';

/*
 * POST /api/files/delete — move a file or directory to the system Trash.
 *
 * Uses the `trash` npm package which invokes the OS-native recycle bin
 * (macOS Trash / Windows Recycle Bin / Linux XDG trash) so users can
 * recover from accidental deletion. We deliberately do NOT fall back to
 * fs.rm if trashing fails — silent fallback to real delete is exactly
 * what the "走回收站" safety story is trying to prevent.
 *
 * Body:
 *   { path, baseDir?, recursive? }
 *
 * Error codes (HTTP status):
 *   path_unsafe/root_path/symlink_detected/blocked_directory (403),
 *   not_found (404), dir_not_empty (409),
 *   trash_unavailable (500 — environment refused to use the recycle bin).
 */

interface DeleteBody {
  path?: unknown;
  baseDir?: unknown;
  recursive?: unknown;
}

export async function POST(request: NextRequest) {
  let body: DeleteBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ErrorResponse>(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const target = typeof body.path === 'string' ? body.path : '';
  const baseDir = typeof body.baseDir === 'string' ? body.baseDir : undefined;
  const recursive = body.recursive === true;

  if (!target) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Missing path' },
      { status: 400 },
    );
  }

  const resolvedPath = path.resolve(target);

  try {
    assertWritablePath(resolvedPath, baseDir);
    await assertNoSymlinkInChain(resolvedPath);
    await assertRealPathInBase(resolvedPath, baseDir, { rejectIfSymlink: true });

    // Must exist; lstat again for entry-count read below.
    const stat = await fs.lstat(resolvedPath);

    // For directories, require explicit recursive=true when non-empty.
    // This mirrors the `rm -r` contract — one click can move a whole
    // project subtree to trash, so we make the UI acknowledge it.
    if (stat.isDirectory()) {
      const entries = await fs.readdir(resolvedPath);
      if (entries.length > 0 && !recursive) {
        throw new FileIOError(
          'dir_not_empty',
          `Directory is not empty (${entries.length} entries); pass recursive=true to confirm`,
          { entry_count: entries.length },
        );
      }
    }

    // Hand off to the system recycle bin. trash() throws if the platform
    // doesn't have a usable trash implementation (e.g. restricted Linux
    // sandbox with no xdg-trash available). We catch and surface as
    // trash_unavailable rather than degrading to fs.rm.
    try {
      await trash(resolvedPath, { glob: false });
    } catch (err) {
      throw new FileIOError(
        'trash_unavailable',
        `System trash unavailable; deletion aborted: ${String(err)}`,
      );
    }

    return NextResponse.json({ path: resolvedPath, trashed: true });
  } catch (error) {
    if (error instanceof FileIOError) {
      const status = codeToStatus(error.code);
      return NextResponse.json<ErrorResponse>(
        { error: error.message, code: error.code, ...error.meta },
        { status },
      );
    }
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Delete failed' },
      { status: 500 },
    );
  }
}

function codeToStatus(code: string): number {
  switch (code) {
    case 'path_unsafe':
    case 'root_path':
    case 'symlink_detected':
    case 'blocked_directory':
      return 403;
    case 'not_found':
      return 404;
    case 'dir_not_empty':
      return 409;
    case 'trash_unavailable':
    default:
      return 500;
  }
}
