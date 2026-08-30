import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import {
  FileIOError,
  assertNoSymlinkInChain,
  assertRealPathInBase,
  assertWritablePath,
  isPathSafe,
  isValidFilename,
} from '@/lib/files';
import type { ErrorResponse } from '@/types';

/*
 * POST /api/files/rename — rename or move a file/directory. Both `from` and
 * `to` run the same path-safety gauntlet; cross-baseDir moves are rejected
 * outright so a user can't drag a workspace file out into ~/Desktop by
 * mistake.
 *
 * Body:
 *   { from, to, baseDir?, overwrite? }
 *
 * Error codes (HTTP status):
 *   path_unsafe/root_path/symlink_detected/blocked_directory/cross_base_dir (403),
 *   invalid_filename (400), not_found (404), already_exists (409).
 */

interface RenameBody {
  from?: unknown;
  to?: unknown;
  baseDir?: unknown;
  overwrite?: unknown;
}

export async function POST(request: NextRequest) {
  let body: RenameBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ErrorResponse>(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const from = typeof body.from === 'string' ? body.from : '';
  const to = typeof body.to === 'string' ? body.to : '';
  const baseDir = typeof body.baseDir === 'string' ? body.baseDir : undefined;
  const overwrite = body.overwrite === true;

  if (!from || !to) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Missing from or to', code: 'invalid_filename' },
      { status: 400 },
    );
  }

  const resolvedFrom = path.resolve(from);
  const resolvedTo = path.resolve(to);
  const toBasename = path.basename(resolvedTo);

  try {
    if (!isValidFilename(toBasename)) {
      throw new FileIOError('invalid_filename', `Invalid target name: ${toBasename}`);
    }
    assertWritablePath(resolvedFrom, baseDir);
    assertWritablePath(resolvedTo, baseDir);
    await assertNoSymlinkInChain(resolvedFrom);
    await assertNoSymlinkInChain(path.dirname(resolvedTo));
    // Real-path check on both endpoints — the from side must not resolve
    // outside baseDir (no cross-root rename via a planted symlink), and
    // the to side must not either (when we're overwriting an existing
    // target). allowMissing=true for `to` because a brand-new target
    // path is the usual case.
    await assertRealPathInBase(resolvedFrom, baseDir, { rejectIfSymlink: true });
    await assertRealPathInBase(resolvedTo, baseDir, { rejectIfSymlink: true, allowMissing: true });

    // If a baseDir is provided, both endpoints must stay inside it. Without
    // this, rename('/workspace/foo', '~/Downloads/foo') would pass each
    // individual `assertWritablePath` (home dir default) but still move the
    // file out of the project.
    if (baseDir) {
      const base = path.resolve(baseDir);
      if (!isPathSafe(base, resolvedFrom) || !isPathSafe(base, resolvedTo)) {
        throw new FileIOError(
          'cross_base_dir',
          'rename endpoints must both lie within baseDir',
        );
      }
    }

    // Source must exist.
    let fromStat;
    try {
      fromStat = await fs.lstat(resolvedFrom);
    } catch {
      throw new FileIOError('not_found', `Source does not exist: ${from}`);
    }
    if (fromStat.isSymbolicLink()) {
      throw new FileIOError('symlink_detected', `Source is a symlink: ${from}`);
    }

    // Target existence + overwrite semantics.
    let toExists = false;
    try {
      await fs.access(resolvedTo);
      toExists = true;
    } catch {
      toExists = false;
    }
    if (toExists && !overwrite) {
      throw new FileIOError('already_exists', `Target already exists: ${to}`);
    }
    if (toExists && overwrite) {
      const toStat = await fs.lstat(resolvedTo);
      // Forbid type conversion — rename a file *to* a directory path only if
      // both endpoints already share a type.
      if (toStat.isDirectory() !== fromStat.isDirectory()) {
        throw new FileIOError(
          'invalid_filename',
          'Cannot rename across file/directory types',
        );
      }
    }

    await fs.rename(resolvedFrom, resolvedTo);

    return NextResponse.json({ from: resolvedFrom, to: resolvedTo });
  } catch (error) {
    if (error instanceof FileIOError) {
      const status = codeToStatus(error.code);
      return NextResponse.json<ErrorResponse>(
        { error: error.message, code: error.code, ...error.meta },
        { status },
      );
    }
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Rename failed' },
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
    case 'cross_base_dir':
      return 403;
    case 'invalid_filename':
      return 400;
    case 'not_found':
      return 404;
    case 'already_exists':
      return 409;
    default:
      return 500;
  }
}
