/**
 * Tests for the unified API error helpers (audit A1).
 *
 * The whole point of these helpers is that the client only ever sees the error
 * MESSAGE, never the stack trace (which leaks absolute file paths and internal
 * structure). These assertions lock that contract: the response body carries
 * exactly the message, and provably not the stack.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toClientErrorMessage, serverErrorResponse } from '@/lib/api-error';

describe('toClientErrorMessage (audit A1)', () => {
  it('returns the message only for an Error (never the stack)', () => {
    const err = new Error('boom');
    assert.equal(toClientErrorMessage(err), 'boom');
    assert.ok(err.stack, 'sanity: Error should have a stack');
    assert.equal(toClientErrorMessage(err).includes(err.stack), false);
  });

  it('stringifies non-Error values', () => {
    assert.equal(toClientErrorMessage('plain'), 'plain');
    assert.equal(toClientErrorMessage(404), '404');
    assert.equal(toClientErrorMessage(null), 'null');
  });
});

describe('serverErrorResponse (audit A1)', () => {
  // The helper logs the full error server-side; silence it during assertions.
  function withSilencedError<T>(fn: () => T): T {
    const orig = console.error;
    console.error = () => {};
    try {
      return fn();
    } finally {
      console.error = orig;
    }
  }

  it('returns a 500 with a message-only body (no stack leak)', async () => {
    const err = new Error('db exploded');
    const res = withSilencedError(() => serverErrorResponse('TEST', err));
    assert.equal(res.status, 500);
    const body = (await res.json()) as { error: string; stack?: string };
    // Strongest assertion: the body is exactly the message — if any stack had
    // leaked in, this equality would fail.
    assert.equal(body.error, err.message);
    assert.equal('stack' in body, false);
    // Belt-and-suspenders: a multiline stack can't be a substring of a body
    // that equals the single-line message.
    assert.ok(err.stack && err.stack.includes('\n'), 'sanity: stack is multiline');
    assert.equal(body.error.includes(err.stack), false);
    assert.equal(body.error.includes('\n'), false);
  });

  it('honors a custom status code', () => {
    const res = withSilencedError(() => serverErrorResponse('TEST', new Error('x'), 503));
    assert.equal(res.status, 503);
  });
});
