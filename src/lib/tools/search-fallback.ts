import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

const MAX_VISITED_FILES = 20_000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_LINE_CHARS = 64_000;
const DEFAULT_TIMEOUT_MS = 15_000;

export const SEARCH_EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.cache',
  '__pycache__',
]);

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

/** Compile the small glob surface exposed by the Native Glob/Grep tools. */
export function compileGlob(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  let source = normalized.includes('/') ? '^' : '^(?:.*/)?';

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === '*') {
      if (normalized[index + 1] === '*') {
        index += 1;
        if (normalized[index + 1] === '/') {
          index += 1;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    if (char === '[') {
      const closing = normalized.indexOf(']', index + 1);
      if (closing !== -1) {
        const body = normalized.slice(index + 1, closing);
        const negated = body.startsWith('!') ? `^${body.slice(1)}` : body;
        source += `[${negated.replace(/\\/g, '\\\\')}]`;
        index = closing;
        continue;
      }
    }
    if (char === '{') {
      const closing = normalized.indexOf('}', index + 1);
      if (closing !== -1) {
        const choices = normalized.slice(index + 1, closing).split(',');
        if (choices.length > 1) {
          source += `(?:${choices.map(escapeRegex).join('|')})`;
          index = closing;
          continue;
        }
      }
    }
    source += escapeRegex(char);
  }

  return new RegExp(`${source}$`);
}

function listFiles(root: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): string[] {
  const startedAt = Date.now();
  const pending = [root];
  const files: string[] = [];

  while (pending.length > 0) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('node_search_timeout');
    if (files.length >= MAX_VISITED_FILES) throw new Error('node_search_scan_limit');
    const directory = pending.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      // Match ripgrep's default hidden-file behavior. Explicitly targeting a
      // hidden file still works because only directory traversal is filtered.
      if (entry.name.startsWith('.')) continue;
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SEARCH_EXCLUDED_DIRECTORIES.has(entry.name)) pending.push(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
        if (files.length > MAX_VISITED_FILES) throw new Error('node_search_scan_limit');
      }
    }
  }

  return files;
}

function portableRelative(root: string, filePath: string): string {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

export function globWithNode(cwd: string, pattern: string, limit: number = 200): string[] {
  const matcher = compileGlob(pattern);
  return listFiles(cwd)
    .map((filePath) => portableRelative(cwd, filePath))
    .filter((relativePath) => matcher.test(relativePath))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit);
}

export interface NodeGrepOptions {
  pattern: string;
  root: string;
  target?: string;
  glob?: string;
  caseInsensitive?: boolean;
  contextLines?: number;
  limit?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const NODE_GREP_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');

function portableRelative(root, filePath) {
  return path.relative(root, filePath).replace(/\\/g, '/');
}

function isProbablyBinary(buffer) {
  return buffer.subarray(0, Math.min(buffer.length, 8_000)).includes(0);
}

function listFiles(root, deadline) {
  const pending = [root];
  const files = [];
  const excluded = new Set(workerData.excludedDirectories);

  while (pending.length > 0) {
    if (Date.now() > deadline) throw new Error('node_grep_timeout');
    if (files.length >= workerData.maxVisitedFiles) {
      throw new Error('node_grep_scan_limit');
    }
    const directory = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (Date.now() > deadline) throw new Error('node_grep_timeout');
      if (entry.name.startsWith('.')) continue;
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name)) pending.push(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
        if (files.length > workerData.maxVisitedFiles) {
          throw new Error('node_grep_scan_limit');
        }
      }
    }
  }

  return files;
}

function run() {
  const deadline = Date.now() + workerData.timeoutMs;
  const matcher = new RegExp(workerData.pattern, workerData.caseInsensitive ? 'i' : '');
  const globMatcher = workerData.globSource ? new RegExp(workerData.globSource) : null;
  let candidates;
  try {
    const stat = fs.statSync(workerData.target);
    candidates = stat.isFile()
      ? [workerData.target]
      : stat.isDirectory()
        ? listFiles(workerData.target, deadline)
        : [];
  } catch (error) {
    if (error && /^node_grep_/.test(error.message || '')) throw error;
    candidates = [];
  }

  const output = [];
  let matchCount = 0;
  for (const filePath of candidates) {
    if (Date.now() > deadline) throw new Error('node_grep_timeout');
    const relativePath = portableRelative(workerData.root, filePath);
    if (globMatcher && !globMatcher.test(relativePath)) continue;

    let buffer;
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > workerData.maxFileBytes) continue;
      buffer = fs.readFileSync(filePath);
    } catch {
      continue;
    }
    if (isProbablyBinary(buffer)) continue;

    const lines = buffer.toString('utf8').split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (Date.now() > deadline) throw new Error('node_grep_timeout');
      if (lines[index].length > workerData.maxLineChars) {
        throw new Error('node_grep_line_too_long');
      }
      matcher.lastIndex = 0;
      if (!matcher.test(lines[index])) continue;

      const firstLine = Math.max(0, index - workerData.contextLines);
      const lastLine = Math.min(lines.length - 1, index + workerData.contextLines);
      for (let lineIndex = firstLine; lineIndex <= lastLine; lineIndex += 1) {
        const separator = lineIndex === index ? ':' : '-';
        output.push(relativePath + separator + (lineIndex + 1) + separator + lines[lineIndex]);
      }
      matchCount += 1;
      if (matchCount >= workerData.limit) return output;
    }
  }

  return output;
}

parentPort.postMessage(run());
`;

function abortError(): Error {
  const error = new Error('node_grep_aborted');
  error.name = 'AbortError';
  return error;
}

/** Shell-free fallback for systems where the packaged PATH has no ripgrep. */
export function grepWithNode(options: NodeGrepOptions): Promise<string[]> {
  if (options.signal?.aborted) return Promise.reject(abortError());
  const globSource = options.glob ? compileGlob(options.glob).source : null;
  const contextLines = options.contextLines ?? 0;
  const limit = options.limit ?? 50;
  const target = options.target ?? options.root;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<string[]>((resolve, reject) => {
    const worker = new Worker(NODE_GREP_WORKER_SOURCE, {
      eval: true,
      workerData: {
        pattern: options.pattern,
        root: options.root,
        target,
        globSource,
        caseInsensitive: options.caseInsensitive ?? false,
        contextLines,
        limit,
        timeoutMs,
        maxVisitedFiles: MAX_VISITED_FILES,
        maxFileBytes: MAX_FILE_BYTES,
        maxLineChars: MAX_LINE_CHARS,
        excludedDirectories: [...SEARCH_EXCLUDED_DIRECTORIES],
      },
    });
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      void worker.terminate();
      callback();
    };
    const onAbort = () => settle(() => reject(abortError()));
    const timeout = setTimeout(() => {
      settle(() => reject(new Error('node_grep_timeout')));
    }, timeoutMs);

    options.signal?.addEventListener('abort', onAbort, { once: true });
    worker.once('message', (value: unknown) => {
      settle(() => {
        if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
          reject(new Error('node_grep_invalid_worker_result'));
          return;
        }
        resolve(value);
      });
    });
    worker.once('error', (error) => settle(() => reject(error)));
    worker.once('exit', (code) => {
      if (code !== 0) settle(() => reject(new Error(`node_grep_worker_exit_${code}`)));
    });
  });
}
