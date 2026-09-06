import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import os from 'os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isPathSafe(base: string, target: string): boolean {
  const normalizedBase = base.endsWith(path.sep) ? base : base + path.sep;
  return target === base || target.startsWith(normalizedBase);
}

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.mdx': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xml': 'text/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.ts': 'application/typescript',
  '.tsx': 'application/typescript',
  '.jsx': 'application/javascript',
  '.py': 'text/x-python',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.java': 'text/x-java',
  '.rb': 'text/x-ruby',
  '.sh': 'text/x-shellscript',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/toml',
  '.sql': 'text/x-sql',
  '.swift': 'text/x-swift',
  '.kt': 'text/x-kotlin',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.h': 'text/x-c',
  '.hpp': 'text/x-c++',
  '.cs': 'text/x-csharp',
  '.php': 'text/x-php',
  '.dart': 'text/x-dart',
  '.lua': 'text/x-lua',
  '.zig': 'text/x-zig',
  '.vue': 'text/x-vue',
  '.svelte': 'text/x-svelte',
  '.graphql': 'text/x-graphql',
  '.gql': 'text/x-graphql',
  '.prisma': 'text/x-prisma',
  '.dockerfile': 'text/x-dockerfile',
  '.scss': 'text/x-scss',
  '.less': 'text/x-less',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

/**
 * Serve raw file content.
 * Security: restricts to user's home directory to prevent arbitrary file reads.
 */
export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get('path');

  if (!filePath) {
    return new Response(JSON.stringify({ error: 'path parameter is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const resolved = path.resolve(filePath);
  const homeDir = os.homedir();

  // Only allow reading files within the user's home directory
  if (!isPathSafe(homeDir, resolved)) {
    return new Response(JSON.stringify({ error: 'File is outside the allowed scope' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    await fs.access(resolved);
  } catch {
    return new Response(JSON.stringify({ error: 'File not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const stat = await fs.stat(resolved);
  if (!stat.isFile()) {
    return new Response(JSON.stringify({ error: 'Not a file' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  // Stream large files (>10 MB) to avoid buffering into memory
  const MAX_BUFFERED_SIZE = 10 * 1024 * 1024;

  if (stat.size > MAX_BUFFERED_SIZE) {
    const nodeStream = createReadStream(resolved);
    const webStream = new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk: Buffer | string) => {
          controller.enqueue(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        });
        nodeStream.on('end', () => controller.close());
        nodeStream.on('error', (err) => controller.error(err));
      },
      cancel() {
        nodeStream.destroy();
      },
    });

    return new Response(webStream, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(stat.size),
        'Content-Disposition': `inline; filename="${path.basename(resolved)}"`,
      },
    });
  }

  const buffer = await fs.readFile(resolved);

  return new Response(buffer, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${path.basename(resolved)}"`,
    },
  });
}
