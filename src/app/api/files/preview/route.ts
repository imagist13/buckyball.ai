import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import os from 'os';
import { readFilePreview, isPathSafe, isRootPath, FilePreviewError, assertRealPathInBase, FileIOError } from '@/lib/files';
import type { FilePreviewResponse, ErrorResponse } from '@/types';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const filePath = searchParams.get('path');

  // maxLines is a hint / cap, not a default. When absent, readFilePreview
  // picks a per-extension cap (50k for Markdown/text, 1k for code).
  const maxLinesParam = searchParams.get('maxLines');
  const userMaxLines = maxLinesParam ? parseInt(maxLinesParam, 10) : undefined;

  if (!filePath) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Missing path parameter' },
      { status: 400 }
    );
  }

  const resolvedPath = path.resolve(filePath);
  const homeDir = os.homedir();

  // Validate that the file is within the session's working directory.
  // baseDir may be on a different drive than homeDir on Windows.
  // Only reject root paths as baseDir to prevent full-disk access.
  const baseDir = searchParams.get('baseDir');
  const resolvedBase = baseDir ? path.resolve(baseDir) : homeDir;
  if (baseDir && isRootPath(resolvedBase)) {
    return NextResponse.json<ErrorResponse>(
      { error: 'Cannot use filesystem root as base directory' },
      { status: 403 }
    );
  }
  if (!isPathSafe(resolvedBase, resolvedPath)) {
    return NextResponse.json<ErrorResponse>(
      { error: baseDir ? 'File is outside the project scope' : 'File is outside the allowed scope' },
      { status: 403 }
    );
  }

  // Real-path scope check — delegated to the single shared helper so read
  // / write / mkdir / rename / delete all enforce identical symlink
  // semantics. allowMissing=true because nonexistent files are a valid
  // case here (readFilePreview's own FilePreviewError('not_found') will
  // produce the 404).
  try {
    await assertRealPathInBase(resolvedPath, baseDir ?? undefined, { allowMissing: true });
  } catch (err) {
    if (err instanceof FileIOError) {
      const status = err.code === 'path_unsafe' ? 403 : 500;
      return NextResponse.json<ErrorResponse>(
        {
          error: err.message,
          code: err.code === 'path_unsafe' ? 'symlink_escape' : err.code,
          ...err.meta,
        },
        { status }
      );
    }
    return NextResponse.json<ErrorResponse>(
      { error: err instanceof Error ? err.message : 'Path validation failed' },
      { status: 500 }
    );
  }

  try {
    const preview = await readFilePreview(resolvedPath, userMaxLines);
    return NextResponse.json<FilePreviewResponse>({ preview });
  } catch (error) {
    if (error instanceof FilePreviewError) {
      // Map structured preview errors to appropriate HTTP codes + error codes
      // so UI can branch on kind (file too large vs binary vs missing).
      const status =
        error.code === 'not_found' ? 404 :
        error.code === 'file_too_large' ? 413 :
        error.code === 'binary_not_previewable' ? 415 :
        error.code === 'not_a_file' ? 400 :
        500;
      return NextResponse.json<ErrorResponse>(
        { error: error.message, code: error.code, ...error.meta },
        { status }
      );
    }
    return NextResponse.json<ErrorResponse>(
      { error: error instanceof Error ? error.message : 'Failed to read file' },
      { status: 500 }
    );
  }
}
