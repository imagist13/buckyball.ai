/**
 * Phase 4 Phase 1.5 — HTML preview URL builder + parser.
 *
 * The route + the helper are paired: any encoding change here must be
 * reversible on the route side, and any change to the route's segment
 * shape must update the helper. These tests pin the wire shape so a
 * future "let's flatten the URL" refactor can't silently break
 * relative-resource resolution.
 *
 * Run: npx tsx --test src/__tests__/unit/html-preview-url.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildHtmlPreviewUrl,
  parseHtmlPreviewSegments,
  shouldReloadHtmlForPath,
  htmlPreviewDirname,
  HTML_DEP_EXTENSIONS,
} from '../../lib/html-preview-url';

describe('buildHtmlPreviewUrl — workspace scope', () => {
  it('emits /api/files/html-preview/<ws.base64>/<abs-path>', () => {
    const url = buildHtmlPreviewUrl('/Users/me/proj/index.html', {
      kind: 'workspace',
      baseDir: '/Users/me/proj',
    });
    // Hard-coded base64url shape — pinned so the route's decoder stays in sync
    assert.ok(url.startsWith('/api/files/html-preview/ws.'), url);
    assert.ok(url.endsWith('/Users/me/proj/index.html'), url);
  });

  it('relative resource resolution lands on the same scope token', () => {
    // Simulates what the browser does when the iframe page references
    // `./style.css`: the path before the filename stays intact, the
    // filename gets swapped. This is the whole reason we encode scope
    // into the URL path.
    const docUrl = buildHtmlPreviewUrl('/Users/me/proj/index.html', {
      kind: 'workspace',
      baseDir: '/Users/me/proj',
    });
    // Drop the basename + replace with style.css (same way the browser
    // resolves './style.css' against the document URL)
    const dir = docUrl.replace(/\/[^/]+$/, '');
    const resourceUrl = `${dir}/style.css`;

    const parsed = parseHtmlPreviewSegments(
      // Mirror what Next.js [...segments] hands the route after URL-decode
      resourceUrl
        .replace('/api/files/html-preview/', '')
        .split('/')
        .map(decodeURIComponent),
    );
    assert.equal(parsed.scope.kind, 'workspace');
    if (parsed.scope.kind !== 'workspace') return;
    assert.equal(parsed.scope.baseDir, '/Users/me/proj');
    assert.equal(parsed.absolutePath, '/Users/me/proj/style.css');
  });

  it('round-trip preserves Unicode + spaces in path segments', () => {
    const orig = '/Users/me/项目/My Notes/页面.html';
    const url = buildHtmlPreviewUrl(orig, {
      kind: 'workspace',
      baseDir: '/Users/me/项目',
    });
    const segments = url
      .replace('/api/files/html-preview/', '')
      .split('/')
      .map(decodeURIComponent);
    const parsed = parseHtmlPreviewSegments(segments);
    assert.equal(parsed.absolutePath, orig);
    if (parsed.scope.kind !== 'workspace') {
      assert.fail('expected workspace scope');
    } else {
      assert.equal(parsed.scope.baseDir, '/Users/me/项目');
    }
  });

  it('round-trips Windows drive paths without breaking relative resources', () => {
    const orig = 'C:\\Users\\me\\中文 游戏\\页面.html';
    const url = buildHtmlPreviewUrl(orig, {
      kind: 'workspace',
      baseDir: 'C:\\Users\\me\\中文 游戏',
    });
    assert.match(url, /__codepilot_win__\./);

    const resourceUrl = url.replace(/\/[^/]+$/, '/style.css');
    const parsed = parseHtmlPreviewSegments(
      resourceUrl
        .replace('/api/files/html-preview/', '')
        .split('/')
        .map(decodeURIComponent),
    );
    assert.equal(parsed.absolutePath, 'C:\\Users\\me\\中文 游戏\\style.css');
    assert.deepEqual(parsed.scope, {
      kind: 'workspace',
      baseDir: 'C:\\Users\\me\\中文 游戏',
    });
  });

  it('rejects Windows UNC and device paths before they can trigger network I/O', () => {
    const orig = '\\\\fileserver\\共享\\游戏\\index.html';
    assert.throws(
      () => buildHtmlPreviewUrl(orig, {
        kind: 'workspace',
        baseDir: '\\\\fileserver\\共享\\游戏',
      }),
      /network or device/,
    );
    assert.throws(
      () => buildHtmlPreviewUrl('\\\\?\\C:\\project\\index.html', { kind: 'home' }),
      /network or device/,
    );

    const uncBase = Buffer.from('\\\\attacker\\share\\project', 'utf8').toString('base64url');
    assert.throws(
      () => parseHtmlPreviewSegments([`ws.${uncBase}`, 'x.html']),
      /must not be a Windows network or device path/,
    );

    const localBase = Buffer.from('C:\\project', 'utf8').toString('base64url');
    const uncRoot = Buffer.from('\\\\attacker\\share\\', 'utf8').toString('base64url');
    assert.throws(
      () => parseHtmlPreviewSegments([`ws.${localBase}`, `__codepilot_win__.${uncRoot}`, 'x.html']),
      /valid local drive root/,
    );
  });

  it('throws when given a non-absolute path (catches caller bug early)', () => {
    assert.throws(
      () => buildHtmlPreviewUrl('relative/path.html', { kind: 'workspace', baseDir: '/x' }),
      /absolute filesystem path/,
    );
  });
});

describe('buildHtmlPreviewUrl — home scope', () => {
  it('emits /api/files/html-preview/home/<abs-path>', () => {
    const url = buildHtmlPreviewUrl('/Users/me/Desktop/note.html', { kind: 'home' });
    assert.equal(
      url,
      '/api/files/html-preview/home/Users/me/Desktop/note.html',
    );
  });

  it('round-trip preserves the home marker (no baseDir)', () => {
    const url = buildHtmlPreviewUrl('/Users/me/Desktop/page.html', { kind: 'home' });
    const segments = url.replace('/api/files/html-preview/', '').split('/').map(decodeURIComponent);
    const parsed = parseHtmlPreviewSegments(segments);
    assert.equal(parsed.scope.kind, 'home');
    assert.equal(parsed.absolutePath, '/Users/me/Desktop/page.html');
  });
});

describe('parseHtmlPreviewSegments — malformed input', () => {
  it('rejects empty / undefined segments', () => {
    assert.throws(() => parseHtmlPreviewSegments(undefined as unknown as string[]), /at least/);
    assert.throws(() => parseHtmlPreviewSegments([]), /at least/);
    assert.throws(() => parseHtmlPreviewSegments(['only-scope']), /at least/);
  });

  it('rejects unknown scope tokens', () => {
    // Not 'home', not 'ws.<...>' — must be rejected so a 404-or-traversal
    // attempt with the wrong scope hint can't fall through to a default.
    assert.throws(
      () => parseHtmlPreviewSegments(['notascope', 'Users', 'me', 'x.html']),
      /unrecognized scope token/,
    );
    assert.throws(
      () => parseHtmlPreviewSegments(['etc', 'passwd']),
      /unrecognized scope token/,
    );
  });

  it('rejects ws.<empty> (caller dropped baseDir encoding)', () => {
    assert.throws(
      () => parseHtmlPreviewSegments(['ws.', 'Users', 'me', 'x.html']),
      /missing the encoded baseDir/,
    );
  });

  it('rejects ws.<invalid-base64-payload>', () => {
    // The decoded payload must itself be an absolute POSIX path. A
    // malformed payload that decodes to garbage like "abc" should
    // fail at the absolute-path check.
    // (base64url("not/absolute") = "bm90L2Fic29sdXRl")
    assert.throws(
      () => parseHtmlPreviewSegments(['ws.bm90L2Fic29sdXRl', 'x', 'y.html']),
      /absolute filesystem path/,
    );
  });

  it('does not collapse .. — the route handler is responsible for traversal checks', () => {
    // We deliberately let `..` segments through so the route can run
    // them through `assertRealPathInBase`, which uses fs.realpath and
    // catches symlink escapes too. Collapsing here would hide intent
    // from the route's safety check.
    const segments = ['ws.L1VzZXJzL21l', 'Users', 'me', '..', 'etc', 'passwd'];
    const parsed = parseHtmlPreviewSegments(segments);
    assert.equal(parsed.absolutePath, '/Users/me/../etc/passwd');
    if (parsed.scope.kind !== 'workspace') {
      assert.fail('expected workspace scope');
    } else {
      assert.equal(parsed.scope.baseDir, '/Users/me');
    }
  });
});

describe('buildHtmlPreviewUrl — interactive flag + reload nonce', () => {
  it('appends ?interactive=1 only when the option is set', () => {
    const off = buildHtmlPreviewUrl('/a/b.html', { kind: 'home' });
    assert.equal(off.includes('?interactive'), false);
    const on = buildHtmlPreviewUrl('/a/b.html', { kind: 'home' }, { interactive: true });
    assert.match(on, /\?interactive=1$/);
  });

  it('appends ?_t=<n> when reloadNonce > 0', () => {
    const zero = buildHtmlPreviewUrl('/a/b.html', { kind: 'home' }, { reloadNonce: 0 });
    assert.equal(zero.includes('_t='), false);
    const positive = buildHtmlPreviewUrl('/a/b.html', { kind: 'home' }, { reloadNonce: 7 });
    assert.match(positive, /\?_t=7$/);
  });

  it('combines both flags as `?interactive=1&_t=<n>`', () => {
    const url = buildHtmlPreviewUrl('/a/b.html', { kind: 'home' }, {
      interactive: true,
      reloadNonce: 3,
    });
    assert.match(url, /\?interactive=1&_t=3$/);
  });
});

describe('shouldReloadHtmlForPath — HTML sibling-dep reload predicate', () => {
  const activeHtml = '/Users/me/proj/site/index.html';
  const baseDir = '/Users/me/proj';

  it('returns true when the changed path matches the active HTML itself', () => {
    assert.equal(shouldReloadHtmlForPath(activeHtml, activeHtml, baseDir), true);
  });

  it('returns true for sibling CSS under the same scope', () => {
    assert.equal(
      shouldReloadHtmlForPath('/Users/me/proj/site/style.css', activeHtml, baseDir),
      true,
    );
  });

  it('returns true for nested image asset under the same scope', () => {
    assert.equal(
      shouldReloadHtmlForPath('/Users/me/proj/site/assets/logo.svg', activeHtml, baseDir),
      true,
    );
  });

  it('returns true for sibling JS / font / mjs / woff2', () => {
    assert.equal(shouldReloadHtmlForPath('/Users/me/proj/x.js', activeHtml, baseDir), true);
    assert.equal(shouldReloadHtmlForPath('/Users/me/proj/x.mjs', activeHtml, baseDir), true);
    assert.equal(shouldReloadHtmlForPath('/Users/me/proj/x.woff2', activeHtml, baseDir), true);
  });

  it('returns false for paths outside the scope baseDir', () => {
    assert.equal(
      shouldReloadHtmlForPath('/Users/me/elsewhere/style.css', activeHtml, baseDir),
      false,
    );
    assert.equal(shouldReloadHtmlForPath('/etc/style.css', activeHtml, baseDir), false);
  });

  it('returns false for non-static-resource extensions', () => {
    // Markdown / JSON / random text — these aren't HTML dependencies,
    // even if they live under the workspace.
    assert.equal(shouldReloadHtmlForPath('/Users/me/proj/notes.md', activeHtml, baseDir), false);
    assert.equal(shouldReloadHtmlForPath('/Users/me/proj/data.json', activeHtml, baseDir), false);
    assert.equal(shouldReloadHtmlForPath('/Users/me/proj/README', activeHtml, baseDir), false);
  });

  it('returns false when scopeBaseDir is missing — refuse to broaden by default', () => {
    // Defensive: a caller that loses scopeBaseDir shouldn't suddenly
    // make every static-resource edit anywhere on disk trigger reloads.
    assert.equal(shouldReloadHtmlForPath('/some/style.css', activeHtml, null), false);
    assert.equal(shouldReloadHtmlForPath('/some/style.css', activeHtml, ''), false);
    assert.equal(shouldReloadHtmlForPath('/some/style.css', activeHtml, undefined), false);
  });

  it('handles trailing slash on baseDir + Windows separators', () => {
    assert.equal(
      shouldReloadHtmlForPath('/proj/x.css', '/proj/index.html', '/proj/'),
      true,
    );
    assert.equal(
      shouldReloadHtmlForPath('C:\\proj\\x.css', 'C:\\proj\\index.html', 'C:\\proj'),
      true,
    );
  });

  it('HTML_DEP_EXTENSIONS sanity: covers the resource families HTML pages actually reference', () => {
    // Spot checks — not exhaustive, just a guard against future
    // accidental removal of the formats the policy claims to support.
    for (const ext of ['.css', '.js', '.png', '.svg', '.woff2', '.html']) {
      assert.ok(HTML_DEP_EXTENSIONS.has(ext), `expected ${ext} in HTML_DEP_EXTENSIONS`);
    }
  });
});

describe('htmlPreviewDirname — POSIX-style dirname for HTML reload scoping', () => {
  it('returns the parent directory for a top-level absolute file', () => {
    assert.equal(htmlPreviewDirname('/Users/me/Desktop/page.html'), '/Users/me/Desktop');
  });

  it('returns "/" for a file directly at root', () => {
    assert.equal(htmlPreviewDirname('/index.html'), '/');
  });

  it('returns "" for a path without separators (defensive)', () => {
    // Caller (PreviewPanel) treats "" as "no scope" and skips the
    // dep-reload path, which is the safe default.
    assert.equal(htmlPreviewDirname('orphan.html'), '');
  });

  it('normalizes Windows separators', () => {
    assert.equal(htmlPreviewDirname('C:\\Users\\me\\page.html'), 'C:/Users/me');
  });

  it('user-selected dep-reload path: dirname becomes the scope floor', () => {
    // The Codex Round 2 finding: user-selected HTML has sourceBaseDir
    // undefined, so the previous shouldReloadHtmlForPath(_, _, undefined)
    // returned false for every sibling. After Round 3, PreviewPanel
    // passes htmlPreviewDirname(filePath) as the scope; this test
    // documents the pair behavior.
    const externalHtml = '/Users/me/Desktop/external.html';
    const scope = htmlPreviewDirname(externalHtml);
    assert.equal(
      shouldReloadHtmlForPath('/Users/me/Desktop/style.css', externalHtml, scope),
      true,
      'sibling CSS in same dir → reload',
    );
    assert.equal(
      shouldReloadHtmlForPath('/Users/me/Desktop/assets/logo.svg', externalHtml, scope),
      true,
      'nested asset under same dir → reload',
    );
    assert.equal(
      shouldReloadHtmlForPath('/Users/me/Documents/x.css', externalHtml, scope),
      false,
      'sibling of the dir (not under it) → skip',
    );
    assert.equal(
      shouldReloadHtmlForPath('/Users/me/Desktop/notes.md', externalHtml, scope),
      false,
      'wrong extension under same dir → skip',
    );
  });
});
