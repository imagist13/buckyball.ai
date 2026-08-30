/**
 * Fixture MCP server for POC integration tests.
 *
 * Exposes three deterministic tools with no external dependencies:
 *  - ping: always returns 'pong'
 *  - ask_user: triggers elicitation (form mode) requesting a `name` field
 *  - fail_always: always throws, for error-path testing
 *
 * Used by *-poc.test.ts to exercise CodePilot's real queryOptions combination
 * against Claude Agent SDK 0.2.111 without touching production MCP servers.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export const fixtureMcpServer = createSdkMcpServer({
  name: 'fixture-poc',
  version: '1.0.0',
  tools: [
    tool(
      'ping',
      'Returns "pong" for liveness checks',
      {},
      async () => ({
        content: [{ type: 'text', text: 'pong' }],
      }),
    ),
    tool(
      'fail_always',
      'Always throws — exercises error paths',
      {},
      async () => {
        throw new Error('intentional fixture failure');
      },
    ),
    tool(
      'echo',
      'Echoes the input string back',
      { value: z.string() },
      async ({ value }: { value: string }) => ({
        content: [{ type: 'text', text: value }],
      }),
    ),
  ],
});
