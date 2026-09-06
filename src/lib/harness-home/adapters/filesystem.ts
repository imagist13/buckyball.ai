import fs from 'node:fs';
import path from 'node:path';
import { hashBytes, hashFile } from '../repository';

const MAX_ADAPTER_FILE_BYTES = 1024 * 1024;

export function safeAdapterSlug(value: string): string {
  const slug = value
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  if (!slug || slug === '.' || slug === '..') {
    throw new Error(`Adapter identity cannot be mapped to a safe filename: ${value}`);
  }
  return slug;
}

export function safeResolveExternalPath(root: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`External Harness path must be relative: ${relativePath}`);
  }
  const normalized = path.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`External Harness path escapes root: ${relativePath}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, normalized);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`External Harness path escapes root: ${relativePath}`);
  }
  return resolved;
}

export function assertExternalPathHasNoSymlink(
  root: string,
  relativePath: string,
): void {
  const resolvedRoot = path.resolve(root);
  const target = safeResolveExternalPath(root, relativePath);
  const relative = path.relative(resolvedRoot, target);
  let cursor = resolvedRoot;
  for (const part of relative.split(path.sep)) {
    if (!part) continue;
    cursor = path.join(cursor, part);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) {
        throw new Error(`External Harness path traverses a symlink: ${relativePath}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

export function readAdapterFile(
  root: string,
  relativePath: string,
): { readonly content: string; readonly absolutePath: string } | undefined {
  try {
    assertExternalPathHasNoSymlink(root, relativePath);
    const absolutePath = safeResolveExternalPath(root, relativePath);
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile() || stat.size > MAX_ADAPTER_FILE_BYTES) return undefined;
    return {
      content: fs.readFileSync(absolutePath, 'utf8'),
      absolutePath,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export function listAdapterDirectories(
  root: string,
  relativePath: string,
): readonly string[] {
  try {
    assertExternalPathHasNoSymlink(root, relativePath);
    return fs.readdirSync(safeResolveExternalPath(root, relativePath), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export function listAdapterFiles(
  root: string,
  relativePath: string,
  extension?: string,
): readonly string[] {
  try {
    assertExternalPathHasNoSymlink(root, relativePath);
    return fs.readdirSync(safeResolveExternalPath(root, relativePath), {
      withFileTypes: true,
    })
      .filter((entry) =>
        entry.isFile()
        && !entry.name.startsWith('.')
        && (!extension || entry.name.endsWith(extension)))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export function exportWriteState(
  targetRoot: string,
  relativePath: string,
  content: Buffer,
): {
  readonly action: 'create' | 'skip_same' | 'conflict';
  readonly expectedOldHash: string | null;
  readonly newHash: string;
  readonly reason: string;
} {
  assertExternalPathHasNoSymlink(targetRoot, relativePath);
  const existingHash = hashFile(safeResolveExternalPath(targetRoot, relativePath));
  const newHash = hashBytes(content);
  if (!existingHash) {
    return {
      action: 'create',
      expectedOldHash: null,
      newHash,
      reason: 'External target does not exist.',
    };
  }
  if (existingHash === newHash) {
    return {
      action: 'skip_same',
      expectedOldHash: existingHash,
      newHash,
      reason: 'External target already has the same content.',
    };
  }
  return {
    action: 'conflict',
    expectedOldHash: existingHash,
    newHash,
    reason: 'External target has different content and will not be overwritten.',
  };
}
