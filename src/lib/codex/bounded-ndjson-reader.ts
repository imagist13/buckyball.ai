/**
 * Incremental newline-delimited JSON frame reader with a hard byte cap.
 *
 * The Codex app-server speaks one JSON message per stdout line. Keeping the
 * pending line as a JS string makes an unterminated/oversized frame unbounded
 * and repeatedly flattens/copies it. This reader retains bounded Buffer
 * fragments and checks the byte limit before every copy/concatenation.
 */

export const DEFAULT_CODEX_FRAME_LIMIT_BYTES = 32 * 1024 * 1024;

export class CodexProtocolFrameTooLargeError extends Error {
  readonly code = 'CODEX_PROTOCOL_FRAME_TOO_LARGE';
  readonly frameBytes: number;
  readonly maxFrameBytes: number;

  constructor(frameBytes: number, maxFrameBytes: number) {
    super(`Codex protocol frame exceeded ${maxFrameBytes} bytes`);
    this.name = 'CodexProtocolFrameTooLargeError';
    this.frameBytes = frameBytes;
    this.maxFrameBytes = maxFrameBytes;
  }
}

export interface BoundedNdjsonFrame {
  text: string;
  bytes: number;
}

export class BoundedNdjsonReader {
  private pendingChunks: Buffer[] = [];
  private pendingBytes = 0;
  private maxCompletedFrameBytes = 0;

  constructor(readonly maxFrameBytes = DEFAULT_CODEX_FRAME_LIMIT_BYTES) {
    if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes <= 0) {
      throw new Error('maxFrameBytes must be a positive safe integer');
    }
  }

  get currentFrameBytes(): number {
    return this.pendingBytes;
  }

  get completedFrameHighWaterBytes(): number {
    return this.maxCompletedFrameBytes;
  }

  push(input: Buffer | Uint8Array | string): BoundedNdjsonFrame[] {
    const chunk = typeof input === 'string'
      ? Buffer.from(input, 'utf8')
      : Buffer.isBuffer(input)
        ? input
        : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    const frames: BoundedNdjsonFrame[] = [];
    let start = 0;

    for (let index = 0; index < chunk.length; index += 1) {
      if (chunk[index] !== 0x0a) continue;
      this.appendSegment(chunk.subarray(start, index));
      const bytes = this.pendingBytes;
      const frameBuffer = this.consumePending();
      const withoutCr = frameBuffer.length > 0 && frameBuffer[frameBuffer.length - 1] === 0x0d
        ? frameBuffer.subarray(0, frameBuffer.length - 1)
        : frameBuffer;
      this.maxCompletedFrameBytes = Math.max(this.maxCompletedFrameBytes, bytes);
      frames.push({ text: withoutCr.toString('utf8'), bytes });
      start = index + 1;
    }

    if (start < chunk.length) {
      this.appendSegment(chunk.subarray(start));
    }
    return frames;
  }

  reset(): void {
    this.pendingChunks = [];
    this.pendingBytes = 0;
  }

  private appendSegment(segment: Buffer): void {
    if (segment.length === 0) return;
    const nextBytes = this.pendingBytes + segment.length;
    if (nextBytes > this.maxFrameBytes) {
      this.reset();
      throw new CodexProtocolFrameTooLargeError(nextBytes, this.maxFrameBytes);
    }
    // Copy only after the cap check. A subarray would retain the entire source
    // chunk, including already-consumed frames, and defeat the memory bound.
    this.pendingChunks.push(Buffer.from(segment));
    this.pendingBytes = nextBytes;
  }

  private consumePending(): Buffer {
    const bytes = this.pendingBytes;
    const chunks = this.pendingChunks;
    this.pendingChunks = [];
    this.pendingBytes = 0;
    if (chunks.length === 0) return Buffer.alloc(0);
    if (chunks.length === 1) return chunks[0];
    return Buffer.concat(chunks, bytes);
  }
}

