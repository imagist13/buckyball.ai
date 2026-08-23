/**
 * B-025: serverErrors must stay bounded under a Codex tracing flood (it used to
 * be an unbounded string[] that grew with every server stdout/stderr chunk).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoundedLineRing } from '../../lib/logging/bounded-line-ring';

describe('BoundedLineRing (B-025 serverErrors cap)', () => {
  it('caps by line count under a 10,000-line flood, keeping the most recent', () => {
    const ring = new BoundedLineRing(200, 1024 * 1024);
    for (let i = 0; i < 10_000; i++) ring.push(`server line ${i}`);
    assert.ok(ring.length <= 200, `expected <= 200 lines, got ${ring.length}`);
    const arr = ring.toArray();
    assert.equal(arr[arr.length - 1], 'server line 9999');
    assert.ok(!arr.includes('server line 0'), 'oldest lines must be evicted');
  });

  it('caps by byte budget even when a few huge lines arrive', () => {
    const ring = new BoundedLineRing(1000, 1024); // 1 KB budget, generous line cap
    for (let i = 0; i < 50; i++) ring.push('x'.repeat(200)); // 200 bytes each
    assert.ok(ring.byteLength <= 1024, `bytes ${ring.byteLength} exceeded the 1KB budget`);
  });

  it('splits a multi-line chunk into bounded per-line entries', () => {
    const ring = new BoundedLineRing(3, 1024 * 1024);
    ring.push('a\nb\nc\nd\ne'); // one chunk, 5 lines, into a 3-line ring
    assert.deepEqual(ring.toArray(), ['c', 'd', 'e']);
  });

  it('recent(n) returns the last n lines; clear() empties it', () => {
    const ring = new BoundedLineRing(200, 1024 * 1024);
    for (let i = 0; i < 20; i++) ring.push(`l${i}`);
    assert.deepEqual(ring.recent(3), ['l17', 'l18', 'l19']);
    ring.clear();
    assert.equal(ring.length, 0);
    assert.equal(ring.byteLength, 0);
  });
});
