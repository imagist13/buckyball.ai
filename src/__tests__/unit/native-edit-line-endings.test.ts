import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEditTool } from '../../lib/tools/edit';

type ExecutableTool = {
  execute?: (input: unknown, options: unknown) => Promise<unknown> | unknown;
};

test('Native Edit preserves CRLF when old_string came from LF-normalized Read output', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-edit-crlf-'));
  const filePath = path.join(root, 'windows.txt');
  fs.writeFileSync(filePath, 'alpha\r\nbeta\r\ngamma\r\n');
  try {
    const edit = createEditTool({ workingDirectory: root }) as ExecutableTool;
    assert.equal(typeof edit.execute, 'function');
    const result = String(await edit.execute!({
      file_path: filePath,
      old_string: 'beta\ngamma',
      new_string: 'BETA\nGAMMA',
    }, {
      toolCallId: 'crlf-test',
      messages: [],
    }));
    assert.match(result, /Successfully edited/);
    const bytes = fs.readFileSync(filePath, 'utf8');
    assert.equal(bytes, 'alpha\r\nBETA\r\nGAMMA\r\n');
    assert.doesNotMatch(bytes, /(^|[^\r])\n/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
