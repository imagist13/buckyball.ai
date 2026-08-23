import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/files/inspect/route';
import { createSession } from '../../lib/db';
import {
  buildFileManagerRevealCommand,
  buildScopedPathInspectionUrl,
  validateScopedPathInspection,
} from '../../lib/local-path-security';
import {
  inspectLocalPath,
  LocalPathInspectionError,
  openHtmlFileWithSystem,
  revealPathWithSystem,
} from '../../lib/local-path-navigation';

const testRoot = path.join(os.tmpdir(), `codepilot-path-inspect-${randomUUID()}`);
const workspace = path.join(testRoot, 'workspace');
const directory = path.join(workspace, 'docs');
const file = path.join(workspace, 'README.md');
const htmlFile = path.join(workspace, 'report.html');
const outside = path.join(testRoot, 'outside.txt');

fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(file, '# Hello');
fs.writeFileSync(htmlFile, '<h1>Hello</h1>');
fs.writeFileSync(outside, 'outside');
const session = createSession('Local path test', undefined, undefined, workspace, 'code');
const canonicalFile = fs.realpathSync.native(file);
const canonicalDirectory = fs.realpathSync.native(directory);

after(() => {
  fs.rmSync(testRoot, { recursive: true, force: true });
});

function request(target: string, extra: Record<string, string> = {}): NextRequest {
  const params = new URLSearchParams({ path: target, sessionId: session.id, ...extra });
  return new NextRequest(`http://localhost/api/files/inspect?${params}`);
}

describe('GET /api/files/inspect', () => {
  it('derives scope from the session and returns the canonical path', async () => {
    const fileResponse = await GET(request(file));
    assert.equal(fileResponse.status, 200);
    assert.deepEqual(await fileResponse.json(), { kind: 'file', realPath: canonicalFile });

    const directoryResponse = await GET(request(directory));
    assert.equal(directoryResponse.status, 200);
    assert.deepEqual(await directoryResponse.json(), { kind: 'directory', realPath: canonicalDirectory });
  });

  it('rejects client-selected bases, relative paths, missing paths, and scope escapes', async () => {
    const selectedBase = await GET(request(file, { baseDir: workspace }));
    assert.equal(selectedBase.status, 400);

    const relative = await GET(request('README.md'));
    assert.equal(relative.status, 400);

    const dualScope = await GET(request(file, { scope: 'home' }));
    assert.equal(dualScope.status, 400);

    const unknownScopeParams = new URLSearchParams({ path: file, scope: 'workspace' });
    const unknownScope = await GET(new NextRequest(
      `http://localhost/api/files/inspect?${unknownScopeParams}`,
    ));
    assert.equal(unknownScope.status, 400);

    const missing = await GET(request(path.join(workspace, 'missing')));
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 'not_found');

    const escaped = await GET(request(outside));
    assert.equal(escaped.status, 403);
    assert.equal((await escaped.json()).code, 'path_unsafe');
  });

  it('rejects symlink escapes without disclosing resolved filesystem paths', async (t) => {
    const link = path.join(workspace, 'escape-link');
    try {
      fs.symlinkSync(outside, link);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        t.skip('Windows Developer Mode or symlink privilege is required for this fixture');
        return;
      }
      throw error;
    }
    const response = await GET(request(link));
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.code, 'path_unsafe');
    assert.doesNotMatch(JSON.stringify(body), /realPath|realBase|outside\.txt/);
  });
});

describe('local path navigation client', () => {
  it('builds a session-scoped inspect request and returns canonical metadata', async () => {
    let requestedUrl = '';
    const fetcher = (async (input: string | URL | Request) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ kind: 'directory', realPath: '/tmp/My Folder' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    assert.deepEqual(
      await inspectLocalPath('/tmp/My Folder', { sessionId: 'session-1' }, fetcher),
      { kind: 'directory', realPath: '/tmp/My Folder' },
    );
    const url = new URL(requestedUrl, 'http://localhost');
    assert.equal(url.pathname, '/api/files/inspect');
    assert.equal(url.searchParams.get('path'), '/tmp/My Folder');
    assert.equal(url.searchParams.get('sessionId'), 'session-1');
    assert.equal(url.searchParams.has('baseDir'), false);
  });

  it('surfaces structured inspect failures', async () => {
    const fetcher = (async () => new Response(
      JSON.stringify({ error: 'Path is outside scope', code: 'path_unsafe' }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )) as typeof fetch;

    await assert.rejects(
      () => inspectLocalPath('/etc', { scope: 'home' }, fetcher),
      (error: unknown) => {
        assert.ok(error instanceof LocalPathInspectionError);
        assert.equal(error.code, 'path_unsafe');
        assert.equal(error.status, 403);
        return true;
      },
    );
  });

  it('uses distinct reveal and HTML-only bridge capabilities', async () => {
    let revealed: unknown;
    await revealPathWithSystem(
      { path: '/tmp/page.html', sessionId: 'session-1' },
      { revealPath: async (target) => { revealed = target; return ''; } },
    );
    assert.deepEqual(revealed, { path: '/tmp/page.html', sessionId: 'session-1' });

    let opened: unknown;
    await openHtmlFileWithSystem(
      { path: '/tmp/page.html', sessionId: 'session-1' },
      { openHtmlFile: async (target) => { opened = target; return ''; } },
    );
    assert.deepEqual(opened, { path: '/tmp/page.html', sessionId: 'session-1' });
  });
});

describe('Electron system-path boundary', () => {
  it('accepts only the local renderer origin and server-derived scopes', () => {
    const url = buildScopedPathInspectionUrl(
      'http://127.0.0.1:3000/chat',
      { path: htmlFile, sessionId: session.id },
      'open-html',
    );
    assert.equal(url.pathname, '/api/files/inspect');
    assert.equal(url.searchParams.get('sessionId'), session.id);
    assert.throws(
      () => buildScopedPathInspectionUrl('https://evil.test', { path: htmlFile, sessionId: session.id }, 'open-html'),
      /untrusted_renderer/,
    );
    assert.throws(
      () => buildScopedPathInspectionUrl('http://127.0.0.1:3000', { path: 'relative.html', sessionId: session.id }, 'open-html'),
      /invalid_path/,
    );
    assert.throws(
      () => buildScopedPathInspectionUrl(
        'http://127.0.0.1:3000',
        { path: htmlFile, sessionId: 's'.repeat(257) },
        'open-html',
      ),
      /invalid_scope/,
    );
  });

  it('blocks bundle-shaped directories and non-HTML executable files', () => {
    assert.throws(
      () => validateScopedPathInspection({ kind: 'directory', realPath: '/tmp/Evil.app' }, 'reveal'),
      /bundle_directory_blocked/,
    );
    assert.throws(
      () => validateScopedPathInspection({ kind: 'directory', realPath: '/tmp/Evil.workflow' }, 'reveal'),
      /bundle_directory_blocked/,
    );
    assert.throws(
      () => validateScopedPathInspection({ kind: 'file', realPath: '/tmp/pwn.command' }, 'open-html'),
      /html_file_required/,
    );
    assert.deepEqual(
      validateScopedPathInspection({ kind: 'file', realPath: '/tmp/report.html' }, 'open-html'),
      { kind: 'file', realPath: '/tmp/report.html' },
    );
  });

  it('keeps metacharacter-containing paths inside one argv entry', () => {
    const malicious = '/tmp/report"; touch /tmp/should-not-exist; ".html';
    const invocation = buildFileManagerRevealCommand('darwin', malicious);
    assert.equal(invocation.command, '/usr/bin/open');
    assert.deepEqual(invocation.args, ['-R', malicious]);
  });
});
