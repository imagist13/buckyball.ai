import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import {
  FileIOError,
  assertNoSymlinkInChain,
  assertRealPathInBase,
  assertWritablePath,
  isValidFilename,
} from '@/lib/files';
import type { ErrorResponse } from '@/types';

/*
 * POST /api/files/mkdir — create a directory. Mirrors write's path-safety
 * contract; `recursive` lets callers emulate `mkdir -p`.
 *
 * Body:
 *   { path, baseDir?, createParents? }
 *
 * Error codes (HTTP status):
 *   path_unsafe/root_path/symlink_detected/blocked_directory (403),
 *   invalid_filename (400), already_exists (409), parent_not_exists (404).
 */

interface MkdirBody {
  path?: unknown;
  baseDir?: unknown;
  createParents?: unknown;
}

export async function POST(request: NextRequest) {
  let body: MkdirBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ErrorResponse>(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const dirPath = typeof body.path === 'string' ? body.path : '';
  const baseDir = typeof body.baseDir === 'string' ? body.baseDir : undefined;
  const createParents = body.createParents === true;

  if (!dirPath) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Missing path', code: 'invalid_filename' },
      { status: 400 },
    );
  }

  const resolvedPath = path.resolve(dirPath);
  const basename = path.basename(resolvedPath);

  try {
    if (!isValidFilename(basename)) {
      throw new FileIOError('invalid_filename', `Invalid directory name: ${basename}`);
    }
    assertWritablePath(resolvedPath, baseDir);
    await assertNoSymlinkInChain(path.dirname(resolvedPath));

    // Target must not already exist (mkdir semantics); real-path check
    // guards against a symlink-at-target edge case that could otherwise
    // slip past because `fs.mkdir(recursive:true)` treats existing links
    // as success even if they point outside baseDir.
    const realTarget = await assertRealPathInBase(resolvedPath, baseDir, {
      rejectIfSymlink: true,
      allowMissing: true,
    });
    if (realTarget !== null) {
      throw new FileIOError('already_exists', `Directory already exists: ${dirPath}`);
    }

    await fs.mkdir(resolvedPath, { recursive: createParents });

    return NextResponse.json({ path: resolvedPath });
  } catch (error) {
    if (error instanceof FileIOError) {
      const status = codeToStatus(error.code);
      return NextResponse.json<ErrorResponse>(
        { error: error.message, code: error.code, ...error.meta },
        { status },
      );
    }
    // fs.mkdir throws ENOENT when parent missing and recursive=false.
    const err = error as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Parent directory does not exist', code: 'parent_not_exists' },
        { status: 404 },
      );
    }
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Mkdir failed' },
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
    case 'invalid_filename':
      return 400;
    case 'already_exists':
      return 409;
    case 'parent_not_exists':
      return 404;
    default:
      return 500;
  }
}
