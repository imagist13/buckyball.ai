import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BoundedNdjsonReader,
  CodexProtocolFrameTooLargeError,
} from '@/lib/codex/bounded-ndjson-reader';

describe('BoundedNdjsonReader', () => {
  it('assembles frames across chunk boundaries and strips CRLF', () => {
    const reader = new BoundedNdjsonReader(64);
    assert.deepEqual(reader.push(Buffer.from('{"a":"你')), []);
    const frames = reader.push(Buffer.from('好"}\r\n{"b":2}\n'));
    assert.deepEqual(frames.map((frame) => frame.text), ['{"a":"你好"}', '{"b":2}']);
    assert.equal(reader.currentFrameBytes, 0);
  });

  it('accepts a frame exactly at the byte cap', () => {
    const reader = new BoundedNdjsonReader(4);
    const frames = reader.push(Buffer.from('1234\n'));
    assert.deepEqual(frames, [{ text: '1234', bytes: 4 }]);
  });

  it('rejects before retaining a no-newline frame above the cap', () => {
    const reader = new BoundedNdjsonReader(4);
    assert.throws(
      () => reader.push(Buffer.from('12345')),
      (error: unknown) => {
        assert.ok(error instanceof CodexProtocolFrameTooLargeError);
        assert.equal(error.code, 'CODEX_PROTOCOL_FRAME_TOO_LARGE');
        assert.equal(error.frameBytes, 5);
        return true;
      },
    );
    assert.equal(reader.currentFrameBytes, 0);
  });

  it('rejects a split multibyte frame by bytes, not JS string length', () => {
    const reader = new BoundedNdjsonReader(5);
    const encoded = Buffer.from('你好\n', 'utf8');
    assert.equal(encoded.length, 7);
    assert.throws(() => {
      reader.push(encoded.subarray(0, 3));
      reader.push(encoded.subarray(3));
    }, CodexProtocolFrameTooLargeError);
  });

  it('emits multiple frames and retains only the trailing partial frame', () => {
    const reader = new BoundedNdjsonReader(16);
    const frames = reader.push(Buffer.from('a\nbb\nccc'));
    assert.deepEqual(frames, [
      { text: 'a', bytes: 1 },
      { text: 'bb', bytes: 2 },
    ]);
    assert.equal(reader.currentFrameBytes, 3);
    assert.deepEqual(reader.push(Buffer.from('d\n')), [{ text: 'cccd', bytes: 4 }]);
    assert.equal(reader.completedFrameHighWaterBytes, 4);
  });
});
