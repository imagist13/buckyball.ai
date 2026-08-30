#!/usr/bin/env node
/**
 * Phase 8 / Phase 0 POC — standalone stdio MCP fixture.
 *
 * This is a REAL spawnable stdio MCP server (not an in-process
 * `createSdkMcpServer()` like `src/lib/memory-search-mcp.ts`). It is the
 * shape Codex `config.mcp_servers.<name> = { command, args }` needs: a
 * process Codex's app-server can launch and speak MCP to over stdio.
 *
 * It deliberately lives under docs/research (NOT src/) so it stays out of
 * the product path and out of `codex-user-mcp-wiring.test.ts`'s file list.
 *
 * Tools (fake CodePilot Memory surface — no real DB, no real ~/.codex):
 *   - memory_recent : returns canned "recent memory" entries (no args)
 *   - memory_search : { query } → canned matching entries
 *   - fail_always   : always throws — exercises the tool-error path
 *   - ask_user      : triggers an MCP elicitation request — exercises the
 *                     elicitation path (client must respond or decline)
 *
 * Env knobs (so the same binary can simulate failure states):
 *   FIXTURE_MODE=broken → exit(1) before connecting stdio, to simulate a
 *                         broken MCP server that fails to start. Codex surfaces
 *                         this via the `mcpServer/startupStatus/updated`
 *                         notification (status:failed), NOT mcpServerStatus/list.
 *
 * IMPORTANT: stdout is the MCP JSON-RPC channel. All human-readable logs
 * go to stderr only.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const log = (...args) => console.error('[fixture-memory-mcp]', ...args);

if (process.env.FIXTURE_MODE === 'broken') {
  log('FIXTURE_MODE=broken → exiting 1 before connecting (simulated startup failure)');
  process.exit(1);
}

const FAKE_MEMORIES = [
  { id: 'mem-1', text: 'User prefers replies in Chinese; keep code/paths in original form.' },
  { id: 'mem-2', text: 'Worktree path discipline: all file ops must stay under the worktree base.' },
  { id: 'mem-3', text: 'Codex Runtime MCP injection goes through native config.mcp_servers, not the Claude SDK loaders.' },
];

const server = new McpServer({
  name: 'codepilot-memory-fixture',
  version: '0.0.1',
});

server.registerTool(
  'memory_recent',
  {
    title: 'Recent memory',
    description: 'Return the most recent CodePilot memory entries (fixture data).',
    inputSchema: {},
  },
  async () => ({
    content: [{ type: 'text', text: JSON.stringify(FAKE_MEMORIES, null, 2) }],
  }),
);

server.registerTool(
  'memory_search',
  {
    title: 'Search memory',
    description: 'Search CodePilot memory by substring (fixture data).',
    inputSchema: { query: z.string().describe('substring to match') },
  },
  async ({ query }) => {
    const q = String(query ?? '').toLowerCase();
    const hits = FAKE_MEMORIES.filter((m) => m.text.toLowerCase().includes(q));
    log(`memory_search query=${JSON.stringify(query)} → ${hits.length} hit(s)`);
    return {
      content: [{ type: 'text', text: JSON.stringify(hits, null, 2) }],
    };
  },
);

server.registerTool(
  'fail_always',
  {
    title: 'Always fails',
    description: 'Always throws — exercises the MCP tool-error path.',
    inputSchema: {},
  },
  async () => {
    throw new Error('intentional fixture failure');
  },
);

server.registerTool(
  'ask_user',
  {
    title: 'Ask the user (elicitation)',
    description: 'Triggers an MCP elicitation request asking for a name.',
    inputSchema: {},
  },
  async () => {
    try {
      const res = await server.server.elicitInput({
        message: 'Fixture elicitation: what is your name?',
        requestedSchema: {
          type: 'object',
          properties: { name: { type: 'string', title: 'Name' } },
          required: ['name'],
        },
      });
      log('elicitation result:', JSON.stringify(res));
      return {
        content: [{ type: 'text', text: `elicitation action=${res.action} content=${JSON.stringify(res.content ?? null)}` }],
      };
    } catch (err) {
      // Client does not support elicitation (or declined at the protocol
      // level) → surface as a safe tool error rather than hanging.
      const reason = err instanceof Error ? err.message : String(err);
      log('elicitation failed/unsupported:', reason);
      return {
        content: [{ type: 'text', text: `elicitation unsupported or declined: ${reason}` }],
        isError: true,
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
log('connected over stdio; tools: memory_recent, memory_search, fail_always, ask_user');
