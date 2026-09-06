import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/db';
import {
  assertRealPathInBase,
  FileIOError,
  isPathSafe,
  isRootPath,
} from '@/lib/files';
import type { ErrorResponse, FileInspectResponse } from '@/types';

function fileErrorStatus(error: FileIOError): number {
  if (error.code === 'path_unsafe' || error.code === 'symlink_detected') return 403;
  if (error.code === 'not_found') return 404;
  return 500;
}

/** Lightweight, scoped file-vs-directory probe for chat local references. */
export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get('path');
  if (!filePath) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Missing path parameter', code: 'invalid_request' },
      { status: 400 },
    );
  }

  if (!path.isAbsolute(filePath)) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Path must be absolute', code: 'invalid_request' },
      { status: 400 },
    );
  }

  const sessionId = request.nextUrl.searchParams.get('sessionId');
  const requestedScope = request.nextUrl.searchParams.get('scope');
  if (request.nextUrl.searchParams.has('baseDir')) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Client-provided base directories are not supported', code: 'invalid_request' },
      { status: 400 },
    );
  }
  const hasSession = typeof sessionId === 'string' && sessionId.length > 0 && sessionId.length <= 256;
  const hasHomeScope = requestedScope === 'home';
  if (
    (requestedScope !== null && !hasHomeScope)
    || Boolean(sessionId) !== hasSession
    || hasSession === hasHomeScope
  ) {
    return NextResponse.json<ErrorResponse>(
      { error: 'A session or the fixed home scope is required', code: 'invalid_request' },
      { status: 400 },
    );
  }

  const session = hasSession ? getSession(sessionId!) : undefined;
  if (hasSession && !session?.working_directory) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Session not found or has no working directory', code: 'not_found' },
      { status: 404 },
    );
  }

  const baseDir = session?.working_directory || os.homedir();
  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(filePath);

  if (isRootPath(resolvedBase)) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Cannot use filesystem root as base directory', code: 'root_path' },
      { status: 403 },
    );
  }
  if (!isPathSafe(resolvedBase, resolvedPath)) {
    return NextResponse.json<ErrorResponse>(
      {
        error: hasSession
          ? 'Path is outside the project scope'
          : 'Path is outside the allowed home scope',
        code: 'path_unsafe',
      },
      { status: 403 },
    );
  }

  try {
    const realPath = await assertRealPathInBase(resolvedPath, baseDir);
    if (!realPath) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Path does not exist', code: 'not_found' },
        { status: 404 },
      );
    }
    const stat = await fs.stat(/*turbopackIgnore: true*/ realPath);
    const kind = stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'other';
    return NextResponse.json<FileInspectResponse>({ kind, realPath });
  } catch (error) {
    if (error instanceof FileIOError) {
      const safeMessage = error.code === 'not_found'
        ? 'Path does not exist'
        : error.code === 'path_unsafe' || error.code === 'symlink_detected'
          ? 'Path is outside the allowed scope'
          : 'Failed to inspect path';
      return NextResponse.json<ErrorResponse>(
        { error: safeMessage, code: error.code },
        { status: fileErrorStatus(error) },
      );
    }
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return NextResponse.json<ErrorResponse>(
        { error: 'Path does not exist', code: 'not_found' },
        { status: 404 },
      );
    }
    return NextResponse.json<ErrorResponse>(
      { error: 'Failed to inspect path' },
      { status: 500 },
    );
  }
}
