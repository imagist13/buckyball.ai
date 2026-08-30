/**
 * fixture-mcp-stdio-server.mjs — minimal REAL stdio MCP server for the
 * Phase 4 @ai-sdk/mcp adapter POC smoke (scripts/smoke-ai-sdk7-phase4-mcp-poc.ts).
 *
 * Three deterministic tools over a genuine StdioServerTransport (real child
 * process, real pipes, real MCP initialize handshake):
 *   - fixture_read_note  (read-only) → fixed note text
 *   - fixture_write_note (write)     → appends to an on-disk file under
 *     FIXTURE_WRITE_DIR so the smoke can verify from OUTSIDE the process
 *     whether a denied write really never happened
 *   - fixture_error                  → isError result (extraction check)
 *
 * No network, no credentials — safe to run anywhere.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import path from 'node:path';

const NOTE_CONTENT = 'POC NOTE CONTENT — stdio fixture payload';
const writeDir = process.env.FIXTURE_WRITE_DIR || process.cwd();
const writeFile = path.join(writeDir, 'fixture-writes.log');

const server = new Server(
  { name: 'poc-fixture-stdio-server', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'fixture_read_note',
      description: 'Read the fixture note (read-only)',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'fixture_write_note',
      description: 'Append text to the fixture write log (write)',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'Text to append' } },
        required: ['text'],
      },
    },
    {
      name: 'fixture_error',
      description: 'Always returns an MCP error result',
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  switch (req.params.name) {
    case 'fixture_read_note':
      return { content: [{ type: 'text', text: NOTE_CONTENT }] };
    case 'fixture_write_note': {
      const text = String(req.params.arguments?.text ?? '');
      fs.appendFileSync(writeFile, `${text}\n`);
      return { content: [{ type: 'text', text: `wrote ${text.length} chars` }] };
    }
    case 'fixture_error':
      return { content: [{ type: 'text', text: 'boom from fixture' }], isError: true };
    default:
      return { content: [{ type: 'text', text: `unknown tool ${req.params.name}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
