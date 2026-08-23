import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  externalOpenFailureCopy,
  openExternalSafely,
} from '../../../electron/external-navigation';

describe('Electron external navigation failure ownership', () => {
  it('reports success without invoking failure feedback', async () => {
    const opened: string[] = [];
    let feedbackCalls = 0;
    const outcome = await openExternalSafely(
      'https://example.test/path?private=1',
      async (url) => { opened.push(url); },
      () => { feedbackCalls += 1; },
    );
    assert.equal(outcome, 'opened');
    assert.deepEqual(opened, ['https://example.test/path?private=1']);
    assert.equal(feedbackCalls, 0);
  });

  it('consumes a rejected opener and invokes bounded feedback once', async () => {
    let feedbackCalls = 0;
    const outcome = await openExternalSafely(
      'https://example.test/',
      async () => { throw new Error('Windows association failure with dynamic detail'); },
      async () => { feedbackCalls += 1; },
    );
    assert.equal(outcome, 'failed');
    assert.equal(feedbackCalls, 1);
  });

  it('also consumes a failure thrown by the feedback surface', async () => {
    await assert.doesNotReject(async () => {
      const outcome = await openExternalSafely(
        'https://example.test/',
        async () => { throw new Error('open failed'); },
        async () => { throw new Error('dialog failed'); },
      );
      assert.equal(outcome, 'failed');
    });
  });

  it('returns localised guidance without echoing the URL or OS error', () => {
    const zh = externalOpenFailureCopy('zh-CN');
    const en = externalOpenFailureCopy('en-US');
    assert.match(zh.message, /无法|没有成功/);
    assert.match(en.message, /could not open/i);
    assert.doesNotMatch(JSON.stringify([zh, en]), /https?:|0x483|example\.test/);
  });
});
