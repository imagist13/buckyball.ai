/**
 * tools/grep.ts — Search file contents using ripgrep.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'node:fs';
import type { ToolContext } from './index';
import { grepWithNode } from './search-fallback';

export function createGrepTool(ctx: ToolContext) {
  return tool({
    description:
      'Search file contents for a regex pattern using ripgrep. ' +
      'Returns matching lines with file paths and line numbers. ' +
      'Supports full regex syntax. Use glob parameter to filter by file type.',
    inputSchema: z.object({
      pattern: z.string().describe('Regex pattern to search for'),
      path: z.string().optional().describe('File or directory to search in (defaults to working directory)'),
      glob: z.string().optional().describe('Glob pattern to filter files (e.g. "*.ts", "*.{js,jsx}")'),
      case_insensitive: z.boolean().optional().describe('Case insensitive search'),
      context: z.number().int().min(0).optional().describe('Lines of context around each match'),
      max_results: z.number().int().min(1).optional().describe('Maximum number of results (default 50)'),
    }),
    execute: async ({ pattern, path: searchPath, glob: globPattern, case_insensitive, context: ctxLines, max_results }, toolOptions) => {
      const requestedPath = searchPath
        ? (path.isAbsolute(searchPath) ? searchPath : path.resolve(ctx.workingDirectory, searchPath))
        : ctx.workingDirectory;
      let cwd = requestedPath;
      let target = '.';
      try {
        if (fs.statSync(requestedPath).isFile()) {
          cwd = path.dirname(requestedPath);
          target = path.basename(requestedPath);
        }
      } catch {
        // Let ripgrep / the Node fallback report an empty result below.
      }

      const limit = max_results ?? 50;

      const args: string[] = [
        '--no-heading',
        '--line-number',
        '--color=never',
      ];

      if (case_insensitive) args.push('-i');
      if (ctxLines) args.push(`-C${ctxLines}`);
      if (globPattern) args.push(`--glob=${globPattern}`);

      args.push(`-m${limit * 2}`); // allow some overhead for context lines
      args.push('--', pattern, target);

      try {
        const result = execFileSync('rg', args, {
          cwd,
          encoding: 'utf-8',
          timeout: 15_000,
          maxBuffer: 1024 * 1024,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        // Trim to max_results entries
        const lines = result.trim().split('\n').map((line) => {
          const match = line.match(/^(.+?)([:-]\d+[:-])/);
          if (!match) return line;
          const portablePath = match[1].replace(/^\.([/\\])/, '').replace(/\\/g, '/');
          return `${portablePath}${match[2]}${line.slice(match[0].length)}`;
        });
        const trimmed = lines.slice(0, limit * 3); // rough trim (context lines inflate count)

        if (trimmed.length === 0) {
          return `No matches found for pattern "${pattern}" in ${cwd}`;
        }

        return trimmed.join('\n');
      } catch (err: unknown) {
        // rg exits with code 1 when no matches found
        if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 1) {
          return `No matches found for pattern "${pattern}" in ${cwd}`;
        }
        const processError = err as NodeJS.ErrnoException;
        if (processError.code !== 'ENOENT') {
          return `Error searching for pattern "${pattern}" in ${requestedPath}`;
        }

        try {
          const lines = await grepWithNode({
            pattern,
            root: cwd,
            target: path.resolve(cwd, target),
            glob: globPattern,
            caseInsensitive: case_insensitive,
            contextLines: ctxLines,
            limit,
            signal: toolOptions.abortSignal,
          });
          return lines.join('\n') || `No matches found for pattern "${pattern}" in ${requestedPath}`;
        } catch (fallbackError) {
          if (fallbackError instanceof Error && fallbackError.name === 'AbortError') throw fallbackError;
          const reason = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          return `Error searching for pattern "${pattern}" in ${requestedPath}: ${reason}`;
        }
      }
    },
  });
}
