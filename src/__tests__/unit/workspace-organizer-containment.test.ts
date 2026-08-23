import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertContained } from '../../lib/workspace-organizer';

test('assertContained canonicalizes both the workspace base and candidate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-contained-base-'));
  const workspace = path.join(root, 'workspace');
  const alias = path.join(root, 'workspace-alias');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'inside.txt'), 'ok');
  fs.symlinkSync(workspace, alias, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    assert.equal(
      assertContained(alias, 'inside.txt'),
      path.join(alias, 'inside.txt'),
    );
    assert.throws(
      () => assertContained(alias, '../outside.txt'),
      /escapes workspace boundary/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
