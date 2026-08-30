/**
 * tools/glob.ts — Find files by pattern.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { execFileSync } from 'child_process';
import path from 'path';
import type { ToolContext } from './index';
import { globWithNode, SEARCH_EXCLUDED_DIRECTORIES } from './search-fallback';

export function createGlobTool(ctx: ToolContext) {
  return tool({
    description:
      'Find files matching a glob pattern. Returns file paths in stable path order. ' +
      'Use this to discover files by name pattern (e.g. "**/*.ts", "src/components/**/*.tsx").',
    inputSchema: z.object({
      pattern: z.string().describe('Glob pattern to match files against'),
      path: z.string().optional().describe('Directory to search in (defaults to working directory)'),
    }),
    execute: async ({ pattern, path: searchPath }) => {
      const cwd = searchPath
        ? (path.isAbsolute(searchPath) ? searchPath : path.resolve(ctx.workingDirectory, searchPath))
        : ctx.workingDirectory;

      try {
        const args = ['--files', '--color=never', '--glob', pattern];
        for (const directory of SEARCH_EXCLUDED_DIRECTORIES) {
          args.push('--glob', `!${directory}/**`, '--glob', `!**/${directory}/**`);
        }
        let result: string;
        try {
          result = execFileSync('rg', args, {
            cwd,
            encoding: 'utf-8',
            timeout: 10_000,
            maxBuffer: 1024 * 1024,
          });
        } catch (error) {
          const processError = error as NodeJS.ErrnoException & { status?: number };
          if (processError.status === 1) {
            result = '';
          } else if (processError.code === 'ENOENT') {
            result = globWithNode(cwd, pattern).join('\n');
          } else {
            throw error;
          }
        }

        const files = result.trim().split('\n')
          .filter(Boolean)
          .map((file) => file.replace(/^\.([/\\])/, '').replace(/\\/g, '/'))
          .sort()
          .slice(0, 200);
        if (files.length === 0) {
          return `No files found matching pattern "${pattern}" in ${cwd}`;
        }

        return files.join('\n');
      } catch {
        return `Error searching for files matching "${pattern}" in ${cwd}`;
      }
    },
  });
}
