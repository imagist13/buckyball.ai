import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyError } from '../../lib/error-classifier';

describe('error classifier not-found responsibility boundary', () => {
  it('recognizes executable ENOENT without swallowing endpoint/model failures', () => {
    const enoent = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    assert.equal(classifyError({ error: enoent }).category, 'CLI_NOT_FOUND');
    assert.equal(
      classifyError({ error: new Error('Claude Code native binary not found at /tmp/claude') }).category,
      'CLI_NOT_FOUND',
    );
    assert.equal(
      classifyError({ error: new Error('404 endpoint not found') }).category,
      'ENDPOINT_NOT_FOUND',
    );
    assert.equal(
      classifyError({ error: new Error('model not found: deepseek-chat') }).category,
      'MODEL_NOT_AVAILABLE',
    );
  });
});
