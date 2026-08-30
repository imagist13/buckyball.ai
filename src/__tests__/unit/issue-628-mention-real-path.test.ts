/**
 * #628 — @-mention of an in-tree project file must let the AI Read/Edit the
 * USER'S REAL FILE, not a `.codepilot-uploads` copy. Root cause: mention files
 * were fetched as base64-only attachments (real path discarded) and route.ts
 * copied every non-directory file, so the AI edited a throwaway.
 *
 * Fix: FileAttachment.originPath (set on mentions at MessageInput) → route
 * resolves it inside cwd and references the real path instead of copying.
 *
 * Security is the crux — the client path is NEVER trusted. Codex P1: a
 * string-level containment check is not enough, because an in-tree SYMLINK can
 * point outside the project (`linked-secret.txt -> ../outside`) and a
 * follow-the-link write escapes. The resolver now reuses the project's
 * `assertRealPathInBase(..., rejectIfSymlink: true)` write-path contract.
 *
 * Codex P3: symlinks are planted INSIDE each test via a helper that skips on
 * EPERM (not in before()), mirroring html-preview-route.test.ts, so a restricted
 * FS (Windows without Developer Mode) doesn't blow up the whole suite setup.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { resolveInTreeAttachmentPath } from '../../lib/in-tree-attachment';

/**
 * Plant a symlink, returning true on success. On a restricted FS (Windows
 * without Developer Mode / Admin) symlink creation throws EPERM — return false
 * so the caller can skip the assertion instead of failing the suite.
 */
function trySymlink(target: string, linkPath: string): boolean {
  try {
    fs.symlinkSync(target, linkPath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw err;
  }
}

describe('#628 — resolveInTreeAttachmentPath (cwd + symlink containment)', () => {
  let workDir: string;
  let outsideFile: string;
  before(() => {
    workDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'issue-628-')));
    fs.writeFileSync(path.join(workDir, 'real.ts'), 'export const x = 1;');
    fs.mkdirSync(path.join(workDir, 'sub'));
    fs.writeFileSync(path.join(workDir, 'sub', 'nested.md'), '# hi');
    // a secret OUTSIDE the project (symlink targets are planted per-test)
    outsideFile = path.join(os.tmpdir(), `issue-628-outside-${process.pid}.txt`);
    fs.writeFileSync(outsideFile, 'SECRET');
  });
  after(() => {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* best effort */ }
    try { fs.rmSync(outsideFile, { force: true }); } catch { /* best effort */ }
  });

  it('returns the real absolute path for an in-cwd file', async () => {
    assert.equal(await resolveInTreeAttachmentPath('real.ts', workDir), path.join(workDir, 'real.ts'));
  });
  it('resolves a nested in-cwd file', async () => {
    assert.equal(await resolveInTreeAttachmentPath('sub/nested.md', workDir), path.join(workDir, 'sub', 'nested.md'));
  });
  it('rejects a ../ escape (returns null → caller copies)', async () => {
    assert.equal(await resolveInTreeAttachmentPath('../outside.ts', workDir), null);
  });
  it('rejects an absolute path outside cwd', async () => {
    assert.equal(await resolveInTreeAttachmentPath('/etc/passwd', workDir), null);
  });
  it('rejects a non-existent in-cwd path', async () => {
    assert.equal(await resolveInTreeAttachmentPath('nope.ts', workDir), null);
  });
  it('rejects a directory (only regular files preserved)', async () => {
    assert.equal(await resolveInTreeAttachmentPath('sub', workDir), null);
  });
  it('rejects absent originPath / workDir', async () => {
    assert.equal(await resolveInTreeAttachmentPath(undefined, workDir), null);
    assert.equal(await resolveInTreeAttachmentPath('', workDir), null);
    assert.equal(await resolveInTreeAttachmentPath('real.ts', undefined), null);
  });
  it('[P1] rejects an in-tree SYMLINK that escapes cwd (Codex finding repro)', async () => {
    // path looks in-tree but the real target is outside — must NOT reach the AI
    if (!trySymlink(outsideFile, path.join(workDir, 'linked-secret.txt'))) return; // FS w/o symlink support
    assert.equal(await resolveInTreeAttachmentPath('linked-secret.txt', workDir), null);
  });
  it('[P1] rejects an in-tree symlink even when it points inside (rejectIfSymlink)', async () => {
    if (!trySymlink(path.join(workDir, 'real.ts'), path.join(workDir, 'linked-inside.ts'))) return;
    assert.equal(await resolveInTreeAttachmentPath('linked-inside.ts', workDir), null);
  });
});

describe('#628 — wiring source pins', () => {
  const types = readFileSync(path.resolve(__dirname, '../../types/index.ts'), 'utf8');
  const mi = readFileSync(path.resolve(__dirname, '../../components/chat/MessageInput.tsx'), 'utf8');
  const route = readFileSync(path.resolve(__dirname, '../../app/api/chat/route.ts'), 'utf8');
  const lib = readFileSync(path.resolve(__dirname, '../../lib/in-tree-attachment.ts'), 'utf8');

  it('FileAttachment declares originPath', () => {
    assert.match(types, /originPath\?: string;/);
  });
  it('mention attachments pass the real path (safePath) as originPath', () => {
    assert.match(mi, /fileResponseToAttachment\(res, filename, 'mention', safePath\)/);
  });
  it('route resolves the in-tree real path BEFORE writing a copy', () => {
    const real = route.indexOf('resolveInTreeAttachmentPath(f.originPath');
    const copy = route.indexOf('path.join(uploadDir,');
    assert.ok(real > 0 && real < copy, 'in-tree resolution must precede the copy write');
  });
  it('[P1] reuses assertRealPathInBase with rejectIfSymlink (not a bespoke check)', () => {
    assert.match(lib, /assertRealPathInBase\([\s\S]{0,160}rejectIfSymlink: true/);
  });
});
