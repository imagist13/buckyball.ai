import crypto from 'node:crypto';
import fs from 'node:fs';

export const MISSING_CONTENT_HASH = null;

export function hashBytes(value: string | Buffer): string {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

export function hashFile(filePath: string): string | null {
  let file: number | undefined;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const hash = crypto.createHash('sha256');
    file = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    while (true) {
      const bytesRead = fs.readSync(
        file,
        buffer,
        0,
        buffer.length,
        offset,
      );
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    return `sha256:${hash.digest('hex')}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  } finally {
    if (file !== undefined) fs.closeSync(file);
  }
}
