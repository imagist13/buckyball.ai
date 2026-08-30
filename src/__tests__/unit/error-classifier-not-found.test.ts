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

  it('separates OS process denial from missing binaries and provider authorization', () => {
    for (const code of ['EPERM', 'EACCES']) {
      const denied = Object.assign(new Error(`spawn claude ${code}`), { code });
      const result = classifyError({ error: denied });
      assert.equal(result.category, 'EXECUTION_PERMISSION_DENIED');
      assert.equal(result.retryable, false);
    }

    for (const code of ['EPERM', 'EACCES']) {
      const productFault = Object.assign(new Error(`rename database backup failed: ${code}`), { code });
      assert.equal(
        classifyError({ error: productFault }).category,
        'UNKNOWN',
        'a bare filesystem errno is a product fault unless the text proves spawn/exec denial',
      );
    }

    assert.equal(
      classifyError({ error: new Error('spawn /usr/local/bin/claude operation not permitted') }).category,
      'EXECUTION_PERMISSION_DENIED',
    );
    assert.equal(
      classifyError({ error: new Error('403 permission denied by provider') }).category,
      'AUTH_FORBIDDEN',
    );
  });
});
